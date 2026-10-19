import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { spokenVideoDataPath } from './spoken-video-paths.mjs'
import { executionEvent } from './spoken-video-execution.mjs'
import {
  AI_DAILY_PLATFORMS,
  collectSignalSource,
  DEFAULT_SIGNAL_SOURCES,
  fingerprintSignal,
  platformForSource,
  scoreSignal,
  SOURCE_KIND_OPTIONS,
  SignalAdapterError,
} from './spoken-video-signal-adapters.mjs'
import {
  assembleMaterial,
  buildGenerationSteps,
  buildTopicPrompt,
  emptyProfile,
  hasProfile,
  normalizeCandidates,
  parseProfile,
  parseTopicInput,
  snapshotAccount,
  summarizeInput,
  topicAttemptPlans,
  TOPIC_CANDIDATES_SCHEMA,
} from './spoken-video-topic.mjs'
import {
  ACCOUNT_COMPLETION_SCHEMA,
  buildAccountCompletionPrompt,
  normalizeAccountSuggestion,
  parseAccountCompletionInput,
} from './spoken-video-account.mjs'
import {
  analyzeScriptQuality,
  buildScriptGenerationSteps,
  buildScriptPrompt,
  normalizeDraft,
  parseScriptGenerationInput,
  SCRIPT_DRAFT_SCHEMA,
  summarizeScriptInput,
} from './spoken-video-script.mjs'
import {
  appendDshTrace,
  dshChildStarted,
  dshTrace,
  ensureDshTrace,
  lastDshFailureDetail,
  projectDshSessionEvent,
} from './spoken-video-dsh-trace.mjs'

const SIGNAL_SCHEMA = 10
const RETIRED_SIGNAL_SOURCE_KIND = 'v2ex-hot'
const SIGNAL_RETENTION_DAYS = 7
const UUID = /^[a-f0-9-]{36}$/iu
const SOURCE_ID = /^[a-z0-9][a-z0-9-]{1,62}$/u
const SOURCE_STATES = new Set(['ready', 'disabled', 'error', 'never-run'])
const SIGNAL_STATES = new Set(['active', 'saved', 'ignored'])
const RUN_STATES = new Set(['success', 'failed', 'skipped'])
const BATCH_STATES = new Set(['success', 'unchanged'])

function fail(message) { return new Error(`口播视频内容数据：${message}`) }
function object(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(`${label}必须是对象。`); return value }
function text(value, label, max, required = true) {
  if ((value === undefined || value === null) && !required) return undefined
  if (typeof value !== 'string') throw fail(`${label}必须是文本。`)
  const result = value.trim()
  if (!result || result.length > max) throw fail(`${label}长度必须在 1-${max} 之间。`)
  return result
}
function optional(value, label, max) { return value == null || (typeof value === 'string' && !value.trim()) ? null : text(value, label, max) }
function bool(value, label) { if (typeof value !== 'boolean') throw fail(`${label}必须是布尔值。`); return value }
function integer(value, label, min, max) { if (!Number.isSafeInteger(value) || value < min || value > max) throw fail(`${label}必须在 ${min}-${max} 之间。`); return value }
function strings(value, label, maxItems, maxLength) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > maxItems) throw fail(`${label}最多包含 ${maxItems} 项。`)
  return [...new Set(value.map((item, index) => text(item, `${label}[${index}]`, maxLength)))]
}
function uuid(value, label) { const result = text(value, label, 36); if (!UUID.test(result)) throw fail(`${label}无效。`); return result.toLowerCase() }
function sourceId(value, label = '来源标识') { const result = text(value, label, 63); if (!SOURCE_ID.test(result)) throw fail(`${label}无效。`); return result }
function now() { return new Date().toISOString() }
function ms(start, end) { const value = Date.parse(end) - Date.parse(start); return Number.isFinite(value) ? Math.max(0, value) : 0 }

/**
 * Compose the durable failure text for one generation record. The executor
 * reports only that a child run did not finish normally; the concrete cause
 * (a missing credential, an unsupported parameter, a refusal) is recorded in
 * the child's DSH trace. Appending it keeps the task card and the execution
 * detail panel telling the same story instead of the operator having to guess.
 * @param error - the error the generation caught.
 * @param trace - the record's `dsh` trace container.
 * @returns one line, bounded by the callers' own field limits.
 */
function failureMessage(error, trace) {
  const base = String(error?.message || error || '').trim() || '生成未完成。'
  const detail = lastDshFailureDetail(trace)
  if (!detail || base.includes(detail)) return base
  return `${base}：${detail}`
}

/**
 * Whether a provider refused the prompt through its input content inspection.
 * The provider reports this as HTTP 400 `data_inspection_failed`; the executor
 * wraps it in `生成未正常结束（error）`, so inspect the wrapped message and cause.
 */
function isContentInspectionFailure(error, trace) {
  const values = [error?.message, error?.cause?.message, String(error), lastDshFailureDetail(trace)]
  return values.some((value) => typeof value === 'string'
    && /data_inspection_failed|DataInspectionFailed|Input text data may contain inappropriate content/iu.test(value))
}

