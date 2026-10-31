/**
 * Structural checks on what the three pages actually render.
 *
 * `render-harness.mjs` runs the real components with fixtures that mirror host
 * data, so these assertions cover behaviour the source-level contract cannot:
 * grouping, counts, the state a page starts in, the cross-page handoff, and the
 * markup a click produces.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { loadPack, find, textOf } from './render-harness.mjs'
import { apiFor, models, questions, tasks } from './preview-data.mjs'

const openPack = () => loadPack({ api: apiFor({}) })
/**
 * The bank page with a mutable question file.
 *
 * Reads come from the shared fixtures; the four bank writes keep their own copy
 * so a test can follow a question from archived to restored to deleted instead
 * of seeing the fixture reappear unchanged.
 */
const bankPack = () => {
  const read = apiFor({})
  let bank = questions.map(question => ({ ...question }))
  return loadPack({ api: async (method, request) => {
    if (method === 'questions') return bank
    if (method === 'archiveQuestion') {
      bank = bank.map(question => question.id === request.id ? { ...question, status: 'archived', updatedAt: new Date().toISOString() } : question)
      return bank.find(question => question.id === request.id)
    }
    if (method === 'deleteQuestion') {
      bank = bank.filter(question => question.id !== request.id)
      return { id: request.id }
    }
    if (method === 'saveQuestion') {
      const old = bank.find(question => question.id === request.id)
      const saved = { ...(old || {}), ...request, id: request.id || 'q-new', version: (old?.version || 0) + 1, updatedAt: new Date().toISOString() }
      bank = [...bank.filter(question => question.id !== saved.id), saved]
      return saved
    }
    return read(method, request)
  } })
}
const activeRowText = tree => {
  const rows = find(tree, { className: 'mr-qrow' }).filter(row => row.props['data-active'] === 'true')
  return rows.map(textOf).join(' | ')
}

test('the evaluation page groups models and keeps the whole setup on screen', async () => {
  const pack = openPack()
  const page = await pack.render('evaluation')
  assert.deepEqual(page.warnings, [])
  const html = page.html

  assert.match(html, /data-tone="orange"/u, 'the evaluation page carries its own tone')
  assert.match(html, /并行测评 · 模型博主测评/u, 'the header names the module')
  assert.match(html, /① 选择题目/u)
  assert.match(html, /② 选择模型/u)

  // Only usable routes appear in the picker.
  const groups = find(page.tree, { className: 'mr-mgroup' })
  assert.deepEqual(groups.map(group => textOf(find(group, { className: 'mr-mgroup-head' })[0])), [
    'DeepSeek Account2 个', 'bailian5 个', 'LWB 模型服务3 个',
  ])
  assert.doesNotMatch(html, /需配置 API Key/u)
  assert.doesNotMatch(html, /搜索模型/u, 'ten usable models still fit without a search box')
  assert.match(html, /已选 0 个模型/u)

  // Only the first selectable route is expanded, so the panel stays a panel.
  assert.equal(groups.length, 3)
  assert.equal(groups.filter(group => group.props['data-open'] === 'true').length, 1)
  assert.equal(groups[0].props['data-open'], 'true', 'the first usable route starts expanded')
  assert.equal(find(page.tree, { className: 'mr-mrow' }).length, 2, 'a collapsed group renders no rows')
  assert.ok(find(page.tree, { className: 'mr-mgroup-head' }).every(head => !find(head, {}).some(node => textOf(node).includes('▸'))),
    'the chevron is drawn in CSS, so the glyph must not also be rendered')

  // The question picker previews the prompt and reports usage.
  assert.match(html, /本次发送的提示词/u)
  assert.match(html, /查看更多题目（11）/u)
  const more = find(page.tree, { hasClick: true, text: '查看更多题目' })[0]
  assert.ok(more.props.className.includes('emphasis'))
  assert.match(html, /使用 1 次/u)
  assert.ok(activeRowText(page.tree).includes('弹跳球'), 'the most recently used question starts selected')

  // The submit bar is sticky and states the reason it cannot start.
  assert.match(html, /class="mr-startbar"/u)
  assert.match(html, /请至少选择一个模型/u)
})

