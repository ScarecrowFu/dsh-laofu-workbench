import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AI_DAILY_PLATFORMS } from '../spoken-video-signal-adapters.mjs'
import { SpokenVideoContentStore } from '../spoken-video-content-store.mjs'
import { SpokenVideoProjectStore } from '../spoken-video-store.mjs'

function now() { return '2026-08-31T01:02:03.000Z' }
function agent(cwd) { return { session: { header: { cwd } } } }
function resolver() { return [{ address: '93.184.216.34', family: 4 }] }
function rss(title = 'AI 工具的新进展') { return `<?xml version="1.0"?><rss><channel><item><title>${title}</title><description>可用于内容创作的真实线索</description><link>https://example.com/article</link><pubDate>Sun, 31 Aug 2026 00:00:00 GMT</pubDate><category>AI</category></item></channel></rss>` }
function fetcher(response = rss()) { return async () => new Response(response, { status: 200, headers: { 'content-type': 'application/rss+xml', etag: '"test"' } }) }
function dailyFetcher(itemsByPlatform, trending = []) { return async () => new Response(JSON.stringify({ items_by_platform: itemsByPlatform, trending_topics: trending }), { status: 200, headers: { 'content-type': 'application/json' } }) }

async function setup(t, options = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'lwb-spoken-video-content-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  return { root, workspace, currentAgent: agent(workspace), store: new SpokenVideoContentStore({ workspacePath: workspace, fetch: options.fetch || fetcher(), resolveHostname: resolver, now }) }
}

test('collects, scores, deduplicates and audits a built-in RSS source', async (t) => {
  const { store, currentAgent } = await setup(t)
  const first = await store.collectSources(currentAgent, { sourceIds: ['36kr'] })
  assert.equal(first[0].status, 'success')
  assert.equal(first[0].addedCount, 1)
  const signals = await store.listSignals(currentAgent, { sourceIds: ['36kr'] })
  assert.equal(signals.length, 1)
  assert.equal(signals[0].score > 40, true)
  assert.deepEqual(signals[0].tags, ['商业', '科技', 'AI'])
  const second = await store.collectSources(currentAgent, { sourceIds: ['36kr'] })
  assert.equal(second[0].duplicateCount, 1)
  assert.equal((await store.sources(currentAgent)).find((item) => item.id === '36kr').health.status, 'ready')
})

test('records each source observation batch, refreshes duplicate last-seen time, and prunes data older than seven days', async (t) => {
  const { root, workspace, currentAgent } = await setup(t)
  let clock = '2026-08-31T01:02:03.000Z'
  let title = '第一天热点'
  const store = new SpokenVideoContentStore({
    workspacePath: currentAgent.session.header.cwd,
    fetch: async () => new Response(rss(title), { status: 200, headers: { 'content-type': 'application/rss+xml' } }),
    resolveHostname: resolver,
    now: () => clock,
  })
  await store.collectSources(currentAgent, { sourceIds: ['36kr'] })
  const path = join(workspace, 'data', 'signals.json')
  let stored = JSON.parse(await readFile(path, 'utf8'))
  const first = stored.signals.find((item) => item.title === '第一天热点')
  assert.equal(stored.schemaVersion, 10)
  assert.equal(stored.batches.length, 1)
  assert.deepEqual(stored.batches[0].signalIds, [first.id])
  assert.equal(first.firstSeenAt, clock)
  assert.equal(first.lastSeenAt, clock)

  clock = '2026-08-31T12:00:00.000Z'
  await store.collectSources(currentAgent, { sourceIds: ['36kr'] })
  stored = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(stored.signals.length, 1, 'a repeated source item remains one deduplicated signal')
  assert.equal(stored.signals[0].lastSeenAt, clock)
  assert.equal(stored.batches.length, 2)
  assert.deepEqual(stored.batches[0].signalIds, [first.id], 'the duplicate still belongs to today\'s latest snapshot')

  clock = '2026-09-08T12:00:00.000Z'
  assert.deepEqual(await store.listSignals(currentAgent, { sourceIds: ['36kr'] }), [], 'a read also removes expired signals when no later collection has run')
  stored = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(stored.batches.length, 0, 'expired collection snapshots are removed with their signals')
  title = '第九天热点'
  await store.collectSources(currentAgent, { sourceIds: ['36kr'] })
  stored = JSON.parse(await readFile(path, 'utf8'))
  assert.deepEqual(stored.signals.map((item) => item.title), ['第九天热点'])
  assert.equal(stored.batches.every((item) => item.completedAt >= '2026-09-01T12:00:00.000Z'), true)
})

test('re-fetches without validators when a 304 response has no retained snapshot to reuse', async (t) => {
  const { root, currentAgent } = await setup(t)
  let clock = '2026-08-31T08:00:00.000Z'
  const requests = []
  const store = new SpokenVideoContentStore({
    workspacePath: currentAgent.session.header.cwd,
    fetch: async (_url, request) => {
      const conditional = request?.headers?.['if-none-match'] || null
      requests.push(conditional)
      if (conditional) return new Response(null, { status: 304 })
      return new Response(rss('重建快照的信号'), { status: 200, headers: { 'content-type': 'application/rss+xml', etag: '"retention-test"' } })
    },
    resolveHostname: resolver,
    now: () => clock,
  })
  await store.collectSources(currentAgent, { sourceIds: ['36kr'] })
  clock = '2026-09-08T08:00:00.000Z'
  assert.deepEqual(await store.listSignals(currentAgent, { sourceIds: ['36kr'] }), [])

  const runs = await store.collectSources(currentAgent, { sourceIds: ['36kr'] })
  assert.equal(runs[0].status, 'success')
  assert.deepEqual(requests, [null, '"retention-test"', null])
  assert.deepEqual((await store.listSignals(currentAgent, { sourceIds: ['36kr'] })).map((item) => item.title), ['重建快照的信号'])
})

test('topic generation refreshes stale selected sources and uses the full latest source batch', async (t) => {
  const { root, currentAgent } = await setup(t)
  let clock = '2026-08-31T08:00:00.000Z'
  let title = '昨天的渠道信号'
  let fetchCount = 0
  let prompt = ''
  const executor = async (request) => { prompt = request.prompt; return { candidates: [{ title: '新鲜候选', signalIds: [] }] } }
  const store = new SpokenVideoContentStore({
    workspacePath: currentAgent.session.header.cwd,
    fetch: async () => { fetchCount += 1; return new Response(rss(title), { status: 200, headers: { 'content-type': 'application/rss+xml' } }) },
    resolveHostname: resolver,
    now: () => clock,
    topicExecutor: executor,
  })
  await store.collectSources(currentAgent, { sourceIds: ['36kr'] })
  clock = '2026-09-01T08:00:00.000Z'
  title = '今天的渠道信号'
  const started = await store.startTopicGeneration(currentAgent, { sourceIds: ['36kr'] })
  const record = await settled(store, currentAgent, started.id)
  assert.equal(fetchCount, 2, 'a stale source is collected before topic generation')
  assert.deepEqual(record.refreshedSourceIds, ['36kr'])
  assert.equal(record.materialSnapshot.length, 1)
  assert.equal(record.materialSnapshot[0].title, '今天的渠道信号')
  assert.ok(prompt.includes('今天的渠道信号'))
  assert.ok(!prompt.includes('昨天的渠道信号'))
})

test('topic generation continues when a selected source refresh fails without using stale data', async (t) => {
  const { root, currentAgent } = await setup(t)
  let prompt = ''
  let clock = '2026-08-30T08:00:00.000Z'
  let online = true
  const store = new SpokenVideoContentStore({ workspacePath: currentAgent.session.header.cwd, fetch: async () => {
    if (!online) throw new Error('offline')
    return new Response(rss('过期来源信号'), { status: 200, headers: { 'content-type': 'application/rss+xml' } })
  }, resolveHostname: resolver, now: () => clock, topicExecutor: async (request) => { prompt = request.prompt; return { candidates: [{ title: '无素材候选', signalIds: [] }] } } })
  await store.collectSources(currentAgent, { sourceIds: ['36kr'] })
  clock = '2026-08-31T08:00:00.000Z'
  online = false
  const started = await store.startTopicGeneration(currentAgent, { sourceIds: ['36kr'] })
  const record = await settled(store, currentAgent, started.id)
  assert.equal(record.status, 'completed')
  assert.equal(record.steps[0].status, 'done')
  assert.equal(record.materialSnapshot.length, 0)
  assert.equal(record.unavailableSources.length, 1)
  assert.equal(record.unavailableSources[0].name, '36氪')
  assert.ok(!prompt.includes('过期来源信号'))
  assert.ok(prompt.includes('本轮未获得当天采集数据的信号源'))
  assert.ok(prompt.includes('本轮渠道最新信号：无'))
})

