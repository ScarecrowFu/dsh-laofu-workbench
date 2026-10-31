import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { DEFAULT_MODEL_REVIEW_QUESTIONS } from './default-questions.mjs'

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u
/** One run directory is scanned this deep and this wide; artifacts are a result, not a filesystem mirror. */
const ARTIFACT_DEPTH = 8
const ARTIFACT_LIMIT = 200
/**
 * One artifact may be read into a report at most this large. The biggest real
 * artifact seen in practice is a 1.3 MB single-file HTML with Three.js inlined,
 * so this leaves headroom while refusing to pull a 30 MB verification screenshot
 * into a report that is supposed to stay mailable.
 */
export const ARTIFACT_READ_LIMIT = 4 * 1024 * 1024
/**
 * The projection keys a report needs from the host; everything else stays unread.
 *
 * `timeContext` is read for exactly one field: the time of the conversation's last
 * message. A session continued after its run settled has grown past that run's own
 * `completedAt`, and the report's wall clock has to end where the figures now end —
 * otherwise a refreshed run would show more model time than it spent running.
 */
export const RUN_STATS_KEYS = Object.freeze(['sessionStats', 'tokenUsage', 'contextPressure', 'timeContext'])
/**
 * Why a run has no figures.
 *
 * These are told apart because the reader's next move differs: `unsupported` is
 * fixed by restarting or upgrading the host, `missing` and `no-session` can only be
 * recovered by running the evaluation again, and `empty` means there was nothing to
 * read. A report that prints one "未记录" for all of them tells the reader nothing.
 */
export const RUN_STATS_REASONS = Object.freeze(['no-session', 'unsupported', 'missing', 'empty', 'failed'])
/** The reasons a later read could still succeed at, so they are never written down. */
export const RETRYABLE_STATS_REASONS = Object.freeze(['unsupported', 'failed', 'empty'])
/**
 * The prompts the store seeds on first run.
 *
 * Deleting one of these must stick: seeding is "add what is missing", so without
 * a tombstone every restart would hand the user back the question they removed.
 * Only built-in ids are remembered — a deleted question the user wrote can never
 * be re-added by the seeder, so remembering it would be state with no reader.
 */
const SEEDED_IDS = new Set(DEFAULT_MODEL_REVIEW_QUESTIONS.map((item) => item.id))

function fail(message) { throw new Error(message) }
function clean(value, label, max = 200) {
  if (typeof value !== 'string') fail(`${label}必须是文本。`)
  const text = value.trim()
  if (!text || text.length > max) fail(`${label}不能为空且不能超过${max}个字符。`)
  return text
}
function optional(value, label, max) { return value === undefined || value === null || value === '' ? '' : clean(value, label, max) }
async function json(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch (error) { if (error.code === 'ENOENT') return fallback; throw error }
}
async function save(path, value) {
  await mkdir(join(path, '..'), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, path)
}
function validTaskId(value) { if (typeof value !== 'string' || !ID.test(value)) fail('任务标识无效。'); return value }
function validRunId(value) { if (typeof value !== 'string' || !ID.test(value)) fail('测评运行标识无效。'); return value }

/**
 * List the files one run produced, relative to its own directory.
 *
 * Only regular files are reported: a symlink is not an artifact, and following
 * one could leave the run directory. The walk is bounded in both depth and
 * count so a runaway run cannot turn a history read into a filesystem crawl.
 * @param root - the run's absolute directory.
 * @param relative - directory being listed, `/`-separated and empty at the root.
 * @param depth - current depth, 1 at the run root.
 * @param out - collector, appended in path order.
 * @returns completion.
 */
async function walkArtifacts(root, relative, depth, out) {
  let entries
  try { entries = await readdir(join(root, relative), { withFileTypes: true }) } catch (error) { if (error.code === 'ENOENT') return; throw error }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (out.length >= ARTIFACT_LIMIT) return
    const path = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (depth < ARTIFACT_DEPTH) await walkArtifacts(root, path, depth + 1, out)
      continue
    }
    if (!entry.isFile()) continue
    const info = await stat(join(root, path)).catch(() => null)
    out.push({ path, bytes: info?.size ?? null, updatedAt: (info?.mtime ?? new Date()).toISOString() })
  }
}

