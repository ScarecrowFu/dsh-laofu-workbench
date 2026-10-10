/**
 * 狼人杀规则，人数档位 6 / 8 / 9，默认 6。主持人不占席位。
 * 座位 1—N。身份由 seed + 档位发牌，局面是唯一真相，observe 只给出该座位此刻允许知道的内容。
 * 主持职能（发牌、夜序、天亮、投票统计、裁决）全部由本文件完成，台词记在 state.narration：
 * 它不进入 observe，只给观战/回放/视频，所以可以报出局人数而不泄漏任何私有信息。
 */

/* 档位与牌型。8 人取「狼 2 · 3 神 · 民 3」：屠城判据下好人偏强、局更长，
   换来模型局里好人阵营真有操作空间（3 狼 2 民的 8 人局一次误投就崩）。 */
export const WEREWOLF_PRESETS = Object.freeze({
  6: Object.freeze(['werewolf', 'werewolf', 'seer', 'witch', 'hunter', 'villager']),
  8: Object.freeze(['werewolf', 'werewolf', 'seer', 'witch', 'hunter', 'villager', 'villager', 'villager']),
  9: Object.freeze(['werewolf', 'werewolf', 'werewolf', 'seer', 'witch', 'hunter', 'villager', 'villager', 'villager']),
})
export const WEREWOLF_SEATS = Object.freeze([6, 8, 9])
export const WEREWOLF_DEFAULT_SEATS = 6
/* 兼容旧引用：6 人牌型就是默认档位。 */
export const WEREWOLF_ROLES = WEREWOLF_PRESETS[WEREWOLF_DEFAULT_SEATS]
export const ROLE_LABEL = Object.freeze({ werewolf: '狼人', seer: '预言家', witch: '女巫', hunter: '猎人', villager: '村民' })

/* 确定性播报台词。只有节奏与公共事件，不含任何私有局面（查验结果、狼队名单、身份）。 */
const NIGHT_GUIDE = '天黑请闭眼。狼人请睁眼，选择今晚要击杀的玩家。'
export const WEREWOLF_OPENING = NIGHT_GUIDE
const SEER_GUIDE = '预言家请睁眼，查验一名玩家的身份。'
const WITCH_GUIDE = '女巫请睁眼。'
const HUNTER_GUIDE = '猎人出局，可以开枪带走一名玩家。'

function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function dealRoles(seed = 0x574f4c46, seats = WEREWOLF_DEFAULT_SEATS) {
  const preset = WEREWOLF_PRESETS[seats]
  if (!preset) throw new Error(`狼人杀没有 ${seats} 人档位。可选 ${WEREWOLF_SEATS.join(' / ')} 人。`)
  const roles = [...preset]
  const random = mulberry32(seed)
  for (let index = roles.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    ;[roles[index], roles[swap]] = [roles[swap], roles[index]]
  }
  return roles
}

export function requireSeats(value) {
  if (!WEREWOLF_PRESETS[value]) throw new Error(`狼人杀没有 ${value} 人档位。可选 ${WEREWOLF_SEATS.join(' / ')} 人。`)
  return value
}

/* 播报只追加到 state.narration：它是观众侧数据，不进 observe，也不影响任何裁决。 */
function narrate(state, text) {
  if (!Array.isArray(state.narration)) state.narration = []
  state.narration.push({ day: state.day, phase: state.phase, text })
  return text
}

/* 一次行动可能连续推进多个阶段（女巫用药同时是天亮结算与白天开场），
   同一手里产生的播报合并成一条，观众看到的是这一手完整的一句话。 */
function flushNarration(state, before) {
  const added = state.narration.length - before
  if (added <= 1) return state
  const merged = state.narration.splice(before, added)
  state.narration.push({ day: merged[merged.length - 1].day, phase: merged[merged.length - 1].phase, text: merged.map(item => item.text).join('') })
  return state
}

function seatOf(state, seat) {
  const player = state.players.find(item => item.seat === seat)
  if (!player) throw new Error('座位不存在。')
  return player
}

