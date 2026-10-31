import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'

test('browser client exports a loadable DSH module without global CommonJS variables', async () => {
  let plugin
  const window = {
    __ModuleLoader__: {
      load({ id, factory }) {
        assert.equal(id, '@scitiger-ai/lwb-model-review')
        plugin = factory((name) => {
          if (name === 'react') return { createElement() {} }
          throw new Error(`Unexpected browser dependency: ${name}`)
        })
      },
    },
  }
  vm.runInNewContext(await readFile(new URL('../client.js', import.meta.url), 'utf8'), { window })
  assert.deepEqual(Array.from(plugin.inject), ['connection', 'lwbPackClient'])
  assert.equal(typeof plugin.apply, 'function')
})

test('browser client shows each model through the host conversation face', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  // The page arranges host faces; it neither renders a conversation itself nor
  // navigates the shell's own conversation module.
  assert.ok(source.includes('renderConversation({ sessionId: run.sessionId })'), 'the real conversation is rendered per run')
  assert.ok(source.includes('function RunCard({ task, run, renderConversation, focusSession, onFocus, active })'))
  assert.ok(source.includes('function Evaluation({ renderConversation, focusSession })'))
  assert.ok(source.includes('function History({ renderConversation, focusSession })'))
  assert.doesNotMatch(source, /openSessionSurface|sessionSurface|renderSlot|executionPage|followExecution|SessionProvider|renderArtifacts/u)
})

test('browser client focuses the card in use so the official right Sidebar follows it', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  assert.ok(source.includes('onPointerDownCapture: focus, onFocusCapture: focus'), 'any interaction in a card focuses it')
  assert.ok(source.includes('focusSession?.(run.sessionId)'), 'focusing goes through the host')
  assert.ok(source.includes('function useAutoFocus(task, focusSession)'), 'the first run with a Session is focused once per task')
  assert.ok(source.includes("focusSession(run.sessionId)"), 'auto-focus uses the same host call')
  assert.ok(source.includes("data-active': active ? 'true' : 'false'"), 'the focused card is marked')
  assert.ok(source.includes('官方右侧栏'), 'the page says where artifacts are viewed')
})

test('browser client keeps every run attributable to its own directory', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /工作目录 /u, 'a run directory is not printed under every card')
  // The run directory and the manual "rescan it" control are both gone: a run's
  // files are read in the official right Sidebar, scoped to its own Session.
  assert.doesNotMatch(source, /mr-run-foot|refreshArtifacts|刷新产物记录|记录中…/u, 'no manual artifact-rescan control is offered')
  assert.ok(source.includes('独立工作目录引入之前'), 'legacy tasks without per-run directories say so')
  assert.ok(source.includes('记录 ${recorded.length} 个产物'), 'the stored record is labelled as a record, not as live state')
  assert.ok(source.includes('这条历史任务没有保存会话标识，无法回看对话过程。'))
})

test('browser client takes the newest executing task back after the page is remounted', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  // The host unmounts this page on every menu switch, so the page cannot keep the
  // task in component state; it reads back the one that is still executing.
  assert.ok(source.includes("api('tasks')"), 'the page reads the host task list when it mounts')
  assert.ok(source.includes("['running', 'queued'].includes(item.status)"), 'only a task still executing is taken back')
  assert.ok(source.includes('setTask(previous => previous || running)'), 'a task started meanwhile is never overwritten')
  assert.ok(source.includes('已接回正在执行的测评任务'), 'the page says the task was taken back instead of pretending it is new')
})

test('the setup panel is a grouped, dense picker with a sticky submit bar', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  // The old shape — one flat four-column grid of 124px cards — is gone.
  assert.doesNotMatch(source, /mr-model-grid|mr-model-content|mr-question-picker|mr-master|mr-item\b/u)
  assert.match(source, /function ModelPicker\(\{ groups, selected, onToggle, onClear \}\)/u)
  assert.match(source, /function QuestionPicker\(\{ questions, usage, value, onChange, onEdit, onOpenBank \}\)/u)
  assert.match(source, /function QuestionDrawer\(\{ questions, usage, value, onPick, onClose \}\)/u)
  assert.match(source, /filter\(group => group\.selectable !== false && group\.models\?\.length > 0\)/u, 'unavailable and empty routes are hidden')
  assert.match(source, /\.mr-startbar\{position:sticky;bottom:0/u, 'the submit bar stays on screen')
  assert.match(source, /\.mr-mrow\{[^}]*min-height:34px/u, 'a model is one dense row')
})

