import assert from 'node:assert/strict'
import test from 'node:test'
import { registerLwbWebRouter, toFetchResult, toSearchResult } from '../web-router.mjs'

const ACCOUNT_TOKEN = 'account-token-must-never-reach-ats'
const API_KEY = 'sk-deepseek-api-key'

/**
 * 最小 ctx 假体：只实现 router 真正用到的 `get()` 与 web 注册口。
 * `provider` 为 undefined 代表「没有 initiator 的后台调用」。
 */
function fakeCtx({ provider, accountToken, apiKey, ats, failToken = false } = {}) {
  const registered = []
  const ctx = {
    get(name) {
      if (name === 'agents') {
        return {
          currentInitiator: () => (provider === undefined
            ? undefined
            : { session: { requestContext: () => ({ provider }) } }),
        }
      }
      if (name === 'deepseekAccount') {
        return {
          resolveToken: async () => {
            if (failToken) throw new Error('stored grant is corrupt')
            return accountToken
          },
        }
      }
      if (name === 'credentials') {
        return { resolve: async () => (apiKey === undefined ? undefined : { value: apiKey }) }
      }
      if (name === 'lwbAtsClient') return ats
      return undefined
    },
    web: {
      registerSearchProvider(provider) { registered.push(['search', provider]); return () => {} },
      registerFetchProvider(provider) { registered.push(['fetch', provider]); return () => {} },
    },
  }
  registerLwbWebRouter(ctx)
  return { searchProvider: registered[0][1], fetchProvider: registered[1][1], registered }
}

/** 拦截 globalThis.fetch 记录每一次调用，测试结束一定还原。 */
async function captureFetch(handler, run) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return handler(String(url), init)
  }
  try {
    return { value: await run(), calls }
  } finally {
    globalThis.fetch = original
  }
}

const jsonResponse = (value, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => value })

function atsSpy(reply = { results: [] }) {
  const seen = []
  return {
    seen,
    openService: async (service, options) => {
      seen.push(['open', service, options])
      return {
        request: async (path, init) => {
          seen.push(['request', path, init.method, JSON.parse(init.body)])
          return reply
        },
      }
    },
  }
}

test('router registers one search and one fetch provider under a stable id', () => {
  const { registered } = fakeCtx({ provider: 'lwb' })
  assert.deepEqual(registered.map(([kind, provider]) => [kind, provider.id]), [
    ['search', 'lwb-web'],
    ['fetch', 'lwb-web'],
  ])
  // available() 是全局判定，必须恒为 true，否则一条链路缺凭据会让所有用户一起失去能力。
  assert.equal(registered[0][1].available(), true)
  assert.equal(registered[1][1].available(), true)
})

test('DeepSeek account route calls the official API with the account token only', async () => {
  const { searchProvider } = fakeCtx({ provider: 'deepseek-account', accountToken: ACCOUNT_TOKEN })
  const { value, calls } = await captureFetch(
    () => jsonResponse({
      results: [
        { title: 'A', url: 'https://a.example/x', snippet: 'short', summary: 'long', date: '2026-06-01T00:00:00+00:00' },
        { title: 'B', url: 'https://b.example/y', summary: 'only summary' },
        { title: 'no url' },
      ],
    }),
    () => searchProvider.search({ query: '  DeepSeek   V4  ', maxResults: 5 }),
  )

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.deepseek.com/v1/tools/search')
  assert.equal(calls[0].init.headers['x-dsh-auth-token'], ACCOUNT_TOKEN)
  assert.equal(calls[0].init.headers.authorization, undefined)
  assert.deepEqual(JSON.parse(calls[0].init.body), { query: 'DeepSeek V4', count: 5, need_content: false })
  assert.deepEqual(value, {
    sources: [
      { url: 'https://a.example/x', title: 'A', snippet: 'short', publishedAt: '2026-06-01T00:00:00+00:00' },
      { url: 'https://b.example/y', title: 'B', snippet: 'only summary' },
    ],
    truncated: false,
  })
})

