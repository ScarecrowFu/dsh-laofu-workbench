import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArenaStore } from '../store.mjs'
import { ArenaExport, replayHtml, reportMarkdown, verifyVideoProbe } from '../export.mjs'
import { clipDataUrl } from '../speech.mjs'
import { boardSvg, frameAt } from '../presentation.mjs'

const fixture = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', title: '</script><img onerror=alert(1)>', game: { description: 'Rules', version: '1' }, players: [{ name: '<b>Black</b>', provider: 'test', model: 'black' }, { name: 'White', provider: 'test', model: 'white' }], calls: 1, tokens: 20, state: { moves: [{ row: 8, col: 8, player: 0 }] }, events: [{ type: 'move', turnId: 'turn', moveNumber: 1, player: 0, action: { row: 8, col: 8 }, speech: '</script><img onerror=alert(1)>', elapsedMs: 100 }], result: { message: 'Done', winner: null }, status: 'finished' }
test('replay shares game state and safely encodes model text offline', () => {
  assert.equal(frameAt(fixture, 0).moves.length, 0)
  assert.equal(frameAt(fixture, 1).moves.length, 1)
  assert.equal(frameAt(fixture, 0).result, null)
  const html = replayHtml(fixture)
  assert.ok(html.startsWith('<!doctype html>'))
  assert.equal(html.includes('</script><img onerror='), false)
  assert.equal(html.includes('https://'), false)
  assert.ok(html.includes('AI竞技台 · 离线回放'))
  assert.ok(html.includes('回放控制'))
  /* 骨架占位符必须全部被替换，且模型文本在标题里也要转义 */
  assert.equal(html.includes('{{'), false)
  assert.ok(html.includes('<title>&lt;/script&gt;&lt;img onerror=alert(1)&gt; · AI竞技台 · 离线回放</title>'))
  /* 内联数据要能原样还原模型文本：< 被转义成 \u003c，JSON.parse 再还原回来 */
  const embedded = JSON.parse(html.match(/__ARENA_DATA__=(.*?);<\/script>/su)[1])
  assert.equal(embedded.title, '</script><img onerror=alert(1)>')
  assert.equal(embedded.moves[0].s, '</script><img onerror=alert(1)>')
  assert.equal(embedded.players[0].name, '<b>Black</b>')
  /* 没有 game.id 的历史记录按 gomoku 命名，且投影只保留画面需要的字段 */
  assert.deepEqual(embedded.game, { id: '', name: '五子棋', version: '1' })
  assert.deepEqual(Object.keys(embedded).sort(), ['game', 'id', 'keys', 'moves', 'players', 'result', 'title', 'winRun'])
  assert.equal(embedded.moves[0].audio, undefined)
  assert.match(embedded.players[0].logo, /^data:image\/png;base64,/u)
  assert.equal(embedded.players[0].voice, 'generic-1')
  assert.equal(embedded.players[1].voice, 'generic-2')
  assert.ok(boardSvg(fixture.state.moves).includes('棋盘，1 手'))
  assert.ok(boardSvg(fixture.state.moves).includes('ar-board-wood'))
  assert.ok(reportMarkdown(fixture).includes('第 1 手'))
})
test('report preserves historical fast turns after resuming with native calls', () => {
  const match = { ...fixture, config: { pace: 'native' }, events: [
    { type: 'request', turnId: 'turn', pace: 'fast' },
    { type: 'response', turnId: 'turn', execution: { label: '直接决策' } },
    ...fixture.events,
    { type: 'request', turnId: 'native-turn', pace: 'native', model: { reasoningEffort: 'high' } },
    { ...fixture.events[0], turnId: 'native-turn', moveNumber: 2 },
  ] }
  const report = reportMarkdown(match)
  assert.match(report, /当前调用配置：正常模型调用/u)
  assert.match(report, /快棋（历史配置） · 直接决策/u)
  assert.match(report, /正常模型调用 · high/u)
})
test('export runs once, snapshots config and downloads in bounded chunks', async t => {
  const root = await mkdtemp(join(tmpdir(), 'arena-export-')); t.after(() => rm(root, { recursive: true, force: true }))
  const store = await new ArenaStore(root).init(), jobs = [], signal = new AbortController()
  const match = await store.create({ ...fixture, id: undefined })
  await store.update(match.id, value => { value.status = 'finished'; value.events = fixture.events })
  let release
  const pending = new Promise(resolve => { release = resolve })
  const exporter = new ArenaExport({ store, scope: { signal: signal.signal, background: promise => jobs.push(promise) }, render: async (snapshot, directory, options) => { await pending; await writeFile(join(directory, `${options.orientation}.mp4`), Buffer.alloc(600000, 1)) } })
  await exporter.start({ id: match.id })
  await assert.rejects(exporter.start({ id: match.id }), /正在导出/)
  release(); await jobs[0]
  const first = await exporter.chunk({ id: match.id })
  assert.equal(Buffer.from(first.data, 'base64').length, 512 * 1024)
  assert.equal(first.done, false)
  assert.equal((await exporter.chunk({ id: match.id, offset: first.nextOffset })).done, true)
  await assert.rejects(exporter.chunk({ id: match.id, offset: -1 }))
  await assert.rejects(exporter.chunk({ id: match.id, offset: 600001 }))
  await assert.rejects(exporter.chunk({ id: match.id, exportId: 'previous-export' }), /版本已变化/)
})

