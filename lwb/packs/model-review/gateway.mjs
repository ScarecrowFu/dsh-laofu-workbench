import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { executionFrame } from './execution.mjs'
import { RETRYABLE_STATS_REASONS, RUN_STATS_KEYS, normalizeRunStats } from './model-review-store.mjs'

const initializers = []
function expose(prototype, method, name = method) {
  Remote(name)(prototype[method], { kind: 'method', name, static: false, private: false, addInitializer(initializer) { initializers.push(initializer) } })
}

async function currentSnapshot(frames) {
  for await (const frame of frames) {
    if (frame.type === 'snapshot') return frame
    throw new Error('会话未返回初始快照。')
  }
  throw new Error('会话快照不可用。')
}

/**
 * Read the host's projection values for one pack-owned session.
 *
 * The seam is absent on hosts older than the figures it provides, and the read
 * itself can fail because the Session was disposed or the observation aborted.
 * None of those paths throws: a report without numbers is recoverable, a run that
 * never settles is not. Each one does name itself, because the reader's next move
 * differs — "restart the host" and "this is gone for good" must not look alike.
 * @param scope - the pack scope.
 * @param sessionId - the run's DSH session id, when it got one.
 * @returns `{ asOfSeq, values }`, or `{ reason }` when the figures are unavailable.
 */
async function readRunProjections(scope, sessionId) {
  if (typeof sessionId !== 'string' || !sessionId) return { reason: 'no-session' }
  const read = scope?.sessions?.projections
  if (typeof read !== 'function') return { reason: 'unsupported' }
  try {
    const baseline = await read(sessionId, [...RUN_STATS_KEYS])
    if (!baseline) return { reason: 'missing' }
    return { asOfSeq: baseline.asOfSeq, values: baseline.values }
  } catch { return { reason: 'failed' } }
}

/**
 * What one run should record about its figures: the numbers, or the reason there
 * are none, plus whether that reason is worth writing down.
 *
 * A retryable reason is reported but not persisted — "this host cannot read
 * projections" stops being true the moment the host restarts, and storing it would
 * turn a temporary condition into a permanent verdict about the run.
 * @param record - the result of {@link readRunProjections}.
 * @param source - `settle` when captured as the run ended, `backfill` when read later.
 * @returns `{ stats, reason, persist }`.
 */
function statsOutcome(record, source) {
  const stats = record?.values ? normalizeRunStats(record.values, record.asOfSeq, source) : null
  if (stats) return { stats, reason: null, persist: true }
  const reason = record?.values ? 'empty' : record?.reason || 'empty'
  return { stats: null, reason, persist: !RETRYABLE_STATS_REASONS.includes(reason) }
}

/** The run fields one outcome contributes, so both call sites write the same shape. */
function statsFields(outcome) {
  if (outcome.stats) return { stats: outcome.stats }
  return outcome.persist ? { statsUnavailable: outcome.reason } : {}
}

/**
 * How the run's last turn ended, read from the conversation's own log.
 *
 * A run can produce an answer and still have failed: a `429 engine overloaded`
 * ends the turn after the model has already written something, and the pack's
 * "did we get text?" check then marks the run 已完成 even though the attempt was
 * cut off mid-task. That is a false success — the report reads it as a working
 * model that simply produced little, and a later decision about which model is
 * better rests on it. The turn's own finish reason is the only honest signal, and
 * it is the one the projection rows do not carry, so it is read from the snapshot
 * taken here.
 *
 * `completed` is a clean stop. Anything else — `error`, `cancelled`, `aborted`,
 * `length` — means the attempt did not finish its work, and the run must not be
 * reported as 已完成. A snapshot with no `turn/end` at all settles as `pending`:
 * the turn never closed, which is also not a success.
 * @param frame - the run's follow snapshot.
 * @returns `{ kind, message }` — `kind` is `completed`, `cancelled` or `failed`.
 */
function turnFinish(frame) {
  const records = (frame?.records || []).map((item) => item?.event).filter(Boolean)
  const ends = records.filter((event) => event.type === 'turn/end')
  if (!ends.length) return { kind: 'failed', message: '会话结束时没有记录回合结果。' }
  const end = ends.at(-1)
  const raw = end.data?.reason
  const kind = raw?.kind || (typeof raw === 'string' ? raw : null)
  if (kind === 'completed' || kind === 'stop') return { kind: 'completed', message: null }
  if (kind === 'cancelled' || kind === 'aborted') return { kind: 'cancelled', message: '模型回复被中断。' }
  if (kind === 'max-tokens' || kind === 'length') return { kind: 'failed', message: '模型输出达到上限被截断。' }
  const failure = raw?.error || raw?.failure
  const detail = failure?.message ? String(failure.message) : (kind ? `回合以 ${kind} 结束。` : '回合未正常结束。')
  return { kind: 'failed', message: detail.slice(0, 300) }
}

