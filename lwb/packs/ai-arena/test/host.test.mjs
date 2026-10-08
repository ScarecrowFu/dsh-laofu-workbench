import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArenaStore } from '../store.mjs'
import { ArenaHost, parseDecision, tokenCount } from '../host.mjs'
import { ArenaGames } from '../games.mjs'
import { decisionPrompt } from '../decision-prompt.mjs'
import { dealRoles } from '../werewolf.mjs'

const winningPoints = [[8, 4], [1, 1], [8, 5], [1, 2], [8, 6], [1, 3], [8, 7], [1, 4], [8, 8]]
async function pauseMatch(env) {
  const [match] = await env.store.list()
  await env.host.control({ id: match.id, action: 'pause' })
}
const reply = (row, col, speech = '我先占住这个位置。') => ({ text: JSON.stringify({ action: { row, col }, speech }), reasoning: '', usage: { inputTokens: 10, outputTokens: 10 }, finish: { kind: 'stop' }, config: {} })
const xiangqiReply = (fromRow, fromCol, toRow, toCol, speech = '我先出动这枚棋子。') => ({ ...reply(1, 1, speech), text: JSON.stringify({ action: { from: { row: fromRow, col: fromCol }, to: { row: toRow, col: toCol } }, speech }) })
async function setup(t, complete, models = [{ id: 'black', name: 'Black' }, { id: 'white', name: 'White' }], hostOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), 'arena-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = await new ArenaStore(root).init(), signal = new AbortController(), jobs = [], stops = [], sessions = new Map(), sessionEvents = []
  let sequence = 0
  const makeSession = options => {
    const events = []
    const sessionOptions = { ...options }
    let pending = null, activeController = null, progressWaiters = []
    const emitProgress = update => {
      session.progress = update
      const waiters = progressWaiters.splice(0)
      for (const resolve of waiters) resolve({ type: 'assistant-stream', frame: { chunk: { type: update.phase === 'reasoning' ? 'reasoning-delta' : 'text-delta', text: 'x'.repeat(update.bytesReceived || 1) } } })
    }
    const session = {
      updateOptions: next => Object.assign(sessionOptions, next),
      id: `session-${sessions.size + 1}`,
      followup: async prompt => {
        session.started = true
        activeController = new AbortController()
        pending = Promise.resolve().then(() => complete({ ...sessionOptions, prompt }, activeController.signal, emitProgress))
      },
      whenIdle: async () => {
        const response = await pending
        events.push({ seq: ++sequence, type: 'user/message', data: { message: { content: [{ type: 'text', text: 'turn' }] } } })
        events.push({ seq: ++sequence, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: response.text }], usage: response.usage }, usage: response.usage } })
        events.push({ seq: ++sequence, type: 'turn/end', data: { reason: { kind: response.finish?.kind === 'length' ? 'max-tokens' : 'completed' } } })
        sessionEvents.push(...events.slice(-3))
      },
      page: async request => ({ records: events.filter(event => event.seq <= request.throughSeq).map(event => ({ type: 'event', event })), hasMore: false }),
      follow: async function* (_, signal) {
        const cursor = events.at(-1)?.seq ?? -1
        yield { type: 'snapshot', cursor, records: events.map(event => ({ type: 'event', event })) }
        while (!signal.aborted) {
          const frame = await new Promise(resolve => {
            const onAbort = () => resolve(null)
            signal.addEventListener('abort', onAbort, { once: true })
            progressWaiters.push(value => { signal.removeEventListener('abort', onAbort); resolve(value) })
          })
          if (frame) yield frame
        }
      },
      cancel: () => activeController?.abort(new Error('session cancelled')),
      dispose: async () => {},
    }
    sessions.set(session.id, session)
    return session
  }
  const scope = { signal: signal.signal, onStop: fn => stops.push(fn), background: job => jobs.push(job), models: { list: async () => [{ id: 'test', name: 'Test', models }] }, sessions: { create: async options => makeSession(options), resume: async (id, options) => { const existing = sessions.get(id); if (existing) { existing.updateOptions(options); return existing; } const session = makeSession(options); session.id = id; sessions.delete([...sessions.keys()].at(-1)); sessions.set(id, session); return session } } }
  const host = new ArenaHost({ store, games: new ArenaGames(), scope, turnDelayMs: 0, ...hostOptions })
  const start = config => host.start({ players: [{ provider: 'test', model: 'black' }, { provider: 'test', model: 'white' }], ...config })
  const settle = async () => { while (jobs.length) await jobs.shift() }
  return { root, store, scope, host, start, settle, sessions, sessionEvents, setResponder: value => { complete = value }, stop: () => { signal.abort(); stops.forEach(fn => fn()) } }
}
test('每局狼人杀按种子重新发牌，并把种子记进配置以便复现', async t => {
  const models = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => ({ id, name: id }))
  const env = await setup(t, async () => ({ text: JSON.stringify({ action: { type: 'speak' }, speech: '开局。' }), finish: { kind: 'stop' }, usage: { inputTokens: 1, outputTokens: 1 } }), models)
  const seats = models.map(model => ({ provider: 'test', model: model.id }))
  const fresh = await env.host.start({ gameId: 'werewolf', players: seats })
  assert.ok(Number.isInteger(fresh.config.seed) && fresh.config.seed >= 0 && fresh.config.seed < 2 ** 32, '不传 seed 时必须生成 32 位整数种子')
  assert.deepEqual(fresh.state.players.map(player => player.role), dealRoles(fresh.config.seed), '发牌必须与该局种子一致，才能离线复现')
  const pinned = await env.host.start({ gameId: 'werewolf', seed: 0x574f4c46, players: seats })
  assert.equal(pinned.config.seed, 0x574f4c46)
  assert.deepEqual(pinned.state.players.map(player => player.role), ['hunter', 'werewolf', 'villager', 'werewolf', 'seer', 'witch'])
  /* 这里只验证发牌，不打算打完：把两场都停在回合边界再等后台收尾。 */
  for (const id of [fresh.id, pinned.id]) {
    const current = await env.store.get(id)
    if (['running', 'pausing'].includes(current.status)) await env.host.control({ id, action: 'pause' })
  }
  await env.settle()
})