test('topic generation keeps usable batches when only part of the selected sources fail', async (t) => {
  const { currentAgent } = await setup(t)
  let prompt = ''
  const store = new SpokenVideoContentStore({
    workspacePath: currentAgent.session.header.cwd,
    fetch: async (url) => {
      if (String(url).includes('infoq.cn')) throw new Error('infoq offline')
      return new Response(rss('可用来源信号'), { status: 200, headers: { 'content-type': 'application/rss+xml' } })
    },
    resolveHostname: resolver,
    now,
    topicExecutor: async (request) => { prompt = request.prompt; return { candidates: [{ title: '部分素材候选', signalIds: [] }] } },
  })
  const started = await store.startTopicGeneration(currentAgent, { sourceIds: ['36kr', 'infoq'] })
  const record = await settled(store, currentAgent, started.id)
  assert.equal(record.status, 'completed')
  assert.equal(record.materialSnapshot.length, 1)
  assert.equal(record.materialSnapshot[0].title, '可用来源信号')
  assert.deepEqual(record.materialBatches.map((item) => item.sourceId), ['36kr'])
  assert.deepEqual(record.unavailableSources.map((item) => item.id), ['infoq'])
  assert.ok(prompt.includes('可用来源信号'))
  assert.ok(prompt.includes('InfoQ'))
})

test('listSignals resolves an explicit ids filter exactly, bypassing the time-ordered limit', async (t) => {
  const { currentAgent, store } = await setup(t, { fetch: dailyFetcher({ douyin: [{ title: '抖音 A' }, { title: '抖音 B' }], bilibili: [{ title: 'B站 C' }] }) })
  await store.collectSources(currentAgent, { sourceIds: ['ai-daily-import'] })
  const all = await store.listSignals(currentAgent, { sourceIds: ['ai-daily-import'] })
  assert.equal(all.length, 3)
  // Pick the two oldest by capture order so a limit:1 slice would otherwise drop them.
  const oldest = [...all].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)).slice(0, 2).map((item) => item.id)
  const exact = await store.listSignals(currentAgent, { ids: oldest, limit: 1 })
  assert.deepEqual(exact.map((item) => item.id).sort(), [...oldest].sort(), 'ids lookup must not be truncated by limit')
  // state still applies on top of the ids filter
  await store.setSignalState(currentAgent, { signalId: oldest[0], state: 'ignored' })
  const activeOnly = await store.listSignals(currentAgent, { ids: oldest, state: 'active' })
  assert.deepEqual(activeOnly.map((item) => item.id), [oldest[1]])
})

test('toggles source enabled state and keeps signal state machine without manual-entry fallbacks', async (t) => {
  const { store, currentAgent } = await setup(t, { fetch: dailyFetcher({ douyin: [{ title: '抖音选题线索', url: 'https://example.com/douyin' }] }) })
  await assert.rejects(store.setSourceEnabled(currentAgent, { sourceId: 'not-a-source', enabled: false }), /信号来源不存在/u)
  const before = (await store.sources(currentAgent)).find((item) => item.id === 'weibo-hot')
  assert.equal(before.enabled, true)
  const disabled = await store.setSourceEnabled(currentAgent, { sourceId: 'weibo-hot', enabled: false })
  assert.equal(disabled.enabled, false)
  const after = (await store.sources(currentAgent)).find((item) => item.id === 'weibo-hot')
  assert.equal(after.enabled, false)
  assert.equal(after.name, before.name)
  assert.equal(after.url, before.url)
  assert.equal(after.intervalMinutes, before.intervalMinutes)
  await store.collectSources(currentAgent, { sourceIds: ['ai-daily-import'] })
  const imported = (await store.listSignals(currentAgent, { sourceIds: ['ai-daily-import'] }))[0]
  await store.setSignalState(currentAgent, { signalId: imported.id, state: 'saved' })
  assert.equal((await store.listSignals(currentAgent, { state: 'saved' }))[0].id, imported.id)
  await store.setSourceEnabled(currentAgent, { sourceId: 'weibo-hot', enabled: true })
  assert.equal((await store.sources(currentAgent)).find((item) => item.id === 'weibo-hot').enabled, true)
})

test('records source errors honestly', async (t) => {
  const { workspace } = await setup(t)
  const failing = new SpokenVideoContentStore({ workspacePath: workspace, fetch: async () => { throw new Error('offline') }, resolveHostname: resolver, now })
  const failed = await failing.collectSources(agent(workspace), { sourceIds: ['36kr'] })
  assert.equal(failed[0].status, 'failed')
  assert.equal((await failing.sources(agent(workspace))).find((item) => item.id === '36kr').health.status, 'error')
})

test('rejects unsupported schema versions instead of migrating them', async (t) => {
  const { workspace, currentAgent, store } = await setup(t, { fetch: dailyFetcher({ douyin: [{ title: '播种信号', url: 'https://example.com/seed' }] }) })
  await store.collectSources(currentAgent, { sourceIds: ['ai-daily-import'] })
  const signalsPath = join(workspace, 'data', 'signals.json')
  const legacy = JSON.parse(await readFile(signalsPath, 'utf8'))
  legacy.schemaVersion = 2
  await writeFile(signalsPath, `${JSON.stringify(legacy)}\n`, 'utf8')
  await assert.rejects(store.sources(currentAgent), /版本不受支持/u)
})

test('migrates V2EX source data out of existing workspaces', async (t) => {
  const { workspace, currentAgent, store } = await setup(t, { fetch: dailyFetcher({ douyin: [{ title: '初始化信号', url: 'https://example.com/seed' }] }) })
  await store.collectSources(currentAgent, { sourceIds: ['ai-daily-import'] })
  const signalsPath = join(workspace, 'data', 'signals.json')
  const data = JSON.parse(await readFile(signalsPath, 'utf8'))
  const v2exSource = {
    ...data.sources.find((item) => item.id === 'baidu'),
    id: 'v2ex', name: 'V2EX 热门主题', kind: 'v2ex-hot', url: 'https://www.v2ex.com/api/topics/hot.json', family: '开发者社区', tags: ['社区', '开发'],
  }
  const v2exRunId = '22222222-2222-4222-8222-222222222222'
  data.schemaVersion = 8
  data.sources.push(v2exSource)
  data.signals.push({ id: '11111111-1111-4111-8111-111111111111', sourceId: 'v2ex', title: '旧 V2EX 信号', summary: '迁移时应清理。', url: 'https://www.v2ex.com/t/123', publishedAt: null, capturedAt: now(), rank: 1, hotValue: 42, tags: ['社区'], score: 40, fingerprint: 'url:v2ex-legacy', state: 'active', platform: null })
  data.runs.push({ id: v2exRunId, sourceId: 'v2ex', reason: 'automatic', status: 'failed', startedAt: now(), completedAt: now(), durationMs: 1, httpStatus: null, fetchedCount: 0, filteredCount: 0, addedCount: 0, duplicateCount: 0, message: '来源请求失败：fetch failed' })
  await writeFile(signalsPath, `${JSON.stringify(data)}\n`, 'utf8')

  assert.equal((await store.sources(currentAgent)).some((item) => item.id === 'v2ex'), false)
  assert.equal((await store.listSignals(currentAgent, {})).some((item) => item.sourceId === 'v2ex'), false)
  assert.equal((await store.sourceRuns(currentAgent)).some((item) => item.sourceId === 'v2ex'), false)
  assert.equal(JSON.parse(await readFile(signalsPath, 'utf8')).schemaVersion, 10)
})