test('the history report bar is pinned and the list eats the leftover height', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  // The bar is pinned exactly like the evaluation page's submit bar — the one
  // arrangement already proven on every window size: pin to whatever scrolls, and
  // let the page keep flowing. Pinning is only half of it though: `bottom:0` pulls an
  // element back into view, it never pushes one down, and the list's whole-row window
  // (482px) makes the page shorter than a tall window, so the bar used to hang
  // mid-air with the rest of the window blank underneath it. The other half is
  // measured: the list takes the leftover height of the host's scroll viewport, and
  // `--mr-list-fill` is that number.
  //
  // The page still never owns the host container's height: it is mounted two levels
  // below `.lwb-page-capability` (the host inserts a plain wrapper div of its own), so
  // a percentage chain stops at that wrapper and collapses the list onto its floor.
  // The leftover is read from the box that actually scrolls, never inherited.
  assert.match(source, /\.mr-pickbar\{[^}]*position:sticky;bottom:0/u, 'the report bar stays on screen')
  assert.match(source, /\.mr-startbar\{position:sticky;bottom:0/u, 'the bar it copies still does too')
  assert.match(source, /\.mr-bank-list\{--mr-list-floor:482px[^}]*max-height:max\(var\(--mr-list-floor\),var\(--mr-list-fill,0px\)\)[^}]*min-height:max\(300px,var\(--mr-list-fill,0px\)\)/u,
    'the list keeps its whole-row window as the floor and takes the measured leftover as its ceiling')
  assert.match(source, /@media\(max-width:1100px\)\{\.mr-bank-list\{--mr-list-floor:422px\}/u, 'a narrow window keeps its own whole-row floor')
  // The fill is measured off the element tree, so it survives a shell change; a host
  // class name here would silently stop working the day the shell changes.
  assert.match(source, /overflowY === 'auto' \|\| overflowY === 'scroll'/u, 'the fill finds the scroll viewport by walking up for what scrolls')
  assert.doesNotMatch(source, /lwb-overlay-body/u, 'the fill never names the host scroll container')
  assert.match(source, /setProperty\('--mr-list-fill'/u, 'the fill is written as a custom property, not a fixed height')
  // The list is not there on the first render (the page opens on a loading skeleton), and
  // it is gone again whenever a filter matches nothing: a resize watcher attached once at
  // mount would watch nothing, and a resized window would keep the stale number.
  assert.match(source, /\}, \[listKey\]\)/u, 'the resize watcher follows the list, which comes and goes')
  assert.doesNotMatch(source, /\.mr-page[^{]*\{[^}]*height:100%/u, 'no percentage-height chain through the host wrapper')
})

test('the run area compares models instead of only listing them', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  assert.match(source, /function RunSummaryBar\(\{ task, onCompare \}\)/u)
  assert.match(source, /function AnswerCompareDrawer\(\{ task, onClose \}\)/u)
  assert.match(source, /快照是运行结束时的记录/u, 'the snapshot is described as a record, not live state')
  assert.match(source, /\.mr-run-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/u, 'any multi-model task uses two desktop columns')
  assert.match(source, /runDurationText/u, 'each run reports its own time')
  assert.match(source, /answerChars/u, 'each run reports the size of its answer')
})

