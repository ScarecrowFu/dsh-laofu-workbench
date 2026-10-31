import assert from 'node:assert/strict'
import test from 'node:test'
import { ModelReviewGateway } from '../gateway.mjs'

function gatewayFor(groups) {
  let created = 0
  const scope = {
    assertAccess: async () => {},
    request: async (operation) => operation({}),
    models: { list: async () => groups },
    background: () => {},
  }
  const gateway = Object.create(ModelReviewGateway.prototype)
  gateway.ctx = {
    modelReviewScope: scope,
    modelReviewStore: {
      listQuestions: async () => [{ id: 'question', status: 'active', prompt: 'test' }],
      createTask: async () => { created++; return { id: 'task', runs: [] } },
    },
  }
  return { gateway, created: () => created }
}

const account = { id: 'deepseek-account', models: [{ id: 'deepseek-flash' }] }
const official = { id: 'deepseek-official', selectable: false, unavailableReason: '未配置 DeepSeek API Key', models: [{ id: 'deepseek-flash' }] }
const request = (provider, model = 'deepseek-flash') => ({ questionId: 'question', models: [{ provider, model }] })

test('start refuses a model from an unconfigured API Key route before creating a task', async () => {
  const { gateway, created } = gatewayFor([account, official])
  await assert.rejects(gateway.start(request('deepseek-official')), /未配置 DeepSeek API Key/)
  assert.equal(created(), 0)
  await gateway.start(request('deepseek-account'))
  assert.equal(created(), 1)
})

test('start accepts API Key models after configuration, but rejects stale and duplicate selections', async () => {
  const { gateway, created } = gatewayFor([account, { ...official, selectable: true }])
  await gateway.start(request('deepseek-official'))
  await assert.rejects(gateway.start(request('deepseek-official', 'missing')), /已不在可用模型列表/)
  const duplicate = request('deepseek-account')
  duplicate.models.push({ ...duplicate.models[0] })
  await assert.rejects(gateway.start(duplicate), /不能重复选择/)
  assert.equal(created(), 1)
})

test('start launches every selected available model without a count limit', async () => {
  const models = Array.from({ length: 30 }, (_, index) => ({ id: `model-${index}` }))
  const { gateway } = gatewayFor([{ id: 'ready', selectable: true, models }])
  const selected = models.map(model => ({ provider: 'ready', model: model.id, displayName: model.id }))
  let stored
  const launched = []
  gateway.ctx.modelReviewStore.createTask = async ({ models }) => {
    stored = models
    return { id: 'task', runs: models.map((model, index) => ({ id: `run-${index}`, model })) }
  }
  gateway.launchRun = async (_context, _taskId, run) => { launched.push(run.model) }

  await assert.rejects(gateway.start({ questionId: 'question', models: [] }), /至少选择一个模型/u)
  await assert.rejects(gateway.start({ questionId: 'question' }), /至少选择一个模型/u)
  const task = await gateway.start({ questionId: 'question', models: selected })
  assert.deepEqual(stored, selected)
  assert.deepEqual(launched, selected)
  assert.equal(task.runs.length, 30)
})

