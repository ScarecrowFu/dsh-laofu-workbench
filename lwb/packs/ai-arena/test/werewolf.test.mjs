import assert from 'node:assert/strict'
import test from 'node:test'
import { werewolf } from '../werewolf.mjs'

const SEED = 0x574f4c46

function step(state, player, action) {
  return werewolf.apply(state, action, player)
}

function playNight(state, { kill, check, potion = 'pass', poisonTarget } = {}) {
  let next = state
  const wolves = next.players.filter(player => player.role === 'werewolf' && player.alive).map(player => player.seat)
  for (const seat of wolves) next = step(next, seat - 1, { type: 'kill', target: kill })
  const seer = next.players.find(player => player.role === 'seer' && player.alive)
  if (seer && next.phase === 'night-seer') next = step(next, seer.seat - 1, { type: 'check', target: check })
  const witch = next.players.find(player => player.role === 'witch' && player.alive)
  if (witch && next.phase === 'night-witch') {
    next = step(next, witch.seat - 1, { type: 'potion', potion, ...(poisonTarget ? { target: poisonTarget } : {}) })
  }
  return next
}

function playDay(state, target) {
  let next = state
  while (next.phase === 'day-speech') next = step(next, next.pending[0] - 1, { type: 'speak' })
  const voters = [...next.pending]
  for (const seat of voters) {
    const ballot = seat === target ? voters.find(item => item !== target) : target
    next = step(next, seat - 1, { type: 'vote', target: ballot })
  }
  return next
}

test('fixed seed deals the 6 standard roles and opens on the first wolf', () => {
  const state = werewolf.create(SEED)
  assert.deepEqual(state.players.map(player => player.role), ['hunter', 'werewolf', 'villager', 'werewolf', 'seer', 'witch'])
  assert.equal(state.phase, 'night-wolf')
  assert.deepEqual(state.pending, [2])
  assert.equal(werewolf.version, '1.0.0')
  assert.equal(werewolf.players, 6)
})

test('night order is wolf, seer, witch who sees the knife, then dawn', () => {
  let state = werewolf.create(SEED)
  state = step(state, 1, { type: 'kill', target: 3 })
  assert.equal(state.phase, 'night-wolf')
  assert.deepEqual(state.pending, [4])
  assert.equal(state.night.wolfTarget, null)
  state = step(state, 3, { type: 'kill', target: 3 })
  assert.equal(state.phase, 'night-seer')
  assert.equal(state.night.wolfTarget, 3)
  const witchView = werewolf.observe(state, 5)
  assert.equal(witchView.tonightDeath, undefined)
  state = step(state, 4, { type: 'check', target: 2 })
  assert.equal(state.phase, 'night-witch')
  assert.deepEqual(werewolf.observe(state, 4).checks, [{ target: 2, result: 'werewolf' }])
  const witch = werewolf.observe(state, 5)
  assert.equal(witch.tonightDeath, 3)
  assert.equal(witch.saveAvailable, true)
  assert.equal(witch.poisonAvailable, true)
  state = step(state, 5, { type: 'potion', potion: 'pass' })
  assert.equal(state.phase, 'day-speech')
  assert.deepEqual(state.lastNightDeaths, [3])
  assert.equal(state.players[2].alive, false)
})

test('witch save, poison and pass each resolve once and a saved hunter does not shoot', () => {
  let state = werewolf.create(SEED)
  state = playNight(state, { kill: 1, check: 3, potion: 'save' })
  assert.equal(state.phase, 'day-speech')
  assert.deepEqual(state.lastNightDeaths, [])
  assert.equal(state.players[0].alive, true)
  assert.equal(state.players.find(player => player.role === 'witch').saveUsed, true)
  state = playDay(state, 3)
  assert.equal(state.phase, 'night-wolf')
  state = playNight(state, { kill: 5, check: 4, potion: 'poison', poisonTarget: 1 })
  assert.ok(state.phase === 'hunter' || state.lastNightDeaths.includes(1))
  assert.equal(state.players[0].alive, false)
  assert.equal(state.players.find(player => player.role === 'witch').poisonUsed, true)
  assert.throws(() => werewolf.apply(werewolf.create(SEED), { type: 'potion', potion: 'poison', target: 3 }, 5), /当前不是该选手的行动/)
})

test('poison cannot hit the same night knife and save cannot be repeated', () => {
  let state = werewolf.create(SEED)
  state = step(state, 1, { type: 'kill', target: 3 })
  state = step(state, 3, { type: 'kill', target: 3 })
  state = step(state, 4, { type: 'check', target: 2 })
  assert.throws(() => step(state, 5, { type: 'potion', potion: 'poison', target: 3 }), /狼刀目标/)
  const saved = step(state, 5, { type: 'potion', potion: 'save' })
  assert.equal(saved.night.save, true)
  assert.equal(saved.night.poison, null)
  let second = werewolf.create(SEED)
  second = playNight(second, { kill: 1, check: 3, potion: 'save' })
  second = playDay(second, 3)
  second = step(second, 1, { type: 'kill', target: 5 })
  second = step(second, 3, { type: 'kill', target: 5 })
  second = step(second, 4, { type: 'check', target: 2 })
  assert.throws(() => step(second, 5, { type: 'potion', potion: 'save' }), /解药已经用过/)
})

test('hunter shoots only after a real death and can be the wolf-win blow', () => {
  let state = werewolf.create(SEED)
  state = playNight(state, { kill: 1, check: 3, potion: 'pass' })
  assert.equal(state.phase, 'hunter')
  assert.deepEqual(state.pending, [1])
  state = step(state, 0, { type: 'shoot', target: 3 })
  assert.equal(state.players[2].alive, false)
  assert.equal(state.winner, 'wolf')
  assert.match(state.terminalReason, /狼人获胜/)
})