test('each page carries its own tone inside one visual system', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  assert.match(source, /tone: 'violet', kicker: '题目资产 · 模型博主测评'/u)
  assert.match(source, /tone: 'orange', kicker: '并行测评 · 模型博主测评'/u)
  assert.match(source, /tone: 'cyan', kicker: '测评档案 · 模型博主测评'/u)
  assert.match(source, /\.mr-page\[data-tone="violet"\]/u)
  assert.match(source, /\.mr-l1\{border:1px solid var\(--lwb-line\);border-radius:10px/u, 'groups are a layer above cards')
  assert.match(source, /\.mr-sec-title::before/u, 'a section title is marked with its page tone')
  assert.match(source, /body\[data-ds-dark-theme\] \.mr-page\{--mr-brand:#a5b4fc/u, 'dark mode re-tunes the palette')
})

test('the bank is one list whose actions all live in the question drawer', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  // The master-detail split, the card view and the category chips are gone: the
  // page is a list, and a row opens the question's own drawer.
  assert.doesNotMatch(source, /\.mr-bank\{|mr-cardgrid|mr-qcard|mr-chipbtn|mr-chips|mr-detail-head|mr-qrow-actions/u)
  assert.match(source, /function QuestionFilters\(\{ query, setQuery, status, setStatus, statusOptions, children \}\)/u, 'the filters are one line')
  assert.match(source, /function QuestionDetailDrawer\(\{ question, usage, busy, deleting, confirming, error, onClose, onEdit, onStart, onArchive, onRestore, onAskDelete, onCancelDelete, onDelete \}\)/u)
  assert.match(source, /className: 'mr-toolbar-row' \},\r?\n\s+h\('input', \{ className: 'mr-input', 'aria-label': '搜索题目'/u, 'search, status and sort share the row')
  // Archive, restore, delete and "start from this question" are drawer actions.
  assert.match(source, /await api\('deleteQuestion', \{ id: question\.id \}\)/u)
  assert.match(source, /删除后无法恢复/u)
  assert.match(source, /\.mr-danger-note\{margin-right:auto/u)
})

test('the bank and the history list hand work to the next page', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  assert.match(source, /const setPending = \(questionId, models, source\)/u)
  assert.match(source, /以此题开始测评 →/u)
  assert.match(source, /重跑这次测评/u)
  assert.match(source, /导出记录/u)
  assert.match(source, /function History\(\{ renderConversation, focusSession \}\)/u)
  // The list and a single task detail are two states of one page, not a
  // narrow master-detail split that squeezed four conversations into one column.
  assert.match(source, /const detailPanel = !detail \? null :/u)
  assert.match(source, /← 返回历史任务/u)
})

test('starting a run is a question the page asks, not a click it obeys', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  // Starting calls every selected model, records usage and leaves any earlier
  // task running; the click therefore has to be answerable.
  assert.match(source, /function ConfirmDialog\(\{ title, description, notice, summary, confirmLabel, onResult, opener \}\)/u)
  assert.match(source, /function useConfirm\(\)/u)
  assert.match(source, /if \(pending\.current\) return Promise\.resolve\(false\)/u, 'a second request never stacks a second dialog')
  assert.match(source, /const answered = await confirm\(\{/u, 'the start path waits for the answer')
  assert.match(source, /if \(!answered\) return;/u, 'cancelling starts nothing')
  assert.match(source, /title: '开始这次测评？'/u)
  assert.match(source, /confirmLabel: '确认开始'/u)
  assert.match(source, /已有 \$\{live\.length\} 个测评任务进行中/u, 'a task still running is named in the dialog')
  assert.match(source, /const live = liveTasks\(known\)/u, 'the count comes from the host task list, read again at click time')
  assert.match(source, /正在进行的任务在后台继续，可在「历史任务」中查看/u, 'the started notice says where the other task went')
  // The same way out the arena offers: Escape, the × and 取消. The backdrop does
  // not dismiss, or the second click of a double click would answer "no".
  assert.match(source, /if \(event\.key === 'Escape'\) \{ onResult\(false\); return; \}/u)
  assert.match(source, /button:not\(:disabled\)/u, 'Tab is kept inside the dialog')
  assert.match(source, /className: 'mr-confirm-backdrop', 'aria-hidden': true \}/u, 'the backdrop is inert')
  assert.match(source, /'aria-label': title, tabIndex: -1, ref: card/u, 'the dialog takes focus and names itself')
  // The dialog sits above the drawer stack (90/91), because the drawer that
  // handed the question over can still be open behind it.
  assert.match(source, /\.mr-confirm-backdrop\{[^}]*z-index:100/u)
  assert.match(source, /\.mr-confirm\{[^}]*z-index:101/u)
})
