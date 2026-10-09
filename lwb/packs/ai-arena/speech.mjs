/**
 * 把每手选手发言与主持人播报合成语音。只走已声明的 LWB TTS：
 * 先查登录与最低积分，再上传参考音色、提交任务。
 * 同一句、同一音色的文件留在比赛目录，重导时不再请求，避免重复扣费。
 */
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { movesOf } from './presentation.mjs'
import { HOST_VOICE_KEY, assignVoices, voiceFile } from './voices.mjs'
import { hostNarrationLines } from './replay/data.mjs'

const exec = promisify(execFile)
const ASSET_ID = /^[A-Za-z0-9_-]{1,128}$/u
/** 成片与参考音色共用的响度。改对齐链路（目标、限幅、滤镜）就要同步改 `LOUDNESS_VERSION`，
    否则旧口径的片段会被当成已对齐、旧成片也会被复用。 */
const LOUDNESS_TARGET = -16
const TRUE_PEAK = -1.5
/** 限幅天花板比真峰值上限再低 1 dB：MP3 编码会把真峰值抬高（实测最多 0.6 dB），
    留出余量后成片实测才真的不超过 -1.5 dBTP。 */
const LIMITER_CEILING = TRUE_PEAK - 1
/** 配音缓存名与成片复用键都带它：响度口径变了，旧 mp3 和旧成片一起失效。 */
export const LOUDNESS_VERSION = 'v2'

/** 选手发言：一手一句，用该座位的音色。 */
function speechLines(match) {
  const voices = assignVoices(match.players || [])
  return movesOf(match)
    .filter(move => String(move.speech || '').trim())
    .map(move => ({
      n: move.moveNumber,
      kind: 'speech',
      voice: voices[move.player] || voices[0],
      text: String(move.speech).trim().slice(0, 800),
    }))
}

/** 主持人播报：一手至多一段，用固定音色；同一句不重复合成（见 hostNarrationLines）。 */
function hostLines(match) {
  return hostNarrationLines(match).map(line => ({
    n: line.n,
    kind: 'host',
    voice: HOST_VOICE_KEY,
    text: String(line.text).trim().slice(0, 800),
  }))
}

/** 给导出进度与界面用：这一场会说几句，选手与主持人分开数。 */
export function countSpeechLines(match) {
  const speech = speechLines(match).length
  const host = hostLines(match).length
  return { speech, host, total: speech + host }
}

function speechQueue(match) {
  return [...speechLines(match), ...hostLines(match)]
}

function clipDigest(voice, text) {
  return createHash('sha256').update(`${voice}\u0000${text}`).digest('hex').slice(0, 24)
}

function clipName(voice, text) {
  return `${LOUDNESS_VERSION}-${clipDigest(voice, text)}.mp3`
}

/**
 * 扫一遍配音目录，按「音色 + 文本」摘要索引旧口径的片段：`v1-<摘要>.mp3`，更早的一版没有前缀。
 * 响度口径升级后重导时先拿这些旧片段重新对齐 —— 既不重复调用 TTS 计费，
 * 也顺带把旧口径留下的偏小片段修好。带当前版本号的片段不算旧片段。
 * 只扫一次目录：逐句 readdir 会把这个循环拖成「句数 × 目录项数」。
 */
async function legacyClips(directory) {
  const index = new Map()
  for (const name of await readdir(directory).catch(() => [])) {
    const digest = /^(?:v\d+-)?([0-9a-f]{24})\.mp3$/u.exec(name)?.[1]
    if (digest && !name.startsWith(`${LOUDNESS_VERSION}-`)) index.set(digest, name)
  }
  return index
}

/** 旧口径的同一句。找不到返回 null；大小按同一口径复核，免得把半截文件当成片段。 */
async function legacyClip(directory, index, voice, text) {
  const name = index.get(clipDigest(voice, text))
  if (!name) return null
  const bytes = await readFile(join(directory, name)).catch(() => null)
  return bytes?.length && bytes.length <= 8 * 1024 * 1024 ? bytes : null
}

/**
 * 量一段音频的综合响度与真峰值。用 loudnorm 自己的统计，而不是单独的 ebur128 / volumedetect：
 * 一次调用拿齐口径，结果是 JSON（不必猜 ffmpeg 日志的排版），而且这些值正是 loudnorm
 * 两遍模式要喂回去的输入。量不出来（近乎静音、构建缺滤镜、文件损坏）时返回 null。
 */