test('a task still executing is taken back into the evaluation page', async () => {
  const pack = openPack()
  const page = await pack.render('evaluation')
  assert.match(page.html, /已接回正在执行的测评任务/u)
  assert.match(page.html, /并排对比回答快照/u)
  assert.match(page.html, /data-count="2"/u, 'two runs render as two columns')
  assert.match(page.html, /已完成 1\/2/u, 'a live task counts only the runs that finished')
  assert.match(page.html, /已用 /u, 'a live run measures elapsed time')
  assert.match(page.html, /DeepSeek Account · deepseek-flash/u, 'the route is shown by the catalog display name')
  assert.match(page.html, /官方右侧栏/u)
})

test('unconfigured and signed-out routes are hidden while historical runs remain visible', async () => {
  const catalog = models.map(group => group.id === 'deepseek-account' ? { ...group, models: [] } : group)
  const pack = loadPack({ api: apiFor({ models: catalog }) })
  const page = await pack.render('evaluation')
  const groups = find(page.tree, { className: 'mr-mgroup' })
  assert.equal(groups.length, 2)
  assert.ok(groups.every(group => !textOf(group).includes('DeepSeek')))
  assert.match(page.html, /DeepSeek Account · deepseek-flash/u, 'historical runs retain their model identity')
  assert.equal(groups[0].props['data-open'], 'true')

  const history = await pack.render('history')
  await history.click({ text: '鹈鹕骑自行车' })
  await history.click({ text: '重跑这次测评' })
  const rerun = await pack.render('evaluation')
  const selected = find(rerun.tree, { className: 'mr-selpill' })
  assert.equal(selected.length, 2, 'rerun only restores the two still available model routes')
  assert.ok(selected.every(pill => !textOf(pill).includes('deepseek')))
  assert.match(rerun.html, /2 个模型当前不可用，已跳过/u)
})

test('a catalog with only unavailable or empty routes shows the setup empty state', async () => {
  const pack = loadPack({ api: apiFor({ models: [models[0], { ...models[1], models: [] }], tasks: [] }) })
  const page = await pack.render('evaluation')
  assert.equal(find(page.tree, { className: 'mr-mgroup' }).length, 0)
  assert.match(page.html, /没有可用模型/u)
  assert.match(page.html, /完成模型服务配置后刷新/u)
})

test('refreshing removes unavailable selections and reveals routes after configuration or sign-in', async () => {
  let catalog = models
  const read = apiFor({ tasks: [] })
  const pack = loadPack({ api: (method, request) => method === 'models' ? catalog : read(method, request) })
  const page = await pack.render('evaluation')
  const checkbox = find(page.tree, { tag: 'input' }).find(node => node.props.type === 'checkbox')
  checkbox.props.onChange()
  catalog = models.map(group => group.id === 'deepseek-account' ? { ...group, models: [] } : group)
  await page.click({ text: '刷新题目与模型' })
  assert.equal(find(page.tree, { className: 'mr-selpill' }).length, 0)
  assert.equal(find(page.tree, { className: 'mr-mgroup' }).length, 2)

  catalog = models.map(group => ({ ...group, selectable: true }))
  await page.click({ text: '刷新题目与模型' })
  assert.equal(find(page.tree, { className: 'mr-mgroup' }).length, 4)
})

