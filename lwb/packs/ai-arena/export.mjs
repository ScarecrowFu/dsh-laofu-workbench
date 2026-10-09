import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync } from 'node:fs'
import { lstat, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { movesOf, escapeHtml, actionLabel, playerSide, matchTitle } from './presentation.mjs'
import { replayData } from './replay/data.mjs'
import { stepStarts, totalFrames } from './replay/timeline.mjs'
import { LOUDNESS_VERSION, clipDataUrl, countSpeechLines, synthesizeSpeech } from './speech.mjs'
import { WEREWOLF_ART } from './werewolf-art.mjs'

const exec = promisify(execFile)
const ROOT = dirname(fileURLToPath(import.meta.url))
const executionLabel = pace => pace === 'fast' ? '快棋（历史配置）' : pace === 'native' ? '正常模型调用' : '深度（历史配置）'
/* ------------------------------------------------------------------ 离线回放
   单文件 HTML 回放的设计与逻辑放在 replay/ 下：page.html 页面骨架、
   scene.css 画幅样式、shell.css 交互外壳、app.js 播放器；
   runtime.js 由 build-replay.mjs 从 presentation.mjs 打包生成，暴露棋盘绘制，
   保证离线回放与工作台内观战、视频模板同源。
   导出时全部内联，产物保持单文件、零网络。 */
const REPLAY_DIR = join(ROOT, 'replay')
const REPLAY_ASSETS = ['page.html', 'scene.css', 'shell.css', 'app.js', 'runtime.js']

/** 每次导出都重新读盘：文件很小，且改完样式不必重新构建。 */
function replayAssets() {
  return Object.fromEntries(REPLAY_ASSETS.map(name => [name, readFileSync(join(REPLAY_DIR, name), 'utf8')]))
}

/** 用 {{KEY}} 占位符渲染骨架；替换值按字面插入，不做 $ 转义。 */
const fillTemplate = (template, vars) => template.replace(/\{\{(\w+)\}\}/gu, (match, key) => (key in vars ? vars[key] : match))

/** 离线 HTML 要自包含：只内联这一局真正用到的场景与立绘，不把全部素材塞进去。 */
function replayArt(data) {
  if (data.game.id !== 'werewolf') return 'null'
  const portraits = {}
  for (const seat of data.werewolf?.seats || []) {
    for (const key of ['generic', seat.portrait, `${seat.portrait}-dead`]) {
      if (WEREWOLF_ART.portraits[key]) portraits[key] = WEREWOLF_ART.portraits[key]
    }
  }
  return JSON.stringify({ scenes: WEREWOLF_ART.scenes, portraits }).replace(/</gu, '\\u003c')
}

/* ------------------------------------------------------------------ 成片复用
   比赛终局之后内容就冻住了（导出只对 finished / cancelled 开放），渲染本身又是确定性的：
   同一组输入重复渲染只会得到同一份字节。这里给每份产物算一个「渲染输入」键，键相同就把
   上次的成片直接交回 —— 不再重跑 bundle、逐帧渲染和混音，这是整条链路里最贵的一段。

   键必须覆盖全部渲染输入，否则「复用」会发错文件：
   - 画面模板：参与渲染的源文件内容摘要 + PIPELINE_VERSION（Remotion / FFmpeg 链路变了 +1）；
   - 比赛投影：replayData 的摘要，走子、发言、选手、结局任一变化都换键；
   - 导出设置：画幅、每手秒数、是否配音；配音再带响度版本，因为时长来自按句缓存的 mp3。
   命中与否只看键，产物文件名也带键：无声/有声、横竖屏、不同每手秒数各自成文件，
   不再互相覆盖（旧代码里它们共用一个 `<画幅>.mp4`）。旧记录没有这份索引，
   照旧渲染一次并补写；索引与产物都留在比赛目录，重启后依然可复用。 */
export const RENDER_INPUTS = [
  'video.mjs', 'presentation.mjs', 'voices.mjs', 'werewolf-art.mjs', 'werewolf-projection.mjs',
  'replay/markup.mjs', 'replay/data.mjs', 'replay/styles.mjs', 'replay/timeline.mjs',
  /* 离线 HTML 的骨架与播放器也内联进产物，但它们不是模块（闭包走不到）：漏一份就会出现
     「修好了播放器，导出却交回旧回放」。终局配音那次改动正是靠这一条才让旧产物失效。 */
  'replay/page.html', 'replay/shell.css', 'replay/app.js',
]
/** 渲染链路版本：Remotion / FFmpeg / 编码参数变了就 +1；画面源文件改动由上面的摘要兜住。 */
const PIPELINE_VERSION = 1
/** 每场比赛最多留几份成片：模板升级后旧键再也不会被命中，留着只会占盘。 */
const MAX_ARTIFACTS = 8
/** 产物文件名由服务端生成，下载与清理时仍按白名单复核，不接受带路径分隔符的名字。 */
const ARTIFACT_NAME = /^[A-Za-z0-9._-]{1,80}$/u
let templateVersion = null

/** 画面模板版本：参与渲染的源文件读一遍取摘要。memo 在模块上，能力包重新加载即重建。 */
export async function renderTemplateVersion() {
  if (!templateVersion) {
    const hash = createHash('sha256')
    for (const name of RENDER_INPUTS) hash.update(await readFile(join(ROOT, name)))
    templateVersion = `p${PIPELINE_VERSION}.${hash.digest('hex').slice(0, 12)}`
  }
  return templateVersion
}

/** 比赛投影摘要：只喂画面数据，不含原始请求与推理文本，和成片内容一一对应。 */
function contentDigest(match) {
  return createHash('sha256').update(JSON.stringify(replayData(match))).digest('hex').slice(0, 16)
}

/** 一份产物的键。settings 是该项产物特有的渲染输入，顺序固定。 */
async function artifactKey(match, kind, settings) {
  const fields = [kind, await renderTemplateVersion(), contentDigest(match), ...settings.map(value => String(value))]
  return createHash('sha256').update(fields.join('\u0000')).digest('hex').slice(0, 16)
}

const videoFileName = key => `video-${key}.mp4`
const replayFileName = key => `replay-${key}.html`

/** 索引里的产物还在盘上、字节数也对得上，才敢复用。 */
async function reuseArtifact(directory, entry) {
  if (!entry?.file || !ARTIFACT_NAME.test(entry.file) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1) return null
  const info = await lstat(join(directory, entry.file)).catch(() => null)
  return info?.isFile() && !info.isSymbolicLink() && info.size === entry.bytes ? entry : null
}

/** 成片必须真的落盘：渲染「成功」却没产出文件时不能记成成功。 */
async function artifactBytes(directory, fileName) {
  const info = await lstat(join(directory, fileName)).catch(() => null)
  if (!info?.isFile() || info.size < 1) throw new Error('渲染没有产出成片文件。')
  return info.size
}

/** 索引落账：写入新产物，并按上限淘汰最旧的产物（当前 export 指着的文件不动）。 */
async function pruneArtifacts(directory, entries, keep) {
  const ordered = Object.entries(entries).sort((left, right) => String(left[1].completedAt).localeCompare(String(right[1].completedAt)))
  for (const [key, entry] of ordered.slice(0, Math.max(0, ordered.length - MAX_ARTIFACTS))) {
    delete entries[key]
    if (entry.file !== keep && typeof entry.file === 'string' && ARTIFACT_NAME.test(entry.file)) await rm(join(directory, entry.file), { force: true }).catch(() => {})
  }
  return entries
}

/** 产物文件名：新记录自带 file；带键之前的老记录照旧由画幅/回放名推导。 */
function artifactFile(artifact) {
  if (typeof artifact.file === 'string' && ARTIFACT_NAME.test(artifact.file)) return artifact.file
  return artifact.kind === 'html' ? 'replay.html' : `${artifact.orientation}.mp4`
}

/** 旧版把成片固定叫 `<画幅>.mp4` / `replay.html`：换键之后它再也不会被引用，
    照旧版「覆盖同名文件」的语义删掉，免得每次导出都留一份孤儿。 */
async function dropLegacy(directory, name, keep) {
  if (name === keep) return
  await rm(join(directory, name), { force: true }).catch(() => {})
}

export function replayHtml(match, audio = null) {
  const assets = replayAssets()
  const data = replayData(match, audio)
  const title = escapeHtml(matchTitle(match))
  return fillTemplate(assets['page.html'], {
    TITLE: `${title} · AI竞技台 · 离线回放`,
    META: `${title} · ${data.moves.length} 手 · ${escapeHtml(data.game.name)} ${escapeHtml(data.game.version)}`,
    GAME_LABEL: `${escapeHtml(data.game.name)} · 规则 ${escapeHtml(data.game.version)}`,
    L_LABEL: '横屏 16:9',
    P_LABEL: '竖屏 9:16',
    SCENE_CSS: assets['scene.css'],
    SHELL_CSS: assets['shell.css'],
    BUNDLE: assets['runtime.js'],
    /* < 转义后模型文本既闭不了 </script>，也注入不了标签 */
    DATA_JSON: JSON.stringify(data).replace(/</gu, '\\u003c'),
    ART_JSON: replayArt(data),
    APP_JS: assets['app.js'],
  })
}
export function reportMarkdown(match) {
  const turns = new Map()
  const wolf = match.game?.id === 'werewolf'
  for (const event of match.events) {
    if (event.type === 'request' || event.type === 'response') turns.set(event.turnId, { ...turns.get(event.turnId), ...event })
  }
  return [`# ${matchTitle(match)}`, '', `规则：${match.game.description}（${match.game.version}）`, `创建：${match.createdAt}`, `当前调用配置：${executionLabel(match.config?.pace)}`, `状态：${match.status}`, `结果：${match.result?.message || '尚未结束'}`, `模型调用：${match.calls}；已知 Token：${match.tokens}${match.usageUnknown ? '（部分调用未报告用量）' : ''}`, '选手发言仅对观众可见。', '', ...match.players.map((player, i) => `${playerSide(match.game, i)}：${player.provider}/${player.model}；${player.name}；所选推理强度：${player.reasoningEffort || '模型默认'}`), '', ...movesOf(match).map(event => {
    const turn = turns.get(event.turnId)
    const who = wolf ? `${playerSide(match.game, event.player)} · ${match.players[event.player].name}` : match.players[event.player].name
    return `## 第 ${event.moveNumber} 手 · ${who}\n\n${actionLabel(event.action, match.game)} · ${event.elapsedMs} ms\n\n${executionLabel(turn?.pace)} · ${turn?.execution?.label || turn?.model?.reasoningEffort || '模型默认推理'}\n\n${event.speech}\n`
  })].join('\n')
}
export class ArenaExport {
  constructor({ store, scope, render = renderVideo }) { Object.assign(this, { store, scope, render }); this.running = new Set() }
  async start({ id, orientation = 'landscape', secondsPerMove = 3, withAudio = false }) {
    if (!['landscape', 'portrait'].includes(orientation) || !Number.isInteger(secondsPerMove) || secondsPerMove < 2 || secondsPerMove > 8) throw new Error('视频导出设置无效。')
    if (typeof withAudio !== 'boolean') throw new Error('视频导出设置无效。')
    if (this.running.has(id)) throw new Error('比赛视频正在导出。')
    this.running.add(id)
    let snapshot
    try {
      snapshot = await this.store.update(id, async match => {
        if (!['finished', 'cancelled'].includes(match.status) || !movesOf(match).length) throw new Error('请先完成比赛，再导出视频。')
        const key = await artifactKey(match, 'video', [orientation, secondsPerMove, withAudio ? `audio-${LOUDNESS_VERSION}` : 'silent'])
        const cached = await reuseArtifact(this.store.directory(id), match.exports?.[key])
        if (cached) {
          /* 命中就是「已经渲染过」，把记录指向那份文件即可：下载路径与渲染成功完全同形。 */
          const at = cached.completedAt || new Date().toISOString()
          match.export = { id: randomUUID(), status: 'succeeded', phase: 'done', cached: true, cacheKey: key, orientation, secondsPerMove, withAudio, file: cached.file, bytes: cached.bytes, startedAt: at, completedAt: at }
          return
        }
        match.export = { id: randomUUID(), status: 'running', orientation, secondsPerMove, withAudio, phase: withAudio ? 'speech' : 'render', cacheKey: key, startedAt: new Date().toISOString() }
      })
    } catch (error) { this.running.delete(id); throw error }
    if (snapshot.export?.status === 'succeeded') { this.running.delete(id); return snapshot }
    const key = snapshot.export.cacheKey, fileName = videoFileName(key)
    this.scope.background((async () => {
      try {
        let audio = null
        if (withAudio) {
          audio = await synthesizeSpeech(snapshot, this.store.directory(id), {
            scope: this.scope, signal: this.scope.signal,
            onProgress: ({ done, total }) => this.store.update(id, match => { if (match.export?.status === 'running') match.export = { ...match.export, phase: 'speech', speechDone: done, speechTotal: total } }),
          })
          await this.store.update(id, match => { if (match.export?.status === 'running') match.export = { ...match.export, phase: 'render' } })
        }
        await this.render(snapshot, this.store.directory(id), { orientation, secondsPerMove, audio, signal: this.scope.signal, fileName })
        const bytes = await artifactBytes(this.store.directory(id), fileName)
        await this.commit(id, key, { kind: 'video', file: fileName, bytes, orientation, secondsPerMove, withAudio })
        await dropLegacy(this.store.directory(id), `${orientation}.mp4`, fileName)
      } catch (error) {
        /* 只在还处于「进行中」时标失败：万一落账已经成功（例如清理旧产物抛错），
           不能把一份已经渲染好的成片改写成失败。 */
        await this.store.update(id, match => { if (match.export?.status === 'running') match.export = { ...match.export, status: 'failed', error: error.message } })
      } finally { this.running.delete(id) }
    })())
    return snapshot
  }
  async startReplay({ id }) {
    if (this.running.has(id)) throw new Error('这场比赛正在导出。')
    this.running.add(id)
    let snapshot
    try {
      snapshot = await this.store.update(id, async match => {
        if (!['finished', 'cancelled'].includes(match.status) || !movesOf(match).length) throw new Error('请先完成比赛，再导出回放。')
        const key = await artifactKey(match, 'html', [`audio-${LOUDNESS_VERSION}`])
        const cached = await reuseArtifact(this.store.directory(id), match.exports?.[key])
        if (cached) {
          const at = cached.completedAt || new Date().toISOString()
          match.export = { id: randomUUID(), kind: 'html', status: 'succeeded', phase: 'done', cached: true, cacheKey: key, withAudio: true, file: cached.file, bytes: cached.bytes, startedAt: at, completedAt: at }
          return
        }
        match.export = { id: randomUUID(), kind: 'html', status: 'running', withAudio: true, phase: 'speech', speechDone: 0, speechTotal: countSpeechLines(match).total, cacheKey: key, startedAt: new Date().toISOString() }
      })
    } catch (error) { this.running.delete(id); throw error }
    if (snapshot.export?.status === 'succeeded') { this.running.delete(id); return snapshot }
    const key = snapshot.export.cacheKey, fileName = replayFileName(key)
    this.scope.background((async () => {
      try {
        const audio = await synthesizeSpeech(snapshot, this.store.directory(id), {
          scope: this.scope, signal: this.scope.signal,
          onProgress: ({ done, total }) => this.store.update(id, match => { if (match.export?.status === 'running') match.export = { ...match.export, phase: 'speech', speechDone: done, speechTotal: total } }),
        })
        const inline = new Map()
        for (const [moveNumber, clip] of audio) {
          const entry = {}
          if (clip.host) entry.host = { seconds: clip.host.seconds, src: await clipDataUrl(clip.host.file) }
          if (clip.speech) entry.speech = { seconds: clip.speech.seconds, src: await clipDataUrl(clip.speech.file) }
          if (entry.host || entry.speech) inline.set(moveNumber, entry)
        }
        const text = replayHtml(snapshot, inline)
        const directory = this.store.directory(id)
        await writeFile(join(directory, fileName), text, { mode: 0o600 })
        await this.commit(id, key, { kind: 'html', file: fileName, bytes: Buffer.byteLength(text) })
        await dropLegacy(directory, 'replay.html', fileName)
      } catch (error) {
        await this.store.update(id, match => { if (match.export?.status === 'running') match.export = { ...match.export, status: 'failed', error: error.message } })
      } finally { this.running.delete(id) }
    })())
    return snapshot
  }
  /** 落账：产物写进索引（供下次复用），同时把当前 export 指向它。 */
  async commit(id, key, entry) {
    const directory = this.store.directory(id), completedAt = new Date().toISOString()
    await this.store.update(id, async match => {
      const entries = { ...(match.exports || {}), [key]: { key, ...entry, completedAt } }
      match.exports = await pruneArtifacts(directory, entries, entry.file)
      match.export = { ...match.export, status: 'succeeded', phase: 'done', cached: false, file: entry.file, bytes: entry.bytes, completedAt }
    })
  }
  async record(match) {
    return { text: replayHtml(match), type: 'text/html', extension: 'html' }
  }
  /** 成片文件不在了就自愈：摘掉索引条目，并把指向同一个文件的当前记录标为失败，
      这样界面回到「导出」而不是继续摆一个下不动的按钮。 */
  async forget(id, key, fileName) {
    await this.store.update(id, match => {
      if (key && match.exports?.[key]) delete match.exports[key]
      if (match.export?.status === 'succeeded' && artifactFile(match.export) === fileName) match.export = { ...match.export, status: 'failed', error: '成片文件已失效，请重新导出。' }
    }).catch(() => {})
  }
  async chunk({ id, exportId, offset = 0 }) {
    const match = await this.store.get(id)
    /* 下载要么对着「当前导出」，要么对着索引里任意一份已渲染的产物：
       客户端可以按缓存键直接取文件，不必先让 export 绕一圈。 */
    const current = match.export?.status === 'succeeded' && (!exportId || exportId === match.export.id) ? match.export : null
    const entries = match.exports && typeof match.exports === 'object' ? match.exports : {}
    /* 用 hasOwn 而不是直接取值：exportId 来自客户端，不能让 __proto__ / constructor 这类键命中原型。 */
    const cached = !current && typeof exportId === 'string' && Object.hasOwn(entries, exportId) ? entries[exportId] : null
    const artifact = current || cached
    if (!artifact) throw new Error(match.export?.status === 'succeeded' ? '导出版本已变化，请重新下载。' : '成片尚未导出成功。')
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('下载偏移无效。')
    const name = artifactFile(artifact), file = join(this.store.directory(id), name)
    const info = await lstat(file).catch(() => null)
    if (!info?.isFile() || info.isSymbolicLink()) {
      await this.forget(id, cached ? artifact.key : null, name)
      throw new Error('成片文件已失效，请重新导出。')
    }
    if (offset > info.size) throw new Error('下载偏移越界。')
    const handle = await open(file, 'r')
    try {
      const buffer = Buffer.alloc(Math.min(512 * 1024, info.size - offset))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset)
      return { data: buffer.subarray(0, bytesRead).toString('base64'), offset, nextOffset: offset + bytesRead, bytes: info.size, done: offset + bytesRead === info.size }
    } finally { await handle.close() }
  }
}
/**
 * 成片自检：尺寸、时长必须与请求一致；只有真的合成了语音时才要求音轨存在。
 * Remotion 会给无声成片也铺一条静音音轨，「有音轨」因此不能当作「混过配音」的证据——
 * 之前正是这条推断让无声导出在本地一直被判失败。
 */
