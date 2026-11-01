import { randomUUID } from 'node:crypto'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { modelRouteState } from './pack-services.mjs'
const remoteInitializers = []
const PAYMENT_ROUTE = '/lwb/ats/payment'
const PAYMENT_FORM_TTL_MS = 10 * 60 * 1000
/** The LWB route's everyday model: what a brand-new install gets when it has none. */
const LWB_DEFAULT_MODEL = 'deepseek-v4.1-flash'

function decorateRemote(prototype, method, exportName) { const decorate = Remote(exportName); decorate(prototype[method], { kind: 'method', name: method, static: false, private: false, addInitializer(initializer) { remoteInitializers.push(initializer) } }) }
/** Browser-safe LWB account projection. Tokens stay in the Host credentials store. */
export class LwbAccountGateway extends TypertRemoteService {
  static inject = ['lwbAtsClient', 'webServer', 'lwbTaskModel', 'llm', 'lwbPackEntitlements']
  constructor(ctx) {
    super(ctx, 'lwbAccount')
    this.paymentForms = new Map()
    ctx.effect(() => ctx.webServer.register({
      kind: 'prefix',
      path: PAYMENT_ROUTE,
      handler: (request, response) => this.servePaymentForm(request, response),
    }), 'lwb-account: payment form route')
    for (const initializer of remoteInitializers) initializer.call(this)
  }
  async login(request) {
    const user = (await this.ctx.lwbAtsClient.login(request)).user
    await this.adoptDefaultModel().catch(() => {})
    return { user }
  }

  async register(request) {
    const user = (await this.ctx.lwbAtsClient.register(request)).user
    await this.adoptDefaultModel().catch(() => {})
    return { user }
  }

  /**
   * Give a fresh sign-in a model it can actually run.
   *
   * A new install can be signed in to LWB and still have nothing selected: the
   * Agent default is empty and `task-model` is on `follow-dsh`, which resolves to
   * that empty default. Every model call then fails at the point of use, and the
   * first place a user meets it is the fish pond's hatching ritual — a modal that
   * waits on a model turn and cannot say why.
   *
   * Deliberately narrow. It only fills an empty selection, so an operator who
   * chose a model, or who configured a provider credential, keeps it; and it only
   * writes a model the `lwb` route actually lists, so a signed-in account never
   * gets a selection that cannot resolve. The write goes through the ordinary
   * settings path, so the choice shows up in 设置 → 场景任务模型 like any other —
   * this is a default, not a hidden fallback.
   *
   * @returns whether a default was written, and which.
   */
  async adoptDefaultModel() {
    // Read through `get`, not the inject list: a host without the default-model
    // service must still be able to sign in. This is a convenience, not a need.
    const settings = this.ctx.get?.('agentDefaultModel')
    if (!settings?.saveSelection) return { adopted: false, reason: 'no-service' }
    const current = settings.currentSelection?.()
    if (typeof current?.provider === 'string' && current.provider.trim()
      && typeof current?.model === 'string' && current.model.trim()) {
      return { adopted: false, reason: 'already-chosen' }
    }
    const models = await this.ctx.llm.listModels('lwb').catch(() => [])
    const model = models.some((item) => item.id === LWB_DEFAULT_MODEL) ? LWB_DEFAULT_MODEL : models[0]?.id
    // No model list means the route is not answering yet; writing a guess here
    // would trade one unexplained failure for another.
    if (!model) return { adopted: false, reason: 'no-models' }
    await settings.saveSelection({ provider: 'lwb', model })
    return { adopted: true, provider: 'lwb', model }
  }
  async logout() { return this.ctx.lwbAtsClient.logout() }
  async status() {
    const account = await this.ctx.lwbAtsClient.status()
    this.ctx.lwbPackEntitlements?.invalidate()
    try { return { ...account, catalog: await this.ctx.lwbAtsClient.catalog(), serviceError: null } }
    catch (error) { return { ...account, catalog: null, serviceError: error.status === 404 ? '请先更新 ATS 服务以启用 LWB 模型与场景服务。' : error.message } }
  }
  async taskModel() {
    const groups = await Promise.all(this.ctx.llm.listProviders().map(async provider => {
      // The route's authentication state is display-only here: saving a model
      // whose credential is not configured yet stays allowed, because the
      // operator may configure it afterwards. `setTaskModel` is unchanged.
      const auth = await modelRouteState(this.ctx, provider.id)
      try { return { ...provider, auth, models: await this.ctx.llm.listModels(provider.id) } }
      catch { return { ...provider, auth, models: [] } }
    }))
    return { config: this.ctx.lwbTaskModel.get(), selection: this.ctx.lwbTaskModel.selection(), groups }
  }
  async setTaskModel(request) { await this.ctx.lwbTaskModel.update(request); return this.taskModel() }
  async rechargePackages() { return this.ctx.lwbAtsClient.rechargePackages() }
  async membershipPlans() { return this.ctx.lwbAtsClient.membershipPlans() }
  async createPayment(request) {
    const payment = await this.ctx.lwbAtsClient.createPayment(request)
    this.discardExpiredPaymentForms()
    const token = randomUUID()
    this.paymentForms.set(token, { html: payment.paymentFormHtml, expiresAt: Date.now() + PAYMENT_FORM_TTL_MS })
    const host = this.ctx.webServer.host === '0.0.0.0' ? '127.0.0.1' : this.ctx.webServer.host
    return {
      orderId: payment.orderId,
      orderNo: payment.orderNo,
      paymentPageUrl: `http://${host}:${this.ctx.webServer.port}${PAYMENT_ROUTE}/${token}`,
    }
  }
  async orderStatus(request) { return this.ctx.lwbAtsClient.orderStatus(request?.orderId || request) }
  async servePaymentForm(request, response) {
    if (request.method !== 'GET') {
      response.statusCode = 405
      response.setHeader('allow', 'GET')
      response.end()
      return
    }
    const pathname = new URL(request.url || '/', 'http://localhost').pathname
    const token = pathname.slice(`${PAYMENT_ROUTE}/`.length)
    if (!/^[0-9a-f-]{36}$/u.test(token)) {
      response.statusCode = 404
      response.end('支付链接无效或已过期。')
      return
    }
    this.discardExpiredPaymentForms()
    const payment = this.paymentForms.get(token)
    if (!payment) {
      response.statusCode = 410
      response.setHeader('content-type', 'text/plain; charset=utf-8')
      response.end('支付链接无效或已过期，请返回 LWB 重新创建订单。')
      return
    }
    response.statusCode = 200
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.setHeader('cache-control', 'no-store')
    response.setHeader('referrer-policy', 'no-referrer')
    response.setHeader('x-content-type-options', 'nosniff')
    response.end(payment.html)
  }
  discardExpiredPaymentForms(now = Date.now()) {
    for (const [token, payment] of this.paymentForms) if (payment.expiresAt <= now) this.paymentForms.delete(token)
  }
}
for (const method of ['login', 'register', 'logout', 'status', 'taskModel', 'setTaskModel', 'rechargePackages', 'membershipPlans', 'createPayment', 'orderStatus']) decorateRemote(LwbAccountGateway.prototype, method, method)
export default LwbAccountGateway
