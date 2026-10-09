import assert from 'node:assert/strict'
import test from 'node:test'
import { actionLabel, boardSvg, finaleInfo, forfeitDetail, frameAt, matchOutcome, matchTitle, playerSide, seatBadge, werewolfSide, werewolfStage, winningRun, xiangqiPosition } from '../presentation.mjs'
import { replayHtml, reportMarkdown } from '../export.mjs'

const move = (fromRow, fromCol, toRow, toCol, player) => ({ from: { row: fromRow, col: fromCol }, to: { row: toRow, col: toCol }, player })
const opening = [move(8, 2, 8, 5, 0), move(1, 2, 3, 3, 1), move(8, 5, 4, 5, 0)]
const fixture = {
  id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', title: '象棋演示',
  game: { id: 'xiangqi', name: '中国象棋', description: '中国象棋规则', version: '1' },
  players: [{ name: '红方模型', provider: 'test', model: 'red' }, { name: '黑方模型', provider: 'test', model: 'black' }],
  events: opening.map(({ player, ...action }, i) => ({ type: 'move', player, action, speech: `第 ${i + 1} 手`, moveNumber: i + 1, elapsedMs: 100 })),
  status: 'finished', result: { message: '比赛结束', winner: null }, calls: 3, tokens: 100,
}

test('xiangqi replay starts with 32 pieces and reconstructs moves and captures', () => {
  const initial = xiangqiPosition()
  assert.equal(initial.flat().filter(Boolean).length, 32)
  assert.equal(initial[0][4], 'K')
  assert.equal(initial[9][4], 'k')
  const beforeCapture = xiangqiPosition(frameAt(fixture, 2).moves)
  assert.equal(beforeCapture.flat().filter(Boolean).length, 32)
  assert.equal(beforeCapture[7][1], null)
  assert.equal(beforeCapture[7][4], 'c')
  assert.equal(beforeCapture[2][2], 'N')
  const captured = xiangqiPosition(frameAt(fixture, 3).moves)
  assert.equal(captured.flat().filter(Boolean).length, 31)
  assert.equal(captured[3][4], 'c')
  assert.equal(captured[7][4], null)
  assert.equal(initial[3][4], 'P')
})

test('xiangqi reports use red/black identities and coordinate actions', () => {
  assert.equal(playerSide(fixture.game, 0), '红方')
  assert.equal(playerSide(fixture.game, 1), '黑方')
  assert.equal(actionLabel(fixture.events[0].action, fixture.game), '8行2列 → 8行5列')
  /* 画面层的断言在 replay.test.mjs：那里覆盖 stageHtml 的红黑身份、楚河汉界与坐标文案。 */
  const offline = replayHtml(fixture)
  /* 离线回放是数据驱动的：棋盘在浏览器里用同一份 boardSvg 现画，
     所以这里断言内联进去的数据本身，而不是预先渲染好的 SVG 文本。 */
  assert.match(offline, /globalThis\.ArenaScene/u)
  assert.equal(offline.includes('https://'), false)
  assert.equal(offline.includes('{{'), false)
  /* 素材内联按「这一局用得到」来：象棋走不到狼人杀的昼夜场景，但**形象要带**
     （任何游戏的执行者卡都可能画人）；胸像只在紧凑档（象棋竖屏）用得到，所以象棋要带、
     狼人杀不带——两条断言各守一边。 */
  const art = JSON.parse(offline.match(/__ARENA_ART__=(.*?);<\/script>/su)[1])
  assert.deepEqual(art.scenes, {}, '象棋不该内联狼人杀的昼夜场景')
  assert.ok(Object.keys(art.portraits).length >= 2, '象棋要把选手形象带上')
  assert.ok(Object.keys(art.busts).length >= 2, '象棋竖屏走紧凑档，胸像必须内联')
  const embedded = JSON.parse(offline.match(/__ARENA_DATA__=(.*?);<\/script>/su)[1])
  assert.equal(embedded.game.id, 'xiangqi')
  assert.equal(embedded.game.name, '中国象棋')
  assert.equal(embedded.moves.length, 3)
  assert.deepEqual(embedded.moves.map(move => move.a), opening.map(({ player, ...action }) => action))
  assert.equal(embedded.players.map(player => player.name).join('/'), '红方模型/黑方模型')
  assert.deepEqual(embedded.keys, [{ n: 3, kind: 'last' }])
  const report = reportMarkdown(fixture)
  assert.match(report, /红方：test\/red/u)
  assert.match(report, /黑方：test\/black/u)
  assert.match(report, /8行5列 → 4行5列/u)
  assert.equal(report.includes('undefined 行'), false)
})