async function workspaceFor(agent) {
  const cwd = agent?.workspacePath ?? agent?.session?.header?.cwd
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw fail('需要已加载的能力包专属工作区。')
  try {
    const workspace = await realpath(cwd)
    const stats = await lstat(workspace)
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('invalid')
    return workspace
  } catch (_) { throw fail('能力包专属工作区不可用，请重新加载能力包后重试。') }
}
async function directory(path, create = true) {
  if (create) await mkdir(path, { recursive: true, mode: 0o700 })
  try {
    const stats = await lstat(path)
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw fail('数据目录无效。')
    return path
  } catch (error) { if (error?.code === 'ENOENT') return undefined; throw error }
}
async function rootFor(workspace, create = true) {
  return directory(spokenVideoDataPath(workspace), create)
}
async function readJson(path, fallback) {
  try {
    const stats = await lstat(path)
    if (!stats.isFile() || stats.isSymbolicLink()) throw fail('数据文件无效。')
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback()
    if (error instanceof SyntaxError) throw fail('数据文件不是有效 JSON。')
    throw error
  }
}
async function readSignalFile(path) {
  const raw = await readJson(path, defaults)
  const migrated = migrateSignalFile(raw)
  const data = signalFile(migrated.data)
  const droppedOrphans = Array.isArray(migrated.data?.signals) && data.signals.length !== migrated.data.signals.length
  if (migrated.changed || droppedOrphans) await writeJson(path, data)
  return data
}
async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temp = join(dirname(path), `.${randomUUID()}.tmp`)
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  await rename(temp, path)
}
function sourceKind(value) {
  const kind = text(value, '来源类型', 40)
  if (!SOURCE_KIND_OPTIONS.some((item) => item.id === kind)) throw fail('来源类型不受支持。')
  return kind
}
function sourceUrl(value, kind) {
  if (kind === 'github-releases') return optional(value, '来源地址', 1000)
  return text(value, '来源地址', 1000)
}
function repo(value, kind) {
  if (kind !== 'github-releases') return null
  const result = text(value, 'GitHub 仓库', 160)
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(result)) throw fail('GitHub 仓库必须使用 owner/repository 格式。')
  return result
}
function health(value) {
  const input = value && typeof value === 'object' ? value : {}
  const status = input.status === undefined ? 'never-run' : text(input.status, '来源状态', 32)
  if (!SOURCE_STATES.has(status)) throw fail('来源状态无效。')
  return {
    status, lastAttemptAt: optional(input.lastAttemptAt, '最近尝试时间', 64), lastSuccessAt: optional(input.lastSuccessAt, '最近成功时间', 64),
    lastError: optional(input.lastError, '最近错误', 500), lastHttpStatus: input.lastHttpStatus == null ? null : integer(input.lastHttpStatus, '最近 HTTP 状态', 100, 599),
    lastDurationMs: input.lastDurationMs == null ? null : integer(input.lastDurationMs, '最近耗时', 0, 120_000), lastNewSignalCount: input.lastNewSignalCount == null ? 0 : integer(input.lastNewSignalCount, '最近新增数', 0, 500),
  }
}
function source(value) {
  const item = object(value, '信号来源')
  const kind = sourceKind(item.kind)
  return {
    id: sourceId(item.id), name: text(item.name, '来源名称', 120), kind, url: sourceUrl(item.url, kind), repository: repo(item.repository, kind), enabled: bool(item.enabled, '来源启用状态'),
    intervalMinutes: integer(item.intervalMinutes, '采集间隔', 5, 10_080), maxItems: integer(item.maxItems, '单次上限', 1, 500), requiredKeywords: strings(item.requiredKeywords, '必须包含关键词', 12, 80),
    excludeKeywords: strings(item.excludeKeywords, '排除关键词', 12, 80), tags: strings(item.tags, '来源标签', 8, 32), family: optional(item.family, '来源分组', 40) || '自定义',
    createdAt: text(item.createdAt, '来源创建时间', 64), updatedAt: text(item.updatedAt, '来源更新时间', 64), cache: { etag: optional(item.cache?.etag, 'ETag', 500), lastModified: optional(item.cache?.lastModified, 'Last-Modified', 500) }, health: health(item.health),
  }
}
function signal(value) {
  const item = object(value, '信号')
  const state = item.state === undefined ? 'active' : text(item.state, '信号状态', 16)
  if (!SIGNAL_STATES.has(state)) throw fail('信号状态无效。')
  return {
    id: uuid(item.id, '信号标识'), sourceId: sourceId(item.sourceId), title: text(item.title, '信号标题', 240), summary: text(item.summary, '信号摘要', 3000), url: optional(item.url, '信号链接', 1000),
    publishedAt: optional(item.publishedAt, '发布时间', 64), capturedAt: text(item.capturedAt, '采集时间', 64), rank: item.rank == null ? null : integer(item.rank, '来源排名', 1, 10_000),
    hotValue: item.hotValue == null ? null : integer(item.hotValue, '热度', 0, Number.MAX_SAFE_INTEGER), tags: strings(item.tags, '信号标签', 8, 32), score: item.score == null ? 0 : integer(item.score, '信号评分', 0, 100),
    fingerprint: text(item.fingerprint, '信号指纹', 100), state, platform: item.platform == null ? null : text(item.platform, '信号平台', 32),
    firstSeenAt: text(item.firstSeenAt || item.capturedAt, '首次发现时间', 64),
    lastSeenAt: text(item.lastSeenAt || item.capturedAt, '最近发现时间', 64),
  }
}
function run(value) {
  const item = object(value, '信号采集记录')
  const status = text(item.status, '采集状态', 16)
  if (!RUN_STATES.has(status)) throw fail('采集状态无效。')
  return {
    id: uuid(item.id, '采集记录标识'), sourceId: sourceId(item.sourceId), reason: text(item.reason, '采集触发方式', 40), status, startedAt: text(item.startedAt, '采集开始时间', 64), completedAt: text(item.completedAt, '采集完成时间', 64),
    durationMs: integer(item.durationMs, '采集耗时', 0, 120_000), httpStatus: item.httpStatus == null ? null : integer(item.httpStatus, 'HTTP 状态', 100, 599), fetchedCount: integer(item.fetchedCount, '读取数量', 0, 500),
    filteredCount: integer(item.filteredCount, '过滤数量', 0, 500), addedCount: integer(item.addedCount, '新增数量', 0, 500), duplicateCount: integer(item.duplicateCount, '重复数量', 0, 500), message: text(item.message, '采集信息', 500),
  }
}
function batch(value) {
  const item = object(value, '信号采集批次')
  const status = text(item.status, '批次状态', 16)
  if (!BATCH_STATES.has(status)) throw fail('批次状态无效。')
  if (!Array.isArray(item.signalIds) || item.signalIds.length > 500) throw fail('批次信号最多包含 500 条。')
  return {
    id: uuid(item.id, '采集批次标识'), sourceId: sourceId(item.sourceId), runId: uuid(item.runId, '采集记录标识'),
    status, completedAt: text(item.completedAt, '批次完成时间', 64), signalIds: [...new Set(item.signalIds.map((id) => uuid(id, '批次信号标识')))],
  }
}
function defaultSource(item, timestamp) { return { ...item, createdAt: timestamp, updatedAt: timestamp, cache: { etag: null, lastModified: null }, health: health({}, item.kind) } }
function defaults() {
  const timestamp = now()
  return {
    schemaVersion: SIGNAL_SCHEMA,
    sources: DEFAULT_SIGNAL_SOURCES.map((item) => defaultSource(item, timestamp)), signals: [], runs: [], batches: [],
  }
}
function legacyBatches(signals, runs) {
  const latestRunBySourceAndTime = new Map()
  for (const item of runs) {
    if (item?.status !== 'success' || typeof item.sourceId !== 'string' || typeof item.completedAt !== 'string') continue
    latestRunBySourceAndTime.set(`${item.sourceId}\u0000${item.completedAt}`, item.id)
  }
  const grouped = new Map()
  for (const item of signals) {
    if (!item || typeof item.sourceId !== 'string' || typeof item.capturedAt !== 'string' || !validUuid(item.id)) continue
    const key = `${item.sourceId}\u0000${item.capturedAt}`
    const current = grouped.get(key) || { sourceId: item.sourceId, completedAt: item.capturedAt, signalIds: [] }
    current.signalIds.push(item.id)
    grouped.set(key, current)
  }
  return [...grouped.values()].map((item) => ({
    id: randomUUID(), sourceId: item.sourceId, runId: latestRunBySourceAndTime.get(`${item.sourceId}\u0000${item.completedAt}`) || randomUUID(),
    status: 'success', completedAt: item.completedAt, signalIds: [...new Set(item.signalIds)],
  }))
}
function migrateSignalFile(value) {
  if (value?.schemaVersion === SIGNAL_SCHEMA) return { data: value, changed: false }
  let data = value
  let changed = false
  if (data?.schemaVersion === 8 && Array.isArray(data.sources) && Array.isArray(data.signals) && Array.isArray(data.runs)) {
    const retiredIds = new Set(data.sources.filter((item) => item?.kind === RETIRED_SIGNAL_SOURCE_KIND).map((item) => item.id))
    data = {
      ...data,
      schemaVersion: 9,
      sources: data.sources.filter((item) => !retiredIds.has(item?.id)),
      signals: data.signals.filter((item) => !retiredIds.has(item?.sourceId)),
      runs: data.runs.filter((item) => !retiredIds.has(item?.sourceId)),
    }
    changed = true
  }
  if (data?.schemaVersion === 9 && Array.isArray(data.sources) && Array.isArray(data.signals) && Array.isArray(data.runs)) {
    data = {
      ...data,
      schemaVersion: SIGNAL_SCHEMA,
      signals: data.signals.map((item) => ({ ...item, firstSeenAt: item?.firstSeenAt || item?.capturedAt, lastSeenAt: item?.lastSeenAt || item?.capturedAt })),
      batches: legacyBatches(data.signals, data.runs),
    }
    changed = true
  }
  return { data, changed }
}
function signalFile(value) {
  if (value?.schemaVersion !== SIGNAL_SCHEMA || !Array.isArray(value.sources) || !Array.isArray(value.signals) || !Array.isArray(value.runs) || !Array.isArray(value.batches)) throw fail('信号池文件版本不受支持。')
  const sources = value.sources.map(source)
  if (new Set(sources.map((item) => item.id)).size !== sources.length) throw fail('存在重复来源标识。')
  const ids = new Set(sources.map((item) => item.id))
  const signals = value.signals.filter((item) => ids.has(item.sourceId)).map(signal)
  const signalIds = new Set(signals.map((item) => item.id))
  const batches = value.batches.filter((item) => ids.has(item?.sourceId)).map(batch).map((item) => ({ ...item, signalIds: item.signalIds.filter((id) => signalIds.has(id)) })).slice(-1_000)
  return { schemaVersion: SIGNAL_SCHEMA, sources, signals, runs: value.runs.map(run).slice(-300), batches }
}
function signalObservedAt(item) { return item?.lastSeenAt || item?.capturedAt || null }
function inLocalDay(iso, clock) {
  if (typeof iso !== 'string') return false
  const { startIso, endIso } = localDayBounds(clock)
  return iso >= startIso && iso < endIso
}
function latestBatchForSource(data, sourceIdValue) {
  return data.batches.filter((item) => item.sourceId === sourceIdValue).sort((left, right) => right.completedAt.localeCompare(left.completedAt))[0] || null
}
function selectedTopicSourceIds(data, input) {
  return input.sourceIds.length ? input.sourceIds : data.sources.filter((item) => item.enabled).map((item) => item.id)
}
function latestBatchMaterial(data, sourceIds) {
  const bySignalId = new Map(data.signals.map((item) => [item.id, item]))
  const signals = []
  const seenIds = new Set()
  const batches = []
  for (const sourceIdValue of sourceIds) {
    const current = latestBatchForSource(data, sourceIdValue)
    if (!current) continue
    let signalCount = 0
    for (const id of current.signalIds) {
      const item = bySignalId.get(id)
      if (!item || seenIds.has(id)) continue
      seenIds.add(id)
      signalCount += 1
      signals.push({ ...item, sourceId: sourceIdValue, capturedAt: current.completedAt })
    }
    batches.push({ sourceId: sourceIdValue, batchId: current.id, completedAt: current.completedAt, status: current.status, signalCount })
  }
  return { signals, batches }
}
function pruneSignalData(data, timestamp) {
  const cutoff = Date.parse(timestamp) - SIGNAL_RETENTION_DAYS * 24 * 60 * 60 * 1000
  if (!Number.isFinite(cutoff)) return false
  const keep = (iso) => {
    const parsed = Date.parse(iso || '')
    return !Number.isFinite(parsed) || parsed >= cutoff
  }
  const beforeSignals = data.signals.length
  const beforeBatches = data.batches.length
  data.signals = data.signals.filter((item) => keep(signalObservedAt(item)))
  const ids = new Set(data.signals.map((item) => item.id))
  data.batches = data.batches
    .filter((item) => keep(item.completedAt))
    .map((item) => ({ ...item, signalIds: item.signalIds.filter((id) => ids.has(id)) }))
  return beforeSignals !== data.signals.length || beforeBatches !== data.batches.length
}
const ACCOUNT_LIBRARY_SCHEMA = 2
const LEGACY_TOPIC_PROFILE_SCHEMA = 1
const ACCOUNT_LIMIT = 50
const ACCOUNT_STATES = new Set(['active', 'archived'])
const TOPIC_GENERATION_SCHEMA = 1
const TOPIC_GENERATION_HISTORY_LIMIT = 40
const TOPIC_GENERATION_CONCURRENCY = 2
const ACTIVE_TOPIC_GENERATION_STATUSES = new Set(['queued', 'running'])
const CANDIDATE_SELECTION_STATES = new Set(['available', 'activating', 'deactivating', 'selected'])
function emptyAccountLibrary() { return { schemaVersion: ACCOUNT_LIBRARY_SCHEMA, defaultAccountId: null, accounts: [] } }
function accountRecord(value) {
  const input = object(value, '账号定位')
  const status = input.status === undefined ? 'active' : text(input.status, '账号状态', 16)
  if (!ACCOUNT_STATES.has(status)) throw fail('账号状态无效。')
  const profile = parseProfile(input)
  return {
    id: uuid(input.id, '账号定位标识'),
    name: text(input.name, '账号名称', 80),
    status,
    revision: integer(input.revision, '账号定位版本', 1, Number.MAX_SAFE_INTEGER),
    positioning: profile.positioning,
    audience: profile.audience,
    pillars: profile.pillars,
    boundary: profile.boundary,
    createdAt: text(input.createdAt, '账号创建时间', 64),
    updatedAt: text(input.updatedAt, '账号更新时间', 64),
  }
}
function accountLibraryFile(value, timestamp) {
  if (value?.schemaVersion === ACCOUNT_LIBRARY_SCHEMA) {
    if (!Array.isArray(value.accounts) || value.accounts.length > ACCOUNT_LIMIT) throw fail('账号定位库文件无效。')
    const accounts = value.accounts.map(accountRecord)
    if (new Set(accounts.map((item) => item.id)).size !== accounts.length) throw fail('账号定位库包含重复标识。')
    const defaultAccountId = value.defaultAccountId == null ? null : uuid(value.defaultAccountId, '默认账号定位标识')
    if (defaultAccountId && !accounts.some((item) => item.id === defaultAccountId && item.status === 'active')) {
      throw fail('默认账号定位不存在或已归档。')
    }
    return { data: { schemaVersion: ACCOUNT_LIBRARY_SCHEMA, defaultAccountId, accounts }, migrated: false }
  }
  if (value?.schemaVersion === LEGACY_TOPIC_PROFILE_SCHEMA) {
    const profile = parseProfile(value.profile)
    if (!hasProfile(profile)) return { data: emptyAccountLibrary(), migrated: true }
    const updatedAt = profile.updatedAt || timestamp
    const account = {
      id: randomUUID(), name: '原有账号定位', status: 'active', revision: 1,
      positioning: profile.positioning, audience: profile.audience, pillars: profile.pillars, boundary: profile.boundary,
      createdAt: updatedAt, updatedAt,
    }
    return { data: { schemaVersion: ACCOUNT_LIBRARY_SCHEMA, defaultAccountId: account.id, accounts: [account] }, migrated: true }
  }
  throw fail('账号定位库文件版本不受支持。')
}
async function readAccountLibrary(path, timestamp) {
  const result = accountLibraryFile(await readJson(path, emptyAccountLibrary), timestamp)
  if (result.migrated) await writeJson(path, result.data)
  return result.data
}
function accountView(account) { return { ...account, pillars: [...account.pillars], configured: hasProfile(account) } }
function accountLibraryView(data) { return { defaultAccountId: data.defaultAccountId, accounts: data.accounts.map(accountView) } }
function defaultAccount(data) { return data.defaultAccountId ? data.accounts.find((item) => item.id === data.defaultAccountId && item.status === 'active') || null : null }
function profileView(account) {
  const profile = account
    ? { positioning: account.positioning, audience: account.audience, pillars: [...account.pillars], boundary: account.boundary, updatedAt: account.updatedAt }
    : emptyProfile()
  return { ...profile, configured: hasProfile(profile), accountId: account?.id || null, accountName: account?.name || null, accountRevision: account?.revision || null }
}
function accountNameAvailable(accounts, name, exceptId = null) {
  const normalized = name.trim().toLocaleLowerCase()
  return !accounts.some((item) => item.status === 'active' && item.id !== exceptId && item.name.toLocaleLowerCase() === normalized)
}
function selectedAccount(data, accountId) {
  if (!accountId) return null
  const account = data.accounts.find((item) => item.id === accountId && item.status === 'active')
  if (!account) throw fail('所选账号定位不存在或已归档。')
  return account
}
function validUuid(value) { return typeof value === 'string' && UUID.test(value) }
function upgradeTopicGeneration(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return { record, changed: false }
  const legacyProjectId = validUuid(record.confirmedProjectId) ? record.confirmedProjectId.toLowerCase() : null
  const legacyTitle = typeof record.confirmedTitle === 'string' ? record.confirmedTitle : null
  let legacyApplied = false
  let changed = false
  const candidates = Array.isArray(record.candidates) ? record.candidates.map((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate
    const id = validUuid(candidate.id) ? candidate.id.toLowerCase() : randomUUID()
    const raw = candidate.selection && typeof candidate.selection === 'object' && !Array.isArray(candidate.selection) ? candidate.selection : null
    const legacySelected = !legacyApplied && legacyProjectId && legacyTitle === candidate.title
    if (legacySelected) legacyApplied = true
    const selection = {
      state: raw && CANDIDATE_SELECTION_STATES.has(raw.state) ? raw.state : legacySelected ? 'selected' : 'available',
      projectId: validUuid(raw?.projectId) ? raw.projectId.toLowerCase() : legacySelected ? legacyProjectId : null,
      selectedAt: typeof raw?.selectedAt === 'string' ? raw.selectedAt : legacySelected ? record.confirmedAt || null : null,
      deselectedAt: typeof raw?.deselectedAt === 'string' ? raw.deselectedAt : null,
      source: raw?.source === 'recommended' || raw?.source === 'manual' ? raw.source : legacySelected ? 'manual' : null,
      error: typeof raw?.error === 'string' ? raw.error : null,
    }
    const next = { ...candidate, id, selection }
    if (candidate.id !== id || JSON.stringify(candidate.selection || null) !== JSON.stringify(selection)) changed = true
    return next
  }) : []
  if (!Array.isArray(record.candidates)) changed = true
  const unavailableSources = Array.isArray(record.unavailableSources)
    ? record.unavailableSources
      .filter((item) => item && typeof item === 'object' && typeof item.id === 'string')
      .map((item) => ({ id: item.id, name: typeof item.name === 'string' && item.name ? item.name : item.id, error: typeof item.error === 'string' ? item.error : null }))
    : []
  if (!Array.isArray(record.unavailableSources)) changed = true
  return { record: { ...record, candidates, unavailableSources }, changed }
}
function topicGenerationsFile(value) {
  if (value?.schemaVersion !== TOPIC_GENERATION_SCHEMA || !Array.isArray(value.generations)) {
    return { data: { schemaVersion: TOPIC_GENERATION_SCHEMA, generations: [] }, changed: false }
  }
  let changed = false
  const upgraded = value.generations.map((item) => {
    const upgraded = upgradeTopicGeneration(item)
    changed ||= upgraded.changed
    return upgraded.record
  })
  // Finished history is bounded, but queued/running work must never be pruned
  // while its background worker still needs to update the record.
  const terminalIndexes = upgraded.map((item, index) => ACTIVE_TOPIC_GENERATION_STATUSES.has(item?.status) ? null : index).filter((index) => index !== null)
  const retainedTerminalIndexes = new Set(terminalIndexes.slice(-TOPIC_GENERATION_HISTORY_LIMIT))
  const generations = upgraded.filter((item, index) => ACTIVE_TOPIC_GENERATION_STATUSES.has(item?.status) || retainedTerminalIndexes.has(index))
  changed ||= generations.length !== upgraded.length
  return { data: { schemaVersion: TOPIC_GENERATION_SCHEMA, generations }, changed }
}
function emptyTopicGenerationsFile() { return { schemaVersion: TOPIC_GENERATION_SCHEMA, generations: [] } }
const SCRIPT_GENERATION_SCHEMA = 1
const SCRIPT_GENERATION_CONCURRENCY = 2
const ACTIVE_SCRIPT_GENERATION_STATUSES = new Set(['queued', 'running'])
function scriptGenerationsFile(value) {
  if (value?.schemaVersion !== SCRIPT_GENERATION_SCHEMA || !Array.isArray(value.generations)) return { schemaVersion: SCRIPT_GENERATION_SCHEMA, generations: [] }
  const active = value.generations.filter((item) => ACTIVE_SCRIPT_GENERATION_STATUSES.has(item?.status))
  const terminal = value.generations.filter((item) => !ACTIVE_SCRIPT_GENERATION_STATUSES.has(item?.status)).slice(-40)
  return { schemaVersion: SCRIPT_GENERATION_SCHEMA, generations: [...active, ...terminal] }
}
function emptyScriptGenerationsFile() { return { schemaVersion: SCRIPT_GENERATION_SCHEMA, generations: [] } }
function sourceSummary(item, data) {
  const own = data.signals.filter((signal) => signal.sourceId === item.id)
  const latest = [...own].sort((left, right) => signalObservedAt(right).localeCompare(signalObservedAt(left)))[0]
  const currentBatch = latestBatchForSource(data, item.id)
  return {
    id: item.id, name: item.name, kind: item.kind, url: item.url, enabled: item.enabled, intervalMinutes: item.intervalMinutes, family: item.family, health: { ...item.health },
    latestCapturedAt: currentBatch?.completedAt || signalObservedAt(latest) || null, latestTitle: latest?.title || null, signalCount: own.length,
  }
}
function due(item, clock = Date.now()) { const last = Date.parse(item.health.lastAttemptAt || ''); return item.enabled && (!Number.isFinite(last) || clock - last >= item.intervalMinutes * 60_000) }
function localDayBounds(date) {
  const pad = (value) => String(value).padStart(2, '0')
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
  return { date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, startIso: start.toISOString(), endIso: end.toISOString() }
}
function projectSignal(item) { return { id: item.id, title: item.title, url: item.url, rank: item.rank, hotValue: item.hotValue, score: item.score, capturedAt: signalObservedAt(item), state: item.state, platform: item.platform, tags: [...item.tags] } }
function freshnessFor(lastIso, clock) {
  const ageHours = (clock.getTime() - Date.parse(lastIso)) / 3_600_000
  if (!Number.isFinite(ageHours)) return 'unknown'
  if (ageHours <= 72) return 'fresh'
  if (ageHours <= 168) return 'recent'
  return 'stale'
}
function buildBoard(data, clock) {
  const today = localDayBounds(clock)
  const inToday = (iso) => typeof iso === 'string' && iso >= today.startIso && iso < today.endIso
  const byScore = (left, right) => right.score - left.score || signalObservedAt(right).localeCompare(signalObservedAt(left))
  const previewOf = (pool) => { const todayItems = pool.filter((item) => inToday(signalObservedAt(item))); const source = todayItems.length ? todayItems : pool; return { previewScope: todayItems.length ? 'today' : 'latest', preview: [...source].sort(byScore).slice(0, 3).map(projectSignal) } }
  const sources = data.sources.map((item) => {
    const own = data.signals.filter((signalItem) => signalItem.sourceId === item.id)
    return {
      id: item.id, name: item.name, family: item.family, kind: item.kind, enabled: item.enabled,
      platform: platformForSource(item.id, item.kind),
      status: item.health.status, lastError: item.health.lastError, lastSuccessAt: item.health.lastSuccessAt, lastAttemptAt: item.health.lastAttemptAt, intervalMinutes: item.intervalMinutes,
      todayCount: own.filter((signalItem) => inToday(signalObservedAt(signalItem))).length,
      activeCount: own.filter((signalItem) => signalItem.state === 'active').length,
      savedCount: own.filter((signalItem) => signalItem.state === 'saved').length,
      ...previewOf(own),
    }
  })
  const aiSignals = data.signals.filter((item) => item.sourceId === 'ai-daily-import')
  const byPlatform = new Map()
  for (const item of aiSignals) { const key = item.platform || '其他'; if (!byPlatform.has(key)) byPlatform.set(key, []); byPlatform.get(key).push(item) }
  const platformCard = (platform, items) => {
    const lastImportedAt = items.length ? items.map(signalObservedAt).sort().at(-1) : null
    return { platform, totalCount: items.length, todayCount: items.filter((item) => inToday(signalObservedAt(item))).length, lastImportedAt, freshness: lastImportedAt ? freshnessFor(lastImportedAt, clock) : 'none', ...previewOf(items) }
  }
  const knownCards = AI_DAILY_PLATFORMS.map((platform) => platformCard(platform, byPlatform.get(platform) || []))
  const extraCards = [...byPlatform.entries()].filter(([platform]) => !AI_DAILY_PLATFORMS.includes(platform)).map(([platform, items]) => platformCard(platform, items))
  const aiDaily = { sourceId: 'ai-daily-import', platforms: [...knownCards, ...extraCards] }
  const collectable = data.sources.filter((item) => item.enabled)
  const lastCollectAt = data.sources.map((item) => item.health.lastAttemptAt).filter((iso) => typeof iso === 'string').sort().at(-1) || null
  return {
    today,
    totals: {
      todayNew: data.signals.filter((item) => inToday(signalObservedAt(item))).length,
      active: data.signals.filter((item) => item.state === 'active').length,
      saved: data.signals.filter((item) => item.state === 'saved').length,
      ignored: data.signals.filter((item) => item.state === 'ignored').length,
      errorSources: data.sources.filter((item) => item.health.status === 'error').length,
      collectableSources: collectable.length,
      collectedToday: collectable.filter((item) => inToday(item.health.lastAttemptAt)).length,
      lastCollectAt,
    },
    sources,
    aiDaily,
  }
}
/** Package-owned source catalogue, collector runs, and the deduplicated signal pool. */
export class SpokenVideoContentStore {
  constructor(options = {}) { this.workspacePath = options.workspacePath; this.background = options.background || ((work) => work); this.writes = new Map(); this.genWrites = new Map(); this.fetch = options.fetch; this.resolveHostname = options.resolveHostname; this.now = options.now || now; this.topicExecutor = typeof options.topicExecutor === 'function' ? options.topicExecutor : null; this.scriptExecutor = typeof options.scriptExecutor === 'function' ? options.scriptExecutor : null; this.accountExecutor = typeof options.accountExecutor === 'function' ? options.accountExecutor : null; this.projectsStore = options.projectsStore || null; this.topicQueues = new Map(); this.topicRuns = new Map(); this.topicConcurrency = Number.isSafeInteger(options.topicConcurrency) && options.topicConcurrency >= 1 && options.topicConcurrency <= 8 ? options.topicConcurrency : TOPIC_GENERATION_CONCURRENCY; this.scriptQueues = new Map(); this.scriptRuns = new Map(); this.scriptConcurrency = Number.isSafeInteger(options.scriptConcurrency) && options.scriptConcurrency >= 1 && options.scriptConcurrency <= 8 ? options.scriptConcurrency : SCRIPT_GENERATION_CONCURRENCY }
  async serial(workspace, operation) { const previous = this.writes.get(workspace) || Promise.resolve(); const result = previous.then(operation); const tail = result.catch(() => {}); this.writes.set(workspace, tail); try { return await result } finally { if (this.writes.get(workspace) === tail) this.writes.delete(workspace) } }
  async serialGen(workspace, operation) { const previous = this.genWrites.get(workspace) || Promise.resolve(); const result = previous.then(operation); const tail = result.catch(() => {}); this.genWrites.set(workspace, tail); try { return await result } finally { if (this.genWrites.get(workspace) === tail) this.genWrites.delete(workspace) } }
  async paths(agent) { const workspace = await workspaceFor(agent); this.assertWorkspace(workspace); const root = await rootFor(workspace); return { workspace, signals: join(root, 'signals.json'), profile: join(root, 'topic-profile.json'), generations: join(root, 'topic-generations.json'), scriptGenerations: join(root, 'script-generations.json') } }
  async pathsForWorkspace(workspace) { this.assertWorkspace(workspace); const root = await rootFor(workspace); return { signals: join(root, 'signals.json'), profile: join(root, 'topic-profile.json'), generations: join(root, 'topic-generations.json'), scriptGenerations: join(root, 'script-generations.json') } }
  assertWorkspace(workspace) { if (this.workspacePath && workspace !== this.workspacePath) throw fail('能力包工作区不匹配。') }
  collectorOptions() { return { fetch: this.fetch, resolveHostname: this.resolveHostname, now: this.now } }

