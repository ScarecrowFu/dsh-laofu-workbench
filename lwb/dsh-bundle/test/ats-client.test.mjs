import assert from 'node:assert/strict'
import test from 'node:test'
import { LwbAtsClient } from '../ats-client.mjs'

function response(status, value) { return { ok: status >= 200 && status < 300, status, json: async () => value } }
function setup(fetch) {
  const values = new Map()
  const credentials = { resolve: async (key) => ({ value: values.get(key) }), set: async (key, value) => values.set(key, value), unset: async (key) => values.delete(key) }
  return { client: new LwbAtsClient({ credentials, fetch, baseUrl: 'https://ats.example.test', deviceId: 'test-device' }), values }
}

function deferred() { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const sessionFor = id => ({ accessToken: `access-${id}`, refreshToken: `refresh-${id}`, user: { id } })
const catalog = { schemaVersion: 1, models: [], services: { tts: { available: true }, subtitle: { available: true } } }

test('missing LWB service endpoints do not invalidate a successful account login', async () => {
  const { client } = setup(async url => {
    if (url.endsWith('/api/auth/me')) return response(200, sessionFor('7').user)
    if (url.endsWith('/api/membership/current')) return response(200, { planName: 'Business' })
    if (url.endsWith('/api/points/account')) return response(200, { availablePoints: 100000 })
    if (url.endsWith('/api/lwb/catalog')) return response(404, { message: 'Cannot GET /api/lwb/catalog' })
    throw new Error(`Unexpected request: ${url}`)
  })
  await client.writeSession(sessionFor('7'))
  assert.equal((await client.status()).user.id, '7')
  for (const service of ['tts', 'subtitle', 'cover-image']) {
    const state = await client.serviceStatus(service)
    assert.equal(state.authenticated, true)
    assert.equal(state.configured, false)
    assert.match(state.reason, /更新 ATS/u)
  }
  assert.equal((await client.readSession()).user.id, '7')
})

test('logout during bootstrap cannot restore managed credentials', async () => {
  const entered = deferred(), release = deferred()
  const { client, values } = setup(async url => {
    if (url.endsWith('/bootstrap')) { entered.resolve(); await release.promise; return response(200, { application: 'lwb', userId: '7', credential: { apiKey: 'secret-key' } }) }
    return response(200, {})
  })
  await client.writeSession(sessionFor('7'))
  const result = client.serviceCredential().then(value => ({ value }), error => ({ error }))
  await entered.promise; await client.logout(); release.resolve()
  assert.equal((await result).error.code, 'LWB_ATS_ACCOUNT_CHANGED')
  assert.equal(values.size, 0)
})

test('logout waits for an in-flight credential write then clears it', async () => {
  const entered = deferred(), release = deferred(), values = new Map()
  const credentials = { resolve: async key => ({ value: values.get(key) }), unset: async key => values.delete(key), set: async (key, value) => { entered.resolve(); await release.promise; values.set(key, value) } }
  const client = new LwbAtsClient({ credentials, fetch: async () => response(200, {}) })
  const writing = client.writeSession(sessionFor('7')).catch(error => error)
  await entered.promise
  const clearing = client.clearSession(); release.resolve()
  assert.equal((await writing).code, 'LWB_ATS_ACCOUNT_CHANGED')
  await clearing; assert.equal(values.size, 0)
})

test('refresh network failures preserve login; revoked refresh tokens clear it', async () => {
  let status = 503
  const { client, values } = setup(async url => response(url.endsWith('/refresh') ? status : 401, { message: 'test failure' }))
  await client.writeSession(sessionFor('7'))
  await assert.rejects(client.request('/api/auth/me'), { status: 503 })
  assert.ok(values.has('lwb_ats_session'))
  status = 401
  await assert.rejects(client.request('/api/auth/me'), { status: 401 })
  assert.equal(values.size, 0)
})

test('service handles are scoped, abort on logout, and reject a queued task from another user', async () => {
  let serviceCalls = 0, bootstraps = 0
  const { client } = setup(async (url, init) => {
    if (url.endsWith('/catalog')) return response(200, catalog)
    if (url.endsWith('/bootstrap')) { bootstraps++; return response(200, { application: 'lwb', userId: '7', credential: { apiKey: 'managed-key' } }) }
    if (url.endsWith('/tts/jobs')) { serviceCalls++; assert.equal(init.headers.get('authorization'), 'Bearer managed-key'); return response(200, { task_id: '1' }) }
    return response(200, {})
  })
  await client.writeSession(sessionFor('7'))
  const handle = await client.openService('tts', { userId: '7' })
  assert.deepEqual(Object.keys(handle), ['userId', 'request'])
  await assert.rejects(handle.request('/api/v1/subtitle/jobs', { method: 'POST' }), { code: 'LWB_ATS_SERVICE_SCOPE' })
  await handle.request('/api/v1/tts/jobs', { method: 'POST', body: '{}' })
  await client.logout(); await client.writeSession(sessionFor('8'))
  await assert.rejects(handle.request('/api/v1/tts/jobs', { method: 'POST' }))
  await assert.rejects(client.openService('tts', { userId: '7' }), { code: 'LWB_ATS_ACCOUNT_CHANGED' })
  assert.equal(serviceCalls, 1); assert.equal(bootstraps, 1)
})

test('managed-key rejection does not retry a paid POST and recreates the key next time', async () => {
  let bootstraps = 0, posts = 0
  const { client, values } = setup(async url => {
    if (url.endsWith('/catalog')) return response(200, catalog)
    if (url.endsWith('/bootstrap')) { bootstraps++; return response(200, { application: 'lwb', userId: '7', credential: { apiKey: `key-${bootstraps}` } }) }
    posts++; return response(401, { message: 'revoked' })
  })
  await client.writeSession(sessionFor('7'))
  const handle = await client.openService('tts')
  await assert.rejects(handle.request('/api/v1/tts/jobs', { method: 'POST', body: '{}' }), { status: 401 })
  assert.equal(posts, 1); assert.equal(values.has('lwb_ats_service'), false)
  await client.openService('tts')
  assert.equal(bootstraps, 2)
})

test('login stores opaque session in host credentials and status projects account data', async () => {
  const calls = []
  const { client, values } = setup(async (url, options) => {
    calls.push([url, options])
    if (url.endsWith('/auth/login')) return response(200, { accessToken: 'access', refreshToken: 'refresh', user: { id: '7', email: 'a@example.com', role: 'user' } })
    if (url.endsWith('/auth/me')) return response(200, { id: '7', email: 'a@example.com' })
    if (url.endsWith('/membership/current')) return response(200, { planCode: 'free' })
    return response(200, { availablePoints: 12 })
  })
  const session = await client.login({ account: 'a@example.com', password: 'password123' })
  assert.equal(session.user.email, 'a@example.com')
  assert.match(values.get('lwb_ats_session'), /access/)
  assert.deepEqual(await client.status(), { user: { id: '7', email: 'a@example.com' }, membership: { planCode: 'free' }, points: { availablePoints: 12 }, entitlements: null })
  assert.equal(calls[0][1].body.includes('password123'), true)
})

test('concurrent expired requests share one refresh and retry once', async () => {
  let refreshes = 0; let protectedCalls = 0
  const { client } = setup(async (url) => {
    if (url.endsWith('/auth/login')) return response(200, { accessToken: 'old', refreshToken: 'refresh', user: { id: '1' } })
    if (url.endsWith('/auth/refresh')) { refreshes += 1; await new Promise((resolve) => setTimeout(resolve, 5)); return response(200, { accessToken: 'new', refreshToken: 'new-refresh', user: { id: '1' } }) }
    protectedCalls += 1
    return protectedCalls <= 2 ? response(401, { message: 'expired' }) : response(200, { ok: true })
  })
  await client.login({ account: 'user', password: 'password123' })
  const values = await Promise.all([client.request('/api/auth/me'), client.request('/api/auth/me')])
  assert.deepEqual(values, [{ ok: true }, { ok: true }])
  assert.equal(refreshes, 1)
})

test('refresh failure clears credentials and unauthenticated calls do not touch network', async () => {
  let calls = 0
  const { client, values } = setup(async () => { calls += 1; return response(401, { message: 'expired' }) })
  await assert.rejects(client.status(), { code: 'LWB_ATS_NOT_AUTHENTICATED' })
  assert.equal(calls, 0)
  await client.login({ account: 'user', password: 'password123' }).catch(() => {})
  assert.equal(values.has('lwb_ats_session'), false)
})

test('purchase catalogs use authenticated requests and normalize public DTOs', async () => {
  const calls = []
  const { client } = setup(async (url, options) => {
    calls.push([url, options])
    if (url.endsWith('/auth/login')) return response(200, { accessToken: 'access', refreshToken: 'refresh', user: { id: '1', email: 'user@example.com' } })
    if (url.endsWith('/api/recharge-packages')) return response(200, [{ code: 'starter', name: '入门包', amountCents: 1200, pointsAmount: 100000, bonusPoints: 10000, totalPoints: 110000 }])
    if (url.endsWith('/api/membership/plans')) return response(200, [
      { code: 'free', name: 'Free', monthlyPriceCents: 0, monthlyPointsGrant: 0, priceDiscount: 1, maxApiKeys: 2, rpmLimit: 50 },
      { code: 'trial', name: '试用', monthlyPriceCents: 100, monthlyPointsGrant: 0, priceDiscount: 1, maxApiKeys: 2, rpmLimit: 50 },
      { code: 'comp', name: '赠送', monthlyPriceCents: 0, monthlyPointsGrant: 0, priceDiscount: 1, maxApiKeys: 2, rpmLimit: 50 },
      { code: 'pro', name: '专业版', monthlyPriceCents: 3900, monthlyPointsGrant: 500000, priceDiscount: 0.8, maxApiKeys: 5, rpmLimit: 120 },
    ])
    throw new Error(`unexpected request: ${url}`)
  })
  await client.login({ account: 'user', password: 'password123' })
  assert.deepEqual(await client.rechargePackages(), [{ code: 'starter', name: '入门包', amountCents: 1200, pointsAmount: 100000, bonusPoints: 10000, totalPoints: 110000 }])
  assert.deepEqual(await client.membershipPlans(), [{ code: 'pro', name: '专业版', monthlyPriceCents: 3900, monthlyPointsGrant: 500000, priceDiscount: 0.8, maxApiKeys: 5, rpmLimit: 120 }])
  assert.equal(calls.filter(([url]) => url.endsWith('/api/recharge-packages')).length, 1)
  assert.equal(calls.filter(([url]) => url.endsWith('/api/membership/plans')).length, 1)
  for (const [url, options] of calls.slice(1)) assert.equal(options.headers.authorization, 'Bearer access', url)
})

test('createPayment creates an order and then requests an Alipay form', async () => {
  const calls = []
  const { client } = setup(async (url, options) => {
    calls.push([url, options])
    if (url.endsWith('/auth/login')) return response(200, { accessToken: 'access', refreshToken: 'refresh', user: { id: '1' } })
    if (url.endsWith('/api/orders')) return response(200, { id: '123', orderNo: 'ATS-123' })
    if (url.includes('/api/orders/123/pay/alipay')) return response(200, { orderId: '123', orderNo: 'ATS-123', paymentFormHtml: '<form>pay</form>' })
    throw new Error(`unexpected request: ${url}`)
  })
  await client.login({ account: 'user', password: 'password123' })
  const payment = await client.createPayment({ type: 'recharge', code: 'starter' })
  assert.deepEqual(payment, { orderId: '123', orderNo: 'ATS-123', paymentFormHtml: '<form>pay</form>' })
  assert.equal(calls[1][0].endsWith('/api/orders'), true)
  assert.deepEqual(JSON.parse(calls[1][1].body), { type: 'recharge', code: 'starter' })
  assert.equal(calls[2][0].endsWith('/api/orders/123/pay/alipay'), true)
  assert.equal(calls[2][1].method, 'POST')
})

test('orderStatus queries the authenticated order endpoint', async () => {
  const calls = []
  const { client } = setup(async (url, options) => {
    calls.push([url, options])
    if (url.endsWith('/auth/login')) return response(200, { accessToken: 'access', refreshToken: 'refresh', user: { id: '1' } })
    if (url.endsWith('/api/orders/123')) return response(200, { status: 'paid', terminal: true, shouldRefreshAccount: true, paidAt: '2026-09-27T00:00:00.000Z' })
    throw new Error(`unexpected request: ${url}`)
  })
  await client.login({ account: 'user', password: 'password123' })
  assert.deepEqual(await client.orderStatus('123'), { status: 'paid', terminal: true, shouldRefreshAccount: true, paidAt: '2026-09-27T00:00:00.000Z' })
  assert.equal(calls[1][0], 'https://ats.example.test/api/orders/123')
  assert.equal(calls[1][1].headers.authorization, 'Bearer access')
})