test('non-account route goes to the ATS and carries no DeepSeek credential at all', async () => {
  const ats = atsSpy({ results: [{ title: 'ATS', url: 'https://c.example/z', snippet: 'from ats' }] })
  const { searchProvider } = fakeCtx({ provider: 'lwb', accountToken: ACCOUNT_TOKEN, apiKey: API_KEY, ats })
  const { value, calls } = await captureFetch(
    () => { throw new Error('the ATS route must not touch api.deepseek.com') },
    () => searchProvider.search({ query: 'V4', maxResults: 3 }),
  )

  assert.equal(calls.length, 0, '账号令牌与 API Key 都不应出现在直连请求里')
  assert.deepEqual(ats.seen[0], ['open', 'web', { signal: undefined }])
  assert.deepEqual(ats.seen[1], ['request', '/api/v1/web/search', 'POST', { query: 'V4', count: 3, needContent: false }])
  assert.deepEqual(value.sources, [{ url: 'https://c.example/z', title: 'ATS', snippet: 'from ats' }])
})

test('a third-party model route prefers the ATS even when a DeepSeek key is configured', async () => {
  const ats = atsSpy()
  const { fetchProvider } = fakeCtx({ provider: 'bailian', accountToken: ACCOUNT_TOKEN, apiKey: API_KEY, ats })
  const { calls } = await captureFetch(
    () => { throw new Error('must not call DeepSeek') },
    () => fetchProvider.fetch({ url: 'https://example.com/a' }),
  )
  assert.equal(calls.length, 0)
  assert.deepEqual(ats.seen[1], ['request', '/api/v1/web/fetch', 'POST', { url: 'https://example.com/a' }])
})

test('without an initiator the router prefers official credentials and never bills silently', async () => {
  const withAccount = fakeCtx({ provider: undefined, accountToken: ACCOUNT_TOKEN })
  const official = await captureFetch(
    () => jsonResponse({ results: [] }),
    () => withAccount.searchProvider.search({ query: 'q' }),
  )
  assert.equal(official.calls[0].url, 'https://api.deepseek.com/v1/tools/search')

  const ats = atsSpy()
  const withoutAccount = fakeCtx({ provider: undefined, ats })
  const noCredential = await captureFetch(
    () => { throw new Error('must not call DeepSeek without credentials') },
    () => withoutAccount.searchProvider.search({ query: 'q' }),
  )
  assert.equal(noCredential.calls.length, 0)
  assert.equal(ats.seen[0][0], 'open')
})

test('a corrupt account grant falls back to DEEPSEEK_API_KEY instead of failing the search', async () => {
  const { searchProvider } = fakeCtx({ provider: 'deepseek-account', failToken: true, apiKey: API_KEY })
  const { calls } = await captureFetch(
    () => jsonResponse({ results: [] }),
    () => searchProvider.search({ query: 'q' }),
  )
  assert.equal(calls[0].init.headers.authorization, `Bearer ${API_KEY}`)
  assert.equal(calls[0].init.headers['x-dsh-auth-token'], undefined)
})

test('account route without any DeepSeek credential explains what the user can do', async () => {
  const { searchProvider } = fakeCtx({ provider: 'deepseek-account' })
  await assert.rejects(
    () => searchProvider.search({ query: 'q' }),
    /DeepSeek 账号模式下登录|切换成 LWB 账号模型/u,
  )
})

test('missing LWB login produces an actionable message, not a raw protocol error', async () => {
  const ats = {
    openService: async () => {
      const error = new Error('请先登录 LWB 账号。')
      error.code = 'LWB_ATS_NOT_AUTHENTICATED'
      throw error
    },
  }
  const { searchProvider } = fakeCtx({ provider: 'lwb', ats })
  await assert.rejects(() => searchProvider.search({ query: 'q' }), /登录 LWB 账号|DeepSeek 账号模型/u)
})

test('a rejected account token falls back to the ATS so the user keeps search', async () => {
  const ats = atsSpy({ results: [{ title: 'ATS', url: 'https://c.example/z', snippet: 'from ats' }] })
  const { searchProvider } = fakeCtx({ provider: 'deepseek-account', accountToken: ACCOUNT_TOKEN, ats })
  const { value, calls } = await captureFetch(
    () => jsonResponse({ error: { message: 'invalid token' } }, 401),
    () => searchProvider.search({ query: 'V4', maxResults: 3 }),
  )

  assert.equal(calls.length, 1, '账号令牌被拒时官方接口只尝试一次')
  assert.equal(calls[0].init.headers['x-dsh-auth-token'], ACCOUNT_TOKEN)
  assert.deepEqual(
    ats.seen[1],
    ['request', '/api/v1/web/search', 'POST', { query: 'V4', count: 3, needContent: false }],
  )
  assert.deepEqual(value.sources, [{ url: 'https://c.example/z', title: 'ATS', snippet: 'from ats' }])
})

