import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boardSvg, playerSide } from '../presentation.mjs'
import { replayData } from '../replay/data.mjs'
import { isKeyMove, stageHtml } from '../replay/markup.mjs'
import { AUDIO_TAIL_SECONDS, FINALE_SECONDS, frameToStep, stepSeconds, totalFrames } from '../replay/timeline.mjs'
import { assignVoices, matchVoiceKey } from '../voices.mjs'
import { MODEL_ART } from '../model-art.mjs'
import { SCENE_CSS } from '../replay/styles.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const move = (row, col, player) => ({ type: 'move', moveNumber: 0, player, action: { row, col }, speech: `第 ${row}${col} 手` })
const gomoku = {
  id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', title: '五子棋演示',
  game: { id: 'gomoku', name: '五子棋', description: '规则', version: '1.0.0' },
  players: [{ name: '黑模型', provider: 'test', model: 'black' }, { name: '白模型', provider: 'test', model: 'white' }],
  events: [[8, 8, 0], [8, 9, 1], [9, 8, 0], [9, 9, 1], [10, 8, 0], [10, 9, 1], [11, 8, 0], [11, 9, 1], [12, 8, 0]].map(([r, c, p], i) => ({ ...move(r, c, p), moveNumber: i + 1 })),
  status: 'finished', result: { kind: 'win', winner: 0, message: '黑模型 连成五子，获胜。' },
}

/* 狼人杀夹具：只用于「形象与席卡同源」这一条，阵容与规则无关。 */
const werewolfFixture = () => ({
  id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', title: '狼人杀演示',
  game: { id: 'werewolf', name: '狼人杀', description: '规则', version: '1.1.0' },
  players: ['qwen3.8-max', 'deepseek-v4.1-flash', 'glm-5.3', 'kimi-k3'].map(model => ({ name: model, provider: 'bailian', model })),
  config: { seed: 1, seats: 4 },
  state: { players: [{ seat: 1, role: 'werewolf' }, { seat: 2, role: 'seer' }, { seat: 3, role: 'villager' }, { seat: 4, role: 'villager' }] },
  events: [[0, 1], [1, 2]].map(([player, row], i) => ({ type: 'move', moveNumber: i + 1, player, action: { type: 'speak' }, speech: `第 ${i + 1} 步发言`, phase: 'day-speech' })),
  status: 'finished', result: { kind: 'win', winner: 'village', message: '好人获胜。' },
})

test('styles.mjs stays in sync with replay/scene.css', async () => {
  const css = await readFile(join(HERE, '..', 'replay', 'scene.css'), 'utf8')
  assert.equal(SCENE_CSS, css, '改了 replay/scene.css 之后要重新执行 npm run arena:build')
})

test('视频时间轴：每手 secondsPerMove 秒 + 终局卡 4 秒', () => {
  const fps = 30, moves = 9
  assert.equal(totalFrames(moves, fps, 3), (moves + 1) * 3 * fps + FINALE_SECONDS * fps)
  /* 逐手段的边界 */
  assert.deepEqual(frameToStep(0, fps, moves, 3), { index: 0, t: 0 })
  assert.deepEqual(frameToStep(89, fps, moves, 3), { index: 0, t: 2.966666666666667 })
  assert.deepEqual(frameToStep(90, fps, moves, 3), { index: 1, t: 0 })
  assert.equal(frameToStep(totalFrames(moves, fps, 3) - 1, fps, moves, 3).index, moves + 1)
  /* 终局卡从最后一步之后开始，时长独立 */
  const finaleStart = (moves + 1) * 3 * fps
  assert.deepEqual(frameToStep(finaleStart, fps, moves, 3), { index: moves + 1, t: 0 })
  assert.ok(Math.abs(frameToStep(finaleStart + FINALE_SECONDS * fps - 1, fps, moves, 3).t - (FINALE_SECONDS * fps - 1) / fps) < 1e-9)
  /* 有配音的手按音频拉长，无配音的手仍是每手秒数 */
  const durations = [0, 5, 0]
  const voiced = totalFrames(3, fps, 3, durations)
  assert.equal(voiced, Math.round((3 + (5 + AUDIO_TAIL_SECONDS) + 3 + 3 + FINALE_SECONDS) * fps))
  assert.deepEqual(frameToStep(3 * fps, fps, 3, 3, durations), { index: 1, t: 0 })
  assert.equal(frameToStep(Math.round((3 + 5 + AUDIO_TAIL_SECONDS) * fps), fps, 3, 3, durations).index, 2)
})