test('gomoku retains its original display alongside xiangqi', () => {
  const game = { id: 'gomoku', name: '五子棋' }
  assert.equal(playerSide(game, 0), '黑方')
  assert.equal(playerSide(game, 1), '白方')
  assert.equal(actionLabel({ row: 8, col: 8 }, game), '8 行 8 列')
  assert.match(boardSvg([{ row: 8, col: 8, player: 0 }]), /五子棋棋盘，1 手/u)
  assert.match(boardSvg([], { gameId: 'xiangqi' }), /中国象棋棋盘，0 手/u)
})

test('matchTitle prefixes the game name exactly once, including legacy chess titles', () => {
  assert.equal(matchTitle({ title: 'a vs b', game: { id: 'gomoku', name: '五子棋' } }), '五子棋 · a vs b')
  assert.equal(matchTitle({ title: 'a vs b', game: { id: 'xiangqi', name: '中国象棋' } }), '中国象棋 · a vs b')
  /* 狼人杀标题自带游戏名（现行「（N 人）」与历史「A / B / …」两种旧格式都不重复加前缀） */
  const wolf = { id: 'werewolf', name: '狼人杀' }
  assert.equal(matchTitle({ title: '狼人杀（8 人）· A 等 8 位', game: wolf }), '狼人杀（8 人）· A 等 8 位')
  assert.equal(matchTitle({ title: '狼人杀 · A / B / C', game: wolf }), '狼人杀 · A / B / C')
  /* 幂等：新建记录已带前缀，列表与导出不能叠成「五子棋 · 五子棋 · a vs b」 */
  assert.equal(matchTitle({ title: '五子棋 · a vs b', game: { id: 'gomoku', name: '五子棋' } }), '五子棋 · a vs b')
  /* 没有 game.id 的旧数据不推断游戏名，否则未知游戏会被冒名成五子棋 */
  assert.equal(matchTitle({ title: '未知演示', game: { description: 'x' } }), '未知演示')
  assert.equal(matchTitle({ title: '', game: { id: 'gomoku', name: '五子棋' } }), '五子棋')
})

test('matchOutcome names the winning side per game and stays silent when undecided', () => {
  const gomoku = { id: 'gomoku', name: '五子棋' }, players = [{ name: 'qwen' }, { name: 'glm' }]
  assert.deepEqual(matchOutcome({ game: gomoku, players, result: { kind: 'win', winner: 1, message: 'glm 连成五子，获胜。' } }),
    { label: 'glm 胜', tone: 'win', detail: 'glm 连成五子，获胜。' })
  /* 判负走同一分支：赢家是对手 */
  assert.equal(matchOutcome({ game: gomoku, players, result: { kind: 'forfeit', winner: 0, message: 'x 连续违规，判负。' } }).label, 'qwen 胜')
  /* 隐藏身份游戏只有阵营，没有单个获胜模型 */
  const wolf = { id: 'werewolf', name: '狼人杀' }
  assert.equal(matchOutcome({ game: wolf, players, result: { kind: 'win', winner: 'village', message: '狼人全灭，好人获胜。' } }).label, '好人阵营胜')
  assert.equal(matchOutcome({ game: wolf, players, result: { kind: 'forfeit', winner: 'wolf', message: '判负。' } }).label, '狼人阵营胜')
  /* 和棋统一文案，五子棋的「平局」不再出现在列表 */
  assert.deepEqual(matchOutcome({ game: gomoku, players, result: { kind: 'draw', winner: null, message: '棋盘已满，平局。' } }),
    { label: '和棋', tone: 'draw', detail: '棋盘已满，平局。' })
  /* 取消与未结束不产出文案，交给列表显示占位符 */
  assert.equal(matchOutcome({ game: gomoku, players, result: { kind: 'cancelled', winner: null, message: '比赛已取消。' } }), null)
  assert.equal(matchOutcome({ game: gomoku, players, status: 'paused', result: null }), null)
  /* 座位号没有对应选手时退回方位称呼，不显示 undefined */
  assert.equal(matchOutcome({ game: { id: 'gomoku' }, players: [], result: { kind: 'win', winner: 0 } }).label, '黑方 胜')
})