test('drops orphan signals that reference removed sources instead of failing', async (t) => {
  const { workspace, currentAgent, store } = await setup(t, { fetch: dailyFetcher({ douyin: [{ title: '播种信号', url: 'https://example.com/seed' }] }) })
  await store.collectSources(currentAgent, { sourceIds: ['ai-daily-import'] })
  const signalsPath = join(workspace, 'data', 'signals.json')
  const data = JSON.parse(await readFile(signalsPath, 'utf8'))
  data.signals.push({ id: '11111111-1111-4111-8111-111111111111', sourceId: 'manual', title: '遗留人工信号', summary: '来源已被删除。', url: '', publishedAt: null, capturedAt: now(), rank: null, hotValue: null, tags: [], score: 40, fingerprint: 'title:orphan', state: 'active', platform: null })
  await writeFile(signalsPath, `${JSON.stringify(data)}\n`, 'utf8')
  const signals = await store.listSignals(currentAgent, {})
  assert.equal(signals.some((item) => item.sourceId === 'manual'), false)
  assert.equal(signals.some((item) => item.title === '播种信号'), true)
  const rewritten = JSON.parse(await readFile(signalsPath, 'utf8'))
  assert.equal(rewritten.signals.some((item) => item.sourceId === 'manual'), false)
})

test('auto-collects the built-in AI daily report from the public JSON endpoint', async (t) => {
  const { store, currentAgent } = await setup(t, {
    fetch: dailyFetcher(
      { douyin: [{ title: '抖音自动采集信号', url: 'https://example.com/d1' }], xiaohongshu: [{ title: '小红书自动采集信号', url: 'https://example.com/x1' }], wechat_gzh: [{ title: '公众号自动采集信号', author: '内容团队', url: 'https://example.com/w1' }] },
      [{ title: 'AI 热点汇总', platform: 'xiaohongshu', link: 'https://example.com/x2' }],
    ),
  })
  const daily = (await store.sources(currentAgent)).find((item) => item.id === 'ai-daily-import')
  assert.equal(daily.kind, 'ai-daily-json')
  assert.equal(daily.enabled, true)
  assert.equal(daily.url, 'https://scitiger.cn/reports/daily.json')
  const [run] = await store.collectSources(currentAgent, { sourceIds: ['ai-daily-import'] })
  assert.equal(run.status, 'success')
  assert.equal(run.addedCount, 4)
  const signals = await store.listSignals(currentAgent, { sourceIds: ['ai-daily-import'] })
  assert.equal(signals.length, 4)
  assert.equal(signals.find((item) => item.title === '抖音自动采集信号').platform, '抖音')
  assert.equal(signals.some((item) => item.tags.includes('抖音')), true)
  assert.equal((await store.listSignals(currentAgent, { sourceIds: ['ai-daily-import'], platform: '抖音' })).length, 1)
  assert.equal((await store.sourceRuns(currentAgent))[0].reason, 'on-demand')
  const board = await store.board(currentAgent)
  assert.equal(board.sources.find((item) => item.id === 'ai-daily-import').todayCount, 4)
})

test('board always renders all five AI daily platforms with placeholders for empty ones', async (t) => {
  const { currentAgent, store } = await setup(t, { fetch: dailyFetcher({ douyin: [{ title: '抖音 AI 观察', url: 'https://example.com/douyin' }] }) })
  const empty = await store.board(currentAgent)
  assert.deepEqual(empty.aiDaily.platforms.map((card) => card.platform), [...AI_DAILY_PLATFORMS])
  assert.equal(empty.aiDaily.platforms.every((card) => card.totalCount === 0 && card.freshness === 'none'), true)
  assert.equal(empty.sources.some((card) => card.id === 'manual'), false)

  await store.collectSources(currentAgent, { sourceIds: ['ai-daily-import'] })
  const board = await store.board(currentAgent)
  assert.deepEqual(board.aiDaily.platforms.map((card) => card.platform), [...AI_DAILY_PLATFORMS])
  const douyin = board.aiDaily.platforms.find((card) => card.platform === '抖音')
  assert.equal(douyin.totalCount, 1)
  assert.equal(douyin.todayCount, 1)
  assert.equal(douyin.freshness, 'fresh')
  assert.equal(douyin.preview[0].title, '抖音 AI 观察')
  const placeholder = board.aiDaily.platforms.find((card) => card.platform === '小红书')
  assert.equal(placeholder.totalCount, 0)
  assert.equal(placeholder.freshness, 'none')
})

test('board aggregates today counts, previews and collectable totals', async (t) => {
  const { currentAgent, store } = await setup(t, { fetch: dailyFetcher({ douyin: [{ title: '今日日报信号', url: 'https://example.com/douyin' }] }) })
  await store.collectSources(currentAgent, { sourceIds: ['ai-daily-import'] })
  const board = await store.board(currentAgent)
  assert.equal(board.totals.todayNew, 1)
  assert.equal(board.totals.collectedToday, 1)
  assert.equal(board.today.startIso < board.today.endIso, true)
  const baidu = board.sources.find((item) => item.id === 'baidu')
  assert.equal(baidu.previewScope, 'latest')
  assert.deepEqual(baidu.preview, [])
  const daily = board.sources.find((item) => item.id === 'ai-daily-import')
  assert.equal(daily.todayCount, 1)
  assert.equal(daily.previewScope, 'today')
  assert.equal(daily.preview[0].title, '今日日报信号')
})

test('account positioning profile stays optional and reports configured state', async (t) => {
  const { currentAgent, store } = await setup(t)
  const blank = await store.getProfile(currentAgent)
  assert.equal(blank.configured, false)
  assert.deepEqual(blank.pillars, [])
  const saved = await store.setProfile(currentAgent, { positioning: 'AI 工具垂类', audience: '效率创作者', pillars: ['工具拆解', '行业观察'], boundary: '不做医疗' })
  assert.equal(saved.configured, true)
  assert.equal(saved.positioning, 'AI 工具垂类')
  const reread = await store.getProfile(currentAgent)
  assert.deepEqual(reread.pillars, ['工具拆解', '行业观察'])
  await assert.rejects(store.setProfile(currentAgent, { positioning: 'x'.repeat(601) }), /长度必须在 1-600/u)
})

test('migrates one legacy profile into an account library and snapshots selected accounts', async (t) => {
  const { workspace, currentAgent, store } = await setup(t)
  const profilePath = join(workspace, 'data', 'topic-profile.json')
  await mkdir(join(workspace, 'data'), { recursive: true })
  await writeFile(profilePath, `${JSON.stringify({ schemaVersion: 1, profile: { positioning: '原有 AI 定位', audience: '效率创作者', pillars: ['工具拆解'], boundary: null, updatedAt: now() } })}\n`, 'utf8')
  const migrated = await store.listAccounts(currentAgent)
  assert.equal(migrated.accounts.length, 1)
  assert.equal(migrated.accounts[0].name, '原有账号定位')
  assert.equal(migrated.defaultAccountId, migrated.accounts[0].id)
  assert.equal(JSON.parse(await readFile(profilePath, 'utf8')).schemaVersion, 2)
  const created = await store.createAccount(currentAgent, { name: '教育解读号', positioning: '教育垂类', audience: '家长' })
  assert.equal(created.account.revision, 1)
  await store.setDefaultAccount(currentAgent, { accountId: created.account.id })
  const started = await store.startTopicGeneration(currentAgent, { angle: '新教材变化', accountId: created.account.id, sourceIds: ['36kr'] })
  const record = await settled(store, currentAgent, started.id)
  assert.equal(record.account.name, '教育解读号')
  assert.equal(record.account.positioning, '教育垂类')
  await store.setAccountStatus(currentAgent, { accountId: created.account.id, status: 'archived' })
  await assert.rejects(store.startTopicGeneration(currentAgent, { title: '新教材变化', accountId: created.account.id }), /不存在或已归档/u)
  const duplicate = (await store.createAccount(currentAgent, { name: '教育解读号', positioning: '另一条定位' })).account
  await assert.rejects(store.setAccountStatus(currentAgent, { accountId: created.account.id, status: 'active' }), /名称已存在/u)
  assert.equal(duplicate.status, 'active')
})

