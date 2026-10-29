/**
 * LWB 联网搜索 / 抓取的路由 provider（`lwb-web`）。
 *
 * ctx.web 的 provider 选择是**全局单值**（`web.searchProvider` / `web.fetchProvider` 各一个字符串，
 * 每次调用只读这一个值），没有 per-session 概念；而模型路由是 per-session 且可以中途切换的。
 * 因此「用 DeepSeek 账号的会话走官方、其余走我们的 ATS」这件事只能在 provider 内部按调用时刻判断。
 *
 * 判定规则（每次 search / fetch 各自判一次，跟随模型切换，不需要重开会话）：
 *   requestContext().provider === 'deepseek-account'  → 直连 DeepSeek 官方 Search/Fetch API
 *   requestContext().provider === 其它（lwb / bailian / minimax-cn / 自定义） → 走 LWB ATS，计点
 *   requestContext() 不可用（无 initiator 的后台调用） → 有官方凭据就用官方，否则用 ATS
 *
 * 官方链路若被明确拒绝（401/403，即这份账号登录态没开通 Search/Fetch 权益），
 * 默认回落 ATS 保证搜索能力不丢；`LWB_WEB_ACCOUNT_FALLBACK=0` 可关掉回落。
 *
 * 凭据安全：`deepseekAccount.resolveToken(url)` 只对账号平台自己的 origin 返回 token，
 * 所以账号 token 在物理上不可能被发到 ATS（link.scitiger.cn）。
 */
const PROVIDER_ID = 'lwb-web'
const ACCOUNT_ROUTE = 'deepseek-account'
const OFFICIAL_BASE_URL = 'https://api.deepseek.com/v1/tools'
const ATS_SEARCH_PATH = '/api/v1/web/search'
const ATS_FETCH_PATH = '/api/v1/web/fetch'
const API_KEY_REF = 'DEEPSEEK_API_KEY'
const SEARCH_TIMEOUT_MS = 60_000
const FETCH_TIMEOUT_MS = 60_000
const DEFAULT_SEARCH_COUNT = 8
const MAX_SEARCH_COUNT = 50
const MAX_QUERY_CHARS = 128
/** 官方接口回这些状态码，说明「这份凭据不被 /v1/tools/* 接受」，而不是用户搜错了东西。 */
const CREDENTIAL_REJECTED_STATUSES = new Set([401, 403])

const text = value => (typeof value === 'string' && value.trim() ? value.trim() : undefined)
/** 官方接口回了 4xx/5xx 时带的错误，用来判断「这份凭据是不是不被接受」。 */
class OfficialHttpError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'OfficialHttpError'
    this.status = status
  }
}
/** 搜索词按 DeepSeek 的入参约束归一：折叠空白，最多 128 个字符（按码点）。 */
const normalizeQuery = value => (typeof value === 'string'
  ? Array.from(value.replace(/\s+/gu, ' ').trim()).slice(0, MAX_QUERY_CHARS).join('')
  : '')
const numberFromEnv = (name, fallback) => {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

/** 当前发起这次工具调用的会话所用的模型路由；后台或无 initiator 时返回 undefined。 */
function currentRoute(ctx) {
  const agent = ctx.get('agents')?.currentInitiator?.()
  return agent?.session?.requestContext?.()?.provider
}

function officialBaseUrl() {
  return text(process.env.LWB_WEB_ACCOUNT_BASE_URL)?.replace(/\/+$/u, '') ?? OFFICIAL_BASE_URL
}

/**
 * 官方链路的两级凭据：优先用用户自己的 DeepSeek 账号 token，其次用登录时存的 DEEPSEEK_API_KEY。
 * @returns {{ headers: Record<string, string>, kind: 'account' | 'api-key' } | undefined}
 */
async function officialAuth(ctx, endpoint) {
  const account = ctx.get('deepseekAccount')
  if (account?.resolveToken) {
    try {
      const token = await account.resolveToken(endpoint)
      if (text(token)) return { headers: { 'x-dsh-auth-token': token }, kind: 'account' }
    } catch {
      // 账号未登录或凭据损坏时继续尝试 API Key，不把凭据层的异常抛给模型。
    }
  }
  const credentials = ctx.get('credentials')
  if (credentials?.resolve) {
    const stored = await credentials.resolve(API_KEY_REF).catch(() => undefined)
    if (text(stored?.value)) return { headers: { authorization: `Bearer ${text(stored?.value)}` }, kind: 'api-key' }
  }
  const ambient = text(process.env[API_KEY_REF])
  return ambient === undefined ? undefined : { headers: { authorization: `Bearer ${ambient}` }, kind: 'api-key' }
}

async function hasOfficialCredential(ctx) {
  return (await officialAuth(ctx, `${officialBaseUrl()}/search`)) !== undefined
}

function timeoutSignal(signal, ms) {
  const timeout = AbortSignal.timeout(ms)
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout])
}

