/**
 * Write browsable HTML for every pack view, for visual review and screenshots.
 *
 * Run `npm run model-review:preview`, then open `.tooling/model-review-preview/index.html`. Each file is the
 * pack's real markup and real CSS inside a stand-in of the host frame. The frame
 * values that decide width, spacing and colour — the shell design tokens and the
 * capability page container — are **read out of the host bundle** when it is
 * reachable (`LWB_SHELL_BUNDLE`, or this repository's `lwb/dsh-bundle/client.js`),
 * so a screenshot is measured against the real frame rather than a remembered
 * one. Only the parts with no host equivalent (the preview's own navigation
 * strip and its conversation placeholder) are written here. Nothing in this file
 * ships in the pack.
 */
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadPack, find } from './render-harness.mjs'
import { apiFor, tasks } from './preview-data.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', '..', '..', '..', '.tooling', 'model-review-preview')
const SHELL_BUNDLE = process.env.LWB_SHELL_BUNDLE || join(HERE, '..', '..', '..', 'dsh-bundle', 'client.js')

/** Last-resort copy, used only when the host bundle cannot be read. */
const FALLBACK_FRAME = `
  :root{--lwb-text-xs:12px;--lwb-text-sm:13px;--lwb-text-base:14px;--lwb-text-md:15px;--lwb-text-lg:16px;--lwb-text-section:18px;--lwb-text-heading:20px;--lwb-text-title:24px;--lwb-sidebar-width:248px;--lwb-ink:#1d2733;--lwb-muted:#5f6f80;--lwb-line:#e5e9ee;--lwb-page:#f7f9fb;--lwb-surface:#fff;--lwb-blue:#2869d8;--lwb-blue-soft:#edf4ff;--lwb-green:#16865f;--lwb-green-soft:#eaf8f1;--lwb-warm:#b97016;--lwb-warm-soft:#fff5e7;}
  body[data-ds-dark-theme]{--lwb-ink:#edf3f8;--lwb-muted:#a9b7c5;--lwb-line:#334352;--lwb-page:#131c25;--lwb-surface:#1c2733;--lwb-blue:#78adff;--lwb-blue-soft:#203f64;--lwb-green:#5bd0a0;--lwb-green-soft:#173f34;--lwb-warm:#f0b45b;--lwb-warm-soft:#49351c;}
  .lwb-page-capability{width:100%;max-width:none;margin:0;padding:20px clamp(20px,2.4vw,44px) 52px}
`

/**
 * Read the frame rules the pack renders inside.
 *
 * The page container padding decides how much canvas a page really gets, and the
 * tokens decide every colour, so both are taken from the bundle the workbench
 * actually loads.
 * @returns the frame CSS plus where it came from.
 */
async function hostFrame() {
  try {
    const bundle = await readFile(SHELL_BUNDLE, 'utf8')
    const root = bundle.match(/:root \{([^}]*)\}/u)?.[1]
    const dark = bundle.match(/body\[data-ds-dark-theme\] \{([^}]*)\}/u)?.[1]
    const page = bundle.match(/\.lwb-page-capability \{([^}]*)\}/u)?.[1]
    if (!root || !dark || !page) throw new Error('the token or container block was not found in the bundle')
    return { from: SHELL_BUNDLE, css: `:root{${root}}\nbody[data-ds-dark-theme]{${dark}}\n.lwb-page-capability{${page}}` }
  } catch (error) {
    return { from: `built-in copy (${error.message})`, css: FALLBACK_FRAME }
  }
}