export function aliveSeats(state) {
  return state.players.filter(player => player.alive).map(player => player.seat)
}

function wolves(state) {
  return state.players.filter(player => player.role === 'werewolf').map(player => player.seat)
}

function aliveWolves(state) {
  return state.players.filter(player => player.role === 'werewolf' && player.alive).map(player => player.seat)
}

export function winnerOf(state) {
  const wolvesAlive = aliveWolves(state).length
  const othersAlive = state.players.filter(player => player.alive && player.role !== 'werewolf').length
  if (wolvesAlive === 0) return { side: 'village', message: '狼人全灭，好人获胜。' }
  if (wolvesAlive >= othersAlive) return { side: 'wolf', message: '存活狼人数不少于其余存活玩家，狼人获胜。' }
  return null
}

function requireSeat(target, state, { allowSelf = false, actor } = {}) {
  const seats = state.players.length
  if (!Number.isInteger(target) || target < 1 || target > seats) throw new Error(`目标必须是 1—${seats} 的座位。`)
  const player = seatOf(state, target)
  if (!player.alive) throw new Error('目标已经出局。')
  if (!allowSelf && actor === target) throw new Error('不能选择自己。')
  return target
}

function publicEvent(state, text) {
  state.publicLog.push({ day: state.day, phase: state.phase, text })
}

function kill(state, seat, cause) {
  const player = seatOf(state, seat)
  if (!player.alive) return false
  player.alive = false
  state.deaths.push({ seat, cause, day: state.day, phase: state.phase })
  return true
}

function advance(state) {
  const winner = winnerOf(state)
  if (winner) {
    state.phase = 'finished'
    state.winner = winner.side
    state.terminalReason = winner.message
    state.pending = []
    return state
  }
  if (state.phase === 'resolve') openDay(state)
  return state
}

function openDay(state) {
  state.phase = 'day-speech'
  state.speakerCursor = 0
  state.speeches = []
  state.voteRound = 0
  state.votes = []
  state.voteTally = emptyTally()
  /* 新的一天开场，昨天的票型下画：它已经由前一夜的播报说完了。 */
  state.lastVote = null
  state.pending = aliveSeats(state).length ? [aliveSeats(state)[0]] : []
  publicEvent(state, `第 ${state.day} 天，请存活玩家按座位发言。`)
  narrate(state, `第 ${state.day} 天，请存活玩家依次发言。`)
}

function dawn(state) {
  state.phase = 'dawn'
  const wolfTarget = state.night.wolfTarget
  const saved = state.night.save && state.night.wolfTarget === wolfTarget
  const deadTonight = []
  if (wolfTarget && !saved) {
    if (kill(state, wolfTarget, 'wolf')) deadTonight.push(wolfTarget)
  }
  if (state.night.poison && state.night.poison !== (saved ? null : null)) {
    if (state.night.poison !== wolfTarget || !saved) {
      if (kill(state, state.night.poison, 'poison')) deadTonight.push(state.night.poison)
    }
  }
  const unique = [...new Set(deadTonight)].filter(seat => seatOf(state, seat).alive === false)
  state.lastNightDeaths = unique
  if (unique.length) {
    publicEvent(state, `天亮了，${unique.map(seat => `${seat} 号`).join('、')}出局。`)
    narrate(state, `天亮了，昨夜 ${unique.map(seat => `${seat} 号`).join('、')}出局。`)
  } else {
    publicEvent(state, '天亮了，昨夜平安夜。')
    narrate(state, '天亮了，昨夜是平安夜。')
  }
  state.phase = 'resolve'
  const hunterDeath = unique.find(seat => seatOf(state, seat).role === 'hunter')
  if (hunterDeath) {
    state.phase = 'hunter'
    state.pending = [hunterDeath]
    state.hunterCause = unique.includes(state.night.wolfTarget) && seatOf(state, hunterDeath).role === 'hunter' ? 'wolf-or-poison' : 'death'
    narrate(state, HUNTER_GUIDE)
    return state
  }
  return advance(state)
}

