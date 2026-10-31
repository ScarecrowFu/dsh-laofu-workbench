import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ModelReviewStore } from '../model-review-store.mjs'

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'model-review-store-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return new ModelReviewStore(root).init()
}

test('question bank validates, versions, filters and archives text questions', async (t) => {
  const store = await setup(t)
  const first = await store.saveQuestion({ title: '  事实核验 ', prompt: '回答这道题。', tags: ['事实'] })
  assert.equal(first.version, 1)
  const second = await store.saveQuestion({ id: first.id, title: '事实核验（二）', prompt: '回答这道题。', tags: ['事实'] })
  assert.equal(second.version, 2)
  assert.equal((await store.listQuestions({ query: '事实' })).length, 1)
  await store.archiveQuestion({ id: first.id })
  assert.equal((await store.listQuestions()).find((item) => item.id === first.id)?.status, 'archived')
})

test('question bank initializes the 10 built-in prompts once without overwriting edits', async (t) => {
  const store = await setup(t)
  const initial = await store.listQuestions()
  assert.equal(initial.length, 10)
  assert.equal(initial.filter((item) => item.tags.includes('系统预置')).length, 10)
  assert.equal(initial.find((item) => item.id === 'lwb-default-01')?.title, '多步推导 · 艾宾浩斯')
  assert.match(initial.find((item) => item.id === 'lwb-default-02')?.prompt || '', /一只鹈鹕骑着一辆自行车/u)
  assert.match(initial.find((item) => item.id === 'lwb-default-03')?.prompt || '', /秦始皇骑着一只白色的北极熊/u)
  assert.equal(initial.find((item) => item.id === 'lwb-default-09')?.category, '长程题')
  assert.equal(initial.find((item) => item.id === 'lwb-default-09')?.title, '江南水乡')
  assert.equal(initial.find((item) => item.id === 'lwb-default-10')?.title, '第三人称跑酷游戏')

  // The built-in bank is a curated short list, so pin the exact set: a silent
  // addition or renumbering would otherwise only show up in the running app.
  // Ids are assigned in the order the product owner listed the questions.
  assert.deepEqual(
    initial.map((item) => `${item.id} ${item.title}`).sort(),
    [
      'lwb-default-01 多步推导 · 艾宾浩斯',
      'lwb-default-02 鹈鹕骑自行车',
      'lwb-default-03 秦始皇骑北极熊',
      'lwb-default-04 夜市烤鸭',
      'lwb-default-05 弹跳球',
      'lwb-default-06 贪吃蛇自动寻路',
      'lwb-default-07 五子棋人机对战',
      'lwb-default-08 数据看板',
      'lwb-default-09 江南水乡',
      'lwb-default-10 第三人称跑酷游戏',
    ].sort(),
  )

  // Built-in metadata is user-facing: the detail card renders `description`, so
  // it has to state what the question probes instead of restating its index,
  // and tags have to carry a dimension the picker can actually filter on.
  const judgingTags = new Set(['可判性高', '需人工看图', '需人工试玩', '含机器客观分', '长程'])
  for (const item of initial) {
    assert.ok(item.description && !/系统预置题库第/u.test(item.description), `${item.id} 需要真正的考点说明`)
    assert.ok([...item.description].length <= 500, `${item.id} 说明超过 500 字`)
    assert.ok(item.tags.some((tag) => judgingTags.has(tag)), `${item.id} 缺少判读维度标签`)
    assert.equal(item.tags.includes(item.category), false, `${item.id} 标签不应与分类重名`)
  }
  // 说明：这一版内置题面由产品负责人给定，其中 02–05、09 只要求「生成/输出单个 HTML
  // 文件」，没有像上一版那样点名写入运行目录的落盘路径。产物列表因此取决于模型是否
  // 主动写文件，不再有题面层面的兜底；如要恢复该口径，需同时改题面与本节断言。

  await store.saveQuestion({ ...initial.find((item) => item.id === 'lwb-default-01'), title: '我改过的题目' })
  await new ModelReviewStore(store.workspacePath).init()
  const restarted = await store.listQuestions()
  assert.equal(restarted.length, 10)
  assert.equal(restarted.find((item) => item.id === 'lwb-default-01')?.title, '我改过的题目')
  assert.equal(restarted.find((item) => item.id === 'lwb-default-01')?.version, 2)
})

