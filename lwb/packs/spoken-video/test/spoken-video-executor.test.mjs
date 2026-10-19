import assert from 'node:assert/strict'
import test from 'node:test'
import { assertDshExecution, createDshExecutor } from '@scitiger-ai/lwb-pack-sdk/execution'
import { createAgentExecutor } from '../index.mjs'
import { buildVideoCreatorContinuationPrompt } from '../spoken-video-video-agent.mjs'

/**
 * The executor now has two contracts:
 *
 * - structured generations go through the `subagents` service, with DSH 0.2.1
 *   `startActivation` and the 0.1.x `start` both normalized;
 * - the multi-turn video director runs on a dedicated LWB root Agent, because
 *   a 0.2.1 local Activation is disposed as soon as its first turn goes idle
 *   and can no longer accept repair turns.
 *
 * These fakes mirror those two contracts, not a particular DSH release. The
 * root Agent's Session deliberately exposes DSH 0.2.1's shape — `seq` and
 * delivered events only — and its removed `events` history throws if read.
 */

function fakeRoot({ id = 'root-session-1', reasons = [], options = { provider: 'lwb', model: 'deepseek-v4.1-flash' } } = {}) {
  const listeners = new Set()
  const session = { id, seq: 0 }
  Object.defineProperty(session, 'events', {
    get() { throw new Error('DSH 0.2.1 Session no longer exposes events') },
  })
  const followups = []
  let idle = Promise.resolve()
  let turn = 0
  let disposed = 0
  const agent = {
    id,
    session,
    options,
    followups,
    dispose() { disposed += 1 },
    followup(message) {
      followups.push(message)
      const reason = reasons[turn] ?? 'completed'
      turn += 1
      idle = new Promise((resolve) => {
        queueMicrotask(() => {
          const assistant = {
            seq: session.seq++,
            type: 'assistant/message',
            data: { message: { content: [{ type: 'text', text: reason }] } },
          }
          for (const listener of listeners) listener(session, assistant)
          const event = { seq: session.seq++, type: 'turn/end', data: { turn, reason: { kind: reason } } }
          for (const listener of listeners) listener(session, event)
          resolve()
        })
      })
    },
    whenIdle() { return idle },
    cancel() {},
    disposed: () => disposed,
  }
  return { agent, listeners }
}

function harness({ reasons = [], options, signal = new AbortController().signal, subagents } = {}) {
  const { agent: root, listeners } = fakeRoot({ reasons, ...(options === undefined ? {} : { options }) })
  const withAgentOptions = []
  const scope = {
    signal,
    withAgent: async (operation, _signal, agentOptions = {}) => {
      withAgentOptions.push(agentOptions)
      try { return await operation(root) } finally { root.dispose() }
    },
  }
  const ctx = {
    on(name, callback) {
      assert.equal(name, 'session/event')
      listeners.add(callback)
      return () => listeners.delete(callback)
    },
    get(name) {
      if (name !== 'agents') return undefined
      return { get: (id) => (id === root.id ? root : undefined) }
    },
    lwbPackServices: { forPack: () => scope },
  }
  return { ctx, root, listeners, withAgentOptions, subagents }
}

function structuredSubagents({ structured = { ok: true }, stopReason = 'completed' } = {}) {
  const calls = []
  const disposals = []
  let childSessionId = 'child-session-1'
  return {
    calls,
    disposals,
    async startActivation(spec) {
      calls.push(spec)
      return {
        childId: childSessionId,
        result: Promise.resolve({ structured, stopReason, output: [] }),
        async dispose() { disposals.push(spec) },
      }
    },
  }
}

test('structured generation uses DSH 0.2.1 startActivation with a caller-owned result', async () => {
  const subagents = structuredSubagents()
  const { ctx, root } = harness({ subagents })
  const started = []
  const executor = createDshExecutor(ctx, subagents, 'spoken-video', 'spoken-video-topic', true)
  const result = await executor({
    prompt: 'generate topic', schema: { type: 'object' },
    agent: { workspacePath: '/pack/workspace' },
    onDshStarted: (value) => started.push(value),
  })
  assert.deepEqual(result, { ok: true })
  assert.equal(subagents.calls.length, 1)
  const spec = subagents.calls[0]
  assert.equal(spec.provider, 'spawn')
  assert.equal(spec.label, 'spoken-video-topic')
  assert.equal(spec.delivery, 'caller')
  assert.equal(spec.request.parent, root)
  assert.deepEqual(spec.request.outputSchema, { type: 'object' })
  assert.deepEqual(spec.request.agentOptions, { provider: 'lwb', model: 'deepseek-v4.1-flash' })
  assert.deepEqual(started, [{ childSessionId: 'child-session-1', parentSessionId: 'root-session-1' }])
  assert.equal(subagents.disposals.length, 1)
})