/* 计票。票数降序、同票按座位升序：展示层的票型条与席卡标记直接照这个顺序铺，
   不再各自排一遍；leaders 按座位升序，文字里的「2 号、5 号」因此可读。 */
function tally(votes) {
  const counts = new Map()
  for (const vote of votes) counts.set(vote.target, (counts.get(vote.target) || 0) + 1)
  let top = 0
  for (const count of counts.values()) top = Math.max(top, count)
  const leaders = [...counts.entries()].filter(([, count]) => count === top).map(([seat]) => seat).sort((left, right) => left - right)
  const list = [...counts.entries()].map(([seat, count]) => ({ seat, count })).sort((left, right) => right.count - left.count || left.seat - right.seat)
  return { counts: list, leaders, top }
}

const emptyTally = () => ({ counts: [], leaders: [], top: 0 })

/**
 * 开一轮投票。`votes` 与 `voteTally` 必须同进同退：展示层在投票阶段直接读它们画
 * 「已投几名 / 谁暂列几票」，只清一个就会画出「有人投了、票数为零」的自相矛盾画面。
 */
function openVoteRound(state, round) {
  state.voteRound = round
  state.votes = []
  state.voteTally = emptyTally()
  state.pending = aliveSeats(state)
}

/**
 * 本轮结算留档。票型是公共信息（明票），观众要看到「谁投了谁、谁几票」才能理解裁决，
 * 但它是**观众侧数据**：与 narration 同类，不进 observe、不参与任何裁决，所以单独合入
 * 不需要动 werewolf.version。
 *
 * `lastVote` 只留最近一轮（不是整局历史）：展示要的是「刚刚这一轮的票型」，而它在
 * 平票复投那一帧必须还在 —— 那一刻 `votes` 已经归零，只看 phase 会把平票画成一地空票。
 * 下一轮的第一张票落下时清掉它（见 applyMove 的 day-vote 分支），于是「本轮结果」只在
 * 结算播报那一帧到当天结束之间可见，第二天开场（openDay）不再残留。
 */
function closeRound(state, record) {
  state.lastVote = record
  state.votes = []
  state.voteTally = emptyTally()
}

/** 结算记录：清票之前把这一轮的票型、票数与裁决一起定下来。 */
function voteRecord(state, result) {
  return {
    day: state.day,
    round: state.voteRound,
    votes: state.votes.map(vote => ({ seat: vote.seat, target: vote.target })),
    counts: result.counts,
    leaders: result.leaders,
    top: result.top,
    tie: result.leaders.length > 1,
    eliminated: null,
    final: false,
  }
}

function closeSpeech(state) {
  state.phase = 'day-vote'
  openVoteRound(state, 1)
  publicEvent(state, '发言结束，请同时投票。')
  narrate(state, '发言结束，请投票放逐一名玩家。')
}

function closeVote(state) {
  const result = tally(state.votes)
  const { leaders } = result
  const record = voteRecord(state, result)
  if (leaders.length === 1) {
    const seat = leaders[0]
    record.eliminated = seat
    kill(state, seat, 'vote')
    publicEvent(state, `${seat} 号被投票出局。`)
    narrate(state, `${seat} 号被投票放逐。`)
    closeRound(state, record)
    const player = seatOf(state, seat)
    if (player.role === 'hunter') {
      state.phase = 'hunter'
      state.pending = [seat]
      state.hunterCause = 'vote'
      narrate(state, HUNTER_GUIDE)
      return state
    }
    state.day += 1
    return openNight(state)
  }
  if (state.voteRound === 1) {
    closeRound(state, record)
    openVoteRound(state, 2)
    publicEvent(state, `平票（${leaders.map(seat => `${seat} 号`).join('、')}），进行一次复投。`)
    narrate(state, `${leaders.map(seat => `${seat} 号`).join('、')}平票，进入复投。`)
    return state
  }
  record.final = true
  closeRound(state, record)
  publicEvent(state, '复投仍然平票，无人出局。')
  narrate(state, '复投仍然平票，本日无人出局。')
  state.day += 1
  return openNight(state)
}

