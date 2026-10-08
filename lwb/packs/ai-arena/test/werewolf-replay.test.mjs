/**
 * 狼人杀的观战/回放/视频投影：六席舞台、昼夜场景、出局关键步与阵营终局。
 * 这里用一个脚本化的完整对局当夹具（也顺带验证规则重放能跑通真实 move 列表），
 * 覆盖「翻成视频会不会把好人获胜画成和棋」这类回归。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { noteSpeech, werewolf } from '../werewolf.mjs'
import { replayData } from '../replay/data.mjs'
import { stageHtml } from '../replay/markup.mjs'
import { replayHtml, reportMarkdown } from '../export.mjs'
import { parseDecision } from '../host.mjs'
import { ROLE_MARK, werewolfPhaseLabel, werewolfScene, werewolfStage } from '../presentation.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

const SEED = 0x574f4c46
const ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd'

/* 一局打到底：狼刀村民 → 票出狼 → 狼刀猎人 → 猎人带走最后一狼，好人获胜。
   每一手的行动者与规则给的 pending 完全一致，所以可以离线重放。 */
const SCRIPT = [
  [1, { type: 'kill', target: 3 }],
  [3, { type: 'kill', target: 3 }],
  [4, { type: 'check', target: 2 }],
  [5, { type: 'potion', potion: 'pass' }],
  [0, { type: 'speak' }], [1, { type: 'speak' }], [3, { type: 'speak' }], [4, { type: 'speak' }], [5, { type: 'speak' }],
  [0, { type: 'vote', target: 2 }], [1, { type: 'vote', target: 1 }], [3, { type: 'vote', target: 2 }], [4, { type: 'vote', target: 2 }], [5, { type: 'vote', target: 2 }],
  [3, { type: 'kill', target: 1 }],
  [4, { type: 'check', target: 4 }],
  [5, { type: 'potion', potion: 'pass' }],
  [0, { type: 'shoot', target: 4 }],
]

function playedMatch(overrides = {}) {
  let state = werewolf.create(SEED)
  const events = []
  SCRIPT.forEach(([player, action], index) => {
    state = werewolf.apply(state, action, player)
    noteSpeech(state, player, `第 ${index + 1} 手发言`)
    events.push({ type: 'move', moveNumber: index + 1, player, action, speech: `第 ${index + 1} 手发言`, elapsedMs: 100 })
  })
  return {
    id: ID, title: '狼人杀演示',
    game: { id: 'werewolf', name: '狼人杀', description: '6 人标准局', version: werewolf.version },
    players: ['猎人', '狼甲', '村民', '狼乙', '预言家', '女巫'].map((name, index) => ({ name, provider: 'test', model: `ww-${index + 1}` })),
    config: { seed: SEED },
    events, status: 'finished', result: { kind: 'win', winner: state.winner, message: state.terminalReason },
    calls: SCRIPT.length, tokens: 100, state,
    ...overrides,
  }
}

test('脚本化对局打完：狼人全灭，好人获胜', () => {
  const match = playedMatch()
  assert.equal(match.state.phase, 'finished')
  assert.equal(match.state.winner, 'village')
  assert.match(match.state.terminalReason, /好人获胜/)
  assert.deepEqual(match.state.deaths.map(death => [death.seat, death.cause]), [[3, 'wolf'], [2, 'vote'], [1, 'wolf'], [4, 'hunter']])
})

test('move 记录的是动作真正发生的阶段，而不是推进后的阶段', () => {
  const match = playedMatch()
  assert.deepEqual(match.state.moves.map(move => move.phase), SCRIPT.map((_, index) => match.state.moves[index].phase))
  assert.equal(match.state.moves[0].phase, 'night-wolf')
  assert.equal(match.state.moves[3].phase, 'night-witch')
  assert.equal(match.state.moves[4].phase, 'day-speech')
  assert.equal(match.state.moves[9].phase, 'day-vote')
  assert.equal(match.state.moves[17].phase, 'hunter')
})

test('狼人杀动作类型不再接受 pass（女巫的 potion=pass 仍然合法）', () => {
  assert.throws(() => parseDecision(JSON.stringify({ action: { type: 'pass' }, speech: '空过' }), 'werewolf'), /动作类型无效/)
  assert.deepEqual(parseDecision(JSON.stringify({ action: { type: 'potion', potion: 'pass' }, speech: '空过' }), 'werewolf').action, { type: 'potion', potion: 'pass' })
})