/**
 * 官方链路：直连 DeepSeek Search / Fetch API。
 * 请求与响应形状和 ATS 侧完全同构，两条链路共用一个映射函数。
 */
async function officialRequest(ctx, path, body, { signal, timeoutMs }) {
  const endpoint = `${officialBaseUrl()}${path}`
  const auth = await officialAuth(ctx, endpoint)
  if (auth === undefined) {
    throw new Error(
      '联网搜索需要 DeepSeek 凭据：请在 DeepSeek 账号模式下登录，或把会话切换成 LWB 账号模型后重试。'
    )
  }
  let response
  try {
    response = await fetch(`${officialBaseUrl()}${path}`, {
      method: 'POST',
      redirect: 'error',
      headers: { ...auth.headers, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: timeoutSignal(signal, timeoutMs),
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error(`联网请求失败：${error instanceof Error ? error.message : String(error)}`)
  }
  return decodeOfficial(response, path, auth.kind)
}

async function decodeOfficial(response, path, authKind) {
  const payload = await readJson(response)
  if (response.ok) return payload
  // 「这一次没有可用正文」是抓取结果而不是故障：交给上层按 WebFetchResult 呈现。
  // 上游会把原因放在 error.message 里（带 request_id），必须原样留下，否则用户只看到空正文。
  if (path.endsWith('/fetch') && (response.status === 403 || response.status === 404)) {
    const reason = text(payload?.error?.message) ?? text(payload?.message)
    return { statusCode: response.status, content: '', ...(reason === undefined ? {} : { reason }) }
  }
  const detail = payload?.error?.message ?? payload?.message ?? ''
  const subject = path.endsWith('/search') ? '搜索' : '抓取'
  const suffix = authKind === 'account'
    ? '（当前用的是 DeepSeek 账号登录态；若已退出登录请重新登录）'
    : '（当前用的是 DEEPSEEK_API_KEY）'
  throw new OfficialHttpError(
    `DeepSeek ${subject}接口返回 HTTP ${response.status}${detail ? `：${detail}` : ''}${suffix}`,
    response.status,
  )
}

/**
 * ATS 链路：走 LWB 账号的服务凭据，由 ATS 持有 DeepSeek 密钥并计点。
 * `openService` 已经带了登录校验、令牌刷新、402 积分不足文案与用量变更通知。
 */
async function atsRequest(ctx, path, body, signal) {
  const client = ctx.get('lwbAtsClient')
  if (!client?.openService) {
    throw new Error('当前环境没有接入 LWB 账号服务，联网搜索不可用。')
  }
  let service
  try {
    service = await client.openService('web', { signal })
  } catch (error) {
    throw new Error(atsErrorMessage(error))
  }
  try {
    return await service.request(path, { method: 'POST', body: JSON.stringify(body) })
  } catch (error) {
    throw new Error(atsErrorMessage(error))
  }
}

/** 把 ATS 客户端的错误码翻译成模型能据此行动的一句话。 */
function atsErrorMessage(error) {
  const code = error?.code
  const detail = text(error?.message)
  if (code === 'LWB_ATS_NOT_AUTHENTICATED') {
    return '联网搜索需要 LWB 账号：请登录 LWB 账号，或把会话切换到 DeepSeek 账号模型后重试。'
  }
  if (code === 'LWB_ATS_SERVICE_UNAVAILABLE') {
    return `联网搜索服务暂不可用${detail ? `：${detail}` : '，请稍后重试或联系管理员。'}`
  }
  if (code === 'LWB_ATS_ACCOUNT_CHANGED') {
    return 'LWB 账号已变更，请重新发起这次搜索。'
  }
  if (error?.status === 402) return detail ?? 'LWB 积分不足，请购买积分后重试。'
  return detail ?? '联网搜索服务调用失败，请稍后重试。'
}

async function readJson(response) {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

/** DeepSeek / ATS 同构响应 → ctx.web 的 WebSearchResult。 */
function toSearchResult(payload) {
  const rows = Array.isArray(payload?.results) ? payload.results : []
  const sources = rows.flatMap((item) => {
    if (!item || typeof item.url !== 'string' || item.url.length === 0) return []
    const snippet = text(item.snippet) ?? text(item.summary)
    const title = text(item.title)
    const publishedAt = text(item.date)
    return [{
      url: item.url,
      ...(title === undefined ? {} : { title }),
      ...(snippet === undefined ? {} : { snippet }),
      ...(publishedAt === undefined ? {} : { publishedAt }),
    }]
  })
  return { sources, truncated: false }
}

/** DeepSeek / ATS 同构响应 → ctx.web 的 WebFetchResult。非 2xx 是结果，不是异常。 */
function toFetchResult(payload, requestUrl) {
  const content = typeof payload?.content === 'string' ? payload.content : ''
  const statusCode = Number.isInteger(payload?.statusCode) ? payload.statusCode : 200
  // 抓不到正文时上游会带一句原因（含 request_id）：把它当正文交出去，模型才知道该换来源。
  // 留空正文会让模型以为「这个页面本来就是空的」，进而反复重试同一个 URL。
  const reason = content.length > 0 ? undefined : text(payload?.reason)
  return {
    url: text(payload?.url) ?? requestUrl,
    statusCode,
    body: { kind: 'text', content: content.length > 0 ? content : (reason ?? '') },
    truncated: false,
  }
}

/**
 * 账号路由的兜底开关（默认开）。
 * 生产上官方接口回 401/403 的唯一解释是「账号体系没有给这份登录态开通 Search/Fetch 权益」，
 * 此时让用户彻底失去搜索能力，比多花 0.005 元严重得多。设 LWB_WEB_ACCOUNT_FALLBACK=0 可关闭。
 */
function accountFallbackEnabled() {
  const raw = process.env.LWB_WEB_ACCOUNT_FALLBACK
  return raw === undefined ? true : !/^(?:0|false|off|no)$/iu.test(raw.trim())
}

/**
 * 官方优先，凭据被拒绝时回落 ATS。
 * 只对「凭据被拒绝」回落：网络故障或上游 5xx 硬回落，只会让用户白花点数。
 */
async function officialThenFallback(ctx, { path, officialBody, atsPath, atsBody, signal, timeoutMs }) {
  try {
    return await officialRequest(ctx, path, officialBody, { signal, timeoutMs })
  } catch (error) {
    if (!(error instanceof OfficialHttpError)) throw error
    if (!CREDENTIAL_REJECTED_STATUSES.has(error.status) || !accountFallbackEnabled()) throw error
    try {
      return await atsRequest(ctx, atsPath, atsBody, signal)
    } catch (fallbackError) {
      throw new Error(`${error.message}；备用通道同样不可用：${fallbackError.message}`)
    }
  }
}

async function runSearch(ctx, request, signal) {
  const query = normalizeQuery(request?.query)
  if (query.length === 0) throw new Error('搜索词不能为空。')
  const count = Math.min(
    Number.isInteger(request?.maxResults) && request.maxResults > 0 ? request.maxResults : DEFAULT_SEARCH_COUNT,
    MAX_SEARCH_COUNT,
  )
  const atsBody = { query, count, needContent: false }
  const payload = (await routeIsOfficial(ctx))
    ? await officialThenFallback(ctx, {
      path: '/search',
      officialBody: { query, count, need_content: false },
      atsPath: ATS_SEARCH_PATH,
      atsBody,
      signal,
      timeoutMs: numberFromEnv('LWB_WEB_SEARCH_TIMEOUT_MS', SEARCH_TIMEOUT_MS),
    })
    : await atsRequest(ctx, ATS_SEARCH_PATH, atsBody, signal)
  return toSearchResult(payload)
}

async function runFetch(ctx, request, signal) {
  const url = text(request?.url)
  if (url === undefined) throw new Error('要抓取的网址不能为空。')
  const atsBody = { url }
  const payload = (await routeIsOfficial(ctx))
    ? await officialThenFallback(ctx, {
      path: '/fetch',
      officialBody: { url },
      atsPath: ATS_FETCH_PATH,
      atsBody,
      signal,
      timeoutMs: numberFromEnv('LWB_WEB_FETCH_TIMEOUT_MS', FETCH_TIMEOUT_MS),
    })
    : await atsRequest(ctx, ATS_FETCH_PATH, atsBody, signal)
  return toFetchResult(payload, url)
}

/**
 * 这一次调用该走官方还是 ATS。
 * - 路由明确是 deepseek-account：官方。
 * - 路由明确是别的：ATS。
 * - 路由未知：官方凭据可用就走官方（绝不因为判定不出来就悄悄扣用户点数）。
 */
async function routeIsOfficial(ctx) {
  const route = currentRoute(ctx)
  if (route === ACCOUNT_ROUTE) return true
  if (route !== undefined) return false
  return hasOfficialCredential(ctx)
}

/** 注册 lwb-web 的 search / fetch 两个 provider。 */
export function registerLwbWebRouter(ctx) {
  const disposers = [
    ctx.web.registerSearchProvider({
      id: PROVIDER_ID,
      // 可用性必须恒为 true：它是全局判定，返回 false 会让所有用户一起失去搜索能力。
      // 真正缺凭据的情况在调用时抛带指引的错误。
      available: () => true,
      search: (request, signal) => runSearch(ctx, request, signal),
    }),
    ctx.web.registerFetchProvider({
      id: PROVIDER_ID,
      available: () => true,
      fetch: (request, signal) => runFetch(ctx, request, signal),
    }),
  ]
  return () => {
    for (const dispose of disposers) dispose()
  }
}

export { PROVIDER_ID, currentRoute, toSearchResult, toFetchResult, routeIsOfficial }
