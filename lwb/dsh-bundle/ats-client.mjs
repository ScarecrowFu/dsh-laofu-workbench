import { randomUUID } from 'node:crypto'

const SESSION_REF = 'lwb_ats_session'
const SERVICE_REF = 'lwb_ats_service'
const DEFAULT_BASE_URL = 'https://link.scitiger.cn'
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : undefined }
function normalizeBaseUrl(value) {
  const base = text(value) || DEFAULT_BASE_URL
  const url = new URL(base)
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') throw new Error('LWB ATS 地址必须使用 HTTPS。')
  return url.href.replace(/\/$/u, '')
}
function errorWithCode(message, code, status) { const error = new Error(message); error.code = code; if (status) error.status = status; return error }

function normalizePublicPackage(value) {
  if (!value || typeof value !== 'object') return null
  const packageValue = value
  const code = text(packageValue.code)
  if (!code) return null
  return {
    code,
    name: text(packageValue.name) || code,
    amountCents: Number.isFinite(packageValue.amountCents) ? packageValue.amountCents : 0,
    pointsAmount: Number.isFinite(packageValue.pointsAmount) ? packageValue.pointsAmount : 0,
    bonusPoints: Number.isFinite(packageValue.bonusPoints) ? packageValue.bonusPoints : 0,
    totalPoints: Number.isFinite(packageValue.totalPoints) ? packageValue.totalPoints : 0,
  }
}

function purchasableMembershipPlan(plan) {
  const code = text(plan?.code)?.toLowerCase()
  return Boolean(code) && code !== 'free' && code !== 'trial' && Number(plan.monthlyPriceCents) > 0
}

function normalizePublicPlan(value) {
  if (!value || typeof value !== 'object' || !purchasableMembershipPlan(value)) return null
  const plan = value
  const code = text(plan.code)
  if (!code) return null
  return {
    code,
    name: text(plan.name) || code,
    monthlyPriceCents: Number.isFinite(plan.monthlyPriceCents) ? plan.monthlyPriceCents : 0,
    monthlyPointsGrant: Number.isFinite(plan.monthlyPointsGrant) ? plan.monthlyPointsGrant : 0,
    priceDiscount: Number.isFinite(plan.priceDiscount) ? plan.priceDiscount : 1,
    rpmLimit: Number.isFinite(plan.rpmLimit) ? plan.rpmLimit : undefined,
    maxApiKeys: Number.isFinite(plan.maxApiKeys) ? plan.maxApiKeys : undefined,
  }
}