test('replayData 投影出六席身份、逐手存活与出局座位', () => {
  const data = replayData(playedMatch())
  assert.equal(data.result.winner, null)
  assert.equal(data.result.side, 'village')
  assert.equal(data.game.name, '狼人杀')
  assert.deepEqual(data.werewolf.seats.map(seat => [seat.seat, seat.role, seat.mark, seat.roleName]), [
    [1, 'hunter', '猎', '猎人'], [2, 'werewolf', '狼', '狼人'], [3, 'villager', '民', '村民'],
    [4, 'werewolf', '狼', '狼人'], [5, 'seer', '预', '预言家'], [6, 'witch', '巫', '女巫'],
  ])
  assert.deepEqual(data.werewolf.seats.map(seat => seat.portrait), ['chatgpt', 'claude', 'deepseek', 'doubao', 'kimi', 'mimo'])
  const steps = data.werewolf.steps
  assert.equal(steps.length, 18)
  assert.deepEqual(steps[0], { n: 1, seat: 2, phase: 'night-wolf', label: '狼人行动', scene: 'night', day: 1, alive: [1, 2, 3, 4, 5, 6], deaths: [] })
  /* 女巫那一手同时是黎明结算：3 号出局 */
  assert.deepEqual(steps[3].deaths, [3])
  assert.deepEqual(steps[3].alive, [1, 2, 4, 5, 6])
  assert.equal(steps[4].scene, 'day')
  assert.deepEqual(steps[13].deaths, [2])
  assert.deepEqual(steps[16].deaths, [1])
  assert.equal(steps[17].phase, 'hunter')
  assert.deepEqual(steps[17].deaths, [4])
  assert.equal(steps[17].scene, 'night')
})

test('关键步是出局与终局，不是吃子/将军', () => {
  const data = replayData(playedMatch())
  assert.deepEqual(data.keys, [
    { n: 4, kind: 'death', seats: [3] },
    { n: 14, kind: 'death', seats: [2] },
    { n: 17, kind: 'death', seats: [1] },
    { n: 18, kind: 'win' },
  ])
  assert.equal(data.winRun, null)
})

test('规则版本不匹配时降级为「只播发言」，不按新规则解释历史对局', () => {
  const match = playedMatch()
  const data = replayData({ ...match, game: { ...match.game, version: '9.9.9' } })
  assert.equal(data.werewolf.steps, null)
  assert.equal(data.result.side, 'village')
  assert.equal(data.werewolf.seats.filter(seat => seat.role).length, 6)
  /* 仍然画得出六席，不抛异常 */
  assert.equal((stageHtml(data, 5, { layout: 'landscape', t: 0 }).match(/class="ww-seat"/gu) || []).length, 6)
})

test('六席舞台：昼夜、阶段、行动者与出局都能画出来', () => {
  const data = replayData(playedMatch())
  const opening = stageHtml(data, 0, { layout: 'landscape', t: 0.5 })
  assert.match(opening, /data-game="werewolf"/u)
  assert.match(opening, /data-scene="night"/u)
  assert.match(opening, /天黑请闭眼/u)
  assert.equal((opening.match(/class="ww-seat"/gu) || []).length, 6)
  assert.equal((opening.match(/data-alive="false"/gu) || []).length, 0)
  assert.equal(opening.includes('<svg'), false, '狼人杀不应再画棋盘')
  assert.match(opening, /第 1 天/u)

  /* 第 4 手：女巫用药，3 号出局，白天只出现在白天 */
  const death = stageHtml(data, 4, { layout: 'landscape', t: 0.2 })
  assert.match(death, /data-act="death"/u)
  assert.match(death, /class="ww-deaths"/u)
  assert.match(death, /3 号出局/u)
  assert.match(death, /class="ww-strike"/u)
  assert.equal((death.match(/data-alive="false"/gu) || []).length, 2, '席卡与身份榜各一处')

  const vote = stageHtml(data, 14, { layout: 'landscape', t: 0.2 })
  assert.match(vote, /data-scene="day"/u)
  assert.match(vote, /投票放逐/u)
  assert.match(vote, /2 号出局/u)
  assert.match(vote, /夜刀 3 号|投票 2 号|查验 2 号|解药救人|开枪带走 4 号|空过|发言/u)
})

test('终局卡按阵营判定胜负，不再画成和棋', () => {
  const data = replayData(playedMatch())
  const finale = stageHtml(data, 19, { layout: 'landscape', t: 1 })
  assert.match(finale, /data-act="finale"/u)
  assert.match(finale, /data-scene="day"/u, '好人获胜用白天场景')
  assert.match(finale, /好人获胜/u)
  assert.match(finale, /class="pill win">好人获胜/u)
  assert.equal(finale.includes('和棋'), false)
  assert.equal(finale.includes('负</em>') || /class="bd">负</u.test(finale), true)
  /* 终局沿用最后一手的存活名单：出局的四个人不会复活 */
  assert.equal((finale.match(/data-alive="false"/gu) || []).length, 8)
  assert.match(finale, /data-win="true"/u)
})