test('终局卡那一手也能带配音：最后一条结算播报要放得下，其余仍固定 4 秒', () => {
  const moves = 3
  /* durations 比手数多一格：第 moves 项是终局卡那一手的配音（狼人杀最后一条结算播报） */
  const durations = [0, 5, 0, 4.2]
  assert.equal(stepSeconds(moves + 1, moves, 3, durations), 4.2 + AUDIO_TAIL_SECONDS)
  /* 没有终局配音时，终局卡还是固定的 4 秒，前面几手各按自己的音频/每手秒数 */
  assert.equal(stepSeconds(moves + 1, moves, 3, [0, 5, 0, 0]), FINALE_SECONDS)
  assert.equal(stepSeconds(moves + 1, moves, 3, null), FINALE_SECONDS)
  assert.equal(stepSeconds(2, moves, 3, durations), 5 + AUDIO_TAIL_SECONDS)
  assert.equal(stepSeconds(3, moves, 3, durations), 3)
})

test('关键手档位只筛推近与刻度，与离线 HTML 的 isKey 口径一致', () => {
  const check = { n: 1, kind: 'check' }
  const bigCapture = { n: 2, kind: 'capture', piece: 'chariot' }
  const smallCapture = { n: 3, kind: 'capture', piece: 'soldier' }
  const win = { n: 4, kind: 'win' }
  const tail = { n: 5, kind: 'last' }
  for (const mode of ['major', 'all', 'check', 'off']) {
    assert.equal(isKeyMove(check, mode), mode !== 'off')
    assert.equal(isKeyMove(win, mode), mode !== 'off')
  }
  assert.equal(isKeyMove(bigCapture, 'major'), true)
  assert.equal(isKeyMove(bigCapture, 'check'), false)
  assert.equal(isKeyMove(smallCapture, 'all'), true)
  assert.equal(isKeyMove(smallCapture, 'major'), false)
  /* 既非获胜也非将军/吃子的收尾手不推近（沿用原型行为） */
  assert.equal(isKeyMove(tail, 'all'), false)
})

test('帧驱动 markup 覆盖逐手与终局，且关键手特效按档位生效', () => {
  const data = replayData(gomoku)
  assert.equal(data.moves.length, 9)
  assert.equal(data.result.winner, 0)
  assert.deepEqual(data.winRun, [8, 9, 10, 11, 12].map(row => ({ row, col: 8 })))

  const opening = stageHtml(data, 0, { layout: 'landscape', t: 0 })
  assert.match(opening, /data-phase="move"/)
  assert.match(opening, /<em class="hlbl">当前手数<\/em><b class="n">0<\/b>/u)
  assert.match(opening, /比赛开始/u)
  assert.match(opening, /五子棋棋盘，0 手/u)

  const mid = stageHtml(data, 5, { layout: 'landscape', t: 0.5 })
  assert.match(mid, /<b class="n">5<\/b>/u)
  assert.match(mid, /五子棋棋盘，5 手/u)
  assert.match(mid, /回合记录/u)
  /* 棋盘卡片的内联缩放就是这一帧的推近值，不是 CSS 动画 */
  assert.match(mid, /class="board-card" style="transform:scale\([\d.]+\)"/u)

  const finale = stageHtml(data, 10, { layout: 'landscape', t: 1 })
  assert.match(finale, /data-phase="finale"/)
  assert.match(finale, /黑模型 连成五子，获胜。/u)
  assert.match(finale, /class="pill win">胜局/u)
  /* 终局金带与五颗连子的点亮环 */
  assert.match(finale, /class="winband"/u)
  assert.equal((finale.match(/class="winring"/gu) || []).length, 5)
  assert.equal((finale.match(/class="pcard"/gu) || []).length, 2)
  assert.match(finale, /class="logo"/u)
})

