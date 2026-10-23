import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { spokenVideoDataPath } from './spoken-video-paths.mjs'
import {
  DEPTH_LABEL,
  emptyScheduleFile,
  emptyStages,
  finalStep,
  missedSlot,
  parseScheduleRequest,
  reduceRunStatus,
  runView,
  SCHEDULE_FILE,
  SCHEDULE_POLL_INTERVAL_MS,
  SCHEDULE_TASK_LIMIT,
  scheduleDue,
  scheduleFile,
  scheduleView,
  scriptInputOf,
  SpokenVideoScheduleError,
  STEP_LABEL,
  STEP_TIMEOUT_MS,
  stepsForRun,
  topicInputOf,
} from './spoken-video-schedule.mjs'
const TICK_INTERVAL_MS = 30_000
const LIVE = new Set(['queued', 'running'])

function fail(code, message) { throw new SpokenVideoScheduleError(code, message) }
function invalid(message) { fail('SPOKEN_VIDEO_SCHEDULE_INVALID_INPUT', message) }
function stamp() { return new Date().toISOString() }
function elapsed(start, end) {
  const value = Date.parse(end) - Date.parse(start)
  return Number.isFinite(value) ? Math.max(0, value) : 0
}
function reasonOf(error) { return String(error?.message || error).slice(0, 500) }
function charsOf(body) { return [...String(body || '').replace(/\s+/g, '')].length }

async function workspaceFor(agent) {
  const cwd = agent?.workspacePath ?? agent?.session?.header?.cwd
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) fail('SPOKEN_VIDEO_WORKSPACE_REQUIRED', '内容安排需要已加载的能力包专属工作区。')
  try {
    const workspace = await realpath(cwd)
    const info = await lstat(workspace)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('invalid')
    return workspace
  } catch {
    fail('SPOKEN_VIDEO_WORKSPACE_REQUIRED', '能力包专属工作区不可用，请重新加载能力包后重试。')
  }
}

async function rootFor(workspace, create = true) {
  const root = spokenVideoDataPath(workspace)
  if (create) await mkdir(root, { recursive: true, mode: 0o700 })
  try {
    const info = await lstat(root)
    if (!info.isDirectory() || info.isSymbolicLink()) fail('SPOKEN_VIDEO_SCHEDULE_FILE_INVALID', '内容安排目录无效。')
    return root
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function readJsonFile(path, fallback) {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) fail('SPOKEN_VIDEO_SCHEDULE_FILE_INVALID', '内容安排文件无效。')
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback()
    if (error instanceof SyntaxError) fail('SPOKEN_VIDEO_SCHEDULE_FILE_INVALID', '内容安排文件不是有效 JSON。')
    throw error
  }
}

async function writeJsonFile(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temp = join(dirname(path), `.${randomUUID()}.tmp`)
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  await rename(temp, path)
}

/**
 * Host for the content-schedule module: durable task records, the unattended
 * execution identity, and the stage orchestrator that replays the existing
 * production pipeline on a timer.
 *
 * Nothing here produces content. Every stage delegates to the host that
 * already owns it (content store for topic and script, media host for
 * voiceover/subtitles/render/qc, publish host for packaging) and polls that
 * host's own durable task record. This module owns only sequencing, timing,
 * the execution identity, and the run audit trail.
 *
 * Two deliberate boundaries:
 * - Publishing is never automated. `packaging` is both the deepest depth and
 *   the state machine's last stage, so a finished round leaves the operator a
 *   ready-to-publish project and nothing more.
 * - Automation never widens a permission boundary. Delegated children already
 *   run with approval policy `never` under a workspace-write sandbox, exactly
 *   as they do when a person clicks the same button.
 */
export class SpokenVideoScheduleHost {
  constructor({
    ctx,
    context, executionStatus, modelRoute, modelSelection, background = (work) => work,
    content,
    projects,
    media,
    publish,
    workspacePath = context?.workspacePath,
    agents,
    agentDefaultModel,
    agentPresets,
    sessionTitle,
    adoptSession,
    presetId = 'standard',
    pollIntervalMs = SCHEDULE_POLL_INTERVAL_MS,
    tickIntervalMs = TICK_INTERVAL_MS,
    now = stamp,
  } = {}) {
    if (!content) throw new Error('SpokenVideoScheduleHost requires the content store.')
    if (!projects) throw new Error('SpokenVideoScheduleHost requires the project store.')
    if (!media) throw new Error('SpokenVideoScheduleHost requires the media host.')
    if (!publish) throw new Error('SpokenVideoScheduleHost requires the publish host.')
    this.context = context
    this.executionStatus = executionStatus
    // Readiness of the model route a round will actually use. Optional: a host
    // without the probe simply reports no model state and never blocks.
    this.modelRoute = typeof modelRoute === 'function' ? modelRoute : null
    this.background = background
    this.modelSelection = modelSelection
    this.ctx = ctx || null
    this.content = content
    this.projects = projects
    this.media = media
    this.publish = publish
    this.workspacePath = workspacePath
    // The DSH services an unattended round needs are resolved lazily through
    // ctx.get rather than declared in the pack's `inject`. Cordis treats every
    // injected name as a hard dependency and keeps the whole plugin pending
    // until all of them exist, so declaring them would turn "automation is
    // unavailable here" into "the spoken-video pack never loads". An explicit
    // constructor argument still wins, which is what the tests inject.
    this.overrides = { agents, agentDefaultModel, agentPresets, sessionTitle }
    // The unattended round creates its own root Agent, which the native service
    // cannot attribute to this pack. Adoption is what records that ownership, so
    // it is a hard requirement for a round rather than an optional nicety.
    this.adoptSession = typeof adoptSession === 'function' ? adoptSession : null
    this.presetId = presetId
    // The defaults are the production cadence. A caller may pass anything
    // positive — the tests do, to keep a whole round under a second — but the
    // shipped wiring never overrides them, so a real host polls at 2s and
    // ticks at 30s.
    this.pollIntervalMs = Number.isSafeInteger(pollIntervalMs) && pollIntervalMs >= 1 ? pollIntervalMs : SCHEDULE_POLL_INTERVAL_MS
    this.tickIntervalMs = Number.isSafeInteger(tickIntervalMs) && tickIntervalMs >= 1 ? tickIntervalMs : TICK_INTERVAL_MS
    this.now = now
    /** Per-workspace write serialization for schedules.json. */
    this.writes = new Map()
    /** Live rounds: runId -> { workspace, scheduleId, controller }. */
    this.active = new Map()
    /** Last phase message written per stage, so polling does not thrash the file. */
    this.phaseNotes = new Map()
    this.firstTick = true
  }

