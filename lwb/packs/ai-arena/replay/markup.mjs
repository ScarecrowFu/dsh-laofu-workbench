/**
 * 帧驱动的画面构建器：给定 (数据, 手数索引, 步内时间)，返回完整的 .stage HTML。
 *
 * 离线 HTML 用 CSS 关键帧在真实时间里跑动效；Remotion 是逐帧截图渲染，
 * 浏览器时钟不随帧号推进，CSS 动画在里面不会动。所以视频侧把每个随时间的量
 * **在 JS 里算好、作为内联样式写进 markup**，布局与配色则复用同一份 scene.css。
 *
 * 只在浏览器/打包环境使用（不依赖 node:fs，不依赖 xiangui 规则）。
 */
import { boardSvg, actionLabel, playerSide, ROLE_MARK, ROLE_NAME, werewolfPhaseLabel, werewolfSideName, werewolfCastColumns, isCompactTurn, werewolfVoteLine, werewolfVoteTone, werewolfDeathMark } from '../presentation.mjs'
import { WEREWOLF_ART } from '../werewolf-art.mjs'
import { MODEL_ART } from '../model-art.mjs'

const esc = v => String(v ?? '').replace(/[&<>"']/gu, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const PIECE_CN = { chariot: '车', cannon: '炮', horse: '马', soldier: '兵', elephant: '象', adviser: '士', general: '将' }
const MAJOR = new Set(['chariot', 'cannon', 'horse'])

/* ---------------------------------------------------------------- 缓动 */
function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
  const fx = t => ((ax * t + bx) * t + cx) * t
  const dfx = t => (3 * ax * t + 2 * bx) * t + cx
  const fy = t => ((ay * t + by) * t + cy) * t
  return x => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let t = x
    for (let i = 0; i < 6; i += 1) {
      const d = fx(t) - x
      if (Math.abs(d) < 1e-4) break
      const slope = dfx(t)
      if (Math.abs(slope) < 1e-6) break
      t -= d / slope
    }
    return fy(t)
  }
}
const LINEAR = t => t
const EASE_OUT = cubicBezier(.2, .8, .3, 1)
const EASE_PUSH = cubicBezier(.4, 0, .2, 1)
const EASE_SHATTER = cubicBezier(.3, .7, .4, 1)

/** 按 CSS keyframes 的停靠点插值；stops 为 [[进度, [值…]]…]，t/duration 归一到 0~1。 */
function track(stops, t, duration, ease = LINEAR) {
  const p = duration <= 0 ? 1 : Math.max(0, Math.min(1, t / duration))
  for (let i = 0; i < stops.length - 1; i += 1) {
    const [pa, va] = stops[i], [pb, vb] = stops[i + 1]
    if (p <= pb) {
      const local = pb === pa ? 1 : (p - pa) / (pb - pa)
      const k = ease(local)
      return va.map((value, j) => value + (vb[j] - value) * k)
    }
  }
  return stops[stops.length - 1][1]
}
const round = n => Math.round(n * 1000) / 1000

/* ---------------------------------------------------------------- 棋盘逐子处理
   boardSvg 把每颗棋子包在一个 <g> 里且不嵌套，可以按 <g …>…</g> 线性切分。
   坐标常量与 presentation.mjs 里的绘制保持一致，有测试交叉校验。 */
const GOMOKU = { margin: 34, gap: 32 }
const XIANGQI = { margin: 38, gap: 54 }
const GROUP_RE = /<g\b[^>]*>[\s\S]*?<\/g>/gu

function centreOf(gameId, move) {
  const geo = gameId === 'xiangqi' ? XIANGQI : GOMOKU
  const point = gameId === 'xiangqi' ? move.to : move
  if (!point) return null
  if (!Number.isInteger(point.row) || !Number.isInteger(point.col)) return null
  return { x: geo.margin + (point.col - 1) * geo.gap, y: geo.margin + (point.row - 1) * geo.gap }
}
const groupAt = (html, cx, cy) => new RegExp(`<circle[^>]*cx="${cx}" cy="${cy}"`, 'u').test(html)
function setGroupStyle(group, style) {
  return /\sstyle="/u.test(group) ? group.replace(/\sstyle="[^"]*"/u, ` style="${style}"`) : group.replace(/^<g\b/u, `<g style="${style}"`)
}
/** 给指定坐标上的棋子注入样式。 */
function stylePieceAt(svg, cx, cy, style) {
  return svg.replace(GROUP_RE, group => (groupAt(group, cx, cy) ? setGroupStyle(group, style) : group))
}
function findPieceAt(svg, cx, cy) {
  for (const match of svg.matchAll(GROUP_RE)) if (groupAt(match[0], cx, cy)) return match[0]
  return null
}
/** 按棋子上的字找（象棋的将/帅），返回该子圆心。 */
function findGlyphCentre(svg, glyph) {
  for (const match of svg.matchAll(GROUP_RE)) {
    const text = match[0].match(/<text[^>]*>([^<]*)<\/text>/u)
    if (!text || text[1] !== glyph) continue
    const circle = match[0].match(/<circle[^>]*cx="([\d.-]+)" cy="([\d.-]+)"/u)
    return circle ? { x: Number(circle[1]), y: Number(circle[2]) } : null
  }
  return null
}