function openNight(state) {
  const winner = winnerOf(state)
  if (winner) {
    state.phase = 'finished'
    state.winner = winner.side
    state.terminalReason = winner.message
    state.pending = []
    return state
  }
  state.phase = 'night-wolf'
  state.night = { wolfTarget: null, wolfProposal: null, save: false, poison: null, witchSeenDeath: null }
  state.lastNightDeaths = []
  narrate(state, NIGHT_GUIDE)
  const wolvesAlive = aliveWolves(state)
  state.pending = wolvesAlive.length ? [wolvesAlive[0]] : []
  if (!state.pending.length) return dawn(state)
  return state
}

export const werewolf = Object.freeze({
  id: 'werewolf',
  name: '狼人杀',
  version: '1.1.0',
  /* players 是默认人数（卡片兜底与旧引用），seatOptions 是可选档位。 */
  players: WEREWOLF_DEFAULT_SEATS,
  seatOptions: WEREWOLF_SEATS,
  description: '隐藏身份的标准狼人杀 · 好人在狼人全灭时获胜 · 存活狼人数不少于其余存活玩家时狼人获胜',
  create(seed = 0x574f4c46, seats = WEREWOLF_DEFAULT_SEATS) {
    const roles = dealRoles(seed, requireSeats(seats))
    return {
      seed,
      day: 1,
      phase: 'night-wolf',
      players: roles.map((role, index) => ({ seat: index + 1, role, alive: true, saveUsed: false, poisonUsed: false })),
      publicLog: [{ day: 1, phase: 'night-wolf', text: '天黑请闭眼。' }],
      /* 观众侧播报：不进 observe，离线回放/视频按规则重放时同样能还原。 */
      narration: [{ day: 1, phase: 'night-wolf', text: NIGHT_GUIDE }],
      wolfChat: [],
      checks: [],
      night: { wolfTarget: null, wolfProposal: null, save: false, poison: null, witchSeenDeath: null },
      deaths: [],
      lastNightDeaths: [],
      speeches: [],
      speakerCursor: 0,
      votes: [],
      voteRound: 0,
      /* 观众侧的票型：进行中一轮的票数与结算留档（见 closeRound / voteRecord）。 */
      voteTally: emptyTally(),
      lastVote: null,
      pending: [roles.findIndex(role => role === 'werewolf') + 1],
      winner: null,
      terminalReason: null,
      moves: [],
    }
  },
  observe(state, playerIndex) {
    const seat = playerIndex + 1
    const self = seatOf(state, seat)
    const base = {
      seat,
      seatCount: state.players.length,
      role: self.role,
      roleLabel: ROLE_LABEL[self.role],
      day: state.day,
      phase: state.phase,
      alive: aliveSeats(state),
      youAlive: self.alive,
      publicLog: state.publicLog.map(item => item.text),
      speeches: state.phase === 'night-wolf' || state.phase === 'night-seer' || state.phase === 'night-witch' ? [] : state.speeches.map(item => ({ seat: item.seat, speech: item.speech })),
    }
    if (self.role === 'werewolf') {
      base.wolfPack = wolves(state)
      base.wolfChat = state.wolfChat.map(item => ({ seat: item.seat, speech: item.speech, target: item.target }))
    }
    if (self.role === 'seer') {
      base.checks = state.checks.filter(item => item.seat === seat).map(item => ({ target: item.target, result: item.result }))
    }
    if (self.role === 'witch' && state.phase === 'night-witch' && self.alive) {
      base.tonightDeath = state.night.witchSeenDeath
      base.saveAvailable = !self.saveUsed
      base.poisonAvailable = !self.poisonUsed
    }
    if (state.phase === 'day-vote' || state.phase === 'hunter') base.legalTargets = aliveSeats(state).filter(item => item !== seat)
    return base
  },
  /* 一次行动可能连续推进多个阶段，播报在同一手里合并成一条（见 flushNarration）。 */
  apply(state, action, playerIndex) {
    const before = Array.isArray(state.narration) ? state.narration.length : 0
    const next = applyMove(state, action, playerIndex)
    flushNarration(next, before)
    return next
  },
})