export function verifyVideoProbe(probe, { width, height, frames, fps, spoken }) {
  const video = (probe.streams || []).find(stream => stream.codec_type === 'video')
  const hasAudio = (probe.streams || []).some(stream => stream.codec_type === 'audio')
  const duration = Number(probe.format?.duration)
  if (video?.width !== width || video?.height !== height) throw new Error(`导出视频尺寸不符：${video?.width}×${video?.height}，期望 ${width}×${height}。`)
  if (!Number.isFinite(duration) || Math.abs(duration - frames / fps) > 1) throw new Error(`导出视频时长不符：${duration} 秒，期望 ${(frames / fps).toFixed(2)} 秒。`)
  if (spoken?.length && !hasAudio) throw new Error('导出视频缺少配音音轨。')
}

export async function renderVideo(match, directory, { orientation, secondsPerMove, audio = null, signal, fileName = null }) {
  signal.throwIfAborted()
  await exec('ffmpeg', ['-version'], { signal })
  const { bundle } = await import('@remotion/bundler')
  const { renderMedia, makeCancelSignal } = await import('@remotion/renderer')
  const dir = join(directory, 'render')
  await mkdir(dir, { recursive: true })
  const serveUrl = await bundle({ entryPoint: join(ROOT, 'video.mjs'), outDir: join(dir, 'bundle'), webpackOverride: config => config })
  signal.throwIfAborted()
  const width = orientation === 'landscape' ? 1280 : 720, height = orientation === 'landscape' ? 720 : 1280, fps = 30
  /* 成片名带渲染输入的键（见 artifactKey）：无声/有声、横竖屏各自成文件，不再互相覆盖。
     临时文件沿用同一前缀，同一场比赛的两份渲染不会撞在一起。 */
  const output = fileName || `${orientation}.mp4`, stem = String(output).replace(/\.mp4$/u, '')
  const data = replayData(match, audio ? new Map([...audio].map(([moveNumber, clip]) => [moveNumber, {
    ...(clip.host ? { host: { seconds: clip.host.seconds } } : {}),
    ...(clip.speech ? { speech: { seconds: clip.speech.seconds } } : {}),
  }])) : null)
  /* audioSec 已经含主持人那一段，时间轴按它拉长（有配音的那一手至少比音频长 AUDIO_TAIL_SECONDS） */
  const durations = data.moves.map(move => move.audioSec || 0)
  /* 终局卡那一手也可能有主持人配音（狼人杀最后一条结算播报）：它没有对应的手数，
     补在时长表末尾一格，stepSeconds / mixSpeech 都按这一格给终局卡排音轨。 */
  durations.push(Number(data.werewolf?.finaleAudioSec) || 0)
  const frames = totalFrames(data.moves.length, fps, secondsPerMove, audio ? durations : null)
  const spoken = audio ? [...audio].filter(([, clip]) => (clip.host?.seconds || 0) + (clip.speech?.seconds || 0) > 0) : []
  const temporary = join(directory, `${stem}.partial.mp4`)
  const { cancelSignal, cancel } = makeCancelSignal()
  const abort = () => cancel()
  signal.addEventListener('abort', abort, { once: true })
  const browserExecutable = process.env.LWB_REMOTION_BROWSER_EXECUTABLE || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined)
  try {
    /* 视频与离线 HTML 共用同一份投影：同一组手数、关键手、连子和终局文案。 */
    const props = { data, layout: orientation, secondsPerMove, durations: audio ? durations : null }
    const silent = join(directory, `${stem}.silent.mp4`)
    await renderMedia({ serveUrl, composition: { id: 'Arena', width, height, fps, durationInFrames: frames, defaultProps: {}, props, defaultCodec: null, defaultOutName: null, defaultVideoImageFormat: null, defaultPixelFormat: null }, inputProps: props, outputLocation: audio?.size ? silent : temporary, codec: 'h264', crf: 23, pixelFormat: 'yuv420p', browserExecutable, cancelSignal, concurrency: 2, chromiumOptions: { gl: 'swiftshader' } })
    signal.throwIfAborted()
    if (spoken.length) await mixSpeech(silent, temporary, spoken, data.moves.length, secondsPerMove, signal)
    const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height,codec_type:format=duration', '-of', 'json', temporary], { signal })
    const probe = JSON.parse(stdout)
    verifyVideoProbe(probe, { width, height, frames, fps, spoken })
    await rename(temporary, join(directory, output))
    await writeFile(join(directory, 'video-report.json'), `${JSON.stringify(probe, null, 2)}\n`, { mode: 0o600 })
  } finally {
    signal.removeEventListener('abort', abort)
    await rm(dir, { recursive: true, force: true })
    await rm(temporary, { force: true })
    await rm(join(directory, `${stem}.silent.mp4`), { force: true })
  }
}

