export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
export const movesOf = match => (match.events || []).filter(event => event.type === 'move')
export const gameName = game => game?.name || (game?.id === 'xiangqi' ? '中国象棋' : game?.id === 'werewolf' ? '狼人杀' : '五子棋')
export const playerSide = (game, player) => game?.id === 'werewolf' ? `${player + 1} 号` : game?.id === 'xiangqi' ? (player ? '黑方' : '红方') : (player ? '白方' : '黑方')
/* 标题口径：游戏名是记录的固定属性，但 1.0.0 的棋类标题只有「A vs B」，
   而狼人杀标题自带「狼人杀」。这里按 game.id 现推前缀，既不回填历史 match.json，
   也让列表、面包屑、战报、离线回放与视频用同一份标题。
   没有 game.id 的旧数据不推断——否则未知游戏会被冒名成五子棋。 */
export function matchTitle(match) {
  const title = String(match?.title ?? '').trim()
  const name = match?.game?.id ? gameName(match.game) : ''
  if (!title) return name
  return !name || title.startsWith(name) ? title : `${name} · ${title}`
}
/* 获胜方口径：棋类 result.winner 是座位号，隐藏身份游戏是阵营。
   取消与未结束不产出文案，已结束却没有 result 的历史记录也不猜，交给调用方显示占位。 */
export function matchOutcome(match) {
  const result = match?.result
  if (!result || result.kind === 'cancelled') return null
  const winner = result.winner, detail = result.message || ''
  if (typeof winner === 'number') {
    const name = match.players?.[winner]?.name || playerSide(match.game, winner)
    return { label: `${name} 胜`, tone: 'win', detail }
  }
  if (winner === 'village' || winner === 'wolf') return { label: winner === 'wolf' ? '狼人阵营胜' : '好人阵营胜', tone: 'win', detail }
  if (result.kind === 'draw') return { label: '和棋', tone: 'draw', detail }
  return null
}
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
/** 身份 → 阵营。终局给胜方席位打金框、给席卡算「胜 / 负」都用这一处口径。 */
export const werewolfSide = role => role === 'werewolf' ? 'wolf' : 'village'
/* 席卡栅格列数：横屏 6 人一列排开，8 / 9 人折行；竖屏 3 列起。
   观战页、离线回放、视频三处共用，避免各写一套列数。 */
export function werewolfCastColumns(count = 6, layout = 'landscape') {
  if (layout === 'portrait') return count <= 6 ? 3 : count <= 8 ? 4 : 3
  return count <= 6 ? count : count <= 8 ? 4 : 5
}
/* 主持人播报：确定性推导，只吃规则的观众侧播报与终局信息，不读任何私有局面。
   台词由规则层写进 state.narration；离线回放/视频按规则重放，因此与直播逐字一致。 */
export function werewolfHostLine({ narration = [], publicLog = [], winnerSide = null, terminalReason = '', finale = false } = {}) {
  if (finale) {
    if (!winnerSide) return ''
    const message = terminalReason || (winnerSide === 'wolf' ? '狼人阵营获胜。' : '好人阵营获胜。')
    /* 终局那一帧把最后一条结算播报一并说完（谁被放逐 / 猎人带走了谁）：整局里只有它没有
       「下一手」可挂，观战、离线回放与视频的终局卡因此都读同一条口径。 */
    const closing = [...narration].map(item => (typeof item === 'string' ? item : item?.text) || '').filter(Boolean).at(-1) || ''
    return closing ? `${closing}${message}` : message
  }
  const lastNarration = [...narration].at(-1)
  if (lastNarration?.text) return lastNarration.text
  /* 1.0.0 的历史局面没有 narration：退回公开记录的最后一条。
     读起来是第三人称，但只复述公众已知的事，不编造。 */
  const lastEvent = [...publicLog].at(-1)
  return (typeof lastEvent === 'string' ? lastEvent : lastEvent?.text) || ''
}
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
/* 每个家族随包分发几套立绘：槽位 0 是 `<家族>.jpg`，其后是 `<家族>-2.jpg` … `<家族>-N.jpg`。
   这是「随包素材的事实值」，不是「保证不重复」的目标值：同一供应商下的不同模型
   （例如 qwen3.8-max 与 qwen-3.8-flash）会命中同一个家族，逐席独立取图就会撞成两张一样的形象，
   所以按家族成池分配。保证任意局面零重复需要 `变体数 >= 最大席位数`（现为 9），
   当前先铺 3 套，超出部分按确定性回绕复用；补素材即可收紧，不需要改这里的逻辑。 */
