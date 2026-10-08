import assert from 'node:assert/strict'
import test from 'node:test'
import { gomoku } from '../gomoku.mjs'
import { ArenaGames } from '../games.mjs'

for (const [name, points] of [
  ['horizontal at edge', [[1, 1], [1, 2], [1, 3], [1, 4], [1, 5]]],
  ['vertical at edge', [[11, 15], [12, 15], [13, 15], [14, 15], [15, 15]]],
  ['diagonal', [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]]],
  ['reverse diagonal', [[11, 5], [12, 4], [13, 3], [14, 2], [15, 1]]],
  ['overline', [[8, 1], [8, 2], [8, 3], [8, 5], [8, 6], [8, 4]]],
]) test(`gomoku wins ${name}`, () => {
  const state = { ...gomoku.create(), moves: points.slice(0, -1).map(([row, col]) => ({ row, col, player: 0 })) }
  const [row, col] = points.at(-1)
  const next = gomoku.apply(state, { row, col }, 0)
  assert.equal(next.winner, 0)
  assert.equal(state.winner, null)
  assert.equal(next.moves.length, points.length)
})
test('rejects occupied, fractional, off-board, wrong-player and terminal actions', () => {
  const state = gomoku.apply(gomoku.create(), { row: 8, col: 8 }, 0)
  for (const action of [{ row: 8, col: 8 }, { row: 0, col: 1 }, { row: 16, col: 2 }, { row: 2.5, col: 1 }, { row: '2', col: 1 }, {}]) assert.throws(() => gomoku.apply(state, action, 1))
  assert.throws(() => gomoku.apply(state, { row: 1, col: 1 }, 0), /回合/)
  assert.throws(() => gomoku.apply({ ...state, winner: 0 }, { row: 1, col: 1 }, 1), /结束/)
})
test('mixed colors, gaps and row wrapping are not wins; observations contain no speech', () => {
  let state = gomoku.create()
  for (const [row, col] of [[1, 12], [2, 1], [1, 13], [2, 2], [1, 14], [2, 3], [1, 15], [2, 4], [3, 1]]) state = gomoku.apply(state, { row, col }, state.nextPlayer)
  assert.equal(state.winner, null)
  const observation = gomoku.observe(state, 0)
  assert.equal(observation.color, '黑')
  assert.equal(observation.board.split('\n').length, 15)
  assert.equal('speech' in observation, false)
})
test('game registry supports independent game definitions and rejects duplicates', () => {
  const games = new ArenaGames()
  games.register({ ...gomoku, id: 'another-game', name: 'Other' })
  assert.deepEqual(games.list().map(game => game.id), ['gomoku', 'xiangqi', 'werewolf', 'another-game'])
  assert.throws(() => games.register(gomoku))
  assert.throws(() => games.get('missing'))
})