function applyMove(state, action, playerIndex) {
  const next = structuredClone(state)
  const seat = playerIndex + 1
  const self = seatOf(next, seat)
  /* 动作发生在哪个阶段：必须在推进状态之前取，否则审计里的 phase 会记成下一阶段。 */
  const actionPhase = next.phase
  if (next.winner) throw new Error('比赛已经结束。')
  if (!next.pending.includes(seat)) {
    if (!self.alive) throw new Error('出局者不能行动。')
    throw new Error('当前不是该选手的行动。')
  }
  if (!self.alive && next.phase !== 'hunter') throw new Error('出局者不能行动。')
  const type = action?.type
  if (next.phase === 'night-wolf') {
    if (self.role !== 'werewolf') throw new Error('只有狼人可以夜间刀人。')
    const target = requireSeat(action?.target, next, { actor: seat })
    const wolvesAlive = aliveWolves(next)
    const index = wolvesAlive.indexOf(seat)
    next.wolfChat.push({ seat, speech: '', target })
    if (index === 0 && wolvesAlive.length > 1) {
      next.night.wolfProposal = target
      next.pending = [wolvesAlive[1]]
    } else {
      next.night.wolfTarget = target
      next.pending = []
      const seer = next.players.find(player => player.role === 'seer' && player.alive)
      next.phase = seer ? 'night-seer' : 'night-witch'
      if (seer) {
        next.pending = [seer.seat]
        narrate(next, SEER_GUIDE)
      } else handWitch(next)
    }
    pushMove(next, seat, action, actionPhase)
    return next
  }
  if (next.phase === 'night-seer') {
    if (self.role !== 'seer') throw new Error('只有预言家可以查验。')
    const target = requireSeat(action?.target, next, { actor: seat })
    const result = seatOf(next, target).role === 'werewolf' ? 'werewolf' : 'villager'
    next.checks.push({ seat, day: next.day, target, result })
    next.pending = []
    next.phase = 'night-witch'
    handWitch(next)
    pushMove(next, seat, action, actionPhase)
    return next
  }
  if (next.phase === 'night-witch') {
    if (self.role !== 'witch') throw new Error('只有女巫可以用药。')
    const potion = action?.potion || 'pass'
    if (!['save', 'poison', 'pass'].includes(potion)) throw new Error('女巫只能救、毒或空过。')
    if (potion === 'save') {
      if (self.saveUsed) throw new Error('解药已经用过。')
      if (!next.night.witchSeenDeath) throw new Error('今夜没有可救的人。')
      if (action?.target && action.target !== next.night.witchSeenDeath) throw new Error('解药只能救当晚狼刀目标。')
      self.saveUsed = true
      next.night.save = true
    } else if (potion === 'poison') {
      if (self.poisonUsed) throw new Error('毒药已经用过。')
      if (next.night.save) throw new Error('同一夜不能既救又毒。')
      const target = requireSeat(action?.target, next, { actor: seat })
      if (target === next.night.witchSeenDeath) throw new Error('同一夜不能既救又毒同一人，毒药不能指向当晚狼刀目标。')
      self.poisonUsed = true
      next.night.poison = target
    }
    next.pending = []
    dawn(next)
    pushMove(next, seat, action, actionPhase)
    return next
  }
  if (next.phase === 'hunter') {
    if (self.role !== 'hunter') throw new Error('只有猎人可以开枪。')
    const target = requireSeat(action?.target, next, { actor: seat })
    kill(next, target, 'hunter')
    publicEvent(next, `猎人开枪带走 ${target} 号。`)
    narrate(next, `猎人开枪带走了 ${target} 号。`)
    next.pending = []
    if (next.hunterCause === 'vote') {
      next.day += 1
      const winner = winnerOf(next)
      if (winner) {
        next.phase = 'finished'
        next.winner = winner.side
        next.terminalReason = winner.message
      } else openNight(next)
    } else {
      next.phase = 'resolve'
      advance(next)
    }
    pushMove(next, seat, action, actionPhase)
    return next
  }
  if (next.phase === 'day-speech') {
    if (type !== 'speak') throw new Error('白天发言阶段只能发言。')
    const order = aliveSeats(next)
    if (order[next.speakerCursor] !== seat) throw new Error('还没轮到该座位发言。')
    next.speeches.push({ seat, speech: '' })
    next.speakerCursor += 1
    if (next.speakerCursor >= order.length) closeSpeech(next)
    else next.pending = [order[next.speakerCursor]]
    pushMove(next, seat, action, actionPhase)
    return next
  }
  if (next.phase === 'day-vote') {
    if (type !== 'vote') throw new Error('投票阶段只能投票。')
    const target = requireSeat(action?.target, next, { actor: seat })
    if (next.votes.some(vote => vote.seat === seat)) throw new Error('本轮已经投过票。')
    next.votes.push({ seat, target })
    next.voteTally = tally(next.votes)
    /* 新的一票落下，上一轮的结算板退场：平票复投的第一票从这里开始把画面交回「本轮进行中」。 */
    next.lastVote = null
    next.pending = next.pending.filter(item => item !== seat)
    if (!next.pending.length) closeVote(next)
    pushMove(next, seat, action, actionPhase)
    return next
  }
  throw new Error('当前阶段不能行动。')
}

