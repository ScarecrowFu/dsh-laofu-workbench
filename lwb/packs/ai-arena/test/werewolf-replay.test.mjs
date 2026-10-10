/**
 * 狼人杀的观战/回放/视频投影：六席舞台、昼夜场景、出局关键步与阵营终局。
 * 这里用一个脚本化的完整对局当夹具（也顺带验证规则重放能跑通真实 move 列表），
 * 覆盖「翻成视频会不会把好人获胜画成和棋」这类回归。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { noteSpeech, werewolf } from '../werewolf.mjs'
import { hostNarrationLines, replayData } from '../replay/data.mjs'
import { countSpeechLines } from '../speech.mjs'
import { stageHtml } from '../replay/markup.mjs'
import { replayHtml, reportMarkdown } from '../export.mjs'
import { parseDecision } from '../host.mjs'
import { MODEL_PORTRAIT_VARIANTS, assignPortraits, portraitKey, ROLE_MARK, seatIdentity, werewolfPhaseLabel, werewolfScene, werewolfStage, werewolfVoteLine, werewolfVoteTone } from '../presentation.mjs'
import { werewolfTimeline, werewolfStageState } from '../werewolf-projection.mjs'

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
    game: { id: 'werewolf', name: '狼人杀', description: '标准局', version: werewolf.version },
    players: ['猎人', '狼甲', '村民', '狼乙', '预言家', '女巫'].map((name, index) => ({ name, provider: 'test', model: `ww-${index + 1}` })),
    config: { seed: SEED, seats: 6 },
    events, status: 'finished', result: { kind: 'win', winner: state.winner, message: state.terminalReason },
    calls: SCRIPT.length, tokens: 100, state,
    ...overrides,
  }
}

/* 平票夹具：女巫用解药救下刀口 → 第一天 6 人全在 → 首轮 3:3 平票 → 复投才分出结果。
   平票是票型数据最脆的一档：规则层在「宣布结算」的同一手里就把 votes 清空了，
   那一刻的票型只能从结算留档里读。 */
const TIE_SCRIPT = [
  [1, { type: 'kill', target: 3 }], [3, { type: 'kill', target: 3 }],
  [4, { type: 'check', target: 2 }], [5, { type: 'potion', potion: 'save' }],
  [0, { type: 'speak' }], [1, { type: 'speak' }], [2, { type: 'speak' }], [3, { type: 'speak' }], [4, { type: 'speak' }], [5, { type: 'speak' }],
  [0, { type: 'vote', target: 2 }], [1, { type: 'vote', target: 1 }], [2, { type: 'vote', target: 2 }],
  [3, { type: 'vote', target: 1 }], [4, { type: 'vote', target: 2 }], [5, { type: 'vote', target: 1 }],
  [0, { type: 'vote', target: 2 }], [1, { type: 'vote', target: 1 }], [2, { type: 'vote', target: 2 }],
  [3, { type: 'vote', target: 2 }], [4, { type: 'vote', target: 1 }], [5, { type: 'vote', target: 2 }],
  /* 复投的结算播报没有「下一手」可挂，补一手夜刀让那一帧存在（宣布与出局同帧那条契约）。 */
  [3, { type: 'kill', target: 1 }],
]

function playedTieMatch() {
  let state = werewolf.create(SEED)
  const events = []
  TIE_SCRIPT.forEach(([player, action], index) => {
    state = werewolf.apply(state, action, player)
    noteSpeech(state, player, `第 ${index + 1} 手发言`)
    events.push({ type: 'move', moveNumber: index + 1, player, action, speech: `第 ${index + 1} 手发言`, elapsedMs: 100 })
  })
  return {
    id: 'tttttttt-tttt-tttt-tttt-tttttttttttt', title: '狼人杀平票演示',
    game: { id: 'werewolf', name: '狼人杀', description: '标准局', version: werewolf.version },
    players: ['猎人', '狼甲', '村民', '狼乙', '预言家', '女巫'].map((name, index) => ({ name, provider: 'test', model: `ww-${index + 1}` })),
    config: { seed: SEED, seats: 6 },
    events, status: 'running', result: null, calls: events.length, tokens: 100, state,
  }
}

/* 8 人局只跑到第一天：验证档位、栅格列数与逐手播报都在同一条链路上。 */
const SEED_8 = 0x8f3d1c07
function playedEightPlayerMatch() {
  let state = werewolf.create(SEED_8, 8)
  const events = []
  const play = (player, action) => {
    state = werewolf.apply(state, action, player)
    noteSpeech(state, player, '发言')
    events.push({ type: 'move', moveNumber: events.length + 1, player, action, speech: '发言', elapsedMs: 100 })
  }
  const wolves = state.players.filter(player => player.role === 'werewolf' && player.alive).map(player => player.seat)
  const victim = state.players.find(player => player.role === 'villager').seat
  for (const seat of wolves) play(seat - 1, { type: 'kill', target: victim })
  play(state.players.find(player => player.role === 'seer').seat - 1, { type: 'check', target: wolves[0] })
  play(state.players.find(player => player.role === 'witch').seat - 1, { type: 'potion', potion: 'pass' })
  return {
    id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', title: '狼人杀 8 人演示',
    game: { id: 'werewolf', name: '狼人杀', description: '标准局', version: werewolf.version },
    players: Array.from({ length: 8 }, (_, index) => ({ name: `模型 ${index + 1}`, provider: 'test', model: `ww-${index + 1}` })),
    config: { seed: SEED_8, seats: 8 },
    events, status: 'running', result: null, calls: events.length, tokens: 10, state,
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
  assert.deepEqual(steps[0], {
    n: 1, seat: 2, phase: 'night-wolf', label: '狼人行动', scene: 'night', day: 1, alive: [1, 2, 3, 4, 5, 6], deaths: [],
    /* 第一头狼只是提案，阶段没变，这一步开场的播报仍是开局的「天黑请闭眼」 */
    host: '天黑请闭眼。狼人请睁眼，选择今晚要击杀的玩家。',
    /* 还没到投票阶段：这一步没有票型，调用方据此一个空元素都不产出。 */
    voteBoard: null,
  })
  /* 一帧只讲一个时刻：第 4 手是女巫用药，这一帧的公开局面里 3 号仍然活着、台词是「女巫请睁眼」；
     3 号出局与宣布它的「天亮了，昨夜 3 号出局」一起落在下一步（天亮后第一位发言者）——
     主持人先说、选手后说，宣布与出局同帧，谁也不提前一手。 */
  assert.deepEqual(steps[3].deaths, [])
  assert.deepEqual(steps[3].alive, [1, 2, 3, 4, 5, 6])
  assert.equal(steps[3].host, '女巫请睁眼。')
  assert.equal(steps[4].scene, 'day')
  assert.deepEqual(steps[4].deaths, [3])
  assert.deepEqual(steps[4].alive, [1, 2, 4, 5, 6])
  assert.match(steps[4].host, /^天亮了，昨夜 3 号出局。第 1 天，请存活玩家依次发言。$/)
  /* 用户报的那一处：白天最后一位发言者（6 号）手里不能提前说「发言结束」，
     它落在进入投票阶段的第一手（第 10 手 = 第一位投票者）。 */
  assert.equal(steps[8].seat, 6)
  assert.match(steps[8].host, /请存活玩家依次发言/u)
  assert.equal(steps[9].seat, 1)
  assert.equal(steps[9].host, '发言结束，请投票放逐一名玩家。')
  /* 复投最后一票（第 14 手）那一帧还没画出局，被放逐的 2 号与宣布它的播报一起落在下一步 */
  assert.deepEqual(steps[13].deaths, [])
  assert.deepEqual(steps[13].alive, [1, 2, 4, 5, 6])
  assert.deepEqual(steps[14].deaths, [2])
  assert.deepEqual(steps[14].alive, [1, 4, 5, 6])
  assert.match(steps[14].host, /^2 号被投票放逐。天黑请闭眼。/)
  /* 第二夜的刀口同样要等天亮才画：第 17 手（女巫空过）那一帧 1 号还活着 */
  assert.deepEqual(steps[16].deaths, [])
  assert.deepEqual(steps[16].alive, [1, 4, 5, 6])
  assert.equal(steps[17].phase, 'hunter')
  assert.deepEqual(steps[17].deaths, [1])
  assert.deepEqual(steps[17].alive, [4, 5, 6])
  assert.equal(steps[17].scene, 'night')
  /* 猎人开枪那一手读「可以开枪」的引导；他打出的结果没有下一手可挂，交给终局卡。 */
  assert.match(steps[17].host, /^天亮了，昨夜 1 号出局。猎人出局，可以开枪带走一名玩家。$/)
  assert.match(data.werewolf.finale, /^猎人开枪带走了 4 号。/)
  /* 最后一手（猎人开枪）的结果由终局帧承接：4 号出局、席位名单停在 5 / 6 号 */
  assert.deepEqual(data.werewolf.finalAlive, [5, 6])
  assert.deepEqual(data.werewolf.finalDeaths, [4])
})