/** Chrome with no host equivalent: the preview's own shell around the page. */
const PREVIEW_CHROME = `
  *{box-sizing:border-box}
  html,body{margin:0;height:100%}
  body{display:flex;flex-direction:column;min-height:100%;background:var(--lwb-page);color:var(--lwb-ink);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;font-size:var(--lwb-text-base);line-height:1.55}
  .preview-nav{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--lwb-line);background:var(--lwb-surface);font-size:12px}
  .preview-nav a{color:var(--lwb-muted);text-decoration:none;padding:4px 8px;border:1px solid var(--lwb-line);border-radius:999px}
  .preview-nav a[data-on="true"]{color:var(--lwb-blue);border-color:var(--lwb-blue);background:var(--lwb-blue-soft)}
  .preview-nav button{margin-left:auto;min-height:26px;padding:0 10px;border:1px solid var(--lwb-line);border-radius:6px;background:var(--lwb-surface);color:var(--lwb-ink);font:inherit;font-size:12px;cursor:pointer}
  .preview-shell{display:flex;flex:1;min-height:0;min-width:0;align-items:stretch}
  .preview-sidebar{display:flex;width:var(--lwb-sidebar-width);flex:none;flex-direction:column;gap:8px;padding:18px 12px;border-right:1px solid var(--lwb-line);background:var(--lwb-surface)}
  .preview-sidebar b{font-size:13px}
  .preview-sidebar span{display:block;padding:6px 9px;border-radius:6px;color:var(--lwb-muted);font-size:13px}
  .preview-sidebar span[data-on="true"]{color:var(--lwb-blue);background:var(--lwb-blue-soft);font-weight:700}
  /* The host gives a capability page exactly one scroll container
     (.lwb-overlay-body: flex:1, min-height:0, overflow:auto), and that box is
     what decides whether a page's own footer is on screen. Standing in for it
     here — instead of a shell that always grew to the page's height — is what
     makes a screenshot show the fold. */
  .preview-main{display:block;min-width:0;min-height:0;flex:1;overflow:auto}
  /* The host also renders its own page intro and wraps the pack page in a plain
     div of its own (see documentFor). Both are reproduced, because a page that
     sizes itself against the container's height stops at that wrapper: the pack
     page is two levels down, not one. */
  @media(max-width:680px){.preview-sidebar{display:none}}
  .preview-conversation{display:flex;flex-direction:column;gap:10px;padding:16px;background:var(--lwb-page);color:var(--lwb-muted);font-size:12px}
  .preview-conversation::before{content:"官方对话（宿主下发）：回答、工具调用、文件 chip 与输入框"}
  .preview-conversation::after{content:"";height:60px;border:1px dashed var(--lwb-line);border-radius:8px;background:var(--lwb-surface);margin-top:auto}
`

const frame = await hostFrame()
const SHELL = `${frame.css}\n${PREVIEW_CHROME}`

const manyModels = Array.from({ length: 30 }, (_, index) => ({ id: `model-${index}`, name: `Model ${index + 1}` }))
const manyTask = { ...tasks[0], id: 'task-many', status: 'running', runs: manyModels.map((model, index) => ({
  ...tasks[0].runs[0], id: `run-${index}`, sessionId: `session-${index}`,
  model: { provider: 'many', model: model.id, displayName: model.name },
  ...(index === manyModels.length - 1 ? { status: 'running', completedAt: null } : {}),
})) }

const PAGES = [
  { file: 'evaluation', page: 'evaluation', label: '开始测评', title: '开始测评' },
  { file: 'evaluation-many', page: 'evaluation', label: '开始测评 · 多模型', title: '开始测评（30 个模型）', selectModels: true,
    fixtures: { models: [{ id: 'many', name: 'Models', selectable: true, models: manyModels }], tasks: [manyTask] } },
  { file: 'evaluation-drawer', page: 'evaluation', label: '开始测评 · 全部题目抽屉', title: '开始测评（题目抽屉）', click: { text: '查看更多题目' } },
  { file: 'evaluation-confirm', page: 'evaluation', label: '开始测评 · 启动确认', title: '开始测评（启动确认）', selectModels: 'keep-open', click: { text: '开始测评 →' } },
  { file: 'evaluation-confirm-idle', page: 'evaluation', label: '开始测评 · 无进行中任务确认', title: '开始测评（无进行中任务）', selectModels: 'keep-open', click: { text: '开始测评 →' }, fixtures: { tasks: [] } },
  { file: 'evaluation-compare', page: 'evaluation', label: '开始测评 · 回答快照对比', title: '开始测评（对比抽屉）', click: { text: '并排对比回答快照' } },
  { file: 'question-bank', page: 'question-bank', label: '题库 · 列表', title: '题库' },
  { file: 'question-bank-detail', page: 'question-bank', label: '题库 · 题目抽屉', title: '题库（题目抽屉）', clicks: [{ text: '鹈鹕骑自行车 ★' }] },
  { file: 'question-bank-edit', page: 'question-bank', label: '题库 · 编辑抽屉', title: '题库（编辑题目）', clicks: [{ text: '鹈鹕骑自行车 ★' }, { text: '编辑题目' }] },
  { file: 'question-bank-delete', page: 'question-bank', label: '题库 · 删除确认', title: '题库（确认删除）', clicks: [{ text: '鹈鹕骑自行车 ★' }, { text: '删除题目' }] },
  { file: 'question-bank-archived', page: 'question-bank', label: '题库 · 已归档', title: '题库（已归档）', click: { text: '已归档' } },
  { file: 'history', page: 'history', label: '历史任务 · 列表', title: '历史任务' },
  { file: 'history-live', page: 'history', label: '历史任务 · 进行中详情', title: '历史任务（进行中）', click: { className: 'mr-hrow' } },
  { file: 'history-detail', page: 'history', label: '历史任务 · 四模型详情', title: '历史任务（四个模型）', click: { text: '鹈鹕骑自行车' } },
  // The report feature, end to end: the list with tasks picked, and the document
  // the export actually writes (rendered raw, without the workbench shell).
  { file: 'history-select', page: 'history', label: '历史任务 · 勾选生成报告', title: '历史任务（勾选）', pickAria: ['鹈鹕骑自行车', '长链推理', '地铁熊猫'] },
  { file: 'history-report', label: '测评报告 · 导出件', title: '测评报告', report: ['鹈鹕骑自行车', '长链推理', '地铁熊猫'] },
]

