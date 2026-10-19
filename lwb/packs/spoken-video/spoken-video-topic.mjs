/**
 * Pure helpers for the topic module: account-scoped input assembly, candidate
 * normalization, and the DSH generation prompt. No I/O and no model calls —
 * the host store composes these helpers and supplies the model execution.
 *
 * Input contract (2026-09-05 redesign): the page is tab-scoped by account —
 * angle (optional text) + signal sources (default all) + AI-daily platform
 * granularity + per-run signal exclusions. The legacy title / explicit
 * signalIds inputs were removed together with the old four-input form.
 */

const ANGLE_MAX = 500
const CANDIDATE_TITLE_MAX = 160
const SOURCE_LIMIT = 20
const PLATFORM_LIMIT = 12
const EXCLUDE_LIMIT = 300
const CANDIDATE_LIMIT = 5
const SIGNAL_REF_LIMIT = 8
const ACCOUNT_ID = /^[a-f0-9-]{36}$/iu
export const AI_DAILY_SOURCE_ID = 'ai-daily-import'

/** Source-removal retries before the final signal-free diagnostic attempt. */
export const TOPIC_SOURCE_REDUCTIONS = 8
/**
 * Content-inspection risk order. The provider's filter is opaque, so this list
 * is a deterministic heuristic: user-generated daily feeds and social hot lists
 * go first, then the remaining selected sources in their request order.
 */
export const TOPIC_SOURCE_RISK_ORDER = Object.freeze([
  AI_DAILY_SOURCE_ID,
  'weibo-hot',
  'douyin-hot',
  'baidu',
  'toutiao',
  'zhihu-hot',
  'bilibili-popular',
])

export const TOPIC_INPUT_KEYS = Object.freeze(['angle', 'sourceIds', 'platforms', 'excludeSignalIds', 'accountId'])

export function fail(message) { return new Error(`选题生成：${message}`) }

function text(value, label, max) {
  if (typeof value !== 'string') throw fail(`${label}必须是文本。`)
  const result = value.trim()
  if (!result || result.length > max) throw fail(`${label}长度必须在 1-${max} 之间。`)
  return result
}

function optionalText(value, label, max) {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return null
  return text(value, label, max)
}

function idList(value, label, maxItems) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > maxItems) throw fail(`${label}最多包含 ${maxItems} 项。`)
  return [...new Set(value.map((item) => text(item, `${label}项`, 63)))]
}

function optionalAccountId(value) {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return null
  const id = text(value, '账号定位标识', 36)
  if (!ACCOUNT_ID.test(id)) throw fail('账号定位标识无效。')
  return id.toLowerCase()
}

/**
 * Validate the account-scoped input. Angle stays optional; with no sources
 * listed the run opens over the whole active pool, so an empty request is a
 * valid open generation rather than an error.
 */
export function parseTopicInput(request) {
  const input = request && typeof request === 'object' && !Array.isArray(request) ? request : {}
  const angle = optionalText(input.angle, '选题角度', ANGLE_MAX)
  const sourceIds = idList(input.sourceIds, '信号源选择', SOURCE_LIMIT)
  const platforms = idList(input.platforms, 'AI 日报平台选择', PLATFORM_LIMIT)
  const excludeSignalIds = idList(input.excludeSignalIds, '本次排除信号', EXCLUDE_LIMIT)
  const accountId = optionalAccountId(input.accountId)
  return { angle, sourceIds, platforms, excludeSignalIds, accountId }
}

/** Validate the stored account profile; every field stays optional. */
export function parseProfile(request) {
  const input = request && typeof request === 'object' && !Array.isArray(request) ? request : {}
  return {
    positioning: optionalText(input.positioning, '账号定位', 600),
    audience: optionalText(input.audience, '目标受众', 300),
    pillars: idList(input.pillars, '内容方向', 8).map((item) => text(item, '内容方向项', 60)),
    boundary: optionalText(input.boundary, '内容边界', 600),
    updatedAt: typeof input.updatedAt === 'string' && input.updatedAt ? input.updatedAt : null,
  }
}

