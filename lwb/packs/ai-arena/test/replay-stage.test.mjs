/**
 * 离线回放 / MP4 席位舞台的几何契约：终局胜负卡不许压住席卡。
 *
 * 守住的成因（9 人局横竖屏都在发生）：胜负卡 `.ww-win` 是绝对定位 + `top:50%`，
 * 飘在画面正中；而 8 / 9 人是两行席卡，条带底边在 `bottom:22px`、两行 332px 高，
 * 顶边落在 y=366（720 画幅），胜负卡（y 282—437）正好压住第一排第 2—4 席的脸。
 * 6 人局只有一行（顶边 y=517）所以看不出来 —— 这是 8 / 9 人档位带出来的回归。
 *
 * 现在舞台与观战页同一套「安全区契约」：抬头 → 主持人播报（终局换成胜负卡）→ 留白 → 条带，
 * 每段都在布局流里；条带高度按行数取（--ww-band / --ww-rows），席卡吃行高。
 * 观战页那份契约由 `werewolf-stage.test.mjs` 守住，这里守离线回放 / MP4 这一份 ——
 * 两条渲染链路各自有一份几何，谁都不许再退回绝对定位。
 *
 * 离线回放没有 DOM 测试，所以这里读真源码算像素：样式是真契约，预算按实测值算一遍。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CSS = await readFile(join(HERE, '..', 'replay', 'scene.css'), 'utf8')
const MARKUP = await readFile(join(HERE, '..', 'replay', 'markup.mjs'), 'utf8')
const APP = await readFile(join(HERE, '..', 'replay', 'app.js'), 'utf8')
const DATA = await readFile(join(HERE, '..', 'replay', 'data.mjs'), 'utf8')
const rule = selector => {
  const found = CSS.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\{([^}]*)\\}`, 'u'))
  assert.ok(found, `scene.css 里找不到规则：${selector}`)
  return found[1]
}
const number = (text, pattern, label) => {
  const found = text.match(pattern)
  assert.ok(found, `scene.css 缺少 ${label}`)
  return Number(found[1])
}

test('胜负卡在布局流里，占主持人那一格，不再绝对定位飘在画面正中', () => {
  const win = rule('.ww-win')
  assert.match(win, /position:relative/u, '胜负卡必须参与布局流：绝对定位只对 6 人局成立')
  assert.match(win, /flex:none/u, '胜负卡不参与压缩：可收缩的只能是席位条带')
  assert.match(win, /align-self:center/u, '横向上仍居中（与观战页同一个观感）')
  assert.match(rule('.stage[data-act="finale"] .ww-win'), /display:flex/u)
  /* 位移已经进流：舞台这四大块里不再有「居中的绝对定位」这回事。
     （席卡内部的红叉 `.ww-strike`、票型标记与身份榜的胜 / 负徽标仍是绝对定位，那是它们自己的容器。） */
  for (const selector of ['.ww-head', '.ww-host', '.ww-win', '.ww-cast', '.ww-vote-line']) {
    assert.doesNotMatch(rule(selector), /top:50%|translate\(-50%,-50%\)/u, `${selector} 不该再有居中用的绝对定位`)
  }
  /* 舞台是竖排的流：抬头 / 主持人 / 胜负卡 / 票型条 / 条带依次排下去。 */
  assert.match(rule('.ww-scene'), /display:flex/u)
  assert.match(rule('.ww-scene'), /flex-direction:column/u)
  for (const selector of ['.ww-head', '.ww-host', '.ww-cast', '.ww-vote-line']) {
    assert.match(rule(selector), /position:relative/u, `${selector} 必须在布局流里`)
  }
  assert.doesNotMatch(rule('.ww-host'), /position:absolute/u)
  assert.doesNotMatch(rule('.ww-head'), /position:absolute/u)
  assert.doesNotMatch(rule('.ww-cast'), /position:absolute/u)
  /* 主持人用 hidden 收起，作者样式必须放行 [hidden]：`.ww-host` 的 display 会压过 UA 样式。 */
  assert.match(rule('.ww-host[hidden]'), /display:none/u)
})