test('voiced replay is refused without an LWB login and reuses a cached clip', async t => {
  const root = await mkdtemp(join(tmpdir(), 'arena-speech-')); t.after(() => rm(root, { recursive: true, force: true }))
  const store = await new ArenaStore(root).init()
  const match = await store.create({ ...fixture, id: undefined, players: [{ name: '千问', provider: 'lwb', model: 'qwen3.8-max' }, { name: '自建', provider: 'ollama', model: 'local' }] })
  await store.update(match.id, value => { value.status = 'finished'; value.events = fixture.events; value.result = fixture.result })
  const saved = await store.get(match.id)
  const exec = promisify(execFile)
  const anonymous = { account: { status: async () => ({ authenticated: false, configured: false, reason: '请先登录 LWB 账号。' }), points: async () => null, open: async () => { throw new Error('不应打开服务') } }, signal: new AbortController().signal, settings: async () => ({ get: () => ({}), update: async () => {} }) }
  const jobs = []
  const exporter = new ArenaExport({ store, scope: { ...anonymous, background: promise => jobs.push(promise) } })
  await exporter.startReplay({ id: saved.id })
  await jobs[0]
  assert.match((await store.get(saved.id)).export.error, /请先登录 LWB 账号/)
  const directory = store.directory(saved.id)
  let posts = 0
  const settings = { voiceAssets: {} }
  const scope = {
    signal: new AbortController().signal,
    settings: async () => ({ get: () => settings, update: async patch => Object.assign(settings, patch) }),
    account: {
      status: async () => ({ authenticated: true, configured: true, minimumPoints: 10 }),
      points: async () => ({ availablePoints: 9 }),
      open: async () => { throw new Error('积分不足时不应打开服务') },
    },
  }
  const poorJobs = []
  await new ArenaExport({ store, scope: { ...scope, background: promise => poorJobs.push(promise) } }).startReplay({ id: saved.id })
  await poorJobs[0]
  assert.match((await store.get(saved.id)).export.error, /积分不足/)
  const sample = join(root, 'sample.mp3')
  await exec('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=1.2:sample_rate=44100', '-af', 'volume=-30dB', '-q:a', '4', sample])
  const clip = await readFile(sample)
  scope.account.points = async () => ({ availablePoints: 100 })
  scope.account.open = async () => ({ request: async (path, init) => {
    if (path.endsWith('/audio-uploads')) return { success: true, data: { asset_id: 'asset-1' } }
    if (init.method === 'POST') { posts += 1; return { success: true, data: { job_id: 'job-1', status: 'succeeded', audio_url: 'https://audio.example.test/a.mp3' } } }
    return { success: true, data: { status: 'succeeded', audio_url: 'https://audio.example.test/a.mp3' } }
  } })
  const fetch = async () => ({ ok: true, arrayBuffer: async () => clip })
  const { synthesizeSpeech } = await import('../speech.mjs')
  const first = await synthesizeSpeech(saved, directory, { scope, fetch, signal: scope.signal })
  assert.equal(posts, 1)
  assert.equal(settings.voiceAssets && Object.values(settings.voiceAssets)[0], 'asset-1')
  const again = await synthesizeSpeech(saved, directory, { scope, fetch, signal: scope.signal })
  assert.equal(posts, 1)
  assert.equal(again.get(1).file, first.get(1).file)
  assert.match(first.get(1).file, /v1-/u)
  const leveled = await readFile(first.get(1).file)
  assert.notEqual(leveled.equals(clip), true)
  const html = replayHtml(saved, new Map([[1, { seconds: 1.2, src: await clipDataUrl(first.get(1).file) }]]))
  assert.match(html, /data:audio\/mpeg;base64,/u)
})

test('成片自检：静音音轨不算配音，尺寸、时长、配音音轨各自判定', () => {
  const silent = { streams: [{ codec_type: 'video', width: 1280, height: 720 }, { codec_type: 'audio' }], format: { duration: '11.05' } }
  const request = { width: 1280, height: 720, frames: 330, fps: 30, spoken: [] }
  /* Remotion 会给无声成片铺一条静音音轨：无配音时不要求音轨缺席 */
  verifyVideoProbe(silent, request)
  assert.throws(() => verifyVideoProbe({ ...silent, streams: [{ codec_type: 'video', width: 720, height: 1280 }] }, request), /尺寸不符/u)
  assert.throws(() => verifyVideoProbe({ ...silent, format: { duration: '20' } }, request), /时长不符/u)
  assert.throws(() => verifyVideoProbe({ streams: [{ codec_type: 'video', width: 1280, height: 720 }], format: { duration: '11.05' } }, { ...request, spoken: [1] }), /缺少配音音轨/u)
  /* 真的混过配音时，音轨必须在 */
  verifyVideoProbe(silent, { ...request, spoken: [1] })
})
