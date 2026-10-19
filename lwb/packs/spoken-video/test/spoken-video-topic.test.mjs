import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AI_DAILY_SOURCE_ID,
  assembleMaterial,
  buildGenerationSteps,
  buildTopicPrompt,
  emptyProfile,
  hasProfile,
  normalizeCandidates,
  parseAccountSnapshot,
  parseProfile,
  parseTopicInput,
  summarizeInput,
  topicAttemptPlans,
  TOPIC_CANDIDATES_SCHEMA,
} from '../spoken-video-topic.mjs'

function signal(id, overrides = {}) {
  return { id, sourceId: 'baidu', title: `条目-${id}`, summary: `线索-${id}`, url: null, capturedAt: `2026-09-02T0${id.length}:${id.length}0:00.000Z`, score: 50, state: 'active', tags: [], platform: null, ...overrides }
}

test('parseTopicInput normalizes the account-scoped contract', () => {
  // An empty request is a valid open generation — angle and sources stay optional.
  assert.deepEqual(parseTopicInput({}), { angle: null, sourceIds: [], platforms: [], excludeSignalIds: [], accountId: null })
  assert.deepEqual(parseTopicInput(null), { angle: null, sourceIds: [], platforms: [], excludeSignalIds: [], accountId: null })
  assert.deepEqual(parseTopicInput({ angle: '避坑角度' }), { angle: '避坑角度', sourceIds: [], platforms: [], excludeSignalIds: [], accountId: null })
  const accountId = '19141371-91a0-4043-a3df-bc3add45676b'
  const all = parseTopicInput({ angle: ' A ', sourceIds: ['baidu', 'baidu'], platforms: ['抖音', '抖音'], excludeSignalIds: ['s1'], accountId })
  assert.deepEqual(all, { angle: 'A', sourceIds: ['baidu'], platforms: ['抖音'], excludeSignalIds: ['s1'], accountId })
  assert.throws(() => parseTopicInput({ angle: 'x'.repeat(501) }), /长度必须在 1-500/u)
  assert.throws(() => parseTopicInput({ angle: '选题', accountId: 'bad' }), /账号定位标识无效/u)
  assert.throws(() => parseTopicInput({ sourceIds: Array.from({ length: 21 }, (_, i) => `s${i}`) }), /最多包含 20 项/u)
})

test('parseTopicInput rejects the removed title and signalIds inputs', () => {
  // The legacy four-input contract is gone: unknown keys are dropped, never honored.
  const parsed = parseTopicInput({ title: '自拟标题', signalIds: ['s1'] })
  assert.equal(parsed.angle, null)
  assert.deepEqual(parsed.sourceIds, [])
  assert.ok(!('title' in parsed) && !('signalIds' in parsed))
})

test('parseProfile keeps every field optional', () => {
  assert.deepEqual(parseProfile(undefined), emptyProfile())
  const profile = parseProfile({ positioning: 'AI 工具垂类', audience: '效率创作者', pillars: ['工具拆解'], boundary: '不做医疗' })
  assert.equal(hasProfile(profile), true)
  assert.equal(hasProfile(emptyProfile()), false)
  assert.throws(() => parseProfile({ positioning: 'p'.repeat(601) }), /长度必须在 1-600/u)
})

test('parseAccountSnapshot keeps the project context immutable and constrained', () => {
  const snapshot = parseAccountSnapshot({ id: '19141371-91a0-4043-a3df-bc3add45676b', name: '教育解读号', revision: 3, positioning: '教育垂类', pillars: ['家长视角'] })
  assert.deepEqual(snapshot, { id: '19141371-91a0-4043-a3df-bc3add45676b', name: '教育解读号', revision: 3, positioning: '教育垂类', audience: null, pillars: ['家长视角'], boundary: null })
  assert.equal(parseAccountSnapshot(null), null)
  assert.throws(() => parseAccountSnapshot({ id: 'bad', name: '账号', revision: 1 }), /账号定位标识无效/u)
  assert.throws(() => parseAccountSnapshot({ id: '19141371-91a0-4043-a3df-bc3add45676b', name: '账号', revision: 0 }), /账号定位版本无效/u)
})

const pool = [
  signal('s1', { sourceId: 'baidu', score: 90, title: '量子芯片突破', summary: '量子芯片团队发布新架构' }),
  signal('s2', { sourceId: '36kr', score: 80, state: 'ignored', title: '被忽略的融资', summary: '某公司融资消息' }),
  signal('s3', { sourceId: '36kr', score: 70, title: '三六氪行业观察', summary: '行业观察报告发布' }),
  signal('s4', { sourceId: AI_DAILY_SOURCE_ID, score: 60, platform: '抖音', title: '抖音 AI 观察', summary: '日报条目' }),
  signal('s5', { sourceId: AI_DAILY_SOURCE_ID, score: 55, platform: 'B站', title: 'B站 AI 观察', summary: '日报条目' }),
]

