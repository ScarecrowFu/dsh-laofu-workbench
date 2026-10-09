import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { ArenaStore } from '../store.mjs'
import { ArenaExport, RENDER_INPUTS, renderTemplateVersion } from '../export.mjs'

/**
 * 成片复用的真相源是「渲染输入键」：键相同就交出上次的文件，键变了就重渲染。
 * 这组测试逐个输入地验证这条边界，以及键本身必须覆盖哪些东西 —— 一次假命中
 * 会让用户拿到过期成片，比多渲染一次贵得多。
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const PACK = join(HERE, '..')

const move = { type: 'move', turnId: 'turn', moveNumber: 1, player: 0, action: { row: 8, col: 8 }, speech: '第一手发言', elapsedMs: 100 }
const fixture = {
  title: '缓存测试', game: { id: 'gomoku', description: 'Rules', version: '1.2.0' },
  players: [{ name: '黑', provider: 'test', model: 'black' }, { name: '白', provider: 'test', model: 'white' }],
  calls: 1, tokens: 20, config: { pace: 'native' },
  state: { moves: [{ row: 8, col: 8, player: 0 }] }, events: [move],
  result: { message: 'Done', winner: 0 }, status: 'finished',
}

/** 建一场已结束的比赛。speech 传空串时这一场没有配音，走 TTS 之外的成本也省掉。 */
async function arena(t, speech = '第一手发言') {
  const root = await mkdtemp(join(tmpdir(), 'arena-cache-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = await new ArenaStore(root).init()
  const created = await store.create({ ...fixture, id: undefined })
  await store.update(created.id, value => { value.status = 'finished'; value.events = [{ ...move, speech }]; value.result = fixture.result })
  return { store, id: created.id, directory: store.directory(created.id) }
}

/** 假渲染：把文件名写进内容，下载回来就能看出交的是哪一份产物。 */
function exporterFor(store, jobs, rendered, extra = {}) {
  return new ArenaExport({
    store,
    scope: { ...extra, background: promise => jobs.push(promise) },
    render: async (snapshot, directory, options) => {
      rendered.push(options.fileName)
      await writeFile(join(directory, options.fileName), Buffer.from(`render ${options.fileName}`))
    },
  })
}

/** 语音服务桩：只数调用次数，绝不真的去请求 TTS。 */
function voiceScope() {
  const calls = { status: 0, points: 0, open: 0 }
  const scope = {
    signal: new AbortController().signal,
    settings: async () => ({ get: () => ({}), update: async () => {} }),
    account: {
      status: async () => { calls.status += 1; return { authenticated: true, configured: true, minimumPoints: 0 } },
      points: async () => { calls.points += 1; return { availablePoints: 100 } },
      open: async () => { calls.open += 1; return { request: async () => { throw new Error('成片复用后不应再请求 TTS。') } } },
    },
  }
  return { calls, scope }
}

test('渲染输入键决定复用：换画幅、换每手秒数、换配音、换内容各自重渲染一次', async t => {
  const { store, id } = await arena(t, '')
  const jobs = [], rendered = [], voices = voiceScope()
  const exporter = exporterFor(store, jobs, rendered, voices.scope)
  const base = { id, orientation: 'landscape', secondsPerMove: 3, withAudio: false }
  const run = async settings => {
    const snapshot = await exporter.start({ ...base, ...settings })
    if (snapshot.export.status === 'running') await jobs.at(-1)
    return snapshot
  }
  await run({})
  assert.equal(rendered.length, 1)
  const first = await store.get(id)
  assert.match(first.export.file, /^video-[a-f0-9]{16}\.mp4$/u)
  assert.equal(first.export.cached, false)

  /* 同设置：直接复用，连渲染函数都不进。 */
  const again = await run({})
  assert.equal(rendered.length, 1, '键没变就不该重渲染')
  assert.equal(again.export.cached, true)
  assert.equal(again.export.file, first.export.file)
  assert.equal(again.export.bytes, first.export.bytes)

  await run({ orientation: 'portrait' })
  assert.equal(rendered.length, 2, '画幅是渲染输入')
  await run({ secondsPerMove: 5 })
  assert.equal(rendered.length, 3, '每手秒数是渲染输入')
  await run({ secondsPerMove: 5 })
  assert.equal(rendered.length, 3, '换回已渲染过的设置同样复用')
  await run({ withAudio: true })
  assert.equal(rendered.length, 4, '是否配音是渲染输入')
  assert.equal(voices.calls.open, 0, '没有发言就不该打开语音服务')

  /* 比赛终局后内容本不该再变，但记录一旦变了（修数据、补录）也必须换键。 */
  await store.update(id, value => { value.events[0].speech = '改过的发言' })
  await run({})
  assert.equal(rendered.length, 5, '比赛投影变了必须重渲染')
  assert.equal(Object.keys((await store.get(id)).exports).length, 5)
})

test('索引里的成片被删掉就重新渲染，键不变、文件名也不变', async t => {
  const { store, id, directory } = await arena(t)
  const jobs = [], rendered = []
  const exporter = exporterFor(store, jobs, rendered)
  const run = async () => {
    const snapshot = await exporter.start({ id, orientation: 'landscape', secondsPerMove: 3, withAudio: false })
    if (snapshot.export.status === 'running') await jobs.at(-1)
    return store.get(id)
  }
  const first = await run()
  await rm(join(directory, first.export.file))
  assert.equal((await store.get(id)).export.status, 'succeeded', '记录还在，但文件已经没了')
  /* 文件被外部清掉时下载会自愈：索引条目摘掉、当前记录标失败，界面回到「导出」。 */
  await assert.rejects(exporter.chunk({ id, exportId: first.export.cacheKey }), /已失效/u)
  const broken = await store.get(id)
  assert.equal(broken.exports[first.export.cacheKey], undefined, '死掉的索引条目要摘掉')
  assert.equal(broken.export.status, 'failed', '指向同一个文件的当前记录不能再报成功')
  await assert.rejects(exporter.chunk({ id }), /尚未导出成功|已失效/u)
  const second = await run()
  assert.equal(rendered.length, 2, '文件不在就必须重渲染')
  assert.equal(second.export.cached, false)
  assert.equal(second.export.file, first.export.file)
  assert.equal((await exporter.chunk({ id })).bytes, second.export.bytes)
})

test('下载既认当前导出，也认索引里任意一份成片；原型链上的键不算产物', async t => {
  const { store, id } = await arena(t)
  const jobs = [], rendered = []
  const exporter = exporterFor(store, jobs, rendered)
  const run = async settings => { const snapshot = await exporter.start({ id, orientation: 'landscape', secondsPerMove: 3, withAudio: false, ...settings }); if (snapshot.export.status === 'running') await jobs.at(-1); return snapshot }
  const landscape = await run({})
  await run({ orientation: 'portrait' })
  const match = await store.get(id)
  const key = landscape.export.cacheKey
  assert.ok(match.exports[key], '刚导出的那份必须进索引')
  assert.equal(Object.keys(match.exports).length, 2)

  const part = await exporter.chunk({ id, exportId: key })
  assert.equal(Buffer.from(part.data, 'base64').toString(), `render ${match.exports[key].file}`)
  assert.equal(part.done, true)
  assert.equal(part.bytes, match.exports[key].bytes)
  /* 当前导出与索引都能下载；不存在的键、原型链上的键一律拒绝。 */
  assert.equal((await exporter.chunk({ id })).bytes, match.export.bytes)
  for (const bogus of ['__proto__', 'constructor', 'toString', 'ffffffffffffffff']) {
    await assert.rejects(exporter.chunk({ id, exportId: bogus }), /导出版本已变化/u, `${bogus} 不该被当成产物`)
  }
})

test('带键之前的旧记录照旧能下载，新一轮导出后旧命名的孤儿被清掉', async t => {
  const { store, id, directory } = await arena(t)
  const jobs = [], rendered = []
  const exporter = exporterFor(store, jobs, rendered)
  await writeFile(join(directory, 'landscape.mp4'), Buffer.alloc(4096, 7))
  await store.update(id, value => { value.export = { id: 'legacy-export', status: 'succeeded', orientation: 'landscape', secondsPerMove: 3, withAudio: false } })
  assert.equal((await exporter.chunk({ id, exportId: 'legacy-export' })).bytes, 4096, '老记录没有 file 字段，退回画幅命名')
  await exporter.start({ id, orientation: 'landscape', secondsPerMove: 3, withAudio: false })
  await jobs.at(-1)
  const match = await store.get(id)
  assert.match(match.export.file, /^video-[a-f0-9]{16}\.mp4$/u)
  assert.deepEqual(await readdir(directory).then(names => names.filter(name => name === 'landscape.mp4')), [], '旧命名文件不该留成孤儿')
})

test('索引按上限淘汰最旧的成片，连同文件一起删', async t => {
  const { store, id, directory } = await arena(t)
  const jobs = [], rendered = []
  const exporter = exporterFor(store, jobs, rendered)
  const settings = []
  for (const secondsPerMove of [2, 3, 4, 5, 6, 7, 8]) settings.push({ orientation: 'landscape', secondsPerMove })
  for (const secondsPerMove of [2, 3, 4]) settings.push({ orientation: 'portrait', secondsPerMove })
  for (const item of settings) {
    await exporter.start({ id, withAudio: false, ...item })
    await jobs.at(-1)
  }
  assert.equal(settings.length, 10)
  const match = await store.get(id)
  assert.equal(Object.keys(match.exports).length, 8, '索引有上限')
  const files = (await readdir(directory)).filter(name => name.startsWith('video-'))
  assert.equal(files.length, 8, '被淘汰的产物连文件一起删')
  assert.ok(files.includes(match.export.file), '当前 export 指着的产物必须留着')
})

test('有声回放第二次导出直接复用，不再碰登录与 TTS', async t => {
  const { store, id, directory } = await arena(t, '')
  const jobs = [], rendered = [], voices = voiceScope()
  const exporter = exporterFor(store, jobs, rendered, voices.scope)
  await exporter.startReplay({ id })
  await jobs.at(-1)
  const first = await store.get(id)
  assert.equal(first.export.status, 'succeeded')
  assert.equal(first.export.kind, 'html')
  assert.equal(first.export.cached, false)
  assert.match(first.export.file, /^replay-[a-f0-9]{16}\.html$/u)
  const bytes = Buffer.byteLength(await readFile(join(directory, first.export.file), 'utf8'))
  assert.equal(first.export.bytes, bytes)
  const statusCalls = voices.calls.status

  const second = await exporter.startReplay({ id })
  assert.equal(second.export.cached, true)
  assert.equal(second.export.file, first.export.file)
  assert.equal(second.export.bytes, bytes)
  assert.equal(voices.calls.status, statusCalls, '命中索引就不该再问账号状态')
  assert.equal(jobs.length, 1, '命中索引不该再占后台任务')
})

test('画面模板版本覆盖参与渲染的每一份源文件', async () => {
  const version = await renderTemplateVersion()
  assert.match(version, /^p\d+\.[a-f0-9]{12}$/u)
  assert.equal(version, await renderTemplateVersion(), '版本要稳定，不能每次都变')
  for (const name of RENDER_INPUTS) await assert.doesNotReject(readFile(join(PACK, name)), `${name} 必须在包里`)

  /* 渲染入口的本地依赖闭包必须全部进摘要：漏一份就是「改了模板却复用旧成片」。
     规则引擎例外 —— 它们只通过 replayData 的投影影响画面，而投影本身已进摘要。 */
  const covered = new Set(RENDER_INPUTS), engines = new Set(['xiangqi.mjs', 'werewolf.mjs'])
  const seen = new Set()
  const walk = async entry => {
    const directory = dirname(entry)
    const source = await readFile(join(PACK, entry), 'utf8')
    for (const match of source.matchAll(/from\s+'(\.{1,2}\/[^']+)'/gu)) {
      const next = join(directory, match[1])
      if (seen.has(next)) continue
      seen.add(next)
      await walk(next)
    }
  }
  for (const entry of ['video.mjs', 'replay/data.mjs']) { seen.add(entry); await walk(entry) }
  const missing = [...seen].filter(name => !covered.has(name) && !engines.has(name))
  assert.deepEqual(missing, [], '这些文件能影响画面却没进 RENDER_INPUTS：模板改了会复用旧成片')

  /* 离线 HTML 的骨架与播放器由 replayAssets 直接读盘内联，不作为模块被 import，
     上面的闭包走不到它们，所以在这里点名守住（app.js 改了却命中旧回放是一条真实的坑）。 */
  const assets = ['replay/page.html', 'replay/shell.css', 'replay/app.js']
  assert.deepEqual(assets.filter(name => !covered.has(name)), [], '离线回放的骨架与播放器必须进 RENDER_INPUTS')
})