/* ---------------------------------------------------------------- 执行者卡里的模型形象
   口径：只有人物、没有底板；logo 贴在人物左上角；**本手有发言才画人**；
   没有发言时只留 logo（同高占位）。三档：横屏/标准竖屏 66×86 在左，象棋竖屏 46×58 在右。 */
test('replayData 给每一款游戏的选手都产出形象键', () => {
  /* gomoku 夹具的模型名是 black/white，命中不了家族——所以另取一份用真实模型名的。 */
  const named = { ...gomoku, players: [{ name: 'qwen3.8-max', provider: 'bailian', model: 'qwen3.8-max' }, { name: 'deepseek-v4.1-flash', provider: 'bailian', model: 'deepseek-v4.1-flash' }] }
  const chess = replayData(named)
  assert.equal(chess.players.length, 2)
  for (const player of chess.players) assert.equal(typeof player.portrait, 'string', '棋类选手也要有形象（跨游戏共用）')
  assert.deepEqual(chess.players.map(player => player.portrait), ['qwen', 'deepseek'], '命中家族就拿主图')
  /* 未命中家族的选手仍按座位错开出图，而且与音色的兜底互不影响 */
  const unknown = replayData(gomoku)
  assert.deepEqual(unknown.players.map(player => player.portrait), ['chatgpt', 'claude'])
  assert.deepEqual(assignVoices(gomoku.players), ['generic-1', 'generic-2'])
  /* 狼人杀走同一次整局分配：侧栏形象与舞台席卡必须同一张 */
  const wolf = replayData(werewolfFixture())
  assert.deepEqual(wolf.players.map(player => player.portrait), wolf.werewolf.seats.map(seat => seat.portrait))
})