function handWitch(state) {
  const witch = state.players.find(player => player.role === 'witch' && player.alive)
  state.night.witchSeenDeath = state.night.wolfTarget
  if (!witch) {
    dawn(state)
    return
  }
  state.pending = [witch.seat]
  narrate(state, WITCH_GUIDE)
}

function pushMove(state, seat, action, phase) {
  state.moves.push({ seat, phase, type: action?.type || null, target: action?.target ?? null })
}

export function noteSpeech(state, playerIndex, speech) {
  const seat = playerIndex + 1
  /* 只补最近一条该座位留下的空发言：夜间落在狼人私聊，白天落在公开发言。 */
  const line = [...state.wolfChat].reverse().find(item => item.seat === seat && item.speech === '')
  if (line) line.speech = speech
  const spoken = [...state.speeches].reverse().find(item => item.seat === seat && item.speech === '')
  if (spoken) spoken.speech = speech
}

/* 系统指令按 phase 列出唯一合法的动作形状。以前把 pass 也列进 action.type，
   但规则层任何阶段都不接受 pass，模型照做就直接违规——指令与规则必须一致。
   人数不写死：局面里的 seatCount 才是这一局的座位数，指令只说明座位从哪里读。 */
export const WEREWOLF_SYSTEM = '你正在参加一场标准狼人杀。只依据收到的私有局面决策。你没有任何工具。只输出一个 JSON 对象：{"action":{…},"speech":"一句面向观众的简短发言"}。speech 使用中文，最多 80 字，表达你这一手的意图或判断，不要叙述完整内部推理，不要伪造他人原话。按局面里的 phase 选择唯一合法的动作：night-wolf 用 {"type":"kill","target":座位}；night-seer 用 {"type":"check","target":座位}；night-witch 用 {"type":"potion","potion":"save"} 救下今晚被刀的人，或 {"type":"potion","potion":"poison","target":座位}，或 {"type":"potion","potion":"pass"} 空过；day-speech 用 {"type":"speak"}；day-vote 用 {"type":"vote","target":座位}；hunter 用 {"type":"shoot","target":座位}。座位是 1—seatCount（见局面里的 seatCount），只能选择存活座位，不能选择自己或已出局玩家。不得输出代码围栏或其他文字。'
