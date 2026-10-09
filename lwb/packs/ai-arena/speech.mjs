/**
 * 把每手选手发言与主持人播报合成语音。只走已声明的 LWB TTS：
 * 先查登录与最低积分，再上传参考音色、提交任务。
 * 同一句、同一音色的文件留在比赛目录，重导时不再请求，避免重复扣费。
 */
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { movesOf } from './presentation.mjs'
import { HOST_VOICE_KEY, assignVoices, voiceFile } from './voices.mjs'
import { hostNarrationLines } from './replay/data.mjs'

const exec = promisify(execFile)
const ASSET_ID = /^[A-Za-z0-9_-]{1,128}$/u
/** 成片与参考音色共用的响度。改目标就要改缓存名，否则旧文件会被当成已拉齐。 */
const LOUDNESS_TARGET = -16
const TRUE_PEAK = -1.5
/** 配音缓存名与成片复用键都带它：响度口径变了，旧 mp3 和旧成片一起失效。 */
export const LOUDNESS_VERSION = 'v1'

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

function clipName(voice, text) {
  return `${LOUDNESS_VERSION}-${createHash('sha256').update(`${voice}\u0000${text}`).digest('hex').slice(0, 24)}.mp3`
}

async function integratedLoudness(path, signal) {
  const { stderr = '' } = await exec('ffmpeg', ['-hide_banner', '-i', path, '-af', 'ebur128', '-f', 'null', '-'], { signal }).catch(error => error)
  const matched = String(stderr).match(/Integrated loudness:\s*\n\s*I:\s*(-?\d+(?:\.\d+)?)/u)
  const value = matched ? Number(matched[1]) : NaN
  return Number.isFinite(value) && value > -70 ? value : null
}

/** 尽量拉到同一综合响度。对不齐时返回已有音频，不中断导出。 */
export async function normalizeLoudness(bytes, { signal } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'arena-loud-'))
  const input = join(dir, 'in'), output = join(dir, 'out.mp3')
  const readOutput = async () => readFile(output).catch(() => null)
  try {
    await writeFile(input, bytes)
    signal?.throwIfAborted()
    await exec('ffmpeg', ['-y', '-i', input, '-af', `loudnorm=I=${LOUDNESS_TARGET}:TP=${TRUE_PEAK}:LRA=11`, '-ar', '44100', '-q:a', '4', output], { signal }).catch(() => {})
    const leveled = await readOutput()
    const loudness = leveled?.length ? await integratedLoudness(output, signal).catch(() => null) : null
    if (leveled?.length && loudness !== null && Math.abs(loudness - LOUDNESS_TARGET) <= 2) return leveled
    const { stderr = '' } = await exec('ffmpeg', ['-hide_banner', '-i', input, '-af', 'volumedetect', '-f', 'null', '-'], { signal }).catch(error => ({ stderr: error.stderr || '' }))
    const peak = Number(String(stderr).match(/max_volume:\s*(-?\d+(?:\.\d+)?)/u)?.[1])
    if (Number.isFinite(peak)) {
      const gain = Math.min(LOUDNESS_TARGET - (peak - 3), TRUE_PEAK - peak)
      await exec('ffmpeg', ['-y', '-i', input, '-af', `volume=${gain.toFixed(2)}dB`, '-ar', '44100', '-q:a', '4', output], { signal }).catch(() => {})
      const peaked = await readOutput()
      if (peaked?.length) return peaked
    }
    return leveled?.length ? leveled : bytes
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
      const url = await synthesize(service.request, assets.get(line.voice), line.text, signal)
      const response = await fetch(url, { signal, redirect: 'error' })
      if (!response.ok) throw new Error('配音下载失败。')
      const bytes = Buffer.from(await response.arrayBuffer())
      if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error('配音文件无效。')
      const label = line.kind === 'host' ? `第 ${line.n} 手主持人播报` : `第 ${line.n} 手配音`
      const leveled = await normalizeLoudness(bytes, { signal, label })
      await writeFile(file, leveled, { mode: 0o600 })
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