export class ModelReviewStore {
  constructor(workspacePath) {
    this.workspacePath = workspacePath
    this.root = join(workspacePath, 'data')
    this.runsRoot = join(workspacePath, 'runs')
    this.questionsPath = join(this.root, 'question-bank.json')
    this.tasksPath = join(this.root, 'evaluations.json')
    this.taskWrite = Promise.resolve()
  }
  async withTaskWrite(operation) {
    const previous = this.taskWrite
    let release
    this.taskWrite = new Promise((resolve) => { release = resolve })
    await previous
    try { return await operation() } finally { release() }
  }
  async init() {
    await mkdir(join(this.root, 'evaluations'), { recursive: true, mode: 0o700 })
    await mkdir(this.runsRoot, { recursive: true, mode: 0o700 })
    await this.seedDefaultQuestions()
    const tasks = await this.tasks()
    let changed = false
    for (const task of tasks) {
      // Runs recorded before per-run directories shared one workspace root, so
      // their files cannot be attributed to a model any more. Say so instead of
      // guessing: the history view reads this flag.
      if (task.artifactsUnavailable !== true && task.runs?.some((run) => !run.cwd)) {
        task.artifactsUnavailable = true
        changed = true
      }
      if (!['queued', 'running'].includes(task.status) && !task.runs?.some((run) => ['queued', 'running'].includes(run.status))) continue
      const now = new Date().toISOString()
      for (const run of task.runs) {
        if (['queued', 'running'].includes(run.status)) Object.assign(run, { status: 'failed', error: '工作台重启时任务尚未完成。', completedAt: now, updatedAt: now })
      }
      task.status = 'failed'; task.updatedAt = now
      await save(join(this.root, 'evaluations', task.id, 'task.json'), task)
      changed = true
    }
    if (changed) await save(this.tasksPath, { schemaVersion: 1, tasks })
    return this
  }
  async seedDefaultQuestions() {
    const bank = await this.bank()
    const list = bank.questions || []
    const removed = new Set(bank.deletedIds || [])
    const existingIds = new Set(list.map((item) => item.id))
    const missing = DEFAULT_MODEL_REVIEW_QUESTIONS.filter((item) => !existingIds.has(item.id) && !removed.has(item.id))
    if (!missing.length) return false
    const now = new Date().toISOString()
    const seeded = missing.map((item) => ({ ...structuredClone(item), version: 1, status: 'active', createdAt: now, updatedAt: now }))
    await save(this.questionsPath, { schemaVersion: 1, questions: [...list, ...seeded], deletedIds: [...removed] })
    return true
  }
  /** The whole question-bank file: the questions plus the built-ins the user removed. */
  async bank() {
    const file = await json(this.questionsPath, { schemaVersion: 1, questions: [], deletedIds: [] })
    return { questions: Array.isArray(file.questions) ? file.questions : [], deletedIds: Array.isArray(file.deletedIds) ? file.deletedIds : [] }
  }
  async questions() { return (await this.bank()).questions }
  async listQuestions(request = {}) {
    const query = typeof request.query === 'string' ? request.query.trim().toLowerCase() : ''
    return (await this.questions()).filter((item) => !query || [item.title, item.prompt, ...(item.tags || [])].join(' ').toLowerCase().includes(query)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
  async saveQuestion(request = {}) {
    const now = new Date().toISOString(); const bank = await this.bank(); const list = bank.questions;
    const id = typeof request.id === 'string' && ID.test(request.id) ? request.id : randomUUID()
    const old = list.find((item) => item.id === id)
    const question = { id, title: clean(request.title, '题目标题', 120), category: optional(request.category, '分类', 60), tags: Array.isArray(request.tags) ? request.tags.map((tag) => clean(tag, '标签', 30)).slice(0, 10) : [], prompt: clean(request.prompt, '提示词', 20000), description: optional(request.description, '说明', 500), version: (old?.version || 0) + 1, status: request.status === 'archived' ? 'archived' : 'active', createdAt: old?.createdAt || now, updatedAt: now }
    // Saving an id retires its tombstone: the question exists again, so the
    // seeder has nothing to avoid.
    await save(this.questionsPath, { schemaVersion: 1, questions: [...list.filter((item) => item.id !== id), question], deletedIds: bank.deletedIds.filter((item) => item !== id) }); return question
  }
  async archiveQuestion(request = {}) { const bank = await this.bank(); const list = bank.questions; const item = list.find((candidate) => candidate.id === request.id); if (!item) fail('题目不存在。'); item.status = 'archived'; item.updatedAt = new Date().toISOString(); await save(this.questionsPath, { schemaVersion: 1, questions: list, deletedIds: bank.deletedIds }); return item }
  /**
   * Remove a question for good.
   *
   * Tasks keep their own snapshot of the question they ran, so a deleted
   * question never invalidates history — only the bank loses it.
   */
  async deleteQuestion(request = {}) {
    const bank = await this.bank(); const list = bank.questions
    const item = list.find((candidate) => candidate.id === request.id)
    if (!item) fail('题目不存在。')
    const deletedIds = SEEDED_IDS.has(item.id) && !bank.deletedIds.includes(item.id) ? [...bank.deletedIds, item.id] : bank.deletedIds
    await save(this.questionsPath, { schemaVersion: 1, questions: list.filter((candidate) => candidate.id !== item.id), deletedIds })
    return { id: item.id }
  }
  async tasks() { return (await json(this.tasksPath, { schemaVersion: 1, tasks: [] })).tasks || [] }
  async listTasks() { return (await this.tasks()).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 100) }
  async task(id) { const item = (await this.tasks()).find((candidate) => candidate.id === id); if (!item) fail('测评任务不存在。'); return item }
  async createTask({ question, models }) {
    return this.withTaskWrite(async () => {
      const id = randomUUID(); const createdAt = new Date().toISOString();
      const task = { id, status: 'running', createdAt, updatedAt: createdAt, question: structuredClone(question), models: models.map((model) => structuredClone(model)), artifactsUnavailable: false, runs: [] }
      for (const model of models) {
        const runId = randomUUID()
        // One directory per model conversation: same prompt, same question, but
        // no run can see or overwrite another run's files.
        task.runs.push({ id: runId, status: 'queued', model: structuredClone(model), sessionId: null, cwd: this.runCwd(id, runId), answer: null, error: null, createdAt, updatedAt: createdAt, artifacts: [] })
      }
      await save(join(this.root, 'evaluations', id, 'task.json'), task)
      await save(join(this.tasksPath), { schemaVersion: 1, tasks: [task, ...(await this.tasks()).filter((item) => item.id !== id)] })
      return task
    })
  }
  async persistTask(task) {
    task.updatedAt = new Date().toISOString(); await save(join(this.root, 'evaluations', task.id, 'task.json'), task)
    const list = await this.tasks(); await save(this.tasksPath, { schemaVersion: 1, tasks: [task, ...list.filter((item) => item.id !== task.id)] }); return task
  }
  async updateTask(task) { return this.withTaskWrite(() => this.persistTask(task)) }
  async updateRun(taskId, runId, patch) {
    return this.withTaskWrite(async () => {
      const task = await this.task(taskId); const run = task.runs.find((item) => item.id === runId)
      if (!run) fail('测评运行不存在。')
      Object.assign(run, patch, { updatedAt: new Date().toISOString() })
      if (task.runs.every((item) => ['succeeded', 'failed', 'cancelled'].includes(item.status))) task.status = task.runs.some((item) => item.status === 'failed') ? 'failed' : 'succeeded'
      return this.persistTask(task)
    })
  }
  path(taskId, ...parts) { return join(this.root, 'evaluations', validTaskId(taskId), ...parts) }
  /** Absolute directory one run's conversation writes into. */
  runPath(taskId, runId) { return join(this.runsRoot, validTaskId(taskId), validRunId(runId)) }
  /** Workspace-relative form the host accepts as an internal Session cwd. */
  runCwd(taskId, runId) { validTaskId(taskId); validRunId(runId); return `runs/${taskId}/${runId}` }
  /**
   * Read one run's current file list. A run that never created anything — or
   * that failed before its Session started — reports no artifacts.
   * @param taskId - evaluation task id.
   * @param runId - run id inside that task.
   * @returns artifacts relative to the run directory, in path order.
   */
  async collectArtifacts(taskId, runId) {
    const files = []
    await walkArtifacts(this.runPath(taskId, runId), '', 1, files)
    return files
  }
  /** Re-read one run's files into the task record, for a conversation that continued after the run. */
  async refreshArtifacts(request = {}) {
    const task = await this.task(validTaskId(request.taskId))
    const run = task.runs.find((item) => item.id === request.runId)
    if (!run) fail('测评运行不存在。')
    const artifacts = await this.collectArtifacts(task.id, run.id)
    await this.updateRun(task.id, run.id, { artifacts })
    return artifacts
  }
  /**
   * Read one recorded artifact's text, for a report that has to inline it.
   *
   * Only paths the run already recorded are readable, and the resolved path must
   * stay inside the run directory, so a stale or forged path cannot pull an
   * arbitrary file into a report. Note this is a path guard, not a content filter:
   * `collectArtifacts` records every regular file the run wrote — scratch and temp
   * files included — so whatever the run left behind is still reportable.
   * @param request - `{ taskId, runId, path }`.
   * @returns `{ path, bytes, text }`.
   */
  async readArtifact(request = {}) {
    const task = await this.task(validTaskId(request.taskId))
    const run = task.runs.find((item) => item.id === request.runId)
    if (!run) fail('测评运行不存在。')
    const path = clean(request.path, '产物路径', 500)
    if (!(run.artifacts || []).some((item) => item.path === path)) fail('该文件不是这次运行的产物记录。')
    const root = this.runPath(task.id, run.id)
    const absolute = resolve(root, path)
    if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) fail('产物路径越界。')
    const info = await stat(absolute).catch(() => null)
    if (!info?.isFile()) fail('产物文件不存在。')
    if (info.size > ARTIFACT_READ_LIMIT) fail(`产物超过 ${Math.round(ARTIFACT_READ_LIMIT / 1048576)} MB，无法内联进报告。`)
    return { path, bytes: info.size, text: await readFile(absolute, 'utf8') }
  }
  /**
   * Record why one run has no figures, when that reason will never change.
   *
   * A retryable reason is deliberately not written: "this host cannot read
   * projections" stops being true the moment the host is restarted, and remembering
   * it would turn a temporary condition into a permanent verdict about the run.
   * @param taskId - evaluation task id.
   * @param runId - run id inside that task.
   * @param reason - one of `RUN_STATS_REASONS`.
   * @returns whether the reason was written down.
   */
  async recordStatsUnavailable(taskId, runId, reason) {
    if (typeof reason !== 'string' || !RUN_STATS_REASONS.includes(reason)) fail('未知的无数字原因。')
    if (RETRYABLE_STATS_REASONS.includes(reason)) return false
    await this.updateRun(validTaskId(taskId), validRunId(runId), { statsUnavailable: reason })
    return true
  }
}

