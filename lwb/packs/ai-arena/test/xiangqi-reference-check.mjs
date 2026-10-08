/*
 * Optional parity check against @weshell/xiangqi.js@1.0.3.
 * Install for a local run without changing manifests: npm install --no-save --package-lock=false @weshell/xiangqi.js@1.0.3
 * Run: node lwb/packs/ai-arena/test/xiangqi-reference-check.mjs
 * LAN rank conversion: Xiangqi.js rank 0 is Red's back rank; arena row = 10 - rank.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { xiangqi } from '../xiangqi.mjs'

const TARGET_POSITIONS = 1200
const SEED = 0x51a7c0de
const require = createRequire(import.meta.url)
const { Chess } = require('@weshell/xiangqi.js')

const FEN_CODES = Object.freeze({
  general: 'k', advisor: 'a', elephant: 'b', horse: 'n',
  chariot: 'r', cannon: 'c', soldier: 'p',
})
const FILES = 'abcdefghi'

function lanFor(from, to) {
  return `${FILES[from.col - 1]}${10 - from.row}${FILES[to.col - 1]}${10 - to.row}`
}

function parseLan(lan) {
  return {
    from: { row: 10 - Number(lan[1]), col: FILES.indexOf(lan[0]) + 1 },
    to: { row: 10 - Number(lan[3]), col: FILES.indexOf(lan[2]) + 1 },
  }
}

function fenFor(state) {
  const rows = Array.from({ length: 10 }, () => Array(9).fill(null))
  for (const piece of state.pieces) {
    const lowerCode = FEN_CODES[piece.type]
    assert.ok(lowerCode, `Unknown piece type ${piece.type}`)
    rows[piece.row - 1][piece.col - 1] = piece.player === 0 ? lowerCode.toUpperCase() : lowerCode
  }
  const placement = rows.map(row => {
    let empty = 0
    let rank = ''
    for (const cell of row) {
      if (cell === null) empty++
      else {
        if (empty) rank += empty
        empty = 0
        rank += cell
      }
    }
    if (empty) rank += empty
    return rank
  }).join('/')
  return `${placement} ${state.nextPlayer === 0 ? 'w' : 'b'} - - 0 1`
}

function seededRandom(seed) {
  let value = seed >>> 0
  return () => {
    value ^= value << 13
    value ^= value >>> 17
    value ^= value << 5
    return (value >>> 0) / 0x100000000
  }
}

function sorted(moves) {
  return [...moves].sort()
}

const random = seededRandom(SEED)
let state = xiangqi.create()
let positions = 0
let plies = 0
let games = 0
let mismatch = null
let opening = null

while (positions < TARGET_POSITIONS) {
  const fen = fenFor(state)
  const reference = new Chess(fen)
  const referenceMoves = reference.moves()
  const localMoves = xiangqi.observe(state, state.nextPlayer).legalMoves.map(({ from, to }) => lanFor(from, to))
  const expected = sorted(referenceMoves)
  const actual = sorted(localMoves)

  if (!opening) opening = { fen, count: expected.length, matches: JSON.stringify(expected) === JSON.stringify(actual) }
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    mismatch = { position: positions + 1, ply: plies + 1, fen, expected, actual }
    break
  }
  positions++

  if (referenceMoves.length === 0) {
    games++
    state = xiangqi.create()
    continue
  }

  const chosen = referenceMoves[Math.floor(random() * referenceMoves.length)]
  state = xiangqi.apply(state, parseLan(chosen), state.nextPlayer)
  plies++
  if (state.winner !== null || state.draw) {
    games++
    state = xiangqi.create()
  }
}

const report = {
  library: '@weshell/xiangqi.js@1.0.3',
  seed: `0x${SEED.toString(16)}`,
  targetPositions: TARGET_POSITIONS,
  positionsCompared: positions,
  legalPliesApplied: plies,
  gamesStarted: games + 1,
  opening,
  mismatches: mismatch ? 1 : 0,
  firstMismatch: mismatch,
  adjudicationScope: 'Move-set parity only. The reference FEN is rebuilt per position, so the no-progress counter and every terminal verdict are not compared. Since 1.1.0 the local engine has no repetition verdict at all; games here end by mate, capture or the no-progress rule.',
}
console.log(JSON.stringify(report, null, 2))
if (mismatch) process.exitCode = 1
else console.log(`PASS: ${positions} deterministic legal positions matched.`)
