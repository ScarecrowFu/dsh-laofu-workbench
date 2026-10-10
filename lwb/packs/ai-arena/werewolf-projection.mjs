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
import { movesOf, werewolfPhaseLabel, werewolfScene, werewolfHostLine, werewolfVoteBoard, werewolfDeathCauses } from './presentation.mjs'

/**
 * 给 werewolfStage 用的那一刻公开局面。
 *
 * 只带舞台真正读到的字段：phase / hunterCause / day 决定抬头与昼夜，players 决定席位存活，
 * narration 决定主持人这一句，winner / terminalReason 决定终局图层。整份规则局面里的审计字段
 * （wolfChat / checks / night / moves …）不进画面，逐手各留一份也就不会按手数平方地累积。
 *
 * 票型（`votes` / `voteRound` / `voteTally` / `lastVote`）与死因（`deathCauses`）是**公共信息**，
 * 也是舞台要画的：少了它们，往回拖时「谁投了谁、谁几票、为什么出局」会整块消失，只剩直播那一帧
 * 有（跟随最新回合喂的是记录自己的 state）。规则层逐票替换这些对象、从不原地改，快照之间因此
 * 不会互相污染；仍然逐手复制一份，与 `players` / `narration` 同一个规矩。
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
  const causes = {}
  for (const death of state.deaths || []) causes[death.seat] = death.cause
  return {
    phase: state.phase,
    hunterCause: state.hunterCause ?? null,
    day: state.day,
    players: (state.players || []).map((player, index) => ({ seat: player.seat, role: roles?.[index] || player.role, alive: player.alive !== false })),
    narration: (narration || []).slice(-1),
    publicLog: (state.publicLog || []).slice(-1),
    lastNightDeaths: [...deaths],
    votes: (state.votes || []).map(vote => ({ seat: vote.seat, target: vote.target })),
    voteRound: state.voteRound || 0,
    voteTally: {
      counts: (state.voteTally?.counts || []).map(item => ({ seat: item.seat, count: item.count })),
      leaders: [...(state.voteTally?.leaders || [])],
      top: state.voteTally?.top || 0,
    },
    lastVote: state.lastVote ? { ...state.lastVote, votes: state.lastVote.votes.map(vote => ({ ...vote })), counts: state.lastVote.counts.map(item => ({ ...item })), leaders: [...state.lastVote.leaders] } : null,
    deathCauses: causes,
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
 * **一帧只讲一个时刻：这一步开场。** `host` 取的是「这一步开始时生效的那句播报」（即上一步打完之后
 * 的状态），存活、出局、天数与阶段也取同一刻 —— 回放/视频/观战都是「主持人先说、选手后说」：
 * 一帧里主持人台词与这一手的发言同时出现、配音里主持人先响。规则层却在行动推进**之后**才写
 * narration 与出局，所以直接取 `after` 会让每条结算播报提前到造成它的那一手（白天最后一位发言者
 * 那一帧就会先说「发言结束，请投票放逐一名玩家。」再说他自己的发言）。
 *
 * 存活与出局同样取这一步开场，于是**宣布与出局同帧**：本手的结果出现在下一手那一帧，由主持人
 * 当场说出来、画面同时画出来。`deaths` 因此是「相对上一帧的增量」，也就是这一步开场时刚被宣布的
 * 那一批出局（出局动效与进度条上的关键手刻度都跟着落在宣布那一帧）。
 *
 * 代价是最后一手的结算播报没有「下一手」可挂（谁被放逐、猎人带走了谁），它交给终局卡：
 * 这里单独给出 `closing`，由 `replay/data.mjs` 拼进终局文案与终局那一手的配音。**最后一手的
 * 存活名单与出局也一样**（`finalAlive` / `finalDeaths`）：终局帧不能再从最后一手的快照里推，
 * 否则最后一手出局的人会在终局席位上「复活」。
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
    /* 最后一手的存活与出局（终局帧用）：不可重放时为 null，调用方回落到记录自己的 state。 */
    finalAlive: null,
    finalDeaths: [],
    /* 座位 → 死因（整局）。死因一旦写下就不再变，所以终局帧与中间帧读同一份；
       不可重放时退回记录自己的 state，至少让「为什么出局」还在。 */
    deathCauses: werewolfDeathCauses(match.state || {}),
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
  /* 已经画过的出局数：每一步的 `deaths` 是相对上一帧的增量，也就是这一步开场时主持人
     刚刚宣布完的那一批。 */
  let shown = 0
  for (const move of movesOf(match)) {
    /* 一帧 = 这一步开场时观众已经知道的局面：存活、出局、天数、阶段与台词取的都是 apply
       之前的那一刻。规则是在行动推进**之后**才写出局与结算播报，所以本手的结果一律出现在
       下一手那一帧 —— 由主持人当场宣布、画面同时画出（宣布与出局同帧）。
       从前存活与出局取的是 `after`，于是「出局」永远比宣布它的那句话早一帧：
       复投最后一票那一帧就把被放逐者画成出局，而主持人还在说「进入复投」；
       夜里被刀的人也在夜里就灰化，天亮宣布时才第一次被说出来。 */
    const phase = state.phase, hunterCause = state.hunterCause || null, day = state.day
    const host = werewolfHostLine({ narration: state.narration })
    const deaths = state.deaths.slice(shown).map(death => death.seat)
    shown = state.deaths.length
    const snapshot = { ...snapshotOf(state, deaths, dealt, state.narration), phase, hunterCause, day }
    steps.push({
      n: move.moveNumber,
      seat: move.player + 1,
      phase,
      label: werewolfPhaseLabel(phase, hunterCause),
      scene: werewolfScene(phase, hunterCause),
      day,
      alive: state.players.filter(player => player.alive).map(player => player.seat),
      deaths,
      host,
      /* 票型取自与快照同一个时刻：观战页往回拖画快照、离线回放与视频读这个字段，
         两者是同一次计算的两个出口，不可能各自漂移。 */
      voteBoard: werewolfVoteBoard(snapshot),
      snapshot,
    })
    let after
    try { after = werewolf.apply(state, move.action, move.player) } catch { return timeline }
    state = after
  }
  timeline.opening = opening
  timeline.steps = steps
  timeline.replayable = true
  /* 最后一手的结果没有「下一手」那一帧可挂：终局卡承接。席位名单与出局动效都要给终局的调用方，
     否则最后一手被放逐/带走的人会在终局帧里「复活」。 */
  timeline.finalAlive = state.players.filter(player => player.alive).map(player => player.seat)
  timeline.finalDeaths = state.deaths.slice(shown).map(death => death.seat)
  /* 重放到终局的死因表：整局重放到底时以重放结果为准（与 finalAlive / finalDeaths 同一口径）。 */
  timeline.deathCauses = werewolfDeathCauses(state)
  /* 重放到底之后状态上剩下的最后一条播报：它是「整局结束」那一句，交给终局卡。 */
  timeline.closing = werewolfHostLine({ narration: state.narration })
  /* 只有整局重放到底，才敢用重放出的阵营覆盖记录自己的口径。 */
  if (typeof state.winner === 'string') timeline.winnerSide = state.winner
  return timeline
}