test('a deleted question stays deleted, built-in or not', async (t) => {
  const store = await setup(t)
  const builtIn = (await store.listQuestions()).find((item) => item.id === 'lwb-default-02')
  const mine = await store.saveQuestion({ title: '我的题目', prompt: '提示词' })
  assert.deepEqual(await store.deleteQuestion({ id: mine.id }), { id: mine.id })
  await store.deleteQuestion({ id: builtIn.id })
  assert.equal((await store.listQuestions()).length, 9)
  await assert.rejects(store.deleteQuestion({ id: builtIn.id }), /题目不存在/u)

  // Seeding adds what is missing; a deleted built-in is not missing.
  const restarted = await new ModelReviewStore(store.workspacePath).init()
  const after = await restarted.listQuestions()
  assert.equal(after.length, 9, 'the seeder does not hand a deleted built-in back')
  assert.equal(after.some((item) => item.id === builtIn.id), false)
  assert.equal(after.some((item) => item.id === mine.id), false)

  // Writing the id again retires its tombstone, so it is never seeded twice.
  const revived = await restarted.saveQuestion({ id: builtIn.id, title: '重新写的一道题', prompt: '提示词' })
  assert.equal(revived.version, 1)
  const again = await new ModelReviewStore(store.workspacePath).init()
  const final = await again.listQuestions()
  assert.equal(final.length, 10)
  assert.equal(final.filter((item) => item.id === builtIn.id).length, 1)
  assert.equal(final.find((item) => item.id === builtIn.id).title, '重新写的一道题')
})

test('task stores immutable question/model snapshots and aggregates run status', async (t) => {
  const store = await setup(t)
  const question = await store.saveQuestion({ title: '题目', prompt: '提示词' })
  const task = await store.createTask({ question, models: [{ provider: 'official', model: 'a', displayName: 'A' }, { provider: 'ats', model: 'b', displayName: 'B' }] })
  question.title = 'changed'
  assert.equal((await store.task(task.id)).question.title, '题目')
  await store.updateRun(task.id, task.runs[0].id, { status: 'succeeded', answer: 'ok' })
  assert.equal((await store.task(task.id)).status, 'running')
  await store.updateRun(task.id, task.runs[1].id, { status: 'failed', error: 'nope' })
  const saved = await store.task(task.id)
  assert.equal(saved.status, 'failed')
  assert.equal(saved.runs[0].answer, 'ok')
  assert.match(await readFile(store.path(task.id, 'task.json'), 'utf8'), /"status": "failed"/u)
})

test('concurrent model runs preserve every session and completion result', async (t) => {
  const store = await setup(t)
  const question = await store.saveQuestion({ title: '并发题目', prompt: '提示词' })
  const task = await store.createTask({ question, models: [
    { provider: 'deepseek-account', model: 'deepseek-flash' },
    { provider: 'deepseek-account', model: 'deepseek-v4-pro' },
  ] })

  await Promise.all([
    store.updateRun(task.id, task.runs[0].id, { status: 'running', sessionId: 'session-flash' }),
    store.updateRun(task.id, task.runs[1].id, { status: 'running', sessionId: 'session-pro' }),
  ])
  let saved = await store.task(task.id)
  assert.deepEqual(saved.runs.map((run) => run.sessionId), ['session-flash', 'session-pro'])

  await Promise.all([
    store.updateRun(task.id, task.runs[0].id, { status: 'succeeded', answer: { content: 'flash' } }),
    store.updateRun(task.id, task.runs[1].id, { status: 'succeeded', answer: { content: 'pro' } }),
  ])
  saved = await store.task(task.id)
  assert.equal(saved.status, 'succeeded')
  assert.deepEqual(saved.runs.map((run) => ({ sessionId: run.sessionId, answer: run.answer.content })), [
    { sessionId: 'session-flash', answer: 'flash' },
    { sessionId: 'session-pro', answer: 'pro' },
  ])
})