/* ---------------------------------------------------------------- 终局口径
   观战与离线回放共用这一份投影：连子判定、胶囊文案与配色档位、徽标归属。
   下面每条都同时是「观战会不会画错」的回归线。 */
const gomokuMatch = (moves, result, game = { id: 'gomoku', name: '五子棋' }) => ({
  game, players: [{ name: '黑模型' }, { name: '白模型' }], status: 'finished', result,
  events: moves.map(({ p, a }, i) => ({ type: 'move', moveNumber: i + 1, player: p, action: a })),
})
/* 黑方五连 (4,8)→(8,12)，白方垫在别处；最后一手是黑的，与真实获胜局同形。 */
const blackFive = [
  { p: 0, a: { row: 4, col: 8 } }, { p: 1, a: { row: 1, col: 1 } }, { p: 0, a: { row: 5, col: 9 } }, { p: 1, a: { row: 1, col: 2 } },
  { p: 0, a: { row: 6, col: 10 } }, { p: 1, a: { row: 1, col: 3 } }, { p: 0, a: { row: 7, col: 11 } }, { p: 1, a: { row: 1, col: 4 } },
  { p: 0, a: { row: 8, col: 12 } },
]

test('winningRun 只认「最后一手连成的五子」，其余局面一律 null', () => {
  const win = gomokuMatch(blackFive, { kind: 'win', winner: 0 })
  assert.deepEqual(winningRun(win), [4, 5, 6, 7, 8].map(row => ({ row, col: row + 4 })))
  /* 长连（六子）返回整串，不截成五 */
  assert.equal(winningRun(gomokuMatch([...blackFive, { p: 1, a: { row: 1, col: 5 } }, { p: 0, a: { row: 9, col: 13 } }], { kind: 'win', winner: 0 })).length, 6)
  /* 中间断子不成立 */
  assert.equal(winningRun(gomokuMatch(blackFive.filter(({ a }) => !(a.row === 6 && a.col === 10)), { kind: 'win', winner: 0 })), null)
  /* 判负：winner 是座位号，但最后一手属于输方——不能给败方画连子 */
  assert.equal(winningRun(gomokuMatch(blackFive, { kind: 'forfeit', winner: 1 })), null)
  /* 和棋与取消没有连子 */
  assert.equal(winningRun(gomokuMatch(blackFive, { kind: 'draw', winner: null })), null)
  assert.equal(winningRun(gomokuMatch(blackFive, { kind: 'cancelled', winner: null })), null)
  /* 象棋动作是 from/to，取不到 row/col，天然不成立（棋盘没有胜利图层，与离线回放一致） */
  assert.equal(winningRun(gomokuMatch([{ p: 0, a: { from: { row: 1, col: 1 }, to: { row: 2, col: 1 } } }], { kind: 'win', winner: 0 }, { id: 'xiangqi' })), null)
  assert.equal(winningRun(gomokuMatch([], { kind: 'win', winner: 0 })), null)
  assert.equal(winningRun({ result: null, events: [] }), null)
})

test('finaleInfo 按 kind 分别给胶囊文案与配色，判负和取消都不借用胜利色', () => {
  const game = { id: 'gomoku', name: '五子棋' }, players = [{ name: 'a' }, { name: 'b' }]
  const info = result => finaleInfo({ game, players, result })
  assert.deepEqual(info({ kind: 'win', winner: 1, message: 'x' }), { kind: 'win', seat: 1, side: null, win: true, draw: false, label: '胜局', tone: 'win', loser: null })
  assert.equal(info({ kind: 'draw', winner: null }).label, '和棋')
  assert.equal(info({ kind: 'draw', winner: null }).tone, 'draw')
  assert.equal(info({ kind: 'draw', winner: null }).win, false)
  /* 判负确实有一方赢了（决定徽标归属），但配色走警告、文案说清是判负 */
  assert.deepEqual([info({ kind: 'forfeit', winner: 0 }).win, info({ kind: 'forfeit', winner: 0 }).label, info({ kind: 'forfeit', winner: 0 }).tone], [true, '判负', 'warn'])
  assert.deepEqual([info({ kind: 'cancelled', winner: null }).label, info({ kind: 'cancelled', winner: null }).tone, info({ kind: 'cancelled', winner: null }).win], ['已取消', 'plain', false])
  /* 隐藏身份游戏用阵营，不落回棋类的「胜局」 */
  const wolf = result => finaleInfo({ game: { id: 'werewolf', name: '狼人杀' }, players, result })
  assert.equal(wolf({ kind: 'win', winner: 'wolf', message: 'x' }).label, '狼人获胜')
  assert.equal(wolf({ kind: 'win', winner: 'village', message: 'x' }).label, '好人获胜')
  assert.equal(wolf({ kind: 'win', winner: 'wolf', message: 'x' }).seat, null)
  assert.equal(wolf({ kind: 'win', winner: 'wolf', message: 'x' }).side, 'wolf')
  assert.equal(finaleInfo(null), null)
  assert.equal(finaleInfo({ result: null }), null)
})