  async sources(agent) { const { workspace, signals } = await this.paths(agent); return this.serial(workspace, async () => { const data = await readSignalFile(signals); if (pruneSignalData(data, this.now())) await writeJson(signals, data); return data.sources.map((item) => sourceSummary(item, data)) }) }
  async sourceRuns(agent) { const { workspace, signals } = await this.paths(agent); return this.serial(workspace, async () => (await readSignalFile(signals)).runs.sort((a, b) => b.completedAt.localeCompare(a.completedAt)).slice(0, 100)) }

  async setSourceEnabled(agent, request) {
    const input = object(request, '启停信号来源请求'); const { workspace, signals } = await this.paths(agent)
    return this.serial(workspace, async () => {
      const data = await readSignalFile(signals); const current = data.sources.find((item) => item.id === sourceId(input.sourceId)); if (!current) throw fail('信号来源不存在。')
      current.enabled = bool(input.enabled, '来源启用状态'); current.updatedAt = this.now()
      await writeJson(signals, data); return sourceSummary(current, data)
    })
  }

  async collectWorkspace(workspace, sourceIds, reason) {
    const paths = await this.pathsForWorkspace(workspace)
    return this.serial(workspace, async () => {
      const data = await readSignalFile(paths.signals); const selected = sourceIds === undefined ? data.sources.filter(due).map((item) => item.id) : [...new Set(sourceIds.map((id) => sourceId(id)))]
      if (selected.some((id) => !data.sources.some((item) => item.id === id))) throw fail('包含不存在的信号来源。')
      const runs = []
      for (const id of selected) {
        const item = data.sources.find((source) => source.id === id); if (!item) continue
        const startedAt = this.now(); let record
        try {
          let collected = await collectSignalSource(item, this.collectorOptions())
          // A retained 304 snapshot is fresh material. If retention has already
          // removed that snapshot, retry without validators so a bare 304 cannot
          // masquerade as current data with nothing to use for topic generation.
          if (collected.status === 'skipped' && !latestBatchForSource(data, item.id)) {
            collected = await collectSignalSource({ ...item, cache: { etag: null, lastModified: null } }, this.collectorOptions())
          }
          // Deduplication belongs to a channel. A link appearing in two channels
          // remains auditable in both snapshots, while the topic prompt later
          // removes duplicate signal IDs across the selected latest batches.
          const fingerprints = new Map(data.signals.filter((signal) => signal.sourceId === item.id).map((signal) => [signal.fingerprint, signal]))
          const runId = randomUUID()
          let addedCount = 0
          let duplicateCount = 0
          let batchSignalIds = []
          if (collected.status === 'skipped') {
            // A 304 response is a successful, fresh observation of the last
            // materialized snapshot. Retain that snapshot as this run's batch.
            batchSignalIds = [...(latestBatchForSource(data, item.id)?.signalIds || [])]
            const byId = new Map(data.signals.map((signal) => [signal.id, signal]))
            for (const signalId of batchSignalIds) {
              const previous = byId.get(signalId)
              if (previous) previous.lastSeenAt = collected.completedAt
            }
          } else {
            for (const candidate of collected.fetched) {
              const fingerprint = fingerprintSignal(candidate)
              const existing = fingerprints.get(fingerprint)
              if (existing) {
                duplicateCount += 1
                // Keep the durable identity and any user-applied state, but let
                // the latest observation replace the source-provided payload.
                // Otherwise a repeated URL would make a new batch display old
                // titles, summaries, ranks, and scoring in topic generation.
                Object.assign(existing, {
                  title: candidate.title,
                  summary: candidate.summary || '该来源未提供摘要。',
                  url: candidate.url,
                  publishedAt: candidate.publishedAt,
                  capturedAt: collected.completedAt,
                  rank: candidate.rank,
                  hotValue: candidate.hotValue,
                  tags: [...new Set([...item.tags, ...candidate.tags])].slice(0, 8),
                  score: scoreSignal(candidate),
                  platform: candidate.platform || platformForSource(item.id, item.kind),
                  lastSeenAt: collected.completedAt,
                })
                batchSignalIds.push(existing.id)
                continue
              }
              const next = signal({
                id: randomUUID(), sourceId: item.id, title: candidate.title, summary: candidate.summary || '该来源未提供摘要。', url: candidate.url,
                publishedAt: candidate.publishedAt, capturedAt: collected.completedAt, firstSeenAt: collected.completedAt, lastSeenAt: collected.completedAt,
                rank: candidate.rank, hotValue: candidate.hotValue, tags: [...new Set([...item.tags, ...candidate.tags])].slice(0, 8),
                score: scoreSignal(candidate), fingerprint, state: 'active', platform: candidate.platform || platformForSource(item.id, item.kind),
              })
              fingerprints.set(fingerprint, next)
              data.signals.unshift(next)
              batchSignalIds.push(next.id)
              addedCount += 1
            }
          }
          item.cache = { etag: collected.etag, lastModified: collected.lastModified }
          item.health = { status: 'ready', lastAttemptAt: startedAt, lastSuccessAt: collected.completedAt, lastError: null, lastHttpStatus: collected.httpStatus, lastDurationMs: ms(startedAt, collected.completedAt), lastNewSignalCount: addedCount }
          item.updatedAt = collected.completedAt
          record = run({ id: runId, sourceId: item.id, reason, status: collected.status === 'skipped' ? 'skipped' : 'success', startedAt, completedAt: collected.completedAt, durationMs: ms(startedAt, collected.completedAt), httpStatus: collected.httpStatus, fetchedCount: collected.fetched.length, filteredCount: collected.filteredCount, addedCount, duplicateCount, message: collected.status === 'skipped' ? '来源内容未变化（HTTP 304）。' : `读取 ${collected.fetched.length} 条，新增 ${addedCount} 条，去重 ${duplicateCount} 条。` })
          data.batches.unshift(batch({ id: randomUUID(), sourceId: item.id, runId, status: collected.status === 'skipped' ? 'unchanged' : 'success', completedAt: collected.completedAt, signalIds: [...new Set(batchSignalIds)] }))
        } catch (error) {
          const completedAt = this.now(); const message = error instanceof SignalAdapterError ? error.message : `采集失败：${String(error?.message || error).slice(0, 300)}`; item.health = { status: 'error', lastAttemptAt: startedAt, lastSuccessAt: item.health.lastSuccessAt, lastError: message, lastHttpStatus: null, lastDurationMs: ms(startedAt, completedAt), lastNewSignalCount: 0 }; item.updatedAt = completedAt
          record = run({ id: randomUUID(), sourceId: item.id, reason, status: 'failed', startedAt, completedAt, durationMs: ms(startedAt, completedAt), httpStatus: null, fetchedCount: 0, filteredCount: 0, addedCount: 0, duplicateCount: 0, message })
        }
        data.runs.unshift(record); runs.push(record)
      }
      data.runs = data.runs.slice(0, 300)
      data.batches = data.batches.slice(0, 1_000)
      pruneSignalData(data, this.now())
      await writeJson(paths.signals, data)
      return runs
    })
  }
  async collectSources(agent, request) { const input = object(request ?? {}, '采集信号请求'); const { workspace, signals } = await this.paths(agent); const data = await this.serial(workspace, () => readSignalFile(signals)); const ids = input.sourceIds === undefined ? data.sources.filter((item) => item.enabled).map((item) => item.id) : strings(input.sourceIds, '采集来源', 20, 63); return this.collectWorkspace(workspace, ids, 'on-demand') }