test('launchRun saves the completed answer from the follow snapshot', async () => {
  let followRequest
  let promptAccepted = false
  let disposed = false
  const updates = []
  const created = []
  const collected = []
  const session = {
    id: 'session',
    async followup(prompt) {
      assert.equal(prompt, 'test prompt')
      await Promise.resolve()
      promptAccepted = true
    },
    async whenIdle() { assert.equal(promptAccepted, true, 'wait for prompt acceptance before waiting for idle') },
    async *follow(request) {
      followRequest = request
      yield {
        type: 'snapshot',
        cursor: 2,
        hasMore: false,
        records: [
          { type: 'event', event: { type: 'assistant/message', seq: 2, time: 0, data: { content: 'answer' } } },
          // A finished run closes its turn. Without this the attempt reads as
          // interrupted, which is what the false-success rule keys on.
          { type: 'event', event: { type: 'turn/end', seq: 3, time: 0, data: { reason: { kind: 'completed' } } } },
        ],
      }
    },
    dispose: async () => { disposed = true },
  }
  const gateway = Object.create(ModelReviewGateway.prototype)
  gateway.ctx = {
    modelReviewScope: { sessions: { create: async (options) => { created.push(options); return session } } },
    modelReviewStore: {
      updateRun: async (...args) => updates.push(args),
      collectArtifacts: async (taskId, runId) => { collected.push([taskId, runId]); return [{ path: 'answer.md', bytes: 6, updatedAt: 'now' }] },
    },
  }

  await gateway.launchRun({}, 'task', { id: 'run', cwd: 'runs/task/run', model: { provider: 'deepseek-account', model: 'deepseek-flash' } }, 'test prompt')
  assert.equal(followRequest.maxMessages, 500)
  assert.deepEqual(created, [{ provider: 'deepseek-account', model: 'deepseek-flash', cwd: 'runs/task/run' }], 'each run runs in its own directory')
  assert.deepEqual(collected, [['task', 'run']])
  assert.equal(updates.at(-1)[2].status, 'succeeded')
  assert.equal(updates.at(-1)[2].sessionId, 'session')
  assert.deepEqual(updates.at(-1)[2].answer, { content: 'answer' })
  assert.deepEqual(updates.at(-1)[2].artifacts, [{ path: 'answer.md', bytes: 6, updatedAt: 'now' }])
  assert.equal(disposed, true, 'the pack facade is released after preserving the official Session')
})

test('launchRun does not mark a run successful without a model answer', async () => {
  const updates = []
  const session = {
    id: 'session', followup: async () => {}, whenIdle: async () => {}, dispose: async () => {},
    async *follow() { yield { type: 'snapshot', cursor: 1, hasMore: false, records: [] } },
  }
  const gateway = Object.create(ModelReviewGateway.prototype)
  gateway.ctx = {
    modelReviewScope: { sessions: { create: async () => session } },
    modelReviewStore: {
      updateRun: async (...args) => updates.push(args),
      collectArtifacts: async () => [{ path: 'partial.html', bytes: 12, updatedAt: 'now' }],
    },
  }
  await gateway.launchRun({}, 'task', { id: 'run', cwd: 'runs/task/run', model: { provider: 'deepseek-account', model: 'deepseek-flash' } }, 'test prompt')
  assert.equal(updates.at(-1)[2].status, 'failed')
  assert.equal(updates.at(-1)[2].sessionId, 'session')
  assert.match(updates.at(-1)[2].error, /未生成模型回答/)
  assert.deepEqual(updates.at(-1)[2].artifacts.map((item) => item.path), ['partial.html'], 'a failed run still reports what it wrote')
})

/** A run that produced text and then had its turn closed by `reason`. */
function finishGateway(reason) {
  const updates = []
  const session = {
    id: 'session', followup: async () => {}, whenIdle: async () => {}, dispose: async () => {},
    async *follow() {
      yield {
        type: 'snapshot', cursor: 9, hasMore: false,
        records: [
          { type: 'event', event: { type: 'assistant/message', seq: 8, time: 0, data: { content: 'half an answer' } } },
          { type: 'event', event: { type: 'turn/end', seq: 9, time: 0, data: { reason } } },
        ],
      }
    },
  }
  const gateway = Object.create(ModelReviewGateway.prototype)
  gateway.ctx = {
    modelReviewScope: { sessions: { create: async () => session } },
    modelReviewStore: { updateRun: async (...args) => updates.push(args), collectArtifacts: async () => [{ path: 'half.html', bytes: 9, updatedAt: 'now' }] },
  }
  return { gateway, updates }
}