test('evaluation selects and starts every available model, and renders every result', async () => {
  const catalog = [{ id: 'many', name: 'Many models', selectable: true,
    models: Array.from({ length: 30 }, (_, index) => ({ id: `model-${index}`, name: `Model ${index + 1}` })) }]
  const read = apiFor({ models: catalog, tasks: [] })
  const pack = loadPack({ api: (method, request) => {
    if (method !== 'start') return read(method, request)
    return { ...tasks[0], id: 'task-many', status: 'succeeded',
      runs: request.models.map((model, index) => ({ ...tasks[0].runs[0], id: `run-${index}`, model })) }
  } })
  const page = await pack.render('evaluation')
  const inputs = find(page.tree, { tag: 'input' }).filter(node => node.props.type === 'checkbox')
  assert.equal(inputs.length, 30)
  for (const input of inputs) input.props.onChange()
  await page.click({ className: 'mr-mgroup-head' })
  assert.equal(find(page.tree, { className: 'mr-selpill' }).length, 30)
  assert.match(page.html, /已选 30 个模型/u)
  await page.click({ className: 'mr-mgroup-head' })
  assert.ok(find(page.tree, { tag: 'input' }).filter(node => node.props.type === 'checkbox').every(node => node.props.checked && !node.props.disabled))
  await page.click({ text: '开始测评 →' })
  // Starting asks first: the selection is repeated back, and nothing is sent
  // until the dialog is answered.
  assert.match(page.html, /开始这次测评？/u)
  assert.match(page.html, /等 30 个/u, 'the dialog repeats the models it is about to call')
  assert.equal(page.calls.filter(call => call.method === 'start').length, 0, 'nothing is sent while the dialog waits')
  await page.click({ text: '确认开始' })
  const start = page.calls.find(call => call.method === 'start')
  assert.equal(start.request.models.length, 30)
  assert.equal(find(page.tree, { className: 'mr-run' }).length, 30)
  assert.match(page.html, /data-count="30"/u)
  assert.equal(textOf(find(page.tree, { className: 'mr-run-letter' })[26]), '27')
  await page.click({ text: '清空' })
  assert.equal(find(page.tree, { className: 'mr-selpill' }).length, 0)
})

test('starting an evaluation asks first and counts the tasks still running', async () => {
  const pack = openPack()
  const page = await pack.render('evaluation')
  const inputs = find(page.tree, { tag: 'input' }).filter(node => node.props.type === 'checkbox')
  assert.equal(inputs.length, 2, 'the first usable route is the expanded one')
  for (const input of inputs) input.props.onChange()
  await page.click({ text: '开始测评 →' })
  assert.match(page.html, /开始这次测评？/u)
  assert.match(page.html, /已有 1 个测评任务进行中（含本页正在查看的这个）/u, 'a task still running is named before a second one starts')
  assert.match(page.html, /不会被打断/u)
  assert.match(page.html, /确认开始/u)
  assert.equal(page.calls.filter(call => call.method === 'start').length, 0, 'nothing is sent while the dialog waits for an answer')
  await page.click({ text: '取消' })
  assert.doesNotMatch(page.html, /开始这次测评？/u)
  assert.equal(page.calls.filter(call => call.method === 'start').length, 0, 'cancelling starts nothing')
})

test('the confirmation leaves out the running-task notice when every task has settled', async () => {
  const pack = loadPack({ api: apiFor({ tasks: [] }) })
  const page = await pack.render('evaluation')
  for (const input of find(page.tree, { tag: 'input' }).filter(node => node.props.type === 'checkbox')) input.props.onChange()
  await page.click({ text: '开始测评 →' })
  assert.match(page.html, /开始这次测评？/u)
  assert.match(page.html, /确认开始/u)
  assert.doesNotMatch(page.html, /测评任务进行中/u, 'no task is described as running when none is')
})

test('answering the confirmation starts the run and says where the earlier task went', async () => {
  const read = apiFor({})
  const pack = loadPack({ api: (method, request) => method === 'start'
    ? { ...tasks[0], id: 'task-new', status: 'running', runs: request.models.map((model, index) => ({ ...tasks[0].runs[0], id: `run-new-${index}`, model })) }
    : read(method, request) })
  const page = await pack.render('evaluation')
  for (const input of find(page.tree, { tag: 'input' }).filter(node => node.props.type === 'checkbox')) input.props.onChange()
  await page.click({ text: '开始测评 →' })
  await page.click({ text: '确认开始' })
  assert.equal(page.calls.filter(call => call.method === 'start').length, 1, 'answering yes sends the run')
  assert.equal(find(page.tree, { className: 'mr-run' }).length, 2, 'the new task replaces the view')
  assert.match(page.html, /正在进行的任务在后台继续，可在「历史任务」中查看/u, 'the page says the other task is still running')
})