test('host restart marks queued and running evaluations as failed', async (t) => {
  const store = await setup(t)
  const question = await store.saveQuestion({ title: '题目', prompt: '提示词' })
  const task = await store.createTask({ question, models: [{ provider: 'official', model: 'a' }] })
  await store.updateRun(task.id, task.runs[0].id, { status: 'running' })
  const recovered = await new ModelReviewStore(store.workspacePath).init()
  const saved = await recovered.task(task.id)
  assert.equal(saved.status, 'failed')
  assert.equal(saved.runs[0].status, 'failed')
})

test('task stores every model when more than four models are selected', async (t) => {
  const store = await setup(t)
  const question = await store.saveQuestion({ title: '题目', prompt: '提示词' })
  const models = Array.from({ length: 5 }, (_, index) => ({ provider: 'official', model: String(index) }))
  const task = await store.createTask({ question, models })
  assert.equal(task.runs.length, 5)
  assert.equal(task.models.length, 5)
})

test('every run owns one directory below the pack workspace', async (t) => {
  const store = await setup(t)
  const question = await store.saveQuestion({ title: '题目', prompt: '提示词' })
  const task = await store.createTask({ question, models: [
    { provider: 'official', model: 'a', displayName: 'A' },
    { provider: 'official', model: 'b', displayName: 'B' },
  ] })
  const [left, right] = task.runs
  assert.equal(left.cwd, `runs/${task.id}/${left.id}`)
  assert.equal(right.cwd, `runs/${task.id}/${right.id}`)
  assert.notEqual(left.cwd, right.cwd)
  assert.equal(store.runPath(task.id, left.id), join(store.runsRoot, task.id, left.id))
  assert.equal(task.artifactsUnavailable, false)
  await assert.rejects(store.collectArtifacts(task.id, '../escape'), /测评运行标识无效/u)
})

test('artifact listing reports only regular files inside the run directory', async (t) => {
  const store = await setup(t)
  const question = await store.saveQuestion({ title: '题目', prompt: '提示词' })
  const task = await store.createTask({ question, models: [{ provider: 'official', model: 'a' }] })
  const run = task.runs[0]
  assert.deepEqual(await store.collectArtifacts(task.id, run.id), [], 'a run that wrote nothing reports no artifacts')

  const directory = store.runPath(task.id, run.id)
  await mkdir(join(directory, 'assets'), { recursive: true })
  await writeFile(join(directory, 'answer.md'), '# 回答')
  await writeFile(join(directory, 'assets', 'chart.svg'), '<svg/>')
  const outside = join(store.runsRoot, 'outside.txt')
  await writeFile(outside, 'not this run')
  await symlink(outside, join(directory, 'linked.txt')).catch(() => {})

  const artifacts = await store.collectArtifacts(task.id, run.id)
  assert.deepEqual(artifacts.map((item) => item.path), ['answer.md', 'assets/chart.svg'])
  assert.equal(artifacts[0].bytes, Buffer.byteLength('# 回答'))
  assert.match(artifacts[0].updatedAt, /^\d{4}-\d{2}-\d{2}T/u)

  await store.refreshArtifacts({ taskId: task.id, runId: run.id })
  const saved = await store.task(task.id)
  assert.deepEqual(saved.runs[0].artifacts.map((item) => item.path), ['answer.md', 'assets/chart.svg'])
  await assert.rejects(store.refreshArtifacts({ taskId: task.id, runId: 'missing' }), /测评运行不存在/u)
})

test('tasks recorded before per-run directories report unattributed artifacts', async (t) => {
  const store = await setup(t)
  const question = await store.saveQuestion({ title: '历史题目', prompt: '提示词' })
  const task = await store.createTask({ question, models: [{ provider: 'official', model: 'a' }] })
  const legacy = await store.task(task.id)
  delete legacy.runs[0].cwd
  delete legacy.artifactsUnavailable
  await store.updateTask(legacy)

  const recovered = await new ModelReviewStore(store.workspacePath).init()
  const saved = await recovered.task(task.id)
  assert.equal(saved.artifactsUnavailable, true)
  assert.equal((await recovered.listTasks())[0].artifactsUnavailable, true)
})