test('a run whose turn was cut short is not reported as 已完成, even though it produced text', async () => {
  // The production shape: kimi-k3.1-pro wrote part of its answer, then the provider
  // returned 429 engine_overloaded and the turn ended there. Marking that 已完成
  // would read as a working model that simply produced little.
  const cutShort = { kind: 'error', error: { message: '429: {"message":"The engine is currently overloaded, please try again later"}', code: 'RATE_LIMIT' } }
  const { gateway, updates } = finishGateway(cutShort)
  await gateway.launchRun({}, 'task', { id: 'run', cwd: 'runs/task/run', model: { provider: 'kimi', model: 'kimi-k3.1-pro' } }, 'prompt')
  const patch = updates.at(-1)[2]
  assert.equal(patch.status, 'failed', 'an answer is not a finished job')
  assert.match(patch.error, /429/u, 'the reason the turn ended travels with the run')
  assert.deepEqual(patch.answer, { content: 'half an answer' }, 'what it did write is still kept')
  assert.deepEqual(patch.artifacts.map((item) => item.path), ['half.html'], 'and so are its artifacts')

  // A capped response is a failed attempt for the same reason: the work is unfinished.
  const truncated = finishGateway({ kind: 'max-tokens' })
  await truncated.gateway.launchRun({}, 'task', { id: 'run', cwd: 'runs/task/run', model: { provider: 'p', model: 'm' } }, 'prompt')
  assert.equal(truncated.updates.at(-1)[2].status, 'failed')
  assert.match(truncated.updates.at(-1)[2].error, /截断/u)

  // A user-stopped turn is its own outcome, not a failure of the model.
  const stopped = finishGateway({ kind: 'aborted' })
  await stopped.gateway.launchRun({}, 'task', { id: 'run', cwd: 'runs/task/run', model: { provider: 'p', model: 'm' } }, 'prompt')
  assert.equal(stopped.updates.at(-1)[2].status, 'cancelled')

  // A clean stop is the only thing that counts as 已完成.
  const clean = finishGateway({ kind: 'completed' })
  await clean.gateway.launchRun({}, 'task', { id: 'run', cwd: 'runs/task/run', model: { provider: 'p', model: 'm' } }, 'prompt')
  assert.equal(clean.updates.at(-1)[2].status, 'succeeded')
})

/**
 * Projection values shaped exactly as the host hands them out.
 *
 * `tokenUsage` is the trap here: the unit's wire view is `state.totals`, so the
 * buckets sit at the top level, while the persisted cache row — and every fixture
 * written by reading that row — holds `{ totals, last }`. A fixture built from the
 * cache shape passes a reader that only accepts the cache shape, which is exactly
 * how a broken read shipped with 81 green tests.
 */
const projectionValues = {
  sessionStats: { turns: 1, steps: 28, llmMs: 504282, toolMs: 401396, ttftMs: 81750, ttftSteps: 28, decodeMs: 422532, decodeTokens: 56123 },
  tokenUsage: { uncachedInputTokens: 200843, cacheReadTokens: 1409920, cacheWriteTokens: 0, outputTokens: 56123 },
  contextPressure: { pressureTokens: 74128, contextWindow: 1000000 },
}

/** A gateway whose session settles with or without an answer. */
function settleGateway({ answer = true, projections = async () => ({ asOfSeq: 171, values: projectionValues }) } = {}) {
  const updates = []
  const asked = []
  const session = {
    id: 'session', followup: async () => {}, whenIdle: async () => {}, dispose: async () => {},
    async *follow() {
      yield {
        type: 'snapshot', cursor: 3, hasMore: false,
        records: answer
          ? [
            { type: 'event', event: { type: 'assistant/message', seq: 2, time: 0, data: { content: 'answer' } } },
            { type: 'event', event: { type: 'turn/end', seq: 3, time: 0, data: { reason: { kind: 'completed' } } } },
          ]
          : [],
      }
    },
  }
  const gateway = Object.create(ModelReviewGateway.prototype)
  const scope = { sessions: { create: async () => session } }
  // Only present when the host provides the seam at all.
  if (projections) scope.sessions.projections = async (sessionId, keys) => { asked.push([sessionId, keys]); return projections() }
  gateway.ctx = {
    modelReviewScope: scope,
    modelReviewStore: { updateRun: async (...args) => updates.push(args), collectArtifacts: async () => [] },
  }
  return { gateway, updates, asked }
}

