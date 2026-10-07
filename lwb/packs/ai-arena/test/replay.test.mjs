import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boardSvg } from '../presentation.mjs'
import { replayData } from '../replay/data.mjs'
import { isKeyMove, stageHtml } from '../replay/markup.mjs'
import { AUDIO_TAIL_SECONDS, FINALE_SECONDS, frameToStep, totalFrames } from '../replay/timeline.mjs'
import { assignVoices, matchVoiceKey } from '../voices.mjs'
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
    game: { id: 'xiangqi', name: '中国象棋', description: '规则', version: '1.0.0' },
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