/* 票型：观众要能从画面上读出「谁投了谁、谁几票、为什么出局」。逐手投影是唯一的取数口
   （观战快照、离线回放、MP4 共用），所以这里把它钉死。 */
test('票型逐手投影：谁投了谁、谁几票、结算留档，且与宣布同帧', () => {
  const steps = replayData(playedMatch()).werewolf.steps
  /* 投票阶段之前没有票型：调用方据此一个空元素都不产出 */
  assert.equal(steps[8].voteBoard, null)
  /* 第 10 手（第一位投票者）那一帧：一票未投，但投票人数已经定下（3 号夜里出局，5 人投票） */
  assert.deepEqual(steps[9].voteBoard, {
    day: 1, round: 1, votes: [], counts: [], leaders: [], top: 0, tie: false, eliminated: null, final: false,
    open: true, voters: 5, awaiting: 5,
  })
  /* 逐手累积：谁投的（seat）、投给谁（target）、谁几票（counts）都在，展示层不需要自己数 */
  assert.deepEqual(steps[10].voteBoard.votes, [{ seat: 1, target: 2 }])
  assert.deepEqual(steps[13].voteBoard.votes.map(vote => `${vote.seat}→${vote.target}`), ['1→2', '2→1', '4→2', '5→2'])
  assert.deepEqual(steps[13].voteBoard.counts, [{ seat: 2, count: 3 }, { seat: 1, count: 1 }])
  assert.equal(steps[13].voteBoard.awaiting, 1)
  /* 第 14 手是最后一位投票者那一帧（本手开场）：第 5 票还没投出来，仍是「进行中」，
     被放逐者不许提前出现 —— 与「出局与宣布同帧」是同一条契约。 */
  assert.equal(steps[13].voteBoard.open, true)
  assert.equal(steps[13].voteBoard.eliminated, null)
  /* 第 15 手（宣布那一帧）：本轮已结算，2 号 4 票被放逐，与主持人的「2 号被投票放逐」同帧 */
  assert.match(steps[14].host, /^2 号被投票放逐。/u)
  assert.deepEqual(steps[14].voteBoard, {
    day: 1, round: 1,
    votes: [{ seat: 1, target: 2 }, { seat: 2, target: 1 }, { seat: 4, target: 2 }, { seat: 5, target: 2 }, { seat: 6, target: 2 }],
    counts: [{ seat: 2, count: 4 }, { seat: 1, count: 1 }], leaders: [2], top: 4, tie: false, eliminated: 2, final: false,
    open: false, voters: null, awaiting: 0,
  })
  /* 结算板留到当夜结束：第二天开场（openDay）票型下画，不残留到新的一天 */
  assert.equal(steps[14].voteBoard.eliminated, 2)
  assert.equal(steps[16].voteBoard.eliminated, 2)
  assert.equal(steps.at(-1).voteBoard.eliminated, 2)
})

test('平票复投：宣布「进入复投」那一帧仍看得到上一轮的票型', () => {
  const match = playedTieMatch()
  const steps = replayData(match).werewolf.steps
  const announce = steps.find(step => /平票/.test(step.host))
  assert.ok(announce, '夹具里没有平票那一帧')
  /* 关键：这一刻 phase 仍是 day-vote（复投正要开始）且规则已经把 votes 清空，
     票型只能从结算留档读出来 —— 只看 votes 会把刚宣布的平票画成「0 票」，
     而那一帧恰恰是唯一能解释「为什么进入复投」的画面。 */
  assert.equal(announce.phase, 'day-vote')
  const snapshot = werewolfTimeline(match).steps.find(step => step.n === announce.n).snapshot
  assert.deepEqual(snapshot.votes, [])
  assert.equal(announce.voteBoard.open, false)
  assert.equal(announce.voteBoard.tie, true)
  assert.deepEqual(announce.voteBoard.leaders, [1, 2])
  assert.equal(announce.voteBoard.top, 3)
  assert.equal(announce.voteBoard.round, 1)
  assert.equal(announce.voteBoard.eliminated, null)
  /* 复投的第一票落下之后，画面交回「本轮进行中」，不再挂着上一轮的结果 */
  const revote = steps.find(step => step.voteBoard?.open && step.voteBoard.round === 2)
  assert.ok(revote, '复投进行中的票型没有回到 open')
  assert.equal(revote.voteBoard.tie, false)
  /* 复投分出结果：2 号 4 票被放逐，这一轮同样留档（round 2） */
  const settled = steps.find(step => step.voteBoard?.eliminated)
  assert.deepEqual([settled.voteBoard.round, settled.voteBoard.eliminated, settled.voteBoard.top], [2, 2, 4])
})