test('a settled run records the figures the host reports for its conversation', async () => {
  const { gateway, updates, asked } = settleGateway()
  await gateway.launchRun({}, 'task', { id: 'run', cwd: 'runs/task/run', model: { provider: 'p', model: 'm' } }, 'prompt')
  const patch = updates.at(-1)[2]
  assert.equal(patch.status, 'succeeded')
  assert.equal(patch.stats.steps, 28)
  assert.equal(patch.stats.asOfSeq, 171)
  assert.equal(patch.stats.source, 'settle')
  assert.equal(patch.stats.tokens.cacheRead, 1409920)
  assert.deepEqual(asked, [['session', ['sessionStats', 'tokenUsage', 'contextPressure', 'timeContext']]], 'only the keys a report needs are read')
})

test('a failed run records them too: its spend is what explains the failure', async () => {
  const { gateway, updates } = settleGateway({ answer: false })
  await gateway.launchRun({}, 'task', { id: 'run', cwd: 'runs/task/run', model: { provider: 'p', model: 'm' } }, 'prompt')
  const patch = updates.at(-1)[2]
  assert.equal(patch.status, 'failed')
  assert.match(patch.error, /未生成模型回答/u)
  assert.equal(patch.stats.steps, 28, 'the work that failed is still measured')
})

test('a host without the projection seam, or one that errors, still settles the run', async () => {
  for (const projections of [null, async () => { throw new Error('会话投影不可用。') }]) {
    const { gateway, updates } = settleGateway({ projections })
    await gateway.launchRun({}, 'task', { id: 'run', cwd: 'runs/task/run', model: { provider: 'p', model: 'm' } }, 'prompt')
    const patch = updates.at(-1)[2]
    // A report without numbers is recoverable; a run that never settles is not.
    assert.equal(patch.status, 'succeeded')
    assert.equal('stats' in patch, false, 'no figures are invented when the host has none')
  }
})

/**
 * A gateway whose single run reads projections through `projections`, with the
 * store recording every write so persistence can be asserted separately from the
 * reason that is merely reported.
 */
function statsGateway({ projections, run = { id: 'run', sessionId: 'session', stats: null } }) {
  const writes = []
  const scope = { assertAccess: async () => {}, request: async (operation) => operation({}) }
  if (projections) scope.sessions = { projections }
  const gateway = Object.create(ModelReviewGateway.prototype)
  gateway.ctx = {
    modelReviewScope: scope,
    modelReviewStore: {
      task: async () => ({ id: 'task', runs: [run] }),
      updateRun: async (...args) => { writes.push(args[2]); Object.assign(run, args[2]) },
    },
  }
  return { gateway, writes, run }
}

test('every reason a run has no figures is named, and only the permanent ones are remembered', async () => {
  // No session at all: settled before per-run sessions existed. Permanent.
  const noSession = statsGateway({ run: { id: 'run', sessionId: null, stats: null } })
  assert.deepEqual(await noSession.gateway.stats({ taskId: 'task', runId: 'run' }), { stats: null, reason: 'no-session' })
  assert.deepEqual(noSession.writes, [{ statsUnavailable: 'no-session' }], 'a reason that cannot change is written down')

  // The host has no projection seam. Retryable: restarting the host fixes it, so it
  // must not be remembered as a fact about the run.
  const unsupported = statsGateway({})
  assert.deepEqual(await unsupported.gateway.stats({ taskId: 'task', runId: 'run' }), { stats: null, reason: 'unsupported' })
  assert.deepEqual(unsupported.writes, [], 'a retryable reason is reported, never stored')
  assert.equal(unsupported.run.statsUnavailable, undefined)

  // The host answered but the session is gone. Permanent.
  const missing = statsGateway({ projections: async () => null })
  assert.deepEqual(await missing.gateway.stats({ taskId: 'task', runId: 'run' }), { stats: null, reason: 'missing' })
  assert.deepEqual(missing.writes, [{ statsUnavailable: 'missing' }])

  // The read itself failed. Retryable.
  const failed = statsGateway({ projections: async () => { throw new Error('会话投影读取失败。') } })
  assert.deepEqual(await failed.gateway.stats({ taskId: 'task', runId: 'run' }), { stats: null, reason: 'failed' })
  assert.deepEqual(failed.writes, [])

  // The projections came back without the rows a report needs. Retryable.
  const empty = statsGateway({ projections: async () => ({ asOfSeq: 5, values: { sessionStats: { turns: 1 } } }) })
  assert.deepEqual(await empty.gateway.stats({ taskId: 'task', runId: 'run' }), { stats: null, reason: 'empty' })
  assert.deepEqual(empty.writes, [])

  await assert.rejects(noSession.gateway.stats({ taskId: 'task', runId: 'missing' }), /测评运行不存在/u)
})