test('assembleMaterial opens the whole active pool when no source is scoped', () => {
  const material = assembleMaterial(parseTopicInput({ angle: '避坑角度' }), pool)
  assert.equal(material.mode, 'latest-batches')
  // ignored s2 stays out; the rest are scored and included.
  assert.deepEqual(material.signals.map((item) => item.id), ['s1', 's3', 's4', 's5'])
  assert.ok(!material.signals.some((item) => item.id === 's2'), 'ignored signals must stay out')
})

test('assembleMaterial scope-filters by non-daily sources', () => {
  const material = assembleMaterial(parseTopicInput({ sourceIds: ['baidu'] }), pool)
  assert.deepEqual(material.signals.map((item) => item.id), ['s1'])
})

test('assembleMaterial keeps AI-daily signals out unless the daily source is scoped', () => {
  // Selecting only baidu must not leak the two ai-daily signals.
  const material = assembleMaterial(parseTopicInput({ sourceIds: ['baidu', '36kr'] }), pool)
  assert.deepEqual(material.signals.map((item) => item.id).sort(), ['s1', 's3'])
  assert.ok(!material.signals.some((item) => item.sourceId === AI_DAILY_SOURCE_ID))
})

test('assembleMaterial filters AI-daily signals by platform granularity', () => {
  const all = assembleMaterial(parseTopicInput({ sourceIds: [AI_DAILY_SOURCE_ID] }), pool)
  assert.deepEqual(all.signals.map((item) => item.id).sort(), ['s4', 's5'])
  const douyinOnly = assembleMaterial(parseTopicInput({ sourceIds: [AI_DAILY_SOURCE_ID], platforms: ['抖音'] }), pool)
  assert.deepEqual(douyinOnly.signals.map((item) => item.id), ['s4'])
})

test('assembleMaterial drops per-run exclusions', () => {
  const material = assembleMaterial(parseTopicInput({ angle: '开放', excludeSignalIds: ['s1', 's4'] }), pool)
  assert.deepEqual(material.signals.map((item) => item.id), ['s3', 's5'])
  assert.ok(!material.signals.some((item) => item.id === 's1' || item.id === 's4'))
})

test('assembleMaterial reports an honest empty latest batch', () => {
  const material = assembleMaterial(parseTopicInput({ sourceIds: ['github-trending'] }), pool)
  assert.equal(material.mode, 'latest-batches')
  assert.equal(material.signals.length, 0)
  // Excluding everything also yields an empty latest batch.
  const allExcluded = assembleMaterial(parseTopicInput({ angle: '开放', excludeSignalIds: ['s1', 's3', 's4', 's5'] }), pool)
  assert.equal(allExcluded.mode, 'latest-batches')
  assert.equal(allExcluded.signals.length, 0)
})

test('assembleMaterial preserves every source-snapshot signal instead of taking a global top-N', () => {
  const bigPool = Array.from({ length: 80 }, (_, index) => signal(`b${index}`, { score: index }))
  const material = assembleMaterial(parseTopicInput({}), bigPool)
  assert.equal(material.signals.length, 80)
  assert.equal(material.signals[0].score, 79, 'highest score first')
})

test('buildTopicPrompt carries the ordering rule, constraints and honest empty material', () => {
  const input = parseTopicInput({ angle: '避坑角度' })
  const profile = parseProfile({ positioning: 'AI 工具垂类' })
  const empty = buildTopicPrompt({ input, material: assembleMaterial(input, []), profile, sourceLabels: {} })
  assert.ok(empty.includes('避坑角度'))
  assert.ok(empty.includes('AI 工具垂类'))
  assert.ok(empty.includes('候选按推荐程度从高到低排列'), 'the recommend-first ordering rule must be present')
  assert.ok(empty.includes('本轮渠道最新信号：无'))
  const scopedInput = parseTopicInput({ angle: '避坑角度', sourceIds: ['baidu'] })
  const withMaterial = buildTopicPrompt({ input: scopedInput, material: assembleMaterial(scopedInput, pool), profile: emptyProfile(), sourceLabels: { baidu: '百度热榜' } })
  assert.ok(withMaterial.includes('id=s1'))
  assert.ok(withMaterial.includes('百度热榜'))
  assert.ok(!withMaterial.includes('账号约束'))
})