test('狼人获胜时用夜景，并给狼人一方打胜', () => {
  const match = playedMatch()
  const wolfWin = { ...match, result: { kind: 'win', winner: 'wolf', message: '狼人获胜。' }, state: { ...match.state, winner: 'wolf', terminalReason: '狼人获胜。' } }
  const finale = stageHtml(replayData(wolfWin), 19, { layout: 'landscape', t: 1 })
  assert.match(finale, /data-scene="night"/u)
  assert.match(finale, /狼人获胜/u)
  assert.equal(finale.includes('和棋'), false)
})

test('狼人杀战报与离线回放：座位、阶段动作、自包含素材', () => {
  const match = playedMatch()
  const report = reportMarkdown(match)
  assert.match(report, /1 号：test\/ww-1；猎人/u)
  assert.match(report, /## 第 1 手 · 2 号 · 狼甲/u)
  assert.match(report, /夜刀 3 号/u)
  assert.match(report, /好人获胜/u)

  const offline = replayHtml(match)
  assert.equal(offline.includes('{{'), false)
  assert.equal(offline.includes('https://'), false)
  assert.match(offline, /globalThis\.__ARENA_ART__=/u)
  const art = JSON.parse(offline.match(/__ARENA_ART__=(.*?);<\/script>/su)[1])
  assert.deepEqual(Object.keys(art.scenes).sort(), ['day', 'night'])
  assert.ok(art.portraits.chatgpt && art.portraits['chatgpt-dead'])
  assert.equal('zhipu' in art.portraits, false, '只内联这一局用到的立绘')
  const embedded = JSON.parse(offline.match(/__ARENA_DATA__=(.*?);<\/script>/su)[1])
  assert.equal(embedded.result.side, 'village')
  assert.equal(embedded.werewolf.steps.length, 18)
})

test('观战投影与回放用同一套阶段语义', () => {
  const match = playedMatch()
  assert.equal(werewolfScene('night-witch'), 'night')
  assert.equal(werewolfScene('day-vote'), 'day')
  assert.equal(werewolfScene('hunter', 'vote'), 'day')
  assert.equal(werewolfScene('hunter', 'wolf-or-poison'), 'night')
  assert.equal(werewolfPhaseLabel('night-wolf'), '狼人行动')
  assert.equal(werewolfPhaseLabel('hunter', 'vote'), '猎人开枪')
  assert.equal(ROLE_MARK.werewolf, '狼')

  const live = werewolfStage({ players: match.players, state: { ...match.state, phase: 'day-vote' }, active: 2 })
  assert.equal(live.scene, 'day')
  assert.equal(live.phaseLabel, '投票放逐')
  assert.equal(live.day, 2)
  assert.equal(live.slot, '白天')
  assert.equal(live.seats.length, 6)
  assert.equal(live.seats[0].alive, false)
  assert.equal(live.seats[2].active, true)
  assert.equal(live.seats[2].roleName, '村民')
  assert.equal(live.winnerSide, 'village')

  /* 赛前占位：六个座位拿到六张不同立绘，不再全是同一张通用图 */
  const stub = werewolfStage({
    players: Array.from({ length: 6 }, (_, index) => ({ name: `${index + 1} 号待选` })),
    state: { phase: 'night-wolf', players: Array.from({ length: 6 }, (_, index) => ({ seat: index + 1, role: 'villager', alive: true })) },
  })
  assert.equal(new Set(stub.seats.map(seat => seat.portrait)).size, 6)
})
test('werewolf-art.mjs 与 assets/werewolf 保持同步（改了素材必须重新 arena:build）', async () => {
  const names = async directory => (await readdir(join(HERE, '..', 'assets', 'werewolf', directory)))
    .filter(name => /\.(jpe?g|png|webp)$/iu.test(name)).map(name => name.replace(/\.[^.]+$/u, '')).sort()
  const { WEREWOLF_ART } = await import('../werewolf-art.mjs')
  assert.deepEqual(Object.keys(WEREWOLF_ART.scenes).sort(), await names('scenes'))
  assert.deepEqual(Object.keys(WEREWOLF_ART.portraits).sort(), await names('characters'))
  for (const url of [...Object.values(WEREWOLF_ART.scenes), ...Object.values(WEREWOLF_ART.portraits)]) {
    assert.match(url, /^data:image\/jpeg;base64,\/9j\//u)
  }
  /* 立绘匹配表里的每个 key（含 -dead）都必须真的有图，否则观战会掉到通用图 */
  for (const key of ['chatgpt', 'claude', 'deepseek', 'doubao', 'kimi', 'mimo', 'minimax', 'qwen', 'zhipu', 'generic']) {
    assert.ok(WEREWOLF_ART.portraits[key], `${key} 缺少立绘`)
    assert.ok(WEREWOLF_ART.portraits[`${key}-dead`], `${key} 缺少出局立绘`)
  }
})