async function measureLoudness(path, signal) {
  let stderr = ''
  try {
    ({ stderr = '' } = await exec('ffmpeg', ['-hide_banner', '-i', path, '-af', `loudnorm=I=${LOUDNESS_TARGET}:TP=${TRUE_PEAK}:LRA=11:print_format=json`, '-f', 'null', '-'], { signal }))
  } catch (error) {
    /* 取消要往外传：静默吞掉会让导出在半途继续跑下去。 */
    if (signal?.aborted) throw error
    stderr = error?.stderr || ''
  }
  const matched = String(stderr).match(/\{[\s\S]*\}/u)
  if (!matched) return null
  let report
  try { report = JSON.parse(matched[0]) } catch { return null }
  const numeric = value => (Number.isFinite(Number(value)) ? Number(value) : null)
  const integrated = numeric(report.input_i), peak = numeric(report.input_tp)
  if (integrated === null || integrated <= -70 || peak === null) return null
  return {
    integrated, peak,
    lra: numeric(report.input_lra) ?? 0,
    threshold: numeric(report.input_thresh) ?? integrated - 10,
    offset: numeric(report.target_offset) ?? 0,
  }
}

/** 跑一遍滤镜写文件。产不出文件就返回 null，好让调用方换一条路，而不是把脏数据当成结果。 */
async function renderAudio(input, output, filter, signal) {
  try {
    await exec('ffmpeg', ['-y', '-i', input, '-af', filter, '-ar', '44100', '-q:a', '4', output], { signal })
  } catch (error) { if (signal?.aborted) throw error }
  const bytes = await readFile(output).catch(() => null)
  return bytes?.length ? bytes : null
}

/**
 * 增益 + 前瞻限幅。语音的波峰因数常在 15 dB 上下：-16 LUFS 配 -1.5 dBTP 本来就装不下，
 * 必须把越过天花板的峰压住，而不是把增益砍回去 —— 砍增益正是旧实现让句子小声 13 dB 的原因。
 */
function levelWithLimiter(input, output, gain, signal) {
  const filter = `volume=${gain.toFixed(2)}dB,alimiter=limit=${LIMITER_CEILING}dB:attack=5:release=50:level=disabled`
  return renderAudio(input, output, filter, signal)
}

/** 少数 FFmpeg 构建裁掉了 alimiter：退回两遍 loudnorm。它只会贴到真峰值上限为止
    （波峰因数高的句子因此低 2–3 LU），但方向永远正确，而且只用得到 loudnorm。 */
function levelWithLoudnorm(input, output, measured, signal) {
  const filter = [
    `loudnorm=I=${LOUDNESS_TARGET}:TP=${TRUE_PEAK}:LRA=11`,
    `measured_I=${measured.integrated.toFixed(2)}`, `measured_TP=${measured.peak.toFixed(2)}`,
    `measured_LRA=${measured.lra.toFixed(2)}`, `measured_thresh=${measured.threshold.toFixed(2)}`,
    `offset=${measured.offset.toFixed(2)}`, 'linear=true',
  ].join(':')
  return renderAudio(input, output, filter, signal)
}

/** 尽量拉到同一综合响度。量不出来或两条路都产不出文件时返回已有音频，不中断导出。 */
export async function normalizeLoudness(bytes, { signal } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'arena-loud-'))
  const input = join(dir, 'in'), output = join(dir, 'out.mp3'), fallback = join(dir, 'fallback.mp3')
  try {
    await writeFile(input, bytes)
    signal?.throwIfAborted()
    const measured = await measureLoudness(input, signal)
    if (!measured) return bytes
    const leveled = await levelWithLimiter(input, output, LOUDNESS_TARGET - measured.integrated, signal)
    return leveled || await levelWithLoudnorm(input, fallback, measured, signal) || bytes
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function probeSeconds(path, signal) {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', path], { signal })
  const seconds = Number(JSON.parse(stdout).format?.duration)
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 120) throw new Error('配音时长无效。')
  return seconds
}

function lwbData(body, label) {
  if (body?.success === true && body.data && typeof body.data === 'object') return body.data
  if (body?.code === 200 && body.data && typeof body.data === 'object') return body.data
  const detail = body?.message || body?.error?.message || `${label}没有返回有效数据。`
  throw new Error(String(detail))
}

function jobId(data) {
  return [data.job_id, data.task_id, data.id].map(value => (typeof value === 'string' ? value.trim() : '')).find(Boolean) || ''
}