test('出局带死因：席卡标签写「夜刀 / 毒杀 / 票出 / 带走」，不再是一句共用的「出局」', () => {
  const match = playedMatch()
  const data = replayData(match)
  /* 3 号夜里被狼刀、2 号被票出、1 号（猎人）夜里被狼刀、4 号被猎人带走 */
  assert.deepEqual(data.werewolf.deathCauses, { 3: 'wolf', 2: 'vote', 1: 'wolf', 4: 'hunter' })
  /* 逐手快照那条路（观战往回拖 / 离线回放 / 视频都读它） */
  const timeline = werewolfTimeline(match)
  const snapshot = werewolfStage({ players: match.players, state: timeline.steps[14].snapshot })
  assert.deepEqual(snapshot.seats.map(seat => [seat.seat, seat.deathMark]),
    [[1, ''], [2, '票出'], [3, '夜刀'], [4, ''], [5, ''], [6, '']])
  /* 规则真局面那条路（观战跟随最新回合喂的是它）：两种形状必须给出同一个死因 */
  const live = werewolfStage({ players: match.players, state: match.state })
  assert.deepEqual(live.seats.map(seat => seat.deathMark), ['夜刀', '票出', '夜刀', '带走', '', ''])
})

test('票型条文案与配色档：进行中 / 平票 / 出结果三档，三处读同一条', () => {
  const open = { day: 1, round: 1, counts: [{ seat: 2, count: 1 }, { seat: 1, count: 1 }], leaders: [1, 2], top: 1, tie: true, eliminated: null, final: false, open: true, voters: 6, awaiting: 4 }
  assert.equal(werewolfVoteLine(open), '第 1 天 · 投票 2/6 · 并列 1 号、2 号 1 票')
  assert.equal(werewolfVoteTone(open), 'open')
  const revote = { ...open, round: 2, tie: false, leaders: [2], counts: [{ seat: 2, count: 3 }], top: 3 }
  assert.equal(werewolfVoteLine(revote), '第 1 天 · 复投 2/6 · 暂列 2 号 3 票')
  const tie = { ...open, open: false, awaiting: 0, voters: null }
  assert.equal(werewolfVoteLine(tie), '第 1 天 · 平票：1 号、2 号 各 1 票，进入复投')
  assert.equal(werewolfVoteTone(tie), 'tie')
  const out = { day: 1, round: 1, counts: [{ seat: 2, count: 4 }], leaders: [2], top: 4, tie: false, eliminated: 2, final: false, open: false, voters: null, awaiting: 0 }
  assert.equal(werewolfVoteLine(out), '第 1 天 · 投票结果：2 号 4 票，被放逐')
  assert.equal(werewolfVoteTone(out), 'result')
  const stuck = { ...out, eliminated: null, final: true, round: 2, leaders: [1, 2], top: 3 }
  assert.equal(werewolfVoteLine(stuck), '第 1 天 · 复投仍平票：1 号、2 号 各 3 票，本日无人出局')
  /* 与投票无关的一帧不产出任何文案：调用方据此完全不渲染 */
  assert.equal(werewolfVoteLine(null), '')
  assert.equal(werewolfVoteTone(null), '')
})

test('票型三处同源：观战快照 / 离线回放 / MP4 读同一份投影与同一条文案', async () => {
  const client = await readFile(join(HERE, '..', 'client-source.mjs'), 'utf8')
  const markup = await readFile(join(HERE, '..', 'replay', 'markup.mjs'), 'utf8')
  const app = await readFile(join(HERE, '..', 'replay', 'app.js'), 'utf8')
  const entry = await readFile(join(HERE, '..', 'replay', 'entry.mjs'), 'utf8')
  const data = await readFile(join(HERE, '..', 'replay', 'data.mjs'), 'utf8')
  /* 观战页读的是 werewolfStage（它内部调 werewolfVoteBoard），规则真局面与逐手快照同一个口 */
  assert.match(client, /werewolfStage\(\{ players, state, active, speech \}\)/u)
  assert.match(client, /stage\.voteLine/u)
  /* 离线回放与 MP4 都是 markup 那一份；浏览器播放器走 runtime.js 暴露的同名函数，不另写措辞 */
  assert.match(markup, /werewolfVoteLine\(frame\.voteBoard\)/u)
  assert.match(app, /S\.werewolfVoteLine\(frame\.voteBoard\)/u)
  assert.match(app, /S\.werewolfDeathMark/u)
  for (const name of ['werewolfVoteLine', 'werewolfVoteTone', 'werewolfDeathMark']) assert.ok(entry.includes(name), `runtime.js 没有暴露 ${name}`)
  /* 死因表整局一份，不再逐手存 */
  assert.match(data, /deathCauses: timeline\.deathCauses/u)
  /* 产物必须重建：改了源码不跑 arena:build，软件里就是「改了但没生效」 */
  const bundle = await readFile(join(HERE, '..', 'client.js'), 'utf8')
  for (const marker of ['ar-stage-vote', 'ar-cast-vote', 'ar-cast-tally', 'ar-vote-badge']) {
    assert.ok(bundle.includes(marker), `client.js 缺少 ${marker}：改了 presentation.mjs / styles.mjs / client-source.mjs 之后必须执行 npm run arena:build`)
  }
  const runtime = await readFile(join(HERE, '..', 'replay', 'runtime.js'), 'utf8')
  /* 浏览器播放器要用到的三个函数必须真的挂在 window.ArenaScene 上：漏一个就是运行时的
     「S.werewolfVoteLine is not a function」，而离线回放只有真的点开才炸。 */
  const exposed = runtime.match(/globalThis\.ArenaScene=\{([^}]*)\}/u)
  assert.ok(exposed, 'runtime.js 里找不到 ArenaScene 的导出')
  for (const name of ['werewolfVoteLine', 'werewolfVoteTone', 'werewolfDeathMark']) assert.ok(exposed[1].includes(name), `runtime.js 的 ArenaScene 缺少 ${name}`)
})

test('关键步是出局与终局，不是吃子/将军', () => {
  const data = replayData(playedMatch())
  /* 出局刻度落在「主持人宣布它」的那一帧：天亮那一手、放逐播报那一手。
     最后一手的出局没有下一帧可挂，由终局卡宣布；那一手本来就是胜负刻度（胜负优先）。 */
  assert.deepEqual(data.keys, [
    { n: 5, kind: 'death', seats: [3] },
    { n: 15, kind: 'death', seats: [2] },
    { n: 18, kind: 'win' },
  ])
  assert.equal(data.winRun, null)
})

test('种子缺失或档位不支持时降级为「只播发言」，不按新规则解释历史对局', () => {
  const match = playedMatch()
  const data = replayData({ ...match, config: { seats: 6 } })
  assert.equal(data.werewolf.steps, null)
  assert.equal(data.result.side, 'village')
  assert.equal(data.werewolf.seats.filter(seat => seat.role).length, 6)
  /* 仍然画得出六席，不抛异常；降级时开局与终局播报照旧 */
  const stage = stageHtml(data, 5, { layout: 'landscape', t: 0 })
  assert.equal((stage.match(/class="ww-seat"/gu) || []).length, 6)
  assert.match(stageHtml(data, 0, { layout: 'landscape', t: 0 }), /天黑请闭眼/u)
  assert.match(stageHtml(data, 19, { layout: 'landscape', t: 1 }), /好人获胜/u)
})