const escapeHtml = value => String(value).replace(/[&<>"]/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character]))

function documentFor(view, body, nav) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>模型博主测评 · ${escapeHtml(view.title)}</title>
<style>${SHELL}</style></head>
<body>
<nav class="preview-nav">${nav}<button type="button" onclick="document.body.toggleAttribute('data-ds-dark-theme')">亮/暗切换</button></nav>
<div class="preview-shell">
  <aside class="preview-sidebar"><b>老傅工作台</b><span>对话</span><span>能力包</span><span data-on="true">模型博主测评</span><span data-on="${view.page === 'question-bank' ? 'true' : 'false'}" style="padding-left:22px">题库</span><span data-on="${view.page === 'evaluation' ? 'true' : 'false'}" style="padding-left:22px">开始测评</span><span data-on="${view.page === 'history' ? 'true' : 'false'}" style="padding-left:22px">历史任务</span><span>设置</span></aside>
  <div class="preview-main"><div class="lwb-page lwb-page-capability">
    <div class="lwb-page-intro"><div><div class="lwb-eyebrow">能力包</div><h1>${escapeHtml(view.title)}</h1><p>宿主自带的页头；能力页用 :has 把它收起</p></div></div>
    <div>${body}</div>
  </div></div>
</div>
</body></html>`
}

const nav = (views, current) => views.map(view => `<a href="./${view.file}.html"${view.file === current ? ' data-on="true"' : ''}>${escapeHtml(view.label)}</a>`).join('')

const pack = loadPack({ api: apiFor({}) })
await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

/**
 * Figures and artifact bodies for the report preview.
 *
 * The numbers are the ones a real 鹈鹕骑自行车 run recorded, which is the same task
 * and the same 19 KB artifact the history fixtures carry. The artifact body is a
 * placeholder — the preview runs on fixtures, not on a machine's run directory —
 * and it animates so that "the report renders the result live" is visible rather
 * than asserted.
 */
const REPORT_STATS = {
  source: 'settle', capturedAt: '2026-10-06T02:00:00.000Z', asOfSeq: 171,
  turns: 1, steps: 28, llmMs: 504282, toolMs: 401396, ttftMs: 81750, ttftSteps: 28, decodeMs: 422532, decodeTokens: 56123,
  tokens: { uncachedInput: 200843, cacheRead: 1409920, cacheWrite: 0, output: 56123 },
  context: { pressureTokens: 74128, contextWindow: 1000000 },
}

/**
 * One run's figures, scaled from the measured baseline.
 *
 * Every fixture run would otherwise carry identical numbers, which reads as a bug
 * in the report rather than as a fixture shortcut — and it would hide exactly what
 * the report exists to show, that the models differ. The factors are arbitrary but
 * fixed, so the preview is stable between runs.
 */
const REPORT_FACTORS = { 'run-a': 1, 'run-b': 0.42, 'run-c': 3.15, 'run-d': 1.6, 'run-e': 0.09, 'run-f': 0.31 }
// Decoding speed is its own axis: scaling tokens and time by one factor would leave
// every model at exactly the same tokens/s and erase the difference being shown.
const REPORT_SPEED = { 'run-a': 1, 'run-b': 1.9, 'run-c': 0.55, 'run-d': 1.25, 'run-e': 2.6, 'run-f': 0.7 }
const statsFor = runId => {
  const factor = REPORT_FACTORS[runId] ?? 1
  const speed = REPORT_SPEED[runId] ?? 1
  const scale = value => Math.max(0, Math.round(value * factor))
  return {
    ...REPORT_STATS,
    asOfSeq: scale(REPORT_STATS.asOfSeq) || 1,
    steps: Math.max(1, scale(REPORT_STATS.steps)),
    llmMs: scale(REPORT_STATS.llmMs),
    toolMs: Math.round(REPORT_STATS.toolMs * factor * 0.6),
    decodeMs: Math.max(1, scale(REPORT_STATS.decodeMs * speed)),
    decodeTokens: scale(REPORT_STATS.decodeTokens * 1.1),
    tokens: {
      uncachedInput: scale(REPORT_STATS.tokens.uncachedInput),
      cacheRead: scale(REPORT_STATS.tokens.cacheRead),
      cacheWrite: 0,
      output: scale(REPORT_STATS.tokens.output * 1.1),
    },
    context: { pressureTokens: scale(REPORT_STATS.context.pressureTokens), contextWindow: REPORT_STATS.context.contextWindow },
  }
}
const REPORT_ARTIFACT = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#0d1420;color:#cfe3ff;font:14px/1.6 -apple-system,"PingFang SC",sans-serif}
.g{position:absolute;inset:0;background:radial-gradient(60% 60% at 50% 40%,#17324f,transparent 70%)}
.b{position:absolute;left:12%;top:58%;width:76%;height:8px;border-radius:4px;background:#1f3b5c}
.w{position:absolute;top:calc(58% - 34px);width:68px;height:68px;border-radius:50%;border:5px solid #7cc4ee}
.w.l{left:14%}.w.r{right:14%}
.w::after{content:"";position:absolute;inset:24px;border-radius:50%;background:#7cc4ee;transform-origin:center}
.w{animation:spin 2s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.p{position:absolute;left:38%;top:26%;width:24%;height:34%;border-radius:44% 46% 40% 40%;background:#f4f7fb;animation:bob 1s ease-in-out infinite}
.p::after{content:"";position:absolute;right:-38%;top:26%;width:52%;height:16%;border-radius:0 8px 8px 0;background:#f0a03c}
@keyframes bob{50%{transform:translateY(-6px)}}
.t{position:absolute;left:0;right:0;bottom:10px;text-align:center;color:#6f8bab;font-size:12px}
</style></head><body><div class="g"></div><div class="b"></div><div class="w l"></div><div class="w r"></div><div class="p"></div>
<div class="t">预览夹具产物 · 报告内实时渲染，非截图</div></body></html>`

const summary = []
for (const view of PAGES) {
  if (view.report) {
    // The export itself: select tasks, build the document, write it verbatim.
    const report = loadPack({ api: async (method, request) => {
      if (method === 'stats') {
        // The fixtures include runs recorded before per-run sessions existed, so the
        // preview shows the "there is no session to read" case beside the real ones
        // rather than a page of identical numbers.
        const run = tasks.flatMap(task => task.runs).find(item => item.id === request.runId)
        if (!run || run.sessionId === null) return { stats: null, reason: 'no-session' }
        return { stats: statsFor(request.runId), reason: null }
      }
      if (method === 'artifact') return { path: request.path, bytes: Buffer.byteLength(REPORT_ARTIFACT), text: REPORT_ARTIFACT }
      return apiFor({})(method, request)
    } })
    const page = await report.render('history')
    for (const aria of view.report) await page.change({ className: 'mr-pick', aria })
    await page.click({ text: '在工作台内查看' })
    const document = report.blobs.at(-1)
    if (!document) throw new Error('the report preview produced no document')
    await writeFile(join(OUT, `${view.file}.html`), document, 'utf8')
    summary.push(`${view.file.padEnd(22)} ${String(document.length).padStart(6)} chars  (导出件原文，未套外壳)  warnings=${page.warnings.length}`)
    for (const warning of page.warnings) summary.push(`  ! ${warning}`)
    continue
  }
  const page = await (view.fixtures ? loadPack({ api: apiFor(view.fixtures) }) : pack).render(view.page)
  if (view.selectModels) {
    for (const input of find(page.tree, { tag: 'input' }).filter(node => node.props.type === 'checkbox')) input.props.onChange()
    // 'keep-open' leaves the expanded route expanded: a confirmation view has to
    // show the same selection the person sees on the page behind it.
    if (view.selectModels !== 'keep-open') await page.click({ className: 'mr-mgroup-head' })
  }
  for (const aria of view.pickAria || []) await page.change({ className: 'mr-pick', aria })
  for (const click of view.clicks || (view.click ? [view.click] : [])) await page.click(click)
  const file = join(OUT, `${view.file}.html`)
  await writeFile(file, documentFor(view, page.html, nav(PAGES, view.file)), 'utf8')
  summary.push(`${view.file.padEnd(22)} ${String(page.html.length).padStart(6)} chars  warnings=${page.warnings.length}`)
  for (const warning of page.warnings) summary.push(`  ! ${warning}`)
}
const index = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>模型博主测评 · 预览索引</title><style>${SHELL}</style></head>
<body style="display:block"><div class="lwb-page"><h1>模型博主测评 · 预览</h1><ul>${PAGES.map(view => `<li><a href="./${view.file}.html">${escapeHtml(view.label)}</a></li>`).join('')}</ul></div></body></html>`
await writeFile(join(OUT, 'index.html'), index, 'utf8')
console.log(`preview written to ${OUT}`)
console.log(`frame values read from: ${frame.from}`)
console.log(summary.join('\n'))