  async listSignals(agent, request) {
    const input = object(request ?? {}, '读取信号请求'); const { workspace, signals } = await this.paths(agent); const data = await this.serial(workspace, async () => { const current = await readSignalFile(signals); if (pruneSignalData(current, this.now())) await writeJson(signals, current); return current }); const selected = input.sourceIds === undefined ? null : new Set(strings(input.sourceIds, '来源筛选', 20, 63)); const ids = input.ids === undefined ? null : new Set(strings(input.ids, '信号标识筛选', 60, 63)); const state = input.state === undefined || input.state === 'all' ? null : text(input.state, '信号状态筛选', 16); const platform = input.platform === undefined || input.platform === null ? null : text(input.platform, '信号平台筛选', 32); const query = input.query === undefined ? '' : String(input.query).trim().toLowerCase(); const limit = input.limit === undefined ? 500 : integer(input.limit, '信号读取上限', 1, 500)
    if (state && !SIGNAL_STATES.has(state)) throw fail('信号状态筛选无效。')
    // An explicit ids filter is an exact lookup (e.g. resolving a candidate's signal
    // references): it bypasses the time-ordered limit so referenced signals are never truncated away.
    if (ids) return data.signals.filter((item) => ids.has(item.id) && (!state || item.state === state)).sort((a, b) => signalObservedAt(b).localeCompare(signalObservedAt(a)) || b.score - a.score)
    return data.signals.filter((item) => (!selected || selected.has(item.sourceId)) && (!state || item.state === state) && (!platform || (item.platform || '其他') === platform) && (!query || `${item.title}\n${item.summary}\n${item.tags.join(' ')}`.toLowerCase().includes(query))).sort((a, b) => signalObservedAt(b).localeCompare(signalObservedAt(a)) || b.score - a.score).slice(0, limit)
  }
  async board(agent) {
    const { workspace, signals } = await this.paths(agent)
    return this.serial(workspace, async () => { const data = await readSignalFile(signals); if (pruneSignalData(data, this.now())) await writeJson(signals, data); return buildBoard(data, new Date(this.now())) })
  }
  async setSignalState(agent, request) { const input = object(request, '更新信号状态请求'); const { workspace, signals } = await this.paths(agent); return this.serial(workspace, async () => { const data = await readSignalFile(signals); const item = data.signals.find((signal) => signal.id === uuid(input.signalId, '信号标识')); const state = text(input.state, '信号状态', 16); if (!item) throw fail('信号不存在。'); if (!SIGNAL_STATES.has(state)) throw fail('信号状态无效。'); item.state = state; await writeJson(signals, data); return item }) }