export function emptyProfile() { return { positioning: null, audience: null, pillars: [], boundary: null, updatedAt: null } }

export function hasProfile(profile) {
  return Boolean(profile && (profile.positioning || profile.audience || profile.pillars?.length || profile.boundary))
}

/**
 * A project never holds a live reference to an account. It carries this
 * compact, validated snapshot so later account edits cannot change an
 * already-confirmed topic or its downstream script-generation context.
 */
export function parseAccountSnapshot(request) {
  if (request === undefined || request === null) return null
  const input = request && typeof request === 'object' && !Array.isArray(request) ? request : null
  if (!input) throw fail('账号定位快照必须是对象。')
  const id = text(input.id, '账号定位标识', 36)
  if (!ACCOUNT_ID.test(id)) throw fail('账号定位标识无效。')
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) throw fail('账号定位版本无效。')
  const profile = parseProfile(input)
  return {
    id: id.toLowerCase(),
    name: text(input.name, '账号名称', 80),
    revision: input.revision,
    positioning: profile.positioning,
    audience: profile.audience,
    pillars: profile.pillars,
    boundary: profile.boundary,
  }
}

export function snapshotAccount(account) { return parseAccountSnapshot(account) }

function byScore(left, right) { return right.score - left.score || right.capturedAt.localeCompare(left.capturedAt) }

function compact(signal) {
  return {
    id: signal.id,
    title: signal.title,
    summary: signal.summary?.slice(0, 300) || '',
    url: signal.url || null,
    sourceId: signal.sourceId,
    score: signal.score,
    capturedAt: signal.capturedAt,
    platform: signal.platform || null,
  }
}

/**
 * True when a signal belongs to the requested material scope. AI-daily
 * signals require the source id plus a checked platform (when platforms are
 * given); every other source only requires its id. With no sources listed
 * the whole active pool is in scope.
 */
function inScope(input, signal) {
  const hasAiDaily = input.sourceIds.includes(AI_DAILY_SOURCE_ID)
  const others = input.sourceIds.filter((id) => id !== AI_DAILY_SOURCE_ID)
  if (!input.sourceIds.length) return true
  if (signal.sourceId === AI_DAILY_SOURCE_ID) {
    return hasAiDaily && (!input.platforms.length || input.platforms.includes(signal.platform || '其他'))
  }
  return others.includes(signal.sourceId)
}

/**
 * Assemble the material layer from the caller-provided source snapshots.
 * Topic generation supplies each selected source's latest batch, while tests
 * and narrow callers may supply a smaller pool. There is deliberately no
 * global top-N cut: source selection must mean its latest data is included.
 */
export function assembleMaterial(input, pool, options = {}) {
  const excluded = new Set(input.excludeSignalIds)
  const scoped = pool.filter((signal) => signal.state === 'active' && !excluded.has(signal.id) && inScope(input, signal))
  const seen = new Set()
  const signals = []
  for (const item of [...scoped].sort(byScore)) {
    const key = item.fingerprint || item.id
    if (seen.has(key)) continue
    seen.add(key)
    signals.push(compact(item))
  }
  return { signals, sourceIds: [...new Set(signals.map((item) => item.sourceId))], mode: options.mode || 'latest-batches' }
}

/**
 * Build the bounded retry ladder for one topic generation.
 *
 * The first attempt sends every selected source with every signal, preserving
 * the normal material. Each following attempt removes one source in risk order
 * while keeping every signal from the remaining sources; after at most
 * {@link TOPIC_SOURCE_REDUCTIONS} removals, the last attempt sends no channel
 * signals so the caller can tell a source-content rejection from a rejection of
 * the account/profile prompt.
 *
 * @param sourceIds - selected sources for the request.
 * @returns attempts with their source sets and the single removed source.
 */
