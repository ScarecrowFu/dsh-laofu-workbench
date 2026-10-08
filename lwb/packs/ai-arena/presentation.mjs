export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
export const movesOf = match => (match.events || []).filter(event => event.type === 'move')
export const gameName = game => game?.name || (game?.id === 'xiangqi' ? '中国象棋' : game?.id === 'werewolf' ? '狼人杀' : '五子棋')
export const playerSide = (game, player) => game?.id === 'werewolf' ? `${player + 1} 号` : game?.id === 'xiangqi' ? (player ? '黑方' : '红方') : (player ? '白方' : '黑方')
export const ROLE_MARK = Object.freeze({ werewolf: '狼', seer: '预', witch: '巫', hunter: '猎', villager: '民' })
export const ROLE_NAME = Object.freeze({ werewolf: '狼人', seer: '预言家', witch: '女巫', hunter: '猎人', villager: '村民' })
/** 狼人杀每个阶段的中文名与所属场景。猎人开枪要按死因判断白天还是夜里。 */
export const WEREWOLF_PHASE = Object.freeze({
  'night-wolf': { label: '狼人行动', scene: 'night', slot: '夜间' },
  'night-seer': { label: '预言家查验', scene: 'night', slot: '夜间' },
  'night-witch': { label: '女巫用药', scene: 'night', slot: '夜间' },
  dawn: { label: '天亮了', scene: 'night', slot: '黎明' },
  'day-speech': { label: '白天发言', scene: 'day', slot: '白天' },
  'day-vote': { label: '投票放逐', scene: 'day', slot: '白天' },
  hunter: { label: '猎人开枪', scene: 'night', slot: '结算' },
  resolve: { label: '结算', scene: 'night', slot: '结算' },
  finished: { label: '终局', scene: 'day', slot: '终局' },
})
export const werewolfPhase = phase => WEREWOLF_PHASE[phase] || WEREWOLF_PHASE['night-wolf']
export const werewolfScene = (phase, hunterCause) => phase === 'hunter' ? (hunterCause === 'vote' ? 'day' : 'night') : werewolfPhase(phase).scene
export const werewolfPhaseLabel = (phase, hunterCause) => phase === 'hunter' ? '猎人开枪' : werewolfPhase(phase).label
const WEREWOLF_SIDE = Object.freeze({ village: '好人阵营', wolf: '狼人阵营' })
export const werewolfSideName = side => WEREWOLF_SIDE[side] || ''
const PORTRAIT_KEY = Object.freeze([
  ['chatgpt', ['chatgpt', 'openai', 'gpt']],
  ['claude', ['claude']],
  ['deepseek', ['deepseek']],
  ['doubao', ['doubao', '豆包']],
  ['kimi', ['kimi', 'moonshot']],
  ['mimo', ['mimo']],
  ['minimax', ['minimax']],
  ['qwen', ['qwen', '千问']],
  ['zhipu', ['zhipu', '智谱', 'glm']],
])
const PORTRAIT_FILES = Object.freeze(['chatgpt', 'claude', 'deepseek', 'doubao', 'kimi', 'mimo', 'minimax', 'qwen', 'zhipu', 'generic'])
/** 立绘按模型名匹配；没命中时按座位错开，避免六席都拿到同一张通用图。 */
export function portraitKey(player, seat = 0) {
  const text = [player?.model, player?.provider, player?.providerName, player?.name].filter(Boolean).join(' ').toLowerCase()
  const matched = PORTRAIT_KEY.find(([, needles]) => needles.some(needle => text.includes(needle)))?.[0]
  if (matched) return matched
  const slot = Number.isInteger(player?.id) ? player.id : seat
  return PORTRAIT_FILES[slot % PORTRAIT_FILES.length]
}
/** 观战与回放共用的六席投影：座位、身份、存活、当前行动者。 */
export function werewolfStage({ players = [], state = {}, active = null, speech = '' } = {}) {
  const phase = state.phase || 'night-wolf'
  const hunterCause = state.hunterCause || null
  const scene = werewolfScene(phase, hunterCause)
  const seats = (state.players || []).map((seat, index) => {
    const alive = seat.alive !== false
    return {
      seat: seat.seat,
      name: players[index]?.name || `${seat.seat} 号`,
      portrait: portraitKey(players[index], index),
      alive,
      role: seat.role,
      roleName: ROLE_NAME[seat.role] || '',
      mark: ROLE_MARK[seat.role] || '',
      active: active === index,
    }
  })
  return {
    scene, phase, day: state.day || 1,
    phaseLabel: werewolfPhaseLabel(phase, hunterCause),
    slot: werewolfPhase(phase).slot,
    seats, speech, deaths: [...(state.lastNightDeaths || [])],
    winnerSide: typeof state.winner === 'string' ? state.winner : null,
    result: state.winner ? state.terminalReason : '',
  }
}
export const actionLabel = (action, game) => game?.id === 'werewolf'
  ? (() => {
      const target = Number.isInteger(action?.target) ? `${action.target} 号` : ''
      return ({
        kill: `夜刀 ${target}`, check: `查验 ${target}`, shoot: `开枪带走 ${target}`,
        vote: `投票 ${target}`, speak: '发言',
        potion: action?.potion === 'save' ? '解药救人' : action?.potion === 'poison' ? `毒药 ${target}` : '空过',
      })[action?.type] || '行动'
    })()
  : game?.id === 'xiangqi' || (action?.from && action?.to)
  ? Number.isInteger(action?.from?.row) && Number.isInteger(action?.from?.col) && Number.isInteger(action?.to?.row) && Number.isInteger(action?.to?.col) ? `${action.from.row}行${action.from.col}列 → ${action.to.row}行${action.to.col}列` : '等待走子'
  : Number.isInteger(action?.row) && Number.isInteger(action?.col) ? `${action.row} 行 ${action.col} 列` : '等待落子'
