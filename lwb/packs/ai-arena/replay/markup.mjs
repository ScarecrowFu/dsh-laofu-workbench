/**
 * 帧驱动的画面构建器：给定 (数据, 手数索引, 步内时间)，返回完整的 .stage HTML。
 *
 * 离线 HTML 用 CSS 关键帧在真实时间里跑动效；Remotion 是逐帧截图渲染，
 * 浏览器时钟不随帧号推进，CSS 动画在里面不会动。所以视频侧把每个随时间的量
 * **在 JS 里算好、作为内联样式写进 markup**，布局与配色则复用同一份 scene.css。
 *
 * 只在浏览器/打包环境使用（不依赖 node:fs，不依赖 xiangui 规则）。
 */
import { boardSvg, actionLabel, playerSide } from '../presentation.mjs'

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
  if (key.kind === 'win' || key.kind === 'check') return true
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
     boardSvg 是按当前局面整体重绘的，<g> 顺序是位置序而非落子序。 */
  if (last) {
    const centre = centreOf(data.game.id, last.a)
    if (centre) {
      const [opacity, shift] = stoneIn(t)
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

function progressHtml(data, index, keyMode) {
  const M = data.moves.length
  const FINALE = M + 1
  const den = M || 1
  const pct = (index / FINALE) * 100
  const ticks = data.keys.filter(k => isKeyMove(k, keyMode)).map(k => {
    const cls = k.kind === 'check' ? 'chk' : k.kind === 'win' ? 'win' : 'cap'
    return `<i class="tick ${cls}" style="left:${round((k.n / den) * 100)}%"></i>`
  }).join('')
  const count = index > M ? `共 <b>${M}</b> 手 · 终局` : `第 <b>${index}</b> / ${M} 手`
  const hits = data.keys.filter(k => isKeyMove(k, keyMode)).length
  return `<div class="prow"><span class="pcount">${count}</span><span class="ptime">关键手 <b>${hits}</b> 处</span></div>` +
    `<div class="track"><div class="fill" style="width:${round(pct)}%"></div>${ticks}` +
    `<span class="cur" style="left:calc(${round(pct)}% - ${round(pct * 0.065)}px)"></span></div>`
}

/* ---------------------------------------------------------------- 入口 */
/**
 * @param {object} data replayData() 的产物
 * @param {number} index 0=开局，1..M=第 N 手落定后，M+1=终局卡
 * @param {object} [options] layout / t（本步已播秒数）/ keyMode / animate
 */
export function stageHtml(data, index, options = {}) {
  const { layout = 'landscape', t = 0, keyMode = 'major', animate = true } = options
  const portrait = layout === 'portrait'
  const M = data.moves.length
  const FINALE = M + 1
  const isFinale = index >= FINALE
  const winner = typeof data.result?.winner === 'number' ? data.result.winner : null
  const isDraw = Boolean(data.result) && winner === null
  const key = !isFinale && index >= 1 ? data.keys.find(k => k.n === index) : null
  /* 与离线 HTML 保持一致：吃子/将军/胜局的「效果」只看本手是不是关键手，
     档位只筛「推近幅度」与进度条刻度（药丸标签也照原样显示）。 */
  const fxOn = animate && Boolean(key)
  const pushOn = fxOn && isKeyMove(key, keyMode)
  const last = index >= 1 && index <= M ? data.moves[index - 1] : null
  const active = isFinale ? -1 : (last ? last.p : 0)

  const cardScale = isFinale ? finaleScale(t) : (pushOn ? pushScale(t) : 1)
  const boardStyle = fxOn && key.kind === 'capture' ? `transform:translate(0,${round(shake(t))}px)` : ''
  const [speechOpacity, speechShift] = fadeUp(t, .2)
  const [finaleOpacity, finaleShift] = fadeUp(t, .28)

  const narrative = isFinale
    ? `<div class="finale" data-kind="${isDraw ? 'draw' : 'win'}" style="opacity:${round(finaleOpacity)};transform:translateY(${round(finaleShift)}px)">` +
      `<small>终局</small><p>${esc(data.result?.message || '比赛已结束。')}</p></div>`
    : (() => {
        const entries = data.moves.slice(0, index).slice(-6, -1).reverse()
        const recent = entries.length
          ? `<div class="recent"><div class="rtitle">回合记录</div><div class="rlist">` +
            entries.map(m => `<div class="rentry"><b>${m.n} · ${esc(data.players[m.p].name)}</b><span>${esc(m.s)}</span></div>`).join('') +
            `</div></div>`
          : ''
        const who = last
          ? `<img class="logo" src="${data.players[last.p].logo || ''}" alt="">${esc(data.players[last.p].name)} · 本手发言`
          : '开局'
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
    `<div class="hero"><em class="hlbl">${isFinale ? '终局' : '当前手数'}</em>` +
    `<b class="n">${isFinale ? M : index}</b><span class="t">/ ${M} 手</span>` +
    `<div class="heroTag">${pillHtml(key, isFinale, isDraw)}</div></div>` +
    `<div class="score">${scoreHtml(data, active, isFinale, winner, isDraw)}</div>` +
    `<div class="narrative">${narrative}</div>` +
    `<footer class="progress">${progressHtml(data, index, keyMode)}</footer>` +
    `<div class="safe-bottom"></div></aside></div>`
}