/** 把每一段配音按该手的起始时间铺到一条音轨上，再贴进无声成片。
    一手可以先主持人后选手（选手排在主持人那一段之后），画面时长保持不变。
    `spoken` 里可能带一手 `moveCount + 1`：它是终局卡那一手的结算播报，排在终局卡的起始时间上。 */
async function mixSpeech(silent, output, spoken, moveCount, secondsPerMove, signal) {
  const durations = []
  for (const [moveNumber, clip] of spoken) durations[moveNumber - 1] = (clip.host?.seconds || 0) + (clip.speech?.seconds || 0)
  const starts = stepStarts(moveCount, secondsPerMove, durations)
  const tracks = []
  for (const [moveNumber, clip] of spoken) {
    const base = starts[moveNumber]
    if (clip.host?.seconds > 0) tracks.push({ file: clip.host.file, at: base })
    if (clip.speech?.seconds > 0) tracks.push({ file: clip.speech.file, at: base + (clip.host?.seconds || 0) })
  }
  if (!tracks.length) return
  const args = ['-y', '-i', silent]
  for (const track of tracks) args.push('-i', track.file)
  const delayed = tracks.map((track, index) => `[${index + 1}:a]adelay=${Math.round(track.at * 1000)}|${Math.round(track.at * 1000)}[a${index}]`)
  const mix = tracks.map((_, index) => `[a${index}]`).join('')
  args.push('-filter_complex', `${delayed.join(';')};${mix}amix=inputs=${tracks.length}:normalize=0:duration=longest[aout]`, '-map', '0:v:0', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', output)
  await exec('ffmpeg', args, { signal })
}