test('structured generation accepts a live DSH Agent without creating another root', async () => {
  const subagents = structuredSubagents()
  const { ctx, withAgentOptions } = harness({ subagents })
  const parent = { id: 'schedule-root', options: { provider: 'lwb', model: 'deepseek-v4.1-flash', reasoningEffort: 'low' } }
  const executor = createDshExecutor(ctx, subagents, 'spoken-video', 'spoken-video-topic', true)
  await executor({ prompt: 'x', schema: {}, agent: parent })
  assert.equal(withAgentOptions.length, 0)
  assert.equal(subagents.calls[0].request.parent, parent)
  assert.deepEqual(subagents.calls[0].request.agentOptions, { provider: 'lwb', model: 'deepseek-v4.1-flash', reasoningEffort: 'low' })
})

test('structured generation falls back to the DSH 0.1.x start shape', async () => {
  const calls = []
  const subagents = {
    async start(mode, request) {
      calls.push({ mode, request })
      return { id: 'child-session-2', localAgent: undefined, result: Promise.resolve({ structured: { ok: true }, stopReason: 'completed' }), async dispose() {} }
    },
  }
  const { ctx } = harness({ subagents })
  const executor = createDshExecutor(ctx, subagents, 'spoken-video', 'spoken-video-topic', true)
  const result = await executor({ prompt: 'x', schema: { type: 'object' }, agent: { id: 'parent' } })
  assert.deepEqual(result, { ok: true })
  assert.equal(calls[0].mode, 'spawn')
  assert.equal(calls[0].request.label, 'spoken-video-topic')
  assert.equal(calls[0].request.parent.id, 'parent')
  assert.deepEqual(calls[0].request.outputSchema, { type: 'object' })
})

test('the video director continues a max-token turn in the same root session', async () => {
  const continuations = []
  const { ctx, root } = harness({ reasons: ['max-tokens', 'completed'] })
  const executor = createAgentExecutor(ctx, { startActivation() {} }, 'video-creator', {
    maxTokenContinuations: 2,
    continuationPrompt: buildVideoCreatorContinuationPrompt,
  })
  const result = await executor({
    prompt: 'create video', agent: { id: 'parent-session-1' },
    onDshContinuation: (value) => continuations.push(value),
  })
  assert.equal(result.childSessionId, 'root-session-1')
  assert.equal(root.followups.length, 2)
  assert.match(root.followups[0].content[0].text, /create video/u)
  assert.match(root.followups[1].content[0].text, /1\/2/u)
  assert.deepEqual(continuations.map(item => item.attempt), [1])
  assert.equal(root.disposed(), 1)
})

test('the video director reads turns from delivered events, not the removed Session.events history', async () => {
  const { ctx, root } = harness({ reasons: ['completed'] })
  const executor = createAgentExecutor(ctx, { startActivation() {} }, 'video-creator')
  const result = await executor({ prompt: 'create video', agent: { id: 'parent' } })
  assert.equal(result.childSessionId, 'root-session-1')
  assert.deepEqual(result.output, [{ type: 'text', text: 'completed' }])
  assert.equal(root.followups.length, 1)
})

test('the video director preserves the route captured by its caller', async () => {
  const { ctx, withAgentOptions } = harness({ reasons: ['completed'] })
  const executor = createAgentExecutor(ctx, { startActivation() {} }, 'video-creator')
  await executor({
    prompt: 'create video',
    agent: { id: 'parent', options: { provider: 'lwb', model: 'deepseek-v4.1-flash', reasoningEffort: 'low' } },
  })
  assert.deepEqual(withAgentOptions, [{ agentOptions: { provider: 'lwb', model: 'deepseek-v4.1-flash', reasoningEffort: 'low' } }])
})