export const WEREWOLF_PORTRAIT_VARIANTS = 3
/** 单席立绘：按模型名匹配家族；没命中时按座位错开，避免六席都拿到同一张通用图。
    整局分配请用 `assignPortraits`，它在此基础上保证同家族多席不重复。 */
export function portraitKey(player, seat = 0) {
  const text = [player?.model, player?.provider, player?.providerName, player?.name].filter(Boolean).join(' ').toLowerCase()
  const matched = PORTRAIT_KEY.find(([, needles]) => needles.some(needle => text.includes(needle)))?.[0]
  if (matched) return matched
  const slot = Number.isInteger(player?.id) ? player.id : seat
  return PORTRAIT_FILES[slot % PORTRAIT_FILES.length]
}
function portraitFamily(player) {
  const text = [player?.model, player?.provider, player?.providerName, player?.name].filter(Boolean).join(' ').toLowerCase()
  return PORTRAIT_KEY.find(([, needles]) => needles.some(needle => text.includes(needle)))?.[0] || null
}
/** 模型身份的稳定排序键（FNV-1a）：只吃 provider/model，不吃座位，所以同一组模型跨局排序一致。 */
function portraitRank(player) {
  const text = [player?.provider, player?.model].filter(Boolean).join('/').toLowerCase()
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}
/** 槽位 0 直接用家族名，与历史素材和游戏库封面的轮转保持同一套命名。 */
const portraitVariant = (family, slot) => slot === 0 ? family : `${family}-${slot + 1}`
/**
 * 整局席位立绘：同家族内按模型身份稳定排序后顺序发槽位，使「同族席位数 <= 变体数」时画面零重复。
 * 顺序发槽位而不是直接哈希取模，换来两个性质：只出现一次的家族必然拿到主图（槽位 0），
 * 同一组模型反复对战时每人固定穿同一套。是 players 顺序与模型身份的纯函数，
 * 所以观战、离线回放、视频三处必然同图。
 * 未命中家族的选手仍走按座位错开的品牌轮转（10 席以内互不相同），但要绕开已被占用的家族，
 * 否则会和命中家族发出去的立绘撞车；游戏库封面直接调 `portraitKey`，不受这里影响。
 */