/* ---------------------------------------------------------------- 关键手 */
export function isKeyMove(key, mode = 'major') {
  if (!key || mode === 'off') return false
  if (key.kind === 'win' || key.kind === 'check' || key.kind === 'death') return true
  if (key.kind !== 'capture') return false
  return mode === 'all' || (mode === 'major' && MAJOR.has(key.piece))
}

/* ---------------------------------------------------------------- 动效曲线（与 scene.css 对齐） */
const pushScale = t => track([[0, [1]], [.167, [1.03]], [.833, [1.03]], [1, [1]]], t, 2.4, EASE_PUSH)[0]
const stoneIn = t => track([[0, [0, -10]], [1, [1, 0]]], t, .26, EASE_OUT)
const fadeUp = (t, duration) => track([[0, [0, 8]], [1, [1, 0]]], t, duration, EASE_OUT)
const shatter = t => track([[0, [1, 1, 0]], [.35, [.9, 1.24, 10]], [1, [0, .5, -26]]], t, .36, EASE_SHATTER)
const shake = t => track([[0, [0]], [.22, [4]], [.55, [-3]], [.8, [1]], [1, [0]]], t, .32, LINEAR)[0]
const bandIn = t => track([[0, [0]], [1, [.55]]], t, .5, LINEAR)[0]
const winPop = (t, delay) => track([[0, [0, .45]], [1, [1, 1]]], Math.max(0, t - delay), .46, EASE_OUT)
const checkPulse = t => {
  const local = t % 1.05
  if (t >= 2.1) return null
  return track([[0, [.95, .8]], [.7, [.3, 1.9]], [1, [0, 2.15]]], local, 1.05, LINEAR)
}
/** 将军时全场压低到 42%，只留将帅。 */
const checkDim = t => track([[0, [1]], [1, [.42]]], t, .28, LINEAR)[0]
/** 终局棋盘推近：0.5s 过渡到 1.03。 */
const finaleScale = t => track([[0, [1]], [1, [1.03]]], t, .5, cubicBezier(.2, .7, .2, 1))[0]

/* ---------------------------------------------------------------- 换手节拍
   执行者卡先到 → 落子随后 → 台词最后。手机上看视频时「谁在执行」主要靠这一拍：
   三处数值必须与 scene.css 的同名关键帧（animation-delay）保持一致。 */
const TURN_IN = .34
const STONE_DELAY = .12
const SPEECH_DELAY = .22
const turnIn = t => track([[0, [0, 14]], [1, [1, 0]]], t, TURN_IN, EASE_OUT)
const turnBar = t => track([[0, [0]], [1, [1]]], t, .32, EASE_OUT)[0]
const turnLogo = t => track([[0, [.86]], [1, [1]]], t, .3, EASE_OUT)[0]
/** 形象与执行者卡一起到场，比卡片本身晚一点、从略小处放大——「弹出」的那一拍。 */
const FIGURE_IN = .42
const turnFigure = t => track([[0, [0, .9]], [1, [1, 1]]], Math.max(0, t - .06), FIGURE_IN, EASE_OUT)
/** 把一条动效轨道往后推 delay 秒：排队用，t<delay 时停在起始值。 */
const after = (delay, run) => t => run(Math.max(0, t - delay))

/* ---------------------------------------------------------------- 当前执行者卡
   整场画面里「谁在执行」的唯一大号常驻元素。视频侧随时间的量在这里内联，
   离线 HTML 用 scene.css 的同名关键帧；两边的入场节奏由上面的节拍常量对齐。

   形象的口径（2026-10-09 定）：**只有人物、没有底板**；logo 贴在形象的左上角，与形象一起出场；
   **本手有发言才画人**——没有发言时 `.turn-figure` 里只剩 logo 徽标，同高占位，侧栏不跳。
   形象放在 `turn-body` 之后：标准档靠 CSS 的 `order:-1` 提到模型名左侧，紧凑档留在右侧。 */
function turnFigureHtml({ player = null, speaks = false, compact = false, t = 0, animate = true }) {
  if (!player) return ''
  const key = player.portrait
  /* 紧凑档用胸像：46×58 的框里半身缩下去脸就没了。 */
  const src = speaks ? (compact ? artBust(key) : artPortrait(key)) : ''
  const [opacity, scale] = animate ? turnFigure(t) : [1, 1]
  const logoScale = animate ? turnLogo(t) : 1
  /* 一个格子、一个 logo：有形象时 logo 退到人物左上角当徽标；没有形象时它就是这一格的主标。
     两态占的盒子一样宽，所以模型名不会左右跳（卡片高度也由同一个 min-height 定住）。 */
  return `<span class="turn-figure"${src ? '' : ' data-quiet="true"'}>` +
    (src ? `<img class="turn-face" src="${src}" alt="" style="opacity:${round(opacity)};transform:scale(${round(scale)})">` : '') +
    (player.logo ? `<img class="turn-mark" src="${player.logo}" alt="" style="transform:scale(${round(logoScale)})">` : '') +
    `</span>`
}