test('rerunning a large task restores every still available model', async () => {
  const selection = models.filter(group => group.selectable !== false).flatMap(group =>
    group.models.map(model => ({ provider: group.id, model: model.id, displayName: model.name || model.id })))
  const task = { ...tasks[0], id: 'task-many',
    runs: [...selection, { provider: 'deepseek', model: 'deepseek-chat' }].map((model, index) => ({ ...tasks[0].runs[0], id: `run-${index}`, model })) }
  const pack = loadPack({ api: apiFor({ tasks: [task] }) })
  const history = await pack.render('history')
  await history.click({ className: 'mr-hrow' })
  assert.equal(find(history.tree, { className: 'mr-run' }).length, 11)
  assert.match(history.html, /data-count="11"/u)
  await history.click({ text: '重跑这次测评' })
  const page = await pack.render('evaluation')
  assert.equal(find(page.tree, { className: 'mr-selpill' }).length, 10)
  assert.match(page.html, /预选 10 个模型/u)
  assert.match(page.html, /1 个模型当前不可用，已跳过/u)
})

test('the answer snapshot drawer compares runs and states what the snapshot is', async () => {
  const pack = openPack()
  const page = await pack.render('evaluation')
  await page.click({ text: '并排对比回答快照' })
  assert.match(page.html, /回答快照对比 · /u)
  assert.match(page.html, /快照是运行结束时的记录/u)
  assert.match(page.html, /本次运行没有保存回答快照/u)
  assert.match(page.html, /最少 25 个/u, 'the saved answer text is shown')
})

test('the question drawer keeps active questions first and can reach archived ones', async () => {
  const pack = openPack()
  const page = await pack.render('evaluation')
  await page.click({ text: '查看更多题目' })
  assert.match(page.html, /全部题目/u)
  assert.doesNotMatch(page.html, /一个能跑的世界/u, 'a new run only offers active questions')
  await page.click({ text: '已归档' })
  assert.match(page.html, /一个能跑的世界/u, 'the archived filter reaches the rest of the bank')
  assert.match(page.html, /已归档/u)
})

test('the bank starts from a question handed over by the bank page', async () => {
  const pack = openPack()
  const bank = await pack.render('question-bank')
  await bank.click({ text: '鹈鹕骑自行车 ★' })
  await bank.click({ text: '以此题开始测评' })
  assert.match(bank.html, /已设为下次测评题目/u)
  const evaluation = await pack.render('evaluation')
  assert.match(evaluation.html, /已从题库预选题目/u)
  assert.ok(activeRowText(evaluation.tree).includes('鹈鹕骑自行车'), 'the handed-over question wins over the recent default')
  assert.match(evaluation.html, /要有踩踏动画/u, 'the preview shows the handed-over prompt')
})

test('the bank is one question list on one filter line, with no category filter', async () => {
  const pack = openPack()
  const page = await pack.render('question-bank')
  assert.deepEqual(page.warnings, [])
  assert.match(page.html, /data-tone="violet"/u)
  assert.match(page.html, /题目资产 · 模型博主测评/u)
  assert.match(page.html, /class="mr-stat"/u)
  assert.ok(find(page.tree, { className: 'mr-stat-item' }).map(textOf).join(' ').includes('分类'), 'the stat bar still counts categories')

  // Search, status and sort share one line; category chips are gone.
  assert.equal(find(page.tree, { className: 'mr-toolbar-row' }).length, 1, 'the filters occupy a single row')
  assert.equal(find(page.tree, { className: 'mr-chipbtn' }).length, 0, 'no category chips are rendered')
  assert.equal(find(page.tree, { className: 'mr-chips' }).length, 0)
  assert.match(page.html, /最近更新/u)
  assert.match(page.html, /使用次数/u)

  // The list is the page: no master-detail split, no detail card, no view switch.
  assert.equal(find(page.tree, { className: 'mr-bank' }).length, 0)
  assert.equal(find(page.tree, { className: 'mr-detail' }).length, 0)
  assert.equal(find(page.tree, { className: 'mr-qcard' }).length, 0)
  assert.doesNotMatch(page.html, /题目详情/u)
  assert.doesNotMatch(page.html, /以此题开始测评/u, 'the list itself carries no per-question actions')

  assert.ok(find(page.tree, { className: 'mr-qrow' }).length >= 10, 'every active question is listed')
  assert.doesNotMatch(page.html, /一个能跑的世界/u, 'the default filter is the active bank')

  await page.click({ text: '已归档' })
  const archived = find(page.tree, { className: 'mr-qrow' }).map(textOf).join(' ')
  assert.match(archived, /一个能跑的世界/u, 'the archived filter lists archived questions')
})