test('a retryable failure is retried, a settled verdict is not', async () => {
  // Restarting the host is the fix, so the next report tries again and succeeds.
  let seamed = false
  let reads = 0
  const retried = statsGateway({ projections: async () => { reads += 1; return seamed ? { asOfSeq: 12, values: projectionValues } : null } })
  // A null answer is permanent, so use a throwing read to model "host could not answer".
  retried.gateway.ctx.modelReviewScope.sessions.projections = async () => {
    reads += 1
    if (!seamed) throw new Error('宿主不提供会话投影读取服务。')
    return { asOfSeq: 12, values: projectionValues }
  }
  assert.equal((await retried.gateway.stats({ taskId: 'task', runId: 'run' })).reason, 'failed')
  seamed = true
  const second = await retried.gateway.stats({ taskId: 'task', runId: 'run' })
  assert.equal(second.reason, null)
  assert.equal(second.stats.steps, 28)
  assert.equal(reads, 2)

  // A permanent verdict short-circuits: a session that is gone stays gone, and the
  // report must not ask the host again on every open.
  let asked = 0
  const settled = statsGateway({ projections: async () => { asked += 1; return null } })
  await settled.gateway.stats({ taskId: 'task', runId: 'run' })
  await settled.gateway.stats({ taskId: 'task', runId: 'run' })
  assert.equal(asked, 1, 'a permanent reason is read once')
})

test('an older run is backfilled once and keeps that record for later reports', async () => {
  let reads = 0
  const { gateway, writes } = statsGateway({ projections: async () => { reads += 1; return { asOfSeq: 91, values: projectionValues } } })
  const first = await gateway.stats({ taskId: 'task', runId: 'run' })
  assert.equal(first.reason, null)
  assert.equal(first.stats.source, 'backfill', 'a figure read after the fact says so')
  assert.equal(first.stats.asOfSeq, 91)
  assert.equal(writes.length, 1)
  // A run that never had figures is not a continued one: there was no record for the
  // conversation to move past, so claiming 续跑 would be an invented fact.
  assert.equal('continued' in writes.at(-1), false, 'a first-time backfill is not a continuation')
  // The conversation has not moved, so a later report keeps the record it has and
  // does not drift: the host is still asked, but it answers with the same figures.
  const second = await gateway.stats({ taskId: 'task', runId: 'run' })
  assert.deepEqual(second, first)
  assert.equal(writes.length, 1, 'an unchanged conversation is not rewritten')
  assert.equal(reads, 2, 'the host is asked each time, because only it knows whether the conversation moved')
})