function turnHtml({ player = null, kicker, name, meta = '', tag = '', phase = 'move', t = 0, animate = true, speaks = false, compact = false }) {
  const [opacity, shift] = animate ? turnIn(t) : [1, 0]
  const bar = animate ? turnBar(t) : 1
  return `<div class="turn" data-phase="${phase}"${compact ? ' data-compact="true"' : ''} style="opacity:${round(opacity)};transform:translateY(${round(shift)}px)">` +
    `<i class="turn-bar" style="transform:scaleY(${round(bar)})"></i>` +
    `<div class="turn-body"><div class="turn-top"><small class="turn-kicker">${esc(kicker)}</small>${tag}` +
    (meta ? `<span class="turn-meta">${meta}</span>` : '') + `</div>` +
    `<b class="turn-name">${esc(name)}</b></div>` +
    turnFigureHtml({ player, speaks, compact, t, animate }) +
    `</div>`
}

/** 棋类的执行者卡口径：开局指先手，逐手指本手，终局指胜方。
    右侧顺带标出席位（红/黑方、先后手），让观众能把「这个模型」对上盘上的颜色。
    `speech` 是本手发言，用于逐手条件：开局与终局都没有发言，因而不画形象。 */
function chessTurn(data, { index, isFinale, isDraw, winner, active, speech, layout, t, animate }) {
  const seat = isFinale ? winner : active
  const player = seat === null || seat < 0 ? null : (data.players[seat] || null)
  const name = player ? (player.name || '') : (isFinale ? (isDraw ? '和棋' : '比赛结束') : '')
  const meta = player ? `${esc(playerSide(data.game, seat))} · ${seat === 0 ? '先手' : '后手'}` : ''
  return turnHtml({
    player, name, meta, t, animate,
    speaks: Boolean(player) && Boolean(String(speech || '').trim()),
    compact: isCompactTurn(data.game.id, layout),
    kicker: isFinale ? (isDraw ? '终局' : '胜方') : (index >= 1 ? '本手执行' : '先手'),
    phase: isFinale ? 'finale' : 'move',
  })
}

/* ---------------------------------------------------------------- 棋盘 */
function boardMarkup(data, index, { key, t }) {
  const M = data.moves.length
  const isFinale = index > M
  const xiangqi = data.game.id === 'xiangqi'
  const moves = data.moves.slice(0, Math.min(index, M)).map(m => ({ ...m.a, player: m.p }))
  let svg = boardSvg(moves, { gameId: data.game.id })
  const last = index >= 1 ? data.moves[index - 1] : null
  const fx = []

  /* 将军：全场压低，只把被将的将帅拉回不透明，并在它身上打红环脉冲。
   红环要落在「被将的那一方」的将帅上，不是本手落点。 */
  if (key?.kind === 'check') {
    const opacity = round(checkDim(t))
    svg = svg.replace(GROUP_RE, group => setGroupStyle(group, `opacity:${opacity}`))
    const glyph = last?.p === 0 ? '将' : '帅'
    svg = svg.replace(GROUP_RE, group => {
      const text = group.match(/<text[^>]*>([^<]*)<\/text>/u)
      return text && text[1] === glyph ? setGroupStyle(group, 'opacity:1') : group
    })
    const pulse = checkPulse(t)
    const centre = findGlyphCentre(svg, glyph)
    if (pulse && centre) fx.push(`<circle cx="${centre.x}" cy="${centre.y}" r="${xiangqi ? 21 : 15.5}" fill="none" stroke="#E24B4A" stroke-width="3" class="pulse" style="opacity:${round(pulse[0])};transform:scale(${round(pulse[1])})"/>`)
  }

  /* 落子入场：只动本手落点那一颗 —— 必须按坐标判定，
     boardSvg 是按当前局面整体重绘的，<g> 顺序是位置序而非落子序。
     排在执行者卡之后（STONE_DELAY），先把「谁」推给观众再看「落在哪」。 */
  if (last) {
    const centre = centreOf(data.game.id, last.a)
    if (centre) {
      const [opacity, shift] = after(STONE_DELAY, stoneIn)(t)
      svg = stylePieceAt(svg, centre.x, centre.y, `opacity:${round(opacity)};transform:translateY(${round(shift)}px)`)
    }
  }

  /* 吃子：被吃那颗原位碎裂淡出（原局面的同一格换了字） */
  if (key?.kind === 'capture' && index >= 2) {
    const previous = data.moves.slice(0, index - 1).map(m => ({ ...m.a, player: m.p }))
    const centre = centreOf(data.game.id, last?.a)
    const before = centre ? findPieceAt(boardSvg(previous, { gameId: data.game.id }), centre.x, centre.y) : null
    if (before) {
      const [opacity, scale, rotate] = shatter(t)
      fx.push(before.replace(/^<g\b/u, `<g class="ghost" style="opacity:${round(opacity)};transform:scale(${round(scale)}) rotate(${round(rotate)}deg)"`))
    }
  }

  /* 胜局：连子金带铺底 + 五颗子依次点亮 */
  if (isFinale && Array.isArray(data.winRun) && data.winRun.length >= 5) {
    const geo = xiangqi ? XIANGQI : GOMOKU
    const point = c => ({ x: geo.margin + (c.col - 1) * geo.gap, y: geo.margin + (c.row - 1) * geo.gap })
    const a = point(data.winRun[0]), b = point(data.winRun[data.winRun.length - 1])
    svg = svg.replace(/(<g\b)/u, `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#F0B429" stroke-width="44" stroke-linecap="round" class="winband" style="opacity:${round(bandIn(t))}"/>$1`)
    data.winRun.forEach((cell, i) => {
      const c = point(cell)
      const [opacity, scale] = winPop(t, .12 + i * .08)
      fx.push(`<circle cx="${c.x}" cy="${c.y}" r="16" fill="none" stroke="#F0B429" stroke-width="2.4" class="winring" style="opacity:${round(opacity)};transform:scale(${round(scale)})"/>`)
    })
  }

  if (fx.length) svg = svg.replace(/<\/svg>$/u, `${fx.join('')}</svg>`)
  return svg
}