test('deletes only archived accounts and keeps the library consistent', async (t) => {
  const { currentAgent, store } = await setup(t)
  const created = (await store.createAccount(currentAgent, { name: '待删账号', positioning: 'AI 科普' })).account
  await assert.rejects(store.deleteAccount(currentAgent, { accountId: created.id }), /请先归档/u)
  await store.setAccountStatus(currentAgent, { accountId: created.id, status: 'archived' })
  const missingId = '19141371-91a0-4043-a3df-bc3add45676b'
  await assert.rejects(store.deleteAccount(currentAgent, { accountId: missingId }), /不存在/u)
  const removed = await store.deleteAccount(currentAgent, { accountId: created.id })
  assert.equal(removed.removed, created.id)
  assert.equal(removed.library.accounts.length, 0)
  await assert.rejects(store.deleteAccount(currentAgent, { accountId: created.id }), /不存在/u)
  const revived = (await store.createAccount(currentAgent, { name: '待删账号', positioning: '同名重建' })).account
  assert.equal(revived.status, 'active')
})

test('suggestAccountProfile fills gaps through the account executor without persisting anything', async (t) => {
  const { currentAgent, root } = await setup(t)
  const bare = new SpokenVideoContentStore({ workspacePath: currentAgent.session.header.cwd, fetch: fetcher(), resolveHostname: resolver, now })
  await assert.rejects(bare.suggestAccountProfile(currentAgent, { positioning: 'AI科普' }), /accountExecutor/u)
  await assert.rejects(bare.suggestAccountProfile(currentAgent, {}), /至少录入一项/u)
  let captured
  const executor = async ({ prompt, schema }) => {
    captured = { prompt, schema }
    return { name: 'AI 科普站', positioning: '把简略草稿扩写成的完整定位', audience: '对 AI 好奇的普通人', pillars: ['前沿解读', '工具上手'], boundary: '不做医疗与投资建议', summary: '已完善' }
  }
  const store = new SpokenVideoContentStore({ workspacePath: currentAgent.session.header.cwd, fetch: fetcher(), resolveHostname: resolver, now, accountExecutor: executor })
  const result = await store.suggestAccountProfile(currentAgent, { positioning: 'AI科普' })
  assert.equal(result.suggestion.positioning, '把简略草稿扩写成的完整定位')
  assert.equal(result.suggestion.name, 'AI 科普站')
  assert.deepEqual(result.filled, ['name', 'audience', 'pillars', 'boundary'])
  assert.deepEqual(result.updated, ['positioning'])
  assert.ok(captured.prompt.includes('账号定位：AI科普'))
  assert.deepEqual(captured.schema.required, [])
  const library = await store.listAccounts(currentAgent)
  assert.equal(library.accounts.length, 0)
})

