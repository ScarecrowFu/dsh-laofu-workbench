import { createUserMessage } from '@deepseek-ai/dsh-llm'

/**
 * The pack-facing execution adapter.
 *
 * LWB packs never call DSH services directly. This module is the one place that
 * knows how a DSH release spells its execution seams:
 *
 * - A structured one-shot generation uses the `subagents` service. DSH 0.2.1
 *   replaced `start(name, request)` with `startActivation(spec)`, so both shapes
 *   are normalized here instead of leaking into every capability pack.
 * - A multi-turn agentic generation (the video director) runs on a dedicated
 *   LWB-owned root Agent. It needs `followup` / `whenIdle` and same-session
 *   repair turns; the 0.2.1 local Activation settles and disposes its child as
 *   soon as the first turn goes idle, so using it for repairs would be a race.
 *
 * `assertDshExecution` is the fail-fast entry point: a pack refuses to load on
 * an unsupported DSH instead of failing later with a misleading message.
 *
 * Official migration reference (DSH upgrade-guide v0.2.1-alpha.1):
 * `subagent-activations` replaces start/startContinuable with startActivation
 * and a required delivery; `subagent-preset-composition` removes persona and
 * toolFilter from the start request.
 */

const MAX_REPAIRS = 2

function patchName(agent) {
  return typeof agent?.id === 'string' ? agent.id : null
}

function routeOf(agent) {
  const provider = agent?.options?.provider
  const model = agent?.options?.model
  if (typeof provider !== 'string' || !provider.trim()) return undefined
  if (typeof model !== 'string' || !model.trim()) return undefined
  return {
    provider: provider.trim(),
    model: model.trim(),
    ...(agent.options.reasoningEffort === undefined ? {} : { reasoningEffort: agent.options.reasoningEffort }),
  }
}

function subagentMode(subagents) {
  if (subagents && typeof subagents.startActivation === 'function') return 'activation'
  if (subagents && typeof subagents.start === 'function') return 'legacy'
  return null
}

function availableMethods(value) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return '服务不可用'
  const names = new Set()
  for (let current = value; current && current !== Object.prototype; current = Object.getPrototypeOf(current)) {
    for (const name of Object.getOwnPropertyNames(current)) {
      if (name !== 'constructor' && name !== '__proto__') names.add(name)
    }
  }
  return names.size ? [...names].slice(0, 24).join(', ') : '没有可枚举方法'
}

function liveAgent(ctx, sessionId) {
  try {
    const registry = typeof ctx.get === 'function' ? ctx.get('agents') : undefined
    return registry?.get?.(sessionId)
  } catch { return undefined }
}

function endReason(end) {
  return end?.data?.reason?.kind ?? 'unknown'
}

function capturedTurnEnd(captured, boundary) {
  return captured.ends.findLast(event => event.seq >= boundary) ?? null
}

async function waitForCapturedTurnEnd(captured, boundary, signal) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    signal.throwIfAborted()
    const end = capturedTurnEnd(captured, boundary)
    if (end) return end
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  return null
}

/**
 * Refuse an unsupported DSH before a pack starts serving requests.
 *
 * @param ctx - the pack's Cordis context.
 * @param subagents - the injected `subagents` service handle.
 * @param packId - capability pack id used for the LWB service scope.
 */
export function assertDshExecution(ctx, subagents, packId) {
  const scope = ctx.lwbPackServices?.forPack?.(packId)
  if (!scope || typeof scope.withAgent !== 'function') {
    throw new Error('LWB 能力包执行适配层缺少 withAgent 会话接缝，无法启动生成任务。')
  }
  if (typeof ctx.on !== 'function') {
    throw new Error('LWB 能力包执行适配层缺少 session/event 事件接缝，无法记录生成过程。')
  }
  if (subagentMode(subagents) === null) {
    throw new Error(
      '当前 DSH 的 subagents 服务既没有 startActivation 也没有 start，LWB 适配层尚未支持该版本'
      + `（可用方法：${availableMethods(subagents)}）。请先运行 npm run upstream:check 并更新 lwb/pack-sdk/dsh-execution.mjs。`,
    )
  }
}

/**
 * Create one pack executor.
 *
 * @param ctx - the pack's Cordis context.
 * @param subagents - the injected `subagents` service handle.
 * @param packId - capability pack id.
 * @param label - child label retained in the DSH catalog.
 * @param structured - whether the child must return a schema-constrained value.
 * @param options - max-token continuation budget and its prompt builder.
 * @returns an executor accepting prompt, schema, agent and trace hooks.
 */