/* ---------------------------------------------------------------- 其它区块 */
const stepSize = (length, portrait) => {
  if (length <= 24) return portrait ? 26 : 30
  if (length <= 40) return portrait ? 23 : 26
  return portrait ? 21 : 23
}

function pillHtml(key, isFinale, isDraw) {
  if (isFinale) return isDraw ? '<span class="pill plain">和棋</span>' : '<span class="pill win">胜局</span>'
  if (!key) return ''
  if (key.kind === 'check') return '<span class="pill chk">将军</span>'
  if (key.kind === 'win') return '<span class="pill win">胜局</span>'
  if (key.kind === 'capture') return `<span class="pill cap">吃${PIECE_CN[key.piece] || '子'}</span>`
  return ''
}

function scoreHtml(data, active, isFinale, winner, isDraw) {
  const xiangqi = data.game.id === 'xiangqi'
  const stone = i => xiangqi ? (i ? 'xq-black' : 'xq-red') : (i ? 'white' : 'black')
  return data.players.map((player, i) => {
    const badge = isFinale ? (winner === i ? '胜' : isDraw ? '和' : '') : ''
    return `<div class="pcard" data-i="${i}" data-active="${i === active}">` +
      `<img class="logo" src="${player.logo || ''}" alt="">` +
      `<i class="stone ${stone(i)}"></i>` +
      `<span class="nm">${esc(player.name)}</span>` +
      `<span class="sd">${playerSide(data.game, i)} · ${i === 0 ? '先手' : '后手'}</span>` +
      `<em class="bd">${badge}</em></div>`
  }).join('')
}

function progressHtml(data, index, keyMode, label = '关键手') {
  const M = data.moves.length
  const FINALE = M + 1
  const den = M || 1
  const pct = (index / FINALE) * 100
  const ticks = data.keys.filter(k => isKeyMove(k, keyMode)).map(k => {
    const cls = ({ check: 'chk', win: 'win', death: 'death' })[k.kind] || 'cap'
    return `<i class="tick ${cls}" style="left:${round((k.n / den) * 100)}%"></i>`
  }).join('')
  const count = index > M ? `共 <b>${M}</b> 手 · 终局` : `第 <b>${index}</b> / ${M} 手`
  const hits = data.keys.filter(k => isKeyMove(k, keyMode)).length
  return `<div class="prow"><span class="pcount">${count}</span><span class="ptime">${label} <b>${hits}</b> 处</span></div>` +
    `<div class="track"><div class="fill" style="width:${round(pct)}%"></div>${ticks}` +
    `<span class="cur" style="left:calc(${round(pct)}% - ${round(pct * 0.065)}px)"></span></div>`
}

/* ---------------------------------------------------------------- 狼人杀席位舞台
   隐藏身份游戏没有棋盘：主画面是一块满幅昼夜场景 + N 张立绘席卡，头顶是主持人的确定性播报。
   逐帧渲染时所有随时间变化的量都在这里算成内联样式，离线 HTML 用 scene.css 里的同名关键帧。 */
const WOLF_SIDE = role => role === 'werewolf' ? 'wolf' : 'village'
/* 形象是跨游戏共用的模型身份资产：full 用于席卡与标准执行者卡，bust 用于紧凑档。
   出局档（`-dead`）仍然只服务狼人杀席卡。 */
const artPortrait = key => MODEL_ART.full[key] || MODEL_ART.full.generic || ''
const artBust = key => MODEL_ART.bust[key] || MODEL_ART.bust.generic || artPortrait(key)
const seatFace = seat => seat.alive ? artPortrait(seat.portrait) : (MODEL_ART.full[`${seat.portrait}-dead`] || artPortrait(seat.portrait))
const wwSeatIn = (t, order) => track([[0, [0, 18, .96]], [1, [1, 0, 1]]], Math.max(0, t - order * .05), .34, EASE_OUT)
const wwLift = t => track([[0, [0]], [1, [1]]], t, .26, EASE_OUT)[0]
const wwStrike = t => track([[0, [1.7, 1]], [.62, [1, .95]], [1, [1, .72]]], t, .5, EASE_SHATTER)
const wwTagIn = t => track([[0, [0, 12]], [1, [1, 0]]], t, .44, EASE_OUT)
const wwSceneFade = t => track([[0, [0]], [.18, [1]], [1, [1]]], t, .5, LINEAR)[0]
const wwHeadIn = t => track([[0, [0, 14]], [1, [1, 0]]], t, .38, EASE_OUT)
const wwVictory = t => track([[0, [0, .82]], [1, [1, 1]]], t, .55, EASE_OUT)