export function topicAttemptPlans(sourceIds) {
  const selected = [...new Set(sourceIds)]
  const plans = [{ index: 0, sourceIds: selected, removedSourceId: null }]
  if (!selected.length) return plans
  const ordered = [
    ...TOPIC_SOURCE_RISK_ORDER.filter((id) => selected.includes(id)),
    ...selected.filter((id) => !TOPIC_SOURCE_RISK_ORDER.includes(id)),
  ]
  const remaining = [...selected]
  for (const removedSourceId of ordered.slice(0, TOPIC_SOURCE_REDUCTIONS)) {
    const position = remaining.indexOf(removedSourceId)
    if (position === -1) continue
    remaining.splice(position, 1)
    if (!remaining.length) break
    plans.push({ index: plans.length, sourceIds: [...remaining], removedSourceId })
  }
  plans.push({ index: plans.length, sourceIds: [], removedSourceId: null })
  return plans
}

export function buildGenerationSteps() {
  return [
    { id: 'assemble', label: '确认渠道最新采集', status: 'pending', detail: null },
    { id: 'material', label: '组装渠道最新信号', status: 'pending', detail: null },
    { id: 'generate', label: 'DSH 生成候选', status: 'pending', detail: null },
    { id: 'normalize', label: '校验并整理候选', status: 'pending', detail: null },
  ]
}

function profileLines(profile) {
  if (!hasProfile(profile)) return null
  const lines = []
  if (profile.positioning) lines.push(`账号定位：${profile.positioning}`)
  if (profile.audience) lines.push(`目标受众：${profile.audience}`)
  if (profile.pillars?.length) lines.push(`内容方向：${profile.pillars.join('、')}`)
  if (profile.boundary) lines.push(`内容边界：${profile.boundary}`)
  return lines
}

/** Build the DSH prompt for candidate generation. */
export function buildTopicPrompt({ input, material, profile, sourceLabels, platformNames, recentCandidates = [], unavailableSources = [] }) {
  const sections = ['你是口播视频账号的选题编辑。基于下方输入生成视频选题候选。只输出结构化结果。']
  sections.push('规则：')
  const rules = [
    '最多生成 5 个候选；只有当素材足以支撑时才产出对应数量，信息不足时宁可少而准，不得硬凑。',
    '候选按推荐程度从高到低排列：第一个是你认为最该做的选题。',
    '每个候选必须给出标题、切入角度和内容核心；标题不要照搬信号原标题，要改写成观众关心的表达。',
    'signalIds 只能引用输入素材中出现的信号标识；没有可用素材时留空。',
    '避免重复近期已经生成过的选题；除非用户明确要求换角度，否则不要仅改写标题后重复同一内容核心。',
    '不要输出大纲、脚本或评分表。',
  ]
  if (input.angle) rules.push(`全部候选都要满足选题角度：${input.angle}。`)
  const account = profileLines(profile)
  if (account) rules.push(`候选必须符合账号约束：\n${account.map((line) => `  - ${line}`).join('\n')}`)
  sections.push(rules.map((rule) => `- ${rule}`).join('\n'))
  if (input.angle) sections.push(`选题角度：${input.angle}`)
  if (input.sourceIds.length) {
    const parts = input.sourceIds
      .filter((id) => id !== AI_DAILY_SOURCE_ID)
      .map((id) => sourceLabels?.[id] || id)
    if (input.sourceIds.includes(AI_DAILY_SOURCE_ID)) {
      const platformLabel = input.platforms.length
        ? input.platforms.map((name) => platformNames?.[name] || name).join('、')
        : '全部平台'
      parts.push(`AI 内容日报（${platformLabel}）`)
    }
    sections.push(`用户圈定的信号源：${parts.join('、')}`)
  }
  if (recentCandidates.length) {
    sections.push(`近期已生成候选（避免重复；这些内容仅供去重判断）：\n${recentCandidates.map((item) => `- ${item}`).join('\n')}`)
  }
  if (unavailableSources.length) {
    sections.push(`本轮未获得当天采集数据的信号源：${unavailableSources.map((item) => item.name || item.id).join('、')}。不要虚构这些来源的内容；仅基于实际信号、用户输入与账号定位生成。`)
  }
  if (material.signals.length) {
    sections.push(`本轮渠道最新信号（${material.signals.length} 条，signalIds 必须从中选择）：`)
    sections.push(material.signals.map((signal) => `- id=${signal.id} [${signal.sourceId}${signal.platform ? ` · ${signal.platform}` : ''}] ${signal.title}${signal.summary ? `：${signal.summary}` : ''}`).join('\n'))
  } else {
    sections.push('本轮渠道最新信号：无。候选依据用户输入与账号定位生成，signalIds 留空。')
  }
  return sections.join('\n\n')
}