test('a report may read a recorded artifact, and nothing else', async (t) => {
  const store = await setup(t)
  const question = await store.saveQuestion({ title: '产物题', prompt: '提示词' })
  const task = await store.createTask({ question, models: [{ provider: 'official', model: 'a' }] })
  const run = (await store.task(task.id)).runs[0]
  const directory = store.runPath(task.id, run.id)
  await mkdir(join(directory, 'shots'), { recursive: true })
  await writeFile(join(directory, 'pelican.html'), '<!doctype html><p>bird</p>')
  await writeFile(join(directory, 'shots', '01.png'), 'not really a png')
  await store.refreshArtifacts({ taskId: task.id, runId: run.id })
  // Written after the listing: recorded artifacts are a snapshot, so a file the run
  // produced later is not reachable through it.
  await writeFile(join(directory, 'late.txt'), 'written after the last listing')

  const file = await store.readArtifact({ taskId: task.id, runId: run.id, path: 'pelican.html' })
  assert.equal(file.text, '<!doctype html><p>bird</p>')
  assert.equal(file.bytes, Buffer.byteLength('<!doctype html><p>bird</p>'))

  // A path that was never recorded cannot be reached, and one cannot climb out of
  // its own run directory either.
  await assert.rejects(store.readArtifact({ taskId: task.id, runId: run.id, path: 'late.txt' }), /不是这次运行的产物记录/u)
  await assert.rejects(store.readArtifact({ taskId: task.id, runId: run.id, path: '../outside.txt' }), /不是这次运行的产物记录/u)
  await assert.rejects(store.readArtifact({ taskId: task.id, runId: run.id, path: 'missing.html' }), /不是这次运行的产物记录/u)
  await assert.rejects(store.readArtifact({ taskId: task.id, runId: 'nope', path: 'pelican.html' }), /测评运行不存在/u)

  // Anything the run did write is reportable — the guard is a path fence, not a
  // judgement about which files deserve to be results — but a directory is not one.
  const recorded = await store.task(task.id)
  recorded.runs[0].artifacts.push({ path: 'shots/01.png', bytes: 17, updatedAt: new Date().toISOString() })
  recorded.runs[0].artifacts.push({ path: 'shots', bytes: 0, updatedAt: new Date().toISOString() })
  await store.updateTask(recorded)
  assert.equal((await store.readArtifact({ taskId: task.id, runId: run.id, path: 'shots/01.png' })).text, 'not really a png')
  await assert.rejects(store.readArtifact({ taskId: task.id, runId: run.id, path: 'shots' }), /产物文件不存在/u)
})

test('an artifact too large to inline is refused rather than pulled into a report', async (t) => {
  const store = await setup(t)
  const { ARTIFACT_READ_LIMIT } = await import('../model-review-store.mjs')
  const question = await store.saveQuestion({ title: '大产物', prompt: '提示词' })
  const task = await store.createTask({ question, models: [{ provider: 'official', model: 'a' }] })
  const run = (await store.task(task.id)).runs[0]
  const directory = store.runPath(task.id, run.id)
  await mkdir(directory, { recursive: true })
  // Written through a size the check reads from disk, not from the record: a
  // recorded byte count is a claim the report must not trust.
  await writeFile(join(directory, 'huge.html'), 'x'.repeat(ARTIFACT_READ_LIMIT + 1))
  const saved = await store.task(task.id)
  saved.runs[0].artifacts.push({ path: 'huge.html', bytes: 1, updatedAt: new Date().toISOString() })
  await store.updateTask(saved)
  await assert.rejects(store.readArtifact({ taskId: task.id, runId: run.id, path: 'huge.html' }), /无法内联进报告/u)
})