test('werewolf match runs the night through a scripted local model to a village win', async t => {
  const models = ['hunter', 'wolf-a', 'villager', 'wolf-b', 'seer', 'witch'].map(id => ({ id, name: id }))
  const env = await setup(t, async request => {
    const line = request.prompt.split('\n').find(item => item.startsWith('{'))
    const view = JSON.parse(line)
    const speech = `${view.roleLabel}发言`
    if (view.phase === 'night-wolf') return { text: JSON.stringify({ action: { type: 'kill', target: view.day === 1 ? 3 : 1 }, speech }), finish: { kind: 'stop' }, usage: { inputTokens: 1, outputTokens: 1 } }
    if (view.phase === 'night-seer') return { text: JSON.stringify({ action: { type: 'check', target: view.alive.find(seat => seat !== view.seat) }, speech }), finish: { kind: 'stop' }, usage: { inputTokens: 1, outputTokens: 1 } }
    if (view.phase === 'night-witch') return { text: JSON.stringify({ action: { type: 'potion', potion: 'pass' }, speech }), finish: { kind: 'stop' }, usage: { inputTokens: 1, outputTokens: 1 } }
    if (view.phase === 'hunter') return { text: JSON.stringify({ action: { type: 'shoot', target: view.alive.includes(2) ? 2 : 4 }, speech }), finish: { kind: 'stop' }, usage: { inputTokens: 1, outputTokens: 1 } }
    if (view.phase === 'day-speech') return { text: JSON.stringify({ action: { type: 'speak' }, speech }), finish: { kind: 'stop' }, usage: { inputTokens: 1, outputTokens: 1 } }
    const ballot = view.seat === 2 ? 1 : 2
    return { text: JSON.stringify({ action: { type: 'vote', target: ballot }, speech }), finish: { kind: 'stop' }, usage: { inputTokens: 1, outputTokens: 1 } }
  }, models)
  const started = await env.host.start({ gameId: 'werewolf', seed: 0x574f4c46, players: models.map(model => ({ provider: 'test', model: model.id })) })
  await env.settle()
  const match = await env.store.get(started.id)
  assert.equal(match.game.id, 'werewolf')
  assert.equal(match.status, 'finished')
  assert.equal(match.result.winner, 'village')
  assert.match(match.result.message, /好人获胜/)
  const prompts = match.events.filter(event => event.type === 'request').map(event => event.prompt)
  const wolf = prompts.find(prompt => prompt.includes('"role":"werewolf"'))
  assert.match(wolf, /wolfPack/)
  assert.equal(wolf.includes('"checks"'), false)
  assert.equal(wolf.includes('saveAvailable'), false)
  const seer = prompts.find(prompt => prompt.includes('"role":"seer"') && prompt.includes('"phase":"night-seer"'))
  assert.match(seer, /"checks"/)
  assert.equal(seer.includes('wolfPack'), false)
  assert.equal(seer.includes('tonightDeath'), false)
  const witch = prompts.find(prompt => prompt.includes('"phase":"night-witch"'))
  assert.match(witch, /"tonightDeath":3/)
  assert.equal(witch.includes('wolfPack'), false)
  assert.equal(witch.includes('"checks"'), false)
  assert.equal(prompts.some(prompt => prompt.includes('观众台词')), false)
})

