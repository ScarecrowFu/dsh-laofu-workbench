/**
 * 狼人杀的观众侧逐手投影：`seed + 档位 + 已提交动作序列` → 每一步之后的公开局面。
 *
 * 为什么必须有这一层：`move.action` 只写「狼刀 3 号」，3 号**是否真的出局**取决于后面那手
 * 女巫有没有用解药、投票是不是平票、猎人有没有开枪；天数与阶段也由规则推进。棋盘类游戏
 * 可以只靠落子序列现推局面，狼人杀不行 —— 席位存活、出局、昼夜与主持人台词只能由规则结算得出。
 *
 * 观战页（client-source.mjs）与离线回放/视频投影（replay/data.mjs）共用这一份，理由是本仓库
 * 一贯的「三处同源」：同一个 apply 序列喂给同一个 werewolfStage，画面才不会各自漂移。
 * 规则引擎只看参数（没有时钟、随机源或宿主 API），所以浏览器里也能逐手重放。
 */
import { werewolf, WEREWOLF_PRESETS, WEREWOLF_OPENING } from './werewolf.mjs'
import { movesOf, werewolfPhaseLabel, werewolfScene, werewolfHostLine } from './presentation.mjs'

/**
 * 给 werewolfStage 用的那一刻公开局面。
 *
 * 只带舞台真正读到的字段：phase / hunterCause / day 决定抬头与昼夜，players 决定席位存活，
 * narration 决定主持人这一句，winner / terminalReason 决定终局图层。整份规则局面里的审计字段
 * （wolfChat / checks / votes / night / moves …）不进画面，逐手各留一份也就不会按手数平方地累积。
 *
 * `lastNightDeaths` 在这里是「这一步宣布的出局」：直播路径直接喂规则 state 时它是规则字段，
 * 逐手快照里则是本步的 deaths 增量 —— 舞台只拿它决定 data-act（出局强调），两种读法都对得上。
 * `players` / `narration` / `publicLog` 按这一刻截断，快照之间不共享可变数组。
 *
 * `roles` 是发牌时落盘的权威身份（整局不变）。重放也会发一次牌，但画面上的身份标记一律取落盘那一份：
 * 否则某天改了发牌算法，历史对局往回拖时身份会跟着变，而终局帧（读 match.state）却不变。
 *
 * `narration` 单独给一份：这一步的存活、出局与昼夜取「打完这一步」，台词却取「这一步开场」
 * （见 werewolfTimeline 的逐手投影），两者不是同一时刻的切片，所以不能都从 `state` 上截。
 */
function snapshotOf(state, deaths = [], roles = null, narration = state.narration) {
  return {
    phase: state.phase,
    hunterCause: state.hunterCause ?? null,
    day: state.day,
    players: (state.players || []).map((player, index) => ({ seat: player.seat, role: roles?.[index] || player.role, alive: player.alive !== false })),
    narration: (narration || []).slice(-1),
    publicLog: (state.publicLog || []).slice(-1),
    lastNightDeaths: [...deaths],
    winner: state.winner ?? null,
    terminalReason: state.terminalReason ?? null,
  }
}

/**
 * 逐手时间线。`steps[k - 1]` 同时带两样东西：
 * - 离线回放/视频要的逐手描述（n / seat / phase / label / scene / day / alive / deaths / host）——
 *   形状与字段顺序和从前逐字一致，`replay/data.mjs` 摘掉 `snapshot` 后原样落进产物；
 * - `snapshot`：给 werewolfStage 用的那一刻公开局面，观战页往回拖时画它。
 *
 * **主持人台词锚在这一手的开场，不是这一手的结算。** `host` 取的是「这一步开始时生效的那句播报」
 * （即上一步打完之后的状态），因为回放/视频/观战都是「主持人先说、选手后说」：一帧里主持人台词与
 * 这一手的发言同时出现、配音里主持人先响。规则层却在行动推进**之后**才写 narration，所以直接取
 * `after.narration` 会让每条结算播报提前到造成它的那一手 —— 白天最后一位发言者那一帧就会先说
 * 「发言结束，请投票放逐一名玩家。」再说他自己的发言（用户报的就是这一处）。
 * 于是每一步携带的是 `state.narration`（进入这一步时），而不是 `after.narration`。
 *
 * 代价是最后一手的结算播报没有「下一手」可挂（谁被放逐、猎人带走了谁），它交给终局卡：
 * 这里单独给出 `closing`，由 `replay/data.mjs` 拼进终局文案与终局那一手的配音。
 *
 * 不是狼人杀返回 null（调用方本来就按 game.id 分流）；是狼人杀但档位取不到 seed 或重放中途
 * 失败时，`replayable` 为 false、`steps` 为空，画面退回「只播发言、不画身份」的旧行为。
 */
