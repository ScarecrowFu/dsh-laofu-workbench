/**
 * 把一场比赛投影成离线回放/视频真正需要的数据。
 *
 * 原始请求、系统指令、推理文本一律不进产物；离线 HTML 与 MP4 共用这一份投影，
 * 保证两边画面看到的是同一组手数、关键手、出局与终局文案。
 * 只在 Node 侧使用（imports xiangqi / werewolf 规则用于离线重放）。
 */
import { movesOf, gameName, portraitKey, ROLE_MARK, ROLE_NAME, werewolfPhaseLabel } from '../presentation.mjs'
import { xiangqi } from '../xiangqi.mjs'
import { werewolf } from '../werewolf.mjs'
import { assignVoices, playerLogo } from '../voices.mjs'

/** 象棋：用现有规则离线重放，取回落盘时被丢弃的 check / captured 标记。
    规则版本不一致时直接跳过，不按新规则解释历史落子。 */
function xiangqiFlags(match) {
  const flags = new Map()
  if (match.game?.id !== 'xiangqi' || match.game?.version !== xiangqi.version) return flags
  let state
  try { state = xiangqi.create() } catch { return flags }
  for (const event of movesOf(match)) {
    try { state = xiangqi.apply(state, event.action, event.player) } catch { break }
    const applied = state.moves[state.moves.length - 1]
    flags.set(event.moveNumber, { check: Boolean(applied.check), capture: applied.captured?.type || null })
  }
  return flags
}

/**
 * 狼人杀：用规则按 seed 离线重放，取回每一手真正发生的阶段、当步存活名单与出局座位。
 * 六席舞台、昼夜切换和出局动效都靠这份投影，而不是猜 move.action 的坐标。
 * 版本或 seed 不可用时返回 steps=null，画面降级为「只播发言、不画身份」。
 */
function werewolfProjection(match) {
  const roles = (match.state?.players || []).map(player => player.role)
  const projection = {
    seats: (match.players || []).map((player, index) => ({
      seat: index + 1,
      name: player.name ?? `${index + 1} 号`,
      provider: player.providerName || player.provider || '',
      model: player.model ?? '',
      role: roles[index] ?? '',
      mark: ROLE_MARK[roles[index]] || '',
      roleName: ROLE_NAME[roles[index]] || '',
      portrait: portraitKey(player, index),
      logo: playerLogo(player),
    })),
    steps: null,
    winnerSide: typeof match.state?.winner === 'string' ? match.state.winner : null,
  }
  if (match.game?.version !== werewolf.version || !Number.isInteger(match.config?.seed)) return projection
  let state
  try { state = werewolf.create(match.config.seed) } catch { return projection }
  const steps = []
  for (const move of movesOf(match)) {
    const phase = state.phase
    const hunterCause = state.hunterCause || null
    let after
    try { after = werewolf.apply(state, move.action, move.player) } catch { return projection }
    steps.push({
      n: move.moveNumber,
      seat: move.player + 1,
      phase,
      label: werewolfPhaseLabel(phase, hunterCause),
      scene: phase === 'hunter' ? (hunterCause === 'vote' ? 'day' : 'night') : (phase.startsWith('day') ? 'day' : 'night'),
      day: state.day,
      alive: after.players.filter(player => player.alive).map(player => player.seat),
      deaths: after.deaths.slice(state.deaths.length).map(death => death.seat),
    })
    state = after
  }
  projection.steps = steps
  projection.winnerSide = typeof state.winner === 'string' ? state.winner : projection.winnerSide
  return projection
}

/** 狼人杀的关键步：有人出局的那一步 + 终局。 */
function werewolfKeys(match, steps) {
  if (!steps?.length) return []
  const marked = new Map()
  for (const step of steps) if (step.deaths.length) marked.set(step.n, { kind: 'death', seats: step.deaths })
  const lastNumber = steps[steps.length - 1].n
  if (typeof match.state?.winner === 'string') marked.set(lastNumber, { kind: 'win' })
  else if (!marked.has(lastNumber)) marked.set(lastNumber, { kind: 'last' })
  return [...marked.entries()].map(([n, value]) => ({ n, ...value }))
}