test('seatBadge 只给获胜座位挂「胜」，和棋两边挂「和」', () => {
  const game = { id: 'gomoku' }
  const win = finaleInfo({ game, result: { kind: 'win', winner: 1 } }), draw = finaleInfo({ game, result: { kind: 'draw', winner: null } })
  assert.deepEqual([seatBadge(win, 0), seatBadge(win, 1)], ['', '胜'])
  assert.deepEqual([seatBadge(draw, 0), seatBadge(draw, 1)], ['和', '和'])
  assert.deepEqual([seatBadge(null, 0), seatBadge(undefined, 1)], ['', ''])
})

/* ---------------------------------------------------------------- 判罚口径
   判负裁决的是协议遵守度，不是棋力：观战必须能从记录里说清「第几手、连续几次、每次为什么」。
   夹具照实盘形状：每次重试都换一个新的 turnId，所以手数只能从同一回合的 request 事件补。 */
const invalidReply = (turnId, attempt, action, error = '该交叉点已有棋子。') => [
  { type: 'request', turnId, player: 0, attempt, moveNumber: 19 },
  { type: 'invalid', turnId, player: 0, attempt, error, raw: JSON.stringify({ action, speech: '落此成五连直接取胜。' }) },
]
const forfeitedMatch = () => ({
  game: { id: 'gomoku', name: '五子棋' }, players: [{ name: '黑模型' }, { name: '白模型' }], status: 'finished',
  result: { kind: 'forfeit', winner: 1, message: '黑模型 连续违规，判负。' },
  events: [
    ...Array.from({ length: 18 }, (_, i) => ({ type: 'move', moveNumber: i + 1, player: i % 2, action: { row: 1, col: i + 1 } })),
    ...invalidReply('t1', 0, { row: 4, col: 11 }),
    ...invalidReply('t2', 1, { row: 9, col: 6 }),
    { type: 'finished', result: 'forfeit' },
  ],
})

test('forfeitDetail 说清判负的手数、次数与逐次原因，且只解释触发判负的那一串', () => {
  const detail = forfeitDetail(forfeitedMatch())
  assert.equal(detail.seat, 0)
  assert.equal(detail.name, '黑模型')
  assert.equal(detail.moveNumber, 19)
  assert.equal(detail.boardMoves, 18)
  assert.deepEqual(detail.attempts.map(attempt => attempt.attempt), [0, 1])
  assert.deepEqual(detail.attempts.map(attempt => attempt.point), ['4 行 11 列', '9 行 6 列'])
  assert.deepEqual(detail.reasons, ['该交叉点已有棋子。'])
  /* 只有判负才有明细：赢棋、取消、没有违规记录、以及违规之后又落了子都不解释 */
  const match = forfeitedMatch()
  assert.equal(forfeitDetail({ ...match, result: { kind: 'win', winner: 1 } }), null)
  assert.equal(forfeitDetail({ ...match, result: { kind: 'cancelled', winner: null } }), null)
  assert.equal(forfeitDetail({ ...match, events: match.events.filter(event => event.type !== 'invalid') }), null)
  assert.equal(forfeitDetail({ ...match, events: [...match.events, { type: 'move', player: 1, action: { row: 2, col: 2 } }] }), null)
  /* 格式违规常常没有能解析的落点：只解释原因，不编一个坐标出来 */
  const formatted = { ...match, events: [...match.events.slice(0, 18), { type: 'invalid', turnId: 't9', player: 0, attempt: 0, error: '回复必须包含合法的 action 和 1—80 字的 speech。', raw: '```json\n{}\n```' }] }
  assert.deepEqual(forfeitDetail(formatted).attempts.map(attempt => attempt.point), [''])
  /* 手数补不到时留空，不猜也不显示 null */
  const orphan = { ...match, events: [...match.events.slice(0, 18), { type: 'invalid', turnId: 'tx', player: 0, attempt: 0, error: '恢复失败。', raw: '{' }] }
  assert.equal(forfeitDetail(orphan).moveNumber, null)
})