/** Host-owned ATS protocol. Tokens never cross the browser RPC boundary. */
export class LwbAtsClient {
  constructor({ credentials, fetch = globalThis.fetch, baseUrl, deviceId, deviceName } = {}) {
    if (!credentials) throw new Error('LWB ATS 客户端缺少凭据服务。')
    if (typeof fetch !== 'function') throw new Error('LWB ATS 客户端缺少网络服务。')
    this.credentials = credentials; this.fetch = fetch; this.baseUrl = normalizeBaseUrl(baseUrl)
    this.deviceId = text(deviceId) || randomUUID(); this.deviceName = text(deviceName) || 'LWB'; this.refreshing = null
    this.generation = 0; this.serviceAbort = new AbortController(); this.listeners = new Set(); this.catalogCache = null; this.bootstrapping = null; this.credentialWrites = Promise.resolve()
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  changed(kind = 'account') { for (const listener of this.listeners) { try { listener(kind) } catch {} } }
  invalidateServices() { this.generation += 1; this.serviceAbort.abort(); this.serviceAbort = new AbortController(); this.catalogCache = null; this.bootstrapping = null; this.refreshing = null }
  assertGeneration(generation) { if (generation !== this.generation) throw errorWithCode('LWB 账号已变更，请重试。', 'LWB_ATS_ACCOUNT_CHANGED') }
  mutateCredentials(work, generation) {
    const pending = this.credentialWrites.then(async () => { if (generation !== undefined) this.assertGeneration(generation); const result = await work(); if (generation !== undefined) this.assertGeneration(generation); return result })
    this.credentialWrites = pending.catch(() => {})
    return pending
  }
  async readSession() {
    const stored = await this.credentials.resolve(SESSION_REF).catch(() => undefined); const raw = stored?.value
    if (!raw) return null
    try { const session = JSON.parse(raw); return text(session?.accessToken) && text(session?.refreshToken) ? session : null } catch { return null }
  }
  async writeSession(session, generation = this.generation) {
    const safe = { accessToken: text(session?.accessToken), refreshToken: text(session?.refreshToken), user: session?.user && { id: String(session.user.id), email: text(session.user.email), role: text(session.user.role) } }
    if (!safe.accessToken || !safe.refreshToken) throw errorWithCode('ATS 登录响应缺少会话令牌。', 'LWB_ATS_PROTOCOL_ERROR')
    await this.mutateCredentials(() => this.credentials.set(SESSION_REF, JSON.stringify(safe)), generation); return safe
  }
  async clearSession() { this.invalidateServices(); const generation = this.generation; await this.mutateCredentials(() => Promise.all([this.credentials.unset(SESSION_REF), this.credentials.unset(SERVICE_REF)])); this.changed(); return generation }
  async raw(path, { method = 'GET', body, accessToken } = {}) {
    const response = await this.fetch(`${this.baseUrl}${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(30000), headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    let payload; try { payload = await response.json() } catch { payload = undefined }
    if (!response.ok) { const message = text(payload?.message) || text(payload?.error) || `ATS 请求失败（${response.status}）。`; throw errorWithCode(message, response.status === 401 ? 'LWB_ATS_UNAUTHORIZED' : 'LWB_ATS_REQUEST_FAILED', response.status) }
    return payload
  }
  async refresh(session) {
    if (!session?.refreshToken) throw errorWithCode('LWB 账号尚未登录。', 'LWB_ATS_NOT_AUTHENTICATED')
    const generation = this.generation
    if (this.refreshing) return this.refreshing
    const work = this.raw('/api/auth/refresh', { method: 'POST', body: { refreshToken: session.refreshToken, clientType: 'desktop', deviceId: this.deviceId, deviceName: this.deviceName } }).then((next) => {
      if (generation !== this.generation) throw errorWithCode('LWB 账号已变更，请重试。', 'LWB_ATS_ACCOUNT_CHANGED')
      return this.writeSession(next, generation)
    }).catch(async (error) => { if (generation === this.generation && error.status === 401) await this.clearSession(); throw error })
    this.refreshing = work
    try { return await work } finally { if (this.refreshing === work) this.refreshing = null }
  }
  async request(path, options = {}, retry = true) {
    const generation = this.generation
    const session = await this.readSession(); this.assertGeneration(generation); if (!session) throw errorWithCode('请先登录 LWB 账号。', 'LWB_ATS_NOT_AUTHENTICATED')
    try { const value = await this.raw(path, { ...options, accessToken: session.accessToken }); this.assertGeneration(generation); return value } catch (error) {
      this.assertGeneration(generation)
      if (retry && error?.code === 'LWB_ATS_UNAUTHORIZED') { const next = await this.refresh(session); this.assertGeneration(generation); const value = await this.raw(path, { ...options, accessToken: next.accessToken }); this.assertGeneration(generation); return value }
      throw error
    }
  }
  async login({ account, password }) {
    const generation = this.generation
    const value = await this.raw('/api/auth/login', { method: 'POST', body: { account: text(account), password, clientType: 'desktop', deviceId: this.deviceId, deviceName: this.deviceName } })
    if (generation !== this.generation) throw errorWithCode('LWB 账号已变更，请重试。', 'LWB_ATS_ACCOUNT_CHANGED')
    const nextGeneration = await this.clearSession(); const result = await this.writeSession(value, nextGeneration); this.changed(); return result
  }
  async register({ email, password, confirmPassword, activationCode }) {
    const normalizedActivationCode = text(activationCode)
    const body = { email: text(email), password, confirmPassword, clientType: 'desktop', deviceId: this.deviceId, deviceName: this.deviceName }
    if (normalizedActivationCode) body.activationCode = normalizedActivationCode
    const path = normalizedActivationCode ? '/api/auth/register-with-activation' : '/api/auth/register'
    const generation = this.generation
    const value = await this.raw(path, { method: 'POST', body })
    if (generation !== this.generation) throw errorWithCode('LWB 账号已变更，请重试。', 'LWB_ATS_ACCOUNT_CHANGED')
    const nextGeneration = await this.clearSession(); const result = await this.writeSession(value, nextGeneration); this.changed(); return result
  }
  async logout() { const session = await this.readSession(); await this.clearSession(); if (session?.refreshToken) await this.raw('/api/auth/logout', { method: 'POST', body: { refreshToken: session.refreshToken } }).catch(() => undefined); return { ok: true } }
  async status() { const [user, membership, points] = await Promise.all([this.request('/api/auth/me'), this.request('/api/membership/current'), this.request('/api/points/account')]); return { user, membership, points, entitlements: null } }
  async catalog(force = false) {
    const generation = this.generation
    const session = await this.readSession()
    this.assertGeneration(generation)
    if (!session) throw errorWithCode('请先登录 LWB 账号。', 'LWB_ATS_NOT_AUTHENTICATED')
    if (!force && this.catalogCache?.userId === session.user?.id && this.catalogCache.expiresAt > Date.now()) return this.catalogCache.value
    const value = await this.request('/api/lwb/catalog')
    if (generation !== this.generation) throw errorWithCode('LWB 账号已变更，请重试。', 'LWB_ATS_ACCOUNT_CHANGED')
    if (value?.schemaVersion !== 1 || !Array.isArray(value.models) || !value.services) throw errorWithCode('LWB 服务目录格式不正确，请更新 ATS 服务。', 'LWB_ATS_PROTOCOL_ERROR')
    const changed = JSON.stringify(this.catalogCache?.value?.models) !== JSON.stringify(value.models)
    this.catalogCache = { userId: session.user?.id, value, expiresAt: Date.now() + 30000 }
    if (changed) this.changed('catalog')
    return value
  }
  async serviceStatus(service) {
    const generation = this.generation
    const session = await this.readSession()
    this.assertGeneration(generation)
    if (!session) return { configured: false, authenticated: false, writable: false, reason: '请先登录 LWB 账号。' }
    try {
      const state = (await this.catalog()).services[service]
      this.assertGeneration(generation)
      return { configured: state?.available === true, authenticated: true, writable: false, source: 'lwb-account', userId: session.user?.id, minimumPoints: state?.minimumPoints, reason: state?.reason || null }
    } catch (error) { return { configured: false, authenticated: Boolean(await this.readSession()), writable: false, reason: error.status === 404 ? '请先更新 ATS 服务以启用 LWB 账号调用。' : error.message } }
  }
  async serviceCredential() {
    const generation = this.generation
    const session = await this.readSession()
    this.assertGeneration(generation)
    if (!session?.user?.id) throw errorWithCode('请先登录 LWB 账号。', 'LWB_ATS_NOT_AUTHENTICATED')
    const stored = await this.credentials.resolve(SERVICE_REF)
    let cached; try { cached = JSON.parse(stored?.value || 'null') } catch {}
    this.assertGeneration(generation)
    if (cached?.userId === session.user.id && text(cached.apiKey) && cached.baseUrl === this.baseUrl) return cached
    if (this.bootstrapping) return this.bootstrapping
    const work = (async () => {
      const value = await this.request('/api/lwb/bootstrap', { method: 'POST', body: {} })
      if (generation !== this.generation) throw errorWithCode('LWB 账号已变更，请重试。', 'LWB_ATS_ACCOUNT_CHANGED')
      if (value?.application !== 'lwb' || String(value.userId) !== session.user.id || !text(value.credential?.apiKey)) throw errorWithCode('LWB 服务凭据响应无效，请更新 ATS 服务。', 'LWB_ATS_PROTOCOL_ERROR')
      const credential = { userId: session.user.id, apiKey: value.credential.apiKey, baseUrl: this.baseUrl }
      await this.mutateCredentials(() => this.credentials.set(SERVICE_REF, JSON.stringify(credential)), generation)
      return credential
    })()
    this.bootstrapping = work
    try { return await work } finally { if (this.bootstrapping === work) this.bootstrapping = null }
  }
  async openService(service, { userId, signal } = {}) {
    const generation = this.generation
    const state = await this.serviceStatus(service)
    if (!state.configured) throw errorWithCode(state.reason || 'LWB 服务暂不可用。', state.authenticated ? 'LWB_ATS_SERVICE_UNAVAILABLE' : 'LWB_ATS_NOT_AUTHENTICATED')
    if (userId && userId !== state.userId) throw errorWithCode('此任务属于其他 LWB 账号，请登录原账号后重试。', 'LWB_ATS_ACCOUNT_CHANGED')
    const credential = await this.serviceCredential()
    const boundSignal = signal ? AbortSignal.any([signal, this.serviceAbort.signal]) : this.serviceAbort.signal
    const assertCurrent = () => { boundSignal.throwIfAborted(); if (generation !== this.generation) throw errorWithCode('LWB 账号已变更，请重新提交任务。', 'LWB_ATS_ACCOUNT_CHANGED') }
    assertCurrent()
    return Object.freeze({
      userId: credential.userId,
      request: async (path, init = {}) => {
        assertCurrent(); assertServicePath(service, path, init.method || 'GET')
        const headers = new Headers(init.headers)
        headers.set('authorization', `Bearer ${credential.apiKey}`)
        if (typeof init.body === 'string') headers.set('content-type', 'application/json')
        const response = await this.fetch(`${this.baseUrl}${path}`, { ...init, headers, signal: AbortSignal.any([boundSignal, AbortSignal.timeout(120000)]), redirect: 'error' })
        assertCurrent()
        let value; try { value = await response.json() } catch { throw errorWithCode('LWB 服务返回了无效数据。', 'LWB_ATS_PROTOCOL_ERROR') }
        assertCurrent()
        if (!response.ok) {
          if (response.status === 401) await this.mutateCredentials(() => this.credentials.unset(SERVICE_REF), generation)
          this.changed('usage')
          throw errorWithCode(response.status === 402 ? 'LWB 积分不足，请购买积分后重试。' : text(value?.message) || text(value?.error?.message) || 'LWB 服务调用失败。', 'LWB_ATS_SERVICE_FAILED', response.status)
        }
        this.changed('usage')
        return value
      },
    })
  }
  async discardServiceCredential(generation = this.generation) {
    if (generation === this.generation) await this.mutateCredentials(() => this.credentials.unset(SERVICE_REF), generation)
  }
  async rechargePackages() {
    const payload = await this.request('/api/recharge-packages')
    return Array.isArray(payload) ? payload.map(normalizePublicPackage).filter(Boolean) : []
  }
  async membershipPlans() {
    const payload = await this.request('/api/membership/plans')
    return Array.isArray(payload) ? payload.map(normalizePublicPlan).filter(Boolean) : []
  }
  async createPayment({ type, code }) {
    if (type !== 'recharge' && type !== 'membership') throw errorWithCode('不支持的购买类型。', 'LWB_ATS_INVALID_PURCHASE')
    const normalizedCode = text(code)
    if (!normalizedCode) throw errorWithCode('购买套餐缺少编码。', 'LWB_ATS_INVALID_PURCHASE')
    const order = await this.request('/api/orders', { method: 'POST', body: { type, code: normalizedCode } })
    const orderId = text(order?.id)
    if (!orderId) throw errorWithCode('ATS 创建订单响应缺少订单编号。', 'LWB_ATS_PROTOCOL_ERROR')
    const payment = await this.request(`/api/orders/${encodeURIComponent(orderId)}/pay/alipay`, { method: 'POST' })
    const paymentFormHtml = text(payment?.paymentFormHtml)
    if (!paymentFormHtml) throw errorWithCode('ATS 支付响应缺少收银台页面。', 'LWB_ATS_PROTOCOL_ERROR')
    return { orderId: text(payment?.orderId) || orderId, orderNo: text(payment?.orderNo) || text(order?.orderNo) || orderId, paymentFormHtml }
  }
  async orderStatus(orderId) {
    const normalizedId = text(orderId)
    if (!normalizedId) throw errorWithCode('订单编号不能为空。', 'LWB_ATS_INVALID_ORDER')
    return this.request(`/api/orders/${encodeURIComponent(normalizedId)}`)
  }
}
function assertServicePath(service, path, method) {
  const rules = {
    tts: [['POST', /^\/api\/v1\/tts\/jobs$/u], ['GET', /^\/api\/v1\/tts\/jobs\/[A-Za-z0-9_-]+$/u], ['POST', /^\/api\/v1\/media\/audio-uploads$/u]],
    subtitle: [['POST', /^\/api\/v1\/subtitle\/jobs$/u], ['GET', /^\/api\/v1\/subtitle\/jobs\/[A-Za-z0-9_-]+$/u], ['POST', /^\/api\/v1\/media\/audio-uploads$/u]],
    'cover-image': [['POST', /^\/api\/lwb\/cover-images$/u], ['GET', /^\/api\/v1\/tasks\/[A-Za-z0-9_-]+$/u]],
  }
  if (!rules[service]?.some(([verb, pattern]) => verb === method.toUpperCase() && pattern.test(path))) throw errorWithCode('能力包请求了不允许的 LWB 服务路径。', 'LWB_ATS_SERVICE_SCOPE')
}
export { DEFAULT_BASE_URL, SESSION_REF, normalizeBaseUrl, normalizePublicPackage, normalizePublicPlan }