export function createDshExecutor(ctx, subagents, packId, label, structured, { maxTokenContinuations = 0, continuationPrompt } = {}) {
  return async function dshExecutor(input) {
    const { agent: sourceAgent } = input
    const scope = ctx.lwbPackServices.forPack(packId)
    const runSignal = scope.signal

    if (structured) {
      if (sourceAgent?.workspacePath) {
        return scope.withAgent(parent => runStructured({
          ctx, subagents, packId, label, ...input, agent: parent, traceParent: parent, runSignal,
        }), runSignal)
      }
      return runStructured({
        ctx, subagents, packId, label, ...input, traceParent: sourceAgent, runSignal,
      })
    }

    // A multi-turn generation always gets a dedicated LWB root: the caller's
    // Agent may be a shared round root, and its conversation must not collect
    // the director's turns. The route is preserved when the caller has one.
    const route = routeOf(sourceAgent)
    return scope.withAgent(
      root => runAgentic({
        ctx, packId, ...input, agent: root, traceParent: sourceAgent, runSignal,
        maxTokenContinuations, continuationPrompt,
      }),
      runSignal,
      route ? { agentOptions: route } : {},
    )
  }
}

async function runStructured({ ctx, subagents, packId, label, prompt, schema, agent, traceParent, runSignal, onDshStarted, onDshEvent }) {
  const mode = subagentMode(subagents)
  const options = routeOf(agent)
  const request = {
    prompt: [{ type: 'text', text: prompt }],
    parent: agent,
    ...(options === undefined ? {} : { agentOptions: options }),
    outputSchema: schema,
  }
  let childSessionId = null
  let activation = null
  let localAgent
  let dispose = async () => {}
  let traceTail = Promise.resolve()
  const recordEvent = (event) => {
    if (typeof onDshEvent !== 'function') return
    traceTail = traceTail.then(() => Promise.resolve(onDshEvent(event)).catch(() => {}))
  }
  const observeEvent = (session, event) => {
    if (!childSessionId || session.id !== childSessionId) return
    recordEvent(event)
  }
  const disposeSessionEvent = ctx.on('session/event', observeEvent, { global: true })
  const cancelChild = () => {
    try { (localAgent ?? liveAgent(ctx, childSessionId))?.cancel?.({ kind: 'parent' }) } catch {}
    try { void activation?.dispose?.().catch(() => {}) } catch {}
  }
  runSignal.addEventListener('abort', cancelChild, { once: true })
  try {
    if (mode === 'activation') {
      activation = await subagents.startActivation({
        provider: 'spawn',
        label,
        request,
        signal: runSignal,
        // The caller collects the result; no completion notice is injected into
        // the (possibly shared) parent conversation.
        delivery: 'caller',
      })
      childSessionId = activation.childId
      dispose = () => activation.dispose()
    } else {
      // DSH 0.1.x shape, kept while the upgrade gate still accepts it.
      const run = await subagents.start('spawn', { ...request, label, signal: runSignal })
      childSessionId = run.id
      localAgent = run.localAgent
      activation = { result: run.result }
      dispose = () => run.dispose()
    }
    if (typeof onDshStarted === 'function') {
      await Promise.resolve(onDshStarted({
        childSessionId: String(childSessionId),
        parentSessionId: patchName(traceParent),
      })).catch(() => {})
    }
    // The global session/event listener is installed before publication, so it
    // observes the child's first turn without reading Session history. DSH 0.2.1
    // no longer exposes a `Session.events` array.
    const result = await activation.result
    await traceTail
    if (result.stopReason !== 'completed') {
      const detail = result.diagnostic ? `：${result.diagnostic}` : ''
      throw new Error(`生成未正常结束（${result.stopReason}）${detail}`)
    }
    return result.structured
  } finally {
    runSignal.removeEventListener('abort', cancelChild)
    await traceTail
    disposeSessionEvent()
    await dispose().catch(() => {})
  }
}