export const TOPIC_CANDIDATES_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '视频标题' },
          angle: { type: 'string', description: '切入角度' },
          videoForm: { type: 'string', description: '内容形态，如 热点转知识、机制拆解、工具判断' },
          contentCore: { type: 'string', description: '真正要讲清的内容核心' },
          whyNow: { type: 'string', description: '为什么现在值得做' },
          signalIds: { type: 'array', items: { type: 'string' }, description: '引用的素材信号标识' },
        },
        required: ['title'],
      },
    },
    summary: { type: 'string', description: '本轮生成的整体说明' },
  },
  required: ['candidates'],
})

function cleanText(value, max) {
  if (typeof value !== 'string') return null
  const result = value.trim()
  if (!result) return null
  return result.length > max ? `${result.slice(0, max - 1)}…` : result
}

/**
 * Normalize the DSH structured output into display candidates. Unknown signal
 * references are dropped, never invented; candidates without basis stay honest
 * with an empty reference list. The DSH-provided order is kept — index 0 is
 * the recommended pick by prompt contract.
 */
export function normalizeCandidates(structured, material) {
  const known = new Set(material.signals.map((signal) => signal.id))
  const rawCandidates = Array.isArray(structured?.candidates) ? structured.candidates : []
  const candidates = []
  for (const item of rawCandidates) {
    if (!item || typeof item !== 'object') continue
    const title = cleanText(item.title, CANDIDATE_TITLE_MAX)
    if (!title) continue
    const signalIds = [...new Set(
      (Array.isArray(item.signalIds) ? item.signalIds : [])
        .filter((id) => typeof id === 'string' && known.has(id)),
    )].slice(0, SIGNAL_REF_LIMIT)
    candidates.push({
      title,
      angle: cleanText(item.angle, ANGLE_MAX),
      videoForm: cleanText(item.videoForm, 40),
      contentCore: cleanText(item.contentCore, 500),
      whyNow: cleanText(item.whyNow, 300),
      signalIds,
    })
    if (candidates.length >= CANDIDATE_LIMIT) break
  }
  return {
    candidates,
    summary: cleanText(structured?.summary, 500),
    requested: CANDIDATE_LIMIT,
    returned: candidates.length,
  }
}

export function summarizeInput(input, material, account = null) {
  const parts = []
  if (account?.name) parts.push(`账号「${account.name}」`)
  else parts.push('通用（无账号定位）')
  if (input.angle) parts.push('角度')
  const otherSources = input.sourceIds.filter((id) => id !== AI_DAILY_SOURCE_ID)
  if (otherSources.length) parts.push(`${otherSources.length} 个公开来源`)
  if (input.sourceIds.includes(AI_DAILY_SOURCE_ID)) {
    parts.push(input.platforms.length ? `AI 内容日报（${input.platforms.length} 个平台）` : 'AI 内容日报（全部平台）')
  }
  if (input.excludeSignalIds.length) parts.push(`排除 ${input.excludeSignalIds.length} 条`)
  return `${parts.join(' + ')} · 最新批次信号 ${material.signals.length} 条 · 实际覆盖 ${material.sourceIds?.length || 0} 个采集来源`
}