test('席位条带：高度按行数取，条带是唯一可收缩的一段', () => {
  const cast = rule('.ww-cast')
  assert.match(cast, /height:var\(--ww-band/u, '条带高度必须读 --ww-band')
  assert.match(cast, /grid-template-rows:repeat\(var\(--ww-rows/u, '行模板必须读 --ww-rows')
  assert.match(cast, /flex:0 1 auto/u, '条带必须可收缩：窄画幅先让席卡变小')
  assert.match(cast, /min-height:0/u)
  assert.match(cast, /margin:auto 22px 22px/u, '富余的留白落在条带上方（margin-top:auto）')
  /* 席卡吃行高，高度不再由列宽或人数推。 */
  assert.match(rule('.ww-seat'), /height:100%/u)
  assert.match(rule('.ww-seat'), /min-height:0/u)
  assert.match(rule('.ww-face'), /flex:1 1 auto/u)
  assert.match(rule('.ww-face'), /min-height:0/u)
  assert.doesNotMatch(rule('.ww-face'), /height:\d+px/u, '席卡高度不再写死（158 / 138 / 132 / 124 都撤掉）')
  assert.doesNotMatch(rule('.ww-seat figcaption'), /flex:1/u, '署名不参与压缩，压掉的只能是立绘')
  /* 每个 (画幅, 人数) 档位都要有自己的行数与高度：缺一档就会退回 1 行的 46%（两行 → 卡片被压扁）。 */
  const bands = [
    ['.stage[data-game="werewolf"]:not([data-layout="portrait"])', 2, 46],
    ['.stage[data-game="werewolf"]:not([data-layout="portrait"])[data-seats="6"]', 1, 25],
    ['.stage[data-game="werewolf"][data-layout="portrait"]', 2, 50],
    ['.stage[data-game="werewolf"][data-layout="portrait"][data-seats="9"]', 3, 57],
  ]
  for (const [selector, rows, band] of bands) {
    const text = CSS.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\{([^}]*)\\}`, 'u'))
    assert.ok(text, `找不到档位规则：${selector}`)
    assert.equal(number(text[1], /--ww-rows:(\d+)/u, `${selector} 的行数`), rows, selector)
    assert.equal(number(text[1], /--ww-band:(\d+)%/u, `${selector} 的条带高度`), band, selector)
  }
  /* 行数口径与 presentation.werewolfCastLayout 同源：横屏 6 → 1 行、8 / 9 → 2 行；
     竖屏 6 / 8 → 2 行、9 → 3 行。上面四条覆盖的正是这四种组合。 */
})

test('终局横幅只剩淡入 + 缩放，视频侧与离线侧同一条动效', () => {
  assert.match(CSS, /\.stage\.animate\[data-act="finale"\] \.ww-win\{animation:wwVictory \.55s cubic-bezier\(\.2,\.8,\.3,1\) both\}/u,
    '终局横幅只在播放推进时入场（拖进度条不触发），与其余动效同一道闸')
  const keyframes = CSS.match(/@keyframes wwVictory\{([^}]*)\}/u)
  assert.ok(keyframes, 'scene.css 缺少 wwVictory 关键帧')
  assert.match(keyframes[1], /transform:scale\(\.82\)/u)
  assert.doesNotMatch(keyframes[1], /translate/u, '关键帧里的位移随绝对定位一起撤掉')
  /* 视频侧由 markup 写内联样式，两边必须是同一条曲线。 */
  const winTag = MARKUP.slice(MARKUP.indexOf('const winTag = frame.isFinale'), MARKUP.indexOf('const narrative ='))
  assert.ok(winTag, 'markup 里找不到胜负卡那一段')
  assert.match(winTag, /transform:scale\(\$\{round\(winScale\)\}\)/u, 'markup 的胜负卡只缩放、不位移')
  assert.doesNotMatch(winTag, /translate/u, '胜负卡的位移随绝对定位一起撤掉')
})

test('胜负卡占主持人那一格：终局不再同时出主持人播报，正文与配音同源', () => {
  /* markup：终局把主持人那一格让给胜负卡（观战页也是「有胜负卡就没有主持人格」）。 */
  assert.match(MARKUP, /const hostLine = frame\.isFinale \? '' : /u, 'markup 终局不再渲染主持人播报')
  assert.match(MARKUP, /const winTag = frame\.isFinale/u)
  assert.ok(MARKUP.indexOf('const winTag') < MARKUP.indexOf('<div class="ww-cast">'), '胜负卡要排在席位条带之前')
  assert.match(MARKUP, /esc\(wolf\.finaleBody \|\| data\.result\?\.message \|\| ''\)/u, '正文取投影好的 finaleBody')
  /* 离线播放器：DOM 顺序与 hidden 口径与 markup 一致。 */
  assert.ok(APP.indexOf("class=\"ww-win\" id=\"wwWin\"") < APP.indexOf("class=\"ww-cast\" id=\"wwCast\""), '播放器的胜负卡也要排在席位条带之前')
  assert.match(APP, /const hostLine = isFinale\s*\?\s*''/u, '播放器终局同样收起主持人播报')
  assert.match(APP, /D\.werewolf && D\.werewolf\.finaleBody/u)
  /* 正文只在 data.mjs 里推导一次：它是「最后一条结算播报 + 裁决」，与终局那一格的配音同源。 */
  assert.match(DATA, /finaleBody:/u)
  assert.match(DATA, /const finaleLine = /u)
})

test('票型条：与主持人播报分两格、终局不出、条带仍是唯一可收缩的一段', () => {
  /* 它和主持人一样是 flex:none 的布局流成员：票型出现时被压缩的只能是席位条带。 */
  const vote = rule('.ww-vote-line')
  assert.match(vote, /flex:none/u, '票型条不参与压缩：可收缩的只能是席位条带')
  assert.match(vote, /align-self:flex-start/u, '与主持人一样左对齐，不飘到画面中间')
  /* 一行放不下时省略号收尾：9 人局 9 个投票人必然溢出，投票人由席卡上的「→N」回答。 */
  assert.match(rule('.ww-vote-line p'), /white-space:nowrap/u)
  assert.match(rule('.ww-vote-line p'), /text-overflow:ellipsis/u)
  /* 最高票的两种裁决必须分色：单一领先用红（被放逐），平票用琥珀（复投）。 */
  assert.match(rule('.ww-tally[data-lead="one"]'), /#B4342A/u)
  assert.match(rule('.ww-tally[data-lead="tie"]'), /#B98418/u)
  for (const selector of ['.ww-vote,.ww-tally']) {
    assert.match(rule(selector), /position:absolute/u, '票型标记必须贴在立绘框里，不占行高')
  }
  /* 终局不出：那一格整块让给胜负卡，而条带上方也没有多出来的高度放第二行。 */
  assert.match(MARKUP, /const voteLine = frame\.isFinale \? '' : werewolfVoteLine\(frame\.voteBoard\)/u, 'markup 终局不再渲染票型条')
  assert.match(APP, /const voteLine = isFinale \? '' : S\.werewolfVoteLine\(frame\.voteBoard\)/u, '播放器终局同样收起票型条')
  /* 离线播放器的 DOM 顺序与 markup 一致：抬头 → 主持人 → 胜负卡 → 票型条 → 条带。 */
  assert.ok(APP.indexOf("id=\"wwVoteLine\"") > APP.indexOf("id=\"wwWin\""), '票型条要排在胜负卡之后')
  assert.ok(APP.indexOf("id=\"wwVoteLine\"") < APP.indexOf("class=\"ww-cast\" id=\"wwCast\""), '票型条要排在席位条带之前')
  /* 死因表整局一份，逐帧读同一个来源，席卡上的「出局」才写得出死因。 */
  assert.match(DATA, /deathCauses: timeline\.deathCauses/u)
  assert.match(MARKUP, /werewolfDeathMark\(\(options\.deathCauses \|\| \{\}\)\[seat\.seat\]\)/u)
  assert.match(APP, /S\.werewolfDeathMark\(/u)
})

test('高度预算：6 / 8 / 9 人 × 横竖屏，胜负卡底边与席位条带顶边都留得下席号徽标', () => {
  /* 常数取自 scene.css 与实测（chrome-headless-shell 量 .ww-win / .ww-cast 的舞台内坐标）：
     抬头横屏 93.4px（padding 26 + 日期胶囊 24 + 间距 6 + 阶段 34×1.1）、竖屏 76.6px；
     胜负卡最长两行时横屏 166px、竖屏 152px（判负 / 取消那类会带上结算播报，实测 8 人局就是两行）；
     条带下边距横屏 22px、竖屏 16px；主画面高横屏 720px、竖屏 720×16/14 = 630px。
     席号徽标 `.ww-no` 挂在 `top:-9px`，会伸到条带上方 9px，所以净空按 9px 计。 */
  const HEAD = { landscape: 93.4, portrait: 76.6 }
  const GAP = { landscape: 18, portrait: 10 } /* 胜负卡上边距 */
  const WIN = { landscape: 166, portrait: 152 } /* 最长两行 */
  const SCENE = { landscape: 720, portrait: 630 }
  const BOTTOM = { landscape: 22, portrait: 16 }
  const BADGE = 9
  const cases = [
    ['landscape', 6, 25, 1],
    ['landscape', 8, 46, 2],
    ['landscape', 9, 46, 2],
    ['portrait', 6, 50, 2],
    ['portrait', 8, 50, 2],
    ['portrait', 9, 57, 3],
  ]
  for (const [layout, seats, band, rows] of cases) {
    const scene = SCENE[layout]
    const castTop = scene - BOTTOM[layout] - (band / 100) * scene
    const winBottom = HEAD[layout] + GAP[layout] + WIN[layout]
    const clearance = castTop - winBottom
    assert.ok(clearance >= BADGE + 3, `${layout} ${seats} 人（${rows} 行）：条带顶边 ${castTop.toFixed(1)} 与胜负卡底边 ${winBottom} 只剩 ${clearance.toFixed(1)}px，装不下 9px 的席号徽标`)
    /* 席卡还要有可看的高度：一行至少 80px，否则等于把立绘压成一条。 */
    const row = ((band / 100) * scene - (rows - 1) * 10) / rows
    assert.ok(row >= 80, `${layout} ${seats} 人：每行只有 ${row.toFixed(1)}px`)
  }
})