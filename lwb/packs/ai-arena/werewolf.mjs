/**
 * 6 人狼人杀规则。主持人不占席位。
 * 座位 1—6。身份由 seed 发牌，局面是唯一真相，observe 只给出该座位此刻允许知道的内容。
 */
export const WEREWOLF_ROLES = Object.freeze(['werewolf', 'werewolf', 'seer', 'witch', 'hunter', 'villager'])
export const ROLE_LABEL = Object.freeze({ werewolf: '狼人', seer: '预言家', witch: '女巫', hunter: '猎人', villager: '村民' })
const SEATS = [1, 2, 3, 4, 5, 6]

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

export function dealRoles(seed = 0x574f4c46) {
  const roles = [...WEREWOLF_ROLES]
  const random = mulberry32(seed)
  for (let index = roles.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    ;[roles[index], roles[swap]] = [roles[swap], roles[index]]
  }
  return roles
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
  if (!Number.isInteger(target) || target < 1 || target > 6) throw new Error('目标必须是 1—6 的座位。')
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
  state.pending = aliveSeats(state).length ? [aliveSeats(state)[0]] : []
  publicEvent(state, `第 ${state.day} 天，请存活玩家按座位发言。`)
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
  if (unique.length) publicEvent(state, `天亮了，${unique.map(seat => `${seat} 号`).join('、')}出局。`)
  else publicEvent(state, '天亮了，昨夜平安夜。')
  state.phase = 'resolve'
  const hunterDeath = unique.find(seat => seatOf(state, seat).role === 'hunter')
  if (hunterDeath) {
    state.phase = 'hunter'
    state.pending = [hunterDeath]
    state.hunterCause = unique.includes(state.night.wolfTarget) && seatOf(state, hunterDeath).role === 'hunter' ? 'wolf-or-poison' : 'death'
    return state
  }
  return advance(state)
}

function tally(votes) {
  const counts = new Map()
  for (const vote of votes) counts.set(vote.target, (counts.get(vote.target) || 0) + 1)
  let top = 0
  for (const count of counts.values()) top = Math.max(top, count)
  const leaders = [...counts.entries()].filter(([, count]) => count === top).map(([seat]) => seat)
  return { counts: [...counts.entries()].map(([seat, count]) => ({ seat, count })), leaders, top }
}

function closeSpeech(state) {
  state.phase = 'day-vote'
  state.voteRound = 1
  state.votes = []
  state.pending = aliveSeats(state)
  publicEvent(state, '发言结束，请同时投票。')
}

function closeVote(state) {
  const { leaders } = tally(state.votes)
  if (leaders.length === 1) {
    const seat = leaders[0]
    kill(state, seat, 'vote')
    publicEvent(state, `${seat} 号被投票出局。`)
    const player = seatOf(state, seat)
    if (player.role === 'hunter') {
      state.phase = 'hunter'
      state.pending = [seat]
      state.hunterCause = 'vote'
      return state
    }
    state.day += 1
    return openNight(state)
  }
  if (state.voteRound === 1) {
    state.voteRound = 2
    state.votes = []
    state.pending = aliveSeats(state)
    publicEvent(state, `平票（${leaders.map(seat => `${seat} 号`).join('、')}），进行一次复投。`)
    return state
  }
  publicEvent(state, '复投仍然平票，无人出局。')
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
  const wolvesAlive = aliveWolves(state)
  state.pending = wolvesAlive.length ? [wolvesAlive[0]] : []
  if (!state.pending.length) return dawn(state)
  return state
}

export const werewolf = Object.freeze({
  id: 'werewolf',
  name: '狼人杀',
  version: '1.0.0',
  players: 6,
  description: '6 人标准局 · 2 狼人、预言家、女巫、猎人、村民 · 好人在狼人全灭时获胜 · 存活狼人数不少于其余存活玩家时狼人获胜',
  create(seed = 0x574f4c46) {
    const roles = dealRoles(seed)
    return {
      seed,
      day: 1,
      phase: 'night-wolf',
      players: roles.map((role, index) => ({ seat: index + 1, role, alive: true, saveUsed: false, poisonUsed: false })),
      publicLog: [{ day: 1, phase: 'night-wolf', text: '天黑请闭眼。' }],
      wolfChat: [],
      checks: [],
      night: { wolfTarget: null, wolfProposal: null, save: false, poison: null, witchSeenDeath: null },
      deaths: [],
      lastNightDeaths: [],
      speeches: [],
      speakerCursor: 0,
      votes: [],
      voteRound: 0,
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
  apply(state, action, playerIndex) {
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
        if (seer) next.pending = [seer.seat]
        else handWitch(next)
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
      next.pending = next.pending.filter(item => item !== seat)
      if (!next.pending.length) closeVote(next)
      pushMove(next, seat, action, actionPhase)
      return next
    }
    throw new Error('当前阶段不能行动。')
  },
})

function handWitch(state) {
  const witch = state.players.find(player => player.role === 'witch' && player.alive)
  state.night.witchSeenDeath = state.night.wolfTarget
  if (!witch) {
    dawn(state)
    return
  }
  state.pending = [witch.seat]
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
   但规则层任何阶段都不接受 pass，模型照做就直接违规——指令与规则必须一致。 */
export const WEREWOLF_SYSTEM = '你正在参加一场 6 人标准狼人杀。只依据收到的私有局面决策。你没有任何工具。只输出一个 JSON 对象：{"action":{…},"speech":"一句面向观众的简短发言"}。speech 使用中文，最多 80 字，表达你这一手的意图或判断，不要叙述完整内部推理，不要伪造他人原话。按局面里的 phase 选择唯一合法的动作：night-wolf 用 {"type":"kill","target":座位}；night-seer 用 {"type":"check","target":座位}；night-witch 用 {"type":"potion","potion":"save"} 救下今晚被刀的人，或 {"type":"potion","potion":"poison","target":座位}，或 {"type":"potion","potion":"pass"} 空过；day-speech 用 {"type":"speak"}；day-vote 用 {"type":"vote","target":座位}；hunter 用 {"type":"shoot","target":座位}。座位是 1—6，只能选择存活座位，不能选择自己或已出局玩家。不得输出代码围栏或其他文字。'