/* 狼人杀没有棋盘：侧栏的执行者卡就是「谁在执行」的主入口，逐手都要写明模型名。
   席位舞台上的金框只留给胜方，本手执行改用蓝环（颜色口径在 scene.css）。 */
test('狼人杀的执行者卡逐手写明模型名，终局换成阵营口径', () => {
  const data = replayData(playedMatch())
  for (const layout of ['landscape', 'portrait']) {
    const opening = stageHtml(data, 0, { layout, t: 0.5 })
    assert.match(opening, /class="turn" data-phase="move"/u)
    assert.match(opening, /<small class="turn-kicker">开局<\/small>/u)

    const mid = stageHtml(data, 5, { layout, t: 0.5 })
    const speaker = data.moves[4].p
    assert.match(mid, /<small class="turn-kicker">本手执行<\/small>/u)
    assert.match(mid, new RegExp(`<b class="turn-name">${data.players[speaker].name}</b>`, 'u'))
    assert.match(mid, new RegExp(`<span class="sn">${data.players[speaker].name}</span>|<b class="sn">${data.players[speaker].name}</b>`, 'u'))

    const end = stageHtml(data, 19, { layout, t: 1 })
    assert.match(end, /<div class="turn" data-phase="finale"/u)
    assert.match(end, /<small class="turn-kicker">终局<\/small>/u)
    assert.match(end, /<b class="turn-name">\S+阵营<\/b>/u)
  }
})

/* 用户报的那一处：右侧「选手发言」与「回合记录」从前只有模型名，看不出这个模型是什么身份，
   而同供应商的不同模型经常同名（9 人局里出现过两席都叫 deepseek-v4.1-flash）。
   现在四个呈现面（观战署名 / 观战回合记录 / 离线回放 / 视频）统一带「席号 + 徽记 + 中文名」，
   身份取落盘那一份牌；棋类没有身份，一个身份元素都不产出。 */
test('席位身份只对狼人杀成立，且取落盘那一份牌', () => {
  const match = playedMatch()
  assert.deepEqual(seatIdentity(match, 0), { seat: 1, role: 'hunter', mark: '猎', roleName: '猎人' })
  assert.equal(seatIdentity(match, 9), null, '越界席位不猜身份')
  assert.equal(seatIdentity(match, NaN), null)
  assert.equal(seatIdentity({ ...match, game: { id: 'gomoku', name: '五子棋' } }, 0), null, '棋类没有身份')
  /* 身份缺失的记录（没有翻牌/被裁过）宁可不显示，也不编一个 */
  const stripped = { ...match, state: { ...match.state, players: match.state.players.map(player => ({ seat: player.seat, alive: player.alive })) } }
  assert.equal(seatIdentity(stripped, 0), null)
  /* 往回拖时画的是逐手快照，身份仍取落盘那一份：观战与舞台席卡不会各发一套牌 */
  const timeline = werewolfTimeline(match)
  assert.equal(seatIdentity({ ...match, state: werewolfStageState(match, timeline, 1) }, 2).role, 'villager')
})

test('发言署名与回合记录逐行带席号与身份', () => {
  const data = replayData(playedMatch())
  /* 第 5 步（index 5）由 1 号席发言：猎人的牌。 */
  const stage = stageHtml(data, 5, { layout: 'landscape', t: 0.5 })
  assert.match(stage, /<span class="sseat">1 号<\/span><b class="sn">/u)
  assert.match(stage, /<em class="srole" data-role="hunter"><i>猎<\/i>猎人<\/em><em class="stag">本手发言<\/em>/u)
  /* 回合记录那一手之前的最近几手也各带自己的席号与身份：第 6 席（女巫）在第 4 手用药 */
  assert.match(stage, /<div class="rentry"><b>4 · <span class="sseat">6 号<\/span>[\s\S]*?<em class="srole" data-role="witch"><i>巫<\/i>女巫<\/em><\/b>/u)
  /* 竖屏按既有版式不显示回合记录（scene.css 收起 .recent），但署名那一行同样带身份 */
  const portrait = stageHtml(data, 5, { layout: 'portrait', t: 0.5 })
  assert.match(portrait, /<span class="sseat">1 号<\/span>/u)
  assert.match(portrait, /data-role="hunter"/u)
})

test('1.0.0 的历史对局按 6 人牌型重放：版本升级不吞掉旧回放的席卡与身份', () => {
  const match = playedMatch()
  /* 1.0.0 的比赛没有 config.seats，人数只能从选手列表推断 */
  const legacy = { ...match, game: { ...match.game, version: '1.0.0' }, config: { seed: SEED } }
  const data = replayData(legacy)
  assert.equal(data.werewolf.steps.length, 18)
  assert.deepEqual(data.werewolf.steps[3].deaths, [])
  assert.deepEqual(data.werewolf.steps[4].deaths, [3])
  assert.equal((stageHtml(data, 5, { layout: 'landscape', t: 0 }).match(/class="ww-seat"/gu) || []).length, 6)
})