export function frameAt(match, step) {
  const events = movesOf(match).slice(0, step)
  return { moves: events.map(event => ({ ...event.action, player: event.player })), current: events.at(-1) || null, speech: events.slice(-6).reverse(), result: step >= movesOf(match).length ? match.result : null }
}
const XIANGQI_PIECES = Object.freeze({
  r: ['车', 'red'], n: ['马', 'red'], b: ['相', 'red'], a: ['仕', 'red'], k: ['帅', 'red'], c: ['炮', 'red'], p: ['兵', 'red'],
  R: ['車', 'black'], N: ['馬', 'black'], B: ['象', 'black'], A: ['士', 'black'], K: ['将', 'black'], C: ['砲', 'black'], P: ['卒', 'black'],
})
const XIANGQI_INITIAL = [
  ['R', 'N', 'B', 'A', 'K', 'A', 'B', 'N', 'R'],
  [null, null, null, null, null, null, null, null, null],
  [null, 'C', null, null, null, null, null, 'C', null],
  ['P', null, 'P', null, 'P', null, 'P', null, 'P'],
  [null, null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null, null],
  ['p', null, 'p', null, 'p', null, 'p', null, 'p'],
  [null, 'c', null, null, null, null, null, 'c', null],
  [null, null, null, null, null, null, null, null, null],
  ['r', 'n', 'b', 'a', 'k', 'a', 'b', 'n', 'r'],
]
const isXiangqiMove = move => !!move && move.from && move.to
const coordinate = value => {
  if (!value || !Number.isInteger(value.row) || !Number.isInteger(value.col) || value.row < 1 || value.row > 10 || value.col < 1 || value.col > 9) return null
  return { row: value.row - 1, col: value.col - 1 }
}
export function xiangqiPosition(moves = []) {
  const board = XIANGQI_INITIAL.map(row => [...row])
  for (const move of moves) {
    const from = coordinate(move.from), to = coordinate(move.to)
    if (!from || !to) continue
    const code = board[from.row][from.col]
    if (!code) continue
    board[from.row][from.col] = null
    board[to.row][to.col] = code
  }
  return board
}
export function xiangqiBoardSvg(moves = [], { opacity = 1 } = {}) {
  const margin = 38, gap = 54, width = margin * 2 + gap * 8, height = margin * 2 + gap * 9
  const board = xiangqiPosition(moves)
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="中国象棋棋盘，${moves.length} 手"><defs><linearGradient id="ar-xq-wood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e0b16b"/><stop offset=".5" stop-color="#c99251"/><stop offset="1" stop-color="#b9793f"/></linearGradient><filter id="ar-xq-shadow"><feDropShadow dx="1.5" dy="2" stdDeviation="1.5" flood-color="#4b2d15" flood-opacity=".35"/></filter></defs><rect width="${width}" height="${height}" rx="6" fill="url(#ar-xq-wood)"/><rect x="10" y="10" width="${width - 20}" height="${height - 20}" rx="4" fill="none" stroke="#754a26" stroke-opacity=".55" stroke-width="1.5"/>`]
  const x = col => margin + col * gap, y = row => margin + row * gap
  for (let row = 0; row < 10; row++) parts.push(`<path d="M ${x(0)} ${y(row)} H ${x(8)}" stroke="#674622" stroke-opacity=".9" stroke-width="1.25"/><text x="18" y="${y(row) + 3}" text-anchor="middle" fill="#5e3e1e" font-size="10" font-family="sans-serif" font-weight="600">${row + 1}</text>`)
  for (let col = 0; col < 9; col++) {
    const path = col === 0 || col === 8 ? `M ${x(col)} ${y(0)} V ${y(9)}` : `M ${x(col)} ${y(0)} V ${y(4)} M ${x(col)} ${y(5)} V ${y(9)}`
    parts.push(`<path d="${path}" stroke="#674622" stroke-opacity=".9" stroke-width="1.25"/>`)
    parts.push(`<text x="${x(col)}" y="${height - 10}" text-anchor="middle" fill="#5e3e1e" font-size="10" font-family="sans-serif" font-weight="600">${col + 1}</text>`)
  }
  parts.push(`<rect x="${x(0)}" y="${y(4)}" width="${gap * 8}" height="${gap}" fill="#edd095" fill-opacity=".36"/><text x="${width / 2 - 80}" y="${y(4) + 34}" text-anchor="middle" fill="#784c28" font-family="serif" font-size="19" font-weight="700" letter-spacing="6">楚河</text><text x="${width / 2 + 80}" y="${y(4) + 34}" text-anchor="middle" fill="#784c28" font-family="serif" font-size="19" font-weight="700" letter-spacing="6">汉界</text>`)
  for (const [fromCol, fromRow, toCol, toRow] of [[3, 0, 5, 2], [5, 0, 3, 2], [3, 7, 5, 9], [5, 7, 3, 9]]) parts.push(`<path d="M ${x(fromCol)} ${y(fromRow)} L ${x(toCol)} ${y(toRow)}" stroke="#674622" stroke-width="1.1"/>`)
  for (const [row, col] of [[2, 1], [2, 7], [7, 1], [7, 7], [3, 0], [3, 2], [3, 4], [3, 6], [3, 8], [6, 0], [6, 2], [6, 4], [6, 6], [6, 8]]) parts.push(`<path d="M ${x(col) - 5} ${y(row) - 5} h 4 v -4 M ${x(col) + 5} ${y(row) - 5} h -4 v -4 M ${x(col) - 5} ${y(row) + 5} h 4 v 4 M ${x(col) + 5} ${y(row) + 5} h -4 v 4" fill="none" stroke="#674622" stroke-width="1"/>`)
  board.forEach((line, row) => line.forEach((code, col) => {
    if (!code || !XIANGQI_PIECES[code]) return
    const [label, side] = XIANGQI_PIECES[code], fill = side === 'red' ? '#b83c2e' : '#202723', stroke = side === 'red' ? '#79231c' : '#101512'
    parts.push(`<g opacity="${opacity}" filter="url(#ar-xq-shadow)"><circle cx="${x(col)}" cy="${y(row)}" r="20" fill="#f4e4bd" stroke="${stroke}" stroke-width="1.5"/><circle cx="${x(col)}" cy="${y(row)}" r="16.5" fill="none" stroke="${fill}" stroke-opacity=".55" stroke-width="1"/><text x="${x(col)}" y="${y(row) + 7}" text-anchor="middle" fill="${fill}" font-family="serif" font-size="22" font-weight="700">${label}</text></g>`)
  }))
  const last = moves.at(-1), lastTo = coordinate(last?.to)
  if (lastTo) parts.push(`<circle cx="${x(lastTo.col)}" cy="${y(lastTo.row)}" r="24" fill="none" stroke="#e45d3c" stroke-width="2.4"/>`)
  return `${parts.join('')}</svg>`
}
export function boardSvg(moves, { size = 15, opacity = 1, gameId = '' } = {}) {
  if (gameId === 'werewolf') return ''
  if (gameId === 'xiangqi' || moves?.some(isXiangqiMove)) return xiangqiBoardSvg(moves, { opacity })
  const margin = 34, gap = 32, end = margin + gap * (size - 1), extent = end + margin
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extent} ${extent}" role="img" aria-label="五子棋棋盘，${moves.length} 手"><defs><linearGradient id="ar-board-wood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d7a866"/><stop offset=".5" stop-color="#c6904e"/><stop offset="1" stop-color="#b9793f"/></linearGradient><radialGradient id="ar-stone-black" cx="30%" cy="25%"><stop offset="0" stop-color="#4a514c"/><stop offset=".55" stop-color="#1c2521"/><stop offset="1" stop-color="#0d1310"/></radialGradient><radialGradient id="ar-stone-white" cx="30%" cy="25%"><stop offset="0" stop-color="#fffdf7"/><stop offset=".65" stop-color="#e8e5dc"/><stop offset="1" stop-color="#bdb8ad"/></radialGradient></defs><rect width="${extent}" height="${extent}" rx="6" fill="url(#ar-board-wood)"/><path d="M 0 48 H ${extent} M 0 128 H ${extent} M 0 214 H ${extent} M 0 302 H ${extent} M 0 384 H ${extent}" stroke="#fff1c4" stroke-opacity=".12" stroke-width="2"/>`]
  for (let i = 0; i < size; i++) {
    const p = margin + i * gap
    parts.push(`<path d="M ${margin} ${p} H ${end} M ${p} ${margin} V ${end}" stroke="#674622" stroke-opacity=".84" stroke-width="1.15"/><text x="${p}" y="18" text-anchor="middle" fill="#5e3e1e" font-size="10" font-family="sans-serif" font-weight="600">${i + 1}</text><text x="15" y="${p + 3}" text-anchor="middle" fill="#5e3e1e" font-size="10" font-family="sans-serif" font-weight="600">${i + 1}</text>`)
  }
  for (const row of [4, 8, 12]) for (const col of [4, 8, 12]) parts.push(`<circle cx="${margin + (col - 1) * gap}" cy="${margin + (row - 1) * gap}" r="2.8" fill="#5a3a1b"/>`)
  moves.forEach((move, index) => {
    const x = margin + (move.col - 1) * gap, y = margin + (move.row - 1) * gap, last = index === moves.length - 1
    const fill = move.player === 0 ? 'url(#ar-stone-black)' : 'url(#ar-stone-white)', stroke = move.player === 0 ? '#0b100d' : '#a59e91', text = move.player === 0 ? '#fff8df' : '#3b2b1a'
    parts.push(`<g opacity="${last ? opacity : 1}"><circle cx="${x + 2}" cy="${y + 3}" r="13.5" fill="#4b2d15" opacity=".32"/><circle cx="${x}" cy="${y}" r="12.5" fill="${fill}" stroke="${stroke}" stroke-width="1.1"/><circle cx="${x - 4}" cy="${y - 4}" r="3.2" fill="#fff" opacity="${move.player === 0 ? '.16' : '.42'}"/><text x="${x}" y="${y + 3.5}" text-anchor="middle" font-family="sans-serif" font-size="10" font-weight="700" fill="${text}">${index + 1}</text>${last ? `<circle cx="${x}" cy="${y}" r="15.5" fill="none" stroke="#e45d3c" stroke-width="2.2"/>` : ''}</g>`)
  })
  return `${parts.join('')}</svg>`
}