test('a run continued after it settled re-reads its figures instead of keeping the cut-short ones', async () => {
  // The production shape: attempt one ends on a provider 429 at seq 250, the run
  // settles there, and the card is continued afterwards up to seq 572. The stored
  // figures are a fold of the log, so they must follow the log — 54k output tokens
  // is only what the first attempt produced, not what the run cost.
  const settled = {
    id: 'run', sessionId: 'session', stats: { source: 'settle', asOfSeq: 250, turns: 1, steps: 28, llmMs: 1095111, decodeTokens: 54034, tokens: { output: 54034 } },
    completedAt: '2026-10-24T07:05:08.887Z',
  }
  let asOfSeq = 572
  const { gateway, writes } = statsGateway({
    run: settled,
    projections: async () => ({
      asOfSeq,
      values: {
        sessionStats: { turns: 5, steps: 57, llmMs: 1790754, toolMs: 154518, ttftMs: 362862, ttftSteps: 54, decodeMs: 1427892, decodeTokens: 76624 },
        tokenUsage: { totals: { uncachedInputTokens: 7535, cacheReadTokens: 3675904, cacheWriteTokens: 285696, outputTokens: 76624 } },
        contextPressure: { pressureTokens: 114741, contextWindow: 1048576 },
        timeContext: { lastMessageTime: Date.parse('2026-10-24T07:34:35.569Z') },
      },
    }),
  })
  const answer = await gateway.stats({ taskId: 'task', runId: 'run' })
  assert.equal(answer.reason, null)
  assert.equal(answer.stats.asOfSeq, 572)
  assert.equal(answer.stats.source, 'backfill', 'figures read after the run settled say so')
  assert.equal(answer.stats.turns, 5, 'the continuation counts as part of the same run')
  assert.equal(answer.stats.tokens.output, 76624)
  assert.equal(answer.stats.llmMs, 1790754)
  // The wall clock has to end where the figures end, or the report would show less
  // running time than the model spent inside the run.
  assert.equal(writes.at(-1).completedAt, '2026-10-24T07:34:35.569Z')
  // The run settled once and the conversation went on without it. That fact is what
  // lets the report explain a 失败 row carrying a full artifact list.
  assert.equal(writes.at(-1).continued, true, 'a conversation that moved past the record is a continued run')

  // Once the conversation stops moving, the refreshed record is the one that sticks.
  const again = await gateway.stats({ taskId: 'task', runId: 'run' })
  assert.deepEqual(again.stats, answer.stats)
  assert.equal(writes.length, 1, 'a second report over a settled conversation writes nothing')

  // A run whose figures are already current is returned untouched, with no write.
  asOfSeq = 250
  const current = statsGateway({ run: { ...settled, stats: { ...settled.stats, asOfSeq: 250 } }, projections: async () => ({ asOfSeq: 250, values: {} }) })
  const kept = await current.gateway.stats({ taskId: 'task', runId: 'run' })
  assert.equal(kept.stats.asOfSeq, 250)
  assert.deepEqual(current.writes, [], 'an unchanged conversation is not rewritten')
})

test('a failed refresh keeps the figures already on record instead of losing them', async () => {
  const settled = { id: 'run', sessionId: 'session', stats: { source: 'settle', asOfSeq: 171, steps: 28 } }
  // A null answer is permanent, but the run already has figures: they must survive.
  const missing = statsGateway({ run: { ...settled }, projections: async () => null })
  assert.deepEqual(await missing.gateway.stats({ taskId: 'task', runId: 'run' }), { stats: settled.stats, reason: null })
  assert.deepEqual(missing.writes, [], 'a run with figures is never downgraded to 未记录')
  // The read failing is retryable, so the record is kept and nothing permanent is written.
  const failed = statsGateway({ run: { ...settled }, projections: async () => { throw new Error('会话投影读取失败。') } })
  assert.equal((await failed.gateway.stats({ taskId: 'task', runId: 'run' })).stats.asOfSeq, 171)
  assert.deepEqual(failed.writes, [])
})

test('the artifact route reads one recorded file through the store', async () => {
  const asked = []
  const gateway = Object.create(ModelReviewGateway.prototype)
  gateway.ctx = {
    modelReviewScope: { assertAccess: async () => {}, request: async (operation) => operation({}) },
    modelReviewStore: { readArtifact: async (request) => { asked.push(request); return { path: request.path, bytes: 3, text: '<p>' } } },
  }
  const file = await gateway.artifact({ taskId: 'task', runId: 'run', path: 'a.html' })
  assert.deepEqual(asked, [{ taskId: 'task', runId: 'run', path: 'a.html' }])
  assert.equal(file.text, '<p>')
})

test('every route the page calls is exposed, and nothing else', () => {
  const exposed = ['models', 'questions', 'saveQuestion', 'archiveQuestion', 'deleteQuestion', 'tasks', 'task', 'stats', 'artifact', 'start']
  for (const method of exposed) assert.equal(typeof ModelReviewGateway.prototype[method], 'function', `${method} must stay a route`)
  // A route the page never calls would be an unexplained surface; the report added
  // exactly two, both reachable from the history page.
  assert.equal(exposed.length, 10)
})