  /** Compatibility projection for the old singleton RPC. New callers use account-library RPCs. */
  async getProfile(agent) {
    const { workspace, profile } = await this.paths(agent)
    return this.serial(workspace, async () => profileView(defaultAccount(await readAccountLibrary(profile, this.now()))))
  }

  /** Compatibility writer: updates the default account or creates one when none exists. */
  async setProfile(agent, request) {
    const { workspace, profile } = await this.paths(agent)
    return this.serial(workspace, async () => {
      const data = await readAccountLibrary(profile, this.now())
      const current = defaultAccount(data)
      const input = request && typeof request === 'object' && !Array.isArray(request) ? request : {}
      const timestamp = this.now()
      if (current) {
        const next = {
          ...current,
          ...parseProfile({ ...current, ...input }),
          revision: current.revision + 1,
          updatedAt: timestamp,
        }
        data.accounts = data.accounts.map((item) => item.id === current.id ? next : item)
        await writeJson(profile, data)
        return profileView(next)
      }
      const account = {
        id: randomUUID(), name: '默认账号定位', status: 'active', revision: 1,
        ...parseProfile(input), createdAt: timestamp, updatedAt: timestamp,
      }
      data.accounts.push(account)
      data.defaultAccountId = account.id
      await writeJson(profile, data)
      return profileView(account)
    })
  }

  async listAccounts(agent) {
    const { workspace, profile } = await this.paths(agent)
    return this.serial(workspace, async () => accountLibraryView(await readAccountLibrary(profile, this.now())))
  }

  async createAccount(agent, request) {
    const { workspace, profile } = await this.paths(agent)
    return this.serial(workspace, async () => {
      const input = object(request, '新建账号定位请求')
      const data = await readAccountLibrary(profile, this.now())
      if (data.accounts.length >= ACCOUNT_LIMIT) throw fail(`账号定位最多保存 ${ACCOUNT_LIMIT} 个。`)
      const name = text(input.name, '账号名称', 80)
      if (!accountNameAvailable(data.accounts, name)) throw fail('账号名称已存在。')
      const timestamp = this.now()
      const account = {
        id: randomUUID(), name, status: 'active', revision: 1,
        ...parseProfile(input), createdAt: timestamp, updatedAt: timestamp,
      }
      data.accounts.push(account)
      if (!data.defaultAccountId) data.defaultAccountId = account.id
      await writeJson(profile, data)
      return { account: accountView(account), library: accountLibraryView(data) }
    })
  }

  async updateAccount(agent, request) {
    const { workspace, profile } = await this.paths(agent)
    return this.serial(workspace, async () => {
      const input = object(request, '更新账号定位请求')
      const accountId = uuid(input.accountId, '账号定位标识')
      const data = await readAccountLibrary(profile, this.now())
      const current = data.accounts.find((item) => item.id === accountId)
      if (!current) throw fail('账号定位不存在。')
      const name = input.name === undefined ? current.name : text(input.name, '账号名称', 80)
      if (!accountNameAvailable(data.accounts, name, current.id)) throw fail('账号名称已存在。')
      const next = {
        ...current,
        name,
        ...parseProfile({ ...current, ...input }),
        revision: current.revision + 1,
        updatedAt: this.now(),
      }
      data.accounts = data.accounts.map((item) => item.id === accountId ? next : item)
      await writeJson(profile, data)
      return { account: accountView(next), library: accountLibraryView(data) }
    })
  }

  async setAccountStatus(agent, request) {
    const { workspace, profile } = await this.paths(agent)
    return this.serial(workspace, async () => {
      const input = object(request, '设置账号状态请求')
      const accountId = uuid(input.accountId, '账号定位标识')
      const status = text(input.status, '账号状态', 16)
      if (!ACCOUNT_STATES.has(status)) throw fail('账号状态无效。')
      const data = await readAccountLibrary(profile, this.now())
      const current = data.accounts.find((item) => item.id === accountId)
      if (!current) throw fail('账号定位不存在。')
      if (status === 'active' && !accountNameAvailable(data.accounts, current.name, current.id)) {
        throw fail('账号名称已存在，无法恢复。')
      }
      const next = { ...current, status, updatedAt: this.now() }
      data.accounts = data.accounts.map((item) => item.id === accountId ? next : item)
      if (status === 'archived' && data.defaultAccountId === accountId) data.defaultAccountId = null
      await writeJson(profile, data)
      return { account: accountView(next), library: accountLibraryView(data) }
    })
  }

  async setDefaultAccount(agent, request) {
    const { workspace, profile } = await this.paths(agent)
    return this.serial(workspace, async () => {
      const input = object(request, '设置默认账号请求')
      const accountId = input.accountId == null || (typeof input.accountId === 'string' && !input.accountId.trim()) ? null : uuid(input.accountId, '账号定位标识')
      const data = await readAccountLibrary(profile, this.now())
      if (accountId && !data.accounts.some((item) => item.id === accountId && item.status === 'active')) {
        throw fail('默认账号定位不存在或已归档。')
      }
      data.defaultAccountId = accountId
      await writeJson(profile, data)
      return accountLibraryView(data)
    })
  }

  /** Permanently remove an archived account. Active accounts must be archived first. */
  async deleteAccount(agent, request) {
    const { workspace, profile } = await this.paths(agent)
    return this.serial(workspace, async () => {
      const input = object(request, '删除账号定位请求')
      const accountId = uuid(input.accountId, '账号定位标识')
      const data = await readAccountLibrary(profile, this.now())
      const current = data.accounts.find((item) => item.id === accountId)
      if (!current) throw fail('账号定位不存在。')
      if (current.status !== 'archived') throw fail('启用中的账号不能直接删除，请先归档。')
      data.accounts = data.accounts.filter((item) => item.id !== accountId)
      await writeJson(profile, data)
      return { removed: accountId, library: accountLibraryView(data) }
    })
  }

  /**
   * Draft-polish account completion through the DSH structured sub-agent.
   * The AI may polish or rewrite the user's draft and fills every gap; the
   * suggestion is returned for the form and nothing is persisted here — the
   * human still saves through createAccount/updateAccount.
   */
  async suggestAccountProfile(agent, request) {
    const input = parseAccountCompletionInput(request)
    const { workspace, profile } = await this.paths(agent)
    if (typeof this.accountExecutor !== 'function') throw fail('账号完善执行器未接入（需要 accountExecutor）。')
    const id = request.executionId === undefined ? randomUUID() : uuid(request.executionId, '执行标识')
    const path = join(dirname(profile), 'account-generations.json')
    const patch = (mutate) => this.serialGen(workspace, async () => {
      const file = await readJson(path, () => ({ schemaVersion: 1, generations: [] }))
      const record = file.generations.find((item) => item.id === id)
      if (!record) throw fail('账号生成记录不存在。')
      mutate(record)
      await writeJson(path, file)
    })
    await this.serialGen(workspace, async () => {
      const file = await readJson(path, () => ({ schemaVersion: 1, generations: [] }))
      if (file.generations.some((item) => item.id === id)) throw fail('该账号生成任务已经提交。')
      file.generations = [...file.generations.filter((item) => item.status === 'running'), ...file.generations.filter((item) => item.status !== 'running').slice(-39), { id, status: 'running', input, startedAt: this.now(), dsh: dshTrace() }]
      await writeJson(path, file)
    })
    try {
      const structured = await this.accountExecutor({
        prompt: buildAccountCompletionPrompt({ input }), schema: ACCOUNT_COMPLETION_SCHEMA, agent,
        onDshStarted: (run) => patch((record) => { Object.assign(record.dsh, run); appendDshTrace(record.dsh, dshChildStarted(this.now())) }),
        onDshEvent: (event) => patch((record) => { appendDshTrace(record.dsh, projectDshSessionEvent(event, this.now())) }),
      })
      const suggestion = normalizeAccountSuggestion(structured, input)
      await patch((record) => { record.suggestion = suggestion; record.status = 'completed'; record.completedAt = this.now() })
      return suggestion
    } catch (error) {
      await patch((record) => { record.status = 'failed'; record.error = String(error?.message || error); record.completedAt = this.now() })
      throw error
    }
  }