/**
 * 观战页停在 `currentStep` 时该画哪一份局面。
 *
 * 一帧只讲一个时刻（与逐手投影同一条契约）：
 * - 往回拖（`currentStep` 小于手数）画第 `currentStep` 步的快照 —— 那一步**开场**的公开局面；
 * - 停在最新（`currentStep` 到最后一手）分两种现场：
 *   - 下一位选手的回合已经在飞（`activeTurn` 有值）：观众已经从上一位的结算播报里听到结果，
 *     画面要与那句播报同一个时刻 —— 直接用记录自己的 `state`（存活与台词都是这一刻，
 *     `state.narration` 的最后一条就是刚才那句结算）。否则会出现「主持人还在说上一步的引导，
 *     席位却已经画出上一步的结果」。
 *   - 空闲停在最后一手（暂停、或刚结算完还没轮到下一位）：这一帧仍是「最后一手」那一帧，
 *     取它的开场快照 —— 台词与存活都停在那一刻，本手的结果等下一帧（结算播报）再画。
 * - 终局（记录里已有胜负）一律用记录自己的 state：终局台词要把最后一条结算播报一起说完。
 */
export function werewolfStageState(match, timeline, currentStep) {
  if (!timeline?.replayable) return match.state
  if (currentStep >= timeline.steps.length) {
    /* 已经分出胜负时 stage 说的是裁决文案：终局那一帧的台词由 werewolfHostLine 的 finale 分支
       给出，它要把最后一条结算播报一起说完，所以这里不能把台词换成开场播报。 */
    if (typeof match.state?.winner === 'string') return match.state
    if (match.activeTurn?.turnId) return match.state
    return timeline.steps.at(-1)?.snapshot || match.state
  }
  return currentStep <= 0 ? timeline.opening : timeline.steps[currentStep - 1].snapshot
}