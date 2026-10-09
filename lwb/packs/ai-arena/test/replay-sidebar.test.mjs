/**
 * 离线回放 / MP4 侧栏的几何契约：本手发言与回合记录不再互相压。
 *
 * 守住的成因（8 人横屏每一帧都在发生）：`.narrative` 里两个 flex 项的弹性角色设反了 ——
 * `.speech{flex:1}` 的 basis 是 0，只拿到「剩余空间」（8 人局实测 23px），而
 * `.recent{flex:0 1 auto}` 按内容拿满 151px；两者又都不裁剪，于是 222px 高的发言卡从
 * 23px 的盒子里溢出来。狼人杀还给发言加了 justify-content:center，溢出上下对半：
 * 往上盖住身份榜最后 2—3 行、往下盖住回合记录前两条。
 *
 * 现在：叙事区是两行栅格（发言 auto / 记录 1fr，记录有 66px 下限），两块都 overflow:hidden。
 * 发言的行数上限由人数给（--ww-lines），身份榜在横屏改两列把高度让出来。
 * 观战页没有 DOM 测试，这里读的是真源码：样式是真契约，预算按像素算一遍。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CSS = await readFile(join(HERE, '..', 'replay', 'scene.css'), 'utf8')
const MARKUP = await readFile(join(HERE, '..', 'replay', 'markup.mjs'), 'utf8')

/* 只认行首的规则：`.recent{` 会命中 `.narrative .recent{`，那样断言会读错规则。 */
const rule = selector => {
  const found = CSS.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\{([^}]*)\\}`, 'u'))
  assert.ok(found, `scene.css 里找不到规则：${selector}`)
  return found[1]
}
const px = (text, pattern, label) => {
  const found = text.match(pattern)
  assert.ok(found, `scene.css 缺少 ${label}`)
  return Number(found[1])
}

test('叙事区是两行栅格：发言按内容拿高度，记录吃剩下的并兜住下限', () => {
  const narrative = rule('.narrative')
  assert.match(narrative, /display:grid/u, '叙事区必须是栅格：flex 下「谁拿剩余空间」会把发言挤成一条')
  assert.match(narrative, /grid-template-rows:minmax\(0,auto\) minmax\(66px,1fr\)/u, '发言 auto、记录 1fr 且带 66px 下限')
  assert.match(rule('.narrative .speech'), /grid-row:1/u)
  assert.match(rule('.narrative .recent'), /grid-row:2/u)
  assert.match(rule('.narrative .finale'), /grid-row:1\/-1/u, '终局卡占满叙事区')
  /* 两块都必须自己裁剪：溢出的内容不许画到别人的行上。 */
  assert.match(rule('.narrative .speech'), /overflow:hidden/u)
  assert.match(rule('.recent'), /overflow:hidden/u)
  assert.match(rule('.narrative .recent'), /max-height:100%/u)
  assert.match(rule('.narrative .recent'), /align-self:end/u, '记录仍贴着叙事区底部')
  /* 记录不够高时从最旧一条裁，底部渐隐说明「还有更多」，不是拦腰切断。 */
  assert.match(rule('.rlist'), /mask-image:linear-gradient/u)
  /* 发言不能再是「只拿剩余空间」的那个。 */
  assert.doesNotMatch(rule('.speech'), /flex:1\b/u)
  assert.doesNotMatch(rule('.recent'), /flex:0 1 auto/u)
})

test('发言行数按人数钳制，且两条路径同一套（不再只有离线播放器有钳制）', () => {
  const text = rule('.narrative .sinner p')
  assert.match(text, /-webkit-line-clamp:var\(--ww-lines,5\)/u, '行数上限要读 --ww-lines')
  assert.match(text, /overflow:hidden/u)
  assert.equal(px(CSS, /\.stage\[data-game="werewolf"\]\{[^}]*--ww-lines:(\d+)/u, '狼人杀默认行数'), 5)
  assert.equal(px(CSS, /\.stage\[data-game="werewolf"\]\[data-seats="9"\]\{--ww-lines:(\d+)\}/u, '9 人行数'), 4)
  assert.equal(px(CSS, /\.stage\[data-layout="portrait"\]\{--ww-lines:(\d+)\}/u, '竖屏行数'), 4)
  /* 选择器必须能命中视频侧：markup.mjs 产出的 <p> 没有 id，从前 MP4 完全不钳制。 */
  assert.doesNotMatch(CSS, /#text\{/u, '钳制不能再挂在 #text 上')
  assert.match(MARKUP, /class="sinner"/u)
  assert.ok(MARKUP.includes('<p style="font-size:${stepSize'), '视频侧的发言正文仍在 .sinner 内')
})

test('横屏身份榜改两列，且模型名必须完整（同供应商的 max / flash 只差后缀）', () => {
  const score = rule('.stage[data-game="werewolf"]:not([data-layout="portrait"]) .score')
  assert.match(score, /display:grid/u)
  assert.match(score, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/u)
  /* 胜 / 负 徽标改绝对定位：它进流会把长名挤成省略号。 */
  assert.match(rule('.stage[data-game="werewolf"]:not([data-layout="portrait"]) .pcard .bd'), /position:absolute/u)
  assert.match(rule('.stage[data-game="werewolf"]:not([data-layout="portrait"]) .pcard'), /padding:0 24px 0 8px/u)
  /* 一行放得下 `deepseek-v4.1-flash`：13px / 700 实测 132.7px（PingFang SC 一档），
     单元格内容宽 = 侧栏 − 边框 − 内边距 − 列间距，再减掉 logo / 徽记 / 三个 6px 间距。 */
  const side = px(CSS, /\.stage\[data-game="werewolf"\] \.side\{flex:none;width:(\d+)px\}/u, '狼人杀侧栏宽度')
  const cell = (side - 2 - 2 * px(CSS, /--pad:(\d+)px/u, '侧栏内边距') - 8) / 2
  const name = cell - 24 - 8 - 20 - 6 - 18 - 6
  assert.ok(name >= 132.7 + 8, `模型名可用宽度 ${name}px，放不下 132.7px 的名字加余量`)
  /* 竖屏同样是三列 + 徽标进流：徽标也要让位，否则终局那一帧的长名被截。 */
  assert.match(rule('.stage[data-game="werewolf"][data-layout="portrait"] .pcard'), /padding:0 24px 0 8px/u)
  assert.match(rule('.stage[data-game="werewolf"][data-layout="portrait"] .pcard .bd'), /position:absolute/u)
  /* 竖屏没有回合记录，叙事区回到单行，发言卡仍旧垂直居中。 */
  assert.match(rule('.stage[data-layout="portrait"] .narrative'), /grid-template-rows:minmax\(0,1fr\)/u)
})

test('高度预算：发言的字形框装得进叙事区，记录吃剩下的（6 / 8 / 9 人）', () => {
  /* 1280×720 是离线回放与视频的画幅。常数取自 scene.css 与无头 Chrome 实测：
     侧栏 720 − 上下 20 边距 − 边框 1.5*2 − 内边距；顶部三段（抬头 / 执行者卡 / 进度）
     是这套布局里不参与让位的部分——执行者卡因为要放形象，已由 79px 长到 112px。 */
  const canvas = 720
  const content = canvas - 40 - 2 - 2 * px(CSS, /--pad:(\d+)px/u, '侧栏内边距')
  const gap = px(CSS, /\.side\{[^}]*gap:(\d+)px/u, '侧栏纵向间距')
  const fixed = 23 + 112 + 45 // 抬头 / 执行者卡（实测 112，形象 66×86 + 上下内边距）/ 进度
  const rowGap = 8
  const cardH = 26
  const recent = 66                                    // 记录行的下限
  /* 发言的字形框：上内边距 14 + 署名 26 + 间距 8 + 行数 × 行高 34.5（23px 字 × 1.5，实测）。
     行高比字号多出的 11.5px 是行距，落在字形下方，可以被裁掉而不切到字。 */
  const padTop = 14, shead = 26, textGap = 8, lineH = 34.5, leading = 11.5
  const board = rows => rows * cardH + (rows - 1) * rowGap
  const cases = [[6, 3, 5], [8, 4, 5], [9, 5, 4]]
  for (const [seats, rows, lines] of cases) {
    const narrative = content - fixed - 4 * gap - board(rows)
    const speech = narrative - 14 - recent
    const glyphs = padTop + shead + textGap + lines * lineH
    assert.ok(glyphs <= speech + leading,
      `${seats} 人局：发言字形框 ${glyphs}px 超过发言盒 ${speech}px 太多，最后一行会被切到字`)
    /* 记录必须拿到它 66px 的下限，剩下的才是发言的；两者相加不能超过叙事区。 */
    assert.ok(speech + 14 + recent <= narrative + 1, `${seats} 人局：发言 + 间距 + 记录超过叙事区`)
    assert.ok(narrative - (speech + 14 + recent) >= -1, `${seats} 人局预算为负`)
  }
})

test('执行者卡三档高度契约：横屏/标准竖屏 112—114px，象棋竖屏紧凑档保持 84px', async () => {
  /* 档位由 `presentation.isCompactTurn` 按「游戏 × 画幅」一次性定下，不按每手字幕长短动态判断，
     否则卡片高度会跟着发言长短跳。实测（无头 Chrome，720×1280 / 1280×720）：
       五子棋横  114、五子棋竖 112、象棋横 114、象棋竖 84、狼人杀横 112、狼人杀竖 112。 */
  const { isCompactTurn } = await import('../presentation.mjs')
  assert.equal(isCompactTurn('xiangqi', 'portrait'), true)
  assert.equal(isCompactTurn('xiangqi', 'landscape'), false)
  assert.equal(isCompactTurn('gomoku', 'portrait'), false)
  assert.equal(isCompactTurn('werewolf', 'portrait'), false)
  /* 标准档：内边距（横屏 13/11、竖屏 12）+ 形象 86 恰好压在 min-height 之内。
     `.turn` 有两条规则（基础版与高度版），这里查整份 CSS 而不是第一条。 */
  assert.match(CSS, /(?:^|\n)\.turn\{min-height:112px\}/u)
  assert.match(rule('.turn-figure'), /width:66px;height:86px/u)
  /* 紧凑档：不设 min-height，形象缩到 46×58 并落在卡片右侧。 */
  assert.match(CSS, /(?:^|\n)\.turn\[data-compact="true"\]\{min-height:0\}/u)
  assert.match(rule('.turn[data-compact="true"] .turn-figure'), /width:46px;height:58px/u)
  assert.match(rule('.turn[data-compact="true"] .turn-figure'), /margin-left:auto/u)
  /* 只有人物、没有底板：形象这一格不许有背景色或圆角卡片，否则又会变成一块黑底。 */
  const figure = rule('.turn-figure')
  assert.doesNotMatch(figure, /background/u)
  assert.doesNotMatch(figure, /border-radius/u)
  /* 本手没有发言时 logo 就是这一格的主标：位置与大小换成 52px 口径，盒子仍然占位。 */
  assert.match(rule('.turn-figure[data-quiet="true"] .turn-mark'), /width:52px;height:52px/u)
})

test('执行者卡的形象只在本手有发言时出现，且卡片高度与有没有形象无关', async () => {
  const { readFile } = await import('node:fs/promises')
  const markup = await readFile(join(HERE, '..', 'replay', 'markup.mjs'), 'utf8')
  /* 逐手条件：两个游戏路径都要拿到「本手发言」，缺一个就会在没发言的手上也画人。 */
  assert.match(markup, /speaks: Boolean\(player\) && Boolean\(String\(speech \|\| ''\)\.trim\(\)\)/u, '棋类缺少逐手条件')
  assert.match(markup, /const speaks = Boolean\(String\(body \|\| ''\)\.trim\(\)\) && Boolean\(actor\)/u, '狼人杀缺少逐手条件')
  /* 终局与开局不画人：狼人杀的终局卡根本没传 player，棋类的 speaks 为假。 */
  assert.match(markup, /phase: 'finale', t, animate, compact/u)
  /* 同高占位：两态都渲染 .turn-figure，只有 data-quiet 与里面有没有 <img class="turn-face"> 不同。 */
  assert.match(markup, /data-quiet="true"/u)
  /* 离线播放器与视频侧必须同一套口径，否则同一场比赛两处画面不一样。 */
  const app = await readFile(join(HERE, '..', 'replay', 'app.js'), 'utf8')
  assert.match(app, /turnFigure\.dataset\.quiet/u, '离线播放器没有同步形象')
  assert.match(app, /S\.isCompactTurn\(D\.game\.id, stage\.dataset\.layout\)/u, '离线播放器没有用同一份档位判据')
  assert.match(app, /slice\(-3, -1\)/u, '离线播放器的回合记录没有跟着让位（3 条 → 2 条）')
  /* 离线播放器有两个作用域都叫 `last`：顶层是播放器的时间戳，两个渲染函数里是本手。
     晚声明会被外层的时间戳顶替，`last.s` 静默变成 undefined —— 形象永远画不出来且不报错
     （实测就是这样漏掉狼人杀那条路径的）。这里守住「本手必须先声明」。 */
  const bodyOf = name => {
    const start = app.indexOf(`function ${name}(`)
    assert.ok(start > 0, `app.js 缺少 ${name}`)
    let depth = 0, index = app.indexOf('{', start)
    const from = index
    for (; index < app.length; index += 1) {
      if (app[index] === '{') depth += 1
      else if (app[index] === '}') { depth -= 1; if (depth === 0) break }
    }
    return app.slice(from, index)
  }
  for (const [fn, use] of [['renderWolf', 'wolfSpeaks'], ['render', 'speaks:']]) {
    const body = bodyOf(fn)
    const declared = body.indexOf('const last = index >= 1 ? D.moves[index - 1] : null')
    const used = body.indexOf(use)
    assert.ok(declared > 0, `${fn} 没有取本手（const last）`)
    assert.ok(used > 0, `${fn} 没有用到本手`)
    assert.ok(declared < used, `${fn} 里本手晚于使用处声明：会被外层播放器的同名时间戳 last 顶替`)
  }
})
