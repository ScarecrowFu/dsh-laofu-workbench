/**
 * 把一场比赛投影成离线回放/视频真正需要的数据。
 *
 * 原始请求、系统指令、推理文本一律不进产物；离线 HTML 与 MP4 共用这一份投影，
 * 保证两边画面看到的是同一组手数、关键手、出局与终局文案。
 * 只在 Node 侧使用（imports xiangqi / werewolf 规则用于离线重放）。
 */
import { movesOf, gameName, matchTitle, winningRun, assignPortraits, ROLE_MARK, ROLE_NAME, werewolfCastColumns, werewolfHostLine } from '../presentation.mjs'
import { xiangqi } from '../xiangqi.mjs'
import { werewolfTimeline } from '../werewolf-projection.mjs'
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
 * 狼人杀：用规则按 seed + 档位离线重放，取回每一手真正发生的阶段、当步存活名单、出局座位
 * 与主持人那一手的播报。席位舞台、昼夜切换、出局动效和台词都靠这份投影，
 * 而不是猜 move.action 的坐标，也不是在画面层另写一份文案。
 *
 * 逐手重放本身在 `werewolf-projection.mjs` —— 观战页往回拖时画的就是同一份快照，
 * 所以「观战 / 离线回放 / 视频」三处看到的是同一组存活、天数与台词，不会各自漂移。
 * 这里只把快照摘掉，留下产物真正要内联的逐手描述（形状与从前逐字节一致）。
 * 档位不可用时 steps=null，画面降级为「只播发言、不画身份」，但仍保留开局与终局播报。
 */