/**
 * Reduce the host's projection values to the compact record a report needs.
 *
 * The host owns these figures — `sessionStats`, `tokenUsage` and
 * `contextPressure` are its folds over the session log — so this only renames
 * and bounds them. Recomputing any of them here would put a second, silently
 * different definition of "tokens per second" in the product.
 * @param values - the requested projection values, as returned by the host.
 * @param asOfSeq - session log position the values were read at.
 * @param source - `settle` when captured as the run ended, `backfill` when read later.
 * @returns the stored stats record, or null when the host reported nothing usable.
 */
export function normalizeRunStats(values, asOfSeq, source = 'settle') {
  if (!values || typeof values !== 'object') return null
  const stats = values.sessionStats
  // `tokenUsage` is the one projection whose value is not its state: the unit's
  // wire view is `state.totals`, so the buckets sit at the top level of what the
  // host hands out, while the persisted cache row holds `{ totals, last }`. Reading
  // only `.totals` therefore found nothing in production while every fixture — and
  // the cache file — looked right. Accept either shape rather than pick one.
  const usage = values.tokenUsage?.totals ?? values.tokenUsage
  const pressure = values.contextPressure
  if (!stats || !usage) return null
  const count = (value) => (Number.isFinite(value) && value >= 0 ? Math.round(value) : 0)
  // The conversation's last message time, as an ISO stamp. Absent on hosts that do
  // not register `timeContext`; the report then keeps the wall clock it already had.
  const lastMessageTime = values.timeContext?.lastMessageTime
  const lastActivityAt = Number.isFinite(lastMessageTime) && lastMessageTime > 0
    ? new Date(lastMessageTime).toISOString() : null
  return {
    source,
    capturedAt: new Date().toISOString(),
    asOfSeq: Number.isSafeInteger(asOfSeq) ? asOfSeq : null,
    lastActivityAt,
    turns: count(stats.turns),
    steps: count(stats.steps),
    llmMs: count(stats.llmMs),
    toolMs: count(stats.toolMs),
    ttftMs: count(stats.ttftMs),
    ttftSteps: count(stats.ttftSteps),
    decodeMs: count(stats.decodeMs),
    decodeTokens: count(stats.decodeTokens),
    tokens: {
      uncachedInput: count(usage.uncachedInputTokens),
      cacheRead: count(usage.cacheReadTokens),
      cacheWrite: count(usage.cacheWriteTokens),
      output: count(usage.outputTokens),
    },
    context: pressure ? { pressureTokens: count(pressure.pressureTokens), contextWindow: count(pressure.contextWindow) } : null,
  }
}

export function extractAssistantText(page) {
  const records = page?.records || []
  const messages = records.map((record) => record.event).filter((event) => event?.type === 'assistant/message')
  const last = messages.at(-1)?.data
  const content = last?.content || last?.message?.content || last?.text
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((item) => typeof item === 'string' ? item : item?.text || '').join('')
  return last ? JSON.stringify(last, null, 2) : ''
}