export function assignPortraits(players = []) {
  const ranked = new Map()
  players.forEach((player, seat) => {
    const family = portraitFamily(player)
    if (!family) return
    ranked.set(family, [...(ranked.get(family) || []), { seat, rank: portraitRank(player) }])
  })
  const slots = new Map()
  for (const list of ranked.values()) {
    list.sort((left, right) => left.rank - right.rank || left.seat - right.seat)
    list.forEach((entry, index) => slots.set(entry.seat, index % WEREWOLF_PORTRAIT_VARIANTS))
  }
  const claimed = new Set(ranked.keys())
  return players.map((player, seat) => {
    const family = portraitFamily(player)
    if (family) return portraitVariant(family, slots.get(seat))
    let index = (Number.isInteger(player?.id) ? player.id : seat) % PORTRAIT_FILES.length
    for (let step = 0; step < PORTRAIT_FILES.length && claimed.has(PORTRAIT_FILES[index]); step += 1) {
      index = (index + 1) % PORTRAIT_FILES.length
    }
    claimed.add(PORTRAIT_FILES[index])
    return PORTRAIT_FILES[index]
  })
}
/** 观战与回放共用的席位投影：座位、身份、存活、当前行动者，以及主持人这一手的播报。 */
export function werewolfStage({ players = [], state = {}, active = null, speech = '' } = {}) {
  const phase = state.phase || 'night-wolf'
  const hunterCause = state.hunterCause || null
  const scene = werewolfScene(phase, hunterCause)
  const winnerSide = typeof state.winner === 'string' ? state.winner : null
  /* 一次整局分配，各席按同一份 players 顺序取图——逐席独立取图会让同家族多模型撞成同一张。 */
  const portraits = assignPortraits(players)
  const seats = (state.players || []).map((seat, index) => {
    const alive = seat.alive !== false
    const winning = Boolean(winnerSide) && Boolean(seat.role) && werewolfSide(seat.role) === winnerSide
    return {
      seat: seat.seat,
      name: players[index]?.name || `${seat.seat} 号`,
      portrait: portraits[index] ?? portraitKey(players[index], index),
      alive,
      role: seat.role,
      roleName: ROLE_NAME[seat.role] || '',
      mark: ROLE_MARK[seat.role] || '',
      active: active === index,
      /* 终局席位标记：胜方阵营金框 + 每席「胜 / 负」徽标；没结束一律留空，不提前泄露胜负。 */
      winning,
      badge: winnerSide ? (winning ? '胜' : '负') : '',
    }
  })
  return {
    scene, phase, day: state.day || 1,
    phaseLabel: werewolfPhaseLabel(phase, hunterCause),
    slot: werewolfPhase(phase).slot,
    seats, seatCount: seats.length, columns: werewolfCastColumns(seats.length),
    speech, deaths: [...(state.lastNightDeaths || [])],
    winnerSide,
    result: state.winner ? state.terminalReason : '',
    /* 主持人台词：终局用裁决文案，其余用规则层这一手的播报。 */
    host: werewolfHostLine({ narration: state.narration, publicLog: state.publicLog, winnerSide, terminalReason: state.terminalReason, finale: Boolean(winnerSide) }),
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

/* ---------------------------------------------------------------- 判罚口径
   判负裁决的是协议遵守度，不是棋力：只在侧栏写一句「连续违规，判负」时，观众只能把它
   读成系统故障或棋力失败。这里把「第几手、连续几次、每次为什么、哪一手之后停盘」全部
   从 events.invalid 派生出来，不动 match.json 也不动 RPC，历史对局因此自动生效。 */
/** 违规回复记进 invalid 事件，但它自己不带手数：用同一回合的 request 事件补上。 */
function invalidEntries(match) {
  const events = match?.events || []
  const requests = new Map(events.filter(event => event.type === 'request').map(event => [event.turnId, event]))
  return events.flatMap((event, index) => {
    if (event.type !== 'invalid') return []
    const request = requests.get(event.turnId)
    const moveNumber = Number.isInteger(event.moveNumber) ? event.moveNumber
      : Number.isInteger(request?.moveNumber) ? request.moveNumber : null
    /* 落点从原文里尽力解析：格式违规常常根本没有能解析的 action，那就只解释原因。 */
    const action = parsedAction(event.raw)
    return [{
      index, player: event.player, attempt: Number.isInteger(event.attempt) ? event.attempt : null,
      error: event.error || '回复无效。', raw: event.raw || '', moveNumber,
      point: action ? actionLabel(action, match.game) : '',
    }]
  })
}
function parsedAction(raw) {
  try {
    const action = JSON.parse(String(raw ?? '').trim())?.action
    if (!action || typeof action !== 'object') return null
    if (Number.isInteger(action.row) && Number.isInteger(action.col)) return { row: action.row, col: action.col }
    if (Number.isInteger(action.from?.row) && Number.isInteger(action.from?.col) && Number.isInteger(action.to?.row) && Number.isInteger(action.to?.col)) return { from: action.from, to: action.to }
  } catch {}
  return null
}
/**
 * 判负明细：只取触发判负的那一串连续违规——同一选手、同一手、连着失败。
 * 每次重试都会换一个新的 turnId，所以不能按 turnId 分组，只能按「选手 + 手数」倒着收。
 * 收完之后若还有落子，说明这串违规并非终局原因，宁可不解释也不误导，返回 null。
 */
export function forfeitDetail(match) {
  if (match?.result?.kind !== 'forfeit') return null
  const entries = invalidEntries(match)
  if (!entries.length) return null
  const last = entries.at(-1)
  if ((match.events || []).slice(last.index + 1).some(event => event.type === 'move')) return null
  const attempts = []
  for (const entry of [...entries].reverse()) {
    if (entry.player !== last.player || entry.moveNumber !== last.moveNumber) break
    attempts.unshift(entry)
  }
  const seat = Number.isInteger(last.player) ? last.player : null
  return {
    seat, attempts, moveNumber: last.moveNumber, boardMoves: movesOf(match).length,
    name: (seat === null ? null : match.players?.[seat]?.name) || (seat === null ? '' : playerSide(match.game, seat)),
    reasons: [...new Set(attempts.map(attempt => attempt.error))],
  }
}
/* ---------------------------------------------------------------- 终局口径
   观战与离线回放/视频共用同一份胜负投影：哪几颗连子、终局胶囊说什么、徽标给谁、
   用哪种配色。三处各写一套时，「和棋」与「判负 / 取消」会各自漂移。
   连子只在五子棋成立（象棋动作是 from/to，天然取不到 row/col，因此返回 null）。 */
/** 五子棋连子：从最后一手向四个方向数，取长度 >= 5 的那一串。 */
export function winningRun(match) {
  const moves = movesOf(match)
  const winner = match?.result?.winner
  if (!Number.isInteger(winner)) return null
  const last = moves.at(-1), origin = last?.action
  if (!last || last.player !== winner || !Number.isInteger(origin?.row) || !Number.isInteger(origin?.col)) return null
  const at = (row, col) => moves.find(move => move.action?.row === row && move.action?.col === col && move.player === winner)
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const line = [last]
    for (const sign of [1, -1]) for (let step = 1; step < 15; step++) {
      const found = at(origin.row + dr * step * sign, origin.col + dc * step * sign)
      if (!found) break
      if (sign === 1) line.push(found)
      else line.unshift(found)
    }
    if (line.length >= 5) return line.map(move => ({ row: move.action.row, col: move.action.col }))
  }
  return null
}
/**
 * 终局胶囊与配色：`seat` 是棋类的获胜座位，`side` 是隐藏身份游戏的获胜阵营。
 * `win` 表示「有一方赢了」（含判负），用于决定徽标归属；配色按 kind 分开，
 * 和棋走中性、判负走警告、取消走普通——都不能借用胜利色。
 * `loser` 只在判负时给出被裁负的座位：判负的赢家是对手，负方席位不能凭空猜。
 */
export function finaleInfo(match) {
  const result = match?.result
  if (!result) return null
  const kind = result.kind || ''
  const seat = Number.isInteger(result.winner) ? result.winner : null
  const side = typeof result.winner === 'string' ? result.winner : null
  const draw = kind === 'draw'
  const win = !draw && (seat !== null || side !== null)
  const sideWin = side === 'wolf' ? '狼人获胜' : side === 'village' ? '好人获胜' : '比赛结束'
  const label = win
    ? (match?.game?.id === 'werewolf' ? sideWin : kind === 'forfeit' ? '判负' : '胜局')
    : draw ? '和棋' : kind === 'cancelled' ? '已取消' : ''
  const loser = kind === 'forfeit' ? forfeitDetail(match)?.seat ?? null : null
  return { kind, seat, side, win, draw, label, tone: win && kind !== 'forfeit' ? 'win' : kind === 'forfeit' ? 'warn' : draw ? 'draw' : 'plain', loser }
}
/** 棋类记分板徽标：获胜座位挂「胜」，判负的座位挂「负」，和棋两边挂「和」，其余留空。 */
export const seatBadge = (finale, index) => !finale ? '' : finale.draw ? '和' : finale.win && finale.seat === index ? '胜' : finale.loser === index ? '负' : ''
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
export function boardSvg(moves, { size = 15, opacity = 1, gameId = '', winRun = null } = {}) {
  if (gameId === 'werewolf') return ''
  if (gameId === 'xiangqi' || moves?.some(isXiangqiMove)) return xiangqiBoardSvg(moves, { opacity })
  const margin = 34, gap = 32, end = margin + gap * (size - 1), extent = end + margin
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extent} ${extent}" role="img" aria-label="五子棋棋盘，${moves.length} 手"><defs><linearGradient id="ar-board-wood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d7a866"/><stop offset=".5" stop-color="#c6904e"/><stop offset="1" stop-color="#b9793f"/></linearGradient><radialGradient id="ar-stone-black" cx="30%" cy="25%"><stop offset="0" stop-color="#4a514c"/><stop offset=".55" stop-color="#1c2521"/><stop offset="1" stop-color="#0d1310"/></radialGradient><radialGradient id="ar-stone-white" cx="30%" cy="25%"><stop offset="0" stop-color="#fffdf7"/><stop offset=".65" stop-color="#e8e5dc"/><stop offset="1" stop-color="#bdb8ad"/></radialGradient></defs><rect width="${extent}" height="${extent}" rx="6" fill="url(#ar-board-wood)"/><path d="M 0 48 H ${extent} M 0 128 H ${extent} M 0 214 H ${extent} M 0 302 H ${extent} M 0 384 H ${extent}" stroke="#fff1c4" stroke-opacity=".12" stroke-width="2"/>`]
  for (let i = 0; i < size; i++) {
    const p = margin + i * gap
    parts.push(`<path d="M ${margin} ${p} H ${end} M ${p} ${margin} V ${end}" stroke="#674622" stroke-opacity=".84" stroke-width="1.15"/><text x="${p}" y="18" text-anchor="middle" fill="#5e3e1e" font-size="10" font-family="sans-serif" font-weight="600">${i + 1}</text><text x="15" y="${p + 3}" text-anchor="middle" fill="#5e3e1e" font-size="10" font-family="sans-serif" font-weight="600">${i + 1}</text>`)
  }
  for (const row of [4, 8, 12]) for (const col of [4, 8, 12]) parts.push(`<circle cx="${margin + (col - 1) * gap}" cy="${margin + (row - 1) * gap}" r="2.8" fill="#5a3a1b"/>`)
  /* 胜局图层：金带铺在棋子底下、点亮环盖在棋子上，与离线回放的金带 + 五环同构。
     观战侧要的就是这套静态呈现；逐帧动画仍由 replay/markup.mjs 与 replay/app.js 各自叠加，
     它们不传 winRun，所以不会重画第二遍。 */
  const run = Array.isArray(winRun) && winRun.length >= 5 ? winRun : null
  const cell = point => ({ x: margin + (point.col - 1) * gap, y: margin + (point.row - 1) * gap })
  if (run) {
    const head = cell(run[0]), tail = cell(run[run.length - 1])
    parts.push(`<line x1="${head.x}" y1="${head.y}" x2="${tail.x}" y2="${tail.y}" stroke="#F0B429" stroke-width="44" stroke-linecap="round" class="winband" opacity=".55"/>`)
  }
  moves.forEach((move, index) => {
    const x = margin + (move.col - 1) * gap, y = margin + (move.row - 1) * gap, last = index === moves.length - 1
    const fill = move.player === 0 ? 'url(#ar-stone-black)' : 'url(#ar-stone-white)', stroke = move.player === 0 ? '#0b100d' : '#a59e91', text = move.player === 0 ? '#fff8df' : '#3b2b1a'
    parts.push(`<g opacity="${last ? opacity : 1}"><circle cx="${x + 2}" cy="${y + 3}" r="13.5" fill="#4b2d15" opacity=".32"/><circle cx="${x}" cy="${y}" r="12.5" fill="${fill}" stroke="${stroke}" stroke-width="1.1"/><circle cx="${x - 4}" cy="${y - 4}" r="3.2" fill="#fff" opacity="${move.player === 0 ? '.16' : '.42'}"/><text x="${x}" y="${y + 3.5}" text-anchor="middle" font-family="sans-serif" font-size="10" font-weight="700" fill="${text}">${index + 1}</text>${last ? `<circle cx="${x}" cy="${y}" r="15.5" fill="none" stroke="#e45d3c" stroke-width="2.2"/>` : ''}</g>`)
  })
  if (run) for (const point of run) {
    const { x, y } = cell(point)
    parts.push(`<circle cx="${x}" cy="${y}" r="16" fill="none" stroke="#F0B429" stroke-width="2.4" class="winring"/>`)
  }
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
    tagline: '标准局：2 狼、预言家、女巫、猎人、村民（8 人补 2 民，9 人补 1 狼 2 民）；隐藏身份，昼夜推进，主持人按规则播报。',
    facts: Object.freeze(['隐藏身份', '狼人夜刀', '主持人播报']),
  }),
})
/** 卡片口径：已知游戏读登记表，未知游戏用"人数 + 规则版本 + 首字海报"兜底。
    多档位游戏的人数标签由 seatOptions 现算，登记表里不再写死人数。 */
export function gameCard(game = {}) {
  const known = GAME_CARDS[game.id]
  const seatFact = game.seatOptions?.length > 1 ? `${game.seatOptions.join(' / ')} 人` : null
  return {
    cover: known?.cover || 'poster',
    badge: known?.badge || '',
    note: known?.note || '',
    tagline: known?.tagline || game.description || '',
    facts: known?.facts
      ? [...(seatFact ? [seatFact] : []), ...known.facts]
      : [seatFact || (game.players ? `${game.players} 位选手` : ''), game.version ? `规则 ${game.version}` : ''].filter(Boolean),
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
