/**
 * The report feature: who may be selected, what the entry points do, and what the
 * generated document actually contains.
 *
 * The report only ever leaves the page as a blob, so these assertions read the
 * document out of the harness's blob log rather than settling for "a report was
 * produced". That is the only way to cover the exported file's own structure —
 * its matrix, its tab strip and its inlined artifacts — from outside a browser.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { loadPack, find, textOf } from './render-harness.mjs'
import { apiFor, questions, tasks } from './preview-data.mjs'

/** One run's stored figures, shaped exactly as the store normalises them. */
const STATS = {
  source: 'settle',
  capturedAt: '2026-10-06T02:00:00.000Z',
  asOfSeq: 171,
  turns: 1,
  steps: 28,
  llmMs: 504282,
  toolMs: 401396,
  ttftMs: 81750,
  ttftSteps: 28,
  decodeMs: 422532,
  decodeTokens: 56123,
  tokens: { uncachedInput: 200843, cacheRead: 1409920, cacheWrite: 0, output: 56123 },
  context: { pressureTokens: 74128, contextWindow: 1000000 },
}
const ARTIFACT_HTML = '<!doctype html><title>pelican</title><svg><circle/></svg>'

/** Fixtures plus the two seams the report needs from the host. */
const reportPack = (fixtures = {}) => {
  const read = apiFor(fixtures)
  return loadPack({ api: async (method, request) => {
    if (method === 'stats') return { stats: STATS, reason: null }
    if (method === 'artifact') return { path: request.path, bytes: ARTIFACT_HTML.length, text: ARTIFACT_HTML }
    return read(method, request)
  } })
}

const pickFor = (tree, title) => find(tree, { className: 'mr-pick', aria: title })

test('only settled tasks can be selected, and a failed task still can be', async () => {
  const pack = reportPack()
  const page = await pack.render('history')
  const picks = find(page.tree, { className: 'mr-pick' })
  assert.equal(picks.length, tasks.length, 'every task row offers a selection')
  // task-live still has a running run: freezing it now would state a duration that
  // had not finished. task-four is failed at task level but every run settled, and
  // "4 succeeded, 1 failed" is exactly the task worth reporting on.
  assert.deepEqual(picks.map(node => node.props.disabled === true), [true, false, false, false])
  // Failed task: selectable. Running task: not.
  assert.equal(pickFor(page.tree, questions[0].title)[0].props.disabled, false)
  assert.equal(pickFor(page.tree, questions[5].title)[0].props.disabled, true)
})

test('the report entry points stay disabled until something is selected', async () => {
  const pack = reportPack()
  const page = await pack.render('history')
  const buttons = () => find(page.tree, { className: 'mr-button' }).filter(node => ['在工作台内查看', '导出测评报告'].includes(textOf(node)))
  assert.equal(buttons().length, 2)
  assert.deepEqual(buttons().map(node => node.props.disabled), [true, true])
  assert.match(textOf(find(page.tree, { className: 'mr-pickhint' })[0]), /勾选「已结束」的任务/u)

  await page.change({ className: 'mr-pick', aria: questions[0].title })
  assert.deepEqual(buttons().map(node => node.props.disabled), [false, false])
  const stats = find(page.tree, { className: 'mr-pickstats' })[0]
  assert.match(textOf(stats), /1\s*已选任务/u)
  assert.match(textOf(find(page.tree, { className: 'mr-pickhint' })[0]), /报告将覆盖 1 道题/u)
})

test('selecting every settled task skips the running one', async () => {
  const pack = reportPack()
  const page = await pack.render('history')
  await page.click({ text: '选中全部可勾选' })
  assert.match(textOf(find(page.tree, { className: 'mr-pickstats' })[0]), /3\s*已选任务/u)
  // 3 tasks x model names, deduplicated: the fixture models across them are distinct.
  assert.match(textOf(find(page.tree, { className: 'mr-pickstats' })[0]), /模型并集/u)
})

