import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'
import * as cordis from '../../../vendor/deepseek-harness/vendor/cordis/lib/index.js'
import Loader from '../../../vendor/deepseek-harness/vendor/loader/lib/index.js'

const require = createRequire(import.meta.url)
const upstreamRequire = createRequire(new URL('../../../vendor/deepseek-harness/package.json', import.meta.url))
const { JSDOM } = upstreamRequire('jsdom')

// Use real traced Cordis services: a plain { account: ... } mock hides a
// missing remote.account injection and lets a broken Desktop boot pass.
async function checkClientActivation(accountInitiallyReady, exerciseAccountControls = false, exerciseLwbLogin = false, exerciseLwbPurchase = false) {
  const dom = new JSDOM('<!doctype html><title>DSH</title><body></body>', { url: 'http://localhost/' })
  const ctx = new cordis.Context()
  let plugin
  let opened = 0
  let disposed = 0
  let accepted = 0
  let finishStream = () => {}
  let closed = false
  let accountView = { status: exerciseAccountControls ? 'credential-stored' : 'signed-out', attempt: null }
  const frames = [accountView]
  const calls = []
  let lwbSignedIn = false
  const marketCalls = []
  // The purchase flow owns the only timers in the client, so the test drives its
  // poll, its poll budget and its auto-dismiss instead of waiting on real clocks.
  const purchase = { paid: false, closed: false, statusReads: 0, orderStatusCalls: 0, statusGate: null, clockOffset: 0, timerId: 0, timers: new Map(), intervalCallbacks: [] }
  class OffsetDate extends Date {
    constructor(...args) { super(...(args.length ? args : [Date.now() + purchase.clockOffset])) }
    static now() { return Date.now() + purchase.clockOffset }
  }
  const gatedPack = { id: 'model-review', packageName: '@example/model-review', name: 'Model Review', version: '1.0.0',
    status: 'available', menus: [{ id: 'home', label: 'Home' }], required: true }
  const publish = value => { accountView = value; frames.push(value); finishStream() }
  const stream = {
    async *[Symbol.asyncIterator]() {
      while (!closed) {
        if (frames.length) yield { value: frames.shift(), accept() { accepted++ } }
        else await new Promise(resolve => { finishStream = resolve })
      }
    },
    dispose() { disposed++; closed = true; finishStream() },
  }
  class Remote extends cordis.Service {
    constructor(context) { super(context, 'remote') }
    $stream(options) { return options.open(new AbortController().signal) }
  }
  class Account extends cordis.Service {
    constructor(context) { super(context, 'remote.account') }
    watch() { opened++; return stream }
    async hasRunningAccountTasks() { return { ok: true, value: false } }
    async signOut() {
      calls.push('signOut')
      publish({ status: 'signed-out', attempt: null })
      return { ok: true, value: accountView }
    }
    async startSignIn(client, origin, source) {
      calls.push({ method: 'startSignIn', client, origin, source })
      publish({ status: 'signed-out', attempt: { id: 'local-attempt', phase: 'waiting-browser' } })
      return { ok: true, value: accountView }
    }
  }
  const window = dom.window
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  if (exerciseLwbPurchase) {
    // jsdom reports "prerender", which would let the client's refocus sync skip.
    Object.defineProperty(window.document, 'visibilityState', { value: 'visible', configurable: true })
    window.open = () => ({ closed: false })
    window.setTimeout = (fn) => { purchase.timerId += 1; purchase.timers.set(purchase.timerId, fn); return purchase.timerId }
    window.clearTimeout = (id) => { purchase.timers.delete(id) }
  }
  window.localStorage.setItem('lwb.workbench.v3', JSON.stringify({ page: 'settings' }))
  const React = require('react')
  window.__ModuleLoader__ = { load({ factory }) {
    plugin = factory(name => name === '@deepseek-ai/dsh-client-ui-primitives' ? new Proxy({}, { get: () => () => null }) : require(name))
  } }
  vm.runInNewContext(await readFile(new URL('../client.js', import.meta.url), 'utf8'), {
    window, document: window.document, localStorage: window.localStorage,
    MutationObserver: window.MutationObserver, Node: window.Node, NodeFilter: window.NodeFilter,
    AbortController, URL, setInterval, clearInterval,
    ...(exerciseLwbPurchase ? {
      Date: OffsetDate,
      setInterval: (fn) => { purchase.intervalCallbacks.push(fn); return purchase.intervalCallbacks.length },
      clearInterval: () => {},
    } : {}),
  })
  const slots = new Map()
  ctx.provide('slots', {
    inject(_name, register) { return register() },
    register(options, component) {
      slots.set(options.name, component)
      return () => { slots.delete(options.name) }
    },
  })
  ctx.provide('connection', { rpc: { async call(_path, method) {
    if (method === 'lwbPacks/visibility') return { ok: true, value: { sessionIds: [], workspacePaths: [] } }
    if (method === 'lwbPacks/list') return { ok: true, value: { packs: [] } }
    if (method === 'lwbPacks/market') {
      marketCalls.push(lwbSignedIn)
      return { ok: true, value: { packs: exerciseLwbLogin ? [{ ...gatedPack, allowed: lwbSignedIn }] : [] } }
    }
    if (exerciseLwbLogin || exerciseLwbPurchase) {
      if (method === 'lwbAccount/login' || method === 'lwbAccount/register') { lwbSignedIn = true; return { ok: true, value: { user: { id: 'member' } } } }
      if (method === 'lwbAccount/logout') { lwbSignedIn = false; return { ok: true, value: {} } }
      if (method === 'lwbAccount/status') {
        purchase.statusReads += 1
        // The snapshot is captured when the read starts: a read that was already
        // in flight when the payment settled must not report the paid points.
        const snapshot = lwbSignedIn
          ? { ok: true, value: { user: { id: 'member', email: 'member@example.com' }, membership: { planCode: 'business', status: 'active' }, points: { availablePoints: purchase.paid ? 4200000 : 120 } } }
          : { ok: false, error: { code: 'LWB_ATS_NOT_AUTHENTICATED', message: 'Please log in' } }
        if (exerciseLwbPurchase && purchase.statusGate) { const gate = purchase.statusGate; purchase.statusGate = null; await gate }
        return snapshot
      }
      if (method === 'lwbAccount/taskModel') return { ok: true, value: { config: {}, groups: [] } }
      if (method === 'lwbAccount/rechargePackages') return { ok: true, value: exerciseLwbPurchase ? [{ code: 'starter', name: '基础包', amountCents: 1000, totalPoints: 1000000 }] : [] }
      if (method === 'lwbAccount/membershipPlans') return { ok: true, value: [] }
      if (exerciseLwbPurchase && method === 'lwbAccount/createPayment') return { ok: true, value: { orderId: '77', orderNo: 'ATS-77', paymentPageUrl: 'http://localhost/lwb/ats/payment/token' } }
      if (exerciseLwbPurchase && method === 'lwbAccount/orderStatus') {
        purchase.orderStatusCalls += 1
        if (purchase.closed) return { ok: true, value: { status: 'voided', terminal: true, shouldRefreshAccount: false } }
        return purchase.paid
          ? { ok: true, value: { status: 'paid', terminal: true, shouldRefreshAccount: true, paidAt: '2026-10-07T00:00:00.000Z' } }
          : { ok: true, value: { status: 'created' } }
      }
    }
    throw new Error(`Unexpected RPC: ${method}`)
  } } })
  for (const name of ['sessions', 'workspaces', 'uiWorkspace', 'layout', 'locale', 'modules']) ctx.provide(name, {})
  try {
    await ctx.plugin(Loader).await()
    await ctx.plugin(Remote).await()
    if (accountInitiallyReady) await ctx.plugin(Account).await()
    ctx.loader.internal = { version: 'client', async import() { return plugin } }
    await ctx.loader.create({ name: '@scitiger-ai/lwb-dsh-bundle' })
    await ctx.loader.await()
    const entry = [...ctx.loader.entries()][0]
    if (!accountInitiallyReady) {
      assert.equal(entry.fiber.state, 0, 'wait for the account namespace before applying the shell')
      assert.equal(opened, 0)
      await ctx.plugin(Account).await()
    }
    await entry.fiber.await()
    assert.equal(entry.fiber.state, 2, 'the Desktop boot audit requires an ACTIVE client')
    assert.ok(ctx.get('lwbPackClient'), 'capability registration remains available')
    assert.ok(slots.has('sidebar'))
    assert.ok(slots.has('shell.overlay'))
    assert.ok(slots.has('conversation.hero.brand.mark'))
    const brand = slots.get('conversation.hero.brand.mark')({ size: 34 })
    assert.equal(brand.type, 'img')
    assert.equal(brand.props.src, '/lwb/branding/logo.png')
    assert.equal(brand.props.width, 34)
    assert.equal(window.document.querySelector('link[rel="icon"]').getAttribute('href'), brand.props.src)
    assert.equal(opened, 1, 'the official account stream starts once')
    assert.equal(accepted, 1, 'account snapshots are accepted')
    if (exerciseAccountControls || exerciseLwbLogin || exerciseLwbPurchase) {
      const originals = Object.fromEntries(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
      Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true })
      const { createRoot } = require('react-dom/client')
      const container = window.document.createElement('div')
      window.document.body.append(container)
      const root = createRoot(container)
      try {
        await React.act(async () => root.render(React.createElement(React.Fragment, null,
          exerciseLwbLogin && React.createElement(slots.get('sidebar'), { collapsed: false, width: 248 }),
          React.createElement(slots.get('shell.overlay'), { renderSlot: () => null }))))
        const flush = async () => { for (let n = 0; n < 4; n++) await new Promise(resolve => setTimeout(resolve, 0)) }
        const click = async node => { assert.ok(node); await React.act(async () => { node.click(); await flush() }) }
        const fill = async (selector, value) => {
          const input = container.querySelector(selector)
          await React.act(async () => {
            Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value)
            input.dispatchEvent(new window.Event('input', { bubbles: true }))
            await flush()
          })
        }
        const payAlipay = () => [...container.querySelectorAll('.lwb-purchase-card button')].find(node => node.textContent === '支付宝支付')
        if (exerciseLwbPurchase) {
          // The purchase section lives on the settings page, which localStorage
          // already selected; signing in is what reveals the plans.
          const banner = () => container.querySelector('.lwb-payment-status')
          const bannerButtons = () => [...container.querySelectorAll('.lwb-payment-status .lwb-row-actions button')].map(node => node.textContent)
          const runTimers = async () => {
            const pending = [...purchase.timers.values()]
            purchase.timers.clear()
            await React.act(async () => { for (const run of pending) void run(); await flush() })
          }
          await fill('.lwb-account-form input[type="text"]', 'member@example.com')
          await fill('.lwb-account-form input[type="password"]', 'test-password')
          await click(container.querySelector('.lwb-account-form button[type="submit"]'))
          await React.act(async () => { await flush() })
          await click([...container.querySelectorAll('.lwb-purchase-tabs button')].find(node => node.textContent === '积分包'))
          assert.ok(banner() === null, 'no order banner exists before an order does')
          assert.ok(container.textContent.includes('1000000'), 'the recharge tab renders its package')

          // A live order keeps the cashier actions next to the explicit clear.
          await click(payAlipay())
          assert.equal(banner().dataset.status, 'pending')
          assert.deepEqual(bannerButtons(), ['打开收银台', '检查支付状态', '清除订单'])
          assert.ok(banner().textContent.includes('订单待支付'))

          // A settled order: the ATS terminal contract ends the poll, the banner
          // reports success, and the account is read again instead of reusing the
          // read that was already in flight when the payment settled.
          let releaseGate
          purchase.statusGate = new Promise(resolve => { releaseGate = resolve })
          window.dispatchEvent(new window.Event('focus'))
          await React.act(async () => { await flush() })
          const parkedReads = purchase.statusReads
          purchase.paid = true
          await runTimers()
          assert.equal(banner().dataset.status, 'paid', 'the terminal status ends polling without a manual clear')
          assert.ok(banner().textContent.includes('支付成功'))
          assert.deepEqual(bannerButtons(), ['完成'], 'the success banner stops offering 清除订单')
          assert.equal(purchase.orderStatusCalls, 1, 'a terminal order is polled once')
          await React.act(async () => { releaseGate(); await flush(); await flush() })
          assert.equal(purchase.statusReads, parkedReads + 1, 'the post-payment read is issued after the parked one settles')
          assert.ok(container.textContent.includes('4200000'), 'the account shows the post-payment points, not the parked snapshot')
          await runTimers()
          // Stated as a boolean: a failed DOM-node comparison would inspect the
          // whole jsdom tree and stall the runner instead of reporting the miss.
          assert.ok(banner() === null, 'a successful payment dismisses its own banner')

          // The poll budget ends an order that never reaches a terminal status.
          await click(payAlipay())
          purchase.clockOffset = 13 * 60 * 1000
          await runTimers()
          assert.equal(banner().dataset.status, 'timeout')
          assert.deepEqual(bannerButtons(), ['检查支付状态', '清除订单'])
          assert.ok(banner().textContent.includes('超时'))
          const polledBeforeTimeout = purchase.orderStatusCalls
          await runTimers()
          assert.equal(purchase.orderStatusCalls, polledBeforeTimeout, 'a timed-out order stops polling')

          // An unrecognised terminal status ends the poll and leaves the account alone.
          purchase.closed = true
          const readsBeforeClosed = purchase.statusReads
          await click([...container.querySelectorAll('.lwb-payment-status .lwb-row-actions button')].find(node => node.textContent === '检查支付状态'))
          assert.equal(banner().dataset.status, 'expired', 'a terminal status outside the paid set ends the order')
          assert.deepEqual(bannerButtons(), ['清除订单'])
          assert.equal(purchase.statusReads, readsBeforeClosed, 'an order that needs no refresh does not read the account')
        } else if (exerciseLwbLogin) {
          const navigate = name => click([...container.querySelectorAll('.lwb-nav-item')].find(node => node.textContent === name))
          await navigate('场景能力包')
          const action = () => container.querySelector('.lwb-pack-actions .lwb-primary-button')
          assert.equal(action().textContent, '需要会员')
          assert.equal(action().disabled, true)
          await navigate('设置')
          await fill('.lwb-account-form input[type="text"]', 'member@example.com')
          await fill('.lwb-account-form input[type="password"]', 'test-password')
          await click(container.querySelector('.lwb-account-form button[type="submit"]'))
          assert.ok(container.textContent.includes('Business') || container.textContent.includes('business'))
          await navigate('场景能力包')
          assert.equal(action().textContent, '加载')
          assert.equal(action().disabled, false)
          assert.ok(marketCalls.includes(true), 'login refreshes host permissions')
          await navigate('设置')
          await click([...container.querySelectorAll('button')].find(node => node.textContent === '退出登录'))
          await navigate('场景能力包')
          assert.equal(action().textContent, '需要会员')
          assert.equal(action().disabled, true)
          assert.equal(marketCalls.at(-1), false, 'logout restores host permission gating')
        } else {
          const overlay = container.querySelector('.lwb-overlay')
          const control = () => container.querySelector('.lwb-dsh-account-button')
          assert.equal(control().textContent, '退出 DSH')
          await React.act(async () => control().click())
          assert.equal(control().textContent, '登录 DSH')
          assert.equal(control().disabled, false)
          assert.deepEqual(calls, ['signOut'])
          assert.equal(container.querySelector('.lwb-overlay'), overlay, 'logout retains the current settings page')
          assert.ok(container.querySelector('.lwb-account-form'), 'the independent LWB account remains visible')
          await React.act(async () => control().click())
          assert.equal(calls[1].method, 'startSignIn')
          assert.equal(calls[1].source, 'desktop')
          assert.equal(calls[1].origin, 'http://localhost')
          assert.equal(control().disabled, true)
          await React.act(async () => publish({ status: 'signed-out', attempt: { id: 'local-attempt', phase: 'cancelled' } }))
          assert.equal(control().textContent, '登录 DSH')
          assert.equal(control().disabled, false)
          await React.act(async () => publish({ status: 'credential-stored', attempt: { id: 'local-attempt', phase: 'succeeded' } }))
          assert.equal(control().textContent, '退出 DSH')
          assert.equal(container.querySelector('.lwb-overlay'), overlay, 'login does not replace the settings page')
        }
      } finally {
        await React.act(async () => root.unmount())
        for (const [key, descriptor] of Object.entries(originals)) {
          if (descriptor) Object.defineProperty(globalThis, key, descriptor)
          else delete globalThis[key]
        }
      }
    }
    await entry.fiber.dispose()
    assert.equal(disposed, 1, 'unloading the shell stops its account stream')
    assert.equal(slots.size, 0)
  } finally {
    closed = true
    finishStream()
    await ctx.fiber.dispose()
    window.close()
  }
}

test('LWB client activates through the official Loader with a traced account namespace', () => checkClientActivation(true))
test('LWB client waits for the official account namespace when it arrives later', () => checkClientActivation(false))
test('LWB settings switches DSH account buttons in place through official account operations', () => checkClientActivation(true, true))
test('returning to packs after LWB login updates membership buttons without reloading', () => checkClientActivation(true, false, true))
test('an LWB order banner follows the ATS terminal contract instead of asking for a manual clear', () => checkClientActivation(true, false, false, true))