  /** Lazy service lookup: an explicit injection wins, else read the live context. */
  #service(name) {
    const override = this.overrides[name]
    if (override) return override
    if (!this.ctx || typeof this.ctx.get !== 'function') return null
    try {
      return this.ctx.get(name) || null
    } catch {
      return null
    }
  }

  /* ------------------------------ file layer ------------------------------ */

  async serial(workspace, operation) {
    const previous = this.writes.get(workspace) || Promise.resolve()
    const result = previous.then(operation)
    const tail = result.catch(() => {})
    this.writes.set(workspace, tail)
    try {
      return await result
    } finally {
      if (this.writes.get(workspace) === tail) this.writes.delete(workspace)
    }
  }

  async paths(agent) {
    const workspace = await workspaceFor(agent)
    if (this.workspacePath && workspace !== this.workspacePath) fail('SPOKEN_VIDEO_WORKSPACE_REQUIRED', '能力包工作区不匹配。')
    const root = await rootFor(workspace)
    if (!root) fail('SPOKEN_VIDEO_SCHEDULE_FILE_INVALID', '内容安排目录不可用。')
    return { workspace, root, file: join(root, SCHEDULE_FILE) }
  }

  async pathsForWorkspace(workspace) {
    const root = await rootFor(workspace, false)
    return root ? { workspace, root, file: join(root, SCHEDULE_FILE) } : null
  }

  /**
   * Reference sets used to self-heal the file on read. A deleted signal source
   * is dropped and a task left with nothing runnable — or whose account was
   * hard deleted — is disabled with an explicit reason, so a vanished
   * reference can never make the whole file unreadable.
   */
  async references(paths) {
    const validSourceIds = new Set()
    const validAccountIds = new Set()
    try {
      const signals = await readJsonFile(join(paths.root, 'signals.json'), () => ({ sources: [] }))
      for (const source of Array.isArray(signals?.sources) ? signals.sources : []) {
        if (typeof source?.id === 'string') validSourceIds.add(source.id)
      }
    } catch { /* an unreadable signal pool must not block schedule reads */ }
    try {
      const profile = await readJsonFile(join(paths.root, 'topic-profile.json'), () => ({ accounts: [] }))
      for (const account of Array.isArray(profile?.accounts) ? profile.accounts : []) {
        if (typeof account?.id === 'string' && account.status === 'active') validAccountIds.add(account.id)
      }
    } catch { /* same */ }
    return { validSourceIds, validAccountIds }
  }

  async readFile(paths) {
    const raw = await readJsonFile(paths.file, emptyScheduleFile)
    const result = scheduleFile(raw, await this.references(paths))
    if (result.changed) await writeJsonFile(paths.file, result.data)
    return result.data
  }

  async mutate(paths, operation) {
    return this.serial(paths.workspace, async () => {
      const data = await this.readFile(paths)
      const value = await operation(data)
      await writeJsonFile(paths.file, data)
      return value
    })
  }

  /* -------------------------------- queries ------------------------------- */

  /**
   * Readiness snapshot for the task form. A depth that renders video but has
   * no TTS credential, or no Remotion, should warn the operator when they save
   * the task rather than failing silently at three in the morning. Reads the
   * media and publish hosts' own status; no agent scope needed.
   */
  async runtimeStatus() {
    let media = null
    let publish = null
    try { media = await this.media.status() } catch { /* surfaced as unavailable below */ }
    try { publish = await this.publish.status() } catch { /* same */ }
    const provider = media?.connection?.provider || 'bailian'
    // `connection.providers[p]` IS the credential status ({ configured, source,
    // writable }) — it has no nested `.credential`. The audio page reads the very
    // same object through `providers[p].credential`, so both paths must agree.
    const ttsCredential = Boolean(media?.connection?.providers?.[provider]?.configured)
    const automationAvailable = this.context
      ? (await this.executionStatus?.())?.configured === true
      : this.#automationAvailable()
    const model = await this.#modelReadiness()
    return {
      automationAvailable,
      model,
      remotion: media?.renderers?.remotion === true,
      tts: { configured: media?.ttsConfigured === true, provider, credential: ttsCredential },
      coverImage: publish?.configured === true,
      // Deepest depth the current environment can actually reach end to end.
      blockers: this.#runtimeBlockers(media, publish, ttsCredential, automationAvailable, model),
    }
  }

  /**
   * The effective model route of the next AI step, or null when no probe is
   * wired or it could not answer. A failed probe must never be read as a
   * missing credential: only an explicit classification blocks a round.
   */
  async #modelReadiness() {
    if (!this.modelRoute) return null
    try { return await this.modelRoute() } catch { return null }
  }

  #automationAvailable() {
    const agents = this.#service('agents')
    const agentPresets = this.#service('agentPresets')
    const agentDefaultModel = this.#service('agentDefaultModel')
    // Adoption belongs in "available": a round that cannot state its ownership
    // would leave its execution identity in the operator's ordinary history.
    return Boolean(agents?.create && agentPresets?.mount && agentDefaultModel?.currentSelection && this.adoptSession)
  }

  #runtimeBlockers(media, publish, ttsCredential, automationAvailable, model) {
    const blockers = []
    if (!automationAvailable) blockers.push({ depth: 'topic', message: this.context ? 'DSH 尚未选择默认模型，请在“设置 → 系统设置 → 模型”中完成配置。' : '当前运行环境不提供自动化所需的 DSH 服务。' })
    // A route that is proven to lack its credential dies on the topic child's
    // first model request. Warn where the task is saved instead of at 3am.
    else if (model?.state === 'missing-credential') blockers.push({ depth: 'topic', message: `场景任务模型「${model.provider} · ${model.model}」当前不可用：${model.reason}` })
    if (!media) blockers.push({ depth: 'video', message: '媒体服务不可用，无法配音或渲染。' })
    else {
      if (!ttsCredential && media?.providers?.legacy?.configured !== true) {
        blockers.push({ depth: 'video', message: '未配置 TTS 凭据，配音阶段会失败。' })
      }
      if (media.renderers?.remotion !== true) blockers.push({ depth: 'video', message: 'Remotion 不可用，无法渲染成片。' })
    }
    return blockers
  }

  async listSchedules(agent) {
    const paths = await this.paths(agent)
    return this.serial(paths.workspace, async () => {
      const data = await this.readFile(paths)
      const runs = [...data.runs].sort((left, right) => String(right.triggeredAt).localeCompare(String(left.triggeredAt)))
      return {
        schedules: data.schedules
          .map((schedule) => scheduleView(schedule, runs))
          .sort((left, right) => String(left.time).localeCompare(String(right.time)) || left.name.localeCompare(right.name)),
        // Task cards only need active rounds and the most recent round. Full
        // history is fetched through the paginated listScheduleRuns endpoint.
        runs: runs.filter((run, index) => index === 0 || run.status === 'running').map((run) => runView(run, { withItems: false })),
      }
    })
  }

  async scheduleRun(agent, request) {
    const runId = String(request?.runId || '').trim()
    if (!runId) invalid('执行记录标识不能为空。')
    const paths = await this.paths(agent)
    const data = await this.serial(paths.workspace, () => this.readFile(paths))
    const run = data.runs.find((item) => item.id === runId)
    if (!run) fail('SPOKEN_VIDEO_SCHEDULE_NOT_FOUND', '执行记录不存在。')
    const schedule = data.schedules.find((item) => item.id === run.scheduleId) || null
    return { run: runView(run), schedule: schedule ? scheduleView(schedule, data.runs) : null, active: this.active.has(runId) }
  }

  async listScheduleRuns(agent, request = {}) {
    const { scheduleId, accountId, general = false, status = 'all', trigger = 'all', query = '', offset = 0, limit = 8 } = request
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) invalid('执行记录分页参数无效。')
    if (!['all', 'running', 'completed', 'partial', 'failed', 'missed', 'cancelled'].includes(status)) invalid('执行状态筛选无效。')
    if (!['all', 'manual', 'automatic'].includes(trigger)) invalid('触发方式筛选无效。')
    if (typeof query !== 'string' || query.length > 160) invalid('搜索内容不能超过 160 字。')
    const paths = await this.paths(agent)
    const data = await this.serial(paths.workspace, () => this.readFile(paths))
    const schedules = new Map(data.schedules.map((schedule) => [schedule.id, schedule]))
    const needle = query.trim().toLocaleLowerCase()
    const scoped = data.runs.filter((run) => {
      const schedule = schedules.get(run.scheduleId)
      return (!scheduleId || run.scheduleId === scheduleId) && (!accountId || schedule?.accountId === accountId) && (!general || !schedule?.accountId)
    })
    const matching = scoped.filter((run) => (status === 'all' || run.status === status) && (trigger === 'all' || run.trigger === trigger)
      && (!needle || [schedules.get(run.scheduleId)?.name, run.message, ...run.items.map((item) => item.title)].filter(Boolean).join(' ').toLocaleLowerCase().includes(needle)))
      .sort((left, right) => String(right.triggeredAt).localeCompare(String(left.triggeredAt)) || right.id.localeCompare(left.id))
    const items = await Promise.all(matching.slice(offset, offset + limit).map(async (run) => ({
      id: run.id, scheduleId: run.scheduleId, scheduleName: schedules.get(run.scheduleId)?.name || '已删除任务',
      status: run.status, trigger: run.trigger, triggeredAt: run.triggeredAt, completedAt: run.completedAt,
      elapsedMs: run.elapsedMs, step: run.step, depthLabel: DEPTH_LABEL[run.depth] || null, message: run.message, error: run.error,
      itemCount: run.items.length, completedCount: run.items.filter((item) => item.status === 'completed').length,
      items: await Promise.all(run.items.map(async (item) => {
        let project = null
        if (item.projectId && item.qcPassed) {
          try { project = await this.projects.get(agent, { projectId: item.projectId }) } catch { /* deleted projects leave their audit record readable */ }
        }
        return { projectId: item.projectId, title: item.title, status: item.status, qcPassed: item.qcPassed, scriptChars: item.scriptChars,
          orientation: item.orientation, video: project?.artifacts?.video?.data?.video || null,
          packaging: { covers: project?.artifacts?.packaging?.data?.covers || null } }
      })),
    })))
    return { items, total: matching.length, offset, limit, anyRunning: scoped.some((run) => run.status === 'running') }
  }

  /* -------------------------------- mutations ----------------------------- */

  async #validateTargets(agent, parsed) {
    if (parsed.accountId) {
      const library = await this.content.listAccounts(agent)
      const account = library.accounts.find((item) => item.id === parsed.accountId)
      if (!account || account.status !== 'active') invalid('所选账号定位不存在或已归档。')
    }
    const known = new Set((await this.content.sources(agent)).map((item) => item.id))
    const unknown = parsed.sources.sourceIds.filter((id) => !known.has(id))
    if (unknown.length) invalid(`包含不存在的信号来源：${unknown.join('、')}。`)
    if (!parsed.sources.sourceIds.length && !parsed.sources.platforms.length) {
      invalid('请至少选择一个参与渠道（公开来源或 AI 内容日报平台）。')
    }
  }

  async createSchedule(agent, request) {
    const parsed = parseScheduleRequest(request)
    const paths = await this.paths(agent)
    await this.#validateTargets(agent, parsed)
    const createdAt = this.now()
    const item = { ...parsed, id: randomUUID(), disabledReason: null, createdAt, updatedAt: createdAt, lastRunAt: null }
    return this.mutate(paths, (data) => {
      if (data.schedules.length >= SCHEDULE_TASK_LIMIT) invalid(`内容安排数量已达上限（${SCHEDULE_TASK_LIMIT} 个）。`)
      data.schedules.push(item)
      return scheduleView(item, data.runs)
    })
  }

  async updateSchedule(agent, request) {
    const parsed = parseScheduleRequest(request)
    const id = String(request?.scheduleId || '').trim().toLowerCase()
    if (!id) invalid('内容安排标识不能为空。')
    const paths = await this.paths(agent)
    await this.#validateTargets(agent, parsed)
    return this.mutate(paths, (data) => {
      const item = data.schedules.find((candidate) => candidate.id === id)
      if (!item) fail('SPOKEN_VIDEO_SCHEDULE_NOT_FOUND', '内容安排不存在。')
      Object.assign(item, parsed, { updatedAt: this.now() })
      if (item.enabled) item.disabledReason = null
      return scheduleView(item, data.runs)
    })
  }

  async setScheduleEnabled(agent, request) {
    const id = String(request?.scheduleId || '').trim().toLowerCase()
    if (!id) invalid('内容安排标识不能为空。')
    const enabled = request?.enabled === true
    const paths = await this.paths(agent)
    return this.mutate(paths, (data) => {
      const item = data.schedules.find((candidate) => candidate.id === id)
      if (!item) fail('SPOKEN_VIDEO_SCHEDULE_NOT_FOUND', '内容安排不存在。')
      if (enabled && item.disabledReason) fail('SPOKEN_VIDEO_SCHEDULE_DISABLED', item.disabledReason)
      item.enabled = enabled
      item.updatedAt = this.now()
      return scheduleView(item, data.runs)
    })
  }

  /**
   * Delete a task together with its history. The run audit trail is keyed by
   * schedule, and keeping orphan runs would resurrect a task the operator
   * deliberately removed.
   */
  async deleteSchedule(agent, request) {
    const id = String(request?.scheduleId || '').trim().toLowerCase()
    if (!id) invalid('内容安排标识不能为空。')
    const paths = await this.paths(agent)
    if ([...this.active.values()].some((run) => run.workspace === paths.workspace && run.scheduleId === id)) {
      fail('SPOKEN_VIDEO_SCHEDULE_BUSY', '该任务正在执行，请先停止本轮再删除。')
    }
    return this.mutate(paths, (data) => {
      const index = data.schedules.findIndex((candidate) => candidate.id === id)
      if (index === -1) fail('SPOKEN_VIDEO_SCHEDULE_NOT_FOUND', '内容安排不存在。')
      data.schedules.splice(index, 1)
      data.runs = data.runs.filter((run) => run.scheduleId !== id)
      return { deleted: id }
    })
  }

  /* ------------------------------ run control ----------------------------- */

  /** Start one round immediately. Fire and forget: returns the run id. */
  async runSchedule(agent, request) {
    const id = String(request?.scheduleId || '').trim().toLowerCase()
    if (!id) invalid('内容安排标识不能为空。')
    const paths = await this.paths(agent)
    const data = await this.serial(paths.workspace, () => this.readFile(paths))
    const schedule = data.schedules.find((candidate) => candidate.id === id)
    if (!schedule) fail('SPOKEN_VIDEO_SCHEDULE_NOT_FOUND', '内容安排不存在。')
    if (schedule.disabledReason) fail('SPOKEN_VIDEO_SCHEDULE_DISABLED', schedule.disabledReason)
    return this.startRun(paths, schedule, 'manual')
  }

  /**
   * Stop the round from advancing. Already started stage tasks are not force
   * killed here: each keeps its own durable record and recovery, and the
   * artifacts they committed stay. Releasing the execution identity unwinds
   * its scoped children.
   */
  async cancelScheduleRun(agent, request) {
    const runId = String(request?.runId || '').trim()
    if (!runId) invalid('执行记录标识不能为空。')
    const paths = await this.paths(agent)
    const entry = this.active.get(runId)
    if (!entry || entry.workspace !== paths.workspace) fail('SPOKEN_VIDEO_SCHEDULE_NOT_FOUND', '该执行记录不在运行中。')
    entry.controller.abort(new Error('操作者停止了本轮自动化。'))
    return { cancelled: runId }
  }

  /**
   * Reserve the slot and start the round. The stamp and the running record are
   * written BEFORE any stage starts, so the next thirty second tick can never
   * launch the same slot twice even though a round takes many minutes.
   */
  async startRun(paths, schedule, trigger) {
    if ([...this.active.values()].some((run) => run.workspace === paths.workspace)) {
      fail('SPOKEN_VIDEO_SCHEDULE_BUSY', '本工作区已有一轮自动化在执行，请等待其结束。')
    }
    const runId = randomUUID()
    const triggeredAt = this.now()
    const steps = stepsForRun(schedule.depth, schedule.production.subtitleEnabled)
    const record = {
      id: runId,
      scheduleId: schedule.id,
      status: 'running',
      trigger,
      triggeredAt,
      completedAt: null,
      elapsedMs: null,
      sessionId: null,
      depth: schedule.depth,
      step: steps[0],
      message: `已启动，目标深度「${DEPTH_LABEL[schedule.depth]}」。`,
      error: null,
      refs: { topicGenerationId: null, scriptGenerationIds: [], mediaRunIds: [], publishTaskIds: [] },
      items: [],
    }
    await this.mutate(paths, (data) => {
      const item = data.schedules.find((candidate) => candidate.id === schedule.id)
      if (item) {
        item.lastRunAt = triggeredAt
        item.updatedAt = triggeredAt
      }
      data.runs.unshift(record)
    })
    const controller = new AbortController()
    this.active.set(runId, { workspace: paths.workspace, scheduleId: schedule.id, controller })
    void this.background(this.#execute(paths, runId, schedule, controller.signal)
      .catch(() => {})
      .finally(() => { this.active.delete(runId) }))
    return { runId, triggeredAt }
  }

  /* --------------------------- execution identity ------------------------- */

  /**
   * An unattended round has no user session, but every host entry point
   * resolves its workspace from `agent.session.header.cwd` and every DSH step
   * needs a live parent agent. Create one root agent per round, following the
   * upstream webhook and headless precedents.
   *
   * The standard preset is mandatory rather than optional: delegated children
   * inherit the parent's scoped tool composition, and without it the video
   * director could not reach the file tools it needs to write its Remotion
   * project. A missing preset service therefore fails the round loudly instead
   * of producing a crippled pipeline.
   */
  async #acquireAgent(workspace, schedule, signal) {
    const agents = this.#service('agents')
    const agentPresets = this.#service('agentPresets')
    const agentDefaultModel = this.#service('agentDefaultModel')
    if (!agents || typeof agents.create !== 'function') {
      fail('SPOKEN_VIDEO_SCHEDULE_UNAVAILABLE', '当前运行环境不提供 Agent 服务，无法执行自动化任务。')
    }
    if (!this.adoptSession) {
      fail('SPOKEN_VIDEO_SCHEDULE_UNAVAILABLE', '当前运行环境不提供能力包会话归属服务，无法执行自动化任务。')
    }
    if (!agentPresets || typeof agentPresets.mount !== 'function') {
      fail('SPOKEN_VIDEO_SCHEDULE_UNAVAILABLE', '当前运行环境不提供 Agent 预设服务，无法执行自动化任务。')
    }
    if (!this.modelSelection && (!agentDefaultModel || typeof agentDefaultModel.currentSelection !== 'function')) {
      fail('SPOKEN_VIDEO_SCHEDULE_UNAVAILABLE', '当前运行环境不提供默认模型服务，无法执行自动化任务。')
    }
    const selection = this.modelSelection ? this.modelSelection() : agentDefaultModel.currentSelection()
    const agentOptions = { ...selection }
    const preset = await agentPresets.resolve(this.presetId)
    const setup = async (agentCtx) => { await agentPresets.mount(agentCtx, preset.id) }
    // One identity per task, reused across rounds, so a schedule keeps a single
    // durable execution identity instead of one Session per run. It is
    // pack-internal: adoption below records the ownership that keeps it out of
    // the operator's ordinary conversation list, and the pack's own run history
    // is where a round is inspected.
    const sessionId = `sv-auto-${schedule.id}`
    let handle
    try {
      handle = await agents.resume({ resumeSessionId: sessionId, agentOptions, setup, signal })
    } catch {
      handle = await agents.create({ sessionId, meta: { cwd: workspace, agentPreset: preset.id }, agentOptions, setup, signal })
    }
    // The native Agent service carries no pack identity, so the round states its
    // own ownership before any work is published in the identity.
    await this.adoptSession(handle.agent)
    try {
      this.#service('sessionTitle')?.rename(handle.agent.session, `自动化 · ${schedule.name}`)
    } catch { /* a title is presentation only; never fail a round over it */ }
    return handle
  }

  /* -------------------------------- polling ------------------------------- */

  async #sleep(signal) {
    await new Promise((resolve, reject) => {
      if (signal.aborted) { reject(signal.reason); return }
      const onAbort = () => { clearTimeout(timer); reject(signal.reason) }
      const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, this.pollIntervalMs)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  /**
   * Poll until `isDone` accepts the value, the deadline passes, or the round is
   * cancelled. A timeout never kills the underlying task — it keeps its own
   * durable record and recovery — it only stops this round from waiting.
   */
  async #poll(step, signal, read, isDone) {
    const deadline = Date.now() + STEP_TIMEOUT_MS[step]
    for (;;) {
      signal.throwIfAborted()
      const value = await read()
      if (isDone(value)) return value
      if (Date.now() > deadline) {
        fail('SPOKEN_VIDEO_SCHEDULE_TIMEOUT', `${STEP_LABEL[step]}超过 ${Math.round(STEP_TIMEOUT_MS[step] / 60_000)} 分钟仍未完成。`)
      }
      await this.#sleep(signal)
    }
  }

  /* ------------------------------- orchestrator ---------------------------- */

  /**
   * Refuse to spend a slot on a round whose model route is proven to have no
   * credential. Without this the round starts, the topic child dies on its
   * first model request within milliseconds, and the operator reads the whole
   * thing as a failing stage — the least actionable form of the same fact.
   *
   * Only a proven missing credential stops a round. An unverifiable or
   * account-authenticated route proceeds, because DSH owns authentication and
   * the pack must not guess.
   */
  async #assertModelRoute() {
    if (!this.context) return
    const model = await this.#modelReadiness()
    if (model?.state !== 'missing-credential') return
    fail('SPOKEN_VIDEO_SCHEDULE_MODEL_UNAVAILABLE', `本轮未开始：场景任务模型「${model.provider} · ${model.model}」缺少凭据；${model.reason}`)
  }

  async #execute(paths, runId, schedule, signal) {
    let handle = null
    try {
      handle = this.context ? { agent: this.context, dispose: async () => {} } : await this.#acquireAgent(paths.workspace, schedule, signal)
      const agent = handle.agent
      await this.#patch(paths, runId, (run) => { run.sessionId = agent.id ? String(agent.id) : null })
      await this.#assertModelRoute()
      await this.#runRound(paths, runId, agent, schedule, signal)
    } catch (error) {
      const cancelled = signal.aborted
      await this.#patch(paths, runId, (run) => {
        run.status = cancelled ? 'cancelled' : 'failed'
        run.error = cancelled ? null : reasonOf(error)
        run.message = cancelled
          ? '本轮已按操作者要求停止，已完成的阶段产物保留。'
          : `自动化在「${STEP_LABEL[run.step] || run.step}」阶段失败。`
        run.completedAt = this.now()
        run.elapsedMs = elapsed(run.triggeredAt, run.completedAt)
        for (const item of run.items) {
          if (item.status !== 'running') continue
          item.status = cancelled ? 'cancelled' : 'failed'
          if (!cancelled && !item.error) item.error = reasonOf(error)
        }
      }).catch(() => {})
    } finally {
      if (handle) await handle.dispose().catch(() => {})
    }
  }

  async #runRound(paths, runId, agent, schedule, signal) {
    const steps = stepsForRun(schedule.depth, schedule.production.subtitleEnabled)
    const startedAt = this.now()

    // Topic generation also backfills today's missing channels, which is why a
    // separate collect step would be redundant.
    await this.#patch(paths, runId, (run) => { run.step = 'topic' })
    const launched = await this.content.startTopicGeneration(agent, topicInputOf(schedule))
    await this.#patch(paths, runId, (run) => { run.refs.topicGenerationId = launched.id })
    const generation = await this.#poll('topic', signal,
      () => this.content.topicGenerationStatus(agent, { id: launched.id }),
      (record) => !LIVE.has(record.status))
    if (generation.status !== 'completed') {
      // A failed round always carries the reason in `error`; the message stays
      // a one-line human summary for the task card.
      await this.#finish(paths, runId, startedAt, 'failed', 'topic', '选题生成未完成。', generation.error || '选题生成未正常结束。')
      return
    }

    const projects = await this.#selectProjects(agent, generation, schedule.perRunLimit)
    if (!projects.length) {
      await this.#finish(paths, runId, startedAt, 'failed', 'topic', '本轮没有可用的选题候选。', '选题生成已完成，但没有返回可用候选；可调整选题角度或参与渠道后重试。')
      return
    }

    const rest = steps.filter((step) => step !== 'topic')
    const topicDoneAt = this.now()
    await this.#patch(paths, runId, (run) => {
      run.items = projects.map((project) => ({
        projectId: project.projectId,
        title: project.title,
        // A topic-only round is already finished here; leaving the item running
        // would strand it in a state no later pass ever revisits.
        status: rest.length ? 'running' : 'completed',
        reachedStep: 'topic',
        signalCount: project.signalCount,
        scriptChars: null,
        scriptRevision: null,
        durationSeconds: null,
        orientation: rest.includes('video') ? schedule.production.orientation : null,
        qcPassed: false,
        coverState: null,
        error: null,
        stages: emptyStages(steps).map((stage) => (stage.step === 'topic'
          ? { ...stage, status: 'done', startedAt, completedAt: topicDoneAt, refId: generation.id, message: `候选「${project.title}」· 依据 ${project.signalCount} 条信号` }
          : stage)),
      }))
      run.message = rest.length
        ? `选题完成，本轮推进 ${projects.length} 条至「${DEPTH_LABEL[schedule.depth]}」。`
        : `选题完成，本轮产出 ${projects.length} 条待写稿选题。`
      if (!rest.length) {
        run.status = 'completed'
        run.step = 'topic'
        run.completedAt = this.now()
        run.elapsedMs = elapsed(startedAt, run.completedAt)
      }
    })
    if (!rest.length) return

    // One project at a time: rendering saturates the machine, and interleaved
    // failures are far harder to read in the audit trail.
    for (const project of projects) {
      if (signal.aborted) break
      await this.#runItem(paths, runId, agent, schedule, project.projectId, rest, signal)
    }

    const cancelled = signal.aborted
    const items = await this.#readItems(paths, runId)
    const done = items.filter((item) => item.status === 'completed').length
    const status = reduceRunStatus(items, cancelled)
    const last = finalStep(schedule.depth, schedule.production.subtitleEnabled)
    await this.#finish(paths, runId, startedAt, status, last,
      cancelled ? '本轮已按操作者要求停止，已完成的阶段产物保留。'
        : status === 'completed' ? `本轮完成，${done} 条已推进到「${DEPTH_LABEL[schedule.depth]}」。`
          : status === 'partial' ? `本轮部分完成：${done}/${items.length} 条推进到「${DEPTH_LABEL[schedule.depth]}」。`
            : '本轮全部失败，请展开各条查看原因。',
      cancelled ? null : items.find((item) => item.error)?.error || null)
  }

  /**
   * The recommended candidate is already materialised into a project by the
   * content store. When the round wants more than one, take the following
   * candidates in the same recommendation order the topic page shows.
   */
  async #selectProjects(agent, generation, wanted) {
    const chosen = new Map()
    const candidates = [...(generation.candidates || [])]
    for (const candidate of candidates) {
      if (candidate?.selection?.state !== 'selected' || !candidate.selection.projectId) continue
      chosen.set(candidate.selection.projectId, {
        projectId: candidate.selection.projectId,
        title: candidate.title,
        signalCount: (candidate.signalIds || []).length,
      })
    }
    for (const candidate of candidates) {
      if (chosen.size >= wanted || !candidate?.id) continue
      if (candidate.selection?.projectId && chosen.has(candidate.selection.projectId)) continue
      try {
        await this.content.setTopicCandidateSelection(agent, { id: generation.id, candidateId: candidate.id, selected: true })
      } catch {
        continue
      }
      const fresh = await this.content.topicGenerationStatus(agent, { id: generation.id })
      const selected = (fresh.candidates || []).find((item) => item.id === candidate.id)
      if (selected?.selection?.projectId) {
        chosen.set(selected.selection.projectId, {
          projectId: selected.selection.projectId,
          title: selected.title,
          signalCount: (selected.signalIds || []).length,
        })
      }
    }
    return [...chosen.values()].slice(0, wanted)
  }

  async #runItem(paths, runId, agent, schedule, projectId, steps, signal) {
    for (const step of steps) {
      signal.throwIfAborted()
      await this.#setStage(paths, runId, projectId, step, { status: 'running', startedAt: this.now() })
      try {
        const note = await this.#runStep(step, agent, schedule, projectId, signal, paths, runId)
        await this.#setStage(paths, runId, projectId, step, {
          status: 'done',
          completedAt: this.now(),
          ...(note?.refId ? { refId: note.refId } : {}),
          ...(note?.message ? { message: note.message } : {}),
        })
        await this.#patchItem(paths, runId, projectId, (item) => { item.reachedStep = step })
      } catch (error) {
        const cancelled = signal.aborted
        const message = reasonOf(error)
        await this.#setStage(paths, runId, projectId, step, {
          status: cancelled ? 'skipped' : 'failed',
          completedAt: this.now(),
          message: cancelled ? '本轮已停止。' : message,
        })
        await this.#patchItem(paths, runId, projectId, (item) => {
          item.status = cancelled ? 'cancelled' : 'failed'
          if (!cancelled) item.error = message
        })
        return
      }
    }
    await this.#patchItem(paths, runId, projectId, (item) => { item.status = 'completed' })
  }

  /** Explicit dispatch: private methods are not reachable by computed name. */
  #runStep(step, agent, schedule, projectId, signal, paths, runId) {
    if (step === 'script') return this.#stageScript(agent, schedule, projectId, signal, paths, runId)
    if (step === 'approve') return this.#stageApprove(agent, projectId)
    if (step === 'voiceover') return this.#stageVoiceover(agent, schedule, projectId, 'voiceover', signal, paths, runId)
    if (step === 'subtitles') return this.#stageVoiceover(agent, schedule, projectId, 'subtitles', signal, paths, runId)
    if (step === 'video') return this.#stageVideo(agent, schedule, projectId, signal, paths, runId)
    if (step === 'packaging') return this.#stagePackaging(agent, projectId, signal, paths, runId)
    throw new Error(`未知的自动化阶段：${step}`)
  }

  /* --------------------------------- stages -------------------------------- */

  async #stageScript(agent, schedule, projectId, signal, paths, runId) {
    const launched = await this.content.startScriptGeneration(agent, scriptInputOf(schedule, projectId))
    await this.#pushRef(paths, runId, 'scriptGenerationIds', launched.id)
    await this.#setStage(paths, runId, projectId, 'script', { refId: launched.id })
    const record = await this.#poll('script', signal,
      () => this.content.scriptGenerationStatus(agent, { id: launched.id }),
      (item) => !LIVE.has(item.status))
    if (record.status !== 'completed') throw new Error(record.error || '写稿生成未完成。')
    const detail = await this.projects.get(agent, { projectId })
    const revision = detail.artifacts?.script?.revision || null
    const chars = charsOf(detail.artifacts?.script?.data?.body)
    await this.#patchItem(paths, runId, projectId, (item) => {
      item.scriptChars = chars
      item.scriptRevision = revision
      item.title = detail.title || item.title
    })
    return { refId: launched.id, message: `${chars} 字稿件已保存为版本 ${revision || '?'}` }
  }

  /**
   * The script-confirmation gate. Crossing it is exactly what the automation
   * depth authorises: the task form states that depths reaching video or
   * packaging confirm the AI script without a human reading it. The recorded
   * approval is revision bound, so a later edit invalidates it just as a human
   * confirmation would.
   */
  async #stageApprove(agent, projectId) {
    const summary = await this.projects.approveScript(agent, { projectId, source: 'automation' })
    return { message: `稿件版本 ${summary.scriptApproval?.revision || '?'} 已由自动化确认` }
  }

  async #stageVoiceover(agent, schedule, projectId, step, signal, paths, runId) {
    const detail = await this.projects.get(agent, { projectId })
    const voice = schedule.production.voice
    const request = { projectId, expectedRevision: detail.revision }
    if (step === 'subtitles') {
      // Subtitles follow the provider that actually produced the voiceover,
      // not the schedule's own preference: the committed voiceover artifact
      // records the provider that ran. A voiceover can be re-recorded or
      // switched by hand after the schedule was saved, and transcribing it
      // with a different vendor than the one that synthesized it would be
      // wrong. The preference is only a fallback for a legacy voiceover that
      // predates the recorded provider.
      const spoken = detail.artifacts?.voiceover?.data
      const preferred = typeof this.media.preferredProvider === 'function' ? await this.media.preferredProvider() : null
      const provider = spoken?.provider || voice?.provider || preferred
      Object.assign(request, {
        language: 'zh', aiOptimize: true,
        ...(provider ? { provider } : {}),
      })
    } else {
      // A schedule may pin its own voice; otherwise the round honours the
      // saved media connection preference, which is the same source the audio
      // page writes. Without this fallback the normalizer's hard default
      // ('lwb') silently ignored the user's chosen provider. The probe is
      // optional so a host that does not expose it keeps the old behaviour.
      const preferred = typeof this.media.preferredProvider === 'function' ? await this.media.preferredProvider() : null
      const provider = voice?.provider || preferred
      Object.assign(request, {
        ...(provider ? { provider } : {}),
        ...(voice ? {
          voiceSource: voice.voiceSource, voiceId: voice.voiceId,
          voiceName: voice.voiceName, rate: voice.rate, volume: voice.volume, pitch: voice.pitch,
        } : { voiceSource: 'system' }),
      })
    }
    const started = step === 'subtitles'
      ? await this.media.startSubtitles(agent, request)
      : await this.media.startVoiceover(agent, request)
    await this.#pushRef(paths, runId, 'mediaRunIds', started.id)
    await this.#setStage(paths, runId, projectId, step, { refId: started.id })
    const done = await this.#pollMedia(agent, step, signal, paths, runId, projectId, started.id)
    if (done.status !== 'succeeded') throw new Error(done.error || (step === 'subtitles' ? '字幕生成失败。' : '配音生成失败。'))
    const seconds = done.result?.audio?.durationSeconds
    return {
      refId: started.id,
      message: step === 'subtitles' ? '字幕已按真实音频时间轴生成' : seconds ? `配音 ${Math.round(seconds)} 秒` : '配音已生成',
    }
  }

  /** Render commits video and qc atomically, so this one stage covers both. */
  async #stageVideo(agent, schedule, projectId, signal, paths, runId) {
    const detail = await this.projects.get(agent, { projectId })
    const started = await this.media.startVideoRender(agent, {
      projectId,
      expectedRevision: detail.revision,
      orientation: schedule.production.orientation,
      subtitleEnabled: schedule.production.subtitleEnabled,
      ...(schedule.production.visualBrief ? { visualBrief: schedule.production.visualBrief } : {}),
    })
    await this.#pushRef(paths, runId, 'mediaRunIds', started.id)
    await this.#setStage(paths, runId, projectId, 'video', { refId: started.id })
    const done = await this.#pollMedia(agent, 'video', signal, paths, runId, projectId, started.id)
    if (done.status !== 'succeeded') throw new Error(done.error || '视频渲染或质检未通过。')
    const video = done.result?.video || {}
    await this.#patchItem(paths, runId, projectId, (item) => {
      item.durationSeconds = Number.isFinite(video.durationSeconds) ? video.durationSeconds : null
      if (video.width && video.height) item.orientation = video.height > video.width ? 'portrait' : 'landscape'
      item.qcPassed = true
    })
    return {
      refId: started.id,
      message: video.durationSeconds
        ? `成片 ${Math.round(video.durationSeconds)} 秒，技术质检与独立审片均通过`
        : '成片已通过技术质检与独立审片',
    }
  }

  async #stagePackaging(agent, projectId, signal, paths, runId) {
    const detail = await this.projects.get(agent, { projectId })
    const started = await this.publish.startPackaging(agent, { projectId, expectedRevision: detail.revision })
    await this.#pushRef(paths, runId, 'publishTaskIds', started.id)
    await this.#setStage(paths, runId, projectId, 'packaging', { refId: started.id })
    const done = await this.#poll('packaging', signal,
      () => this.publish.task(agent, { taskId: started.id }),
      (task) => !LIVE.has(task.status))
    if (done.status !== 'succeeded') throw new Error(done.error || '发布资料生成失败。')
    // Covers live on the committed artifact, not on the task summary.
    const packaged = await this.projects.get(agent, { projectId })
    const covers = packaged.artifacts?.packaging?.data?.covers || {}
    const errors = packaged.artifacts?.packaging?.data?.coverErrors || {}
    const landscape = Boolean(covers.landscape?.file)
    const portrait = Boolean(covers.portrait?.file)
    const coverState = !done.imageProvider ? 'disabled'
      : landscape && portrait ? 'both'
        : landscape || portrait ? 'partial'
          : 'none'
    await this.#patchItem(paths, runId, projectId, (item) => { item.coverState = coverState })
    const coverNote = coverState === 'disabled' ? '（未配置生图服务，封面需人工上传）'
      : coverState === 'both' ? '，横竖封面已生成'
        : `，封面${coverState === 'partial' ? '单侧' : ''}生成失败：${errors.landscape || errors.portrait || '未知原因'}`
    return { refId: started.id, message: `发布资料已生成${coverNote}` }
  }

  async #pollMedia(agent, step, signal, paths, runId, projectId, mediaRunId) {
    return this.#poll(step, signal, async () => {
      const runs = await this.media.operations(agent, { projectId })
      const run = runs.find((item) => item.id === mediaRunId)
      if (!run) fail('SPOKEN_VIDEO_SCHEDULE_NOT_FOUND', '媒体任务记录丢失。')
      // Surface the media host's own fine-grained phase, but only write when
      // it actually changes so polling does not thrash schedules.json.
      if (run.phase) {
        const key = `${runId}:${projectId}:${step}`
        if (this.phaseNotes.get(key) !== run.phase) {
          this.phaseNotes.set(key, run.phase)
          await this.#setStage(paths, runId, projectId, step, { message: run.phase }).catch(() => {})
        }
      }
      return run
    }, (run) => !LIVE.has(run.status))
  }

  /* ------------------------------ run record ------------------------------ */

  async #readItems(paths, runId) {
    const data = await this.serial(paths.workspace, () => this.readFile(paths))
    return data.runs.find((run) => run.id === runId)?.items || []
  }

  async #patch(paths, runId, mutate) {
    return this.mutate(paths, (data) => {
      const run = data.runs.find((item) => item.id === runId)
      if (!run) return null
      mutate(run)
      return run
    })
  }

  async #patchItem(paths, runId, projectId, mutate) {
    return this.#patch(paths, runId, (run) => {
      const item = run.items.find((candidate) => candidate.projectId === projectId)
      if (item) mutate(item)
    })
  }

  async #setStage(paths, runId, projectId, step, patch) {
    return this.#patch(paths, runId, (run) => {
      run.step = step
      const item = run.items.find((candidate) => candidate.projectId === projectId)
      const stage = item?.stages.find((candidate) => candidate.step === step)
      if (!stage) return
      const { message, ...rest } = patch
      Object.assign(stage, rest)
      if (message) stage.message = String(message).slice(0, 500)
      if (stage.status === 'done' && !stage.completedAt) stage.completedAt = this.now()
    })
  }

  async #pushRef(paths, runId, key, value) {
    if (!value) return
    return this.#patch(paths, runId, (run) => {
      if (!run.refs[key].includes(value)) run.refs[key].push(value)
    })
  }

  async #finish(paths, runId, startedAt, status, step, message, error) {
    const completedAt = this.now()
    return this.#patch(paths, runId, (run) => {
      run.status = status
      if (step) run.step = step
      run.message = message
      run.error = error
      run.completedAt = completedAt
      run.elapsedMs = elapsed(startedAt, completedAt)
      for (const item of run.items) {
        if (item.status === 'running') item.status = status === 'completed' ? 'completed' : 'failed'
        for (const stage of item.stages) {
          if (stage.status === 'running' || stage.status === 'pending') stage.status = 'skipped'
        }
      }
      for (const key of [...this.phaseNotes.keys()]) {
        if (key.startsWith(`${runId}:`)) this.phaseNotes.delete(key)
      }
    })
  }

  /* -------------------------------- scheduler ------------------------------- */

  async #workspaces() {
    return this.workspacePath ? [this.workspacePath] : []
  }

  /**
   * One tick. Signal collection stays with the content store; this only looks
   * for automation slots. Rounds start detached, so a twenty minute pipeline
   * can never block subsequent ticks, and the
   * per-workspace in-flight guard plus the pre-written stamp keep the next
   * tick from starting the same slot twice.
   */
  async tick() {
    const clock = new Date(this.now())
    const first = this.firstTick
    this.firstTick = false
    for (const workspace of await this.#workspaces()) {
      const paths = await this.pathsForWorkspace(workspace)
      if (!paths) continue
      let data
      try {
        data = await this.serial(workspace, async () => {
          const file = await this.readFile(paths)
          if (first && this.#recordMissed(file, clock)) await writeJsonFile(paths.file, file)
          return file
        })
      } catch {
        continue
      }
      if ([...this.active.values()].some((run) => run.workspace === workspace)) continue
      for (const schedule of data.schedules) {
        if (schedule.disabledReason || !scheduleDue(schedule, clock)) continue
        await this.startRun(paths, schedule, 'automatic').catch(() => {})
      }
    }
  }

  /**
   * Content is time sensitive, so a slot that passed while the host was down
   * is logged for the operator and never backfilled. Checked once per process
   * start; polling it every tick would spam records.
   *
   * Mutates `data` in place and reports whether anything changed. It must run
   * inside the caller's serial block: `mutate()` re-enters `serial()`, which is
   * not reentrant, so nesting it here would deadlock the scheduler.
   */
  #recordMissed(data, clock) {
    let changed = false
    for (const schedule of data.schedules) {
      if (!missedSlot(schedule, clock)) continue
      const at = this.now()
      data.runs.unshift({
        id: randomUUID(),
        scheduleId: schedule.id,
        status: 'missed',
        trigger: 'automatic',
        triggeredAt: at,
        completedAt: at,
        elapsedMs: 0,
        sessionId: null,
        depth: schedule.depth,
        step: null,
        message: `主机在 ${schedule.time} 未运行，已跳过本次执行；内容有时效性，不会自动补跑。需要时可在任务卡上「立即执行」。`,
        error: null,
        refs: { topicGenerationId: null, scriptGenerationIds: [], mediaRunIds: [], publishTaskIds: [] },
        items: [],
      })
      changed = true
    }
    return changed
  }

  /**
   * A restart drops every in-flight round along with its execution agent, so
   * none can resume. Mark them failed once instead of leaving a permanently
   * running record. Underlying stage tasks keep their own recovery in their
   * own hosts, and the drawer still shows their real terminal state.
   */
  async recoverInterrupted() {
    for (const workspace of await this.#workspaces()) {
      const paths = await this.pathsForWorkspace(workspace)
      if (!paths) continue
      await this.serial(workspace, async () => {
        const data = await this.readFile(paths)
        let changed = false
        for (const run of data.runs) {
          if (run.status !== 'running') continue
          run.status = 'failed'
          run.error = '主机在流水线完成前已重启，本轮中止；各阶段任务的真实状态见对应模块。'
          run.message = '主机重启导致本轮中止。'
          run.completedAt = this.now()
          run.elapsedMs = elapsed(run.triggeredAt, run.completedAt)
          for (const item of run.items) {
            if (item.status !== 'running') continue
            item.status = 'failed'
            item.error = run.error
            for (const stage of item.stages) {
              if (stage.status === 'running' || stage.status === 'pending') stage.status = 'failed'
            }
          }
          changed = true
        }
        if (changed) await writeJsonFile(paths.file, data)
      }).catch(() => {})
    }
  }

  /**
   * Cancel every in-flight round. Used on pack unload so a detached round and
   * its execution identity cannot outlive the host that started it; each round
   * then settles as `cancelled` and disposes its agent in #execute's finally.
   */
  stopAll(reason = '内容安排模块已卸载，本轮自动化停止。') {
    for (const entry of this.active.values()) entry.controller.abort(new Error(reason))
  }

  startScheduler() {
    const tick = () => { void this.background(this.tick().catch(() => {})) }
    void this.background(this.recoverInterrupted().catch(() => {}))
    tick()
    const timer = setInterval(tick, this.tickIntervalMs)
    timer.unref?.()
    return () => {
      clearInterval(timer)
      this.stopAll()
    }
  }
}
