import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync } from 'node:fs'
import { lstat, mkdir, open, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { movesOf, escapeHtml, actionLabel, playerSide } from './presentation.mjs'
import { replayData } from './replay/data.mjs'
import { stepStarts, totalFrames } from './replay/timeline.mjs'
import { clipDataUrl, synthesizeSpeech } from './speech.mjs'

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

export function replayHtml(match, audio = null) {
  const assets = replayAssets()
  const data = replayData(match, audio)
  const title = escapeHtml(match.title)
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
    APP_JS: assets['app.js'],
  })
}
export function reportMarkdown(match) {
  const turns = new Map()
  for (const event of match.events) {
    if (event.type === 'request' || event.type === 'response') turns.set(event.turnId, { ...turns.get(event.turnId), ...event })
  }
  return [`# ${match.title}`, '', `规则：${match.game.description}（${match.game.version}）`, `创建：${match.createdAt}`, `当前调用配置：${executionLabel(match.config?.pace)}`, `状态：${match.status}`, `结果：${match.result?.message || '尚未结束'}`, `模型调用：${match.calls}；已知 Token：${match.tokens}${match.usageUnknown ? '（部分调用未报告用量）' : ''}`, '选手发言仅对观众可见。', '', ...match.players.map((player, i) => `${playerSide(match.game, i)}：${player.provider}/${player.model}；${player.name}；所选推理强度：${player.reasoningEffort || '模型默认'}`), '', ...movesOf(match).map(event => {
    const turn = turns.get(event.turnId)
    return `## 第 ${event.moveNumber} 手 · ${match.players[event.player].name}\n\n${actionLabel(event.action, match.game)} · ${event.elapsedMs} ms\n\n${executionLabel(turn?.pace)} · ${turn?.execution?.label || turn?.model?.reasoningEffort || '模型默认推理'}\n\n${event.speech}\n`
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
      snapshot = await this.store.update(id, match => {
        if (!['finished', 'cancelled'].includes(match.status) || !movesOf(match).length) throw new Error('请先完成比赛，再导出视频。')
        match.export = { id: randomUUID(), status: 'running', orientation, secondsPerMove, withAudio, phase: withAudio ? 'speech' : 'render', startedAt: new Date().toISOString(), sourceRevision: match.revision }
      })
    } catch (error) { this.running.delete(id); throw error }
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
        await this.render(snapshot, this.store.directory(id), { orientation, secondsPerMove, audio, signal: this.scope.signal })
        await this.store.update(id, match => { match.export = { ...match.export, status: 'succeeded', phase: 'done', completedAt: new Date().toISOString() } })
      } catch (error) {
        await this.store.update(id, match => { match.export = { ...match.export, status: 'failed', error: error.message } })
      } finally { this.running.delete(id) }
    })())
    return snapshot
  }
  async startReplay({ id }) {
    if (this.running.has(id)) throw new Error('这场比赛正在导出。')
    this.running.add(id)
    let snapshot
    try {
      snapshot = await this.store.update(id, match => {
        if (!['finished', 'cancelled'].includes(match.status) || !movesOf(match).length) throw new Error('请先完成比赛，再导出回放。')
        match.export = { id: randomUUID(), kind: 'html', status: 'running', withAudio: true, phase: 'speech', speechDone: 0, speechTotal: movesOf(match).filter(move => String(move.speech || '').trim()).length, startedAt: new Date().toISOString(), sourceRevision: match.revision }
      })
    } catch (error) { this.running.delete(id); throw error }
    this.scope.background((async () => {
      try {
        const audio = await synthesizeSpeech(snapshot, this.store.directory(id), {
          scope: this.scope, signal: this.scope.signal,
          onProgress: ({ done, total }) => this.store.update(id, match => { if (match.export?.status === 'running') match.export = { ...match.export, phase: 'speech', speechDone: done, speechTotal: total } }),
        })
        const inline = new Map()
        for (const [moveNumber, clip] of audio) inline.set(moveNumber, { seconds: clip.seconds, src: await clipDataUrl(clip.file) })
        const text = replayHtml(snapshot, inline)
        await writeFile(join(this.store.directory(id), 'replay.html'), text, { mode: 0o600 })
        await this.store.update(id, match => { match.export = { ...match.export, status: 'succeeded', phase: 'done', bytes: Buffer.byteLength(text), completedAt: new Date().toISOString() } })
      } catch (error) {
        await this.store.update(id, match => { match.export = { ...match.export, status: 'failed', error: error.message } })
      } finally { this.running.delete(id) }
    })())
    return snapshot
  }
  async record(match) {
    return { text: replayHtml(match), type: 'text/html', extension: 'html' }
  }
  async chunk({ id, exportId, offset = 0 }) {
    const match = await this.store.get(id)
    if (match.export?.status !== 'succeeded') throw new Error('视频尚未导出成功。')
    if (exportId && exportId !== match.export.id) throw new Error('导出版本已变化，请重新下载。')
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('下载偏移无效。')
    const file = join(this.store.directory(id), match.export.kind === 'html' ? 'replay.html' : `${match.export.orientation}.mp4`)
    const info = await lstat(file)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('视频文件无效。')
    if (offset > info.size) throw new Error('下载偏移越界。')
    const handle = await open(file, 'r')
    try {
      const buffer = Buffer.alloc(Math.min(512 * 1024, info.size - offset))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset)
      return { data: buffer.subarray(0, bytesRead).toString('base64'), offset, nextOffset: offset + bytesRead, bytes: info.size, done: offset + bytesRead === info.size }
    } finally { await handle.close() }
  }
}
export async function renderVideo(match, directory, { orientation, secondsPerMove, audio = null, signal }) {
  signal.throwIfAborted()
  await exec('ffmpeg', ['-version'], { signal })
  const { bundle } = await import('@remotion/bundler')
  const { renderMedia, makeCancelSignal } = await import('@remotion/renderer')
  const dir = join(directory, 'render')
  await mkdir(dir, { recursive: true })
  const serveUrl = await bundle({ entryPoint: join(ROOT, 'video.mjs'), outDir: join(dir, 'bundle'), webpackOverride: config => config })
  signal.throwIfAborted()
  const width = orientation === 'landscape' ? 1280 : 720, height = orientation === 'landscape' ? 720 : 1280, fps = 30
  const data = replayData(match, audio ? new Map([...audio].map(([moveNumber, clip]) => [moveNumber, { seconds: clip.seconds }])) : null)
  const durations = data.moves.map(move => move.audioSec || 0)
  const frames = totalFrames(data.moves.length, fps, secondsPerMove, audio ? durations : null)
  const spoken = audio ? [...audio].filter(([, clip]) => clip.seconds > 0) : []
  const temporary = join(directory, `${orientation}.partial.mp4`)
  const { cancelSignal, cancel } = makeCancelSignal()
  const abort = () => cancel()
  signal.addEventListener('abort', abort, { once: true })
  const browserExecutable = process.env.LWB_REMOTION_BROWSER_EXECUTABLE || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined)
  try {
    /* 视频与离线 HTML 共用同一份投影：同一组手数、关键手、连子和终局文案。 */
    const props = { data, layout: orientation, secondsPerMove, durations: audio ? durations : null }
    const silent = join(directory, `${orientation}.silent.mp4`)
    await renderMedia({ serveUrl, composition: { id: 'Arena', width, height, fps, durationInFrames: frames, defaultProps: {}, props, defaultCodec: null, defaultOutName: null, defaultVideoImageFormat: null, defaultPixelFormat: null }, inputProps: props, outputLocation: audio?.size ? silent : temporary, codec: 'h264', crf: 23, pixelFormat: 'yuv420p', browserExecutable, cancelSignal, concurrency: 2, chromiumOptions: { gl: 'swiftshader' } })
    signal.throwIfAborted()
    if (spoken.length) await mixSpeech(silent, temporary, spoken, data.moves.length, secondsPerMove, signal)
    const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height,codec_type:format=duration', '-of', 'json', temporary], { signal })
    const probe = JSON.parse(stdout)
    const hasAudio = probe.streams.some(stream => stream.codec_type === 'audio')
    if (!probe.streams.some(stream => stream.width === width && stream.height === height) || Math.abs(Number(probe.format.duration) - frames / fps) > 1 || hasAudio !== spoken.length > 0) throw new Error('导出视频未通过尺寸或时长检查。')
    await rename(temporary, join(directory, `${orientation}.mp4`))
    await writeFile(join(directory, 'video-report.json'), `${JSON.stringify(probe, null, 2)}\n`, { mode: 0o600 })
  } finally {
    signal.removeEventListener('abort', abort)
    await rm(dir, { recursive: true, force: true })
    await rm(temporary, { force: true })
    await rm(join(directory, `${orientation}.silent.mp4`), { force: true })
  }
}

/** 把每句配音按该手的起始时间铺到一条音轨上，再贴进无声成片。画面时长保持不变。 */
async function mixSpeech(silent, output, spoken, moveCount, secondsPerMove, signal) {
  const durations = []
  for (const [moveNumber, clip] of spoken) durations[moveNumber - 1] = clip.seconds
  const starts = stepStarts(moveCount, secondsPerMove, durations)
  const args = ['-y', '-i', silent]
  for (const [, clip] of spoken) args.push('-i', clip.file)
  const delayed = spoken.map(([moveNumber], index) => `[${index + 1}:a]adelay=${Math.round(starts[moveNumber] * 1000)}|${Math.round(starts[moveNumber] * 1000)}[a${index}]`)
  const mix = spoken.map((_, index) => `[a${index}]`).join('')
  args.push('-filter_complex', `${delayed.join(';')};${mix}amix=inputs=${spoken.length}:normalize=0:duration=longest[aout]`, '-map', '0:v:0', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', output)
  await exec('ffmpeg', args, { signal })
}