test('village wins when the last wolf is shot by the hunter', () => {
  let state = werewolf.create(SEED)
  state = playNight(state, { kill: 3, check: 2, potion: 'pass' })
  const speakers = []
  while (state.phase === 'day-speech') {
    speakers.push(state.pending[0])
    state = step(state, state.pending[0] - 1, { type: 'speak' })
  }
  assert.deepEqual(speakers, [1, 2, 4, 5, 6])
  assert.equal(state.phase, 'day-vote')
  assert.deepEqual([...state.pending].sort(), [1, 2, 4, 5, 6])
  for (const [seat, target] of [[1, 2], [2, 1], [4, 2], [5, 2], [6, 2]]) state = step(state, seat - 1, { type: 'vote', target })
  assert.equal(state.players[1].alive, false)
  assert.equal(state.phase, 'night-wolf')
  state = playNight(state, { kill: 1, check: 4, potion: 'pass' })
  assert.equal(state.phase, 'hunter')
  state = step(state, 0, { type: 'shoot', target: 4 })
  assert.equal(state.winner, 'village')
  assert.match(state.terminalReason, /好人获胜/)
})

test('a tied vote is recast once and a second tie exiles nobody', () => {
  let state = werewolf.create(SEED)
  state = playNight(state, { kill: 3, check: 2, potion: 'pass' })
  while (state.phase === 'day-speech') state = step(state, state.pending[0] - 1, { type: 'speak' })
  for (const [seat, target] of [[1, 2], [2, 4], [4, 2], [5, 1], [6, 4]]) state = step(state, seat - 1, { type: 'vote', target })
  assert.equal(state.phase, 'day-vote')
  assert.equal(state.voteRound, 2)
  assert.equal(state.players.filter(player => !player.alive).map(player => player.seat).join(','), '3')
  for (const [seat, target] of [[1, 2], [2, 4], [4, 2], [5, 1]]) state = step(state, seat - 1, { type: 'vote', target })
  assert.equal(state.phase, 'day-vote')
  state = step(state, 5, { type: 'vote', target: 4 })
  assert.equal(state.phase, 'night-wolf')
  assert.equal(state.day, 2)
  assert.equal(state.players.filter(player => !player.alive).map(player => player.seat).join(','), '3')
  assert.ok(state.publicLog.some(item => /无人出局/.test(item.text)))
})

test('a voted hunter shoots immediately and the dead cannot act', () => {
  let state = werewolf.create(SEED)
  state = playNight(state, { kill: 3, check: 2, potion: 'pass' })
  while (state.phase === 'day-speech') state = step(state, state.pending[0] - 1, { type: 'speak' })
  for (const [seat, target] of [[1, 2], [2, 1], [4, 1], [5, 1], [6, 1]]) state = step(state, seat - 1, { type: 'vote', target })
  assert.equal(state.phase, 'hunter')
  assert.equal(state.players[0].alive, false)
  assert.throws(() => step(state, 2, { type: 'speak' }), /出局者不能行动/)
  assert.throws(() => step(state, 5, { type: 'speak' }), /当前不是该选手的行动/)
  state = step(state, 0, { type: 'shoot', target: 2 })
  assert.equal(state.players[1].alive, false)
  assert.equal(state.winner, null)
  assert.throws(() => step(state, 0, { type: 'shoot', target: 4 }), /出局者不能行动|当前不是该选手的行动/)
})

test('private observations hide the other side of the table', () => {
  let state = werewolf.create(SEED)
  state = step(state, 1, { type: 'kill', target: 1 })
  state = step(state, 3, { type: 'kill', target: 1 })
  state = step(state, 4, { type: 'check', target: 2 })
  const wolf = JSON.stringify(werewolf.observe(state, 1))
  const seer = JSON.stringify(werewolf.observe(state, 4))
  const witch = JSON.stringify(werewolf.observe(state, 5))
  const villager = JSON.stringify(werewolf.observe(state, 2))
  assert.match(wolf, /wolfPack/)
  assert.equal(wolf.includes('checks'), false)
  assert.equal(wolf.includes('saveAvailable'), false)
  assert.equal(wolf.includes('poisonAvailable'), false)
  assert.equal(wolf.includes('tonightDeath'), false)
  assert.match(seer, /"checks":\[\{"target":2,"result":"werewolf"\}\]/)
  assert.equal(seer.includes('wolfPack'), false)
  assert.equal(seer.includes('tonightDeath'), false)
  assert.equal(seer.includes('saveAvailable'), false)
  assert.match(witch, /"tonightDeath":1/)
  assert.match(witch, /saveAvailable/)
  assert.equal(witch.includes('wolfPack'), false)
  assert.equal(witch.includes('"checks"'), false)
  for (const hidden of ['wolfPack', 'checks', 'tonightDeath', 'saveAvailable', 'poisonAvailable', 'werewolf']) {
    assert.equal(villager.includes(hidden), false, hidden)
  }
})

test('illegal actions leave the true state unchanged', () => {
  const state = werewolf.create(SEED)
  const before = structuredClone(state)
  assert.throws(() => step(state, 1, { type: 'kill', target: 2 }), /不能选择自己/)
  assert.throws(() => step(state, 0, { type: 'shoot', target: 3 }), /当前不是该选手的行动/)
  assert.deepEqual(state, before)
})