test('the account fallback can be switched off for a credential-only deployment', async () => {
  process.env.LWB_WEB_ACCOUNT_FALLBACK = '0'
  try {
    const ats = atsSpy()
    const { searchProvider } = fakeCtx({ provider: 'deepseek-account', accountToken: ACCOUNT_TOKEN, ats })
    await assert.rejects(
      () => captureFetch(
        () => jsonResponse({ error: { message: 'invalid token' } }, 401),
        () => searchProvider.search({ query: 'q' }),
      ),
      /HTTP 401|重新登录/u,
    )
    assert.equal(ats.seen.length, 0, '关掉回落时不应出现任何 ATS 请求')
  } finally {
    delete process.env.LWB_WEB_ACCOUNT_FALLBACK
  }
})

test('an upstream 5xx never falls back: that would only spend user points for nothing', async () => {
  const ats = atsSpy()
  const { searchProvider } = fakeCtx({ provider: 'deepseek-account', accountToken: ACCOUNT_TOKEN, ats })
  await assert.rejects(
    () => captureFetch(
      () => jsonResponse({ error: { message: 'upstream boom' } }, 502),
      () => searchProvider.search({ query: 'q' }),
    ),
    /HTTP 502/u,
  )
  assert.equal(ats.seen.length, 0)
})

test('a rejected account token with no LWB login reports both channels', async () => {
  const { searchProvider } = fakeCtx({ provider: 'deepseek-account', accountToken: ACCOUNT_TOKEN })
  await assert.rejects(
    () => captureFetch(
      () => jsonResponse({ error: { message: 'invalid token' } }, 403),
      () => searchProvider.search({ query: 'q' }),
    ),
    /HTTP 403.*备用通道同样不可用/u,
  )
})

test('fetch keeps DeepSeek semantics: 403/404 are results, not failures', () => {
  assert.deepEqual(toFetchResult({ statusCode: 404, content: '' }, 'https://example.com/a'), {
    url: 'https://example.com/a',
    statusCode: 404,
    body: { kind: 'text', content: '' },
    truncated: false,
  })
  assert.deepEqual(toFetchResult({ url: 'https://example.com/b', title: 'B', content: '# hi' }, 'https://example.com/b'), {
    url: 'https://example.com/b',
    statusCode: 200,
    body: { kind: 'text', content: '# hi' },
    truncated: false,
  })
})

test('fetch through the ATS keeps the upstream status code in the result', async () => {
  const ats = atsSpy({ url: 'https://example.com/c', statusCode: 403, title: '', content: '' })
  const { fetchProvider } = fakeCtx({ provider: 'lwb', ats })
  const result = await fetchProvider.fetch({ url: 'https://example.com/c' })
  assert.deepEqual(result, {
    url: 'https://example.com/c',
    statusCode: 403,
    body: { kind: 'text', content: '' },
    truncated: false,
  })
})

test('a failed fetch carries the upstream reason so the model picks another source', () => {
  assert.deepEqual(
    toFetchResult(
      { statusCode: 404, content: '', reason: 'failed to fetch URL (request_id: abc)' },
      'https://x.example/a',
    ),
    {
      url: 'https://x.example/a',
      statusCode: 404,
      body: { kind: 'text', content: 'failed to fetch URL (request_id: abc)' },
      truncated: false,
    },
  )
})

test('search mapping drops unusable rows and prefers snippet over summary', () => {
  assert.deepEqual(toSearchResult({ results: [{ url: 'https://x.example', summary: 'only summary' }] }), {
    sources: [{ url: 'https://x.example', snippet: 'only summary' }],
    truncated: false,
  })
  assert.deepEqual(toSearchResult({}), { sources: [], truncated: false })
  assert.deepEqual(toSearchResult(undefined), { sources: [], truncated: false })
})