test('判负给负方席位挂「负」徽标，赢局不凭空挂', () => {
  const match = forfeitedMatch(), finale = finaleInfo(match)
  assert.equal(finale.loser, 0)
  assert.equal(finale.seat, 1)
  assert.deepEqual([seatBadge(finale, 0), seatBadge(finale, 1)], ['负', '胜'])
  assert.equal(finaleInfo({ ...match, result: { kind: 'win', winner: 1 } }).loser, null)
})

test('boardSvg 的胜局图层：金带铺在棋子底下，五个点亮环盖在棋子上', () => {
  const moves = blackFive.map(({ p, a }) => ({ ...a, player: p }))
  const plain = boardSvg(moves)
  assert.equal(/winband|winring/u.test(plain), false, '不传 winRun 时棋盘不能被改动（封面、离线回放都走这条路）')
  const svg = boardSvg(moves, { winRun: winningRun(gomokuMatch(blackFive, { kind: 'win', winner: 0 })) })
  assert.equal((svg.match(/class="winband"/gu) || []).length, 1)
  assert.equal((svg.match(/class="winring"/gu) || []).length, 5)
  /* 层次：金带必须早于第一颗棋子（否则盖住棋子），环必须晚于最后一颗（否则被棋子盖住） */
  assert.ok(svg.indexOf('class="winband"') < svg.indexOf('<g '), '金带必须在棋子之前')
  assert.ok(svg.lastIndexOf('class="winring"') > svg.lastIndexOf('<g '), '点亮环必须在棋子之后')
  /* 环坐标与连子坐标一致，且沿用棋盘自身的 margin=34 / gap=32：(row 4, col 8) → x=34+7*32, y=34+3*32 */
  assert.ok(svg.includes(`cx="${34 + 7 * 32}" cy="${34 + 3 * 32}"`), '坐标必须落在 (4,8) 这颗子上')
  /* 不足五子不画，象棋不吃这个选项，封面走的单子棋盘也不受影响 */
  assert.equal(/winring/u.test(boardSvg(moves, { winRun: [{ row: 4, col: 8 }] })), false)
  assert.equal(/winband|winring/u.test(boardSvg([], { gameId: 'xiangqi', winRun: [{ row: 1, col: 1 }, { row: 1, col: 2 }, { row: 1, col: 3 }, { row: 1, col: 4 }, { row: 1, col: 5 }] })), false)
  assert.equal(/winband|winring/u.test(boardSvg([{ row: 8, col: 8, player: 0 }])), false)
})

test('狼人杀终局席位标记：胜方阵营金框 + 每席「胜 / 负」，未结束不提前泄露', () => {
  assert.equal(werewolfSide('werewolf'), 'wolf')
  assert.equal(werewolfSide('seer'), 'village')
  assert.equal(werewolfSide('villager'), 'village')
  const state = {
    phase: 'finished', winner: 'wolf', terminalReason: '狼人获胜。',
    players: [{ seat: 1, role: 'werewolf', alive: true }, { seat: 2, role: 'werewolf', alive: false }, { seat: 3, role: 'seer', alive: false }, { seat: 4, role: 'villager', alive: true }],
  }
  const finale = werewolfStage({ players: state.players.map((_, i) => ({ name: `${i + 1} 号` })), state })
  assert.deepEqual(finale.seats.map(seat => seat.winning), [true, true, false, false])
  assert.deepEqual(finale.seats.map(seat => seat.badge), ['胜', '胜', '负', '负'])
  /* 死掉的胜方仍然算胜方（阵营判定不看存活），但 active 由调用方在终局清空 */
  assert.equal(finale.seats[1].winning, true)
  assert.deepEqual(finale.seats.map(seat => seat.active), [false, false, false, false])
  const live = werewolfStage({ players: state.players.map((_, i) => ({ name: `${i + 1} 号` })), state: { ...state, winner: null, terminalReason: null, phase: 'day-vote' }, active: 2 })
  assert.deepEqual(live.seats.map(seat => seat.badge), ['', '', '', ''])
  assert.deepEqual(live.seats.map(seat => seat.winning), [false, false, false, false])
  assert.deepEqual(live.seats.map(seat => seat.active), [false, false, true, false])
})