test('complete match persists inputs, output, speech and deterministic winner without opponent speech', async t => {
  const points = [[8, 4], [1, 1], [8, 5], [1, 2], [8, 6], [1, 3], [8, 7], [1, 4], [8, 8]], requests = []
  const env = await setup(t, async request => { requests.push(request); return reply(...points[requests.length - 1], '观众台词') })
  const started = await env.start(); await env.settle()
  const match = await env.store.get(started.id)
  for (const key of ['maxMoves', 'maxCalls', 'maxTokens', 'maxTokensLimit', 'tokenBudget', 'timeoutSeconds']) assert.equal(Object.hasOwn(match.config, key), false)
  assert.ok(requests.every(request => request.maxTokens === null))
  assert.equal(match.config.pace, 'native')
  assert.ok(requests.every(request => request.generationMode === undefined && request.reasoningEffort === undefined))
  assert.equal(match.result.kind, 'win'); assert.equal(match.result.winner, 0)
  assert.equal(match.calls, 9); assert.equal(match.tokens, 180)
  assert.equal(match.config.contextMode, 'current-position')
  const records = match.events.filter(event => event.type === 'request')
  assert.equal(new Set(records.map(event => event.sessionId)).size, 2)
  assert.equal(env.sessions.size, 2)
  assert.equal(env.host.sessions.size, 0)
  for (const event of records) {
    assert.equal(event.contextMode, 'current-position')
    assert.equal(match.events.find(response => response.type === 'response' && response.turnId === event.turnId).sessionId, event.sessionId)
  }
  assert.ok(requests.every(request => request.tools === 'none' && request.system && !request.prompt.includes('"moves"')))
  assert.equal(match.events.filter(event => event.type === 'move').length, 9)
  assert.equal(match.events.filter(event => event.type === 'request').length, 9)
  assert.ok(requests.every(request => !request.prompt.includes('观众台词')))
})