function audioUrl(data) {
  const candidates = [data.result?.audio_url, data.audio_url, data.result?.url, data.url]
  return candidates.find(value => typeof value === 'string' && /^https:\/\//u.test(value)) || ''
}

async function uploadVoice(request, profile, settings) {
  const store = await settings?.().catch(() => null)
  const bytes = await normalizeLoudness(profile.bytes, { label: '参考音色' })
  const digest = createHash('sha256').update(bytes).digest('hex')
  const saved = store?.get()?.voiceAssets?.[digest]
  if (typeof saved === 'string' && ASSET_ID.test(saved)) return saved
  const form = new FormData()
  form.append('file', new Blob([bytes], { type: 'audio/mpeg' }), `${profile.key}.mp3`)
  const data = lwbData(await request('/api/v1/media/audio-uploads', { method: 'POST', body: form }), '音色上传')
  const assetId = [data.asset_id, data.assetId].find(value => typeof value === 'string' && ASSET_ID.test(value))
  if (!assetId) throw new Error('音色上传没有返回资产标识。')
  if (store?.update) {
    const current = store.get().voiceAssets || {}
    await store.update({ voiceAssets: { ...current, [digest]: assetId } })
  }
  return assetId
}

async function synthesize(request, assetId, text, signal) {
  const submitted = lwbData(await request('/api/v1/tts/jobs', {
    method: 'POST',
    body: JSON.stringify({ text, reference_audio_asset_id: assetId, output_format: 'mp3' }),
  }), 'LWB TTS 提交')
  const id = jobId(submitted)
  if (!id) throw new Error('LWB TTS 没有返回任务标识。')
  const started = Date.now()
  while (Date.now() - started < 180000) {
    signal.throwIfAborted()
    const data = lwbData(await request(`/api/v1/tts/jobs/${encodeURIComponent(id)}`, { method: 'GET' }), 'LWB TTS 状态')
    const state = String(data.status || data.job_status || '').trim().toLowerCase()
    if (['completed', 'succeeded', 'success'].includes(state)) {
      const url = audioUrl(data)
      if (!url) throw new Error('LWB TTS 没有返回完整音频地址。')
      return url
    }
    if (['failed', 'cancelled', 'canceled'].includes(state)) throw new Error(`配音任务失败：${data.error_message || data.error?.message || '没有返回原因'}`)
    if (!['queued', 'pending', 'processing', 'running', 'in_progress', ''].includes(state) && state) throw new Error('配音任务返回了未知状态。')
    await new Promise(resolve => setTimeout(resolve, 1500))
  }
  throw new Error('配音任务超时。')
}

/** 向 LWB TTS 要一句并下载。大小按同一口径复核，不把半截响应写进缓存。 */
async function downloadClip(service, fetch, assets, line, signal) {
  const url = await synthesize(service.request, assets.get(line.voice), line.text, signal)
  const response = await fetch(url, { signal, redirect: 'error' })
  if (!response.ok) throw new Error('配音下载失败。')
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error('配音文件无效。')
  return bytes
}

/**
 * @returns {Promise<Map<number, { host?: { seconds: number, file: string }, speech?: { seconds: number, file: string } }>>}
 *   手数 → 该手的配音分段（主持人先说，选手后说）。
 */
export async function synthesizeSpeech(match, directory, { scope, fetch = globalThis.fetch, signal, onProgress }) {
  const status = await scope.account.status('tts')
  if (!status?.authenticated) throw new Error(status?.reason || '请先登录 LWB 账号。')
  if (!status.configured) throw new Error(status.reason || 'LWB 语音服务暂不可用。')
  const points = await scope.account.points?.().catch(() => null)
  const available = Number(points?.availablePoints)
  const minimum = Number(status.minimumPoints || 0)
  if (Number.isFinite(available) && available < minimum) throw new Error('积分不足，请购买积分后重试。')
  const lines = speechQueue(match)
  if (!lines.length) return new Map()
  const service = await scope.account.open('tts')
  const settings = () => scope.settings('arena-voices', value => ({ voiceAssets: value?.voiceAssets && typeof value.voiceAssets === 'object' ? value.voiceAssets : {} }))
  const assets = new Map()
  for (const key of new Set(lines.map(line => line.voice))) assets.set(key, await uploadVoice(service.request, voiceFile(key), settings))
  const audioDir = join(directory, 'audio')
  await mkdir(audioDir, { recursive: true, mode: 0o700 })
  const legacyIndex = await legacyClips(audioDir)
  const clips = new Map()
  let done = 0
  const queue = [...lines]
  async function next() {
    const line = queue.shift()
    if (!line) return
    signal.throwIfAborted()
    const file = join(audioDir, clipName(line.voice, line.text))
    let exists = true
    await access(file).catch(() => { exists = false })
    if (exists) {
      try { await probeSeconds(file, signal) } catch { exists = false }
    }
    if (!exists) {
      const label = line.kind === 'host' ? `第 ${line.n} 手主持人播报` : `第 ${line.n} 手配音`
      const carry = async source => {
        await writeFile(file, await normalizeLoudness(source, { signal, label }), { mode: 0o600 })
        return probeSeconds(file, signal).catch(() => null)
      }
      /* 旧口径的同一句先拿来重新对齐：省一次 TTS，也顺带修好旧口径留下的偏小片段。
         旧片段自己可能是坏的（上次写到一半），量不出时长就照旧向 TTS 要一句。 */
      const previous = await legacyClip(audioDir, legacyIndex, line.voice, line.text)
      if (!previous || await carry(previous) === null) await carry(await downloadClip(service, fetch, assets, line, signal))
    }
    const clip = { seconds: await probeSeconds(file, signal), file }
    clips.set(line.n, { ...(clips.get(line.n) || {}), [line.kind]: clip })
    done += 1
    await onProgress?.({ done, total: lines.length })
    await next()
  }
  await Promise.all([next(), next()])
  return clips
}

export async function clipDataUrl(file) {
  const bytes = await readFile(file)
  return `data:audio/mpeg;base64,${bytes.toString('base64')}`
}