test('the video director fails clearly after all continuation budgets are spent', async () => {
  const { ctx, root } = harness({ reasons: ['max-tokens', 'max-tokens', 'max-tokens'] })
  const executor = createAgentExecutor(ctx, { startActivation() {} }, 'video-creator', {
    maxTokenContinuations: 2,
    continuationPrompt: buildVideoCreatorContinuationPrompt,
  })
  await assert.rejects(
    executor({ prompt: 'create video', agent: { id: 'parent' } }),
    /连续 3 个创作轮次达到单次输出上限/u,
  )
  assert.equal(root.followups.length, 3)
  assert.equal(root.disposed(), 1)
})

test('a failed first turn never reaches preflight', async () => {
  const { ctx, root } = harness({ reasons: ['error'] })
  const executor = createAgentExecutor(ctx, { startActivation() {} }, 'video-creator')
  await assert.rejects(executor({
    prompt: 'create', agent: { id: 'parent' }, validate: async () => ({ passed: true }),
  }), /生成未正常结束（error）/u)
  assert.equal(root.followups.length, 1)
  assert.equal(root.disposed(), 1)
})

test('preflight repairs continue the same root session and stop after success', async () => {
  const { ctx, root } = harness({ reasons: ['completed', 'completed'] })
  const repairs = []
  let checks = 0
  const executor = createAgentExecutor(ctx, { startActivation() {} }, 'video-creator')
  const result = await executor({
    prompt: 'create', agent: { id: 'parent' },
    validate: async () => ({ passed: ++checks > 1, repairable: true, failures: ['CreativeVideo.tsx:12 transition'] }),
    repairPrompt: ({ report }) => report.failures.join('\n'),
    onDshRepair: value => repairs.push(value),
  })
  assert.equal(result.childSessionId, 'root-session-1')
  assert.equal(checks, 2)
  assert.equal(root.followups.length, 2)
  assert.match(root.followups[1].content[0].text, /CreativeVideo.tsx:12/u)
  assert.equal(repairs[0].attempt, 1)
  assert.equal(root.disposed(), 1)
})

test('preflight repair budget is capped, and a non-repairable report stops immediately', async () => {
  for (const repairable of [true, false]) {
    const { ctx, root } = harness({ reasons: ['completed', 'completed', 'completed'] })
    const executor = createAgentExecutor(ctx, { startActivation() {} }, 'video-creator')
    await executor({
      prompt: 'create', agent: { id: 'parent' }, maxRepairs: 99,
      validate: async () => ({ passed: false, repairable, failures: ['invalid'] }), repairPrompt: () => 'repair',
    })
    assert.equal(root.followups.length, repairable ? 3 : 1)
  }
})

test('a failed repair turn never proceeds as completed', async () => {
  const { ctx, root } = harness({ reasons: ['completed', 'error'] })
  const executor = createAgentExecutor(ctx, { startActivation() {} }, 'video-creator')
  await assert.rejects(executor({
    prompt: 'create', agent: { id: 'parent' },
    validate: async () => ({ passed: false, repairable: true, failures: ['invalid'] }), repairPrompt: () => 'repair',
  }), /视频修复未正常结束/u)
  assert.equal(root.disposed(), 1)
})

test('pack cancellation between preflight and repair prevents another model turn', async () => {
  const controller = new AbortController()
  const { ctx, root } = harness({ reasons: ['completed'], signal: controller.signal })
  const executor = createAgentExecutor(ctx, { startActivation() {} }, 'video-creator')
  await assert.rejects(executor({
    prompt: 'create', agent: { id: 'parent' },
    validate: async () => {
      controller.abort()
      return { passed: false, repairable: true, failures: ['invalid'] }
    },
    repairPrompt: () => 'repair',
  }), { name: 'AbortError' })
  assert.equal(root.followups.length, 1)
  assert.equal(root.disposed(), 1)
})

test('the capability assertion names the unsupported seam instead of hiding it', () => {
  const scope = { withAgent() {} }
  const base = { lwbPackServices: { forPack: () => scope }, on() {} }
  assert.throws(() => assertDshExecution(base, {}, 'spoken-video'), /startActivation.*start/su)
  assert.throws(() => assertDshExecution({ ...base, on: undefined }, { startActivation() {} }, 'spoken-video'), /session\/event/u)
  assert.throws(() => assertDshExecution({ lwbPackServices: { forPack: () => ({}) }, on() {} }, { startActivation() {} }, 'spoken-video'), /withAgent/u)
  assert.doesNotThrow(() => assertDshExecution(base, { startActivation() {} }, 'spoken-video'))
  assert.doesNotThrow(() => assertDshExecution(base, { start() {} }, 'spoken-video'))
})
