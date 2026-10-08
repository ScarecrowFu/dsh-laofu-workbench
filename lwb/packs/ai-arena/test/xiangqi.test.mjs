import assert from 'node:assert/strict'
import test from 'node:test'
import { xiangqi } from '../xiangqi.mjs'
import { ArenaGames } from '../games.mjs'

const move = (fromRow, fromCol, toRow, toCol) => ({ from: { row: fromRow, col: fromCol }, to: { row: toRow, col: toCol } })
const custom = pieces => ({ rows: 10, cols: 9, pieces, moves: [], nextPlayer: 0, winner: null, draw: false, positionHistory: [] })
const piece = (player, type, row, col) => ({ player, type, row, col })

test('creates the standard 32-piece position and a useful observation', () => {
  const state = xiangqi.create()
  assert.equal(state.pieces.length, 32)
  assert.equal(state.nextPlayer, 0)
  const observation = xiangqi.observe(state, 0)
  assert.match(observation.board, /01 車 馬 象 士 將 士 象 馬 車/)
  assert.match(observation.board, /10 俥 傌 相 仕 帥 仕 相 傌 俥/)
  assert.equal(observation.board.split('\n').length, 10)
  assert.equal(observation.color, '红')
  assert.equal('speech' in observation, false)
})

test('enforces horse leg, elephant eye, river and soldier movement rules', () => {
  const state = xiangqi.create()
  const horseBlocked = custom([piece(0, 'general', 10, 5), piece(1, 'general', 1, 6), piece(0, 'horse', 8, 2), piece(0, 'soldier', 7, 2)])
  assert.throws(() => xiangqi.apply(horseBlocked, move(8, 2, 6, 1), 0), /规则/)
  const eyeBlocked = custom([piece(0, 'general', 10, 5), piece(1, 'general', 1, 6), piece(0, 'elephant', 8, 3), piece(0, 'soldier', 7, 2)])
  assert.throws(() => xiangqi.apply(eyeBlocked, move(8, 3, 6, 1), 0), /规则/)
  const river = custom([piece(0, 'general', 10, 5), piece(1, 'general', 1, 6), piece(0, 'elephant', 6, 3)])
  assert.throws(() => xiangqi.apply(river, move(6, 3, 4, 1), 0), /规则/)
  assert.throws(() => xiangqi.apply(state, move(7, 1, 7, 2), 0), /规则/)
  const open = custom([piece(0, 'general', 10, 5), piece(1, 'general', 1, 6), piece(0, 'soldier', 6, 1)])
  assert.throws(() => xiangqi.apply(open, move(6, 1, 6, 2), 0), /规则/)
  const crossed = custom([piece(0, 'general', 10, 5), piece(1, 'general', 1, 6), piece(0, 'soldier', 5, 1)])
  const next = xiangqi.apply(crossed, move(5, 1, 5, 2), 0)
  assert.equal(next.pieces.find(p => p.type === 'soldier').col, 2)
})

test('chariot, cannon and advisor movement obey blockers and palace limits', () => {
  const clear = custom([piece(0, 'general', 10, 5), piece(1, 'general', 1, 6), piece(0, 'chariot', 9, 1), piece(1, 'soldier', 6, 1)])
  const capture = xiangqi.apply(clear, move(9, 1, 6, 1), 0)
  assert.equal(capture.moves.at(-1).captured.type, 'soldier')
  const cannon = custom([piece(0, 'general', 10, 5), piece(1, 'general', 1, 6), piece(0, 'cannon', 8, 1), piece(0, 'soldier', 7, 1), piece(1, 'soldier', 5, 1)])
  assert.doesNotThrow(() => xiangqi.apply(cannon, move(8, 1, 5, 1), 0))
  const blocked = custom([piece(0, 'general', 10, 5), piece(1, 'general', 1, 6), piece(0, 'cannon', 8, 1), piece(0, 'soldier', 7, 1)])
  assert.throws(() => xiangqi.apply(blocked, move(8, 1, 5, 1), 0), /规则/)
  const advisor = custom([piece(0, 'general', 10, 5), piece(1, 'general', 1, 6), piece(0, 'advisor', 10, 4)])
  assert.throws(() => xiangqi.apply(advisor, move(10, 4, 9, 3), 0), /规则/)
})