test('xiangqi parses source/destination moves and runs an isolated multi-turn match until explicitly paused', async t => {
  const opening = [[10, 2, 8, 3], [1, 2, 3, 3], [8, 2, 5, 2], [3, 8, 5, 8], [10, 8, 8, 7], [1, 8, 3, 7]]
  const requests = []
  const env = await setup(t, async request => {
    requests.push(request)
    if (requests.length === opening.length) await pauseMatch(env)
    return xiangqiReply(...opening[requests.length - 1], `象棋观众台词 ${requests.length}`)
  })
  const started = await env.start({ gameId: 'xiangqi', maxMoves: opening.length })
  await env.settle()
  const match = await env.store.get(started.id)
  assert.equal(match.game.id, 'xiangqi')
  assert.equal(match.game.name, '中国象棋')
  assert.equal(match.status, 'paused')
  assert.equal(match.result, null)
  assert.equal(match.calls, opening.length)
  assert.equal(match.state.moves.length, opening.length)
  assert.equal(match.tokens, opening.length * 20)
  assert.equal(match.state.nextPlayer, 0)
  assert.equal(match.config.maxCalls, undefined)
  assert.match(match.config.system, /"from".*"to"/u)
  assert.match(match.config.system, /中国象棋/u)
  assert.match(match.config.system, /行.*1.*10/u)
  const recordedMoves = match.events.filter(event => event.type === 'move')
  assert.deepEqual(recordedMoves.map(event => event.action), opening.map(([fromRow, fromCol, toRow, toCol]) => ({ from: { row: fromRow, col: fromCol }, to: { row: toRow, col: toCol } })))
  assert.deepEqual(recordedMoves.map(event => event.player), [0, 1, 0, 1, 0, 1])
  for (const request of requests) {
    assert.equal(request.tools, 'none')
    assert.equal(request.system, match.config.system)
    assert.match(request.prompt, /"legalMoves"/u)
    assert.ok(!request.prompt.includes('象棋观众台词'))
    assert.ok(!request.prompt.includes('"moves"'))
  }
  assert.match(requests[0].prompt, /"color":"红"/u)
  assert.match(requests[1].prompt, /"color":"黑"/u)
  assert.match(requests[1].prompt, /08 · 炮 傌/u)
  assert.equal(new Set(match.events.filter(event => event.type === 'request').map(event => event.sessionId)).size, 2)
  assert.equal(env.host.sessions.size, 0)
  assert.deepEqual(parseDecision(xiangqiReply(10, 2, 8, 3, '出马').text, 'xiangqi'), { action: { from: { row: 10, col: 2 }, to: { row: 8, col: 3 } }, speech: '出马' })
})

test('xiangqi invalid moves retry the same position without committing a move or leaking speech', async t => {
  const requests = []
  const responses = [xiangqiReply(7, 1, 7, 2, '违规发言不该进入局面'), xiangqiReply(10, 2, 8, 3, '合法发言不该进入对手局面'), xiangqiReply(1, 2, 3, 3, '黑方出马')]
  const env = await setup(t, async request => { requests.push(request); if (requests.length === responses.length) await pauseMatch(env); return responses[requests.length - 1] })
  const started = await env.start({ gameId: 'xiangqi', maxMoves: 2, invalidRetries: 1 })
  await env.settle()
  const match = await env.store.get(started.id)
  assert.equal(match.status, 'paused')
  assert.equal(match.calls, 3)
  assert.equal(match.tokens, 60)
  assert.equal(match.state.moves.length, 2)
  assert.deepEqual(match.events.filter(event => event.type === 'request').map(event => [event.player, event.attempt, event.moveNumber]), [[0, 0, 1], [0, 1, 1], [1, 0, 2]])
  const invalid = match.events.filter(event => event.type === 'invalid')
  assert.equal(invalid.length, 1)
  assert.match(invalid[0].error, /中国象棋规则/u)
  assert.match(invalid[0].raw, /违规发言/u)
  assert.match(requests[1].prompt, /中国象棋规则/u)
  assert.match(requests[1].prompt, /10 俥 傌 相/u)
  assert.ok(requests.every(request => !request.prompt.includes('发言不该进入')))
  assert.deepEqual(match.events.filter(event => event.type === 'move').map(event => event.action.from), [{ row: 10, col: 2 }, { row: 1, col: 2 }])
})