/** 五子棋：从最后一手向四个方向数连子，取长度 >= 5 的那一串。 */
function winningRun(match) {
  const moves = movesOf(match)
  const winner = match.result?.winner
  if (typeof winner !== 'number') return null
  const last = moves[moves.length - 1]
  if (!last || last.player !== winner) return null
  const at = (row, col) => moves.find(move => move.action?.row === row && move.action?.col === col && move.player === winner)
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const line = [last]
    for (const sign of [1, -1]) {
      for (let step = 1; step < 15; step++) {
        const found = at(last.action.row + dr * step * sign, last.action.col + dc * step * sign)
        if (!found) break
        if (sign === 1) line.push(found); else line.unshift(found)
      }
    }
    if (line.length >= 5) return line.map(move => ({ row: move.action.row, col: move.action.col }))
  }
  return null
}

/** 关键手：获胜 > 将军 > 吃子；最后一手至少标为 last。狼人杀走 death/win。 */
function keyMoves(match, wolf) {
  const moves = movesOf(match)
  if (!moves.length) return []
  if (match.game?.id === 'werewolf') return werewolfKeys(match, wolf?.steps)
  const lastNumber = moves[moves.length - 1].moveNumber
  const marked = new Map()
  const flags = xiangqiFlags(match)
  for (const move of moves) {
    const flag = flags.get(move.moveNumber)
    if (!flag) continue
    if (flag.check) marked.set(move.moveNumber, { kind: 'check' })
    else if (flag.capture) marked.set(move.moveNumber, { kind: 'capture', piece: flag.capture })
  }
  if (typeof match.result?.winner === 'number') marked.set(lastNumber, { kind: 'win' })
  if (!marked.has(lastNumber)) marked.set(lastNumber, { kind: 'last' })
  return moves.filter(move => marked.has(move.moveNumber)).map(move => ({ n: move.moveNumber, ...marked.get(move.moveNumber) }))
}

/**
 * @param {object} match
 * @param {{ audio?: Map<number, { seconds: number, src?: string }> } | null} [audio]
 *   句序号（从 1 计）到配音。src 只放离线 HTML 需要内联的 data URL；视频用文件路径，不进画面 JSON。
 */
export function replayData(match, audio = null) {
  const moves = movesOf(match)
  const result = match.result || null
  const voices = assignVoices(match.players || [])
  const wolf = match.game?.id === 'werewolf' ? werewolfProjection(match) : null
  return {
    id: match.id,
    title: match.title ?? '',
    game: { id: match.game?.id ?? '', name: gameName(match.game), version: match.game?.version ?? '' },
    players: (match.players || []).map((player, index) => ({
      name: player.name ?? '',
      provider: player.providerName || player.provider || '',
      model: player.model ?? '',
      voice: voices[index] || '',
      logo: playerLogo(player),
    })),
    /* winner 只保留座位号（棋类）；隐藏身份游戏用 side 表示阵营，避免被当成和棋。 */
    result: result ? { kind: result.kind ?? '', winner: typeof result.winner === 'number' ? result.winner : null, side: wolf?.winnerSide || null, message: result.message ?? '' } : null,
    keys: keyMoves(match, wolf),
    winRun: winningRun(match),
    ...(wolf ? { werewolf: wolf } : {}),
    moves: moves.map(move => {
      const clip = audio?.get(move.moveNumber)
      return {
        n: move.moveNumber, p: move.player, a: move.action, s: move.speech || '',
        phase: move.phase || '',
        ...(clip ? { audioSec: clip.seconds, ...(clip.src ? { audio: clip.src } : {}) } : {}),
      }
    }),
  }
}