  async topicGenerations(path) {
    const parsed = topicGenerationsFile(await readJson(path, emptyTopicGenerationsFile))
    if (parsed.changed) await writeJson(path, parsed.data)
    return parsed.data
  }
  async saveGeneration(workspace, path, record) { return this.serialGen(workspace, async () => { const data = await this.topicGenerations(path); const index = data.generations.findIndex((item) => item.id === record.id); if (index === -1) data.generations.push(record); else data.generations[index] = record; await writeJson(path, data) }) }
  async mutateGeneration(workspace, path, id, mutate) { return this.serialGen(workspace, async () => { const data = await this.topicGenerations(path); const record = data.generations.find((item) => item.id === id); if (!record) return null; mutate(record); await writeJson(path, data); return record }) }
  async recordTopicDshStarted(workspace, path, id, run) {
    const childSessionId = typeof run?.childSessionId === 'string' ? run.childSessionId : null
    if (!childSessionId) return null
    return this.mutateGeneration(workspace, path, id, (record) => {
      const trace = ensureDshTrace(record)
      trace.childSessionId = childSessionId
      trace.parentSessionId = typeof run.parentSessionId === 'string' ? run.parentSessionId : null
      const attempt = Array.isArray(record.attempts) ? record.attempts.at(-1) : undefined
      if (attempt) attempt.childSessionId = childSessionId
      appendDshTrace(trace, dshChildStarted(this.now()))
    })
  }
  async recordTopicDshEvent(workspace, path, id, event) {
    const projected = projectDshSessionEvent(event, this.now())
    if (!projected) return null
    return this.mutateGeneration(workspace, path, id, (record) => {
      appendDshTrace(ensureDshTrace(record), projected)
    })
  }
  enqueueTopicGeneration(workspace, job) {
    const queue = this.topicQueues.get(workspace) || []
    const running = this.topicRuns.get(workspace) || new Set()
    if (running.has(job.id) || queue.some((item) => item.id === job.id)) return
    queue.push(job)
    this.topicQueues.set(workspace, queue)
    this.drainTopicQueue(workspace)
  }
  drainTopicQueue(workspace) {
    const queue = this.topicQueues.get(workspace)
    if (!queue?.length) { this.topicQueues.delete(workspace); return }
    const running = this.topicRuns.get(workspace) || new Set()
    this.topicRuns.set(workspace, running)
    while (queue.length && running.size < this.topicConcurrency) {
      const job = queue.shift()
      running.add(job.id)
      void this.background(this.runTopicGeneration(workspace, job.generations, job.id, job).catch(async (error) => {
        await this.failTopicGeneration(workspace, job.generations, job.id, job.startedAt, error, 'normalize').catch(() => {})
      }).finally(() => {
        running.delete(job.id)
        if (!running.size) this.topicRuns.delete(workspace)
        this.drainTopicQueue(workspace)
      }))
    }
    if (!queue.length) this.topicQueues.delete(workspace)
  }
  async failTopicGeneration(workspace, path, id, startedAt, error, stepId = 'generate') {
    return this.mutateGeneration(workspace, path, id, (record) => {
      // Only an in-flight record can be settled here. A record the startup
      // recovery already failed carries the more accurate restart reason, and
      // a teardown failure arriving later must not overwrite it — the run
      // record and this record would otherwise disagree.
      if (!ACTIVE_TOPIC_GENERATION_STATUSES.has(record.status)) return
      const message = failureMessage(error, record.dsh)
      const step = (record.steps || []).find((item) => item.id === stepId)
        || (record.steps || []).find((item) => item.status === 'running')
        || (record.steps || []).find((item) => item.status === 'pending')
      if (step) { step.status = 'error'; step.detail = message.slice(0, 300) }
      record.status = 'failed'; record.error = message.slice(0, 500); record.completedAt = this.now(); record.elapsedMs = ms(startedAt, record.completedAt)
    })
  }
  async listGenerations(agent) { const { generations } = await this.paths(agent); const data = await this.topicGenerations(generations); return [...data.generations].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))) }
  async materializeCandidateProject(agent, paths, generationId, candidate) {
    if (!this.projectsStore || typeof this.projectsStore.create !== 'function' || typeof this.projectsStore.commit !== 'function') {
      throw fail('待写稿项目存储未接入。')
    }
    let projectId = candidate.selection?.projectId || null
    if (!projectId) {
      const created = await this.projectsStore.create(agent, { title: candidate.title })
      projectId = created.id
      await this.mutateGeneration(paths.workspace, paths.generations, generationId, (record) => {
        const current = record.candidates.find((item) => item.id === candidate.id)
        if (current) current.selection.projectId = projectId
      })
    }
    let current = await this.projectsStore.get(agent, { projectId })
    const refs = Array.isArray(candidate.signalIds) ? candidate.signalIds : []
    const generation = await this.topicGenerationStatus(agent, { id: generationId })
    const snapshot = Array.isArray(generation.materialSnapshot) ? generation.materialSnapshot : []
    const snapshotById = new Map(snapshot.filter((item) => item && typeof item.id === 'string').map((item) => [item.id, item]))
    const live = refs.length ? await this.listSignals(agent, { ids: refs }) : []
    const liveById = new Map(live.map((item) => [item.id, item]))
    for (let index = 0; index < refs.length; index += 1) {
      const signal = snapshotById.get(refs[index]) || liveById.get(refs[index])
      if (!signal) continue
      const result = await this.projectsStore.commit(agent, {
        projectId,
        expectedRevision: current.revision,
        stage: 'signals',
        payload: { source: signal.sourceId, text: `${signal.title}\n${signal.summary}${signal.url ? `\n${signal.url}` : ''}` },
        idempotencyKey: `candidate-${candidate.id}-signal-${index}`,
      })
      current = result.project
    }
    const result = await this.projectsStore.commit(agent, {
      projectId,
      expectedRevision: current.revision,
      stage: 'topic',
      payload: { title: candidate.title, angle: candidate.angle || null, account: generation.account || null },
      idempotencyKey: `candidate-${candidate.id}-topic`,
    })
    return result.project
  }
  async changeCandidateSelection(agent, request, options = {}) {
    const input = object(request ?? {}, '设置候选待写稿状态请求')
    const id = uuid(input.id, '选题生成标识')
    const candidateId = uuid(input.candidateId, '候选标识')
    const selected = bool(input.selected, '待写稿状态')
    const paths = await this.paths(agent)
    const begun = await this.mutateGeneration(paths.workspace, paths.generations, id, (record) => {
      if (record.status !== 'completed' && !(options.allowRunning && record.status === 'running')) throw fail('只有已完成的选题任务可以调整候选。')
      const candidate = record.candidates.find((item) => item.id === candidateId)
      if (!candidate) throw fail('选题候选不存在。')
      const state = candidate.selection?.state
      if (state === 'activating' || state === 'deactivating') throw fail('该候选正在调整，请稍后再试。')
      if (selected && state === 'selected') return
      if (!selected && state === 'available') return
      candidate.selection = { ...candidate.selection, state: selected ? 'activating' : 'deactivating', error: null }
    })
    if (!begun) throw fail('选题生成记录不存在。')
    const candidate = begun.candidates.find((item) => item.id === candidateId)
    if (!candidate) throw fail('选题候选不存在。')
    if (selected && candidate.selection.state === 'selected') return begun
    if (!selected && candidate.selection.state === 'available') return begun
    try {
      let projectId = candidate.selection.projectId
      if (selected) {
        if (projectId) await this.projectsStore.setTopicSelected(agent, { projectId, selected: true })
        else {
          const project = await this.materializeCandidateProject(agent, paths, id, candidate)
          projectId = project.id
        }
      } else if (projectId) {
        const scriptData = scriptGenerationsFile(await readJson(paths.scriptGenerations, emptyScriptGenerationsFile))
        if (scriptData.generations.some((item) => item.status === 'running' && item.projectId === projectId)) {
          throw fail('该选题正在生成稿件，请等待任务结束后再调整。')
        }
        await this.projectsStore.setTopicSelected(agent, { projectId, selected: false })
      }
      const completed = await this.mutateGeneration(paths.workspace, paths.generations, id, (record) => {
        const current = record.candidates.find((item) => item.id === candidateId)
        if (!current) return
        current.selection = {
          ...current.selection,
          state: selected ? 'selected' : 'available', projectId: projectId || null,
          selectedAt: selected ? this.now() : current.selection.selectedAt || null,
          deselectedAt: selected ? null : this.now(), source: options.source || 'manual', error: null,
        }
      })
      if (!completed) throw fail('选题生成记录不存在。')
      return completed
    } catch (error) {
      await this.mutateGeneration(paths.workspace, paths.generations, id, (record) => {
        const current = record.candidates.find((item) => item.id === candidateId)
        if (!current) return
        current.selection = { ...current.selection, state: selected ? 'available' : 'selected', error: String(error?.message || error).slice(0, 300) }
      })
      throw error
    }
  }
  async setTopicCandidateSelection(agent, request) { return this.changeCandidateSelection(agent, request) }
  async topicGenerationStatus(agent, request) {
    const input = object(request ?? {}, '读取选题生成请求'); const id = uuid(input.id, '选题生成标识'); const { generations } = await this.paths(agent)
    const data = await this.topicGenerations(generations)
    const record = data.generations.find((item) => item.id === id); if (!record) throw fail('选题生成记录不存在。')
    return record
  }

  async prepareLatestTopicMaterial(workspace, signalsPath, input) {
    const readCurrent = async () => this.serial(workspace, async () => {
      const data = await readSignalFile(signalsPath)
      if (pruneSignalData(data, this.now())) await writeJson(signalsPath, data)
      const sourceIds = selectedTopicSourceIds(data, input)
      if (!sourceIds.length) throw fail('没有可用的信号来源。')
      const unknown = sourceIds.filter((id) => !data.sources.some((item) => item.id === id))
      if (unknown.length) throw fail(`包含不存在的信号来源：${unknown.join('、')}。`)
      return { data, sourceIds }
    })
    const before = await readCurrent()
    const clock = new Date(this.now())
    const missingToday = before.sourceIds.filter((sourceIdValue) => {
      const current = latestBatchForSource(before.data, sourceIdValue)
      return !current || !inLocalDay(current.completedAt, clock)
    })
    if (missingToday.length) await this.collectWorkspace(workspace, missingToday, 'topic-generation')
    const after = await readCurrent()
    const unavailable = after.sourceIds.filter((sourceIdValue) => {
      const current = latestBatchForSource(after.data, sourceIdValue)
      return !current || !inLocalDay(current.completedAt, new Date(this.now()))
    })
    const unavailableSources = unavailable.map((id) => {
      const source = after.data.sources.find((item) => item.id === id)
      return { id, name: source?.name || id, error: source?.health?.lastError || '当天未形成采集批次。' }
    })
    const availableSourceIds = after.sourceIds.filter((id) => !unavailable.includes(id))
    return {
      ...after,
      refreshedSourceIds: missingToday,
      availableSourceIds,
      unavailableSources,
      latest: latestBatchMaterial(after.data, availableSourceIds),
    }
  }

  async startTopicGeneration(agent, request) {
    const input = parseTopicInput(request); const { workspace, signals, generations, profile } = await this.paths(agent)
    const accounts = await this.serial(workspace, () => readAccountLibrary(profile, this.now()))
    const account = selectedAccount(accounts, input.accountId)
    const accountSnapshot = account ? snapshotAccount(account) : null
    const id = randomUUID(); const startedAt = this.now()
    const record = {
      id, startedAt, status: 'queued', input, materialMode: 'latest-batches',
      materialSignalIds: [], materialSnapshot: [], materialBatches: [], refreshedSourceIds: [], unavailableSources: [],
      summary: `${accountSnapshot?.name ? `账号「${accountSnapshot.name}」` : '通用（无账号定位）'} · 已提交，等待确认渠道最新采集`, account: accountSnapshot, steps: buildGenerationSteps(),
      dsh: dshTrace(), candidates: [], requested: 5, returned: 0, error: null, completedAt: null, elapsedMs: null,
      attempts: [], effectiveSourceIds: [], reductionNote: null,
    }
    await this.saveGeneration(workspace, generations, record)
    this.enqueueTopicGeneration(workspace, { id, input, accountSnapshot, signals, generations, startedAt, agent })
    return { id }
  }

  async runTopicGeneration(workspace, generationsPath, id, { input, accountSnapshot, signals, startedAt, agent }) {
    let activeStep = 'assemble'
    try {
      const begun = await this.mutateGeneration(workspace, generationsPath, id, (record) => {
        if (record.status !== 'queued') return
        record.status = 'running'; record.steps[0].status = 'running'; record.steps[0].detail = '正在确认渠道当天采集状态'
      })
      if (!begun || begun.status !== 'running') return
      const prepared = await this.prepareLatestTopicMaterial(workspace, signals, input)
      const sourceLabels = Object.fromEntries(prepared.data.sources.map((item) => [item.id, item.name]))
      const prior = await this.topicGenerations(generationsPath)
      const recentCandidates = prior.generations
        .filter((item) => item?.status === 'completed' && (item.account?.id || null) === (accountSnapshot?.id || null))
        .sort((left, right) => String(right.startedAt).localeCompare(String(left.startedAt)))
        .flatMap((item) => Array.isArray(item.candidates) ? item.candidates : [])
        .slice(0, 20)
        .map((item) => `${String(item.title || '').slice(0, 160)}${item.contentCore ? `：${String(item.contentCore).slice(0, 180)}` : ''}`)
        .filter(Boolean)
      const baseRecord = await this.mutateGeneration(workspace, generationsPath, id, (record) => {
        record.steps[0].status = 'done'; record.steps[0].detail = prepared.unavailableSources.length
          ? `${prepared.refreshedSourceIds.length ? `已补采 ${prepared.refreshedSourceIds.length} 个渠道；` : ''}${prepared.unavailableSources.length} 个渠道未获得当天数据，继续使用其余渠道`
          : prepared.refreshedSourceIds.length ? `已补采 ${prepared.refreshedSourceIds.length} 个渠道` : '所选渠道均已在今天完成采集'
        record.attempts = []
        record.effectiveSourceIds = []
        record.reductionNote = null
      })
      if (!baseRecord) return
      activeStep = 'generate'
      if (typeof this.topicExecutor !== 'function') throw fail('选题生成执行器未接入（需要 topicExecutor）。')
      const plans = topicAttemptPlans(prepared.sourceIds)
      let lastContentError = null
      for (const plan of plans) {
        const attemptInput = { ...input, sourceIds: [...plan.sourceIds] }
        const material = plan.sourceIds.length
          ? assembleMaterial(attemptInput, prepared.latest.signals, { mode: 'latest-batches' })
          : { signals: [], sourceIds: [], mode: 'latest-batches' }
        const batches = prepared.latest.batches.filter((item) => plan.sourceIds.includes(item.sourceId))
        const unavailableSources = prepared.unavailableSources.filter((item) => plan.sourceIds.includes(item.id))
        const refreshedSourceIds = prepared.refreshedSourceIds.filter((sourceIdValue) => plan.sourceIds.includes(sourceIdValue))
        const prompt = buildTopicPrompt({ input: attemptInput, material, profile: accountSnapshot, sourceLabels, recentCandidates, unavailableSources })
        const removal = plan.removedSourceId
          ? `移除来源 ${sourceLabels[plan.removedSourceId] || plan.removedSourceId}`
          : plan.sourceIds.length ? null : '不使用渠道信号'
        const attempt = {
          index: plan.index, sourceIds: [...plan.sourceIds], removedSourceId: plan.removedSourceId || null,
          signalCount: material.signals.length, status: 'running', startedAt: this.now(), completedAt: null, error: null, childSessionId: null,
        }
        const attemptRecord = await this.mutateGeneration(workspace, generationsPath, id, (record) => {
          record.dsh = dshTrace()
          record.attempts = [...(record.attempts || []), attempt]
          record.effectiveSourceIds = [...plan.sourceIds]
          record.materialMode = material.mode
          record.materialSignalIds = material.signals.map((item) => item.id)
          record.materialSnapshot = material.signals
          record.materialBatches = batches
          record.refreshedSourceIds = refreshedSourceIds
          record.unavailableSources = unavailableSources
          record.summary = summarizeInput(attemptInput, material, accountSnapshot)
          record.steps[1].status = 'done'
          record.steps[1].detail = `使用 ${material.signals.length} 条最新批次信号，覆盖 ${batches.length} 个渠道${removal ? ` · ${removal}` : ''}`
          record.steps[2].status = 'running'
          record.steps[2].detail = plan.index
            ? `模型内容审核拦截，正在降级重试（第 ${plan.index} 次${removal ? `，${removal}` : ''}）`
            : '正在请求模型生成候选'
        })
        if (!attemptRecord) return
        activeStep = 'generate'
        try {
          const structured = await this.topicExecutor({
            prompt,
            schema: TOPIC_CANDIDATES_SCHEMA,
            agent,
            onDshStarted: (run) => this.recordTopicDshStarted(workspace, generationsPath, id, run),
            onDshEvent: (event) => this.recordTopicDshEvent(workspace, generationsPath, id, event),
          })
          activeStep = 'normalize'
          const result = normalizeCandidates(structured, material)
          await this.mutateGeneration(workspace, generationsPath, id, (record) => {
            const current = Array.isArray(record.attempts) ? record.attempts.at(-1) : undefined
            if (current) {
              current.status = 'completed'; current.completedAt = this.now()
              current.childSessionId = record.dsh?.childSessionId || current.childSessionId
            }
            record.reductionNote = plan.index
              ? `内容安全审核拦截后降级 ${plan.index} 次；实际使用 ${material.sourceIds.length} 个来源 / ${material.signals.length} 条信号`
              : null
            record.steps[2].status = 'done'; record.steps[2].detail = `返回 ${result.returned} 个候选${plan.index ? `（第 ${plan.index} 次降级后）` : ''}`
            record.candidates = result.candidates.map((candidate) => ({
              ...candidate,
              id: randomUUID(),
              selection: { state: 'available', projectId: null, selectedAt: null, deselectedAt: null, source: null, error: null },
            }))
            record.returned = result.returned; record.summaryNote = result.summary
            record.steps[3].status = result.returned ? 'running' : 'done'
            record.steps[3].detail = result.returned ? '正在将推荐选题加入待写稿' : '本轮没有可加入的候选'
          })
          let autoError = null
          const generated = await this.topicGenerationStatus(agent, { id })
          if (generated.candidates[0]) {
            try {
              await this.changeCandidateSelection(agent, { id, candidateId: generated.candidates[0].id, selected: true }, { allowRunning: true, source: 'recommended' })
            } catch (error) {
              autoError = String(error?.message || error).slice(0, 300)
            }
          }
          await this.mutateGeneration(workspace, generationsPath, id, (record) => {
            record.steps[3].status = autoError ? 'error' : 'done'
            record.steps[3].detail = autoError || (record.returned ? '推荐选题已自动加入待写稿' : '本轮没有可加入的候选')
            record.autoSelectionError = autoError
            record.status = 'completed'; record.completedAt = this.now(); record.elapsedMs = ms(startedAt, record.completedAt)
          })
          return
        } catch (error) {
          const failureRecord = await this.topicGenerationStatus(agent, { id }).catch(() => null)
          const content = isContentInspectionFailure(error, failureRecord?.dsh)
          await this.mutateGeneration(workspace, generationsPath, id, (record) => {
            const current = Array.isArray(record.attempts) ? record.attempts.at(-1) : undefined
            if (current) {
              current.status = content ? 'content-inspection' : 'failed'
              current.error = failureMessage(error, record.dsh).slice(0, 500)
              current.completedAt = this.now()
              current.childSessionId = record.dsh?.childSessionId || current.childSessionId
            }
            if (content) {
              record.steps[2].detail = `内容审核拦截：${plan.sourceIds.length ? `剩余 ${plan.sourceIds.length} 个来源` : '已无渠道信号'}`
            }
          })
          if (!content) throw error
          lastContentError = error
        }
      }
      await this.mutateGeneration(workspace, generationsPath, id, (record) => {
        record.reductionNote = `内容审核拦截：共尝试 ${plans.length} 次`
        record.steps[1].detail = `已尝试 ${plans.length} 次，最后一次不使用渠道信号`
        record.steps[2].status = 'error'
        record.steps[2].detail = '模型内容审核拒绝了全部降级尝试'
      })
      const last = lastContentError ? String(lastContentError.message || lastContentError).slice(0, 400) : '未知错误'
      throw fail(`选题生成连续 ${plans.length} 次被模型内容审核拦截（最后一次已不带渠道信号）；请调整账号定位/选题角度/历史候选，或更换场景任务模型。最后一次错误：${last}`)
    } catch (error) {
      await this.failTopicGeneration(workspace, generationsPath, id, startedAt, error, activeStep)
    }
  }

  /* ------------------------- script generation ------------------------- */

  async saveScriptGeneration(workspace, path, record) { return this.serialGen(workspace, async () => { const data = scriptGenerationsFile(await readJson(path, emptyScriptGenerationsFile)); const index = data.generations.findIndex((item) => item.id === record.id); if (index === -1) data.generations.push(record); else data.generations[index] = record; await writeJson(path, data) }) }
  async mutateScriptGeneration(workspace, path, id, mutate) { return this.serialGen(workspace, async () => { const data = scriptGenerationsFile(await readJson(path, emptyScriptGenerationsFile)); const record = data.generations.find((item) => item.id === id); if (!record) return null; mutate(record); await writeJson(path, data); return record }) }
  async recordScriptDshStarted(workspace, path, id, run) {
    const childSessionId = typeof run?.childSessionId === 'string' ? run.childSessionId : null
    if (!childSessionId) return null
    return this.mutateScriptGeneration(workspace, path, id, (record) => {
      const trace = ensureDshTrace(record)
      trace.childSessionId = childSessionId
      trace.parentSessionId = typeof run.parentSessionId === 'string' ? run.parentSessionId : null
      appendDshTrace(trace, dshChildStarted(this.now()))
    })
  }
  async recordScriptDshEvent(workspace, path, id, event) {
    const projected = projectDshSessionEvent(event, this.now())
    if (!projected) return null
    return this.mutateScriptGeneration(workspace, path, id, (record) => {
      appendDshTrace(ensureDshTrace(record), projected)
    })
  }
  async listScriptGenerations(agent) { const { scriptGenerations } = await this.paths(agent); const data = scriptGenerationsFile(await readJson(scriptGenerations, emptyScriptGenerationsFile)); return [...data.generations].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))) }
  async scriptGenerationStatus(agent, request) {
    const input = object(request ?? {}, '读取写稿生成请求'); const id = uuid(input.id, '写稿生成标识'); const { scriptGenerations } = await this.paths(agent)
    const data = scriptGenerationsFile(await readJson(scriptGenerations, emptyScriptGenerationsFile))
    const record = data.generations.find((item) => item.id === id); if (!record) throw fail('写稿生成记录不存在。')
    return record
  }
  enqueueScriptGeneration(workspace, job) {
    const queue = this.scriptQueues.get(workspace) || []
    if (queue.some((item) => item.id === job.id)) return
    queue.push(job); this.scriptQueues.set(workspace, queue); this.drainScriptQueue(workspace)
  }
  drainScriptQueue(workspace) {
    const queue = this.scriptQueues.get(workspace); if (!queue?.length) { this.scriptQueues.delete(workspace); return }
    const running = this.scriptRuns.get(workspace) || new Set(); this.scriptRuns.set(workspace, running)
    while (queue.length && running.size < this.scriptConcurrency) {
      const job = queue.shift(); running.add(job.id)
      void this.background(this.runScriptGeneration(workspace, job.generationsPath, job.id, job).catch(async (error) => {
        await this.mutateScriptGeneration(workspace, job.generationsPath, job.id, (record) => { record.status = 'failed'; record.error = String(error?.message || error).slice(0, 500); record.completedAt = this.now(); record.elapsedMs = ms(record.startedAt, record.completedAt) }).catch(() => {})
      }).finally(() => { running.delete(job.id); if (!running.size) this.scriptRuns.delete(workspace); this.drainScriptQueue(workspace) }))
    }
    if (!queue.length) this.scriptQueues.delete(workspace)
  }

  /** On-demand deterministic quality analysis for the current editor body. */
  async analyzeScript(agent, request) {
    const input = object(request, '稿件质检请求')
    const body = text(input.body, '口播稿', 30000)
    const tier = String(input.tier || '').trim() || undefined
    await this.paths(agent)
    const corpus = this.projectsStore ? await this.projectsStore.listScriptCorpus(agent, { excludeProjectId: typeof input.projectId === 'string' ? input.projectId.toLowerCase() : undefined }) : []
    const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim() : ''
    return analyzeScriptQuality({ title, body, tier, corpus })
  }

  async startScriptGeneration(agent, request) {
    const input = parseScriptGenerationInput(request)
    if (!this.projectsStore) throw fail('写稿生成需要项目存储（projectsStore 未注入）。')
    const { workspace, scriptGenerations } = await this.paths(agent)
    const detail = await this.projectsStore.get(agent, { projectId: input.projectId })
    if (!detail.completedStages.includes('topic')) throw fail('该项目还没有确认选题，无法生成稿件。')
    if (!detail.topicSelected) throw fail('该选题当前未加入待写稿，无法生成稿件。')
    const topicData = detail.artifacts?.topic?.data || {}
    const signalItems = detail.artifacts?.signals?.data?.items || []
    const currentBody = input.mode === 'polish' ? (detail.artifacts?.script?.data?.body || '') : ''
    if (input.mode === 'polish' && !currentBody.trim()) throw fail('当前项目还没有已保存的口播稿，无法润色。')
    const account = snapshotAccount(topicData.account)
    const prompt = buildScriptPrompt({ input, topic: topicData, signals: signalItems.slice(0, 30), profile: account, currentBody })
    const id = randomUUID(); const startedAt = this.now()
    const steps = buildScriptGenerationSteps()
    steps[0].status = 'done'; steps[0].detail = `选题已就位，信号依据 ${signalItems.length} 条`
    const existing = (await this.listScriptGenerations(agent)).find((item) => item.projectId === input.projectId && ACTIVE_SCRIPT_GENERATION_STATUSES.has(item.status))
    if (existing) throw fail('该项目已有写稿任务，请等待当前任务完成后再提交。')
    const record = {
      id, startedAt, queuedAt: startedAt, status: 'queued', projectId: input.projectId, projectTitle: detail.title,
      mode: input.mode, tier: input.tier, instructions: input.instructions,
      summary: summarizeScriptInput(input, detail), account, steps,
      expectedRevision: detail.revision, scriptRevision: null, appliedAt: null,
      sourceSnapshot: { topic: topicData, signals: signalItems.slice(0, 30), previousScript: currentBody, scriptRevision: detail.artifacts?.script?.revision || null },
      dsh: dshTrace(), draft: null, quality: null, error: null, completedAt: null, elapsedMs: null,
    }
    // The durable write lock makes the project-level duplicate check safe for
    // two RPC calls arriving at the same time.
    await this.serialGen(workspace, async () => {
      const current = scriptGenerationsFile(await readJson(scriptGenerations, emptyScriptGenerationsFile))
      if (current.generations.some((item) => item.projectId === input.projectId && ACTIVE_SCRIPT_GENERATION_STATUSES.has(item.status))) throw fail('该项目已有写稿任务，请等待当前任务完成后再提交。')
      current.generations.push(record)
      await writeJson(scriptGenerations, current)
    })
    this.enqueueScriptGeneration(workspace, { generationsPath: scriptGenerations, id, prompt, input, agent, topicData, projectId: input.projectId, expectedRevision: detail.revision })
    return { id }
  }

  async runScriptGeneration(workspace, generationsPath, id, { prompt, input, agent, topicData, projectId, expectedRevision }) {
    await this.mutateScriptGeneration(workspace, generationsPath, id, (record) => { record.status = 'running'; record.startedAt = record.startedAt || this.now(); record.steps[1].status = 'running' })
    let structured
    try {
      if (typeof this.scriptExecutor !== 'function') throw fail('写稿生成执行器未接入（需要 scriptExecutor）。')
      structured = await this.scriptExecutor({
        prompt,
        schema: SCRIPT_DRAFT_SCHEMA,
        agent,
        onDshStarted: (run) => this.recordScriptDshStarted(workspace, generationsPath, id, run),
        onDshEvent: (event) => this.recordScriptDshEvent(workspace, generationsPath, id, event),
      })
    } catch (error) {
      await this.mutateScriptGeneration(workspace, generationsPath, id, (record) => {
        // Same rule as the topic path: never rewrite a record the startup
        // recovery already settled.
        if (!ACTIVE_SCRIPT_GENERATION_STATUSES.has(record.status)) return
        const message = failureMessage(error, record.dsh)
        record.status = 'failed'; record.steps[1].status = 'error'; record.steps[1].detail = message.slice(0, 300)
        record.error = message.slice(0, 500); record.completedAt = this.now(); record.elapsedMs = ms(record.startedAt, record.completedAt)
      })
      return
    }
    const normalized = normalizeDraft(structured)
    if (!normalized.usable) {
      await this.mutateScriptGeneration(workspace, generationsPath, id, (record) => {
        record.status = 'failed'; record.steps[1].status = 'error'; record.steps[1].detail = '模型未返回可用的稿件正文'
        record.error = '模型未返回可用的稿件正文。'; record.completedAt = this.now(); record.elapsedMs = ms(record.startedAt, record.completedAt)
      })
      return
    }
    await this.mutateScriptGeneration(workspace, generationsPath, id, (record) => {
      record.steps[1].status = 'done'; record.steps[1].detail = `返回 ${[...normalized.draft.script.replace(/\s+/g, '')].length} 字稿件`
      record.steps[2].status = 'done'; record.steps[2].detail = '稿件已校验'
      record.draft = { ...normalized.draft, suggestedTitle: normalized.draft.title || topicData?.title || null }
    })
    let report = null
    try {
      const corpus = this.projectsStore ? await this.projectsStore.listScriptCorpus(agent, { excludeProjectId: projectId }).catch(() => []) : []
      report = analyzeScriptQuality({ title: normalized.draft.title || topicData?.title || '', body: normalized.draft.script, tier: input.tier, corpus })
    } catch (_) { /* quality is advisory; a failure must not fail the generation */ }
    await this.mutateScriptGeneration(workspace, generationsPath, id, (record) => {
      record.steps[3].status = report ? 'done' : 'error'; record.steps[3].detail = report ? `质检 ${report.qualityScore} 分（${report.verdict}）` : '质检不可用'
      // Keep the full deterministic report with its candidate so the client can
      // show the already-completed review without re-running it.
      record.quality = report
      record.steps[4].status = 'running'; record.steps[4].detail = '正在保存为当前稿件版本'
    })
    let committed
    try {
      committed = await this.projectsStore.commit(agent, {
        projectId,
        expectedRevision,
        stage: 'script',
        payload: { body: normalized.draft.script },
        idempotencyKey: `script-generation-${id}`,
      })
    } catch (error) {
      await this.mutateScriptGeneration(workspace, generationsPath, id, (record) => {
        const message = String(error?.message || error).slice(0, 500)
        record.status = 'failed'; record.steps[4].status = 'error'; record.steps[4].detail = `自动保存失败：${message}`
        record.error = `生成完成，但未能自动保存为当前稿件：${message}`
        record.completedAt = this.now(); record.elapsedMs = ms(record.startedAt, record.completedAt)
      })
      return
    }
    await this.mutateScriptGeneration(workspace, generationsPath, id, (record) => {
      record.steps[4].status = 'done'; record.steps[4].detail = `已保存为项目版本 ${committed.project.revision}`
      record.scriptRevision = committed.artifact.revision; record.appliedAt = this.now()
      executionEvent(record, '稿件已保存', { detail: { scriptRevision: committed.artifact.revision, projectRevision: committed.project.revision } })
      record.status = 'completed'; record.completedAt = this.now(); record.elapsedMs = ms(record.startedAt, record.completedAt)
    })
  }

  async recoverInterruptedAccountGenerations() {
    if (!this.workspacePath) return
    const workspace = await realpath(this.workspacePath)
    const root = await rootFor(workspace, false)
    if (!root) return
    await this.serialGen(workspace, async () => {
      const path = join(root, 'account-generations.json')
      const data = await readJson(path, () => ({ generations: [] }))
      const interrupted = data.generations.filter((item) => item.status === 'running')
      for (const record of interrupted) {
        record.status = 'failed'; record.error = '账号定位任务在主机重启前未完成，请重试。'; record.completedAt = this.now()
      }
      if (interrupted.length) await writeJson(path, data)
    })
  }
  async recoverInterruptedTopicGenerations() {
    for (const candidate of this.workspacePath ? [this.workspacePath] : []) {
      let workspace; try { workspace = await realpath(candidate) } catch (_) { continue }
      const root = await rootFor(workspace, false); if (!root) continue
      const generations = join(root, 'topic-generations.json')
      await this.serialGen(workspace, async () => {
        const data = await this.topicGenerations(generations)
        let changed = false
        for (const record of data.generations) {
          if (!ACTIVE_TOPIC_GENERATION_STATUSES.has(record?.status)) continue
          const detail = '口播视频内容主机在任务完成前已重启，请重试。'
          const step = (record.steps || []).find((item) => item.status === 'running') || (record.steps || []).find((item) => item.status === 'pending')
          if (step) { step.status = 'error'; step.detail = detail }
          record.status = 'failed'; record.error = detail; record.completedAt = this.now(); record.elapsedMs = ms(record.startedAt, record.completedAt)
          changed = true
        }
        if (changed) await writeJson(generations, data)
      })
    }
  }
  async recoverInterruptedScriptGenerations() {
    for (const candidate of this.workspacePath ? [this.workspacePath] : []) {
      let workspace; try { workspace = await realpath(candidate) } catch (_) { continue }
      const root = await rootFor(workspace, false); if (!root) continue
      const generations = join(root, 'script-generations.json')
      await this.serialGen(workspace, async () => {
        const data = scriptGenerationsFile(await readJson(generations, emptyScriptGenerationsFile))
        let changed = false
        for (const record of data.generations) {
          if (!ACTIVE_SCRIPT_GENERATION_STATUSES.has(record?.status)) continue
          const detail = '口播视频内容主机在任务完成前已重启，请重试。'
          const step = (record.steps || []).find((item) => item.status === 'running') || (record.steps || []).find((item) => item.status === 'pending')
          if (step) { step.status = 'error'; step.detail = detail }
          record.status = 'failed'; record.error = detail; record.completedAt = this.now(); record.elapsedMs = ms(record.startedAt || record.queuedAt, record.completedAt)
          changed = true
        }
        if (changed) await writeJson(generations, data)
      })
    }
  }
  async tick() {
    for (const candidate of this.workspacePath ? [this.workspacePath] : []) {
      let workspace; try { workspace = await realpath(candidate) } catch (_) { continue }
      const root = await rootFor(workspace, false); if (!root) continue
      const signals = join(root, 'signals.json'); let sourceData; try { sourceData = await readSignalFile(signals) } catch (_) { continue }
      const dueIds = sourceData.sources.filter(due).map((item) => item.id); if (dueIds.length) await this.collectWorkspace(workspace, dueIds, 'automatic').catch(() => {})
    }
  }
  startScheduler() { void this.background(this.recoverInterruptedAccountGenerations().catch(() => {})); const tick = () => { void this.background(this.tick().catch(() => {})) }; void this.background(this.recoverInterruptedTopicGenerations().catch(() => {})); void this.background(this.recoverInterruptedScriptGenerations().catch(() => {})); tick(); const timer = setInterval(tick, 30_000); timer.unref?.(); return () => clearInterval(timer) }
}