test('xiangqi repeated illegal moves forfeit without changing the board', async t => {
  const env = await setup(t, async () => xiangqiReply(7, 1, 7, 2))
  const started = await env.start({ gameId: 'xiangqi', invalidRetries: 1 })
  await env.settle()
  const match = await env.store.get(started.id)
  assert.equal(match.result.kind, 'forfeit')
  assert.equal(match.result.winner, 1)
  assert.equal(match.state.moves.length, 0)
  assert.equal(match.state.pieces.length, 32)
  assert.equal(match.calls, 2)
  assert.equal(match.events.filter(event => event.type === 'move').length, 0)
  assert.equal(match.events.filter(event => event.type === 'invalid').length, 2)
})
test('each selected model uses its own default instead of a shared output ceiling', async t => {
  let index = 0
  const env = await setup(t, async request => { assert.equal(request.maxTokens, null); return reply(...winningPoints[index++]) }, [{ id: 'black', maxOutputTokens: 16384 }, { id: 'white', maxOutputTokens: 8192 }])
  const started = await env.start({ maxTokens: 393217 }); await env.settle()
  const match = await env.store.get(started.id)
  assert.equal(match.result.kind, 'win')
  assert.equal(Object.hasOwn(match.config, 'maxTokensLimit'), false)
  assert.equal(Object.hasOwn(match.players[0], 'maxOutputTokens'), false)
})
test('invalid moves are not committed; repair is charged and repeats exceeding policy forfeit', async t => {
  const env = await setup(t, async () => reply(0, 100))
  const start = await env.start(); await env.settle()
  const match = await env.store.get(start.id)
  assert.equal(match.calls, 2); assert.equal(match.state.moves.length, 0)
  assert.equal(match.result.kind, 'forfeit'); assert.equal(match.result.winner, 1)
  assert.equal(match.events.filter(event => event.type === 'invalid').length, 2)
})
test('provider errors pause without declaring defeat; explicit resume continues', async t => {
  let fails = true
  const env = await setup(t, async () => { if (fails) throw new Error('Provider unavailable'); await pauseMatch(env); return reply(8, 8) })
  const start = await env.start({ maxMoves: 1 }); await env.settle()
  assert.equal((await env.store.get(start.id)).status, 'paused')
  assert.equal((await env.store.get(start.id)).result, null)
  fails = false; await env.host.control({ id: start.id, action: 'resume' }); await env.settle()
  const match = await env.store.get(start.id)
  assert.equal(match.state.moves.length, 1); assert.equal(match.status, 'paused'); assert.equal(match.calls, 2)
})
test('pause waits for accepted current action and cancellation prevents late action', async t => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const env = await setup(t, async () => { await pending; return reply(8, 8) })
  const start = await env.start()
  while (![...env.sessions.values()].some(session => session.started)) await new Promise(resolve => setImmediate(resolve))
  await env.host.control({ id: start.id, action: 'pause' }); release(); await env.settle()
  const match = await env.store.get(start.id)
  assert.equal(match.status, 'paused'); assert.equal(match.state.moves.length, 1)
  const other = await env.start(); await env.host.control({ id: other.id, action: 'cancel' }); await env.settle()
  assert.equal((await env.store.get(other.id)).status, 'cancelled')
})
test('restart preserves received pending response and commits it without another model call', async t => {
  const env = await setup(t, async () => { throw new Error('must not call model') })
  const match = await env.store.create({ game: env.host.games.list()[0], players: [{ name: 'B' }, { name: 'W' }], config: { maxMoves: 1, maxCalls: 1, tokenBudget: 1000 }, state: winningPoints.slice(0, -1).reduce((state, [row, col], index) => env.host.games.get('gomoku').apply(state, { row, col }, index % 2), env.host.games.get('gomoku').create()) })
  await env.store.update(match.id, value => { value.pending = { turnId: 'received', player: 0, attempt: 0, response: reply(8, 8), elapsedMs: 1 } })
  await new ArenaStore(env.root).init()
  assert.equal((await env.store.get(match.id)).status, 'paused')
  await env.host.control({ id: match.id, action: 'resume' }); await env.settle()
  const resumed = await env.store.get(match.id)
  assert.equal(resumed.state.moves.length, 9); assert.equal(resumed.calls, 0); assert.equal(resumed.result.kind, 'win')
})
test('deprecated limits cannot stop a new match or impose a step deadline', async t => {
  let index = 0
  const env = await setup(t, async request => { assert.equal(request.maxTokens, null); return reply(...winningPoints[index++]) }, undefined, { turnTimeout: () => { throw new Error('scene deadline must not be created') } })
  const started = await env.start({ maxMoves: 0, maxCalls: 1, maxTokens: 0, tokenBudget: 1, timeoutSeconds: 0 })
  await env.settle()
  const match = await env.store.get(started.id)
  assert.equal(match.calls, 9)
  assert.equal(match.state.moves.length, 9)
  assert.equal(match.result.kind, 'win')
  assert.ok(match.events.filter(event => event.type === 'request').every(event => !Object.hasOwn(event, 'maxTokens') && !Object.hasOwn(event, 'timeoutSeconds')))
})
test('bad config and unavailable model cannot create a match', async t => {
  const env = await setup(t, async () => reply(8, 8))
  await assert.rejects(env.start({ invalidRetries: -1 }))
  await assert.rejects(env.start({ pace: 'fast' }), /模式已移除/u)
  await assert.rejects(env.host.start({ players: [{ provider: 'test', model: 'missing' }, { provider: 'test', model: 'white' }] }))
  assert.equal((await env.store.list()).length, 0)
  await assert.rejects(env.store.get('../escape'))
})
test('cancellation preserves a late response for audit but never commits its action', async t => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const env = await setup(t, async () => { await pending; return reply(8, 8) })
  const start = await env.start()
  while (![...env.sessions.values()].some(session => session.started)) await new Promise(resolve => setImmediate(resolve))
  await env.host.control({ id: start.id, action: 'cancel' })
  release(); await env.settle()
  const match = await env.store.get(start.id)
  assert.equal(match.status, 'cancelled')
  assert.equal(match.state.moves.length, 0)
  assert.equal(match.pending, null)
  assert.equal(match.events.filter(event => event.type === 'response').length, 1)
})
test('cancellation preserves a rejected partial response for audit without committing it', async t => {
  const env = await setup(t, async (request, signal) => await new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => {
      const error = new Error('session cancelled')
      error.result = { ...reply(8, 8), text: 'partial', finish: { kind: 'cancelled' } }
      reject(error)
    }, { once: true })
  }))
  const start = await env.start({ maxMoves: 1 })
  while (![...env.sessions.values()].some(session => session.started)) await new Promise(resolve => setImmediate(resolve))
  await env.host.control({ id: start.id, action: 'cancel' }); await env.settle()
  const match = await env.store.get(start.id)
  assert.equal(match.status, 'cancelled')
  assert.equal(match.state.moves.length, 0)
  assert.equal(match.events.filter(event => event.type === 'response').length, 1)
  assert.equal(match.events.find(event => event.type === 'response').finish.kind, 'cancelled')
})
test('changed game rules cannot resume an old match', async t => {
  const env = await setup(t, async () => { throw new Error('pause') })
  const start = await env.start(); await env.settle()
  await env.store.update(start.id, match => { match.game.version = 'old' })
  await assert.rejects(env.host.control({ id: start.id, action: 'resume' }), /规则版本/)
  assert.equal((await env.store.get(start.id)).status, 'paused')
})
test('reported usage remains auditable after exceeding a deprecated token budget', async t => {
  let index = 0
  const env = await setup(t, async () => ({ ...reply(...winningPoints[index++]), usage: { totalTokens: 1200 } }))
  const start = await env.start({ tokenBudget: 1000 }); await env.settle()
  const match = await env.store.get(start.id)
  assert.equal(match.calls, 9)
  assert.equal(match.tokens, 10800)
  assert.equal(match.result.kind, 'win')
})
test('strict decision parsing and usage include cached input but not double counted reasoning', () => {
  assert.throws(() => parseDecision('```json\n{}\n```'))
  assert.throws(() => parseDecision('{"action":{},"speech":""}'))
  assert.equal(tokenCount({ inputTokens: 2, outputTokens: 3, cacheReadTokens: 4, cacheWriteTokens: 5, reasoningTokens: 3 }), 14)
  assert.equal(tokenCount(null), null)
})