test('the report document is self-contained and carries the matrix, tabs and inlined artifact', async () => {
  const pack = reportPack()
  const page = await pack.render('history')
  await page.change({ className: 'mr-pick', aria: questions[0].title })
  await page.click({ text: '在工作台内查看' })

  assert.equal(pack.blobs.length, 1, 'viewing the report generated exactly one document')
  const document = pack.blobs[0]
  assert.match(document, /^<!doctype html>/u)
  assert.match(document, /总览矩阵/u)
  assert.match(document, /分题明细/u)
  assert.match(document, /事实报告，不含评分与排名/u)
  // The mode is stated in the report, not implied: nothing here is a score.
  assert.match(document, /不是得分，也不能用来排名/u)
  // Tabs wrap instead of scrolling sideways when a batch has many questions.
  assert.match(document, /\.rtabs\{display:flex;flex-wrap:wrap/u)
  // The artifact travels inside the file, base64-encoded, and the sandbox keeps it
  // from reaching the report or any sibling artifact.
  assert.match(document, /setAttribute\('sandbox', 'allow-scripts allow-pointer-lock'\)/u)
  assert.ok(document.includes(Buffer.from(ARTIFACT_HTML, 'utf8').toString('base64')), 'the HTML artifact is inlined')
  assert.doesNotMatch(document, /allow-same-origin/u, 'an artifact must not share the report origin')

  // Shown in place: the overlay wraps the very same document.
  const frame = find(page.tree, { className: 'mr-report-frame' })[0]
  assert.ok(frame, 'the report is displayed in an overlay')
  assert.equal(frame.props.src, 'blob:preview-1')
})

test('the document reports the figures the host recorded, not a recomputation', async () => {
  const pack = reportPack()
  const page = await pack.render('history')
  await page.change({ className: 'mr-pick', aria: questions[0].title })
  await page.click({ text: '在工作台内查看' })
  const document = pack.blobs[0]
  // decodeTokens / decodeMs = 56123 / 422.532s
  assert.match(document, /132\.8/u)
  // The run's own figures, and the provenance that makes them checkable.
  assert.match(document, /1 轮 28 步/u)
  assert.match(document, /#171/u)
  assert.match(document, /1\.67M/u)
})

test('a failed attempt that was continued is marked as such instead of looking contradictory', async () => {
  // The production shape: the first attempt died on a 429 after writing some of its
  // answer, so the run is 失败; the card was then continued by hand, so the figures and
  // artifacts span more than the pack's own attempt. Without the mark, a 失败 row with a
  // full artifact list and a full token count reads as a broken report.
  const continued = tasks.map(task => task.id !== 'task-four' ? task : {
    ...task,
    runs: [{ ...task.runs[3], continued: true, artifacts: [{ path: 'half-done.html', bytes: 800, updatedAt: '2026-10-06T02:00:00.000Z' }] }],
  })
  const pack = reportPack({ tasks: continued })
  const page = await pack.render('history')
  await page.change({ className: 'mr-pick', aria: questions[0].title })
  await page.click({ text: '在工作台内查看' })
  const document = pack.blobs[0]
  assert.match(document, /失败/u, 'the first attempt did fail')
  assert.match(document, /续跑/u, 'and the report says the run was picked back up')
  assert.match(document, /续跑部分/u, 'the footnote explains what the continuation means for the figures')
})

test('artifacts that cannot be rendered are listed but never inlined', async () => {
  const withShot = tasks.map(task => task.id !== 'task-two' ? task : {
    ...task,
    runs: [{ ...task.runs[0], artifacts: [
      { path: 'snake-ai.html', bytes: 15137, updatedAt: '2026-10-06T02:00:00.000Z' },
      { path: 'shots/01-mid.png', bytes: 169580, updatedAt: '2026-10-06T02:00:00.000Z' },
      { path: 'test-core.js', bytes: 3838, updatedAt: '2026-10-06T02:00:00.000Z' },
    ] }],
  })
  const pack = reportPack({ tasks: withShot })
  const page = await pack.render('history')
  await page.change({ className: 'mr-pick', aria: questions[1].title })
  await page.click({ text: '在工作台内查看' })
  const document = pack.blobs[0]
  assert.match(document, /snake-ai\.html/u)
  assert.match(document, /shots\/01-mid\.png/u, 'a screenshot is still named in the report')
  assert.match(document, /test-core\.js/u)
  assert.match(document, /附带文件（不内联，仅登记）/u)
  assert.equal(pack.calls.filter(call => call.method === 'artifact').length, 1, 'only the markup was read')
  assert.equal(pack.calls.find(call => call.method === 'artifact').request.path, 'snake-ai.html')
})

test('the header counts the artifacts the document actually inlined', async () => {
  const pack = reportPack()
  const page = await pack.render('history')
  await page.change({ className: 'mr-pick', aria: questions[0].title })
  await page.click({ text: '在工作台内查看' })
  const document = pack.blobs[0]
  // task-four's first run owns the one markup artifact in the fixtures. The count is
  // derived from the same key the cards are rendered under, so the header cannot
  // claim a number the document does not carry.
  assert.match(document, /内联产物 1 个/u)
  assert.equal((document.match(/class="art"/gu) || []).length, 1, 'exactly one artifact card was rendered')
})

test('a run without figures names the reason instead of printing zeroes', async () => {
  // The host answers, but refuses to read projections: the reader is told that
  // restarting the workbench would fix it, which is the whole point of telling the
  // reasons apart. apiFor() throws for `stats`, which the page reports as a failed read.
  const pack = loadPack({ api: async (method, request) => {
    if (method === 'stats') throw new Error('宿主不提供会话投影读取服务。')
    return apiFor({})(method, request)
  } })
  const page = await pack.render('history')
  await page.change({ className: 'mr-pick', aria: questions[0].title })
  await page.click({ text: '在工作台内查看' })
  const document = pack.blobs[0]
  assert.match(document, /未记录（读取失败）/u, 'a missing measurement is declared, not rendered as 0')
  assert.match(document, /有 4 次运行没有耗时与 token 记录/u, 'the report says how many, once')
  assert.match(document, /稍后重新生成报告即可再试一次/u, 'and what the reader can do about it')
})

test('the report separates a reason a restart would fix from one it would not', async () => {
  // One run whose host cannot read projections (retryable) and one whose session is
  // permanently gone. Both used to read "未记录"; the reader's next move differs.
  const mixed = tasks.map(task => task.id !== 'task-four' ? task : {
    ...task,
    runs: task.runs.map((run, index) => index === 0
      ? { ...run, sessionId: null, stats: undefined, statsUnavailable: 'missing' }
      : { ...run, sessionId: `session-${run.id}`, stats: undefined, statsUnavailable: undefined }),
  })
  const pack = loadPack({ api: async (method, request) => {
    if (method === 'stats') throw new Error('宿主不提供会话投影读取服务。')
    return apiFor({ tasks: mixed })(method, request)
  } })
  const page = await pack.render('history')
  await page.change({ className: 'mr-pick', aria: questions[0].title })
  await page.click({ text: '在工作台内查看' })
  const document = pack.blobs[0]
  assert.match(document, /未记录（投影已不存在）/u, 'the permanent one keeps its own words')
  assert.match(document, /未记录（读取失败）/u, 'so does the retryable one')
  assert.match(document, /无法补齐，只能重跑这次测评/u)
  assert.match(document, /稍后重新生成报告即可再试一次/u)
  // The permanent verdict is already on the record, so the host is never asked about it.
  assert.equal(pack.calls.filter(call => call.method === 'stats' && call.request.runId === 'run-a').length, 0)
  assert.ok(pack.calls.some(call => call.method === 'stats' && call.request.runId === 'run-b'), 'the retryable one is asked')
})

test('exporting downloads the same document the preview showed', async () => {
  const pack = reportPack()
  const page = await pack.render('history')
  await page.change({ className: 'mr-pick', aria: questions[0].title })
  await page.click({ text: '在工作台内查看' })
  const previewed = pack.blobs[0]
  await page.click({ text: '导出测评报告' })
  assert.equal(pack.blobs.length, 2)
  assert.equal(pack.blobs[1], previewed, 'preview and export are one document, not two layouts')
  assert.match(textOf(find(page.tree, { className: 'mr-notice' })[0]), /已导出 1 道题 × 4 个模型的报告/u)
})

test('an empty selection refuses to produce a report', async () => {
  const pack = reportPack()
  const page = await pack.render('history')
  // The buttons are disabled, so the guard is exercised through the handler's own
  // path: clearing after a selection still leaves nothing to report on.
  await page.change({ className: 'mr-pick', aria: questions[0].title })
  await page.click({ text: '清空' })
  assert.equal(pack.blobs.length, 0)
  assert.match(textOf(find(page.tree, { className: 'mr-pickhint' })[0]), /勾选「已结束」的任务/u)
})
test('the artifact grid shows three models per row, and no fixed stage height', async () => {
  const pack = reportPack()
  const page = await pack.render('history')
  await page.change({ className: 'mr-pick', aria: questions[0].title })
  await page.click({ text: '在工作台内查看' })
  const document = pack.blobs[0]
  // The comparison is the point: a full-width stack never showed two results at once.
  assert.match(document, /\.runblocks\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/u)
  assert.match(document, /\.runblocks\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\);gap:12px;align-items:start/u, 'a short card must not be stretched')
  assert.match(document, /@media\(max-width:900px\)\{\.runblocks\{grid-template-columns:repeat\(2,/u)
  assert.match(document, /@media\(max-width:620px\)\{\.runblocks\{grid-template-columns:minmax\(0,1fr\)\}/u)
  // A fixed height that suited the full width left most of a third-width box empty.
  assert.match(document, /\.art-stage\{position:relative;aspect-ratio:16\/10/u)
  assert.doesNotMatch(document, /\.art-stage\{[^}]*height:430px/u)
})

test('the artifact header names the file once, not the model twice', async () => {
  const pack = reportPack()
  const page = await pack.render('history')
  await page.change({ className: 'mr-pick', aria: questions[0].title })
  await page.click({ text: '在工作台内查看' })
  const document = pack.blobs[0]
  const from = document.indexOf('<article class="art"')
  const art = document.slice(from, document.indexOf('</article>', from))
  assert.ok(from > 0, 'the fixture renders one artifact card')
  // The model is already the card's heading; repeating it inside a third-width card
  // is noise, so the artifact header carries the file instead.
  assert.match(art, /<header><code>pelican-bicycle\.html<\/code>/u)
  assert.doesNotMatch(art, /<strong>/u)
})

test('a run that wrote two pages still occupies one cell', async () => {
  // 江南水乡 really does produce both a shell and a scene. Stacking both stages
  // would make that one card twice as tall and break the grid's rows.
  const withTwo = tasks.map(task => task.id !== 'task-two' ? task : {
    ...task,
    runs: [{ ...task.runs[0], artifacts: [
      { path: 'scene.html', bytes: 4096, updatedAt: '2026-10-06T02:00:00.000Z' },
      { path: 'shell.html', bytes: 2048, updatedAt: '2026-10-06T02:00:00.000Z' },
    ] }],
  })
  const read = apiFor({ tasks: withTwo })
  const pack = loadPack({ api: async (method, request) => {
    if (method === 'stats') return { stats: STATS, reason: null }
    if (method === 'artifact') return { path: request.path, bytes: 16, text: ARTIFACT_HTML }
    return read(method, request)
  } })
  const page = await pack.render('history')
  await page.change({ className: 'mr-pick', aria: questions[1].title })
  await page.click({ text: '在工作台内查看' })
  const document = pack.blobs[0]
  assert.equal((document.match(/<article class="art"/gu) || []).length, 1, 'one stage per card')
  // The second page stays reachable, as a preview button rather than a second stage.
  assert.match(document, /class="file html preview"[^>]*data-name="shell\.html"/u)
  assert.ok(pack.calls.some(call => call.method === 'artifact' && call.request.path === 'shell.html'), 'both were inlined, so both can be previewed')
})