/** 当前这一手该看到哪一面：开局、逐手、终局统一在这里取。 */
function werewolfFrame(data, index) {
  const wolf = data.werewolf || { seats: [], steps: null }
  const M = data.moves.length
  const FINALE = M + 1
  const isFinale = index >= FINALE
  const steps = wolf.steps || []
  const step = index >= 1 && index <= M ? steps[index - 1] || null : null
  const last = index >= 1 && index <= M ? data.moves[index - 1] : null
  const seatTotal = wolf.seats.length || (data.players || []).length || 6
  const finalStep = steps.at(-1) || null
  const phase = step?.phase || last?.phase || 'night-wolf'
  const initial = Array.from({ length: seatTotal }, (_, i) => i + 1)
  return {
    isFinale, step, last,
    /* 开局六人俱在；终局沿用最后一手的存活名单，否则出局的人会在终局画面里「复活」。 */
    /* 终局帧的席位与出局取「最后一手打完之后」那一份：逐手快照讲的是本手开场，
       最后一手的结果只能由终局帧承接（没挂上就会在终局席位上复活）。 */
    alive: new Set(isFinale ? (wolf.finalAlive || finalStep?.alive || initial) : (step ? step.alive : initial)),
    deaths: step ? step.deaths : (isFinale ? (wolf.finalDeaths || []) : []),
    activeSeat: step ? step.seat : null,
    /* 票型由投影逐手算好；终局不画（那一格整块让给胜负卡，席位条带也没有多出来的高度）。 */
    voteBoard: isFinale ? null : (step?.voteBoard || null),
    scene: isFinale ? (data.result?.side === 'wolf' ? 'night' : 'day') : (step?.scene || (phase.startsWith('day') ? 'day' : 'night')),
    day: isFinale ? (finalStep?.day || 1) : (step?.day || 1),
    label: isFinale ? '终局' : (step?.label || (index >= 1 ? werewolfPhaseLabel(phase, null) : '天黑请闭眼')),
    winnerSide: data.result?.side || null,
  }
}

function werewolfSeatHtml(seat, index_, frame, options, order) {
  const { t, animate } = options
  const alive = frame.alive.has(seat.seat)
  const active = !frame.isFinale && seat.seat === frame.activeSeat
  const dying = frame.deaths.includes(seat.seat)
  const [enterOpacity, enterShift, enterScale] = animate && order >= 0 ? wwSeatIn(t, order) : [1, 0, 1]
  const lift = animate && active ? wwLift(t) : 0
  const winning = frame.isFinale && frame.winnerSide && seat.role && WOLF_SIDE(seat.role) === frame.winnerSide
  const style = `--ww-i:${index_};opacity:${round(enterOpacity)};transform:translateY(${round(enterShift - lift * 14)}px) scale(${round(enterScale + lift * .06)})`
  const strike = animate && dying ? (() => { const [scale, opacity] = wwStrike(t); return `<span class="ww-strike" style="opacity:${round(opacity)};transform:translate(-50%,-50%) scale(${round(scale)})"></span>` })() : ''
  const [tagOpacity, tagShift] = animate && dying ? wwTagIn(t) : [1, 0]
  /* 出局标签写死因（夜刀 / 毒杀 / 票出 / 带走）：三种死法不再共用一句「出局」，
     而「为什么出局」正是票型那一组改动要回答的另一半。死因表整局不变，逐帧读同一份。 */
  const out = !alive ? `<span class="ww-out" style="opacity:${round(tagOpacity)};transform:translateX(-50%) translateY(${round(tagShift)}px)">${esc(werewolfDeathMark((options.deathCauses || {})[seat.seat]))}</span>` : ''
  /* 本轮票型：箭头挂在投票者那张卡上，票数挂在被投者那张卡上。两块都在立绘框内，
     席卡高度不变 —— 8 / 9 人局加不起任何常驻行。 */
  const board = frame.voteBoard
  const voted = board ? (board.votes || []).find(vote => vote.seat === seat.seat) : null
  const count = board ? ((board.counts || []).find(item => item.seat === seat.seat)?.count || 0) : 0
  const lead = count > 0 && count === board.top ? (board.tie ? 'tie' : 'one') : ''
  const vote = voted ? `<span class="ww-vote">→${voted.target}</span>` : ''
  const tally = count ? `<span class="ww-tally"${lead ? ` data-lead="${lead}"` : ''}>${count} 票</span>` : ''
  return `<figure class="ww-seat" data-i="${index_}" data-seat="${seat.seat}" data-alive="${alive}" data-active="${active}" data-role="${esc(seat.role)}"${winning ? ' data-win="true"' : ''} style="${style}">` +
    `<span class="ww-no">${seat.seat}</span>` +
    `<span class="ww-face"><img src="${seatFace({ ...seat, alive })}" alt=""><i class="ww-veil"></i>${vote}${tally}${strike}${out}</span>` +
    `<figcaption><b class="ww-name">${esc(seat.name)}</b><em class="ww-role" data-role="${esc(seat.role)}">${ROLE_MARK[seat.role] || '·'}</em></figcaption>` +
    `</figure>`
}