test('rejects exposing the general and detects flying-general attacks', () => {
  const facing = custom([piece(0, 'general', 10, 5), piece(1, 'general', 1, 5)])
  assert.throws(() => xiangqi.apply(facing, move(10, 5, 9, 5), 0), /规则/)
  const pinned = custom([piece(0, 'general', 10, 5), piece(0, 'chariot', 9, 5), piece(1, 'general', 1, 5)])
  assert.throws(() => xiangqi.apply(pinned, move(9, 5, 9, 4), 0), /规则/)
  const legalBlock = xiangqi.apply(pinned, move(9, 5, 8, 5), 0)
  assert.equal(legalBlock.nextPlayer, 1)
})

test('checkmate and stalemate end the game for the player with no reply', () => {
  const checkmate = custom([
    piece(0, 'general', 10, 4), piece(1, 'general', 1, 5),
    piece(0, 'chariot', 2, 4), piece(0, 'chariot', 3, 4), piece(0, 'chariot', 3, 6), piece(0, 'chariot', 2, 1),
  ])
  const result = xiangqi.apply(checkmate, move(2, 4, 2, 5), 0)
  assert.equal(result.winner, 0)
  assert.equal(result.result, 'checkmate')
  const stalemate = custom([
    piece(0, 'general', 10, 4), piece(1, 'general', 1, 5),
    piece(0, 'chariot', 3, 1), piece(0, 'chariot', 3, 4), piece(0, 'chariot', 3, 6),
  ])
  const ended = xiangqi.apply(stalemate, move(3, 1, 2, 1), 0)
  assert.equal(ended.winner, 0)
  assert.equal(ended.result, 'stalemate')
})

test('tracks threefold repetition and rejects moves after terminal state', () => {
  let state = custom([piece(0, 'general', 10, 5), piece(1, 'general', 1, 6), piece(0, 'chariot', 9, 1), piece(1, 'chariot', 2, 9)])
  const sequence = [
    [0, move(9, 1, 9, 2)], [1, move(2, 9, 2, 8)],
    [0, move(9, 2, 9, 1)], [1, move(2, 8, 2, 9)],
    [0, move(9, 1, 9, 2)], [1, move(2, 9, 2, 8)],
    [0, move(9, 2, 9, 1)], [1, move(2, 8, 2, 9)],
  ]
  for (const [player, action] of sequence) state = xiangqi.apply(state, action, player)
  assert.equal(state.draw, true)
  assert.equal(state.result, 'repetition')
  assert.throws(() => xiangqi.apply(state, move(9, 1, 9, 2), 0), /结束/)
})

test('accepts a normal opening sequence and does not mutate its input', () => {
  let state = xiangqi.create()
  const before = JSON.stringify(state)
  const opening = [
    [0, move(10, 2, 8, 3)], [1, move(1, 2, 3, 3)],
    [0, move(8, 2, 5, 2)], [1, move(3, 8, 5, 8)],
    [0, move(10, 8, 8, 7)], [1, move(1, 8, 3, 7)],
    [0, move(10, 1, 9, 1)], [1, move(1, 9, 2, 9)],
    [0, move(7, 5, 6, 5)], [1, move(4, 5, 5, 5)],
    [0, move(10, 3, 8, 5)], [1, move(1, 3, 3, 5)],
  ]
  for (const [player, action] of opening) state = xiangqi.apply(state, action, player)
  assert.equal(state.moves.length, opening.length)
  assert.equal(JSON.stringify(xiangqi.create()), before)
})

test('resets the draw clock for captures and forward soldier advances only', () => {
  const rook = { ...custom([piece(0, 'general', 10, 5), piece(1, 'general', 1, 6), piece(0, 'chariot', 9, 1)]), halfmoveClock: 119 }
  assert.equal(xiangqi.apply(rook, move(9, 1, 9, 2), 0).draw, true)
  const side = { ...custom([piece(0, 'general', 10, 5), piece(1, 'general', 1, 6), piece(0, 'soldier', 5, 1)]), halfmoveClock: 119 }
  const sideResult = xiangqi.apply(side, move(5, 1, 5, 2), 0)
  assert.equal(sideResult.halfmoveClock, 120)
  assert.equal(sideResult.draw, true)
  const advance = { ...custom([piece(0, 'general', 10, 5), piece(1, 'general', 1, 6), piece(0, 'soldier', 5, 1)]), halfmoveClock: 119 }
  const advanceResult = xiangqi.apply(advance, move(5, 1, 4, 1), 0)
  assert.equal(advanceResult.halfmoveClock, 0)
  assert.equal(advanceResult.draw, false)
})

test('registers alongside gomoku without changing the gomoku definition', () => {
  const games = new ArenaGames()
  assert.equal(games.get('xiangqi'), xiangqi)
  assert.equal(games.get('gomoku').id, 'gomoku')
  assert.equal(games.list().length, 3)
})