test('执行者卡：本手有发言才画人，开局与终局都只留 logo 占位', () => {
  const data = replayData(gomoku)
  const mid = stageHtml(data, 5, { layout: 'landscape', t: 1 })
  assert.match(mid, /class="turn-figure">/u, '有发言时形象格在流里')
  assert.match(mid, /class="turn-face"/u)
  assert.match(mid, /class="turn-mark"/u, 'logo 贴在形象左上角')
  /* 素材真进来了：形象是带 alpha 的 WebP，logo 是 PNG */
  assert.match(mid, /class="turn-face" src="data:image\/webp;base64,UklGR/u)
  assert.match(mid, /class="turn-mark" src="data:image\/png;base64,iVBO/u)
  for (const [label, index] of [['开局', 0], ['终局', 10]]) {
    const frame = stageHtml(data, index, { layout: 'landscape', t: 1 })
    assert.equal(/class="turn-face"/u.test(frame), false, `${label}没有本手发言，不能画人`)
    assert.match(frame, /class="turn-figure" data-quiet="true"/u, `${label}要留同高占位`)
  }
})

test('执行者卡三档：象棋竖屏走紧凑档（形象放右、用胸像），其余档形象在左', () => {
  const xiangqi = { ...gomoku, game: { id: 'xiangqi', name: '中国象棋', description: '规则', version: '1.0.0' }, result: { kind: 'win', winner: 0, message: 'x' } }
  const data = replayData(xiangqi)
  const land = stageHtml(data, 5, { layout: 'landscape', t: 1 })
  assert.equal(/data-compact="true"/u.test(land), false, '横屏永远是标准档')
  const port = stageHtml(data, 5, { layout: 'portrait', t: 1 })
  assert.match(port, /class="turn" data-phase="move" data-compact="true"/u, '象棋竖屏走紧凑档')
  /* 紧凑档用胸像（320×320 的方形图），标准档用半身（320×480）：图不一样才说明取的是不同档。 */
  const bust = MODEL_ART.bust[data.players[0].portrait]
  assert.ok(bust && port.includes(bust), '紧凑档必须取胸像')
  assert.equal(land.includes(bust), false, '标准档不该用胸像')
  /* 五子棋竖屏仍是标准档（侧栏 560px 装得下） */
  assert.equal(/data-compact="true"/u.test(stageHtml(replayData(gomoku), 5, { layout: 'portrait', t: 1 })), false)
})

test('markup 的棋子坐标常量与 presentation.mjs 的绘制一致', () => {
  const data = replayData(gomoku)
  /* centresOf() 用 margin/gap 反推落点，若 boardSvg 改了留白或间距，这里会先失败 */
  const svg = boardSvg([{ row: 8, col: 8, player: 0 }])
  const x = 34 + (8 - 1) * 32
  assert.ok(svg.includes(`cx="${x}" cy="${x}"`), '五子棋 margin=34 / gap=32 与 boardSvg 不符')
  const xq = boardSvg([{ from: { row: 10, col: 2 }, to: { row: 8, col: 2 }, player: 0 }], { gameId: 'xiangqi' })
  assert.ok(xq.includes(`cx="${38 + 1 * 54}" cy="${38 + 7 * 54}"`), '象棋 margin=38 / gap=54 与 boardSvg 不符')
  /* 落点样式确实注入了最末一手那一颗，而不是 DOM 里最后一个 <g> */
  const html = stageHtml(data, 9, { layout: 'landscape', t: 0.05 })
  assert.match(html, /<g style="opacity:[\d.]+;transform:translateY\(-?[\d.]+px\)"/u)
})

test('portrait 与 landscape 的布局属性都由数据驱动', () => {
  const data = replayData(gomoku)
  assert.match(stageHtml(data, 3, { layout: 'portrait', t: 0 }), /data-layout="portrait"/)
  assert.match(stageHtml(data, 3, { layout: 'landscape', t: 0 }), /data-layout="landscape"/)
})

test('象棋画面显示红黑身份、楚河汉界与起止坐标', () => {
  const xiangqi = {
    ...gomoku, id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', title: '象棋演示',
    game: { id: 'xiangqi', name: '中国象棋', description: '规则', version: '1.1.0' },
    players: [{ name: '红方模型', provider: 'test', model: 'red' }, { name: '黑方模型', provider: 'test', model: 'black' }],
    events: [{ type: 'move', moveNumber: 1, player: 0, action: { from: { row: 8, col: 2 }, to: { row: 8, col: 5 } }, speech: '起炮' }],
    result: { kind: 'draw', winner: null, message: '和棋。' },
  }
  for (const layout of ['landscape', 'portrait']) {
    const html = stageHtml(replayData(xiangqi), 1, { layout, t: 1 })
    assert.match(html, /data-game="xiangqi"/u)
    assert.match(html, /红方 · 先手/u)
    assert.match(html, /黑方 · 后手/u)
    assert.match(html, /8行2列 → 8行5列/u)
    assert.match(html, /中国象棋棋盘，1 手/u)
    assert.match(html, /楚河/u)
    assert.match(html, /汉界/u)
  }
})

test('音色按模型匹配，未收录的两名选手各用一条通用音色', () => {
  assert.equal(matchVoiceKey({ model: 'qwen3.8-max', provider: 'lwb' }), 'qwen')
  assert.equal(matchVoiceKey({ model: 'glm-5.3', provider: 'custom', name: '选手' }), 'zhipu')
  assert.equal(matchVoiceKey({ model: 'kimi-k3' }), 'kimi')
  assert.equal(matchVoiceKey({ model: 'MiniMax/MiniMax-M3' }), 'minimax')
  assert.equal(matchVoiceKey({ model: 'deepseek-v4.1-flash' }), 'deepseek')
  assert.equal(matchVoiceKey({ model: 'claude-opus' }), 'claude')
  assert.equal(matchVoiceKey({ model: 'gpt-5', provider: 'openai' }), 'gpt')
  assert.equal(matchVoiceKey({ model: 'doubao-pro', name: '豆包' }), 'doubao')
  assert.equal(matchVoiceKey({ model: 'mimo-v2' }), 'mimo')
  assert.equal(matchVoiceKey({ model: 'local-llama', provider: 'ollama', name: '自建' }), null)
  assert.deepEqual(assignVoices([{ model: 'qwen3.8-max' }, { model: 'local-llama' }]), ['qwen', 'generic-1'])
  assert.deepEqual(assignVoices([{ model: 'alpha' }, { model: 'beta' }]), ['generic-1', 'generic-2'])
  assert.deepEqual(assignVoices([{ model: 'qwen3.8-max', name: '甲' }, { model: 'qwen3.8-flash', name: '乙' }]), ['qwen', 'qwen'])
  const data = replayData(gomoku)
  assert.equal(data.players[0].voice, 'generic-1')
  assert.equal(data.players[1].voice, 'generic-2')
  assert.match(data.players[0].logo, /^data:image\/png;base64,/u)
})

test('模型文本在 markup 里被 HTML 转义，不会注入标签', () => {
  const nasty = {
    ...gomoku, title: '</script><img onerror=alert(1)>',
    players: [{ name: '<b>Black</b>', provider: 'test', model: 'black' }, { name: 'White', provider: 'test', model: 'white' }],
    events: [{ type: 'move', moveNumber: 1, player: 0, action: { row: 8, col: 8 }, speech: '</script><img onerror=alert(1)>' }],
    result: null,
  }
  const html = stageHtml(replayData(nasty), 1, { layout: 'landscape', t: 1 })
  assert.equal(html.includes('</script><img onerror='), false)
  assert.match(html, /&lt;b&gt;Black&lt;\/b&gt;/u)
  assert.match(html, /&lt;\/script&gt;&lt;img onerror=alert\(1\)&gt;/u)
})

/* 手机上看不清「谁在执行」是这个画面此前的真实缺陷：名字只有 12—13px 挂在记分条上。
   下面两条守住补救：每一手都有一张写明模型名的执行者卡，字号不低于可读下限。 */
test('每一手都有一张写明执行模型的执行者卡', () => {
  const data = replayData(gomoku)
  for (const layout of ['landscape', 'portrait']) {
    const opening = stageHtml(data, 0, { layout, t: 0.5 })
    assert.match(opening, /class="turn" data-phase="move"/u)
    assert.match(opening, /<small class="turn-kicker">先手<\/small>/u)
    assert.match(opening, new RegExp(`<b class="turn-name">${data.players[0].name}</b>`, 'u'))

    /* 第 5 手由谁走，卡片上就该是谁；右侧席位要与记分条的side一致 */
    const mid = stageHtml(data, 5, { layout, t: 0.5 })
    const speaker = data.moves[4].p
    assert.match(mid, /<small class="turn-kicker">本手执行<\/small>/u)
    assert.match(mid, new RegExp(`<b class="turn-name">${data.players[speaker].name}</b>`, 'u'))
    assert.match(mid, new RegExp(`<span class="turn-meta">${playerSide(data.game, speaker)} · ${speaker === 0 ? '先手' : '后手'}</span>`, 'u'))

    const end = stageHtml(data, 10, { layout, t: 1 })
    assert.match(end, /<small class="turn-kicker">胜方<\/small>/u)
    assert.match(end, /<b class="turn-name">黑模型<\/b>/u)
    assert.match(end, /data-phase="finale" style="opacity/u)
  }
  /* 署名跟着画面最大的那句字幕走，不再是一行 12px 的元数据 */
  assert.match(stageHtml(data, 5, { layout: 'landscape', t: 0.5 }), new RegExp(`<b class="sn">${data.players[data.moves[4].p].name}</b><em class="stag">本手发言</em>`, 'u'))
  /* 席号与身份是狼人杀专有的：棋类的署名与回合记录一个身份元素都不该有 */
  assert.doesNotMatch(stageHtml(data, 5, { layout: 'landscape', t: 0.5 }), /class="sseat"|class="srole"/u)
})

test('换手节拍：执行者卡先到、落子随后、台词最后', async () => {
  const data = replayData(gomoku)
  const html = (t, index = 5) => stageHtml(data, index, { layout: 'landscape', t })
  /* t=0 三者都还没入场；执行者卡的时长最短（.34s），台词要等到 .22s 之后才开始。
     「没入场」要连分号一起匹配，否则 opacity:0.85 也会被当成 0。 */
  assert.match(html(0), /class="turn" data-phase="move" style="opacity:0;transform:translateY\(14px\)"/u)
  assert.match(html(0), /class="speech" style="opacity:0;/u)
  assert.match(html(0), /<g style="opacity:0;transform:translateY\(-10px\)"/u)
  assert.match(html(0.2), /class="speech" style="opacity:0;/u, '台词要排在落子之后')
  assert.doesNotMatch(html(0.35), /class="speech" style="opacity:0;/u)
  /* 离线 HTML 用同名关键帧复刻同一节奏（延迟写死在 scene.css 里），两边必须一起改 */
  const css = await readFile(join(HERE, '..', 'replay', 'scene.css'), 'utf8')
  assert.match(css, /\.stage\.animate \.board svg g\.is-new\{animation:stoneIn \.26s cubic-bezier\(\.2,\.8,\.3,1\) \.12s both\}/u)
  assert.match(css, /\.stage\.animate \.speech\{animation:fadeUp \.2s ease-out \.22s both\}/u)
  assert.match(css, /\.stage\.animate \.turn\{animation:turnIn \.34s/u)
})

test('执行者卡与字幕署名的字号守住手机可读下限', async () => {
  const css = await readFile(join(HERE, '..', 'replay', 'scene.css'), 'utf8')
  const px = pattern => {
    const match = css.match(pattern)
    assert.ok(match, `scene.css 缺少 ${pattern}`)
    return Number(match[1])
  }
  /* 720×1280 降到手机宽度（约 393pt）时缩放约 0.55：28px 以下就掉到 15pt 以下，
     在竖屏 feed 里读不出模型名 —— 这是这次改造要守住的下限。 */
  assert.ok(px(/\.turn-name\{font-size:(\d+)px/u) >= 28, '横屏执行者卡名字不小于 28px')
  assert.ok(px(/\.stage\[data-layout="portrait"\] \.turn-name\{font-size:(\d+)px/u) >= 30, '竖屏执行者卡名字不小于 30px')
  assert.ok(px(/\.sn\{font-size:(\d+)px/u) >= 20, '字幕署名不小于 20px')
  assert.ok(px(/\.stage\[data-layout="portrait"\] \.sn\{font-size:(\d+)px/u) >= 20, '竖屏字幕署名不小于 20px')
  assert.ok(px(/\.shead \.logo\{width:(\d+)px/u) >= 24, '署名的 logo 不小于 24px')
  /* 身份标签是同排的次级信息：不能小于「本手发言」胶囊与动作标签，否则加了等于没加 */
  assert.ok(px(/\n\.sseat\{[^}]*font-size:(\d+)px/u) >= 14, '署名里的席号不小于 14px')
  assert.ok(px(/\n\.srole\{[^}]*font-size:(\d+)px/u) >= 14, '署名里的身份标签不小于 14px')
})