function werewolfScoreHtml(data, frame) {
  return (data.werewolf?.seats || []).map((seat, i) => {
    const alive = frame.alive.has(seat.seat)
    const active = !frame.isFinale && seat.seat === frame.activeSeat
    const badge = frame.isFinale
      ? (frame.winnerSide && seat.role && WOLF_SIDE(seat.role) === frame.winnerSide ? '胜' : data.result ? '负' : '')
      : (alive ? '' : '出局')
    return `<div class="pcard" data-i="${i}" data-active="${active}" data-alive="${alive}" data-role="${esc(seat.role)}">` +
      `<img class="logo" src="${seat.logo || ''}" alt="">` +
      `<i class="stone ww-chip" data-role="${esc(seat.role)}">${ROLE_MARK[seat.role] || '·'}</i>` +
      `<span class="nm">${esc(seat.name)}</span>` +
      `<span class="sd">${esc(ROLE_NAME[seat.role] || seat.role || '')}</span>` +
      `<em class="bd">${badge}</em></div>`
  }).join('')
}

function werewolfPill(data, index, frame) {
  if (frame.isFinale) return `<span class="pill win">${frame.winnerSide === 'wolf' ? '狼人获胜' : '好人获胜'}</span>`
  const key = index >= 1 ? data.keys.find(k => k.n === index) : null
  if (key?.kind === 'death') return `<span class="pill cap">出局 ${key.seats.map(s => `${s} 号`).join('、')}</span>`
  if (frame.step) return `<span class="pill chk">${esc(frame.step.label)}</span>`
  return ''
}