test('decision prompt preserves the full current board and feedback without replaying moves', () => {
  const game = new ArenaGames().get('gomoku')
  let state = game.apply(game.create(), { row: 8, col: 8 }, 0)
  state = game.apply(state, { row: 7, col: 8 }, 1)
  const prompt = decisionPrompt(game, state, 0, '交叉点已有棋子')
  assert.ok(!prompt.includes('"moves"'))
  assert.ok(prompt.includes('07 . . . . . . . W'))
  assert.ok(prompt.includes('08 . . . . . . . B'))
  assert.ok(prompt.includes('"board"'))
  assert.ok(!prompt.includes('快棋回合'))
  assert.match(prompt, /交叉点已有棋子/u)
})

test('live generation metadata is ephemeral and removed resume parameters are ignored', async t => {
  let entered, release, report
  const ready = new Promise(resolve => { entered = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const requests = []
  const env = await setup(t, async (request, signal, progress) => {
    requests.push(request); report = progress
    await new Promise(resolve => setImmediate(resolve))
    progress({ phase: 'reasoning', bytesReceived: 10 })
    entered(); await gate
    return reply(8, 8)
  })
  const started = await env.start({ maxMoves: 2 })
  assert.equal(started.config.timeoutSeconds, undefined)
  await ready
  const stored = await env.store.get(started.id), live = await env.host.get(started.id)
  assert.equal(live.activeTurn.phase, 'reasoning')
  assert.equal(live.activeTurn.bytesReceived, 10)
  assert.equal(stored.activeTurn.phase, undefined)
  assert.equal(live.revision, stored.revision)
  await env.host.control({ id: started.id, action: 'pause' }); release(); await env.settle()
  env.setResponder(async request => { requests.push(request); await pauseMatch(env); return reply(7, 8) })
  await assert.rejects(env.host.control({ id: started.id, action: 'resume', pace: 'fast' }), /模式已移除/u)
  await env.host.control({ id: started.id, action: 'resume', timeoutSeconds: 600 }); await env.settle()
  const match = await env.host.get(started.id)
  assert.equal(match.config.pace, 'native')
  assert.ok(requests.every(request => request.generationMode === undefined))
  assert.equal(match.config.timeoutSeconds, undefined)
  assert.equal(match.state.moves.length, 2)
  assert.ok(match.events.find(event => event.type === 'response').firstOutputMs >= 0)
  report({ phase: 'answering', bytesReceived: 20 })
  assert.equal(env.host.progress.size, 0)
  await assert.rejects(env.host.control({ id: started.id, action: 'pause', pace: 'fast' }), /只能在继续/u)
})

for (const pace of [undefined, 'fast', 'deep']) test(`legacy ${pace || 'unspecified'} matches resume with full observations and an audited native configuration`, async t => {
  const requests = []
  const env = await setup(t, async request => { requests.push(request); return reply(...winningPoints[requests.length - 1]) })
  const match = await env.store.create({ game: env.host.games.list()[0], players: [{ name: 'B', provider: 'test', model: 'black', fastDecision: { effort: 'off' } }, { name: 'W', provider: 'test', model: 'white' }], config: { pace, invalidRetries: 1, system: 'Rules', maxMoves: 1, maxCalls: 1, maxTokens: 32768, timeoutSeconds: 300, tokenBudget: 1000 }, state: env.host.games.get('gomoku').create() })
  await env.store.update(match.id, value => { value.status = 'paused' })
  await env.host.control({ id: match.id, action: 'resume' }); await env.settle()
  assert.equal(requests[0].generationMode, undefined)
  assert.equal(requests[0].fastDecision, undefined)
  assert.equal(requests[0].reasoningEffort, undefined)
  assert.ok(requests[0].prompt.includes('"board"'))
  const resumed = await env.store.get(match.id)
  assert.equal(resumed.config.pace, 'native')
  assert.equal(resumed.result.kind, 'win')
  assert.equal(resumed.calls, 9)
  assert.equal(resumed.config.maxTokens, undefined)
  assert.equal(requests[0].maxTokens, null)
  const migration = resumed.events.find(event => event.reason === 'dsh-session-defaults')
  assert.equal(migration.previous.maxTokens, 32768)
  assert.deepEqual(migration.next, {})
  assert.equal(resumed.config.contextMode, 'current-position')
  assert.ok(resumed.events.some(event => event.type === 'config-updated' && event.previous.contextMode === 'player-history' && event.next.contextMode === 'current-position'))
  assert.ok(resumed.events.some(event => event.type === 'config-updated' && event.previous.pace === (pace || 'deep') && event.next.pace === 'native'))
})
test('finished historical matches retain their old budgets and results', async t => {
  const env = await setup(t, async () => { throw new Error('historical matches must not call the model') })
  const config = { maxMoves: 1, maxCalls: 1, maxTokens: 8192, maxTokensLimit: 16384, tokenBudget: 1000, timeoutSeconds: 300 }
  const historical = await env.store.create({ game: env.host.games.list()[0], players: [{ name: 'B' }, { name: 'W' }], config, state: env.host.games.get('gomoku').create() })
  await env.host.finish(historical.id, { kind: 'limit', winner: null, message: 'Historical budget result' })
  const before = await env.store.get(historical.id)
  assert.deepEqual((await env.host.get(historical.id)).config, config)
  await assert.rejects(env.host.control({ id: historical.id, action: 'resume' }), /只有暂停的比赛可以继续/u)
  assert.deepEqual(await env.store.get(historical.id), before)
  assert.equal(env.sessions.size, 0)
})

test('a waiting Session has no scene deadline and user cancellation preserves partial usage', async t => {
  const env = await setup(t, async (request, signal) => await new Promise((resolve, reject) => {
    const aborted = () => {
      const error = new Error(signal.reason.message)
      error.result = { text: 'partial', reasoning: 'still deciding', usage: { totalTokens: 200 }, finish: { kind: 'cancelled' } }
      reject(error)
    }
    if (signal.aborted) aborted()
    else signal.addEventListener('abort', aborted, { once: true })
  }), undefined, { turnTimeout: () => { throw new Error('scene deadline must not be created') } })
  const started = await env.start({ timeoutSeconds: 0 })
  while (![...env.sessions.values()].some(session => session.started)) await new Promise(resolve => setImmediate(resolve))
  assert.equal((await env.store.get(started.id)).status, 'running')
  await env.host.control({ id: started.id, action: 'cancel' }); await env.settle()
  const match = await env.store.get(started.id)
  assert.equal(match.status, 'cancelled')
  assert.equal(match.calls, 1)
  assert.equal(match.tokens, 200)
  assert.equal(match.state.moves.length, 0)
  assert.equal(match.events.find(event => event.type === 'response').text, 'partial')
})

test('truncated Session reply continues in place, then pauses with accumulated usage and resumes the same Session', async t => {
  const env = await setup(t, async request => {
    assert.equal(request.tools, 'none')
    assert.ok(request.system)
    return { ...reply(8, 8), finish: { kind: 'length' } }
  })
  const started = await env.start({ maxMoves: 1 }); await env.settle()
  const match = await env.store.get(started.id)
  assert.equal(match.status, 'paused')
  assert.equal(match.tokens, 60)
  assert.equal(match.usageUnknown, false)
  assert.equal(match.state.moves.length, 0)
  assert.equal(match.events.filter(event => event.type === 'invalid').length, 0)
  assert.equal(match.events.find(event => event.type === 'error').code, 'ARENA_OUTPUT_LIMIT')
  assert.match(match.events.find(event => event.type === 'error').error, /模型或服务商的输出边界/u)
  assert.doesNotMatch(match.events.find(event => event.type === 'error').error, /提高上限/u)
  assert.ok(Number.isSafeInteger(match.players[0].sessionSeq))
  assert.equal(match.events.filter(event => event.type === 'continuation').length, 2)
  assert.ok(match.events.filter(event => event.type === 'continuation').every(event => event.sessionId === match.players[0].sessionId))
  const sessionId = match.players[0].sessionId
  env.setResponder(async request => { assert.equal(request.maxTokens, null); await pauseMatch(env); return reply(8, 8) })
  await env.host.control({ id: started.id, action: 'resume', maxTokens: 16384 })
  await env.settle()
  const resumed = await env.store.get(started.id)
  assert.equal(resumed.tokens, 80)
  assert.equal(resumed.state.moves.length, 1)
  assert.equal(resumed.players[0].sessionId, sessionId)
  assert.equal(resumed.events.find(event => event.type === 'error').sessionId, match.players[0].sessionId)
  assert.equal(resumed.events.filter(event => event.type === 'request').at(-1).sessionId, resumed.players[0].sessionId)
})