function werewolfProjection(match, portraits) {
  const roles = (match.state?.players || []).map(player => player.role)
  const seatCount = (match.players || []).length
  const timeline = werewolfTimeline(match)
  const terminalReason = match.state?.terminalReason || match.result?.message || ''
  /* 台词锚在「本手开场」（见 werewolf-projection.mjs），所以最后一手的结算播报没有下一手可挂：
     谁被放逐、猎人带走了谁由终局卡说出来，否则它会提前到当天最后一位发言/投票者嘴上。 */
  const closing = timeline.steps.length && timeline.closing && timeline.closing !== timeline.steps[timeline.steps.length - 1].host ? timeline.closing : ''
  const finaleLine = `${closing}${werewolfHostLine({ winnerSide: timeline.winnerSide, terminalReason, finale: true })}`
  return {
    seats: (match.players || []).map((player, index) => ({
      seat: index + 1,
      name: player.name ?? `${index + 1} 号`,
      provider: player.providerName || player.provider || '',
      model: player.model ?? '',
      role: roles[index] ?? '',
      mark: ROLE_MARK[roles[index]] || '',
      roleName: ROLE_NAME[roles[index]] || '',
      portrait: portraits[index],
      logo: playerLogo(player),
    })),
    columns: { landscape: werewolfCastColumns(seatCount, 'landscape'), portrait: werewolfCastColumns(seatCount, 'portrait') },
    steps: timeline.replayable ? timeline.steps.map(({ snapshot, ...step }) => step) : null,
    /* 最后一手的存活与出局：逐手快照讲的是「本手开场」，最后一手的结果没有下一帧可挂，
       由终局帧承接（否则最后一手出局的人会在终局席位上复活）。 */
    finalAlive: timeline.finalAlive ?? null,
    finalDeaths: timeline.finalDeaths ?? [],
    winnerSide: timeline.winnerSide,
    host: timeline.host,
    /* 终局正文：`finale` 是 werewolfHostLine 的 finale 口径 ——「最后一条结算播报 + 裁决」，
       与终局那一格的配音同源（见 hostNarrationLines）。它从前挂在主持人口播那一格，
       现在整格让给胜负卡，所以正文也归胜负卡。判负 / 取消这类没有裁决文案的记录补上
       result.message，保证「为什么结束」永远在画面上。 */
    finale: finaleLine,
    finaleBody: !finaleLine ? terminalReason : (!terminalReason || finaleLine.includes(terminalReason)) ? finaleLine : `${finaleLine}${terminalReason}`,
  }
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
 * 主持人台词按「换句」取：同一句不重复合成，挂在这一手播放。
 * 开局播报挂在第一手（第 0 帧没有音频槽），随后每个让台词变化的行动各占一手——
 * 台词是「本手开场」口径（见 werewolf-projection.mjs），所以它落在**进入新阶段的那一手**，
 * 也就是主持人先说、选手后说的那一手。最后一手的结算播报没有下一手可挂，落在终局卡那一手。
 * 降级投影（没有 steps）只保留开局播报；不是狼人杀就没有主持人台词。
 */
export function hostNarrationLines(match) {
  if (match.game?.id !== 'werewolf') return []
  const timeline = werewolfTimeline(match)
  if (!timeline.host) return []
  const lines = [{ n: 1, text: timeline.host }]
  if (!timeline.steps.length) return lines
  let previous = timeline.host
  for (const step of timeline.steps) {
    if (!step.host || step.host === previous) continue
    previous = step.host
    const last = lines[lines.length - 1]
    /* 同一手连续推进两个阶段（例如单狼局：狼刀与查验落在同一手）时合成一条，一手只留一段主持人音频 */
    if (last.n === step.n) last.text = `${last.text}${step.host}`
    else lines.push({ n: step.n, text: step.host })
  }
  /* 整局结束时剩下的最后一条播报：挂在终局卡那一手（手数 + 1），时间轴给它留出这一句。 */
  if (timeline.closing && timeline.closing !== previous) lines.push({ n: timeline.steps.length + 1, text: timeline.closing })
  return lines
}

/** 每一手的配音可以有两段：主持人先说，选手后说。旧调用方只给单轨（选手发言），这里兼容。 */
function moveAudio(clip) {
  if (!clip) return { host: null, speech: null }
  const host = Number(clip.host?.seconds) > 0 ? clip.host : null
  const speech = clip.speech
    ? (Number(clip.speech.seconds) > 0 ? clip.speech : null)
    : (Number(clip.seconds) > 0 ? { seconds: clip.seconds, src: clip.src } : null)
  return { host, speech }
}

/** 终局卡那一手的主持人配音（见 hostNarrationLines）：它不占手数，单独挂在终局上。
    离线回放按 finaleAudioSec 把终局帧拉长到放得下这一句；视频侧的同一条数据在 export.mjs 里取。 */
function finaleAudio(audio, moveCount) {
  const { host } = moveAudio(audio?.get(moveCount + 1))
  return host ? { finaleAudioSec: Number(host.seconds), ...(host.src ? { finaleAudio: host.src } : {}) } : {}
}

/**
 * @param {object} match
 * @param {Map<number, { host?: { seconds: number, src?: string }, speech?: { seconds: number, src?: string } }> | null} [audio]
 *   手数 → 这一手的配音。`src` 只放离线 HTML 需要内联的 data URL；视频用文件路径，不进画面 JSON。
 *   旧的单轨形状 `{ seconds, src }` 仍按「选手发言」解释。狼人杀最后一条结算播报挂在 `手数 + 1`
 *   （见 hostNarrationLines），在同一张表里取。
 */
export function replayData(match, audio = null) {
  const moves = movesOf(match)
  const result = match.result || null
  const voices = assignVoices(match.players || [])
  /* 整局形象分配只算一次：执行者卡（所有游戏）与狼人杀席卡必须取同一份，
     否则同一名选手在侧栏与舞台上会穿两套衣服。观战页用 werewolfStage 里的同一次分配。 */
  const portraits = assignPortraits(match.players || [])
  const wolf = match.game?.id === 'werewolf' ? werewolfProjection(match, portraits) : null
  const wolfData = wolf ? { ...wolf, ...finaleAudio(audio, moves.length) } : null
  return {
    id: match.id,
    title: matchTitle(match),
    game: { id: match.game?.id ?? '', name: gameName(match.game), version: match.game?.version ?? '' },
    players: (match.players || []).map((player, index) => ({
      name: player.name ?? '',
      provider: player.providerName || player.provider || '',
      model: player.model ?? '',
      voice: voices[index] || '',
      logo: playerLogo(player),
      /* 形象家族键（槽位语义见 presentation.assignPortraits）；素材在 model-art.mjs 的 full / bust 两档。 */
      portrait: portraits[index],
    })),
    /* winner 只保留座位号（棋类）；隐藏身份游戏用 side 表示阵营，避免被当成和棋。 */
    result: result ? { kind: result.kind ?? '', winner: typeof result.winner === 'number' ? result.winner : null, side: wolf?.winnerSide || null, message: result.message ?? '' } : null,
    keys: keyMoves(match, wolf),
    winRun: winningRun(match),
    ...(wolfData ? { werewolf: wolfData } : {}),
    moves: moves.map(move => {
      const { host, speech } = moveAudio(audio?.get(move.moveNumber))
      const hostSeconds = host ? Number(host.seconds) : 0
      const speechSeconds = speech ? Number(speech.seconds) : 0
      return {
        n: move.moveNumber, p: move.player, a: move.action, s: move.speech || '',
        phase: move.phase || '',
        /* audioSec 是这一手「说出来的总时长」（主持人 + 选手），时间轴按它拉长；
           hostAudioSec 是主持人那一段，用来把选手发言排在主持人之后。 */
        ...(hostSeconds || speechSeconds ? { audioSec: hostSeconds + speechSeconds } : {}),
        ...(hostSeconds ? { hostAudioSec: hostSeconds } : {}),
        ...(host?.src ? { hostAudio: host.src } : {}),
        ...(speech?.src ? { audio: speech.src } : {}),
      }
    }),
  }
}