import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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

test('repeating a position never ends the game and is disclosed to the players', () => {
  let state = custom([piece(0, 'general', 10, 5), piece(1, 'general', 1, 6), piece(0, 'chariot', 9, 1), piece(1, 'chariot', 2, 9)])
  const cycle = [
    [0, move(9, 1, 9, 2)], [1, move(2, 9, 2, 8)],
    [0, move(9, 2, 9, 1)], [1, move(2, 8, 2, 9)],
  ]
  for (let lap = 0; lap < 4; lap += 1) for (const [player, action] of cycle) state = xiangqi.apply(state, action, player)
  // Sixteen plies of shuffling: a 1.0.0 engine called this a draw, 1.1.0 keeps playing.
  assert.equal(state.draw, false)
  assert.equal(state.winner, null)
  assert.equal(state.result, null)
  assert.equal(state.halfmoveClock, 16)
  const observation = xiangqi.observe(state, state.nextPlayer)
  assert.equal(observation.positionRepeats, 5, '当前局面此前出现次数应当如实上报')
  assert.equal(observation.noProgressPlies, 16)
  assert.equal(observation.noProgressLimit, 120)
  // The loop is visible in the move history and on the moves that would deepen it.
  assert.equal(observation.recentMoves.length, 16)
  assert.equal(observation.recentMoves.at(-1), '16黑車2,8>2,9')
  assert.equal(observation.recentMoves.at(0), '1红俥9,1>9,2')
  assert.equal(observation.recentMoves.at(-2), '15红俥9,2>9,1')
  const continuing = observation.legalMoves.filter(move => move.repeats >= 2)
  assert.ok(continuing.length > 0, '继续循环的着法必须带上 repeats 提示')
  assert.ok(observation.legalMoves.every(move => Number.isInteger(move.repeats)))
})

test('a stalled game is closed by the no-progress rule while repeating', () => {
  let state = { ...custom([piece(0, 'general', 10, 5), piece(1, 'general', 1, 6), piece(0, 'chariot', 9, 1), piece(1, 'chariot', 2, 9)]), halfmoveClock: 119 }
  const next = xiangqi.apply(state, move(9, 1, 9, 2), 0)
  assert.equal(next.draw, true)
  assert.equal(next.result, 'move-limit')
  assert.equal(next.terminalReason, `连续 120 半回合无吃子及兵卒向前推进和棋`)
})

test('prunes repetition history only at irreversible moves', () => {
  const capture = custom([piece(0, 'general', 10, 5), piece(1, 'general', 1, 6), piece(0, 'chariot', 9, 1), piece(1, 'soldier', 6, 1)])
  let state = capture
  for (let i = 0; i < 3; i += 1) state = xiangqi.apply(state, move(9, 1, 9, 2), 0), state = xiangqi.apply(state, move(1, 6, 2, 6), 1), state = xiangqi.apply(state, move(9, 2, 9, 1), 0), state = xiangqi.apply(state, move(2, 6, 1, 6), 1)
  assert.equal(state.positionHistory.length, 13, '可逆着法不得裁剪历史')
  const afterCapture = xiangqi.apply(state, move(9, 1, 6, 1), 0)
  assert.equal(afterCapture.positionHistory.length, 1, '吃子前的局面不可能再出现，历史应当裁剪到当前局面')
  assert.equal(xiangqi.observe(afterCapture, 0).recentMoves.at(-1), '13红俥9,1>6,1x卒', '紧凑记法要标出吃子')
  const sideways = { ...custom([piece(0, 'general', 10, 5), piece(1, 'general', 1, 6), piece(0, 'soldier', 5, 1)]), positionHistory: ['x', 'y'] }
  assert.equal(xiangqi.apply(sideways, move(5, 1, 5, 2), 0).positionHistory.length, 3, '过河兵横走可逆，不得裁剪')
})

test('replays the recorded perpetual-check game without a repetition verdict', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/xiangqi-perpetual-check-loop.json', import.meta.url), 'utf8'))
  let state = xiangqi.create()
  for (const entry of fixture.moves) state = xiangqi.apply(state, { from: entry.from, to: entry.to }, entry.player)
  assert.equal(state.moves.length, 136)
  // 1.0.0 called this a draw on the 136th ply while Black was up 14:2 in material.
  // 1.1.0 refuses to judge the position dead: the game is still open.
  assert.equal(state.draw, false)
  assert.equal(state.winner, null)
  assert.equal(state.result, null)
  assert.equal(state.halfmoveClock, 30)
  assert.ok(state.positionHistory.length <= 120, '重复历史必须被裁剪到无进展上限之内')
  const observation = xiangqi.observe(state, state.nextPlayer)
  assert.equal(observation.recentMoves.at(-1), '136黑馬8,8>10,7+', '紧凑记法要标出将军')
  // Black checked on every one of its last five moves; the engine simply reports it
  // and keeps playing instead of turning the loop into a verdict.
  assert.equal(observation.recentMoves.filter(ply => ply.endsWith('+')).length, 5)
  assert.equal(observation.positionRepeats, 3, '第 136 手的局面此前已在第 128、132 手出现过两次')
  assert.ok(observation.legalMoves.length > 0)
  assert.ok(observation.legalMoves.every(reply => Number.isInteger(reply.repeats)))
  // 红方只剩光帅加一仕，重复提示是它继续周旋的唯一依据；黑方 8 子对 2 子大优却打摆子，引擎不再替它判和。
  assert.equal(observation.noProgressPlies, 30)
  assert.equal(state.pieces.filter(piece => piece.player === 0).length, 2)
  assert.equal(state.pieces.filter(piece => piece.player === 1).length, 8)
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