test('buildTopicPrompt labels the AI-daily scope by platform', () => {
  const partial = buildTopicPrompt({ input: parseTopicInput({ sourceIds: [AI_DAILY_SOURCE_ID], platforms: ['抖音', 'B站'] }), material: assembleMaterial(parseTopicInput({ sourceIds: [AI_DAILY_SOURCE_ID] }), pool), profile: emptyProfile(), sourceLabels: {} })
  assert.ok(partial.includes('AI 内容日报（抖音、B站）'))
  const whole = buildTopicPrompt({ input: parseTopicInput({ sourceIds: [AI_DAILY_SOURCE_ID] }), material: assembleMaterial(parseTopicInput({ sourceIds: [AI_DAILY_SOURCE_ID] }), pool), profile: emptyProfile(), sourceLabels: {} })
  assert.ok(whole.includes('AI 内容日报（全部平台）'))
})

test('normalizeCandidates drops unknown references, caps at five, keeps order and honesty', () => {
  const material = assembleMaterial(parseTopicInput({ sourceIds: ['baidu', '36kr'] }), pool)
  const structured = {
    candidates: [
      { title: '推荐候选', angle: '角度一', signalIds: ['s1', 's9', 's3'] },
      { title: '候选二' },
      { title: '  ' },
      ...Array.from({ length: 6 }, (_, index) => ({ title: `溢出候选 ${index}` })),
    ],
    summary: '生成完毕',
  }
  const result = normalizeCandidates(structured, material)
  assert.equal(result.returned, 5)
  // Index 0 is the recommended pick by contract; unknown s9 is dropped, never invented.
  assert.equal(result.candidates[0].title, '推荐候选')
  assert.deepEqual(result.candidates[0].signalIds, ['s1', 's3'])
  assert.equal(result.candidates[1].signalIds.length, 0)
  assert.equal(result.requested, 5)
})

test('normalizeCandidates tolerates missing or malformed structured output', () => {
  const material = assembleMaterial(parseTopicInput({ angle: '开放' }), pool)
  assert.equal(normalizeCandidates(undefined, material).returned, 0)
  assert.equal(normalizeCandidates({ candidates: 'nope' }, material).returned, 0)
})

test('generation steps expose the four audited phases', () => {
  const steps = buildGenerationSteps()
  assert.deepEqual(steps.map((step) => step.id), ['assemble', 'material', 'generate', 'normalize'])
  assert.ok(steps.every((step) => step.status === 'pending'))
})

test('summarizeInput describes the account-scoped assembly', () => {
  const account = { name: '老傅聊AI' }
  const scoped = parseTopicInput({ sourceIds: ['baidu', AI_DAILY_SOURCE_ID], platforms: ['抖音', 'B站'] })
  assert.equal(
    summarizeInput(scoped, assembleMaterial(scoped, pool), account),
    '账号「老傅聊AI」 + 1 个公开来源 + AI 内容日报（2 个平台） · 最新批次信号 3 条 · 实际覆盖 2 个采集来源',
  )
  const general = parseTopicInput({ angle: '开放', excludeSignalIds: ['s1'] })
  assert.equal(
    summarizeInput(general, assembleMaterial(general, pool)),
    '通用（无账号定位） + 角度 + 排除 1 条 · 最新批次信号 3 条 · 实际覆盖 2 个采集来源',
  )
})

test('candidate schema stays an object-rooted supported subset', () => {
  assert.equal(TOPIC_CANDIDATES_SCHEMA.type, 'object')
  const candidateItem = TOPIC_CANDIDATES_SCHEMA.properties.candidates.items
  assert.equal(candidateItem.type, 'object')
  assert.deepEqual(candidateItem.required, ['title'])
  assert.equal(candidateItem.properties.signalIds.items.type, 'string')
})


test('topicAttemptPlans removes risk sources one at a time and ends with a signal-free attempt', () => {
  const plans = topicAttemptPlans(['36kr', 'ai-daily-import', 'weibo-hot', 'infoq'])
  assert.deepEqual(plans.map((plan) => plan.sourceIds), [
    ['36kr', 'ai-daily-import', 'weibo-hot', 'infoq'],
    ['36kr', 'weibo-hot', 'infoq'],
    ['36kr', 'infoq'],
    ['infoq'],
    [],
  ])
  assert.deepEqual(plans.map((plan) => plan.removedSourceId), [null, 'ai-daily-import', 'weibo-hot', '36kr', null])
  assert.deepEqual(topicAttemptPlans(['36kr']), [
    { index: 0, sourceIds: ['36kr'], removedSourceId: null },
    { index: 1, sourceIds: [], removedSourceId: null },
  ])
})