function werewolfStageHtml(data, index, options = {}) {
  const { layout = 'landscape', t = 0, animate = true } = options
  const frame = werewolfFrame(data, index)
  const M = data.moves.length
  const wolf = data.werewolf || {}
  const seats = wolf.seats || []
  /* 席位与身份：与观战页同一个口径（席号 + 徽记 + 中文名），身份取 replay/data.mjs 已经
     投影好的 seats（那里用 presentation 的 ROLE_MARK / ROLE_NAME 生成）。
     署名与回合记录里的每一行都据此回答「这个模型是什么身份」。 */
  const seatNo = i => seats[i] ? `<span class="sseat">${seats[i].seat} 号</span>` : ''
  const roleTag = i => seats[i] && seats[i].mark ? `<em class="srole" data-role="${esc(seats[i].role)}"><i>${esc(seats[i].mark)}</i>${esc(seats[i].roleName || '')}</em>` : ''
  const columns = wolf.columns || {}
  const cols = (layout === 'portrait' ? columns.portrait : columns.landscape) || werewolfCastColumns(seats.length || 6, layout)
  const order = index > 1 ? -1 : 0
  const sceneFade = animate ? wwSceneFade(t) : 1
  const [headOpacity, headShift] = animate ? wwHeadIn(t) : [1, 0]
  const [winOpacity, winScale] = animate ? wwVictory(t) : [1, 1]
  const [speechOpacity, speechShift] = after(SPEECH_DELAY, v => fadeUp(v, .2))(t)
  const [finaleOpacity, finaleShift] = fadeUp(t, .28)
  const body = frame.last ? frame.last.s : (index === 0 ? '天黑请闭眼。' : '')
  const actor = frame.last ? (data.players[frame.last.p] || null) : null
  const narrator = actor
    ? `<img class="logo" src="${seats[frame.last.p]?.logo || ''}" alt="">${seatNo(frame.last.p)}<b class="sn">${esc(actor.name || '')}</b>${roleTag(frame.last.p)}<em class="stag">本手发言</em>`
    : '<b class="sn">开局</b>'
  /* 动作标签里的「发言」与署名上的「本手发言」胶囊重复：让位给模型名与身份，
     否则 404px 的侧栏会把模型名压成一个「qwe…」。夜刀 / 查验 / 投票这些带目标的不动。 */
  const actionName = frame.last ? actionLabel(frame.last.a, data.game) : ''
  const coord = actionName && actionName !== '发言' ? esc(actionName) : ''
  /* 执行者卡：狼人杀没有棋盘，「谁在执行」由它承担。
     席位舞台上的金框已经只表示胜方，蓝色环才是本手执行。 */
  /* 逐手条件：本手有发言才画人。终局与开局都没有「本手发言」，所以只留同高占位的 logo。 */
  const speaks = Boolean(String(body || '').trim()) && Boolean(actor)
  const compact = isCompactTurn(data.game.id, layout)
  const turn = frame.isFinale
    ? turnHtml({
        kicker: '终局', name: frame.winnerSide ? werewolfSideName(frame.winnerSide) : '比赛结束',
        meta: `共 <b>${M}</b> 步`, tag: werewolfPill(data, index, frame), phase: 'finale', t, animate, compact,
      })
    : actor
      ? turnHtml({
          player: actor, kicker: '本手执行', name: actor.name || '', speaks, compact,
          meta: `<b>${index}</b> / ${M} 步`, tag: werewolfPill(data, index, frame), t, animate,
        })
      : turnHtml({ kicker: '开局', name: '天黑请闭眼', meta: `<b>0</b> / ${M} 步`, t, animate, compact })
  /* 侧栏比棋类窄，且身份榜占掉 N 行：回合记录收到最近 2 手。
     形象进执行者卡后卡片从 79px 长到 112px（+33px），回合记录由 3 条收到 2 条正是让位的那一笔
     ——侧栏净空本来只剩 8—12px（见 test/replay-sidebar.test.mjs 的高度预算）。 */
  const entries = data.moves.slice(0, index).slice(-3, -1).reverse()
  const deathCauses = wolf.deathCauses || {}
  const cast = seats.map((seat, i) => werewolfSeatHtml(seat, i, frame, { t, animate, deathCauses }, order >= 0 ? i : -1)).join('')
  const backgrounds = ['night', 'day'].map(scene => {
    const on = scene === frame.scene
    return `<img class="ww-bg" data-scene="${scene}" src="${WEREWOLF_ART.scenes[scene] || ''}" alt="" style="opacity:${on ? round(sceneFade) : 0}">`
  }).join('')
  /* 主持人播报：出局与阶段由它一起说出，不再单独挂一条出局横幅——台词里已经说了谁出局，
     画面只保留席卡上的红叉与出局标记。终局那一格整格让给胜负卡（最后一条结算播报就是它的
     正文），两段文案不同时出现：观战页同样是「有胜负卡就没有主持人那一格」。 */
  const hostLine = frame.isFinale ? '' : (frame.step?.host || (index === 0 ? wolf.host || '' : ''))
  const [hostOpacity, hostShift] = animate ? fadeUp(t, .3) : [1, 0]
  const hostTag = hostLine
    ? `<div class="ww-host" style="opacity:${round(hostOpacity)};transform:translateY(${round(hostShift)}px)"><em>主持人</em><p>${esc(hostLine)}</p></div>`
    : ''
  /* 终局横幅：正文取 `data.werewolf.finaleBody`（「最后一条结算播报 + 裁决」，与终局那一格的
     配音同源）。它进的是布局流、占的就是主持人那一格，席位条带从它下面开始，两者不可能相交。 */
  const winTag = frame.isFinale
    ? `<div class="ww-win" data-side="${frame.winnerSide || 'draw'}" style="opacity:${round(winOpacity)};transform:scale(${round(winScale)})">` +
      `<b>${frame.winnerSide === 'wolf' ? '狼人获胜' : frame.winnerSide ? '好人获胜' : '比赛结束'}</b>` +
      `<span>${esc(wolf.finaleBody || data.result?.message || '')}</span></div>`
    : ''
  /* 票型条：谁几票、这一轮是怎么裁的（一句话，整局措辞由 presentation 出一份）。
     它与主持人播报分两格 —— 主持人说的是阶段与出局名单，这里说的是票数；谁投了谁由席卡上的
     「→N」回答。终局不出：那一格整块让给胜负卡，而条带上方也没有多出来的高度放第二行。 */
  const voteLine = frame.isFinale ? '' : werewolfVoteLine(frame.voteBoard)
  const voteTag = voteLine
    ? `<div class="ww-vote-line" data-tone="${esc(werewolfVoteTone(frame.voteBoard))}"><em>票型</em><p>${esc(voteLine)}</p></div>`
    : ''
  const narrative = frame.isFinale
    ? `<div class="finale" data-kind="${frame.winnerSide ? 'win' : 'draw'}" style="opacity:${round(finaleOpacity)};transform:translateY(${round(finaleShift)}px)">` +
      `<small>终局 · ${werewolfSideName(frame.winnerSide)}</small><p>${esc(data.result?.message || '比赛已结束。')}</p></div>`
    : `<div class="speech" style="opacity:${round(speechOpacity)};transform:translateY(${round(speechShift)}px)">` +
      `<div class="sinner"><div class="shead"><span>${narrator}</span>${coord ? `<em class="coord">${coord}</em>` : ''}</div>` +
      `<p style="font-size:${stepSize(body.length, layout === 'portrait')}px">${esc(body || '等待行动')}</p></div></div>`
  const recent = frame.isFinale || !entries.length ? '' :
    `<div class="recent"><div class="rtitle">回合记录</div><div class="rlist">` +
    entries.map(m => `<div class="rentry"><b>${m.n} · ${seatNo(m.p)}${esc(data.players[m.p]?.name || '')}${roleTag(m.p)}</b><span>${esc(m.s)}</span></div>`).join('') +
    `</div></div>`

  return `<div class="stage ww" data-layout="${layout}" data-phase="${frame.isFinale ? 'finale' : 'move'}" data-game="werewolf" data-scene="${frame.scene}" data-act="${frame.isFinale ? 'finale' : (frame.deaths.length ? 'death' : 'move')}" data-seats="${seats.length}" style="--ww-cols:${cols};--ww-cols-portrait:${cols}">` +
    `<section class="board-card" style="transform:scale(${round(frame.isFinale ? finaleScale(t) : 1)})">` +
    `<div class="ww-scene">${backgrounds}<div class="ww-mask"></div>` +
    `<header class="ww-head" style="opacity:${round(headOpacity)};transform:translateY(${round(headShift)}px)">` +
    `<span class="ww-day">第 ${frame.day} 天 · ${frame.scene === 'day' ? '白天' : '夜间'}</span>` +
    `<b class="ww-phase">${esc(frame.label)}</b></header>` +
    hostTag + winTag + voteTag +
    `<div class="ww-cast">${cast}</div>` +
    `</div></section>` +
    `<aside class="side">` +
    `<header class="top"><div class="brand"><b>AI竞技台</b><span class="game">${esc(data.game.name)} · 规则 ${esc(data.game.version)}</span></div></header>` +
    turn +
    `<div class="score">${werewolfScoreHtml(data, frame)}</div>` +
    `<div class="narrative">${narrative}${recent}</div>` +
    `<footer class="progress">${progressHtml(data, index, options.keyMode || 'major', '出局 / 终局')}</footer>` +
    `<div class="safe-bottom"></div></aside></div>`
}