export class ModelReviewGateway extends TypertRemoteService {
  static inject = ['modelReviewScope', 'modelReviewStore']
  constructor(ctx) { super(ctx, 'modelReview'); for (const initializer of initializers) initializer.call(this) }
  async guard() { return this.ctx.modelReviewScope.assertAccess() }
  async within(operation) {
    await this.guard()
    return this.ctx.modelReviewScope.request(operation)
  }
  models() { return this.within(() => this.ctx.modelReviewScope.models.list()) }
  questions(request) { return this.within(() => this.ctx.modelReviewStore.listQuestions(request)) }
  saveQuestion(request) { return this.within(() => this.ctx.modelReviewStore.saveQuestion(request)) }
  archiveQuestion(request) { return this.within(() => this.ctx.modelReviewStore.archiveQuestion(request)) }
  deleteQuestion(request) { return this.within(() => this.ctx.modelReviewStore.deleteQuestion(request)) }
  tasks() { return this.within(() => this.ctx.modelReviewStore.listTasks()) }
  task(request) { return this.within(() => this.ctx.modelReviewStore.task(request.id)) }
  /**
   * The figures the report shows for one run, or the reason there are none.
   *
   * The figures are a fold of the conversation's own log, so they are only final
   * once the conversation is. A first attempt that ends on a provider error —
   * `429 engine overloaded` is the common one — settles the run, but its card can
   * still be continued afterwards (the user sends 「请继续」, or the host injects a
   * notice). Those later turns are part of what the run cost, so they belong in the
   * same total. The stored `asOfSeq` is the log position the figures were read at:
   * when the host's projections have moved past it, this reads them again and
   * rewrites the record, moving `completedAt` with them so the run's wall clock ends
   * where its figures now end instead of reporting less time than the model spent.
   *
   * A run whose figures are already current returns the stored record untouched, so
   * opening a report repeatedly never drifts. A permanent reason (`no-session`,
   * `missing`) is never read again; a retryable one is, so restarting the host fills
   * the numbers in on the next report. If the host cannot answer now but figures are
   * already on record, the record is kept — a refresh must not lose what it had.
   * @param request - `{ taskId, runId }`.
   * @returns `{ stats, reason }` — exactly one of the two is set.
   */
  async stats(request) {
    return this.within(async () => {
      const task = await this.ctx.modelReviewStore.task(request?.taskId)
      const run = task.runs.find((item) => item.id === request?.runId)
      if (!run) throw new Error('测评运行不存在。')
      const stored = run.stats || null
      // A verdict that cannot change is final: do not ask the host on every open.
      if (run.statsUnavailable) return { stats: null, reason: run.statsUnavailable }
      const record = await readRunProjections(this.ctx.modelReviewScope, run.sessionId)
      if (!record.values) {
        if (stored) return { stats: stored, reason: null }
        const reason = record.reason || 'empty'
        if (!RETRYABLE_STATS_REASONS.includes(reason)) await this.ctx.modelReviewStore.updateRun(task.id, run.id, { statsUnavailable: reason })
        return { stats: null, reason }
      }
      const comparable = Number.isSafeInteger(stored?.asOfSeq) && Number.isSafeInteger(record.asOfSeq)
      // The conversation has not moved past the record, so there is nothing to re-read.
      if (comparable && record.asOfSeq <= stored.asOfSeq) return { stats: stored, reason: null }
      const outcome = statsOutcome(record, 'backfill')
      const fields = statsFields(outcome)
      const endedAt = outcome.stats?.lastActivityAt ? new Date(outcome.stats.lastActivityAt).getTime() : Number.NaN
      const previousEnd = run.completedAt ? new Date(run.completedAt).getTime() : 0
      if (Number.isFinite(endedAt) && endedAt > previousEnd) fields.completedAt = outcome.stats.lastActivityAt
      // A record the conversation has demonstrably moved past means someone picked the
      // run back up after it settled — a card continued by hand, usually because the
      // first attempt died on a 429. That matters twice over: the figures now span more
      // than the pack's own attempt, and a run the pack recorded as failed may have
      // ended with a real result. Record the fact so the report can say so, instead of
      // showing a failure beside a full artifact list and a full token count unexplained.
      // Only a real advance counts: an old run that simply never had figures is not a
      // continued one, and an uncomparable pair cannot be claimed either way.
      if (comparable && record.asOfSeq > stored.asOfSeq && !run.continued) fields.continued = true
      if (Object.keys(fields).length) await this.ctx.modelReviewStore.updateRun(task.id, run.id, fields)
      return { stats: outcome.stats, reason: outcome.reason }
    })
  }
  /** One artifact's text, for a report that inlines what the run produced. */
  artifact(request) { return this.within(() => this.ctx.modelReviewStore.readArtifact(request)) }
  async start(request) {
    await this.guard()
    return this.ctx.modelReviewScope.request(async (context) => {
      const questions = await this.ctx.modelReviewStore.listQuestions()
      const question = questions.find((item) => item.id === request?.questionId)
      if (!question || question.status !== 'active') throw new Error('请选择一个有效的文本题目。')
      if (!Array.isArray(request?.models) || request.models.length < 1) throw new Error('一次测评必须至少选择一个模型。')
      const models = request.models.map((item) => ({ provider: String(item.provider || '').trim(), model: String(item.model || '').trim(), displayName: String(item.displayName || item.model || '').trim(), ...(item.reasoningEffort ? { reasoningEffort: item.reasoningEffort } : {}) }))
      if (models.some((item) => !item.provider || !item.model)) throw new Error('模型选择无效。')
      const catalog = await this.ctx.modelReviewScope.models.list()
      const seen = new Set()
      for (const model of models) {
        const key = `${model.provider}:${model.model}`
        if (seen.has(key)) throw new Error('同一个模型路由不能重复选择。')
        seen.add(key)
        const route = catalog.find((item) => item.id === model.provider)
        if (!route?.models?.some((item) => item.id === model.model)) throw new Error('所选模型已不在可用模型列表中，请刷新后重试。')
        if (route.selectable === false) throw new Error(route.unavailableReason || '所选模型路由尚不可用，请刷新后重试。')
      }
      const task = await this.ctx.modelReviewStore.createTask({ question, models })
      for (const run of task.runs) this.ctx.modelReviewScope.background(this.launchRun(context, task.id, run, question.prompt))
      return task
    })
  }
  async launchRun(context, taskId, run, prompt) {
    let session = null
    const completedAt = () => new Date().toISOString()
    // Artifacts are read from the run's own directory at settle time and again
    // after a failure: a run that stopped halfway still shows what it wrote.
    const artifacts = async () => this.ctx.modelReviewStore.collectArtifacts(taskId, run.id).catch(() => [])
    // What the conversation actually did, read before the Session is disposed. A
    // failed run records this too: its step count and token spend are exactly the
    // facts that explain the failure, and they would be lost with the Session.
    const stats = async () => statsOutcome(await readRunProjections(this.ctx.modelReviewScope, session?.id), 'settle')
    try {
      session = await this.ctx.modelReviewScope.sessions.create({ ...run.model, cwd: run.cwd })
      await this.ctx.modelReviewStore.updateRun(taskId, run.id, { status: 'running', sessionId: session.id })
      await session.followup(prompt)
      await session.whenIdle()
      const page = await currentSnapshot(session.follow({ maxMessages: 500 }))
      const answer = executionFrame(page)
      const finalAnswer = answer.records?.filter((item) => item.event?.type === 'assistant/message').at(-1)?.event?.data || null
      if (!finalAnswer) throw new Error('本次会话未生成模型回答，请查看执行过程。')
      // An answer is not the same as a finished job: a turn cut short by a provider
      // error still leaves text behind. Only the turn's own finish reason says the
      // work was actually done, so a partial attempt is recorded as failed with what
      // it did produce — never as 已完成.
      const finish = turnFinish(page)
      const recorded = await stats()
      const fields = { sessionId: session.id, answer: finalAnswer, artifacts: await artifacts(), ...statsFields(recorded), completedAt: completedAt() }
      if (finish.kind === 'completed') await this.ctx.modelReviewStore.updateRun(taskId, run.id, { status: 'succeeded', ...fields })
      else await this.ctx.modelReviewStore.updateRun(taskId, run.id, { status: finish.kind === 'cancelled' ? 'cancelled' : 'failed', ...fields, error: finish.message })
    } catch (error) {
      const recorded = await stats()
      await this.ctx.modelReviewStore.updateRun(taskId, run.id, { status: 'failed', ...(session ? { sessionId: session.id } : {}), error: error instanceof Error ? error.message : String(error), artifacts: await artifacts(), ...statsFields(recorded), completedAt: completedAt() })
    } finally {
      if (session) await session.dispose().catch(() => {})
    }
  }
}

// The exported surface is exactly what the page uses. A run's stored artifact
// list is a record read through `task()`; re-reading a run's files stays a store
// capability (model-review-store.mjs) without a page-facing route — except
// `artifact()`, which the report builder needs in order to inline one.
for (const method of ['models', 'questions', 'saveQuestion', 'archiveQuestion', 'deleteQuestion', 'tasks', 'task', 'stats', 'artifact', 'start']) expose(ModelReviewGateway.prototype, method)

export default ModelReviewGateway