test('the stored figures keep only what a report needs, and only when the host reported it', async () => {
  const { normalizeRunStats, RUN_STATS_KEYS } = await import('../model-review-store.mjs')
  assert.deepEqual([...RUN_STATS_KEYS], ['sessionStats', 'tokenUsage', 'contextPressure', 'timeContext'])
  // The shape the host actually hands out: `tokenUsage`'s wire view is its state's
  // `totals`, so the buckets are the value itself.
  const stats = normalizeRunStats({
    sessionStats: { turns: 1, steps: 28, llmMs: 504282, toolMs: 401396, ttftMs: 81750, ttftSteps: 28, decodeMs: 422532, decodeTokens: 56123 },
    tokenUsage: { uncachedInputTokens: 200843, cacheReadTokens: 1409920, cacheWriteTokens: 0, outputTokens: 56123 },
    contextPressure: { pressureTokens: 74128, contextWindow: 1000000, surfaceTokens: 51976 },
  }, 171, 'settle')
  assert.equal(stats.asOfSeq, 171)
  assert.equal(stats.source, 'settle')
  assert.equal(stats.steps, 28)
  assert.deepEqual(stats.tokens, { uncachedInput: 200843, cacheRead: 1409920, cacheWrite: 0, output: 56123 })
  assert.deepEqual(stats.context, { pressureTokens: 74128, contextWindow: 1000000 })
  // Values the report never shows are not persisted.
  assert.equal('decodeTokens' in stats, true)
  assert.equal('surfaceTokens' in stats, false)

  // Both shapes of `tokenUsage` must read the same, because the host hands out the
  // wire view while the persisted cache row holds the state `{ totals, last }`. A
  // reader that accepts only one of them silently reports "no figures" for every
  // real run — it did, on a machine, with every test green.
  const fromState = normalizeRunStats({
    sessionStats: { turns: 1, steps: 28, llmMs: 1, toolMs: 2, ttftMs: 3, ttftSteps: 1, decodeMs: 4, decodeTokens: 5 },
    tokenUsage: { totals: { uncachedInputTokens: 200843, cacheReadTokens: 1409920, cacheWriteTokens: 0, outputTokens: 56123 }, last: null },
    contextPressure: { pressureTokens: 74128, contextWindow: 1000000 },
  }, 171, 'settle')
  const fromWire = normalizeRunStats({
    sessionStats: { turns: 1, steps: 28, llmMs: 1, toolMs: 2, ttftMs: 3, ttftSteps: 1, decodeMs: 4, decodeTokens: 5 },
    tokenUsage: { uncachedInputTokens: 200843, cacheReadTokens: 1409920, cacheWriteTokens: 0, outputTokens: 56123 },
    contextPressure: { pressureTokens: 74128, contextWindow: 1000000 },
  }, 171, 'settle')
  assert.deepEqual(fromWire.tokens, fromState.tokens)
  assert.deepEqual(fromWire.tokens, { uncachedInput: 200843, cacheRead: 1409920, cacheWrite: 0, output: 56123 })

  // A host without the projection unit, or one whose figures are unknown, reports
  // nothing: the report then says 未记录 instead of inventing zeroes.
  assert.equal(normalizeRunStats(null, 1), null)
  assert.equal(normalizeRunStats({ sessionStats: { turns: 1 } }, 1), null)
  assert.equal(normalizeRunStats({ tokenUsage: { totals: { uncachedInputTokens: 1 } } }, 1), null)

  // A continued conversation has to be able to say where it now ends, so the report
  // can move the run's wall clock with the figures instead of printing less time
  // than the model spent. A host without that row leaves the stamp null.
  const withTime = normalizeRunStats({
    sessionStats: { turns: 5, steps: 57 },
    tokenUsage: { totals: { outputTokens: 10 } },
    timeContext: { lastMessageTime: 1792827275569, lastInjectionTime: 1792827117833 },
  }, 572, 'backfill')
  assert.equal(withTime.lastActivityAt, new Date(1792827275569).toISOString())
  assert.equal(normalizeRunStats({
    sessionStats: { turns: 1, steps: 2 },
    tokenUsage: { totals: { outputTokens: 10 } },
  }, 40).lastActivityAt, null)
  const bounded = normalizeRunStats({ sessionStats: { turns: -3, steps: 1.7, llmMs: Number.NaN, toolMs: 12.4 }, tokenUsage: { totals: {} } }, null)
  assert.equal(bounded.turns, 0)
  assert.equal(bounded.steps, 2)
  assert.equal(bounded.llmMs, 0)
  assert.equal(bounded.toolMs, 12)
  assert.equal(bounded.asOfSeq, null)
  assert.equal(bounded.capturedAt.length > 0, true)
})