export function werewolfTimeline(match) {
  if (match?.game?.id !== 'werewolf') return null
  const seatCount = (match.players || []).length
  /* 档位取 config.seats；1.0.0 的记录没有它，按选手数推断（当时的 6 人牌型与现在一致），
     与 replay/data.mjs 的旧门禁同口径：只挡「规则牌型变了」，不因版本号把历史对局判成不可重放。 */
  const seats = Number.isInteger(match.config?.seats) ? match.config.seats : seatCount
  const timeline = {
    replayable: false,
    seatCount,
    seats,
    opening: null,
    steps: [],
    /* 不可重放时画面仍要报胜负：终局口径回落到记录自己的 state。 */
    winnerSide: typeof match.state?.winner === 'string' ? match.state.winner : null,
    terminalReason: match.state?.terminalReason || match.result?.message || '',
    host: WEREWOLF_OPENING,
    /* 整局重放到底时最后一条结算播报：没有下一手可挂，由终局卡接管。 */
    closing: '',
  }
  /* 档位必须与选手数一致（host 创建时就强制相等）：不一致的记录重放出来会多出无名席卡，
     宁可走「只播发言、不画身份」的降级路径，也不画一份自相矛盾的舞台。 */
  if (seats !== seatCount) return timeline
  if (!Number.isInteger(match.config?.seed) || !WEREWOLF_PRESETS[seats]) return timeline
  let state
  try { state = werewolf.create(match.config.seed, seats) } catch { return timeline }
  /* 画面上的身份取落盘那一份（replay/data.mjs 的席卡也是这么取的，两处同源）。 */
  const dealt = (match.state?.players || []).map(player => player.role)
  const opening = snapshotOf(state, [], dealt), steps = []
  for (const move of movesOf(match)) {
    /* 抬头取「动作发生在哪个阶段」，存活与出局取「这一步打完之后」——
       与离线回放的逐手描述同一条口径（replay/app.js 的 wolfFrame 就是这么读的）。 */
    const phase = state.phase, hunterCause = state.hunterCause || null, day = state.day
    /* 台词取「这一步开场」：规则层是在行动推进之后才写 narration 的，直接读 after 会把结算播报
       提前到造成它的那一手（见上面的说明）。 */
    const host = werewolfHostLine({ narration: state.narration })
    let after
    try { after = werewolf.apply(state, move.action, move.player) } catch { return timeline }
    const deaths = after.deaths.slice(state.deaths.length).map(death => death.seat)
    steps.push({
      n: move.moveNumber,
      seat: move.player + 1,
      phase,
      label: werewolfPhaseLabel(phase, hunterCause),
      scene: werewolfScene(phase, hunterCause),
      day,
      alive: after.players.filter(player => player.alive).map(player => player.seat),
      deaths,
      host,
      snapshot: { ...snapshotOf(after, deaths, dealt, state.narration), phase, hunterCause, day },
    })
    state = after
  }
  timeline.opening = opening
  timeline.steps = steps
  timeline.replayable = true
  /* 重放到底之后状态上剩下的最后一条播报：它是「整局结束」那一句，交给终局卡。 */
  timeline.closing = werewolfHostLine({ narration: state.narration })
  /* 只有整局重放到底，才敢用重放出的阵营覆盖记录自己的口径。 */
  if (typeof state.winner === 'string') timeline.winnerSide = state.winner
  return timeline
}

/**
 * 观战页停在 `currentStep` 时该画哪一份局面。
 *
 * 跟随最新回合（`currentStep` 已到最后一手）一律用记录自己的 state：那条路径与逐手投影无关，
 * 规则之外的现场信息（例如本手发言）不会因此丢掉，直播中的抬头、席位与终局图层照旧。
 * 只有真正往回拖，才换成第 `currentStep` 步的快照 —— 这正是「点播放从头播一次」的落点。
 *
 * 唯一例外是主持人台词：最新一帧的 `state.narration` 已经是这一手的**结算**播报，而这一帧同时
 * 还在显示本手的发言（观战页与回放/视频同一条契约：一帧里主持人先说、选手后说），所以这里换用
 * 这一手的开场播报。否则直播里最后一位发言者那一帧同样会先说「发言结束，请投票放逐一名玩家。」。
 */
export function werewolfStageState(match, timeline, currentStep) {
  if (!timeline?.replayable) return match.state
  if (currentStep >= timeline.steps.length) {
    /* 已经分出胜负时 stage 说的是裁决文案：终局那一帧的台词由 werewolfHostLine 的 finale 分支
       给出，它要把最后一条结算播报一起说完，所以这里不能把台词换成开场播报。 */
    if (typeof match.state?.winner === 'string') return match.state
    const opening = timeline.steps.at(-1)?.snapshot?.narration
    return Array.isArray(opening) && opening.length ? { ...match.state, narration: opening } : match.state
  }
  return currentStep <= 0 ? timeline.opening : timeline.steps[currentStep - 1].snapshot
}