test('a question row opens a drawer with its prompt and every action', async () => {
  const pack = openPack()
  const page = await pack.render('question-bank')
  await page.click({ text: '鹈鹕骑自行车 ★' })
  assert.match(page.html, /完整提示词/u)
  assert.match(page.html, /75 字/u, 'the prompt block reports its length')
  assert.match(page.html, /以此题开始测评 →/u)
  assert.match(page.html, /编辑题目/u)
  assert.match(page.html, /归档题目/u)
  assert.match(page.html, /删除题目/u)
  assert.ok(activeRowText(page.tree).includes('鹈鹕骑自行车'), 'the open question stays marked in the list behind the drawer')

  // Editing is the same drawer, and leaving the form comes back to the question.
  await page.click({ text: '编辑题目' })
  assert.match(page.html, /保存修改/u)
  assert.match(page.html, /本次发送给每个模型|提示词会原样发送给每个模型/u)
  await page.click({ text: '取消' })
  assert.match(page.html, /以此题开始测评 →/u, 'cancelling the form returns to the question')
})

test('a question is archived, restored and deleted from its drawer', async () => {
  const pack = bankPack()
  const page = await pack.render('question-bank')

  await page.click({ text: '鹈鹕骑自行车 ★' })
  await page.click({ text: '归档题目' })
  assert.match(page.html, /已归档「鹈鹕骑自行车 ★」/u)
  assert.doesNotMatch(find(page.tree, { className: 'mr-qrow' }).map(textOf).join(' '), /鹈鹕骑自行车/u, 'an archived question leaves the active list')

  await page.click({ text: '已归档' })
  assert.match(find(page.tree, { className: 'mr-qrow' }).map(textOf).join(' '), /鹈鹕骑自行车/u)
  await page.click({ text: '一个能跑的世界' })
  await page.click({ text: '恢复题目' })
  assert.match(page.html, /已恢复「长程题 \| 一个能跑的世界」/u)

  // Delete is irreversible: the drawer asks once before it happens.
  await page.click({ text: '鹈鹕骑自行车 ★' })
  await page.click({ text: '删除题目' })
  assert.match(page.html, /删除后无法恢复/u)
  assert.equal(page.calls.filter(call => call.method === 'deleteQuestion').length, 0, 'nothing is deleted while the drawer asks')
  await page.click({ text: '取消' })
  assert.doesNotMatch(page.html, /删除后无法恢复/u)
  await page.click({ text: '删除题目' })
  await page.click({ text: '确认删除' })
  assert.deepEqual(page.calls.filter(call => call.method === 'deleteQuestion').map(call => call.request.id), ['q-pelican'])
  assert.match(page.html, /已删除「鹈鹕骑自行车 ★」/u)
  assert.doesNotMatch(find(page.tree, { className: 'mr-qrow' }).map(textOf).join(' '), /鹈鹕骑自行车/u, 'a deleted question is gone from the bank')
})

test('the history list summarises every run in one row', async () => {
  const pack = openPack()
  const page = await pack.render('history')
  assert.deepEqual(page.warnings, [])
  assert.match(page.html, /data-tone="cyan"/u)
  assert.match(page.html, /测评档案 · 模型博主测评/u)
  assert.match(page.html, /全部时间/u)
  assert.match(page.html, /耗时最长/u)
  assert.equal(find(page.tree, { className: 'mr-hrow' }).length, tasks.length)
  assert.match(page.html, /用时 /u)
  assert.match(page.html, /无快照/u, 'a task without answers says so instead of printing 0')
  assert.match(page.html, /失败/u)
  assert.match(page.html, /等 4 个/u, 'a four-model task does not list every model twice')
  // The report bar is pinned in CSS next to a list that keeps its own scroll
  // window; the page itself keeps flowing, so nothing here claims the height of
  // the host's scroll container.
  assert.equal(find(page.tree, { className: 'mr-pickbar' }).length, 1)
  assert.match(page.html, /0<\/b><span>已选任务/u)
  assert.doesNotMatch(page.html, /data-fit|data-scroll/u)
  // The list is the box the leftover height is handed to, so the fill hook has to be
  // wired to it: without the ref the page silently falls back to the 482px window.
  const list = find(page.tree, { className: 'mr-bank-list' })[0]
  assert.equal(list.props.ref?.current, null, 'the fill hook is attached to the list (a ref, unset outside a browser)')
})