test('8 人档位：投影、栅格列数与逐手播报都跟着人数走', () => {
  const data = replayData(playedEightPlayerMatch())
  assert.equal(data.werewolf.seats.length, 8)
  assert.deepEqual(data.werewolf.columns, { landscape: 4, portrait: 4 })
  assert.equal(data.werewolf.seats.map(seat => seat.role).filter(role => role === 'werewolf').length, 2)
  assert.equal(data.werewolf.steps.length, 4)
  /* 8 人局只跑到女巫：这一步开场的播报是「女巫请睁眼」，天亮结算还没有下一手可挂，归终局文案 */
  assert.equal(data.werewolf.steps[3].host, '女巫请睁眼。')
  assert.match(data.werewolf.finale, /^天亮了，昨夜 \d+ 号出局。第 1 天，请存活玩家依次发言。$/)
  const stage = stageHtml(data, 4, { layout: 'landscape', t: 0.2 })
  assert.match(stage, /data-seats="8"/u)
  assert.match(stage, /--ww-cols:4;--ww-cols-portrait:4/u)
  assert.equal((stage.match(/class="ww-seat"/gu) || []).length, 8)
  assert.match(stage, /class="ww-host"/u)
  assert.match(stage, /女巫请睁眼/u)
  assert.match(stageHtml(data, 5, { layout: 'landscape', t: 0.2 }), /天亮了，昨夜 \d+ 号出局/u)
  const portrait = stageHtml(data, 4, { layout: 'portrait', t: 0.2 })
  assert.match(portrait, /data-layout="portrait"/u)
  assert.match(portrait, /--ww-cols-portrait:4/u)
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

  /* 第 4 手（女巫用药）还不许画出局：这一帧的公开局面里 3 号仍然活着 */
  const beforeDawn = stageHtml(data, 4, { layout: 'landscape', t: 0.2 })
  assert.equal((beforeDawn.match(/data-alive="false"/gu) || []).length, 0)
  assert.equal(beforeDawn.includes('class="ww-strike"'), false)
  assert.match(beforeDawn, /女巫请睁眼/u)
  /* 第 5 手（天亮后第一位发言者）：宣布「昨夜 3 号出局」与出局本身在同一帧 */
  const death = stageHtml(data, 5, { layout: 'landscape', t: 0.2 })
  assert.match(death, /data-act="death"/u)
  assert.match(death, /class="ww-host"/u)
  assert.match(death, /天亮了，昨夜 3 号出局/u)
  assert.match(death, /class="ww-strike"/u)
  assert.equal((death.match(/data-alive="false"/gu) || []).length, 2, '席卡与身份榜各一处')
  assert.equal(death.includes('ww-deaths'), false, '出局横幅已并入主持人台词，不再单独画一条')

  /* 最后一票那一帧：投的是 2 号，但 2 号还没出局（计票结果与播报都在下一帧） */
  const vote = stageHtml(data, 14, { layout: 'landscape', t: 0.2 })
  assert.match(vote, /data-scene="day"/u)
  assert.match(vote, /发言结束，请投票放逐一名玩家/u)
  assert.match(vote, /投票 2 号/u)
  assert.equal((vote.match(/data-alive="false"/gu) || []).length, 2, '只有首夜出局的 3 号')
  assert.equal(vote.includes('2 号被投票放逐'), false)
  /* 下一帧（进入夜晚）主持人宣布「2 号被投票放逐」，同一帧 2 号出局 */
  const voted = stageHtml(data, 15, { layout: 'landscape', t: 0.2 })
  assert.match(voted, /2 号被投票放逐/u)
  assert.match(voted, /data-scene="night"/u)
  assert.equal((voted.match(/data-alive="false"/gu) || []).length, 4, '3 号与 2 号各一处')
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
  /* 胜负卡占主持人那一格：终局那一帧不再同时出主持人胶囊，也不再绝对定位飘在席位条带中间。
     正文与终局那一格的配音同源（data.werewolf.finaleBody＝最后一条结算播报 + 裁决）。 */
  assert.equal(finale.includes('class="ww-host"'), false, '终局把主持人那一格让给胜负卡')
  assert.ok(finale.indexOf('class="ww-win"') < finale.indexOf('class="ww-cast"'), '胜负卡要排在席位条带之前，条带从它下面开始')
  assert.match(finale, /class="ww-win" data-side="village"/u)
  assert.ok(data.werewolf.finaleBody && finale.includes(data.werewolf.finaleBody), '胜负卡正文取自投影好的 finaleBody')
  /* 位移随绝对定位一起撤掉（席卡里的红叉仍是绝对定位，那是它自己容器的事）。 */
  const winTag = finale.slice(finale.indexOf('class="ww-win"'), finale.indexOf('class="ww-cast"'))
  assert.match(winTag, /transform:scale\(/u)
  assert.doesNotMatch(winTag, /translate/u)
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
  /* 胸像只服务紧凑档（象棋竖屏）。狼人杀走不到那一档，内联它就是白拎体积——
     所以这里反过来断言「没有」，象棋那一条在 presentation.test.mjs。 */
  assert.deepEqual(art.busts, {}, '狼人杀走不到紧凑档，不该内联胸像')
  /* 昼夜场景是狼人杀专属，只有它需要内联 */
  assert.equal(Object.keys(art.scenes).length, 2)
  const embedded = JSON.parse(offline.match(/__ARENA_DATA__=(.*?);<\/script>/su)[1])
  assert.equal(embedded.result.side, 'village')
  assert.equal(embedded.werewolf.steps.length, 18)
})

test('主持人播报配音：按换句取台词，一手先主持人后选手', () => {
  const match = playedMatch()
  const lines = hostNarrationLines(match)
  /* 台词锚在「本手开场」：进入新阶段的那一手带走新的一句，最后一条结算播报落在终局卡那一手（手数 + 1） */
  assert.deepEqual(lines.map(line => line.n), [1, 3, 4, 5, 10, 15, 16, 17, 18, 19], '开局挂第一手，其后每句台词只占一手')
  assert.equal(lines[0].text, '天黑请闭眼。狼人请睁眼，选择今晚要击杀的玩家。')
  assert.equal(lines[1].text, '预言家请睁眼，查验一名玩家的身份。')
  assert.equal(lines[2].text, '女巫请睁眼。')
  assert.equal(lines[3].text, '天亮了，昨夜 3 号出局。第 1 天，请存活玩家依次发言。')
  assert.equal(lines[4].text, '发言结束，请投票放逐一名玩家。')
  assert.equal(lines.at(-1).text, '猎人开枪带走了 4 号。')
  assert.deepEqual(countSpeechLines(match), { speech: 18, host: 10, total: 28 })

  /* 音频分段：主持人先说，选手后说；audioSec 是两段之和（时间轴按它拉长） */
  const data = replayData(match, new Map([
    [1, { host: { seconds: 2.5 }, speech: { seconds: 3.5 } }],
    [4, { speech: { seconds: 4 } }],
  ]))
  assert.equal(data.moves[0].hostAudioSec, 2.5)
  assert.equal(data.moves[0].audioSec, 6)
  assert.equal(data.moves[3].hostAudioSec, undefined)
  assert.equal(data.moves[3].audioSec, 4)
  /* 旧的单轨形状继续按「选手发言」解释，不产生主持人那一段 */
  const legacy = replayData(match, new Map([[1, { seconds: 2 }]]))
  assert.equal(legacy.moves[0].audioSec, 2)
  assert.equal(legacy.moves[0].hostAudioSec, undefined)
  /* 离线回放把两段都内联成 data URL，并按主持人时长把选手发言往后排 */
  const html = replayHtml(match, new Map([[4, {
    host: { seconds: 2, src: 'data:audio/mpeg;base64,AAAA' },
    speech: { seconds: 3, src: 'data:audio/mpeg;base64,BBBB' },
  }]]))
  const embedded = JSON.parse(html.match(/__ARENA_DATA__=(.*?);<\/script>/su)[1])
  assert.deepEqual(embedded.moves[3].hostAudio, 'data:audio/mpeg;base64,AAAA')
  assert.deepEqual(embedded.moves[3].audio, 'data:audio/mpeg;base64,BBBB')
  assert.equal(embedded.moves[3].hostAudioSec, 2)
  assert.equal(embedded.moves[3].audioSec, 5)
})

/* 用户报的那一处：离线回放里 6 号还在发言，主持人已经先说「发言结束，请投票放逐一名玩家。」。
   根因是规则层在最后一位发言者的 apply 里写结算播报，而画面按「主持人先说、选手后说」渲染。
   这里守住修好后的口径：这一手只带发言引导，投票引导落在进入投票阶段的第一手；
   整局最后一条结算播报没有下一手可挂，由终局卡说出来并配音。 */
test('最后一位发言者不再提前说「发言结束」，结算播报与终局卡各就各位', () => {
  const match = playedMatch()
  const replay = replayData(match).werewolf
  const lastSpeech = replay.steps.filter(step => step.phase === 'day-speech').at(-1)
  const firstVote = replay.steps.find(step => step.phase === 'day-vote')
  assert.equal(lastSpeech.seat, 6, '白天按存活座位顺序发言，最后一位是 6 号（5 号首夜已出局）')
  assert.equal(replay.steps[lastSpeech.n - 2].seat, 5, '5 号在前面一手发言')
  assert.match(lastSpeech.host, /请存活玩家依次发言/u, '发言那一手只能说「请依次发言」')
  assert.equal(lastSpeech.host.includes('发言结束'), false)
  assert.equal(firstVote.n, lastSpeech.n + 1)
  assert.equal(firstVote.host, '发言结束，请投票放逐一名玩家。', '投票引导落在第一位投票者那一手')

  /* 配音按同一口径排：发言那一手只有 6 号的发言；投票那一手才是「主持人先说、选手后说」 */
  const data = replayData(match, new Map([
    [lastSpeech.n, { speech: { seconds: 4 } }],
    [firstVote.n, { host: { seconds: 2 }, speech: { seconds: 3 } }],
  ]))
  assert.equal(data.moves[lastSpeech.n - 1].hostAudioSec, undefined)
  assert.equal(data.moves[lastSpeech.n - 1].audioSec, 4)
  assert.equal(data.moves[firstVote.n - 1].hostAudioSec, 2)
  assert.equal(data.moves[firstVote.n - 1].audioSec, 5)

  /* 整局最后一条结算播报（猎人开枪）挂在终局卡那一手：文案进终局卡，配音进终局卡那一格 */
  const closingNumber = replay.steps.length + 1
  assert.equal(hostNarrationLines(match).at(-1).n, closingNumber)
  const closing = replayData(match, new Map([[closingNumber, { host: { seconds: 2.5, src: 'data:audio/mpeg;base64,AAAA' } }]]))
  assert.match(closing.werewolf.finale, /^猎人开枪带走了 4 号。狼人全灭，好人获胜。/)
  /* 终局那一帧三处同源：观战（记录自己的 state + finale 分支）与回放/视频的终局卡逐字一致 */
  assert.equal(closing.werewolf.finale, '猎人开枪带走了 4 号。狼人全灭，好人获胜。')
  assert.equal(werewolfStage({ players: match.players, state: werewolfStageState(match, werewolfTimeline(match), closingNumber - 1) }).host, closing.werewolf.finale)
  assert.match(stageHtml(closing, closingNumber, { layout: 'landscape', t: 1 }), /猎人开枪带走了 4 号。狼人全灭，好人获胜。/u)
  assert.equal(closing.werewolf.finaleAudioSec, 2.5)
  assert.equal(closing.werewolf.finaleAudio, 'data:audio/mpeg;base64,AAAA')
  assert.equal(closing.moves.length, replay.steps.length, '终局那一手不占手数')
  /* 离线 HTML 把终局那一段也内联进去：不联网也能听见最后一句 */
  const html = replayHtml(match, new Map([[closingNumber, { host: { seconds: 2.5, src: 'data:audio/mpeg;base64,AAAA' } }]]))
  const embedded = JSON.parse(html.match(/__ARENA_DATA__=(.*?);<\/script>/su)[1])
  assert.equal(embedded.werewolf.finaleAudioSec, 2.5)
  assert.match(embedded.werewolf.finale, /^猎人开枪带走了 4 号。/)
})

test('降级投影仍给出开局播报，非狼人杀没有主持人台词', () => {
  const match = playedMatch()
  const degraded = { ...match, config: { seats: 6 } }
  assert.deepEqual(hostNarrationLines(degraded), [{ n: 1, text: '天黑请闭眼。狼人请睁眼，选择今晚要击杀的玩家。' }])
  assert.deepEqual(hostNarrationLines({ ...match, game: { id: 'gomoku', name: '五子棋' } }), [])
  assert.deepEqual(countSpeechLines({ ...match, game: { id: 'gomoku' } }).host, 0)
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
  assert.equal(live.columns, 6)
  /* 终局那一帧说裁决文案，并把最后一条结算播报一起说完；非终局读规则层这一手的播报 */
  assert.equal(live.host, '猎人开枪带走了 4 号。狼人全灭，好人获胜。')
  const mid = werewolfStage({ players: match.players, state: { ...match.state, winner: null, terminalReason: null, phase: 'day-vote' }, active: 2 })
  assert.match(mid.host, /猎人开枪带走了 4 号/)
  assert.equal(mid.seatCount, 6)

  /* 赛前占位：六个座位拿到六张不同立绘，不再全是同一张通用图 */
  const stub = werewolfStage({
    players: Array.from({ length: 6 }, (_, index) => ({ name: `${index + 1} 号待选` })),
    state: { phase: 'night-wolf', players: Array.from({ length: 6 }, (_, index) => ({ seat: index + 1, role: 'villager', alive: true })) },
  })
  assert.equal(new Set(stub.seats.map(seat => seat.portrait)).size, 6)
  /* 观战舞台的列数也按人数走：8 人 4 列、9 人 5 列 */
  assert.equal(werewolfStage({
    players: Array.from({ length: 9 }, (_, index) => ({ name: `${index + 1} 号待选` })),
    state: { phase: 'night-wolf', players: Array.from({ length: 9 }, (_, index) => ({ seat: index + 1, role: 'villager', alive: true })) },
  }).columns, 5)
})

/* 观战页的播放/拖动曾经是坏的：席位舞台只读 match.state（终局的唯一快照），所以点播放
   从头播时画面一直停在「好人获胜 + 全部出局」。这里守住修复后的口径 —— 停在那一刻画那一刻，
   且与离线回放/视频逐手投影同源。 */
test('观战页往回拖按第 k 步的公开局面重画席位，且与离线回放逐手投影同源', () => {
  const match = playedMatch()
  const timeline = werewolfTimeline(match)
  assert.equal(timeline.replayable, true)
  assert.equal(timeline.steps.length, match.events.length)
  const stageAt = step => werewolfStage({ players: match.players, state: werewolfStageState(match, timeline, step) })

  /* 第 0 步是开局：全员存活、第 1 天夜间，既没有终局图层也不提前挂胜负徽标 */
  const opening = stageAt(0)
  assert.deepEqual(opening.seats.map(seat => seat.alive), Array(6).fill(true))
  assert.deepEqual(opening.seats.map(seat => seat.badge), Array(6).fill(''))
  assert.equal(opening.winnerSide, null)
  assert.equal(opening.day, 1)
  assert.equal(opening.phaseLabel, '狼人行动')
  assert.equal(opening.host, '天黑请闭眼。狼人请睁眼，选择今晚要击杀的玩家。')

  /* 逐手同源：观战停在第 k 步看到的存活、天数、阶段、昼夜与主持人台词，
     必须与离线回放/视频那一帧逐字一致。终局帧（离线是最后一手之后单独的一帧）不在其中：
     观战按棋类的口径把终局图层挂在最后一手，见下面的断言。 */
  const replay = replayData(match).werewolf
  for (const step of replay.steps.slice(0, -1)) {
    const stage = stageAt(step.n)
    assert.deepEqual(stage.seats.filter(seat => seat.alive).map(seat => seat.seat), step.alive, `第 ${step.n} 步存活名单`)
    assert.equal(stage.day, step.day, `第 ${step.n} 步天数`)
    assert.equal(stage.phaseLabel, step.label, `第 ${step.n} 步阶段`)
    assert.equal(stage.scene, step.scene, `第 ${step.n} 步昼夜`)
    assert.equal(stage.host, step.host, `第 ${step.n} 步主持人台词`)
    assert.equal(stage.winnerSide, null, `第 ${step.n} 步不提前泄露胜负`)
    assert.deepEqual(stage.seats.map(seat => seat.badge), Array(6).fill(''), `第 ${step.n} 步不提前挂徽标`)
  }
  /* 首夜出局由天亮那一手宣布：停在第 4 手（女巫用药）还不许画出局，停在第 5 手必须已经画上 */
  assert.deepEqual(stageAt(4).seats.map(seat => seat.alive), Array(6).fill(true))
  assert.equal(stageAt(5).seats[2].alive, false)

  /* 停在最后一手 = 跟随最新回合 = 记录自己的 state：终局抬头、胜负面板与「胜 / 负」徽标只在这里出现 */
  const end = stageAt(replay.steps.at(-1).n)
  assert.equal(end.winnerSide, 'village')
  assert.equal(end.phaseLabel, '终局')
  assert.deepEqual(end.seats.map(seat => seat.alive), [false, false, false, false, true, true])
  assert.equal(end.seats.filter(seat => seat.badge === '胜').length, 4, '好人阵营 3 神 + 1 民')
  assert.equal(end.seats.filter(seat => seat.badge === '负').length, 2)
})

/* 身份整局不变，且是发牌时落盘的权威值。重放也会发一次牌，但画面上的身份标记必须取落盘那一份：
   否则改了发牌算法之后，历史对局往回拖时身份会跟着变，而终局帧（读 match.state）却不变。 */
test('观战逐手画的身份取落盘那一份，不拿重放重发的牌覆盖记录', () => {
  const match = playedMatch()
  /* 把落盘身份整体错开一位：重放发牌与它不一致时，画面与席卡都必须跟着记录走 */
  const shifted = { ...match, state: { ...match.state, players: match.state.players.map((player, index) => ({ ...player, role: match.state.players[(index + 1) % 6].role })) } }
  const dealt = shifted.state.players.map(player => player.role)
  const timeline = werewolfTimeline(shifted)
  assert.equal(timeline.replayable, true)
  /* 规则重放照旧用自己的发牌（不然动作序列对不上），只有画面身份被覆盖 */
  assert.deepEqual(timeline.steps[0].snapshot.players.map(player => player.role), dealt)
  assert.deepEqual(werewolfStage({ players: shifted.players, state: werewolfStageState(shifted, timeline, 3) }).seats.map(seat => seat.role), dealt)
  assert.deepEqual(replayData(shifted).werewolf.seats.map(seat => seat.role), dealt)
})

test('狼人杀档位不可重放时观战退回比赛自己的 state，不猜局面', () => {
  const match = playedMatch()
  const degraded = { ...match, config: { ...match.config, seed: undefined } }
  const timeline = werewolfTimeline(degraded)
  assert.equal(timeline.replayable, false)
  assert.deepEqual(timeline.steps, [])
  /* 终局口径仍从记录自己的 state 读，降级不等于不报胜负 */
  assert.equal(timeline.winnerSide, 'village')
  for (const step of [0, 1, 5, match.events.length]) assert.equal(werewolfStageState(degraded, timeline, step), degraded.state)
  /* 档位与选手数对不上（host 创建时强制相等，只可能是记录被改过）同样降级，不画多出来的无名席卡 */
  assert.equal(werewolfTimeline({ ...match, config: { ...match.config, seats: 8 } }).replayable, false)
  /* 不是狼人杀就没有这份投影，调用方按 game.id 分流 */
  assert.equal(werewolfTimeline({ ...match, game: { id: 'gomoku', name: '五子棋' } }), null)
})
test('werewolf-art.mjs 与 assets/werewolf/scenes 保持同步（改了素材必须重新 arena:build）', async () => {
  /* 场景是狼人杀专属；选手形象是跨游戏共用的模型身份资产，已移到 assets/models，
     由 test/model-art.test.mjs 守住同步。 */
  const names = async directory => (await readdir(join(HERE, '..', 'assets', 'werewolf', directory)))
    .filter(name => /\.(jpe?g|png|webp)$/iu.test(name)).map(name => name.replace(/\.[^.]+$/u, '')).sort()
  const { WEREWOLF_ART } = await import('../werewolf-art.mjs')
  assert.deepEqual(Object.keys(WEREWOLF_ART.scenes).sort(), await names('scenes'))
  assert.equal(WEREWOLF_ART.portraits, undefined, '形象不再是狼人杀专属资产，不该留在这里')
  for (const url of Object.values(WEREWOLF_ART.scenes)) assert.match(url, /^data:image\/jpeg;base64,\/9j\//u)
})

/* ------------------------------------------------------- 同族立绘不重复（观战/回放同源）
   用户的原始诉求：同一个供应商下的不同模型（qwen3.8-max 与 qwen-3.8-flash）此前共用一张图。
   立绘按家族成池分配后，判据是「同族席位数 <= 变体数」；变体数当前 3，最大档位 9，
   所以 9 席全同族仍会回绕复用——这是分期铺素材的已知上限，补到 9 套即自动收紧。 */
const portraitPlayer = (model, id, provider = 'bailian', providerName = '百炼') => ({ id, name: model, provider, providerName, model })

test('同一家族的不同模型拿到不同立绘，同族席位数不超过变体数时零重复', () => {
  const pair = assignPortraits([portraitPlayer('qwen3.8-max', 0), portraitPlayer('qwen-3.8-flash', 1)])
  assert.equal(new Set(pair).size, 2, '同族两个模型不能共用一张立绘')
  assert.deepEqual(assignPortraits([portraitPlayer('qwen3.8-max', 0)]), ['qwen'], '只出现一次的家族拿主图')
  for (let seats = 1; seats <= MODEL_PORTRAIT_VARIANTS; seats += 1) {
    const cast = Array.from({ length: seats }, (_, index) => portraitPlayer(`qwen3.8-${index}`, index))
    assert.equal(new Set(assignPortraits(cast)).size, seats, `同族 ${seats} 席应当零重复`)
  }
  assert.equal(new Set(assignPortraits([portraitPlayer('qwen3.8-max', 0), portraitPlayer('qwen3.8-max', 1)])).size, 2,
    '同一个模型自对弈也要错开')
})

test('超出变体数后确定性回绕复用（补素材即可收紧，不需要改分配逻辑）', () => {
  const nine = Array.from({ length: 9 }, (_, index) => portraitPlayer(`qwen3.8-${index}`, index))
  const portraits = assignPortraits(nine)
  assert.equal(new Set(portraits).size, MODEL_PORTRAIT_VARIANTS, '每套变体都被用到')
  assert.deepEqual(assignPortraits(nine), portraits, '同一份输入必须每次一样')
  /* 任意局面零重复的条件是 变体数 >= 最大席位数（9）；补齐后这一条会自动生效。 */
  if (MODEL_PORTRAIT_VARIANTS >= 9) assert.equal(new Set(portraits).size, 9)
})

test('同一模型跨局穿同一套，未命中家族不与命中家族撞车', () => {
  const first = assignPortraits([portraitPlayer('qwen3.8-max', 0), portraitPlayer('qwen-3.8-flash', 1)])
  const swapped = assignPortraits([portraitPlayer('qwen-3.8-flash', 0), portraitPlayer('qwen3.8-max', 1)])
  assert.equal(first[0], swapped[1], 'qwen3.8-max 换座位后仍是同一套')
  assert.equal(first[1], swapped[0], 'qwen-3.8-flash 换座位后仍是同一套')

  /* 未命中家族的选手走品牌轮转，必须绕开已命中的家族：否则第 9 席会和 GLM 撞成同一张 */
  const mixed = assignPortraits([
    portraitPlayer('qwen3.8-max', 0), portraitPlayer('qwen-3.8-flash', 1),
    portraitPlayer('kimi-k3', 2, 'moonshot', '月之暗面'), portraitPlayer('claude-opus', 3, 'anthropic', 'Anthropic'),
    portraitPlayer('qwen3.8-turbo', 4), portraitPlayer('claude-sonnet', 5, 'anthropic', 'Anthropic'),
    portraitPlayer('glm-5.3', 6, 'zhipu', '智谱'), portraitPlayer('kimi-k2.5', 7, 'moonshot', '月之暗面'),
    portraitPlayer('local-llama', 8, 'ollama', '自建'),
  ])
  assert.equal(new Set(mixed).size, 9, '混合九席必须零重复')
  assert.equal(portraitKey({ id: 8, model: 'local-llama' }, 8), 'zhipu', '单席兜底仍是按座位轮转')
  const unknowns = Array.from({ length: 6 }, (_, index) => portraitPlayer(`mystery-${index}`, index, 'ollama', '自建'))
  assert.equal(new Set(assignPortraits(unknowns)).size, 6, '未命中六席不能退化成一堆通用图')
})

test('观战舞台与离线回放取同一批立绘', () => {
  const match = playedMatch()
  const players = Array.from({ length: 6 }, (_, index) => portraitPlayer(`qwen3.8-${index}`, index))
  const stage = werewolfStage({ players, state: { ...match.state, phase: 'day-vote' } })
  const replay = replayData({ ...match, players })
  assert.deepEqual(stage.seats.map(seat => seat.portrait), replay.werewolf.seats.map(seat => seat.portrait))
  assert.equal(new Set(stage.seats.map(seat => seat.portrait)).size, MODEL_PORTRAIT_VARIANTS)
})

/* 一帧只讲一个时刻：主持人宣布谁出局的那一帧，那名玩家必须已经出局；反过来，
   还没被宣布的人不许提前出局（夜里被刀的人要活到天亮那一帧）。这是这次修的那类错位的总闸门：
   从前存活/出局取「这一步打完之后」，台词取「这一步开场」，于是出局永远比宣布它的那句话早一帧。 */
test('出局与宣布它的那句话同帧，谁也不提前一手', () => {
  const announcement = host => {
    const seats = []
    const dawn = host.match(/天亮了，昨夜 (.+?)出局/u)
    if (dawn) seats.push(...(dawn[1].match(/\d+/gu) || []).map(Number))
    const vote = host.match(/(\d+) 号被投票放逐/u)
    if (vote) seats.push(Number(vote[1]))
    const shot = host.match(/猎人开枪带走了 (\d+) 号/u)
    if (shot) seats.push(Number(shot[1]))
    return seats.sort((left, right) => left - right)
  }
  const replay = replayData(playedMatch()).werewolf
  let previous = replay.seats.map(seat => seat.seat)
  for (const step of replay.steps) {
    const said = announcement(step.host)
    const fresh = previous.filter(seat => !step.alive.includes(seat))
    /* 这一帧新出局的人，必须在这一帧的台词里被说出来（宣布与出局同帧，谁也不提前一手） */
    for (const seat of fresh) assert.ok(said.includes(seat), `第 ${step.n} 步：${seat} 号提前出局，台词「${step.host}」还没说他出局`)
    /* 台词里说到的出局者，这一帧必须已经出局（公告当天重复同一句时也成立） */
    for (const seat of said) assert.equal(step.alive.includes(seat), false, `第 ${step.n} 步：台词宣布 ${seat} 号出局，画面却还画着他存活`)
    /* deaths 是相对上一帧的增量：出局动效与进度条刻度都落在宣布那一帧 */
    assert.deepEqual([...step.deaths].sort((left, right) => left - right), fresh.slice().sort((left, right) => left - right), `第 ${step.n} 步 deaths 必须是相对上一帧的增量`)
    previous = step.alive
  }
  /* 最后一手的结果没有下一帧可挂：由终局卡宣布，终局席位必须已经算进去 */
  const last = replay.steps.at(-1)
  const fresh = last.alive.filter(seat => !replay.finalAlive.includes(seat))
  assert.deepEqual(fresh, announcement(replay.finale), '终局卡宣布的人必须正好是终局帧新出局的人')
  assert.deepEqual(replay.finalDeaths, announcement(replay.finale))
})

/* 直播最新一帧的两种现场：下一位已经在飞（观众刚听完上一位的结算播报），
   与空闲停在最后一手（这一帧仍是「最后一手」那一帧）。两者都要与台词同一个时刻。 */
test('观战跟随最新回合：回合在飞时与刚宣布的结果同帧，空闲时停在最后一手的开场', () => {
  const match = playedMatch()
  const timeline = werewolfTimeline(match)
  const last = replayData(match).werewolf.steps.at(-1)
  const aliveSeats = stage => stage.seats.filter(seat => seat.alive).map(seat => seat.seat)
  /* 还没分出胜负的同一场比赛：走「最新一帧」的两种现场，而不是终局分支 */
  const running = { ...match, state: { ...match.state, winner: null, terminalReason: null } }

  const idle = werewolfStage({ players: match.players, state: werewolfStageState(running, timeline, timeline.steps.length) })
  assert.equal(idle.host, last.host, '空闲时台词是最后一手的开场引导')
  assert.deepEqual(aliveSeats(idle), last.alive, '空闲时存活也是最后一手开场那一刻的名单')

  const live = { ...running, activeTurn: { turnId: 'next-turn', player: 0, phase: 'reasoning', startedAt: new Date().toISOString() } }
  const latest = werewolfStage({ players: match.players, state: werewolfStageState(live, timeline, timeline.steps.length) })
  const recorded = werewolfStage({ players: match.players, state: live.state })
  assert.equal(latest.host, recorded.host, '回合在飞时台词就是刚写下的那条结算播报')
  assert.deepEqual(aliveSeats(latest), aliveSeats(recorded), '回合在飞时画面已经画出上一位的结果，与那句播报同帧')
})