/* ---------------------------------------------------------------- 游戏库卡片
   卡片口径（摘要、事实、封面种类）与赛制实现解耦：新增游戏在这里补一条即可；
   没有条目的游戏退化成"首字海报"，所以封面永远不会是空白方块。 */
export const GAME_CARDS = Object.freeze({
  gomoku: Object.freeze({
    cover: 'board', badge: '棋', note: '连五获胜',
    tagline: '15×15 自由五子棋，黑方先手，无禁手；连续五颗及以上获胜。',
    facts: Object.freeze(['15 × 15', '2 位选手', '黑方先手']),
    /* 封面示例手顺：黑 4 连 + 白 3 子封头 + 最后一手高亮，一眼看出"再一子即胜"。 */
    moves: Object.freeze([
      { row: 8, col: 8, player: 0 }, { row: 7, col: 8, player: 1 },
      { row: 8, col: 9, player: 0 }, { row: 7, col: 9, player: 1 },
      { row: 8, col: 10, player: 0 }, { row: 7, col: 10, player: 1 },
      { row: 8, col: 11, player: 0 },
    ]),
  }),
  xiangqi: Object.freeze({
    cover: 'board', badge: '棋', note: '将死获胜',
    tagline: '10×9 中国象棋，红方先手；将死或困毙获胜，无进展判和。',
    facts: Object.freeze(['9 × 10', '2 位选手', '红方先手']),
    moves: Object.freeze([]),
  }),
  werewolf: Object.freeze({
    cover: 'werewolf', badge: '牌', note: '阵营获胜',
    tagline: '6 人标准局：2 狼、预言家、女巫、猎人、村民；隐藏身份，昼夜推进。',
    facts: Object.freeze(['6 人', '6 位选手', '狼人夜刀']),
  }),
})
/** 卡片口径：已知游戏读登记表，未知游戏用"人数 + 规则版本 + 首字海报"兜底。 */
export function gameCard(game = {}) {
  const known = GAME_CARDS[game.id]
  return {
    cover: known?.cover || 'poster',
    badge: known?.badge || '',
    note: known?.note || '',
    tagline: known?.tagline || game.description || '',
    facts: known?.facts || [game.players ? `${game.players} 位选手` : '', game.version ? `规则 ${game.version}` : ''].filter(Boolean),
    poster: String(game.name || '').trim().slice(0, 1),
  }
}
/** 封面里的棋盘：棋盘类游戏返回可内联的 SVG，狼人杀与未知游戏返回空串（交给舞台或海报）。 */
export function gameCoverSvg(game = {}) {
  const card = gameCard(game)
  return card.cover === 'board' ? boardSvg(GAME_CARDS[game.id].moves, { gameId: game.id }) : ''
}
/* 封面用的六席演示阵容：发牌固定，只承担"这是隐藏身份游戏"的表达。 */
export const WEREWOLF_COVER_ROLES = Object.freeze(['werewolf', 'werewolf', 'seer', 'witch', 'hunter', 'villager'])
export function werewolfCoverSeats() {
  return WEREWOLF_COVER_ROLES.map((role, index) => ({
    seat: index + 1, role, active: index === 0,
    portrait: portraitKey(null, index), mark: ROLE_MARK[role], roleName: ROLE_NAME[role],
  }))
}