async function runAgentic({ ctx, packId, prompt, agent, traceParent, runSignal, maxTokenContinuations = 0, continuationPrompt, onDshStarted, onDshEvent, onDshContinuation, validate, repairPrompt, onDshRepair, maxRepairs = MAX_REPAIRS }) {
  const childSessionId = agent.id
  const maximum = Math.max(0, Math.min(2, Number.isSafeInteger(maxRepairs) ? maxRepairs : MAX_REPAIRS))
  let traceTail = Promise.resolve()
  const recordEvent = (event) => {
    if (typeof onDshEvent !== 'function') return
    traceTail = traceTail.then(() => Promise.resolve(onDshEvent(event)).catch(() => {}))
  }
  const captured = { ends: [], assistant: [] }
  const observeEvent = (session, event) => {
    if (session.id !== childSessionId) return
    recordEvent(event)
    if (event?.type === 'turn/end') {
      captured.ends.push(event)
      if (captured.ends.length > 32) captured.ends.splice(0, captured.ends.length - 32)
    } else if (event?.type === 'assistant/message') {
      captured.assistant.push(event.data?.message?.content ?? [])
      if (captured.assistant.length > 8) captured.assistant.shift()
    }
  }
  const disposeSessionEvent = ctx.on('session/event', observeEvent, { global: true })
  const cancelChild = () => { try { agent.cancel?.({ kind: 'parent' }) } catch {} }
  runSignal.addEventListener('abort', cancelChild, { once: true })
  try {
    if (typeof onDshStarted === 'function') {
      await Promise.resolve(onDshStarted({
        childSessionId: String(childSessionId),
        parentSessionId: patchName(traceParent),
      })).catch(() => {})
    }
    const firstTurn = await runTurns({
      agent, prompt, runSignal, packId, maxTokenContinuations, continuationPrompt,
      childSessionId, onDshContinuation, captured,
    })
    if (firstTurn.reason !== 'completed') {
      if (firstTurn.reason === 'max-tokens' && maxTokenContinuations > 0) {
        throw new Error(`视频 Agent 连续 ${firstTurn.continuations + 1} 个创作轮次达到单次输出上限，未能完成可渲染工程。`)
      }
      throw new Error(`生成未正常结束（${firstTurn.reason}）`)
    }
    if (typeof validate === 'function') {
      for (let attempt = 0; ; attempt += 1) {
        runSignal.throwIfAborted()
        const report = await validate() || { passed: true }
        runSignal.throwIfAborted()
        if (report.passed || report.repairable !== true || attempt >= maximum) break
        if (typeof repairPrompt !== 'function') break
        await onDshRepair?.({
          attempt: attempt + 1, maximum,
          failures: report.failures, childSessionId: String(childSessionId),
        })
        runSignal.throwIfAborted()
        const { reason } = await runTurns({
          agent,
          prompt: repairPrompt({ report, attempt: attempt + 1, maximum }),
          runSignal, packId, maxTokenContinuations, continuationPrompt,
          childSessionId, onDshContinuation, captured,
        })
        if (reason !== 'completed') throw new Error(`视频修复未正常结束（${reason || 'unknown'}）`)
      }
    }
    await traceTail
    const output = captured.assistant.at(-1) ?? []
    return { childSessionId: String(childSessionId), output }
  } finally {
    runSignal.removeEventListener('abort', cancelChild)
    await traceTail
    disposeSessionEvent()
  }
}

async function runTurns({ agent, prompt, runSignal, packId, maxTokenContinuations, continuationPrompt, childSessionId, onDshContinuation, captured }) {
  // DSH 0.2.1 removed the public `Session.events` array. `session.seq` is the
  // next event position, and the run's session/event listener captures the
  // turn/end and assistant/message records as they are published.
  let boundary = agent.session.seq
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: prompt }],
    source: { kind: 'plugin', plugin: packId },
  }))
  let continuations = 0
  while (true) {
    await agent.whenIdle()
    runSignal.throwIfAborted()
    const end = await waitForCapturedTurnEnd(captured, boundary, runSignal)
    if (!end) throw new Error('模型会话没有产生 turn/end 事件，无法判断生成是否完成。')
    const reason = endReason(end)
    if (reason === 'max-tokens' && continuations < maxTokenContinuations && typeof continuationPrompt === 'function') {
      continuations += 1
      await onDshContinuation?.({
        childSessionId: String(childSessionId),
        attempt: continuations,
        maximum: maxTokenContinuations,
      })
      runSignal.throwIfAborted()
      boundary = agent.session.seq
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: continuationPrompt({ attempt: continuations, maximum: maxTokenContinuations }) }],
        source: { kind: 'plugin', plugin: packId },
      }))
      continue
    }
    return { end, reason, continuations }
  }
}