async function settled(store, currentAgent, id) {
  for (let i = 0; i < 100; i += 1) {
    const record = await store.topicGenerationStatus(currentAgent, { id })
    if (record.status !== 'queued' && record.status !== 'running') return record
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('generation did not settle')
}

async function waitFor(check, message = 'condition did not settle') {
  for (let i = 0; i < 100; i += 1) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(message)
}

test('topic generation accepts a fresh source request and records failure without an executor', async (t) => {
  const { currentAgent, store } = await setup(t)
  const started = await store.startTopicGeneration(currentAgent, { sourceIds: ['36kr'] })
  assert.ok(started.id)
  const record = await settled(store, currentAgent, started.id)
  assert.equal(record.status, 'failed')
  assert.equal(record.steps[2].status, 'error')
  assert.ok(record.error.includes('topicExecutor'))
})

test('topic generation reduces sources after a content-inspection rejection and succeeds', async (t) => {
  const { currentAgent } = await setup(t)
  const prompts = []
  const fetch = async (url) => String(url).includes('daily.json')
    ? new Response(JSON.stringify({ items_by_platform: { 抖音: [{ title: '敏感标题' }] } }), { status: 200, headers: { 'content-type': 'application/json' } })
    : new Response(rss('36氪安全标题'), { status: 200, headers: { 'content-type': 'application/rss+xml' } })
  const executor = async (request) => {
    prompts.push(request.prompt)
    if (request.prompt.includes('敏感标题')) {
      throw new Error('生成未正常结束（error）：INVALID_REQUEST：400: {"code":"data_inspection_failed","message":"Input text data may contain inappropriate content"}')
    }
    return { candidates: [{ title: '降级后的候选', signalIds: [] }] }
  }
  const store = new SpokenVideoContentStore({
    workspacePath: currentAgent.session.header.cwd, fetch, resolveHostname: resolver, now, topicExecutor: executor,
  })
  const started = await store.startTopicGeneration(currentAgent, { sourceIds: ['36kr', 'ai-daily-import'], platforms: ['抖音'] })
  const record = await settled(store, currentAgent, started.id)
  assert.equal(record.status, 'completed')
  assert.equal(prompts.length, 2)
  assert.ok(prompts[0].includes('敏感标题'))
  assert.ok(!prompts[1].includes('敏感标题'))
  assert.ok(prompts[1].includes('36氪安全标题'))
  assert.equal(record.attempts.length, 2)
  assert.equal(record.attempts[0].status, 'content-inspection')
  assert.equal(record.attempts[1].status, 'completed')
  assert.deepEqual(record.effectiveSourceIds, ['36kr'])
  assert.match(record.reductionNote, /内容安全审核拦截后降级 1 次/u)
})

test('topic generation keeps every signal in the first attempt', async (t) => {
  const { currentAgent } = await setup(t)
  const titles = Array.from({ length: 9 }, (_, index) => `完整信号 ${index}`)
  const items = titles.map((title, index) => `<item><title>${title}</title><description>可用于内容创作的真实线索</description><link>https://example.com/${index}</link><pubDate>Sun, 31 Aug 2026 00:00:00 GMT</pubDate></item>`).join('')
  const fetch = async () => new Response(`<?xml version="1.0"?><rss><channel>${items}</channel></rss>`, { status: 200, headers: { 'content-type': 'application/rss+xml' } })
  const prompts = []
  const executor = async (request) => {
    prompts.push(request.prompt)
    return { candidates: [{ title: '全量候选', signalIds: [] }] }
  }
  const store = new SpokenVideoContentStore({
    workspacePath: currentAgent.session.header.cwd, fetch, resolveHostname: resolver, now, topicExecutor: executor,
  })
  const started = await store.startTopicGeneration(currentAgent, { sourceIds: ['36kr'] })
  const record = await settled(store, currentAgent, started.id)
  assert.equal(record.status, 'completed')
  assert.equal(record.materialSnapshot.length, 9)
  assert.equal((prompts[0].match(/完整信号/gu) || []).length, 9)
})

test('topic generation detects a content-inspection failure carried only by the DSH trace', async (t) => {
  const { currentAgent } = await setup(t)
  const prompts = []
  const fetch = async (url) => String(url).includes('daily.json')
    ? new Response(JSON.stringify({ items_by_platform: { 抖音: [{ title: '敏感标题' }] } }), { status: 200, headers: { 'content-type': 'application/json' } })
    : new Response(rss('36氪安全标题'), { status: 200, headers: { 'content-type': 'application/rss+xml' } })
  const executor = async ({ prompt, onDshEvent }) => {
    prompts.push(prompt)
    if (prompt.includes('敏感标题')) {
      await onDshEvent?.({
        seq: 6,
        type: 'turn/end',
        data: { reason: { kind: 'error', error: { code: 'INVALID_REQUEST', message: 'data_inspection_failed: Input text data may contain inappropriate content' } } },
      })
      throw new Error('生成未正常结束（error）')
    }
    return { candidates: [{ title: 'trace 降级候选', signalIds: [] }] }
  }
  const store = new SpokenVideoContentStore({
    workspacePath: currentAgent.session.header.cwd, fetch, resolveHostname: resolver, now, topicExecutor: executor,
  })
  const started = await store.startTopicGeneration(currentAgent, { sourceIds: ['36kr', 'ai-daily-import'], platforms: ['抖音'] })
  const record = await settled(store, currentAgent, started.id)
  assert.equal(record.status, 'completed')
  assert.equal(prompts.length, 2)
  assert.equal(record.attempts[0].status, 'content-inspection')
  assert.match(record.attempts[0].error, /data_inspection_failed/u)
  assert.deepEqual(record.effectiveSourceIds, ['36kr'])
})

test('topic generation stops after the bounded ladder and reports a clear content-inspection error', async (t) => {
  const { currentAgent } = await setup(t)
  let calls = 0
  const executor = async () => {
    calls += 1
    throw new Error('生成未正常结束（error）：INVALID_REQUEST：400: {"code":"data_inspection_failed","message":"Input text data may contain inappropriate content"}')
  }
  const store = new SpokenVideoContentStore({
    workspacePath: currentAgent.session.header.cwd, fetch: fetcher(), resolveHostname: resolver, now, topicExecutor: executor,
  })
  const started = await store.startTopicGeneration(currentAgent, { sourceIds: ['36kr'] })
  const record = await settled(store, currentAgent, started.id)
  assert.equal(record.status, 'failed')
  assert.match(record.error, /内容审核拦截/u)
  assert.equal(calls, 2)
  assert.deepEqual(record.attempts.map((attempt) => attempt.status), ['content-inspection', 'content-inspection'])
  assert.equal(record.attempts.at(-1).signalCount, 0)
  assert.equal(record.steps[2].status, 'error')
})

test('topic generation does not retry a non-content provider error', async (t) => {
  const { currentAgent } = await setup(t)
  let calls = 0
  const executor = async () => {
    calls += 1
    throw new Error('上游网络错误')
  }
  const store = new SpokenVideoContentStore({
    workspacePath: currentAgent.session.header.cwd, fetch: fetcher(), resolveHostname: resolver, now, topicExecutor: executor,
  })
  const started = await store.startTopicGeneration(currentAgent, { sourceIds: ['36kr'] })
  const record = await settled(store, currentAgent, started.id)
  assert.equal(record.status, 'failed')
  assert.match(record.error, /上游网络错误/u)
  assert.equal(calls, 1)
  assert.equal(record.attempts.length, 1)
  assert.equal(record.attempts[0].status, 'failed')
})

test('topic generation creates a visible queued task and drains the next task after a bounded worker completes', async (t) => {
  const { currentAgent, root } = await setup(t)
  const gates = []
  let calls = 0
  const executor = async () => {
    calls += 1
    let release
    const gate = new Promise((resolve) => { release = resolve })
    gates.push(release)
    await gate
    return { candidates: [{ title: `候选 ${calls}`, signalIds: [] }] }
  }
  const store = new SpokenVideoContentStore({ workspacePath: currentAgent.session.header.cwd, fetch: fetcher(), resolveHostname: resolver, now, topicExecutor: executor, topicConcurrency: 1 })
  await store.collectSources(currentAgent, { sourceIds: ['36kr'] })

  const first = await store.startTopicGeneration(currentAgent, { sourceIds: ['36kr'], angle: '第一批' })
  const second = await store.startTopicGeneration(currentAgent, { sourceIds: ['36kr'], angle: '第二批' })
  assert.ok(first.id)
  assert.ok(second.id)
  await waitFor(() => calls === 1, 'first task did not enter the executor')

  const firstActive = await store.topicGenerationStatus(currentAgent, { id: first.id })
  const secondQueued = await store.topicGenerationStatus(currentAgent, { id: second.id })
  assert.equal(firstActive.status, 'running')
  assert.equal(secondQueued.status, 'queued')
  assert.equal(secondQueued.steps.every((step) => step.status === 'pending'), true)

  gates[0]()
  await waitFor(() => calls === 2, 'queued task did not start after the first task completed')
  gates[1]()
  assert.equal((await settled(store, currentAgent, first.id)).status, 'completed')
  assert.equal((await settled(store, currentAgent, second.id)).status, 'completed')
})

test('topic generation marks queued and running records interrupted by a host restart as failed', async (t) => {
  const { root, workspace, currentAgent, store } = await setup(t)
  await store.paths(currentAgent)
  const generations = join(workspace, 'data', 'topic-generations.json')
  const task = (id, status) => ({
    id, status, startedAt: now(), input: {}, account: null, candidates: [],
    steps: [{ id: 'assemble', label: '确认渠道最新采集', status: status === 'running' ? 'running' : 'pending', detail: null }],
  })
  await writeFile(generations, `${JSON.stringify({ schemaVersion: 1, generations: [
    task('11111111-1111-4111-8111-111111111111', 'queued'),
    task('22222222-2222-4222-8222-222222222222', 'running'),
  ] })}\n`, 'utf8')

  const restarted = new SpokenVideoContentStore({ workspacePath: currentAgent.session.header.cwd, fetch: fetcher(), resolveHostname: resolver, now })
  await restarted.recoverInterruptedTopicGenerations()
  const records = await restarted.listGenerations(currentAgent)
  assert.equal(records.every((record) => record.status === 'failed'), true)
  assert.ok(records.every((record) => record.error.includes('主机在任务完成前已重启')))
})

test('topic generation records the child failure reason instead of only the wrapper', async (t) => {
  const { currentAgent } = await setup(t)
  const executor = async ({ onDshEvent }) => {
    await onDshEvent({
      seq: 16,
      time: Date.parse(now()),
      type: 'turn/end',
      data: { turn: 1, reason: { kind: 'error', error: { code: 'MISSING_CREDENTIAL', message: 'llm-deepseek: no API key for provider route "deepseek-official"' } } },
    })
    throw new Error('生成未正常结束（error）')
  }
  const store = new SpokenVideoContentStore({ workspacePath: currentAgent.session.header.cwd, fetch: fetcher(), resolveHostname: resolver, now, topicExecutor: executor })
  await store.collectSources(currentAgent, { sourceIds: ['36kr'] })
  const started = await store.startTopicGeneration(currentAgent, { sourceIds: ['36kr'] })
  const record = await settled(store, currentAgent, started.id)
  assert.equal(record.status, 'failed')
  assert.match(record.error, /生成未正常结束/u)
  assert.match(record.error, /MISSING_CREDENTIAL/u, 'the durable record names the cause the operator must act on')
  assert.match(record.error, /deepseek-official/u)
  assert.match(record.steps[2].detail, /MISSING_CREDENTIAL/u, 'the failing step carries the same reason')
})

test('a late teardown failure never rewrites a record the restart recovery already settled', async (t) => {
  const { workspace, currentAgent, store } = await setup(t)
  await store.paths(currentAgent)
  const generations = join(workspace, 'data', 'topic-generations.json')
  const id = '33333333-3333-4333-8333-333333333333'
  const step = (stepId, status, label) => ({ id: stepId, label, status, detail: null })
  await writeFile(generations, `${JSON.stringify({ schemaVersion: 1, generations: [{
    id, status: 'running', startedAt: now(), input: {}, account: null, candidates: [],
    steps: [step('assemble', 'done', '确认渠道最新采集'), step('material', 'done', '组装渠道最新信号'), step('generate', 'running', 'DSH 生成候选'), step('normalize', 'pending', '校验并整理候选')],
  }] })}\n`, 'utf8')

  await store.recoverInterruptedTopicGenerations()
  const recovered = await store.topicGenerationStatus(currentAgent, { id })
  assert.equal(recovered.status, 'failed')
  assert.match(recovered.error, /已重启/u)

  await store.failTopicGeneration(workspace, generations, id, now(), new Error('生成未正常结束（aborted）'))
  const after = await store.topicGenerationStatus(currentAgent, { id })
  assert.equal(after.status, 'failed')
  assert.match(after.error, /已重启/u, 'the restart reason survives a failure that arrives during teardown')
  assert.equal(after.error.includes('aborted'), false)
})

test('topic generation history retains active tasks beyond the finished-history limit', async (t) => {
  const { workspace, currentAgent, store } = await setup(t)
  await store.paths(currentAgent)
  const generations = join(workspace, 'data', 'topic-generations.json')
  const completed = Array.from({ length: 42 }, (_, index) => ({ id: `completed-${index}`, status: 'completed', startedAt: `2026-08-31T01:${String(index).padStart(2, '0')}:00.000Z`, candidates: [] }))
  const active = { id: 'active-topic-task', status: 'queued', startedAt: '2026-08-31T02:00:00.000Z', candidates: [], steps: [] }
  await writeFile(generations, `${JSON.stringify({ schemaVersion: 1, generations: [...completed, active] })}\n`, 'utf8')

  const records = await store.listGenerations(currentAgent)
  assert.equal(records.length, 41)
  assert.ok(records.some((record) => record.id === active.id && record.status === 'queued'))
  assert.equal(records.filter((record) => record.status === 'completed').length, 40)
})

test('topic generation assembles material, runs the executor and audits the lifecycle', async (t) => {
  const { currentAgent, root } = await setup(t)
  let captured
  const executor = async ({ prompt, schema }) => {
    captured = { prompt, schema }
    return { candidates: [{ title: '候选一', angle: '避坑', signalIds: [] }], summary: '生成完毕' }
  }
  const store = new SpokenVideoContentStore({ workspacePath: currentAgent.session.header.cwd, fetch: fetcher(), resolveHostname: resolver, now, topicExecutor: executor, projectsStore: new SpokenVideoProjectStore() })
  await store.collectSources(currentAgent, { sourceIds: ['36kr'] })
  const started = await store.startTopicGeneration(currentAgent, { angle: '避坑角度', sourceIds: ['36kr'] })
  const record = await settled(store, currentAgent, started.id)
  assert.equal(record.status, 'completed')
  assert.equal(record.returned, 1)
  assert.equal(record.candidates[0].title, '候选一')
  assert.equal(record.candidates[0].selection.state, 'selected')
  assert.equal(record.candidates[0].selection.source, 'recommended')
  assert.equal(record.steps.every((step) => step.status === 'done'), true)
  assert.equal(record.materialMode, 'latest-batches')
  assert.equal(record.materialSignalIds.length, 1)
  assert.equal(record.materialSnapshot.length, 1)
  assert.equal(record.materialBatches.length, 1)
  assert.ok(captured.prompt.includes('避坑角度'))
  assert.ok(captured.prompt.includes('候选按推荐程度从高到低排列'))
  assert.ok(captured.schema.type === 'object')
  const list = await store.listGenerations(currentAgent)
  assert.equal(list.length, 1)
})

test('recommended topic automatically enters the writing queue; other candidates can join, leave, and rejoin', async (t) => {
  const { currentAgent, root } = await setup(t)
  const projectsStore = new SpokenVideoProjectStore()
  const executor = async () => ({ candidates: [{ title: '推荐候选', signalIds: [] }, { title: '备选候选', signalIds: [] }], summary: 'ok' })
  const store = new SpokenVideoContentStore({ workspacePath: currentAgent.session.header.cwd, fetch: fetcher(), resolveHostname: resolver, now, topicExecutor: executor, projectsStore })
  await store.collectSources(currentAgent, { sourceIds: ['36kr'] })
  const started = await store.startTopicGeneration(currentAgent, { angle: '避坑角度', sourceIds: ['36kr'] })
  const record = await settled(store, currentAgent, started.id)
  assert.equal(record.status, 'completed')
  const [recommended, alternate] = record.candidates
  assert.equal(recommended.selection.state, 'selected')
  assert.equal(recommended.selection.source, 'recommended')
  assert.ok(recommended.selection.projectId)
  assert.equal(alternate.selection.state, 'available')
  assert.deepEqual((await projectsStore.listWritableTopics(currentAgent)).map((item) => item.title), ['推荐候选'])

  await store.setTopicCandidateSelection(currentAgent, { id: started.id, candidateId: alternate.id, selected: true })
  assert.deepEqual((await projectsStore.listWritableTopics(currentAgent)).map((item) => item.title).sort(), ['备选候选', '推荐候选'])

  await store.setTopicCandidateSelection(currentAgent, { id: started.id, candidateId: recommended.id, selected: false })
  assert.deepEqual((await projectsStore.listWritableTopics(currentAgent)).map((item) => item.title), ['备选候选'])
  const withdrawn = await store.topicGenerationStatus(currentAgent, { id: started.id })
  assert.equal(withdrawn.candidates[0].selection.state, 'available')
  assert.equal(withdrawn.candidates[0].selection.projectId, recommended.selection.projectId, 'rejoining must reuse the original project')

  await store.setTopicCandidateSelection(currentAgent, { id: started.id, candidateId: recommended.id, selected: true })
  assert.deepEqual((await projectsStore.listWritableTopics(currentAgent)).map((item) => item.title).sort(), ['备选候选', '推荐候选'])
})

test('a candidate uses its durable material snapshot after the seven-day signal cleanup', async (t) => {
  const { root, currentAgent } = await setup(t)
  const projectsStore = new SpokenVideoProjectStore()
  let clock = '2026-08-31T08:00:00.000Z'
  let title = '可追溯的原始信号'
  const executor = async ({ prompt }) => {
    const signalId = /id=([a-f0-9-]{36})/u.exec(prompt)?.[1]
    return { candidates: [{ title: '推荐候选', signalIds: [] }, { title: '延后选择候选', signalIds: signalId ? [signalId] : [] }] }
  }
  const store = new SpokenVideoContentStore({
    workspacePath: currentAgent.session.header.cwd,
    fetch: async () => new Response(rss(title), { status: 200, headers: { 'content-type': 'application/rss+xml' } }),
    resolveHostname: resolver,
    now: () => clock,
    topicExecutor: executor,
    projectsStore,
  })
  const started = await store.startTopicGeneration(currentAgent, { sourceIds: ['36kr'] })
  const record = await settled(store, currentAgent, started.id)
  assert.equal(record.materialSnapshot[0].title, '可追溯的原始信号')
  const deferred = record.candidates[1]

  clock = '2026-09-08T08:00:00.000Z'
  title = '第八天的新信号'
  await store.collectSources(currentAgent, { sourceIds: ['36kr'] })
  assert.equal((await store.listSignals(currentAgent, { sourceIds: ['36kr'] })).some((item) => item.title === '可追溯的原始信号'), false)

  await store.setTopicCandidateSelection(currentAgent, { id: record.id, candidateId: deferred.id, selected: true })
  const selected = await store.topicGenerationStatus(currentAgent, { id: record.id })
  const project = await projectsStore.get(currentAgent, { projectId: selected.candidates[1].selection.projectId })
  assert.ok(project.artifacts.signals.data.items.some((item) => item.text.includes('可追溯的原始信号')))
})

test('a second topic run receives recent same-account candidates as a duplicate-avoidance boundary', async (t) => {
  const { root, currentAgent } = await setup(t)
  const prompts = []
  const executor = async ({ prompt }) => {
    prompts.push(prompt)
    return { candidates: [{ title: prompts.length === 1 ? '已经生成的主题' : '另一个主题', contentCore: '不重复的内容核心', signalIds: [] }] }
  }
  const store = new SpokenVideoContentStore({ workspacePath: currentAgent.session.header.cwd, fetch: fetcher(), resolveHostname: resolver, now, topicExecutor: executor })
  const first = await store.startTopicGeneration(currentAgent, { sourceIds: ['36kr'] })
  await settled(store, currentAgent, first.id)
  const second = await store.startTopicGeneration(currentAgent, { sourceIds: ['36kr'] })
  await settled(store, currentAgent, second.id)
  assert.ok(prompts[1].includes('近期已生成候选'))
  assert.ok(prompts[1].includes('已经生成的主题'))
})

test('candidate selection refuses a topic task that did not complete', async (t) => {
  const { currentAgent, root } = await setup(t)
  // No executor -> the generation settles as failed.
  const store = new SpokenVideoContentStore({ workspacePath: currentAgent.session.header.cwd, fetch: fetcher(), resolveHostname: resolver, now })
  await store.collectSources(currentAgent, { sourceIds: ['36kr'] })
  const started = await store.startTopicGeneration(currentAgent, { angle: '避坑角度', sourceIds: ['36kr'] })
  const record = await settled(store, currentAgent, started.id)
  assert.equal(record.status, 'failed')
  await assert.rejects(
    store.setTopicCandidateSelection(currentAgent, { id: started.id, candidateId: '49141371-91a0-4043-a3df-bc3add45676b', selected: true }),
    /只有已完成的选题任务可以调整候选/u,
  )
})

test('legacy single-confirmation records migrate into a selected candidate without losing their project link', async (t) => {
  const { workspace, currentAgent, store } = await setup(t)
  const root = join(workspace, 'data')
  await mkdir(root, { recursive: true })
  const generationId = '59141371-91a0-4043-a3df-bc3add45676b'
  const projectId = '69141371-91a0-4043-a3df-bc3add45676b'
  const path = join(root, 'topic-generations.json')
  await writeFile(path, `${JSON.stringify({
    schemaVersion: 1,
    generations: [{
      id: generationId, status: 'completed', startedAt: now(), candidates: [{ title: '历史已确认候选', signalIds: [] }],
      confirmedProjectId: projectId, confirmedTitle: '历史已确认候选', confirmedAt: now(),
    }],
  })}\n`, 'utf8')

  const record = (await store.listGenerations(currentAgent)).find((item) => item.id === generationId)
  assert.equal(record.candidates[0].selection.state, 'selected')
  assert.equal(record.candidates[0].selection.projectId, projectId)
  assert.ok(record.candidates[0].id)
  const persisted = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(persisted.generations[0].candidates[0].selection.projectId, projectId)
})

test('topic generation drops per-run exclusions and scopes AI-daily by platform', async (t) => {
  const { currentAgent, root } = await setup(t)
  const executor = async () => ({ candidates: [{ title: '候选一', signalIds: [] }], summary: 'ok' })
  const store = new SpokenVideoContentStore({ workspacePath: currentAgent.session.header.cwd, fetch: dailyFetcher({ douyin: [{ title: '抖音 A' }, { title: '抖音 B' }], bilibili: [{ title: 'B站 C' }] }), resolveHostname: resolver, now, topicExecutor: executor })
  await store.collectSources(currentAgent, { sourceIds: ['ai-daily-import'] })
  const allDaily = await store.listSignals(currentAgent, { sourceIds: ['ai-daily-import'] })
  const douyinSignals = allDaily.filter((item) => item.platform === '抖音')
  // Scope to 抖音 only, and exclude one of its signals for this run.
  const started = await store.startTopicGeneration(currentAgent, { sourceIds: ['ai-daily-import'], platforms: ['抖音'], excludeSignalIds: [douyinSignals[0].id] })
  const record = await settled(store, currentAgent, started.id)
  assert.equal(record.status, 'completed')
  assert.equal(record.materialSignalIds.length, 1)
  assert.equal(record.materialSignalIds[0], douyinSignals[1].id)
  assert.ok(!record.materialSignalIds.some((id) => allDaily.find((item) => item.id === id && item.platform === 'B站')), 'B站 signals stay out of a 抖音-scoped run')
})

test('topic generation persists a redacted DSH execution trace through the status endpoint', async (t) => {
  const { currentAgent, root } = await setup(t)
  const executor = async ({ onDshStarted, onDshEvent }) => {
    await onDshStarted({ childSessionId: 'child-session-001', parentSessionId: 'parent-session-001' })
    await onDshEvent({ seq: 1, time: Date.parse(now()), type: 'step/start', data: { turn: 1, step: 1 } })
    await onDshEvent({ seq: 2, time: Date.parse(now()), type: 'assistant/chunk', data: { chunk: { type: 'reasoning-delta', text: 'private reasoning' } } })
    await onDshEvent({ seq: 3, time: Date.parse(now()), type: 'tool/call', data: { name: 'structured_output', arguments: '{"candidate":"private payload"}' } })
    await onDshEvent({ seq: 4, time: Date.parse(now()), type: 'turn/end', data: { reason: { kind: 'completed' } } })
    return { candidates: [{ title: '候选一', angle: '解读', signalIds: [] }], summary: '生成完毕' }
  }
  const store = new SpokenVideoContentStore({ workspacePath: currentAgent.session.header.cwd, fetch: fetcher(), resolveHostname: resolver, now, topicExecutor: executor })
  const started = await store.startTopicGeneration(currentAgent, { angle: '解读角度', sourceIds: ['36kr'] })
  const record = await settled(store, currentAgent, started.id)

  assert.equal(record.status, 'completed')
  assert.equal(record.dsh.childSessionId, 'child-session-001')
  assert.equal(record.dsh.parentSessionId, 'parent-session-001')
  assert.deepEqual(record.dsh.events.map((event) => event.label), ['DSH 子任务已启动', 'DSH 正在请求模型生成', 'DSH 正在提交候选结构', 'DSH 已完成生成'])
  assert.equal(JSON.stringify(record.dsh).includes('private reasoning'), false)
  assert.equal(JSON.stringify(record.dsh).includes('private payload'), false)
})

async function scriptSettled(store, currentAgent, id) {
  for (let i = 0; i < 100; i += 1) {
    const record = await store.scriptGenerationStatus(currentAgent, { id })
    if (!['queued', 'running'].includes(record.status)) return record
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('script generation did not settle')
}

async function projectWithTopic(currentAgent, projectsStore, account = null) {
  let project = await projectsStore.create(currentAgent, { title: '新教材铺开了' })
  project = (await projectsStore.commit(currentAgent, { projectId: project.id, expectedRevision: project.revision, stage: 'signals', payload: { source: '百度热榜', text: '教材更换引发家长讨论。' }, idempotencyKey: 'signal-seed-001' })).project
  project = (await projectsStore.commit(currentAgent, { projectId: project.id, expectedRevision: project.revision, stage: 'topic', payload: { title: '新教材铺开了', angle: '家长视角', account }, idempotencyKey: 'topic-seed-001' })).project
  return project
}

test('script generation requires project store, confirmed topic and executor', async (t) => {
  const { currentAgent, root } = await setup(t)
  const bare = new SpokenVideoContentStore({ workspacePath: currentAgent.session.header.cwd, fetch: fetcher(), resolveHostname: resolver, now })
  await assert.rejects(bare.startScriptGeneration(currentAgent, { projectId: '19141371-91a0-4043-a3df-bc3add45676b' }), /项目存储/u)
  const projectsStore = new SpokenVideoProjectStore()
  const store = new SpokenVideoContentStore({ workspacePath: currentAgent.session.header.cwd, fetch: fetcher(), resolveHostname: resolver, now, projectsStore })
  await assert.rejects(store.startScriptGeneration(currentAgent, { projectId: '19141371-91a0-4043-a3df-bc3add45676b' }), /不存在/u)
  const project = await projectWithTopic(currentAgent, projectsStore)
  const started = await store.startScriptGeneration(currentAgent, { projectId: project.id })
  assert.ok(started.id)
  const record = await scriptSettled(store, currentAgent, started.id)
  assert.equal(record.status, 'failed')
  assert.equal(record.steps[1].status, 'error')
  assert.ok(record.error.includes('scriptExecutor'))
})

test('script generation runs the executor, normalizes the draft and attaches quality', async (t) => {
  const { currentAgent, root } = await setup(t)
  let captured
  const executor = async ({ prompt, schema }) => {
    captured = { prompt, schema }
    return {
      title: '课本全换了',
      hook: '家长先别急着囤教辅。',
      script: '这是一篇由模型生成的口播稿正文，用来验证归一化与质检流程。'.repeat(30),
      outline: ['变化是什么', '家长怎么办'],
      needsVerification: ['某个数据'],
    }
  }
  const projectsStore = new SpokenVideoProjectStore()
  const store = new SpokenVideoContentStore({ workspacePath: currentAgent.session.header.cwd, fetch: fetcher(), resolveHostname: resolver, now, projectsStore, scriptExecutor: executor })
  const education = (await store.createAccount(currentAgent, { name: '教育解读号', positioning: '教育垂类' })).account
  const current = (await store.createAccount(currentAgent, { name: '当前 AI 账号', positioning: 'AI 工具垂类' })).account
  await store.setDefaultAccount(currentAgent, { accountId: current.id })
  const project = await projectWithTopic(currentAgent, projectsStore, education)
  await store.updateAccount(currentAgent, { accountId: education.id, positioning: '教育垂类（已更新）' })
  const started = await store.startScriptGeneration(currentAgent, { projectId: project.id, tier: 'medium', instructions: '更口语一点' })
  const record = await scriptSettled(store, currentAgent, started.id)
  assert.equal(record.status, 'completed')
  assert.equal(record.mode, 'new')
  assert.equal(record.steps.every((step) => step.status === 'done'), true)
  assert.equal(record.draft.script.length > 0, true)
  assert.deepEqual(record.draft.outline, ['变化是什么', '家长怎么办'])
  assert.equal(record.draft.suggestedTitle, '课本全换了')
  assert.ok(record.quality)
  assert.ok(typeof record.quality.qualityScore === 'number')
  assert.equal(record.quality.artifactType, 'script_quality_report')
  assert.ok(record.quality.checks?.length, 'the persisted automatic report keeps its detailed checks')
  assert.ok(captured.prompt.includes('家长视角'))
  assert.ok(captured.prompt.includes('教育垂类'))
  assert.ok(!captured.prompt.includes('教育垂类（已更新）'))
  assert.ok(!captured.prompt.includes('AI 工具垂类'))
  assert.ok(captured.prompt.includes('更口语一点'))
  assert.ok(captured.prompt.includes('教材更换引发家长讨论'))
  assert.equal(captured.schema.required[0], 'script')
  assert.equal(record.account.id, education.id)
  assert.ok(record.scriptRevision)
  const saved = await projectsStore.get(currentAgent, { projectId: project.id })
  assert.equal(saved.artifacts.script.revision, record.scriptRevision)
  assert.equal(saved.artifacts.script.data.body, record.draft.script)
  assert.equal(saved.scriptApproval, null)
  const list = await store.listScriptGenerations(currentAgent)
  assert.equal(list.length, 1)
})

test('script generation persists a redacted DSH execution trace like topic generation', async (t) => {
  const { currentAgent, root } = await setup(t)
  const executor = async ({ onDshStarted, onDshEvent }) => {
    await onDshStarted({ childSessionId: 'script-child-001', parentSessionId: 'script-parent-001' })
    await onDshEvent({ seq: 1, time: Date.parse(now()), type: 'step/start', data: { turn: 1, step: 1 } })
    await onDshEvent({ seq: 2, time: Date.parse(now()), type: 'assistant/chunk', data: { chunk: { type: 'reasoning-delta', text: 'private script reasoning' } } })
    await onDshEvent({ seq: 3, time: Date.parse(now()), type: 'tool/call', data: { name: 'structured_output', arguments: '{"script":"private draft"}' } })
    await onDshEvent({ seq: 4, time: Date.parse(now()), type: 'turn/end', data: { reason: { kind: 'completed' } } })
    return { title: '课本全换了', script: '这是一篇由模型生成的口播稿正文，用来验证 DSH 轨迹落盘。'.repeat(20) }
  }
  const projectsStore = new SpokenVideoProjectStore()
  const store = new SpokenVideoContentStore({ workspacePath: currentAgent.session.header.cwd, fetch: fetcher(), resolveHostname: resolver, now, projectsStore, scriptExecutor: executor })
  const project = await projectWithTopic(currentAgent, projectsStore)
  const started = await store.startScriptGeneration(currentAgent, { projectId: project.id, tier: 'medium' })
  const record = await scriptSettled(store, currentAgent, started.id)

  assert.equal(record.status, 'completed')
  assert.equal(record.dsh.childSessionId, 'script-child-001')
  assert.equal(record.dsh.parentSessionId, 'script-parent-001')
  assert.deepEqual(record.dsh.events.map((event) => event.label), ['DSH 子任务已启动', 'DSH 正在请求模型生成', 'DSH 正在提交候选结构', 'DSH 已完成生成'])
  assert.equal(JSON.stringify(record.dsh).includes('private script reasoning'), false)
  assert.equal(JSON.stringify(record.dsh).includes('private draft'), false)
  // The trace survives the list endpoint too, so the task card can open it.
  const listed = (await store.listScriptGenerations(currentAgent)).find((item) => item.id === started.id)
  assert.equal(listed.dsh.events.length, record.dsh.events.length)
})

test('script generation fails when the model returns no usable body', async (t) => {
  const { currentAgent, root } = await setup(t)
  const projectsStore = new SpokenVideoProjectStore()
  const store = new SpokenVideoContentStore({ workspacePath: currentAgent.session.header.cwd, fetch: fetcher(), resolveHostname: resolver, now, projectsStore, scriptExecutor: async () => ({ script: '   ' }) })
  const project = await projectWithTopic(currentAgent, projectsStore)
  const started = await store.startScriptGeneration(currentAgent, { projectId: project.id })
  const record = await scriptSettled(store, currentAgent, started.id)
  assert.equal(record.status, 'failed')
  assert.ok(record.error.includes('未返回可用的稿件正文'))
})

test('script generation never overwrites a script changed while the model is running', async (t) => {
  const { currentAgent, root } = await setup(t)
  const projectsStore = new SpokenVideoProjectStore()
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const store = new SpokenVideoContentStore({
    workspacePath: currentAgent.session.header.cwd, fetch: fetcher(), resolveHostname: resolver, now, projectsStore,
    scriptExecutor: async () => { await gate; return { script: '模型生成的新版稿件。' } },
  })
  const project = await projectWithTopic(currentAgent, projectsStore)
  const started = await store.startScriptGeneration(currentAgent, { projectId: project.id })
  const changed = await projectsStore.commit(currentAgent, {
    projectId: project.id, expectedRevision: project.revision, stage: 'script', payload: { body: '用户刚刚保存的稿件。' }, idempotencyKey: 'script-conflict-manual-001',
  })
  release()
  const record = await scriptSettled(store, currentAgent, started.id)
  assert.equal(record.status, 'failed')
  assert.equal(record.steps.find((step) => step.id === 'apply').status, 'error')
  assert.ok(record.error.includes('未能自动保存'))
  const current = await projectsStore.get(currentAgent, { projectId: project.id })
  assert.equal(current.artifacts.script.revision, changed.artifact.revision)
  assert.equal(current.artifacts.script.data.body, '用户刚刚保存的稿件。')
})

test('polish mode needs a saved script and analyzeScript produces a report', async (t) => {
  const { currentAgent, root } = await setup(t)
  const projectsStore = new SpokenVideoProjectStore()
  const store = new SpokenVideoContentStore({ workspacePath: currentAgent.session.header.cwd, fetch: fetcher(), resolveHostname: resolver, now, projectsStore, scriptExecutor: async () => ({ script: '润色后的稿件正文。' }) })
  const project = await projectWithTopic(currentAgent, projectsStore)
  await assert.rejects(store.startScriptGeneration(currentAgent, { projectId: project.id, mode: 'polish' }), /无法润色/u)
  let current = project
  current = (await projectsStore.commit(currentAgent, { projectId: current.id, expectedRevision: current.revision, stage: 'script', payload: { body: '第一版稿件正文。' }, idempotencyKey: 'script-seed-001' })).project
  const started = await store.startScriptGeneration(currentAgent, { projectId: current.id, mode: 'polish' })
  const record = await scriptSettled(store, currentAgent, started.id)
  assert.equal(record.status, 'completed')
  assert.equal(record.mode, 'polish')
  const polished = await projectsStore.get(currentAgent, { projectId: current.id })
  assert.equal(polished.artifacts.script.data.body, '润色后的稿件正文。')
  assert.equal(polished.artifacts.script.revision, record.scriptRevision)
  const report = await store.analyzeScript(currentAgent, { projectId: current.id, title: '新教材铺开了', body: '这是一篇需要质检的口播稿正文。', tier: 'short' })
  assert.equal(report.artifactType, 'script_quality_report')
  assert.ok(typeof report.qualityScore === 'number')
})