/* ---------------------------------------------------------------- 入口 */
/**
 * @param {object} data replayData() 的产物
 * @param {number} index 0=开局，1..M=第 N 手落定后，M+1=终局卡
 * @param {object} [options] layout / t（本步已播秒数）/ keyMode / animate
 */
export function stageHtml(data, index, options = {}) {
  const { layout = 'landscape', t = 0, keyMode = 'major', animate = true } = options
  if (data.game.id === 'werewolf') return werewolfStageHtml(data, index, options)
  const portrait = layout === 'portrait'
  const M = data.moves.length
  const FINALE = M + 1
  const isFinale = index >= FINALE
  const winner = typeof data.result?.winner === 'number' ? data.result.winner : null
  /* 隐藏身份游戏的终局由 result.side 表示阵营，不能因为 winner 不是数字就当成和棋。 */
  const isDraw = Boolean(data.result) && winner === null && !data.result.side
  const key = !isFinale && index >= 1 ? data.keys.find(k => k.n === index) : null
  /* 与离线 HTML 保持一致：吃子/将军/胜局的「效果」只看本手是不是关键手，
     档位只筛「推近幅度」与进度条刻度（药丸标签也照原样显示）。 */
  const fxOn = animate && Boolean(key)
  const pushOn = fxOn && isKeyMove(key, keyMode)
  const last = index >= 1 && index <= M ? data.moves[index - 1] : null
  const active = isFinale ? -1 : (last ? last.p : 0)

  const cardScale = isFinale ? finaleScale(t) : (pushOn ? pushScale(t) : 1)
  const boardStyle = fxOn && key.kind === 'capture' ? `transform:translate(0,${round(shake(t))}px)` : ''
  const [speechOpacity, speechShift] = after(SPEECH_DELAY, v => fadeUp(v, .2))(t)
  const [finaleOpacity, finaleShift] = fadeUp(t, .28)
  const turn = chessTurn(data, { index, isFinale, isDraw, winner, active, speech: last?.s, layout, t, animate })

  const narrative = isFinale
    ? `<div class="finale" data-kind="${isDraw ? 'draw' : 'win'}" style="opacity:${round(finaleOpacity)};transform:translateY(${round(finaleShift)}px)">` +
      `<small>终局</small><p>${esc(data.result?.message || '比赛已结束。')}</p></div>`
    : (() => {
        /* 侧栏高度被执行者卡让位，回合记录收到最近 4 手（超出由 rlist 的 overflow 裁），
           本手发言永远优先保留完整高度。 */
        const entries = data.moves.slice(0, index).slice(-5, -1).reverse()
        const recent = entries.length
          ? `<div class="recent"><div class="rtitle">回合记录</div><div class="rlist">` +
            entries.map(m => `<div class="rentry"><b>${m.n} · ${esc(data.players[m.p].name)}</b><span>${esc(m.s)}</span></div>`).join('') +
            `</div></div>`
          : ''
        const who = last
          ? `<img class="logo" src="${data.players[last.p].logo || ''}" alt=""><b class="sn">${esc(data.players[last.p].name)}</b><em class="stag">本手发言</em>`
          : '<b class="sn">开局</b>'
        const coord = last ? `<em class="coord">${esc(actionLabel(last.a, data.game))}</em>` : ''
        const body = last ? last.s : '比赛开始'
        return `<div class="speech" style="opacity:${round(speechOpacity)};transform:translateY(${round(speechShift)}px)">` +
          `<div class="sinner"><div class="shead"><span>${who}</span>${coord}</div>` +
          `<p style="font-size:${stepSize(body.length, portrait)}px">${esc(body)}</p></div></div>${recent}`
      })()

  return `<div class="stage" data-layout="${layout}" data-phase="${isFinale ? 'finale' : 'move'}" data-game="${esc(data.game.id)}" data-fx="${fxOn ? key.kind : ''}">` +
    `<section class="board-card" style="transform:scale(${round(cardScale)})">` +
    `<div class="board"${boardStyle ? ` style="${boardStyle}"` : ''}>${boardMarkup(data, index, { key: fxOn ? key : null, t })}</div></section>` +
    `<aside class="side">` +
    `<header class="top"><div class="brand"><b>AI竞技台</b><span class="game">${esc(data.game.name)} · 规则 ${esc(data.game.version)}</span></div></header>` +
    turn +
    `<div class="hero"><em class="hlbl">${isFinale ? '终局' : '当前手数'}</em>` +
    `<b class="n">${isFinale ? M : index}</b><span class="t">/ ${M} 手</span>` +
    `<div class="heroTag">${pillHtml(key, isFinale, isDraw)}</div></div>` +
    `<div class="score">${scoreHtml(data, active, isFinale, winner, isDraw)}</div>` +
    `<div class="narrative">${narrative}</div>` +
    `<footer class="progress">${progressHtml(data, index, keyMode)}</footer>` +
    `<div class="safe-bottom"></div></aside></div>`
}