test('card focus delegates host Session controls without navigating before their action', async () => {
  const focused = []
  const pack = openPack()
  const page = await pack.render('history', { focusSession: id => focused.push(id) })
  await page.click({ text: '鹈鹕骑自行车' })
  const card = find(page.tree, { className: 'mr-run' })[0]
  focused.length = 0
  const ordinary = { target: { closest: () => null } }
  card.props.onPointerDownCapture(ordinary)
  card.props.onFocusCapture(ordinary)
  assert.equal(focused.length, 2)
  assert.ok(focused.every(id => typeof id === 'string' && id.length > 0))
  focused.length = 0
  const hostControl = { target: { closest: selector => selector === '[data-lwb-session-control]' ? {} : null } }
  card.props.onPointerDownCapture(hostControl)
  card.props.onFocusCapture(hostControl)
  assert.deepEqual(focused, [])
})

test('a history row opens the full-width detail with rerun, export and a prominent return button', async () => {
  const pack = openPack()
  const page = await pack.render('history')
  await page.click({ text: '鹈鹕骑自行车' })
  assert.match(page.html, /← 返回历史任务/u)
  const back = find(page.tree, { className: 'mr-back' })[0]
  assert.ok(back.props.className.includes('emphasis'))
  assert.ok(!back.props.className.includes('ghost'))
  assert.match(page.html, /重跑这次测评/u)
  assert.match(page.html, /导出记录/u)
  assert.match(page.html, /data-count="4"/u, 'four runs share the full canvas as a two-by-two grid')
  assert.match(page.html, /1 个模型失败/u)
  assert.match(page.html, /记录 1 个产物/u)
  await page.click({ className: 'mr-back' })
  assert.equal(find(page.tree, { className: 'mr-hrow' }).length, tasks.length)
  assert.equal(find(page.tree, { className: 'mr-back' }).length, 0)
})

test('every page renders inside the pack visual system, in both themes', async () => {
  const pack = openPack()
  for (const name of ['question-bank', 'evaluation', 'history']) {
    const page = await pack.render(name)
    assert.match(page.html, /--mr-brand:#4f46e5/u, `${name} defines the brand token`)
    assert.match(page.html, /body\[data-ds-dark-theme\] \.mr-page\{--mr-brand:#a5b4fc/u, `${name} defines dark tokens`)
    assert.match(page.html, /--mr-on-brand:#0f172a/u, `${name} keeps the brand fill readable in dark mode`)
    assert.match(page.html, /--mr-shadow-sm/u, `${name} uses the shared elevation scale`)
    assert.match(page.html, /\.mr-l1\{/u, `${name} uses the group container layer`)
  }
})

test('the pack never renders a conversation of its own', async () => {
  const pack = openPack()
  const page = await pack.render('evaluation', { renderConversation: () => ({ __el: true, type: 'div', props: { className: 'host-face' }, children: [] }) })
  assert.equal((page.html.match(/host-face/gu) || []).length, 2, 'one host face per run with a Session')
  const html = await (await pack.render('history')).html
  assert.doesNotMatch(html, /mr-run-foot|refreshArtifacts|工作目录 /u)
})

test('the fixtures still describe the shapes the pages were built against', () => {
  assert.equal(questions.length, 12)
  assert.equal(tasks.length, 4)
  assert.ok(tasks.some(task => task.status === 'running'))
  assert.ok(tasks.some(task => task.artifactsUnavailable))
  assert.ok(tasks.some(task => task.runs.some(run => run.status === 'failed')))
})
