import { createHash, randomUUID } from 'node:crypto'
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { execFile, spawn } from 'node:child_process'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { spokenVideoDataPath } from './spoken-video-paths.mjs'
import { executionEvent, executionTransition, mediaRunArtifact } from './spoken-video-execution.mjs'
import WebSocket from 'ws'
import {
  buildTechnicalReport,
  DEFAULT_VOICE_PROFILE,
  MEDIA_OPERATION_STATES,
  MEDIA_OPERATION_TYPES,
  mediaServiceConfig,
  mediaCredentialRef,
  normalizeProbe,
  normalizeRenderRequest,
  normalizeSubtitleRequest,
  normalizeVoiceoverRequest,
  serviceData,
  serviceHeaders,
  subtitleResult,
  taskIdFromService,
  taskState,
  SpokenVideoMediaError,
} from './spoken-video-media.mjs'
import { appendDshSessionTrace, dshChildStarted, ensureDshTrace, projectDshSessionEvent, startDshTraceSession } from './spoken-video-dsh-trace.mjs'
import {
  inspectSpokenVideoAgentProject,
  prepareSpokenVideoAgentProject,
  remotionRendererAvailable,
  renderSpokenVideoAgentProject,
} from './spoken-video-remotion.mjs'
import { validateSrt } from './spoken-video-subtitles.mjs'
import { buildVideoCreatorPrompt, buildVideoCreatorRepairPrompt, buildVideoEditorialRepairPrompt, buildVideoReviewerPrompt, normalizeVideoReview, VIDEO_REVIEW_SCHEMA } from './spoken-video-video-agent.mjs'

const execFilePromise = promisify(execFile)
async function execFileAsync(...args) {
  const result = execFilePromise(...args)
  // AbortError may reject before the child has exited. Keep the workspace
  // lease until close, so reset cannot race the child's final file writes.
  const closed = new Promise((resolvePromise) => result.child.once('close', resolvePromise))
  try { return await result } finally { await closed }
}
const PROJECT_ID = /^[a-f0-9-]{36}$/iu
const MAX_MEDIA_BYTES = 80 * 1024 * 1024
const MAX_VOICE_REFERENCE_BYTES = 20 * 1024 * 1024
const MAX_VIDEO_BGM_BYTES = 20 * 1024 * 1024
const AUDIO_UPLOAD_FORMATS = Object.freeze({
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
})
const POLL_INTERVAL_MS = 1_500
const MAX_POLL_MS = 15 * 60 * 1000
const BAILIAN_WAV_DOWNLOAD_ATTEMPTS = 2
const BAILIAN_TTS_SEGMENT_ATTEMPTS = 2
const BAILIAN_ASR_SAMPLE_RATE = 16_000
const BAILIAN_ASR_CHUNK_MS = 100
const BAILIAN_ASR_CHUNK_BYTES = BAILIAN_ASR_SAMPLE_RATE * 2 * BAILIAN_ASR_CHUNK_MS / 1_000
const VIDEO_EDITORIAL_REPAIR_MAX_ATTEMPTS = 2
const PACK_ROOT = dirname(fileURLToPath(import.meta.url))
const DEFAULT_VOICE_FILE = join(PACK_ROOT, DEFAULT_VOICE_PROFILE.file)
const AUDIO_TASKS_FILE = 'audio-tasks.json'
const AUDIO_TASK_LIMIT = 240
const RUN_RECOVERY_GRACE_MS = 2_000

function fail(code, message) {
  throw new SpokenVideoMediaError(code, message)
}

function mediaErrorMessage(error) {
  return String(error instanceof Error ? error.message : error).replace(/^Error \[[A-Z0-9_]+\]\s*/u, '')
}

function providerFailure(label, detail) {
  if (label.startsWith('LWB') && /(?:insufficient[ _-]*points|积分不足|余额不足)/iu.test(detail)) {
    return new SpokenVideoMediaError(
      'SPOKEN_VIDEO_MEDIA_INSUFFICIENT_POINTS',
      'LWB 账户积分不足，请充值后重试，或切换到百炼 BYOK。',
    )
  }
  return new SpokenVideoMediaError('SPOKEN_VIDEO_MEDIA_SERVICE_FAILED', `${label}失败：${detail}`)
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('SPOKEN_VIDEO_MEDIA_INVALID_INPUT', `${label}必须是对象。`)
  return value
}

function text(value, label, maximum, options = {}) {
  if (typeof value !== 'string') fail('SPOKEN_VIDEO_MEDIA_INVALID_INPUT', `${label}必须是文本。`)
  const result = options.trim === false ? value : value.trim()
  if (!result || result.length > maximum) fail('SPOKEN_VIDEO_MEDIA_INVALID_INPUT', `${label}长度必须在 1-${maximum} 之间。`)
  return result
}

function audioUploadFormat(name, mediaType, label) {
  const originalName = text(name, `${label}文件名`, 255)
  if (originalName.includes('/') || originalName.includes('\\') || /[\u0000-\u001f\u007f-\u009f]/u.test(originalName)) {
    fail('SPOKEN_VIDEO_MEDIA_INVALID_INPUT', `${label}文件名无效。`)
  }
  const extension = extname(originalName).slice(1).toLowerCase()
  if (!Object.hasOwn(AUDIO_UPLOAD_FORMATS, extension)) {
    fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', `${label}只支持 MP3、WAV、M4A 或 OGG。`)
  }
  const declaredType = typeof mediaType === 'string' ? mediaType.trim().toLowerCase() : ''
  const aliases = {
    mp3: ['audio/mpeg', 'audio/mp3'],
    wav: ['audio/wav', 'audio/wave', 'audio/x-wav'],
    m4a: ['audio/mp4', 'audio/x-m4a'],
    ogg: ['audio/ogg', 'application/ogg'],
  }
  if (declaredType && !aliases[extension].includes(declaredType)) {
    fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', `${label}的文件扩展名与类型不一致。`)
  }
  return { originalName, extension, mediaType: AUDIO_UPLOAD_FORMATS[extension] }
}

function decodeAudioUpload(value, label, maximumBytes) {
  if (typeof value !== 'string' || !value.length || value.length % 4 !== 0) {
    fail('SPOKEN_VIDEO_MEDIA_INVALID_INPUT', `${label}内容不是有效 Base64。`)
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  const contentLength = value.length - padding
  if (!contentLength) fail('SPOKEN_VIDEO_MEDIA_INVALID_INPUT', `${label}内容为空。`)
  for (let index = 0; index < contentLength; index += 1) {
    const code = value.charCodeAt(index)
    const valid = (code >= 0x41 && code <= 0x5a)
      || (code >= 0x61 && code <= 0x7a)
      || (code >= 0x30 && code <= 0x39)
      || code === 0x2b || code === 0x2f
    if (!valid) fail('SPOKEN_VIDEO_MEDIA_INVALID_INPUT', `${label}内容不是有效 Base64。`)
  }
  for (let index = contentLength; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 0x3d) fail('SPOKEN_VIDEO_MEDIA_INVALID_INPUT', `${label}内容不是有效 Base64。`)
  }
  const estimatedBytes = value.length / 4 * 3 - padding
  if (estimatedBytes > maximumBytes) fail('SPOKEN_VIDEO_MEDIA_FILE_TOO_LARGE', `${label}不能超过 20 MiB。`)
  const bytes = Buffer.from(value, 'base64')
  if (!bytes.length || bytes.length !== estimatedBytes || bytes.toString('base64') !== value) {
    fail('SPOKEN_VIDEO_MEDIA_INVALID_INPUT', `${label}内容不是规范 Base64。`)
  }
  return bytes
}

const voiceReferenceFormat = (name, mediaType) => audioUploadFormat(name, mediaType, '参考音频')
const decodeVoiceReference = (value) => decodeAudioUpload(value, '参考音频', MAX_VOICE_REFERENCE_BYTES)
const videoBgmFormat = (name, mediaType) => audioUploadFormat(name, mediaType, '背景音乐')
const decodeVideoBgm = (value) => decodeAudioUpload(value, '背景音乐', MAX_VIDEO_BGM_BYTES)

function projectId(value) {
  const result = text(value, '项目标识', 36).toLowerCase()
  if (!PROJECT_ID.test(result)) fail('SPOKEN_VIDEO_MEDIA_INVALID_INPUT', '项目标识无效。')
  return result
}

function expectedRevision(value) {
  if (!Number.isSafeInteger(value) || value < 1) fail('SPOKEN_VIDEO_MEDIA_INVALID_INPUT', '项目版本无效。')
  return value
}

function pathInside(root, candidate) {
  const candidateRelative = relative(root, candidate)
  return candidateRelative !== '' && !candidateRelative.startsWith(`..${sep}`) && candidateRelative !== '..' && !isAbsolute(candidateRelative)
}

function mediaPath(value, label) {
  const file = text(value, label, 280)
  if (!/^media\/[a-z][a-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/u.test(file)) {
    fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', `${label}无效。`)
  }
  return file
}

async function workspaceFor(agent) {
  const cwd = agent?.workspacePath ?? agent?.session?.header?.cwd
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) fail('SPOKEN_VIDEO_WORKSPACE_REQUIRED', '媒体操作需要已加载的能力包专属工作区。')
  try {
    const workspace = await realpath(cwd)
    const info = await lstat(workspace)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('invalid workspace')
    return workspace
  } catch {
    fail('SPOKEN_VIDEO_WORKSPACE_REQUIRED', '能力包专属工作区不可用，请重新加载能力包后重试。')
  }
}

async function projectRootFor(agent, id) {
  const workspace = await workspaceFor(agent)
  const root = spokenVideoDataPath(workspace, 'projects', id)
  const info = await lstat(root).catch(() => null)
  if (!info?.isDirectory() || info.isSymbolicLink()) fail('SPOKEN_VIDEO_NOT_FOUND', '口播项目不存在。')
  return root
}

async function audioTasksRootFor(agent) {
  const workspace = await workspaceFor(agent)
  const root = spokenVideoDataPath(workspace)
  await mkdir(root, { recursive: true, mode: 0o700 })
  const info = await lstat(root).catch(() => null)
  if (!info?.isDirectory() || info.isSymbolicLink()) fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', '音频任务目录无效。')
  return realpath(root)
}

async function safeMediaTarget(root, relativePath, label, createDirectories = false) {
  const parts = relativePath.split('/')
  const filename = parts.pop()
  const resolvedRoot = await realpath(root)
  let directory = resolvedRoot
  for (const segment of parts) {
    const candidate = join(directory, segment)
    let info = await lstat(candidate).catch(() => null)
    if (!info && createDirectories) {
      await mkdir(candidate, { mode: 0o700 })
      info = await lstat(candidate).catch(() => null)
    }
    if (!info?.isDirectory() || info.isSymbolicLink()) fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', `${label}路径无效。`)
    const resolved = await realpath(candidate)
    if (resolved !== resolvedRoot && !pathInside(resolvedRoot, resolved)) fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', `${label}超出项目目录。`)
    directory = resolved
  }
  return join(directory, filename)
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`)
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  await rename(temporary, path)
}

async function readJson(path, fallback) {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', '媒体任务记录无效。')
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback
    if (error instanceof SyntaxError) fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', '媒体任务记录不是有效 JSON。')
    throw error
  }
}

function runsFile(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.runs)) return { schemaVersion: 1, runs: [] }
  return {
    schemaVersion: 1,
    runs: value.runs.filter((run) => run && typeof run === 'object' && MEDIA_OPERATION_TYPES.includes(run.type) && MEDIA_OPERATION_STATES.includes(run.status)).slice(-80),
  }
}

async function readRuns(root) {
  return runsFile(await readJson(join(root, 'media', 'runs.json'), { schemaVersion: 1, runs: [] }))
}

async function writeRuns(root, value) {
  await writeJson(join(root, 'media', 'runs.json'), runsFile(value))
}

function audioTasksFile(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.tasks)) return { schemaVersion: 1, tasks: [] }
  return { schemaVersion: 1, tasks: value.tasks.filter((task) => task && typeof task === 'object' && typeof task.id === 'string').slice(-AUDIO_TASK_LIMIT) }
}

async function readAudioTasks(root) {
  return audioTasksFile(await readJson(join(root, AUDIO_TASKS_FILE), { schemaVersion: 1, tasks: [] }))
}

async function writeAudioTasks(root, value) {
  await writeJson(join(root, AUDIO_TASKS_FILE), audioTasksFile(value))
}

function runSummary(run) {
  return {
    id: run.id,
    type: run.type,
    status: run.status,
    projectId: run.projectId,
    expectedRevision: run.expectedRevision,
    createdAt: run.createdAt,
    startedAt: run.startedAt || null,
    completedAt: run.completedAt || null,
    phase: run.phase || null,
    error: run.error || null,
    result: run.result || null,
    pipeline: run.type === 'video' && run.pipeline && typeof run.pipeline === 'object' ? run.pipeline : null,
    input: run.input ? {
      provider: run.input.provider || null,
      voiceSource: run.input.voiceSource || null,
      voiceId: run.input.voiceId || null,
      voiceName: run.input.voiceName || null,
      rate: run.input.rate ?? null,
      volume: run.input.volume ?? null,
      language: run.input.language || null,
      visualBrief: run.input.visualBrief || null,
      renderer: run.input.renderer || null,
      orientation: run.input.orientation === 'landscape' ? 'landscape' : 'portrait',
      subtitleEnabled: run.input.subtitleEnabled !== false,
      backgroundMusic: run.input.backgroundMusic && typeof run.input.backgroundMusic === 'object' ? run.input.backgroundMusic : null,
      bgmVolume: Number.isFinite(run.input.bgmVolume) ? run.input.bgmVolume : null,
      videoTaskId: run.input.videoTaskId || null,
    } : null,
    // Video runs retain their source snapshot. Project artifacts can advance
    // after a task is submitted, while this record must stay inspectable.
    source: run.type === 'video' && run.source && typeof run.source === 'object' ? run.source : null,
    dsh: run.dsh && typeof run.dsh === 'object' ? {
      childSessionId: typeof run.dsh.childSessionId === 'string' ? run.dsh.childSessionId : null,
      parentSessionId: typeof run.dsh.parentSessionId === 'string' ? run.dsh.parentSessionId : null,
      events: Array.isArray(run.dsh.events) ? run.dsh.events : [],
      sessions: Array.isArray(run.dsh.sessions) ? run.dsh.sessions : [],
    } : null,
  }
}

function videoSourceSnapshot(detail, subtitleEnabled) {
  const script = detail?.artifacts?.script
  const voiceover = detail?.artifacts?.voiceover
  const subtitles = detail?.artifacts?.subtitles
  const body = typeof script?.data?.body === 'string' ? script.data.body : ''
  const audio = voiceover?.data?.audio && typeof voiceover.data.audio === 'object' ? voiceover.data.audio : null
  const srt = typeof subtitles?.data?.srt === 'string' ? subtitles.data.srt : null
  return {
    title: typeof detail?.title === 'string' ? detail.title : '未命名稿件',
    script: { revision: script?.revision || null, body },
    voiceover: {
      revision: voiceover?.revision || null,
      audio: audio ? {
        file: audio.file || null,
        mediaType: audio.mediaType || null,
        bytes: audio.bytes ?? null,
        durationSeconds: audio.durationSeconds ?? null,
      } : null,
    },
    subtitles: subtitleEnabled ? {
      revision: subtitles?.revision || null,
      srt,
      cueCount: subtitles?.data?.cueCount ?? null,
    } : null,
  }
}

function audioTaskSummary(task) {
  const subtitle = task.subtitle || { status: 'idle' }
  return {
    id: task.id,
    origin: task.origin || 'audio',
    current: task.current !== false,
    execution: task.execution || { kind: 'audio', id: task.id },
    subtitleExecution: task.subtitleExecution || null,
    type: 'voiceover',
    status: task.status,
    createdAt: task.createdAt,
    startedAt: task.startedAt || null,
    completedAt: task.completedAt || null,
    error: task.error || null,
    projectSync: task.projectSync || null,
    projectSyncError: task.projectSyncError || null,
    subtitleSyncError: task.subtitleSyncError || null,
    source: {
      kind: task.source?.kind || 'manual-text',
      projectId: task.source?.projectId || null,
      projectTitle: task.source?.projectTitle || null,
      title: task.source?.title || '未命名文稿',
      text: task.source?.text || '',
    },
    input: task.input ? {
      provider: task.input.provider || null,
      voiceSource: task.input.voiceSource || null,
      voiceId: task.input.voiceId || null,
      voiceName: task.input.voiceName || null,
      rate: task.input.rate ?? null,
      volume: task.input.volume ?? null,
      subtitleEnabled: task.input.subtitleEnabled === true,
    } : null,
    result: task.result || null,
    subtitle: {
      status: subtitle.status || 'idle',
      id: subtitle.id || null,
      createdAt: subtitle.createdAt || null,
      startedAt: subtitle.startedAt || null,
      completedAt: subtitle.completedAt || null,
      error: subtitle.error || null,
      cueCount: subtitle.current?.cueCount ?? null,
      currentVersionId: subtitle.current?.id || null,
      srt: subtitle.current?.srt || null,
    },
  }
}

// Project media runs remain the source of truth. Project audio is projected into
// the same feed as standalone audio without copying records or regenerating media.
function projectAudioTasks(detail, runs) {
  return runs.filter((run) => run.type === 'voiceover').map((run) => {
    const produced = run.result?.artifact?.data || {}
    const audio = run.result?.audio ? { ...produced.audio, ...run.result.audio } : produced.audio
    const linked = runs.filter((item) => item.type === 'subtitles' && audio?.file
      && (item.source?.voiceover?.audio?.file || item.result?.artifact?.data?.sourceAudioFile) === audio.file)
      .reverse().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]
    const captions = linked?.result?.artifact?.data || linked?.result
    const generatedSubtitle = linked ? {
      id: linked.id, status: linked.status, createdAt: linked.createdAt,
      startedAt: linked.startedAt, completedAt: linked.completedAt, error: linked.error,
      current: captions?.srt ? { id: linked.id, srt: captions.srt, file: captions.srtFile, cueCount: captions.cueCount } : null,
    } : { status: 'idle' }
    const subtitle = run.subtitle && run.subtitle.baseRunId === (linked?.id || null) ? run.subtitle : generatedSubtitle
    const current = Boolean(audio?.file && detail.artifacts?.voiceover?.data?.audio?.file === audio.file
      && detail.artifacts?.script?.revision === run.source?.script?.revision)
    return {
      ...run, origin: 'project-media', current,
      execution: { kind: 'media', id: run.id, projectId: detail.id },
      subtitleExecution: linked ? { kind: 'media', id: linked.id, projectId: detail.id } : null,
      source: { kind: 'saved-script', projectId: detail.id, projectTitle: detail.title, title: run.source?.title || detail.title, text: run.source?.script?.body || '' },
      result: audio ? { audio, provider: produced.provider || run.input?.provider } : null,
      projectSync: audio ? { projectId: detail.id, voiceFile: audio.file } : null,
      subtitle,
    }
  })
}

function requestId() {
  return randomUUID().replace(/-/gu, '')
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

async function awaitWithin(promise, milliseconds, code, message) {
  let timeout
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new SpokenVideoMediaError(code, message)), milliseconds)
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

function mediaTypeForFormat(format) {
  return ({ wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg' })[format] || 'application/octet-stream'
}

function extensionForFormat(format) {
  return ({ wav: 'wav', mp3: 'mp3', m4a: 'm4a', ogg: 'ogg' })[format] || 'wav'
}

async function defaultVoiceReference() {
  const info = await lstat(DEFAULT_VOICE_FILE).catch(() => null)
  if (!info?.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > MAX_MEDIA_BYTES) {
    fail('SPOKEN_VIDEO_MEDIA_NOT_CONFIGURED', `项目默认音色 ${DEFAULT_VOICE_PROFILE.name} 不可用。`)
  }
  const audio = await readFile(DEFAULT_VOICE_FILE)
  if (!audio.length || audio.length > MAX_MEDIA_BYTES) fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', '项目默认音色文件无效。')
  return { ...DEFAULT_VOICE_PROFILE, path: DEFAULT_VOICE_FILE, audio }
}

/** Bailian requires the enrolment prefix to be alphanumeric and at most 10 characters. */
function bailianVoicePrefix(reference, cacheKey) {
  return `${reference.id === DEFAULT_VOICE_PROFILE.id ? 'lwbtiffy' : 'lwbvoice'}${cacheKey.slice(0, 2)}`
}

function nested(value, path) {
  let current = value
  for (const key of path) {
    if (!current || typeof current !== 'object') return null
    current = current[key]
  }
  return current
}

function stringAt(value, ...paths) {
  for (const path of paths) {
    const candidate = nested(value, path)
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return null
}

function boundedHttpUrl(value, label) {
  const raw = text(value, label, 4000)
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    fail('SPOKEN_VIDEO_MEDIA_SERVICE_FAILED', `${label}不是有效 URL。`)
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    fail('SPOKEN_VIDEO_MEDIA_SERVICE_FAILED', `${label}不受支持。`)
  }
  return parsed.toString()
}

function srtTime(milliseconds) {
  const total = Math.max(0, Math.round(milliseconds))
  const hours = Math.floor(total / 3_600_000)
  const minutes = Math.floor((total % 3_600_000) / 60_000)
  const seconds = Math.floor((total % 60_000) / 1_000)
  const millis = total % 1_000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`
}

function subtitleReferenceWeight(value) {
  let weight = 0
  for (const character of Array.from(String(value || ''))) {
    if (/\p{L}|\p{N}/u.test(character)) weight += 1
    else if (/\s/u.test(character)) weight += 0.15
    else weight += 0.35
  }
  return weight
}

function referenceBoundary(chars, desired, minimum, maximum) {
  const target = Math.max(minimum, Math.min(maximum, Math.round(desired)))
  const lower = Math.max(minimum, target - 36)
  const upper = Math.min(maximum, target + 36)
  let best = target
  let distance = Number.POSITIVE_INFINITY
  for (let index = lower; index <= upper; index += 1) {
    if (index !== 0 && index !== chars.length && !/[\s，。！？!?；;、：:,\n]/u.test(chars[index - 1])) continue
    const nextDistance = Math.abs(index - target)
    if (nextDistance < distance) { best = index; distance = nextDistance }
  }
  return best
}

/** Keep ASR timing anchors but use the authored script for terminology-safe subtitle text. */
function alignSentencesToReference(sentences, referenceText) {
  const reference = String(referenceText || '').replace(/\s+/gu, ' ').trim()
  const sourceChars = Array.from(reference)
  const usable = (sentences || []).filter((sentence) => sentence && typeof sentence.text === 'string' && sentence.text.trim() && Number.isFinite(sentence.begin) && Number.isFinite(sentence.end))
  if (!sourceChars.length || !usable.length) return sentences
  const sourceWeight = Math.max(1, subtitleReferenceWeight(reference))
  const sourceWeights = []
  let cumulativeSourceWeight = 0
  for (const character of sourceChars) {
    cumulativeSourceWeight += subtitleReferenceWeight(character)
    sourceWeights.push(cumulativeSourceWeight)
  }
  const sentenceWeights = usable.map((sentence) => Math.max(1, subtitleReferenceWeight(sentence.text)))
  const totalWeight = sentenceWeights.reduce((sum, value) => sum + value, 0)
  let consumedWeight = 0
  let sourceStart = 0
  return usable.map((sentence, index) => {
    consumedWeight += sentenceWeights[index]
    const remainingSentences = usable.length - index - 1
    const minimum = sourceStart + 1
    const maximum = Math.max(minimum, sourceChars.length - remainingSentences)
    let sourceEnd = sourceChars.length
    if (index !== usable.length - 1) {
      const desiredWeight = sourceWeight * consumedWeight / totalWeight
      const desired = sourceWeights.findIndex((value) => value >= desiredWeight) + 1
      sourceEnd = referenceBoundary(sourceChars, desired < 1 ? minimum : desired, minimum, maximum)
    }
    const text = sourceChars.slice(sourceStart, sourceEnd).join('').trim()
    sourceStart = sourceEnd
    return { ...sentence, text: text || sentence.text.trim() }
  })
}

function srtFromSentences(sentences) {
  const expanded = []
  for (const sentence of sentences || []) {
    if (!sentence || typeof sentence.text !== 'string' || !sentence.text.trim() || !Number.isFinite(sentence.begin) || !Number.isFinite(sentence.end)) continue
    const source = sentence.text.trim()
    // Realtime ASR returns VAD turns, which can span an entire paragraph. Split
    // locally at punctuation and then enforce video-readable limits.
    const clauses = source.match(/[^。！？!?；;，,、：:]+[。！？!?；;，,、：:]?/gu) || [source]
    const chunks = []
    for (const clause of clauses) {
      const chars = Array.from(clause.trim())
      for (let offset = 0; offset < chars.length; offset += 22) chunks.push(chars.slice(offset, offset + 22).join(''))
    }
    const totalChars = Math.max(1, Array.from(source).length)
    const duration = Math.max(1, sentence.end - sentence.begin)
    let cursor = 0
    for (const chunk of chunks) {
      const start = sentence.begin + Math.round(duration * cursor / totalChars)
      cursor += Array.from(chunk).length
      const end = sentence.begin + Math.round(duration * cursor / totalChars)
      expanded.push({ begin: start, end: Math.max(end, start + 250), text: chunk })
    }
  }
  const rows = expanded
    .filter((sentence) => sentence && typeof sentence.text === 'string' && sentence.text.trim() && Number.isFinite(sentence.begin) && Number.isFinite(sentence.end))
    .sort((left, right) => left.begin - right.begin)
    .map((sentence, index) => `${index + 1}\n${srtTime(sentence.begin)} --> ${srtTime(Math.max(sentence.end, sentence.begin + 250))}\n${sentence.text.trim()}`)
  if (!rows.length) fail('SPOKEN_VIDEO_SUBTITLES_INVALID', '百炼没有返回可用的最终识别结果。')
  return `${rows.join('\n\n')}\n`
}

/** Qwen TTS accepts at most 512 input tokens. Four hundred Unicode code points is intentionally conservative. */
function splitTtsText(value, maximum = 400) {
  const source = text(value, '配音文稿', 60_000)
  const sentences = source.match(/[^。！？!?；;…\n]+[。！？!?；;…]?|\n+/gu) || [source]
  const pieces = []
  let current = ''
  const flush = () => {
    const next = current.trim()
    if (next) pieces.push(next)
    current = ''
  }
  for (const sentence of sentences) {
    const normalized = sentence.trim()
    if (!normalized) continue
    const chars = Array.from(normalized)
    if (chars.length > maximum) {
      flush()
      for (let offset = 0; offset < chars.length; offset += maximum) pieces.push(chars.slice(offset, offset + maximum).join(''))
      continue
    }
    if (current && Array.from(current).length + chars.length > maximum) flush()
    current = `${current}${normalized}`
  }
  flush()
  if (!pieces.length) fail('SPOKEN_VIDEO_MEDIA_INVALID_INPUT', '配音文稿为空。')
  return pieces
}

function wavSizeIsUnbounded(value) {
  // Some Bailian voice-clone WAVs retain a non-final size near the 2 GiB RIFF limit.
  return value === 0xffffffff || value >= 0x7fff0000
}

function wavContainerError(bytes, options = {}) {
  const allowUnboundedSize = options.allowUnboundedSize === true
  if (!Buffer.isBuffer(bytes) || bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    return '返回的不是有效 WAV 音频'
  }
  const riffSize = bytes.readUInt32LE(4)
  if (riffSize !== 0xffffffff && riffSize + 8 > bytes.length && !(allowUnboundedSize && wavSizeIsUnbounded(riffSize))) {
    return `RIFF 声明 ${riffSize + 8} 字节，实际仅下载 ${bytes.length} 字节`
  }
  let offset = 12
  let hasFormat = false
  let hasData = false
  while (offset + 8 <= bytes.length) {
    const name = bytes.toString('ascii', offset, offset + 4)
    const size = bytes.readUInt32LE(offset + 4)
    const content = offset + 8
    const end = content + size
    if (end > bytes.length) {
      if (allowUnboundedSize && name === 'data' && wavSizeIsUnbounded(size) && content < bytes.length) {
        hasData = true
        break
      }
      return `${name.trim() || '未知'} 块声明 ${size} 字节，但文件在第 ${bytes.length} 字节结束`
    }
    if (name === 'fmt ' && size >= 16) hasFormat = true
    if (name === 'data' && size > 0) hasData = true
    offset = end + (size % 2)
  }
  if (!hasFormat) return '缺少有效的 fmt 格式块'
  if (!hasData) return '缺少非空的 data 音频块'
  return null
}

function repairUnboundedWavHeader(bytes) {
  const repaired = Buffer.from(bytes)
  const actualRiffSize = repaired.length - 8
  if (wavSizeIsUnbounded(repaired.readUInt32LE(4))) repaired.writeUInt32LE(actualRiffSize, 4)
  let offset = 12
  while (offset + 8 <= repaired.length) {
    const name = repaired.toString('ascii', offset, offset + 4)
    const size = repaired.readUInt32LE(offset + 4)
    const content = offset + 8
    const end = content + size
    if (end > repaired.length) {
      if (name === 'data' && wavSizeIsUnbounded(size) && content < repaired.length) {
        repaired.writeUInt32LE(repaired.length - content, offset + 4)
      }
      break
    }
    offset = end + (size % 2)
  }
  return repaired
}

function ffmpegConcatEntry(file) {
  return `file '${file.replace(/'/gu, "'\\''")}'`
}

function sendSocket(socket, data, options) {
  return new Promise((resolvePromise, reject) => {
    socket.send(data, options, (error) => error ? reject(error) : resolvePromise())
  })
}

async function sendRealtimePcm(socket, stream, failure) {
  let pending = Buffer.alloc(0)
  let nextSendAt = Date.now()
  const send = async (chunk) => {
    const wait = nextSendAt - Date.now()
    if (wait > 0) await Promise.race([delay(wait), failure])
    await Promise.race([
      sendSocket(socket, JSON.stringify({ type: 'input_audio_buffer.append', event_id: randomUUID(), audio: chunk.toString('base64') })),
      failure,
    ])
    nextSendAt = Math.max(nextSendAt + BAILIAN_ASR_CHUNK_MS, Date.now())
  }
  for await (const chunk of stream) {
    pending = pending.length ? Buffer.concat([pending, chunk]) : Buffer.from(chunk)
    while (pending.length >= BAILIAN_ASR_CHUNK_BYTES) {
      await send(pending.subarray(0, BAILIAN_ASR_CHUNK_BYTES))
      pending = pending.subarray(BAILIAN_ASR_CHUNK_BYTES)
    }
  }
  if (pending.length) await send(pending)
}

function closeSocket(socket) {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve()
  return new Promise((resolvePromise) => {
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolvePromise()
    }
    const timeout = setTimeout(() => {
      socket.terminate()
      done()
    }, 2_000)
    socket.once('close', done)
    socket.close()
  })
}

function waitForChild(child, label) {
  return new Promise((resolvePromise, reject) => {
    let stderr = ''
    let failure
    child.stderr?.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-2000) })
    child.once('error', (error) => { failure = commandError(error, label) })
    child.once('close', (code) => {
      if (failure) reject(failure)
      else if (code === 0) resolvePromise()
      else reject(new SpokenVideoMediaError('SPOKEN_VIDEO_MEDIA_COMMAND_FAILED', `${label}失败：${stderr.trim() || `退出码 ${code}`}`))
    })
  })
}

function commandError(error, label) {
  const detail = typeof error?.stderr === 'string' ? error.stderr.trim().slice(-900) : error?.message || String(error)
  return new SpokenVideoMediaError('SPOKEN_VIDEO_MEDIA_COMMAND_FAILED', `${label}失败：${detail}`)
}

function ffmpegSubtitleFilter(file) {
  const escaped = file.replace(/\\/gu, '\\\\').replace(/:/gu, '\\:').replace(/'/gu, "\\'")
  return `subtitles=filename='${escaped}':force_style='FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00131F32,BorderStyle=1,Outline=3,Shadow=0,Alignment=2,MarginV=180'`
}

function portableRelative(root, file) {
  return relative(root, file).split(sep).join('/')
}

function reviewTimestamps(durationSeconds) {
  const duration = Math.max(0.2, Number(durationSeconds) || 0.2)
  const end = Math.max(0.05, duration - Math.min(0.12, duration * 0.05))
  const factors = duration < 2 ? [0.08, 0.32, 0.58, 0.86] : [0.03, 0.2, 0.4, 0.6, 0.8, 0.97]
  return [...new Set(factors.map((factor) => Math.min(end, Math.max(0, duration * factor)).toFixed(3)))].map(Number)
}

async function extractVideoReviewFrames(videoPath, outputDir, durationSeconds, signal) {
  await mkdir(outputDir, { recursive: true, mode: 0o700 })
  const timestamps = reviewTimestamps(durationSeconds)
  const frameFiles = timestamps.map((_, index) => join(outputDir, `frame-${String(index + 1).padStart(2, '0')}.png`))
  const results = await Promise.allSettled(frameFiles.map(async (file, index) => {
    try {
      await execFileAsync('ffmpeg', ['-v', 'error', '-y', '-ss', String(timestamps[index]), '-i', videoPath, '-frames:v', '1', file], { signal, maxBuffer: 1024 * 1024 * 4 })
      const info = await stat(file)
      if (!info.isFile() || info.size < 256) throw new Error('抽帧文件为空')
    } catch (error) {
      throw commandError(error, `成片抽帧（${timestamps[index]} 秒）`)
    }
  }))
  const failure = results.find((result) => result.status === 'rejected')
  if (failure) throw failure.reason
  return { timestamps, frameFiles }
}

async function normalizedMainFrame(file, orientation, signal) {
  const crop = orientation === 'landscape' ? 'crop=iw:ih*0.80:0:0' : 'crop=iw*0.88:ih*0.70:0:0'
  try {
    const { stdout } = await execFileAsync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `${crop},scale=96:96,format=gray`, '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'], { signal, encoding: 'buffer', maxBuffer: 1024 * 1024 })
    return Buffer.from(stdout)
  } catch (error) {
    throw commandError(error, '主画面变化检测')
  }
}

function frameDifference(left, right) {
  const length = Math.min(left.length, right.length)
  if (!length) return 0
  let difference = 0
  for (let index = 0; index < length; index += 1) difference += Math.abs(left[index] - right[index])
  return difference / length
}

async function measureVisualVariation(frameFiles, orientation, durationSeconds, signal) {
  const frames = await Promise.all(frameFiles.map((file) => normalizedMainFrame(file, orientation, signal)))
  const pairDifferences = frames.slice(1).map((frame, index) => Number(frameDifference(frames[index], frame).toFixed(3)))
  const hashes = new Set(frames.map((frame) => createHash('sha256').update(frame).digest('hex')))
  const meaningfulPairs = pairDifferences.filter((value) => value >= 1.5).length
  const averagePairDifference = pairDifferences.length ? pairDifferences.reduce((sum, value) => sum + value, 0) / pairDifferences.length : 0
  const assessed = Number(durationSeconds) >= 4
  const passed = !assessed || (hashes.size >= Math.min(3, frames.length) && (meaningfulPairs >= 2 || averagePairDifference >= 4))
  return {
    assessed,
    passed,
    sampledFrameCount: frames.length,
    distinctMainFrames: hashes.size,
    meaningfulPairs,
    averagePairDifference: Number(averagePairDifference.toFixed(3)),
    pairDifferences,
    crop: orientation === 'landscape' ? 'top 80%' : 'left 88%, top 70%',
    ...(assessed ? {} : { note: '成片短于 4 秒，仅记录变化数据，不启用变化阈值。' }),
  }
}

/**
 * Host-side media adapter. It owns provider calls and local binaries; the browser
 * only sees durable operation summaries and bounded media reads through the gateway.
 */
export class SpokenVideoMediaHost {
  constructor({ background = (work) => work, signal, projectsStore, credentials, account, connectionSettings, videoCreator, videoReviewer, fetch = globalThis.fetch, environment = process.env } = {}) {
    if (!projectsStore) throw new Error('SpokenVideoMediaHost requires projectsStore.')
    this.background = background
    this.signal = signal
    this.projectsStore = projectsStore
    this.account = account
    this.credentials = credentials || null
    this.connectionSettings = connectionSettings || null
    this.videoCreator = typeof videoCreator === 'function' ? videoCreator : null
    this.videoReviewer = typeof videoReviewer === 'function' ? videoReviewer : null
    this.fetch = fetch
    this.environment = environment
    this.queues = new Map()
    this.runSecrets = new Map()
    this.activeRunIds = new Set()
    this.bailianReferenceVoices = new Map()
    this.bailianReferenceVoiceEnrollments = new Map()
    this.audioTaskWrites = new Map()
    this.runWrites = new Map()
    this.activeAudioTaskRuns = new Set()
  }

  async status() {
    const config = mediaServiceConfig(this.environment)
    const connection = await this.connection()
    const referenceVoiceConfigured = await defaultVoiceReference().then(() => true).catch(() => false)
    const remotionAvailable = await remotionRendererAvailable()
    return {
      ttsConfigured: true,
      ttsEndpoint: config.baseUrl ? new URL(config.baseUrl).origin : null,
      defaultVoice: { id: DEFAULT_VOICE_PROFILE.id, name: DEFAULT_VOICE_PROFILE.name },
      providers: {
        bailian: { configured: true, referenceVoiceConfigured, label: '使用自己的百炼账户', credential: connection.providers.bailian },
        lwb: { configured: connection.providers.lwb.configured, referenceVoiceConfigured, label: 'LWB 账号', credential: connection.providers.lwb },
        legacy: { configured: config.configured, referenceVoiceConfigured: false, label: '兼容 TTS 服务' },
      },
      connection,
      renderer: 'remotion',
      renderers: { remotion: remotionAvailable, 'local-ffmpeg': true },
      mediaReadLimitBytes: MAX_MEDIA_BYTES,
      voiceReferenceMaxBytes: MAX_VOICE_REFERENCE_BYTES,
      videoBgmMaxBytes: MAX_VIDEO_BGM_BYTES,
    }
  }

  async connection() {
    const provider = this.connectionSettings?.get?.().provider || 'lwb'
    return {
      provider,
      providers: {
        bailian: await this.#credentialStatus('bailian'),
        lwb: await this.#accountStatus('tts'),
      },
    }
  }

  /**
   * The saved media connection preference, i.e. the source the audio page
   * persists. Unattended rounds read it so an automation picks up whatever the
   * user last chose, instead of the normalizer's hard default.
   */
  async preferredProvider() {
    return (await this.connection()).provider
  }

  async configureConnection(request) {
    const input = object(request, '连接设置')
    const provider = String(input.provider).trim().toLowerCase()
    const ref = provider === 'lwb' ? null : mediaCredentialRef(provider)
    if (provider === 'lwb' && input.apiKey) fail('SPOKEN_VIDEO_MEDIA_INVALID_INPUT', 'LWB 服务使用已登录账号，无需填写 API Key。')
    const apiKey = input.apiKey === undefined || input.apiKey === null || (typeof input.apiKey === 'string' && !input.apiKey.trim())
      ? null
      : text(input.apiKey, 'API Key', 512)
    if (!this.connectionSettings?.update) fail('SPOKEN_VIDEO_MEDIA_CONNECTION_UNAVAILABLE', '当前运行环境不支持保存连接设置。')
    if (apiKey && ref) await this.#credentials().set(ref, apiKey)
    await this.connectionSettings.update({ provider })
    return this.connection()
  }

  async clearConnectionCredential(request) {
    const input = object(request, '连接设置')
    const ref = mediaCredentialRef(input.provider)
    await this.#credentials().unset(ref)
    return this.connection()
  }

  async uploadVoiceReference(agent, request) {
    const input = object(request, '参考音频上传请求')
    const format = voiceReferenceFormat(input.name, input.mediaType)
    const audio = decodeVoiceReference(input.data)
    const root = await audioTasksRootFor(agent)
    const id = requestId()
    const file = `voice-references/${id}.${format.extension}`
    const target = await safeMediaTarget(root, file, '参考音频', true)
    try {
      await writeFile(target, audio, { mode: 0o600, flag: 'wx' })
      let probe
      try { probe = await this.#probe(target) }
      catch { fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', '上传的参考音频无法解码。') }
      if (!probe.hasAudio || !probe.durationSeconds || probe.videoCodec) {
        fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', '上传的文件不是可播放的纯音频。')
      }
      return {
        id,
        file,
        name: format.originalName,
        mediaType: format.mediaType,
        bytes: audio.length,
        durationSeconds: probe.durationSeconds,
      }
    } catch (error) {
      await unlink(target).catch(() => {})
      throw error
    }
  }

  async uploadVideoBgm(agent, request) {
    const input = object(request, '背景音乐上传请求')
    const id = projectId(input.projectId)
    const format = videoBgmFormat(input.name, input.mediaType)
    const audio = decodeVideoBgm(input.data)
    const root = await projectRootFor(agent, id)
    const uploadId = requestId()
    const file = `media/bgm-uploads/${uploadId}.${format.extension}`
    const target = await safeMediaTarget(root, file, '背景音乐', true)
    try {
      await writeFile(target, audio, { mode: 0o600, flag: 'wx' })
      let probe
      try { probe = await this.#probe(target) }
      catch { fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', '上传的背景音乐无法解码。') }
      if (!probe.hasAudio || !probe.durationSeconds || probe.videoCodec) {
        fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', '上传的文件不是可播放的纯音频。')
      }
      return {
        id: uploadId,
        file,
        name: format.originalName,
        mediaType: format.mediaType,
        bytes: audio.length,
        durationSeconds: probe.durationSeconds,
      }
    } catch (error) {
      await unlink(target).catch(() => {})
      throw error
    }
  }

  async operations(agent, request) {
    const id = projectId(object(request, '媒体任务请求').projectId)
    const root = await projectRootFor(agent, id)
    const runs = await this.#recoverInterruptedRuns(root)
    return runs.runs.map(runSummary).sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
  }

  /** A compact cross-project media feed for the audio/caption workbench. */
  async listTasks(agent) {
    const projects = await this.projectsStore.list(agent)
    const taskGroups = await Promise.all(projects.map(async (project) => {
      const root = await projectRootFor(agent, project.id)
      const runs = await this.#recoverInterruptedRuns(root)
      return runs.runs.map((run) => ({ ...runSummary(run), projectTitle: project.title }))
    }))
    return taskGroups.flat()
      .filter((task) => task.type === 'voiceover' || task.type === 'subtitles')
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .slice(0, 120)
  }

  /**
   * Video workbench feed. A row represents one render submission, rather than
   * the project's mutable video stage, so history, retries, and previews are
   * all attached to a durable task.
   */
  async listVideoTasks(agent, request = {}) {
    const input = object(request, '视频任务列表请求')
    const query = typeof input.query === 'string' ? input.query.trim().toLowerCase() : ''
    const status = typeof input.status === 'string' && ['all', 'active', 'terminal', 'queued', 'running', 'succeeded', 'failed'].includes(input.status) ? input.status : 'all'
    const accountId = typeof input.accountId === 'string' && input.accountId.trim() ? projectId(input.accountId) : null
    const generalOnly = input.general === true
    const offset = Number.isSafeInteger(input.offset) && input.offset >= 0 ? input.offset : 0
    const limit = Number.isSafeInteger(input.limit) && input.limit >= 1 && input.limit <= 50 ? input.limit : 6
    const projects = await this.projectsStore.list(agent)
    const groups = await Promise.all(projects.map(async (project) => {
      const root = await projectRootFor(agent, project.id)
      const runs = await this.#recoverInterruptedRuns(root)
      const qualityByVideoTaskId = new Map(runs.runs
        .filter((run) => run.type === 'qc' && typeof run.input?.videoTaskId === 'string')
        .map((run) => [run.input.videoTaskId, runSummary(run)]))
      return runs.runs
        .filter((run) => run.type === 'video')
        .map((run) => {
          const integratedQc = run.result?.qc && typeof run.result.qc === 'object' ? {
            id: `${run.id}-integrated-qc`, type: 'qc', status: run.result.qc.passed === true ? 'succeeded' : 'failed',
            createdAt: run.completedAt || run.createdAt, completedAt: run.completedAt || null, result: run.result.qc,
          } : null
          return { ...runSummary(run), projectTitle: project.title, account: project.account || null, projectRevision: project.revision, qc: qualityByVideoTaskId.get(run.id) || integratedQc }
        })
    }))
    const all = groups.flat()
    const scoped = all
      .filter((task) => !accountId || task.account?.id === accountId)
      .filter((task) => !generalOnly || !task.account)
    const filtered = scoped
      .filter((task) => status === 'all' || (status === 'active' ? ['queued', 'running'].includes(task.status) : status === 'terminal' ? ['succeeded', 'failed'].includes(task.status) : task.status === status))
      .filter((task) => !query || `${task.projectTitle}\n${task.source?.script?.body || ''}\n${task.input?.visualBrief || ''}`.toLowerCase().includes(query))
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    return {
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
      counts: {
        all: scoped.length,
        queued: scoped.filter((task) => task.status === 'queued').length,
        running: scoped.filter((task) => task.status === 'running').length,
        succeeded: scoped.filter((task) => task.status === 'succeeded').length,
        failed: scoped.filter((task) => task.status === 'failed').length,
      },
    }
  }

  async listAudioTasks(agent, request = {}) {
    const input = object(request, '音频任务列表请求')
    const accountId = typeof input.accountId === 'string' && input.accountId.trim() ? projectId(input.accountId) : null
    const generalOnly = input.general === true
    const root = await audioTasksRootFor(agent)
    const tasks = await readAudioTasks(root)
    const query = typeof input.query === 'string' ? input.query.trim().toLowerCase() : ''
    const status = typeof input.status === 'string' && ['all', 'active', 'terminal', 'queued', 'running', 'succeeded', 'failed'].includes(input.status) ? input.status : 'all'
    const provider = typeof input.provider === 'string' && ['all', 'bailian', 'lwb', 'legacy'].includes(input.provider) ? input.provider : 'all'
    const recovered = await this.#recoverInterruptedAudioTasks(root, tasks)
    const projects = await this.projectsStore.list(agent)
    const projectTasks = (await Promise.all(projects.map((project) => this.#projectAudioTasks(agent, project.id)))).flatMap((entry) => entry.tasks)
    const standaloneIds = new Set(recovered.tasks.map((task) => task.id))
    const allTasks = [...recovered.tasks, ...projectTasks.filter((task) => !standaloneIds.has(task.id))]
    const accountsByProject = new Map(projects.map((project) => [project.id, project.account?.id || null]))
    const scoped = allTasks.filter((task) => {
      const taskAccountId = accountsByProject.get(task.source?.projectId) || null
      return (!accountId || taskAccountId === accountId) && (!generalOnly || !taskAccountId)
    })
    const filtered = scoped
      .filter((task) => status === 'all' || (status === 'active' ? ['queued', 'running'].includes(task.status) : status === 'terminal' ? ['succeeded', 'failed'].includes(task.status) : task.status === status))
      .filter((task) => provider === 'all' || task.input?.provider === provider)
      .filter((task) => !query || `${task.source?.title || ''}\n${task.source?.text || ''}`.toLowerCase().includes(query))
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    const offset = Number.isSafeInteger(input.offset) && input.offset >= 0 ? input.offset : 0
    const limit = Number.isSafeInteger(input.limit) && input.limit >= 1 && input.limit <= 50 ? input.limit : 8
    return {
      items: filtered.slice(offset, offset + limit).map(audioTaskSummary),
      total: filtered.length,
      counts: {
        all: scoped.length,
        queued: scoped.filter((task) => task.status === 'queued').length,
        running: scoped.filter((task) => task.status === 'running').length,
        succeeded: scoped.filter((task) => task.status === 'succeeded').length,
        failed: scoped.filter((task) => task.status === 'failed').length,
      },
    }
  }

  async audioTask(agent, request) {
    const id = text(object(request, '读取音频任务请求').taskId, '音频任务标识', 64)
    const root = await audioTasksRootFor(agent)
    const task = (await this.#recoverInterruptedAudioTasks(root)).tasks.find((item) => item.id === id)
    return audioTaskSummary(task || (await this.#findProjectAudioTask(agent, id)).task)
  }

  async #projectAudioTasks(agent, id) {
    const root = await projectRootFor(agent, id)
    const runs = (await this.#recoverInterruptedRuns(root)).runs
    if (!runs.some((run) => run.type === 'voiceover')) return { root, tasks: [] }
    const context = { workspacePath: await workspaceFor(agent) }
    for (const run of runs.filter((item) => ['voiceover', 'subtitles'].includes(item.type))) {
      const data = await mediaRunArtifact(context, run, id)
      if (data) run.result.artifact = { ...run.result.artifact, data }
    }
    const detail = await this.projectsStore.get(agent, { projectId: id })
    return { root, detail, tasks: projectAudioTasks(detail, runs) }
  }

  async #findProjectAudioTask(agent, taskId) {
    for (const project of await this.projectsStore.list(agent)) {
      const entry = await this.#projectAudioTasks(agent, project.id)
      const task = entry.tasks.find((item) => item.id === taskId)
      if (task) return { ...entry, task }
    }
    fail('SPOKEN_VIDEO_NOT_FOUND', '音频任务不存在。')
  }

  #requireCurrentProjectAudio(task) {
    if (task.status !== 'succeeded' || !task.result?.audio?.file) fail('SPOKEN_VIDEO_STAGE_BLOCKED', '请先完成配音。')
    if (!task.current) fail('SPOKEN_VIDEO_REVISION_CONFLICT', '该配音已是历史版本，可试听和查看字幕；请在当前配音上修改或重新生成字幕。')
  }

  async startAudioTask(agent, request) {
    const input = object(request, '新建配音任务请求')
    const textSnapshot = text(input.text, '文本内容', 60_000)
    const sourceProjectId = typeof input.sourceProjectId === 'string' && input.sourceProjectId.trim() ? projectId(input.sourceProjectId) : null
    let source = { kind: 'manual-text', projectId: null, projectTitle: null, title: typeof input.title === 'string' && input.title.trim() ? text(input.title, '文稿标题', 160) : '手动输入文稿', text: textSnapshot }
    let project = null
    if (sourceProjectId) {
      project = await this.projectsStore.get(agent, { projectId: sourceProjectId })
      const scriptBody = project.artifacts?.script?.data?.body
      if (typeof scriptBody !== 'string' || !scriptBody.trim()) fail('SPOKEN_VIDEO_STAGE_BLOCKED', '所选项目没有可用稿件，不能载入配音。')
      source = { kind: scriptBody.trim() === textSnapshot.trim() ? 'saved-script' : 'edited-script-copy', projectId: project.id, projectTitle: project.title, title: project.title, text: textSnapshot, scriptRevision: project.artifacts.script.revision }
    }
    if (input.subtitleEnabled != null && typeof input.subtitleEnabled !== 'boolean') fail('SPOKEN_VIDEO_MEDIA_INVALID_INPUT', '生成字幕开关必须是布尔值。')
    let data = await this.#bindAccount({ ...normalizeVoiceoverRequest(input), subtitleEnabled: input.subtitleEnabled !== false }, 'tts')
    const root = await audioTasksRootFor(agent)
    const now = new Date().toISOString()
    const id = requestId()
    if (data.voiceSource === 'upload') {
      data = { ...data, referenceAudio: await this.#freezeVoiceReference(root, id, data.referenceAudio) }
    }
    const task = { id, type: 'voiceover', status: 'queued', createdAt: now, source, input: data, projectRevision: project?.revision || null, subtitle: { status: 'idle' } }
    await this.#mutateAudioTaskFile(root, (file) => ({ ...file, tasks: [...file.tasks, task].slice(-AUDIO_TASK_LIMIT) }))
    this.activeAudioTaskRuns.add(`${task.id}:voiceover`)
    void this.background(this.#runAudioTask(agent, root, task.id).finally(() => this.activeAudioTaskRuns.delete(`${task.id}:voiceover`)))
    return audioTaskSummary(task)
  }

  /** Reuse completed local media; never calls a model or media provider. */
  async syncAudioTask(agent, request) {
    const id = text(object(request, '同步配音结果请求').taskId, '音频任务标识', 64)
    const root = await audioTasksRootFor(agent)
    const task = (await readAudioTasks(root)).tasks.find((item) => item.id === id)
    if (!task) {
      const project = await this.#findProjectAudioTask(agent, id)
      this.#requireCurrentProjectAudio(project.task)
      return audioTaskSummary(project.task)
    }
    if (task.status !== 'succeeded' || !task.result?.audio?.file) fail('SPOKEN_VIDEO_STAGE_BLOCKED', '请先完成配音。')
    if (['queued', 'running'].includes(task.subtitle?.status)) fail('SPOKEN_VIDEO_STAGE_BLOCKED', '字幕仍在生成，请完成后再同步。')
    const synced = await this.#syncAudioTaskProject(agent, task)
    if (synced) await this.#syncAudioTaskSubtitles(agent, synced)
    return this.audioTask(agent, { taskId: id })
  }

  async startAudioTaskSubtitles(agent, request) {
    const input = object(request, '生成字幕请求')
    const taskId = text(input.taskId, '音频任务标识', 64)
    const data = await this.#bindAccount(normalizeSubtitleRequest(input), 'subtitle', input.lwbUserId)
    const root = await audioTasksRootFor(agent)
    const current = (await this.#recoverInterruptedAudioTasks(root)).tasks.find((task) => task.id === taskId)
    if (!current) {
      const project = await this.#findProjectAudioTask(agent, taskId)
      this.#requireCurrentProjectAudio(project.task)
      if (!['queued', 'running'].includes(project.task.subtitle?.status)) {
        await this.startSubtitles(agent, { ...input, projectId: project.detail.id, expectedRevision: project.detail.revision })
      }
      return this.audioTask(agent, { taskId })
    }
    if (current.status !== 'succeeded' || !current.result?.audio?.file) fail('SPOKEN_VIDEO_STAGE_BLOCKED', '请等待配音生成完成后再生成字幕。')
    if (current.subtitle?.status === 'queued' || current.subtitle?.status === 'running') return audioTaskSummary(current)
    const subtitleId = requestId()
    const started = await this.#mutateAudioTask(root, taskId, (task) => ({
      ...task,
      subtitle: { ...(task.subtitle || {}), id: subtitleId, status: 'queued', createdAt: new Date().toISOString(), startedAt: null, completedAt: null, error: null, input: data },
    }))
    this.activeAudioTaskRuns.add(`${taskId}:subtitles`)
    void this.background(this.#runAudioTaskSubtitles(agent, root, taskId, subtitleId).finally(() => this.activeAudioTaskRuns.delete(`${taskId}:subtitles`)))
    return audioTaskSummary(started)
  }

  async saveAudioTaskSubtitles(agent, request) {
    const input = object(request, '保存字幕请求')
    const taskId = text(input.taskId, '音频任务标识', 64)
    const rawSrt = text(input.srt, '字幕内容', 30_000, { trim: false })
    const checked = subtitleResult({ subtitle_srt: rawSrt })
    const srt = checked.srt
    const root = await audioTasksRootFor(agent)
    const current = (await this.#recoverInterruptedAudioTasks(root)).tasks.find((task) => task.id === taskId)
    if (!current) {
      const project = await this.#findProjectAudioTask(agent, taskId)
      this.#requireCurrentProjectAudio(project.task)
      if (['queued', 'running'].includes(project.task.subtitle?.status)) fail('SPOKEN_VIDEO_STAGE_BLOCKED', '字幕仍在生成，请完成后再校对。')
      const versionId = requestId()
      const file = `media/subtitles/${taskId}-${versionId}.srt`
      await this.#write(project.root, file, srt)
      await this.projectsStore.commitProduced(agent, {
        projectId: project.detail.id, expectedRevision: project.detail.revision, stage: 'subtitles',
        idempotencyKey: `audio-edit-${versionId}`, source: 'spoken-video/subtitle-editor',
        payload: { mode: 'manual', sourceAudioFile: project.task.result.audio.file, srtFile: file, srt, cueCount: checked.cueCount },
      })
      await this.#mutateRun(project.root, taskId, (run) => ({ ...run, subtitle: {
        ...project.task.subtitle, status: 'succeeded', id: versionId, completedAt: new Date().toISOString(), error: null,
        baseRunId: project.task.subtitleExecution?.id || null,
        current: { id: versionId, file, srt, cueCount: checked.cueCount, mode: 'manual', createdAt: new Date().toISOString() },
      } }))
      return this.audioTask(agent, { taskId })
    }
    if (!current.result?.audio?.file) fail('SPOKEN_VIDEO_STAGE_BLOCKED', '当前音频任务没有可用音频。')
    const versionId = requestId()
    const file = `audio-media/subtitles/${taskId}-${versionId}.srt`
    await this.#writeAudioTaskFile(root, file, srt)
    const updated = await this.#mutateAudioTask(root, taskId, (task) => ({
      ...task,
      subtitle: {
        ...(task.subtitle || {}), status: 'succeeded', id: versionId, completedAt: new Date().toISOString(), error: null,
        current: { id: versionId, file, srt, cueCount: checked.cueCount, mode: 'manual', createdAt: new Date().toISOString() },
      },
    }))
    await this.#syncAudioTaskSubtitles(agent, updated)
    return this.audioTask(agent, { taskId })
  }

  async readAudioTaskMedia(agent, request) {
    const input = object(request, '读取音频任务媒体请求')
    const taskId = text(input.taskId, '音频任务标识', 64)
    const root = await audioTasksRootFor(agent)
    let task = (await this.#recoverInterruptedAudioTasks(root)).tasks.find((item) => item.id === taskId)
    const project = task ? null : await this.#findProjectAudioTask(agent, taskId)
    task ||= project.task
    if (!task?.result?.audio?.file || !task.result.audio.mediaType) fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', '当前音频任务没有可预览媒体。')
    const file = project ? await this.#file(project.root, task.result.audio.file, '音频任务媒体') : await this.#audioTaskFile(root, task.result.audio.file, '音频任务媒体')
    const info = await stat(file)
    if (info.size > MAX_MEDIA_BYTES) fail('SPOKEN_VIDEO_MEDIA_FILE_TOO_LARGE', '媒体文件超过浏览器预览的 80 MiB 限制。')
    return { file: task.result.audio.file, mediaType: task.result.audio.mediaType, bytes: info.size, data: (await readFile(file)).toString('base64') }
  }

  async readVideoTaskMedia(agent, request) {
    const input = object(request, '读取视频任务媒体请求')
    const id = projectId(input.projectId)
    const taskId = text(input.taskId, '视频任务标识', 64)
    const stage = text(input.stage, '视频任务媒体阶段', 20)
    if (!['voiceover', 'bgm', 'video'].includes(stage)) fail('SPOKEN_VIDEO_MEDIA_INVALID_INPUT', '只可读取任务配音、背景音乐或成片预览。')
    const root = await projectRootFor(agent, id)
    const run = (await this.#recoverInterruptedRuns(root)).runs.find((item) => item.id === taskId && item.type === 'video')
    if (!run) fail('SPOKEN_VIDEO_NOT_FOUND', '视频任务不存在。')
    const descriptor = stage === 'voiceover'
      ? run.source?.voiceover?.audio
      : stage === 'bgm'
        ? run.input?.backgroundMusic
        : run.status === 'succeeded' ? { ...(run.result?.video || {}), mediaType: 'video/mp4' } : null
    if (!descriptor?.file || !descriptor?.mediaType) fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', '该视频任务没有可预览的媒体。')
    const file = await this.#file(root, descriptor.file, '视频任务媒体')
    const info = await stat(file)
    if (info.size > MAX_MEDIA_BYTES) fail('SPOKEN_VIDEO_MEDIA_FILE_TOO_LARGE', '媒体文件超过浏览器预览的 80 MiB 限制。')
    return { file: descriptor.file, mediaType: descriptor.mediaType, bytes: info.size, data: (await readFile(file)).toString('base64') }
  }

  async startVoiceover(agent, request) {
    return this.#start(agent, 'voiceover', request, (input) => normalizeVoiceoverRequest(input))
  }

  async startSubtitles(agent, request) {
    return this.#start(agent, 'subtitles', request, (input) => normalizeSubtitleRequest(input))
  }

  async startVideoRender(agent, request) {
    return this.#start(agent, 'video', request, async (input, { root }) => {
      const data = normalizeRenderRequest(input)
      if (data.backgroundMusic) await this.#videoBgm(root, data.backgroundMusic)
      return data
    })
  }

  async startTechnicalQc(agent, request) {
    return this.#start(agent, 'qc', request, (input) => ({
      videoTaskId: input.videoTaskId === undefined || input.videoTaskId === null || !String(input.videoTaskId).trim()
        ? null
        : text(input.videoTaskId, '视频任务标识', 64),
    }))
  }

  async #start(agent, type, request, parseInput) {
    const input = object(request, '媒体任务请求')
    const id = projectId(input.projectId)
    const revision = expectedRevision(input.expectedRevision)
    const root = await projectRootFor(agent, id)
    const detail = await this.projectsStore.get(agent, { projectId: id })
    if (detail.revision !== revision) fail('SPOKEN_VIDEO_REVISION_CONFLICT', '项目已被其他操作更新，请刷新后重试。')
    const data = await this.#bindAccount(await parseInput(input, { root, detail }), type === 'voiceover' ? 'tts' : 'subtitle', input.lwbUserId)
    const runs = await readRuns(root)
    const active = runs.runs.find((run) => run.type === type && ['queued', 'running'].includes(run.status) && run.expectedRevision === revision && (type !== 'video' || (
      (run.input?.orientation === 'landscape' ? 'landscape' : 'portrait') === data.orientation
      && run.input?.renderer === data.renderer
      && (run.input?.subtitleEnabled !== false) === data.subtitleEnabled
      && (run.input?.backgroundMusic?.file || null) === (data.backgroundMusic?.file || null)
      && (run.input?.bgmVolume ?? null) === data.bgmVolume
      && run.input?.visualBrief === data.visualBrief
    )))
    if (active) return { ...runSummary(active), reused: true }
    const now = new Date().toISOString()
    const run = {
      id: requestId(), type, status: 'queued', projectId: id, expectedRevision: revision, createdAt: now, input: data,
      source: videoSourceSnapshot(detail, data.subtitleEnabled),
    }
    runs.runs = [...runs.runs, run].slice(-80)
    await writeRuns(root, runs)
    // Mark before scheduling so an immediate status poll cannot mistake this process for a restart.
    this.activeRunIds.add(run.id)
    const queueKey = `${root}\u0000${type}`
    const previous = this.queues.get(queueKey) || Promise.resolve()
    const work = this.background(previous.then(() => this.#run(agent, root, run)).catch(() => {}))
    this.queues.set(queueKey, work)
    void work.finally(() => {
      this.activeRunIds.delete(run.id)
      if (this.queues.get(queueKey) === work) this.queues.delete(queueKey)
    })
    return { ...runSummary(run), reused: false }
  }

  async #mutateAudioTaskFile(root, mutate) {
    const previous = this.audioTaskWrites.get(root) || Promise.resolve()
    const result = previous.then(async () => {
      const file = await readAudioTasks(root)
      const next = audioTasksFile(mutate(file))
      await writeAudioTasks(root, next)
      return next
    })
    const tail = result.catch(() => {})
    this.audioTaskWrites.set(root, tail)
    try { return await result } finally { if (this.audioTaskWrites.get(root) === tail) this.audioTaskWrites.delete(root) }
  }

  async #mutateAudioTask(root, taskId, mutate) {
    let changed = null
    await this.#mutateAudioTaskFile(root, (file) => {
      const index = file.tasks.findIndex((task) => task.id === taskId)
      if (index < 0) fail('SPOKEN_VIDEO_NOT_FOUND', '音频任务不存在。')
      const before = structuredClone(file.tasks[index])
      const task = mutate(file.tasks[index])
      executionTransition(before, task, '配音服务')
      changed = task
      const tasks = [...file.tasks]
      tasks[index] = task
      return { ...file, tasks }
    })
    return changed
  }

  async #recoverInterruptedAudioTasks(root, tasks = null) {
    const file = tasks || await readAudioTasks(root)
    let changed = false
    const recovered = file.tasks.map((task) => {
      let next = task
      if (['queued', 'running'].includes(task.status) && !this.activeAudioTaskRuns.has(`${task.id}:voiceover`)) {
        changed = true
        next = { ...next, status: 'failed', completedAt: new Date().toISOString(), error: '媒体主机在任务完成前已重启。请重新提交配音任务。' }
      }
      if (['queued', 'running'].includes(next.subtitle?.status) && !this.activeAudioTaskRuns.has(`${task.id}:subtitles`)) {
        changed = true
        next = { ...next, subtitle: { ...next.subtitle, status: 'failed', completedAt: new Date().toISOString(), error: '媒体主机在字幕完成前已重启。请重新生成字幕。' } }
      }
      return next
    })
    if (!changed) return file
    const next = { ...file, tasks: recovered }
    await writeAudioTasks(root, next)
    return next
  }

  async #uploadedVoiceReference(root, reference, pattern, label) {
    const input = object(reference, label)
    const file = text(input.file, `${label}文件`, 280)
    if (!pattern.test(file)) fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', `${label}引用无效。`)
    const format = voiceReferenceFormat(input.name, input.mediaType)
    if (extname(file).slice(1).toLowerCase() !== format.extension) fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', `${label}引用与文件类型不一致。`)
    const target = await safeMediaTarget(root, file, label)
    const info = await lstat(target).catch(() => null)
    if (!info?.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > MAX_VOICE_REFERENCE_BYTES) {
      fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', `${label}不存在、无效或超过 20 MiB。`)
    }
    const audio = await readFile(target)
    let probe
    try { probe = await this.#probe(target) }
    catch { fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', `${label}无法解码。`) }
    if (!probe.hasAudio || !probe.durationSeconds || probe.videoCodec) fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', `${label}不是可播放的纯音频。`)
    return {
      id: text(input.id, `${label}标识`, 64),
      file,
      path: target,
      name: format.originalName,
      mediaType: format.mediaType,
      audio,
    }
  }

  async #freezeVoiceReference(root, taskId, reference) {
    const uploaded = await this.#uploadedVoiceReference(root, reference, /^voice-references\/[a-f0-9]{32}\.(?:mp3|wav|m4a|ogg)$/u, '上传的参考音频')
    const storedId = uploaded.file.slice('voice-references/'.length, uploaded.file.lastIndexOf('.'))
    if (uploaded.id !== storedId) fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', '上传的参考音频标识与文件不匹配。')
    const extension = extname(uploaded.file).slice(1).toLowerCase()
    const file = `audio-media/references/${taskId}.${extension}`
    await this.#writeAudioTaskFile(root, file, uploaded.audio)
    return { id: uploaded.id, file, name: uploaded.name, mediaType: uploaded.mediaType }
  }

  async #voiceReference(root, input) {
    if (input.voiceSource !== 'upload') return defaultVoiceReference()
    return this.#uploadedVoiceReference(root, input.referenceAudio, /^audio-media\/references\/[a-f0-9]{32}\.(?:mp3|wav|m4a|ogg)$/u, '任务参考音频')
  }

  #audioTaskRelativePath(file, label) {
    const value = text(file, label, 280)
    if (!/^audio-media\/(?:voiceovers|subtitles|references)\/[A-Za-z0-9][A-Za-z0-9._-]{0,230}$/u.test(value)) fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', `${label}无效。`)
    return value
  }

  async #audioTaskFile(root, file, label) {
    const relativePath = this.#audioTaskRelativePath(file, label)
    const target = await safeMediaTarget(root, relativePath, label)
    const info = await lstat(target).catch(() => null)
    if (!info?.isFile() || info.isSymbolicLink()) fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', `${label}不存在或无效。`)
    return target
  }

  async #writeAudioTaskFile(root, relativePath, content) {
    const normalized = this.#audioTaskRelativePath(relativePath, '音频任务媒体')
    const target = await safeMediaTarget(root, normalized, '音频任务媒体', true)
    try { await writeFile(target, content, { mode: 0o600, flag: 'wx' }) }
    catch (error) { if (error?.code === 'EEXIST') fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', '音频任务媒体文件已存在。'); throw error }
    return target
  }

  async #writeAudioTaskVoiceover(root, taskId, bytes, format, settings, applySettings) {
    const relativePath = `audio-media/voiceovers/${taskId}.${extensionForFormat(format)}`
    if (!applySettings || (settings.rate === 1 && settings.volume === 1)) {
      const output = await this.#writeAudioTaskFile(root, relativePath, bytes)
      return { relativePath, output, bytes: bytes.length }
    }
    const sourcePath = `audio-media/voiceovers/${taskId}.source.wav`
    const source = await this.#writeAudioTaskFile(root, sourcePath, bytes)
    const output = await safeMediaTarget(root, relativePath, '音频任务媒体', true)
    try {
      await execFileAsync('ffmpeg', ['-y', '-i', source, '-filter:a', `atempo=${settings.rate},volume=${settings.volume}`, output], { signal: this.signal, maxBuffer: 1024 * 1024 * 4 })
      await chmod(output, 0o600)
      const info = await stat(output)
      if (!info.isFile() || info.size < 1 || info.size > MAX_MEDIA_BYTES) fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', '处理后的配音文件无效或超出 80 MiB 限制。')
      return { relativePath, output, bytes: info.size }
    } catch (error) {
      if (error instanceof SpokenVideoMediaError) throw error
      throw commandError(error, '配音参数处理')
    } finally { await unlink(source).catch(() => {}) }
  }

  async #runAudioTask(agent, root, taskId) {
    let task = await this.#mutateAudioTask(root, taskId, (current) => ({ ...current, status: 'running', startedAt: new Date().toISOString(), error: null }))
    try {
      await this.#prepareRunCredentials(task)
      let generated
      let outputFormat = task.input.outputFormat || 'wav'
      if (task.input.provider === 'bailian') {
        generated = await this.#bailianVoiceover(root, task, task.source.text, task.input)
        outputFormat = 'wav'
      } else if (task.input.provider === 'lwb') {
        generated = await this.#lwbVoiceover(root, task, task.source.text, task.input)
      } else {
        const config = this.#legacyConfig()
        outputFormat = task.input.outputFormat || config.outputFormat
        const submitted = serviceData(await this.#json(config, '/api/v1/tts/synthesize', {
          method: 'POST', body: JSON.stringify({ text: task.source.text, provider: config.provider, output_format: outputFormat, voice_settings: { rate: task.input.rate, volume: task.input.volume, pitch: task.input.pitch }, interval_silence: 200, max_text_tokens_per_segment: 120, ...(task.input.voiceId ? { voice_id: task.input.voiceId } : {}) }),
        }), 'TTS 提交')
        const externalTaskId = taskIdFromService(submitted, 'TTS')
        const completed = await this.#poll(config, `/api/v1/tts/tasks/${encodeURIComponent(externalTaskId)}`, 'TTS')
        generated = { provider: 'legacy', taskId: externalTaskId, voiceId: task.input.voiceId || null, audio: await this.#download(`${config.baseUrl}/api/v1/tts/tasks/${encodeURIComponent(externalTaskId)}/audio`, '兼容服务配音', serviceHeaders(config)), durationSeconds: Number(completed.duration) || null }
      }
      await this.#audioEvent(root, task.id, '配音服务已返回，处理并检测音频', { provider: generated.provider, taskId: generated.taskId || null })
      const written = await this.#writeAudioTaskVoiceover(root, task.id, generated.audio, outputFormat, task.input, generated.provider === 'bailian')
      const probe = await this.#probe(written.output)
      const audio = { file: written.relativePath, mediaType: mediaTypeForFormat(outputFormat), bytes: written.bytes, durationSeconds: probe.durationSeconds || generated.durationSeconds || null, sampleRate: probe.sampleRate }
      task = await this.#mutateAudioTask(root, task.id, (current) => ({ ...current, result: { audio, provider: generated.provider, taskId: generated.taskId || null, voiceId: generated.voiceId || current.input.voiceId || null } }))
      await this.#syncAudioTaskProject(agent, task, { replace: true })
      await this.#mutateAudioTask(root, task.id, (current) => ({ ...current, status: 'succeeded', completedAt: new Date().toISOString() }))
    } catch (error) {
      const message = mediaErrorMessage(error)
      await this.#mutateAudioTask(root, taskId, (current) => ({ ...current, status: 'failed', completedAt: new Date().toISOString(), error: message.slice(0, 2000) }))
      return
    } finally { this.runSecrets.delete(taskId) }
    // Audio is already durable and successful. Subtitle submission and execution
    // have their own failure boundary, so ASR cannot invalidate usable audio.
    if (task.input.subtitleEnabled) {
      try {
        await this.startAudioTaskSubtitles(agent, { taskId, provider: task.input.provider, lwbUserId: task.input.lwbUserId, language: 'zh', aiOptimize: true })
      } catch (error) {
        await this.#mutateAudioTask(root, taskId, (current) => ({ ...current, subtitle: { ...current.subtitle, status: 'failed', completedAt: new Date().toISOString(), error: String(error?.message || error).slice(0, 2000) } }))
      }
    }
  }

  async #syncAudioTaskProject(agent, task, { replace = false } = {}) {
    if (!task.source?.projectId || !task.result?.audio?.file) return
    try {
      const detail = await this.projectsStore.get(agent, { projectId: task.source.projectId })
      if (detail.artifacts?.script?.data?.body?.trim() !== task.source.text?.trim() || detail.artifacts?.script?.revision !== task.source.scriptRevision) fail('SPOKEN_VIDEO_REVISION_CONFLICT', '配音文本与当前稿件版本不一致，音频已保留，请按当前稿件生成配音。')
      const sourceRoot = await audioTasksRootFor(agent)
      const projectRoot = await projectRootFor(agent, detail.id)
      const extension = extname(task.result.audio.file) || '.wav'
      const projectFile = `media/voiceovers/${task.id}${extension}`
      const voice = detail.artifacts?.voiceover
      if (voice?.data?.audio?.file !== projectFile && (task.projectSync || (voice && (!replace || voice.revision > task.projectRevision)))) {
        fail('SPOKEN_VIDEO_REVISION_CONFLICT', '项目已使用其他配音版本，本次音频已保留，未覆盖当前版本。')
      }
      const sourceFile = await this.#audioTaskFile(sourceRoot, task.result.audio.file, '音频任务媒体')
      await this.#writeSyncedMedia(projectRoot, projectFile, await readFile(sourceFile))
      const committed = voice?.data?.audio?.file === projectFile ? { project: detail } : await this.projectsStore.commitProduced(agent, {
        projectId: detail.id, expectedRevision: detail.revision, stage: 'voiceover', idempotencyKey: `audio-task-${task.id}`, source: 'spoken-video/tts',
        payload: { mode: 'tts', provider: task.result.provider, taskId: task.result.taskId, voiceId: task.result.voiceId, voiceName: task.input.voiceName, settings: { rate: task.input.rate, volume: task.input.volume, pitch: task.input.pitch }, audio: { ...task.result.audio, file: projectFile } },
      })
      return await this.#mutateAudioTask(sourceRoot, task.id, (current) => ({ ...current, projectSyncError: null, projectSync: { projectId: detail.id, revision: committed.project.revision, voiceFile: projectFile } }))
    } catch (error) {
      await this.#mutateAudioTask(await audioTasksRootFor(agent), task.id, (current) => ({ ...current, projectSyncError: `音频已生成，同步项目失败：${String(error?.message || error).slice(0, 500)}` }))
    }
  }

  async #runAudioTaskSubtitles(agent, root, taskId, subtitleId) {
    let task = await this.#mutateAudioTask(root, taskId, (current) => ({ ...current, subtitle: { ...(current.subtitle || {}), status: 'running', startedAt: new Date().toISOString(), error: null } }))
    try {
      await this.#prepareRunCredentials({ id: subtitleId, type: 'subtitles', input: task.subtitle.input })
      const audioPath = await this.#audioTaskFile(root, task.result.audio.file, '配音文件')
      const audio = await readFile(audioPath)
      const input = task.subtitle.input
      let result
      if (input.provider === 'bailian') {
        const generated = await this.#bailianSubtitles({ id: subtitleId }, audioPath, input.language, task.source.text)
        result = { taskId: generated.taskId, subtitle: subtitleResult({ subtitle_srt: generated.srt }), diagnostics: { provider: 'bailian-realtime-asr', alignment: generated.referenceAligned ? 'reference-text' : 'asr' } }
      } else if (input.provider === 'lwb') {
        result = await this.#lwbSubtitles({ id: subtitleId }, audio, audioPath, task.source.text, input)
      } else {
        const config = this.#legacyConfig()
        const submitted = serviceData(await this.#json(config, '/api/v1/subtitles/generate', { method: 'POST', body: JSON.stringify({ audio_base64: audio.toString('base64'), audio_format: extname(audioPath).slice(1) || 'wav', language: input.language, reference_text: task.source.text, return_diagnostics: true, subtitle_options: { max_chars: 22, min_duration: 0.6, max_duration: 4, punctuation_policy: 'strip_trailing', ai_optimize: input.aiOptimize } }) }), '字幕对齐提交')
        const externalTaskId = taskIdFromService(submitted, '字幕对齐')
        const completed = await this.#poll(config, `/api/v1/subtitles/tasks/${encodeURIComponent(externalTaskId)}`, '字幕对齐')
        result = { taskId: externalTaskId, subtitle: subtitleResult(completed), diagnostics: completed.diagnostics || null }
      }
      await this.#audioEvent(root, task.id, '识别完成，校验并保存时间轴', { taskId: result.taskId, cueCount: result.subtitle.cueCount, diagnostics: result.diagnostics })
      const file = `audio-media/subtitles/${task.id}-${subtitleId}.srt`
      await this.#writeAudioTaskFile(root, file, result.subtitle.srt)
      task = await this.#mutateAudioTask(root, task.id, (current) => ({ ...current, subtitle: { ...(current.subtitle || {}), error: null, current: { id: subtitleId, file, srt: result.subtitle.srt, cueCount: result.subtitle.cueCount, mode: 'asr', taskId: result.taskId, diagnostics: result.diagnostics || null, createdAt: new Date().toISOString() } } }))
      await this.#syncAudioTaskSubtitles(agent, task)
      await this.#mutateAudioTask(root, task.id, (current) => ({ ...current, subtitle: { ...current.subtitle, status: 'succeeded', completedAt: new Date().toISOString() } }))
    } catch (error) {
      const message = mediaErrorMessage(error)
      await this.#mutateAudioTask(root, taskId, (current) => ({ ...current, subtitle: { ...(current.subtitle || {}), status: 'failed', completedAt: new Date().toISOString(), error: message.slice(0, 2000) } }))
    } finally { this.runSecrets.delete(subtitleId) }
  }

  async #syncAudioTaskSubtitles(agent, task) {
    if (!task.subtitle?.current?.srt || !task.source?.projectId) return
    try {
      if (!task.projectSync) fail('SPOKEN_VIDEO_STAGE_BLOCKED', '配音尚未同步到项目，请先同步配音结果。')
      const detail = await this.projectsStore.get(agent, { projectId: task.source.projectId })
      if (detail.artifacts?.voiceover?.data?.audio?.file !== task.projectSync.voiceFile || detail.artifacts?.script?.revision !== task.source.scriptRevision) fail('SPOKEN_VIDEO_REVISION_CONFLICT', '项目配音或稿件已更新，字幕已保留，未覆盖当前版本。')
      const projectRoot = await projectRootFor(agent, detail.id)
      const projectFile = `media/subtitles/${task.id}-${task.subtitle.current.id}.srt`
      if (detail.artifacts?.subtitles?.data?.srtFile !== projectFile) {
        await this.#writeSyncedMedia(projectRoot, projectFile, task.subtitle.current.srt)
        await this.projectsStore.commitProduced(agent, {
        projectId: detail.id, expectedRevision: detail.revision, stage: 'subtitles', idempotencyKey: `audio-subtitle-${task.subtitle.current.id}`, source: 'spoken-video/asr',
        payload: { mode: task.subtitle.current.mode, taskId: task.subtitle.current.taskId || null, sourceAudioFile: task.projectSync.voiceFile, srtFile: projectFile, srt: task.subtitle.current.srt, cueCount: task.subtitle.current.cueCount },
        })
      }
      await this.#mutateAudioTask(await audioTasksRootFor(agent), task.id, (current) => ({ ...current, subtitleSyncError: null }))
    } catch (error) {
      await this.#mutateAudioTask(await audioTasksRootFor(agent), task.id, (current) => ({ ...current, subtitleSyncError: `字幕已保存，同步项目失败：${String(error?.message || error).slice(0, 500)}` }))
    }
  }

  async #mutateRun(root, runId, mutator) {
    const previous = this.runWrites.get(root) || Promise.resolve()
    const work = previous.then(async () => {
      const file = await readRuns(root)
      const index = file.runs.findIndex((run) => run.id === runId)
      if (index < 0) throw new Error('媒体任务记录丢失。')
      const before = structuredClone(file.runs[index])
      const next = mutator(file.runs[index])
      executionTransition(before, next, next.type === 'voiceover' ? '配音服务' : next.type === 'subtitles' ? '字幕服务' : '本地制作')
      file.runs[index] = next
      await writeRuns(root, file)
      return next
    })
    const tail = work.catch(() => {})
    this.runWrites.set(root, tail)
    try { return await work } finally { if (this.runWrites.get(root) === tail) this.runWrites.delete(root) }
  }

  async #audioEvent(root, id, label, detail = null) {
    return this.#mutateAudioTask(root, id, (task) => { executionEvent(task, label, { actor: '媒体处理', detail }); return task })
  }
  async #runEvent(root, id, label, detail = null) {
    return this.#mutateRun(root, id, (run) => { executionEvent(run, label, { actor: '媒体处理', detail }); return run })
  }

  async #recoverInterruptedRuns(root) {
    const runs = await readRuns(root)
    let changed = false
    const nowMs = Date.now()
    const recovered = runs.runs.map((run) => {
      const queueKey = `${root}\u0000${run.type}`
      const submittedAtMs = Date.parse(run.startedAt || run.createdAt || '')
      // A run is durably written before its Promise chain enters the queue. Give that
      // handoff a short window so an immediate status poll cannot look like a restart.
      const stillEnteringQueue = Number.isFinite(submittedAtMs) && nowMs - submittedAtMs < RUN_RECOVERY_GRACE_MS
      if (['queued', 'running'].includes(run.status) && !stillEnteringQueue && !this.queues.has(queueKey) && !this.activeRunIds.has(run.id)) {
        changed = true
        return {
          ...run,
          status: 'failed',
          completedAt: new Date().toISOString(),
          error: '媒体主机在任务完成前已重启。请在当前项目版本上重新提交任务。',
        }
      }
      return run
    })
    if (!changed) return runs
    const next = { ...runs, runs: recovered }
    await writeRuns(root, next)
    return next
  }

  async #run(agent, root, queued) {
    const run = await this.#mutateRun(root, queued.id, (current) => ({ ...current, status: 'running', startedAt: new Date().toISOString() }))
    try {
      await this.#prepareRunCredentials(run)
      let result
      if (run.type === 'voiceover') result = await this.#generateVoiceover(agent, root, run)
      else if (run.type === 'subtitles') result = await this.#generateSubtitles(agent, root, run)
      else if (run.type === 'video') result = await this.#renderVideo(agent, root, run)
      else result = await this.#technicalQc(agent, root, run)
      await this.#mutateRun(root, run.id, (current) => ({ ...current, status: 'succeeded', completedAt: new Date().toISOString(), result }))
    } catch (error) {
      const message = mediaErrorMessage(error)
      await this.#mutateRun(root, run.id, (current) => {
        const completedAt = new Date().toISOString()
        const pipeline = current.type === 'video' && current.pipeline && typeof current.pipeline === 'object'
          ? { ...current.pipeline, phase: 'failed', completedAt, error: message.slice(0, 2000), stages: { ...(current.pipeline.stages || {}), ...(current.phase ? { [current.phase]: { ...(current.pipeline.stages?.[current.phase] || {}), status: 'failed', completedAt, error: message.slice(0, 1000) } } : {}) } }
          : current.pipeline
        return { ...current, status: 'failed', phase: current.type === 'video' ? 'failed' : current.phase, completedAt, error: message.slice(0, 2000), ...(pipeline ? { pipeline } : {}) }
      })
    } finally {
      this.runSecrets.delete(run.id)
    }
  }

  #legacyConfig() {
    const config = mediaServiceConfig(this.environment)
    if (!config.configured) fail('SPOKEN_VIDEO_MEDIA_NOT_CONFIGURED', '未配置兼容 TTS/ASR 服务。设置 LWB_SPOKEN_VIDEO_TTS_BASE_URL 后重试，或选择百炼 BYOK / LWB 账号。')
    return config
  }

  #apiKey(run, provider) {
    const apiKey = this.runSecrets.get(run.id)?.apiKey
    if (!apiKey) fail('SPOKEN_VIDEO_MEDIA_CREDENTIAL_REQUIRED', `${provider}尚未保存 API Key。请在连接设置中保存后重试。`)
    return apiKey
  }

  #credentials() {
    if (!this.credentials || typeof this.credentials.resolve !== 'function') {
      fail('SPOKEN_VIDEO_MEDIA_CONNECTION_UNAVAILABLE', '当前运行环境不提供私有凭据服务。')
    }
    return this.credentials
  }

  async #credentialStatus(provider) {
    const ref = mediaCredentialRef(provider)
    const credentials = this.#credentials()
    if (typeof credentials.describe !== 'function') {
      fail('SPOKEN_VIDEO_MEDIA_CONNECTION_UNAVAILABLE', '当前运行环境不支持读取连接状态。')
    }
    const status = await credentials.describe(ref)
    return { configured: status.configured === true, source: status.source || null, writable: status.writable === true }
  }

  async #accountStatus(service) {
    return this.account?.status(service) || { configured: false, authenticated: false, writable: false, reason: '请先登录 LWB 账号。' }
  }

  async #bindAccount(input, service, expectedUserId) {
    if (input.provider !== 'lwb') return input
    const status = await this.#accountStatus(service)
    if (!status.configured || !status.userId) fail('SPOKEN_VIDEO_MEDIA_CREDENTIAL_REQUIRED', status.reason || '请先登录 LWB 账号。')
    if (expectedUserId && expectedUserId !== status.userId) fail('LWB_ATS_ACCOUNT_CHANGED', '此任务属于其他 LWB 账号，请登录原账号后重试。')
    return { ...input, lwbUserId: status.userId }
  }

  async #prepareRunCredentials(run) {
    if (!['voiceover', 'subtitles'].includes(run.type)) return
    const provider = run.input?.provider
    if (provider === 'legacy') return
    if (provider === 'lwb') {
      if (!run.input.lwbUserId) fail('SPOKEN_VIDEO_MEDIA_CREDENTIAL_REQUIRED', '该 LWB 任务缺少账号归属，请重新创建任务。')
      this.runSecrets.set(run.id, { service: await this.account.open(run.type === 'voiceover' ? 'tts' : 'subtitle', { userId: run.input.lwbUserId }) })
      return
    }
    const ref = mediaCredentialRef(provider)
    const resolved = await this.#credentials().resolve(ref)
    if (!resolved?.value) {
      const label = provider === 'bailian' ? '百炼 BYOK' : 'LWB 账号'
      fail('SPOKEN_VIDEO_MEDIA_CREDENTIAL_REQUIRED', `${label}尚未保存 API Key。请在连接设置中保存后重试。`)
    }
    this.runSecrets.set(run.id, { apiKey: resolved.value })
  }

  async #externalJson(url, init, label) {
    let response
    try {
      response = await this.fetch(url, init)
    } catch (error) {
      throw new SpokenVideoMediaError('SPOKEN_VIDEO_MEDIA_SERVICE_UNREACHABLE', `${label}不可访问：${error instanceof Error ? error.message : String(error)}`)
    }
    let body
    try {
      body = await response.json()
    } catch {
      throw new SpokenVideoMediaError('SPOKEN_VIDEO_MEDIA_SERVICE_FAILED', `${label}返回了无效 JSON。`)
    }
    if (!response.ok) {
      const detail = stringAt(body, ['message'], ['error', 'message']) || `HTTP ${response.status}`
      throw providerFailure(label, detail)
    }
    return body
  }

  async #downloadData(url, label, headers = {}) {
    let response
    try {
      response = await this.fetch(boundedHttpUrl(url, label), { method: 'GET', headers })
    } catch (error) {
      throw new SpokenVideoMediaError('SPOKEN_VIDEO_MEDIA_SERVICE_UNREACHABLE', `${label}下载失败：${error instanceof Error ? error.message : String(error)}`)
    }
    if (!response.ok) fail('SPOKEN_VIDEO_MEDIA_SERVICE_FAILED', `${label}下载失败（HTTP ${response.status}）。`)
    const contentLengthHeader = response.headers.get('content-length')
    const declaredBytes = contentLengthHeader && /^\d+$/u.test(contentLengthHeader) ? Number(contentLengthHeader) : null
    if (declaredBytes !== null && (!Number.isSafeInteger(declaredBytes) || declaredBytes < 1 || declaredBytes > MAX_MEDIA_BYTES)) {
      fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', `${label}声明的文件大小无效或超出 80 MiB 限制。`)
    }
    let bytes
    try {
      bytes = Buffer.from(await response.arrayBuffer())
    } catch (error) {
      throw new SpokenVideoMediaError('SPOKEN_VIDEO_MEDIA_SERVICE_FAILED', `${label}下载内容不完整：${error instanceof Error ? error.message : String(error)}`)
    }
    if (!bytes.length || bytes.length > MAX_MEDIA_BYTES) fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', `${label}为空或超出 80 MiB 限制。`)
    if (declaredBytes !== null && declaredBytes !== bytes.length) {
      fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', `${label}下载长度不完整（声明 ${declaredBytes} 字节，实际 ${bytes.length} 字节）。`)
    }
    return { bytes, declaredBytes, contentType: response.headers.get('content-type') || null }
  }

  async #download(url, label, headers = {}) {
    return (await this.#downloadData(url, label, headers)).bytes
  }

  async #normalizeBailianWav(source, output, label) {
    try {
      await execFileAsync('ffmpeg', ['-v', 'error', '-xerror', '-y', '-i', source, '-map', '0:a:0', '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', output], { signal: this.signal, maxBuffer: 1024 * 1024 * 4 })
      await chmod(output, 0o600)
      const audio = await readFile(output)
      const containerError = wavContainerError(audio)
      if (containerError) fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', `${label}标准化后 WAV 校验失败：${containerError}。`)
      const probe = await this.#probe(output)
      if (!probe.hasAudio || !probe.durationSeconds) fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', `${label}标准化后 WAV 不含可播放的音频流。`)
      return { bytes: audio.length, probe }
    } catch (error) {
      if (error instanceof SpokenVideoMediaError) throw error
      throw commandError(error, `${label}音频标准化`)
    }
  }

  async #downloadBailianWav(url, source, output, details) {
    const label = `百炼 TTS 第 ${details.index}/${details.total} 段配音`
    let lastError = null
    for (let attempt = 1; attempt <= BAILIAN_WAV_DOWNLOAD_ATTEMPTS; attempt += 1) {
      try {
        const downloaded = await this.#downloadData(url, label)
        const containerError = wavContainerError(downloaded.bytes, { allowUnboundedSize: true })
        if (containerError) fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', `${label} WAV 校验失败：${containerError}。`)
        const sourceAudio = repairUnboundedWavHeader(downloaded.bytes)
        const repairedError = wavContainerError(sourceAudio)
        if (repairedError) fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', `${label} WAV 长度修复后校验失败：${repairedError}。`)
        await writeFile(source, sourceAudio, { mode: 0o600 })
        const probe = await this.#probe(source)
        if (!probe.hasAudio || !probe.durationSeconds) fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', `${label} WAV 不含可播放的音频流。`)
        return this.#normalizeBailianWav(source, output, label)
      } catch (error) {
        lastError = error
        await unlink(source).catch(() => {})
        await unlink(output).catch(() => {})
        if (attempt < BAILIAN_WAV_DOWNLOAD_ATTEMPTS) await delay(250 * attempt)
      }
    }
    if (lastError?.code === 'SPOKEN_VIDEO_MEDIA_SERVICE_UNREACHABLE') throw lastError
    const reason = lastError instanceof Error ? lastError.message : String(lastError)
    throw new SpokenVideoMediaError(
      'SPOKEN_VIDEO_MEDIA_FILE_INVALID',
      `${label}下载或校验失败（已重试 ${BAILIAN_WAV_DOWNLOAD_ATTEMPTS} 次${details.requestId ? `，请求 ${details.requestId}` : ''}）：${reason}`,
    )
  }

  async #bailianTtsSegment(config, apiKey, model, voice, segment, details, source, output) {
    let lastError = null
    for (let attempt = 1; attempt <= BAILIAN_TTS_SEGMENT_ATTEMPTS; attempt += 1) {
      const body = await this.#externalJson(`${config.bailianBaseUrl}/services/audio/tts/SpeechSynthesizer`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input: { text: segment, voice, format: 'wav', sample_rate: 24000 } }),
        signal: AbortSignal.timeout(MAX_POLL_MS),
      }, `百炼 TTS 第 ${details.index}/${details.total} 段`)
      const audioUrl = stringAt(body, ['output', 'audio', 'url'])
      if (!audioUrl) fail('SPOKEN_VIDEO_MEDIA_SERVICE_FAILED', `百炼 TTS 第 ${details.index}/${details.total} 段没有返回完整音频地址。`)
      const requestId = stringAt(body, ['request_id'])
      try {
        const downloaded = await this.#downloadBailianWav(audioUrl, source, output, { ...details, requestId })
        return { ...downloaded, requestId }
      } catch (error) {
        if (error?.code && error.code !== 'SPOKEN_VIDEO_MEDIA_FILE_INVALID') throw error
        lastError = error
        if (attempt < BAILIAN_TTS_SEGMENT_ATTEMPTS) await delay(500 * attempt)
      }
    }
    if (lastError?.code && lastError.code !== 'SPOKEN_VIDEO_MEDIA_FILE_INVALID') throw lastError
    const reason = lastError instanceof Error ? lastError.message : String(lastError)
    throw new SpokenVideoMediaError(
      'SPOKEN_VIDEO_MEDIA_FILE_INVALID',
      `百炼 TTS 第 ${details.index}/${details.total} 段在重新合成后仍无有效 WAV：${reason}`,
    )
  }

  async #concatBailianWavSegments(directory, chunks) {
    if (chunks.length === 1) return readFile(chunks[0].file)
    const manifest = join(directory, 'concat.txt')
    const output = join(directory, 'merged.wav')
    await writeFile(manifest, `${chunks.map((chunk) => ffmpegConcatEntry(chunk.file)).join('\n')}\n`, { encoding: 'utf8', mode: 0o600 })
    try {
      await execFileAsync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', manifest, '-map', '0:a:0', '-c:a', 'pcm_s16le', output], { signal: this.signal, maxBuffer: 1024 * 1024 * 4 })
      await chmod(output, 0o600)
      const audio = await readFile(output)
      if (!audio.length || audio.length > MAX_MEDIA_BYTES) fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', '百炼 TTS 合并后的 WAV 为空或超出 80 MiB 限制。')
      const containerError = wavContainerError(audio)
      if (containerError) fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', `百炼 TTS 合并后的 WAV 校验失败：${containerError}。`)
      const probe = await this.#probe(output)
      if (!probe.hasAudio || !probe.durationSeconds) fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', '百炼 TTS 合并后的 WAV 不含可播放的音频流。')
      return audio
    } catch (error) {
      if (error instanceof SpokenVideoMediaError) throw error
      throw commandError(error, '百炼 TTS 分段音频合并')
    }
  }

  async #bailianVoiceover(root, run, script, input) {
    const config = mediaServiceConfig(this.environment)
    const apiKey = this.#apiKey(run, '百炼 BYOK')
    const usesReference = ['system', 'reference', 'upload'].includes(input.voiceSource)
    const reference = usesReference ? await this.#voiceReference(root, input) : null
    const voice = reference
      ? await this.#bailianReferenceVoice(config, apiKey, reference)
      : input.voiceSource === 'preset' && input.voiceId
        ? input.voiceId
        : config.bailianDefaultVoice
    const model = reference ? config.bailianVoiceCloneModel : config.bailianModel
    const segments = splitTtsText(script)
    const directory = await mkdtemp(join(tmpdir(), 'lwb-spoken-video-bailian-'))
    const chunks = []
    const taskIds = []
    try {
      for (const [offset, segment] of segments.entries()) {
        const index = offset + 1
        const file = join(directory, `segment-${String(index).padStart(3, '0')}.wav`)
        const source = join(directory, `segment-${String(index).padStart(3, '0')}.source.wav`)
        const chunk = await this.#bailianTtsSegment(config, apiKey, model, voice, segment, { index, total: segments.length }, source, file)
        chunks.push({ ...chunk, file })
        if (chunk.requestId) taskIds.push(chunk.requestId)
      }
      return { provider: 'bailian', taskId: taskIds.at(-1) || null, voiceId: voice, audio: await this.#concatBailianWavSegments(directory, chunks) }
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => {})
    }
  }

  #storedBailianReferenceVoices() {
    const values = this.connectionSettings?.get?.().bailianReferenceVoices
    if (!values || typeof values !== 'object' || Array.isArray(values)) return {}
    return Object.fromEntries(Object.entries(values).filter(([key, voice]) => /^[a-f0-9]{64}$/u.test(key) && typeof voice === 'string' && voice.trim()))
  }

  async #storeBailianReferenceVoice(cacheKey, voice) {
    if (!this.connectionSettings?.update) return
    const entries = Object.entries(this.#storedBailianReferenceVoices()).filter(([key]) => key !== cacheKey)
    const referenceVoices = Object.fromEntries([...entries.slice(-15), [cacheKey, voice]])
    await this.connectionSettings.update({ bailianReferenceVoices: referenceVoices })
  }

  async #bailianReferenceVoice(config, apiKey, reference) {
    const cacheKey = createHash('sha256')
      .update(`${config.bailianBaseUrl}\u0000${apiKey}\u0000${config.bailianVoiceCloneModel}\u0000${reference.id}\u0000`)
      .update(reference.audio)
      .digest('hex')
    const cached = this.bailianReferenceVoices.get(cacheKey)
    if (cached) return cached
    const saved = this.#storedBailianReferenceVoices()[cacheKey]
    if (saved) {
      this.bailianReferenceVoices.set(cacheKey, saved)
      return saved
    }
    const inFlight = this.bailianReferenceVoiceEnrollments.get(cacheKey)
    if (inFlight) return inFlight
    const enrollment = this.#enrollBailianReferenceVoice(cacheKey, config, apiKey, reference)
    this.bailianReferenceVoiceEnrollments.set(cacheKey, enrollment)
    try {
      return await enrollment
    } finally {
      this.bailianReferenceVoiceEnrollments.delete(cacheKey)
    }
  }

  async #enrollBailianReferenceVoice(cacheKey, config, apiKey, reference) {
    const body = await this.#externalJson(`${config.bailianBaseUrl}/services/audio/tts/customization`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.bailianVoiceEnrollmentModel,
        input: {
          action: 'create_voice',
          target_model: config.bailianVoiceCloneModel,
          prefix: bailianVoicePrefix(reference, cacheKey),
          audio: `data:${reference.mediaType};base64,${reference.audio.toString('base64')}`,
          language_hints: ['zh'],
        },
      }),
      signal: AbortSignal.timeout(MAX_POLL_MS),
    }, '百炼参考音色复刻')
    const voice = stringAt(body, ['output', 'voice_id'], ['output', 'voice'])
    if (!voice) fail('SPOKEN_VIDEO_MEDIA_SERVICE_FAILED', '百炼参考音色复刻没有返回有效结果。')
    this.bailianReferenceVoices.set(cacheKey, voice)
    await this.#storeBailianReferenceVoice(cacheKey, voice)
    return voice
  }

  #lwbData(body, label) {
    if (body?.success === true && body.data && typeof body.data === 'object') return body.data
    if (body?.code === 200 && body.data && typeof body.data === 'object') return body.data
    const detail = stringAt(body, ['message'], ['error', 'message']) || `${label}没有返回有效数据。`
    throw providerFailure(label, detail)
  }

  async #lwbJson(run, path, init, label) {
    const service = this.runSecrets.get(run.id)?.service
    if (!service) fail('SPOKEN_VIDEO_MEDIA_CREDENTIAL_REQUIRED', '请先登录 LWB 账号。')
    const { json, ...request } = init
    return service.request(path, request)
  }

  async #lwbPoll(run, path, label) {
    const started = Date.now()
    while (Date.now() - started < MAX_POLL_MS) {
      const data = this.#lwbData(await this.#lwbJson(run, path, { method: 'GET' }, `${label}状态查询`), `${label}状态查询`)
      const state = String(data.status || data.job_status || '').trim().toLowerCase()
      if (['completed', 'succeeded', 'success'].includes(state)) return data
      if (['failed', 'cancelled', 'canceled'].includes(state)) fail('SPOKEN_VIDEO_MEDIA_SERVICE_FAILED', `${label}任务${state}：${stringAt(data, ['error_message'], ['error', 'message']) || '没有返回原因'}`)
      if (!['queued', 'pending', 'processing', 'running', 'in_progress'].includes(state)) fail('SPOKEN_VIDEO_MEDIA_SERVICE_FAILED', `${label}返回了未知任务状态。`)
      await delay(POLL_INTERVAL_MS)
    }
    fail('SPOKEN_VIDEO_MEDIA_SERVICE_TIMEOUT', `${label}任务在 ${MAX_POLL_MS / 60_000} 分钟内未完成。`)
  }

  async #lwbVoiceover(root, run, script, input) {
    const reference = ['system', 'reference', 'upload'].includes(input.voiceSource) ? await this.#voiceReference(root, input) : null
    const submitted = this.#lwbData(await this.#lwbJson(run, '/api/v1/tts/jobs', {
      method: 'POST',
      body: JSON.stringify({
        text: script,
        ...(reference ? { reference_audio_asset_id: await this.#lwbUploadAudio(run, reference.audio, reference.path, reference.name) } : { voice_source: input.voiceSource, ...(input.voiceId ? { voice_id: input.voiceId } : {}) }),
        output_format: input.outputFormat || 'wav',
        voice_settings: { rate: input.rate, volume: input.volume, pitch: input.pitch },
      }),
    }, 'LWB TTS 提交'), 'LWB TTS 提交')
    const taskId = stringAt(submitted, ['job_id'], ['task_id'], ['id'])
    if (!taskId) fail('SPOKEN_VIDEO_MEDIA_SERVICE_FAILED', 'LWB TTS 没有返回任务标识。')
    const completed = await this.#lwbPoll(run, `/api/v1/tts/jobs/${encodeURIComponent(taskId)}`, 'LWB TTS')
    const audioUrl = stringAt(completed, ['result', 'audio_url'], ['audio_url'], ['result', 'url'], ['url'])
    if (!audioUrl) fail('SPOKEN_VIDEO_MEDIA_SERVICE_FAILED', 'LWB TTS 没有返回完整音频地址。')
    return { provider: 'lwb', taskId, voiceId: input.voiceId || null, voiceName: reference?.name || input.voiceName || null, audio: await this.#download(audioUrl, 'LWB 配音') }
  }

  async #bailianSubtitles(run, audioPath, language, referenceText) {
    this.signal?.throwIfAborted()
    const config = mediaServiceConfig(this.environment)
    const apiKey = this.#apiKey(run, '百炼 BYOK')
    const endpoint = new URL(config.bailianAsrWebSocketUrl)
    endpoint.searchParams.set('model', config.bailianAsrModel)
    const taskId = `asr_${randomUUID()}`
    const sentences = []
    const speech = new Map()
    const socket = new WebSocket(endpoint, {
      headers: { Authorization: `Bearer ${apiKey}`, 'User-Agent': 'spoken-video-media-host/1.0' },
      handshakeTimeout: 30_000,
      perMessageDeflate: false,
    })
    let readyResolve
    let readyReject
    let finishedResolve
    let finishedReject
    let socketFailureReject
    let completed = false
    let socketError = null
    const ready = new Promise((resolvePromise, reject) => { readyResolve = resolvePromise; readyReject = reject })
    const finished = new Promise((resolvePromise, reject) => { finishedResolve = resolvePromise; finishedReject = reject })
    const socketFailed = new Promise((_, reject) => { socketFailureReject = reject })
    // Attach observers immediately so an early handshake or API error cannot become an unhandled rejection.
    void ready.catch(() => {})
    void finished.catch(() => {})
    void socketFailed.catch(() => {})
    const failSocket = (error) => {
      if (socketError) return socketError
      const failure = error instanceof SpokenVideoMediaError
        ? error
        : new SpokenVideoMediaError('SPOKEN_VIDEO_MEDIA_SERVICE_FAILED', `百炼实时 ASR 失败：${error instanceof Error ? error.message : String(error)}`)
      socketError = failure
      readyReject(failure)
      finishedReject(failure)
      socketFailureReject(failure)
      return failure
    }
    socket.once('error', failSocket)
    const closedEarly = (code, reason) => {
      if (completed) return
      const detail = Buffer.isBuffer(reason) ? reason.toString('utf8').trim() : String(reason || '').trim()
      failSocket(new SpokenVideoMediaError('SPOKEN_VIDEO_MEDIA_SERVICE_FAILED', `百炼实时 ASR 连接提前关闭（${code}${detail ? `：${detail}` : ''}）。`))
    }
    socket.once('close', closedEarly)
    const abortSocket = () => { failSocket(this.signal.reason); socket.terminate() }
    this.signal?.addEventListener('abort', abortSocket, { once: true })
    socket.on('message', (raw, isBinary) => {
      if (isBinary) return
      let event
      try { event = JSON.parse(String(raw)) } catch { return }
      if (event?.type === 'error') {
        failSocket(new SpokenVideoMediaError('SPOKEN_VIDEO_MEDIA_SERVICE_FAILED', `百炼实时 ASR 失败：${event?.error?.message || event?.error?.code || '未知原因'}`))
      } else if (event?.type === 'session.updated') {
        readyResolve()
      } else if (event?.type === 'input_audio_buffer.speech_started' && typeof event.item_id === 'string') {
        speech.set(event.item_id, { begin: Number(event.audio_start_ms), end: null })
      } else if (event?.type === 'input_audio_buffer.speech_stopped' && typeof event.item_id === 'string') {
        const entry = speech.get(event.item_id) || { begin: null, end: null }
        entry.end = Number(event.audio_end_ms)
        speech.set(event.item_id, entry)
      } else if (event?.type === 'conversation.item.input_audio_transcription.completed') {
        const entry = speech.get(event.item_id)
        if (entry && typeof event.transcript === 'string' && event.transcript.trim() && Number.isFinite(entry.begin) && Number.isFinite(entry.end)) {
          sentences.push({ begin: entry.begin, end: entry.end, text: event.transcript })
        }
      } else if (event?.type === 'conversation.item.input_audio_transcription.failed') {
        failSocket(new SpokenVideoMediaError('SPOKEN_VIDEO_MEDIA_SERVICE_FAILED', `百炼实时 ASR 识别失败：${event?.error?.message || event?.error?.code || '未知原因'}`))
      } else if (event?.type === 'session.finished') {
        completed = true
        finishedResolve()
      }
    })
    try {
      await new Promise((resolvePromise, reject) => {
        socket.once('open', resolvePromise)
        socket.once('error', reject)
      })
      await Promise.race([
        sendSocket(socket, JSON.stringify({
          type: 'session.update',
          event_id: randomUUID(),
          session: {
            input_audio_format: 'pcm',
            sample_rate: BAILIAN_ASR_SAMPLE_RATE,
            input_audio_transcription: { language },
            turn_detection: { type: 'server_vad', threshold: 0, silence_duration_ms: 400 },
          },
        })),
        socketFailed,
      ])
      await awaitWithin(ready, 30_000, 'SPOKEN_VIDEO_MEDIA_SERVICE_TIMEOUT', '百炼实时 ASR 没有在 30 秒内启动。')
      const conversion = spawn('ffmpeg', ['-v', 'error', '-i', audioPath, '-ac', '1', '-ar', String(BAILIAN_ASR_SAMPLE_RATE), '-f', 's16le', 'pipe:1'], { signal: this.signal, stdio: ['ignore', 'pipe', 'pipe'] })
      const conversionDone = waitForChild(conversion, '百炼 ASR 音频转换')
      void conversionDone.catch(() => {})
      try {
        await sendRealtimePcm(socket, conversion.stdout, socketFailed)
        await conversionDone
      } finally {
        if (conversion.exitCode === null && conversion.signalCode === null) conversion.kill()
        await conversionDone.catch(() => {})
      }
      await Promise.race([sendSocket(socket, JSON.stringify({ type: 'session.finish', event_id: randomUUID() })), socketFailed])
      await awaitWithin(finished, MAX_POLL_MS, 'SPOKEN_VIDEO_MEDIA_SERVICE_TIMEOUT', '百炼实时 ASR 在限定时间内未完成。')
      return { taskId, srt: srtFromSentences(alignSentencesToReference(sentences, referenceText)), referenceAligned: Boolean(String(referenceText || '').trim()) }
    } finally {
      this.signal?.removeEventListener('abort', abortSocket)
      await closeSocket(socket)
      socket.removeListener('error', failSocket)
      socket.removeListener('close', closedEarly)
    }
  }

  async #lwbUploadAudio(run, audio, audioPath, label = 'LWB 音频上传') {
    const extension = extname(audioPath).slice(1).toLowerCase() || 'wav'
    const form = new FormData()
    form.append('file', new Blob([audio], { type: mediaTypeForFormat(extension) }), `audio.${extension}`)
    const body = await this.#lwbJson(run, '/api/v1/media/audio-uploads', { method: 'POST', body: form, json: false }, label)
    const data = this.#lwbData(body, label)
    const assetId = stringAt(data, ['asset_id'], ['assetId'])
    if (!assetId) fail('SPOKEN_VIDEO_MEDIA_SERVICE_FAILED', `${label}没有返回资产标识。`)
    return assetId
  }

  async #lwbSubtitles(run, audio, audioPath, script, input) {
    const assetId = await this.#lwbUploadAudio(run, audio, audioPath)
    const submitted = this.#lwbData(await this.#lwbJson(run, '/api/v1/subtitle/jobs', {
      method: 'POST',
      body: JSON.stringify({
        audio_asset_id: assetId,
        audio_format: extname(audioPath).slice(1) || 'wav',
        language: input.language,
        reference_text: script,
        subtitle_options: { max_chars: 22, min_duration: 0.6, max_duration: 4, punctuation_policy: 'strip_trailing', ai_optimize: input.aiOptimize },
      }),
    }, 'LWB 字幕提交'), 'LWB 字幕提交')
    const taskId = stringAt(submitted, ['job_id'], ['task_id'], ['id'])
    if (!taskId) fail('SPOKEN_VIDEO_MEDIA_SERVICE_FAILED', 'LWB 字幕没有返回任务标识。')
    const completed = await this.#lwbPoll(run, `/api/v1/subtitle/jobs/${encodeURIComponent(taskId)}`, 'LWB 字幕')
    return { taskId, subtitle: subtitleResult(completed), assetId }
  }

  async #json(config, path, init) {
    let response
    try {
      response = await this.fetch(`${config.baseUrl}${path}`, { ...init, headers: { ...serviceHeaders(config), ...(init?.headers || {}) } })
    } catch (error) {
      throw new SpokenVideoMediaError('SPOKEN_VIDEO_MEDIA_SERVICE_UNREACHABLE', `无法连接媒体服务：${error instanceof Error ? error.message : String(error)}`)
    }
    let body
    try {
      body = await response.json()
    } catch {
      throw new SpokenVideoMediaError('SPOKEN_VIDEO_MEDIA_SERVICE_FAILED', '媒体服务返回了无效 JSON。')
    }
    if (!response.ok) throw new SpokenVideoMediaError('SPOKEN_VIDEO_MEDIA_SERVICE_FAILED', `媒体服务请求失败（HTTP ${response.status}）。`)
    return body
  }

  async #poll(config, path, label) {
    const started = Date.now()
    while (Date.now() - started < MAX_POLL_MS) {
      const data = serviceData(await this.#json(config, path, { method: 'GET' }), `${label}状态查询`)
      const state = taskState(data, label)
      if (state === 'completed') return data
      if (['failed', 'cancelled'].includes(state)) {
        const reason = typeof data.error_message === 'string' ? `：${data.error_message}` : ''
        fail('SPOKEN_VIDEO_MEDIA_SERVICE_FAILED', `${label}任务${state}${reason}`)
      }
      await delay(POLL_INTERVAL_MS)
    }
    fail('SPOKEN_VIDEO_MEDIA_SERVICE_TIMEOUT', `${label}任务在 ${MAX_POLL_MS / 60_000} 分钟内未完成。`)
  }

  async #videoBgm(root, descriptor) {
    const input = object(descriptor, '背景音乐')
    const file = text(input.file, '背景音乐文件', 280)
    if (!/^media\/bgm-uploads\/[a-f0-9]{32}\.(?:mp3|wav|m4a|ogg)$/u.test(file)) {
      fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', '背景音乐引用无效。')
    }
    const storedId = file.slice('media/bgm-uploads/'.length, file.lastIndexOf('.'))
    if (text(input.id, '背景音乐标识', 64) !== storedId) fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', '背景音乐标识与文件不匹配。')
    const format = videoBgmFormat(input.name, input.mediaType)
    if (extname(file).slice(1).toLowerCase() !== format.extension) fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', '背景音乐引用与文件类型不一致。')
    const target = await this.#file(root, file, '背景音乐')
    const info = await lstat(target)
    if (info.size < 1 || info.size > MAX_VIDEO_BGM_BYTES) fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', '背景音乐为空或超过 20 MiB。')
    let probe
    try { probe = await this.#probe(target) }
    catch { fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', '背景音乐无法解码。') }
    if (!probe.hasAudio || !probe.durationSeconds || probe.videoCodec) fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', '背景音乐不是可播放的纯音频。')
    return target
  }

  async #file(root, file, label) {
    const normalized = mediaPath(file, label)
    const target = await safeMediaTarget(root, normalized, label)
    const info = await lstat(target).catch(() => null)
    if (!info?.isFile() || info.isSymbolicLink()) fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', `${label}不存在或无效。`)
    return target
  }

  async #writeAt(root, relativePath, content, label) {
    const target = await safeMediaTarget(root, relativePath, label, true)
    try {
      await writeFile(target, content, { mode: 0o600, flag: 'wx' })
    } catch (error) {
      if (error?.code === 'EEXIST') fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', '媒体文件已存在。')
      throw error
    }
    return target
  }

  async #write(root, relativePath, content) {
    return this.#writeAt(root, mediaPath(relativePath, '媒体文件'), content, '媒体文件')
  }

  async #writeSyncedMedia(root, relativePath, content) {
    const target = await safeMediaTarget(root, mediaPath(relativePath, '同步媒体文件'), '同步媒体文件', true)
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content)
    try { await writeFile(target, bytes, { mode: 0o600, flag: 'wx' }) }
    catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const info = await lstat(target)
      if (!info.isFile() || info.isSymbolicLink() || info.size !== bytes.length || !(await readFile(target)).equals(bytes)) {
        fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', '已有媒体文件与任务产物不一致，未覆盖原文件。')
      }
    }
    return target
  }

  async #writeVoiceoverAudio(root, runId, bytes, outputFormat, settings, applySettings) {
    const relativePath = `media/voiceovers/${runId}.${extensionForFormat(outputFormat)}`
    if (!applySettings || (settings.rate === 1 && settings.volume === 1)) {
      return { relativePath, output: await this.#write(root, relativePath, bytes), bytes: bytes.length }
    }
    const sourcePath = `media/voiceovers/${runId}.source.wav`
    const source = await this.#write(root, sourcePath, bytes)
    const output = await safeMediaTarget(root, relativePath, '配音文件', true)
    try {
      await execFileAsync('ffmpeg', [
        '-y', '-i', source, '-filter:a', `atempo=${settings.rate},volume=${settings.volume}`,
        output,
      ], { signal: this.signal, maxBuffer: 1024 * 1024 * 4 })
      await chmod(output, 0o600)
      const info = await stat(output)
      if (!info.isFile() || info.size < 1 || info.size > MAX_MEDIA_BYTES) fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', '处理后的配音文件无效或超出 80 MiB 限制。')
      return { relativePath, output, bytes: info.size }
    } catch (error) {
      if (error instanceof SpokenVideoMediaError) throw error
      throw commandError(error, '配音参数处理')
    } finally {
      await unlink(source).catch(() => {})
    }
  }

  async #probe(path) {
    try {
      const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,duration,sample_rate,nb_frames:stream_disposition=attached_pic', '-of', 'json', path], { signal: this.signal, maxBuffer: 1024 * 1024 })
      return normalizeProbe(JSON.parse(stdout))
    } catch (error) {
      throw commandError(error, 'ffprobe')
    }
  }

  async #generateVoiceover(agent, root, run) {
    const detail = await this.projectsStore.get(agent, { projectId: run.projectId })
    const script = detail.artifacts?.script?.data?.body
    if (detail.revision !== run.expectedRevision) fail('SPOKEN_VIDEO_REVISION_CONFLICT', '稿件已更新，已取消旧版本的配音任务。')
    if (typeof script !== 'string' || !script.trim()) fail('SPOKEN_VIDEO_STAGE_BLOCKED', '当前项目没有可用稿件，不能生成配音。')
    const input = run.input
    let generated
    let outputFormat = input.outputFormat || 'wav'
    if (input.provider === 'bailian') {
      generated = await this.#bailianVoiceover(root, run, script, input)
      outputFormat = 'wav'
    } else if (input.provider === 'lwb') {
      generated = await this.#lwbVoiceover(root, run, script, input)
    } else {
      const config = this.#legacyConfig()
      outputFormat = input.outputFormat || config.outputFormat
      const payload = {
        text: script,
        provider: config.provider,
        output_format: outputFormat,
        voice_settings: { rate: input.rate, volume: input.volume, pitch: input.pitch },
        interval_silence: 200,
        max_text_tokens_per_segment: 120,
        ...(input.voiceId ? { voice_id: input.voiceId } : {}),
      }
      const submitted = serviceData(await this.#json(config, '/api/v1/tts/synthesize', { method: 'POST', body: JSON.stringify(payload) }), 'TTS 提交')
      const taskId = taskIdFromService(submitted, 'TTS')
      const completed = await this.#poll(config, `/api/v1/tts/tasks/${encodeURIComponent(taskId)}`, 'TTS')
      generated = {
        provider: 'legacy', taskId, voiceId: input.voiceId || null,
        audio: await this.#download(`${config.baseUrl}/api/v1/tts/tasks/${encodeURIComponent(taskId)}/audio`, '兼容服务配音', serviceHeaders(config)),
        durationSeconds: Number(completed.duration) || null,
      }
    }
    await this.#runEvent(root, run.id, '配音服务已返回，处理并检测音频', { provider: generated.provider, taskId: generated.taskId })
    const written = await this.#writeVoiceoverAudio(root, run.id, generated.audio, outputFormat, input, generated.provider === 'bailian')
    const { relativePath, output } = written
    const probe = await this.#probe(output)
    await this.#mutateRun(root, run.id, (current) => ({ ...current, result: { audio: { file: relativePath, mediaType: mediaTypeForFormat(outputFormat), bytes: written.bytes, durationSeconds: probe.durationSeconds, sampleRate: probe.sampleRate }, taskId: generated.taskId } }))
    const committed = await this.projectsStore.commitProduced(agent, {
      projectId: run.projectId,
      expectedRevision: run.expectedRevision,
      stage: 'voiceover',
      idempotencyKey: `media-${run.id}`,
      source: 'spoken-video/tts',
      payload: {
        mode: 'tts', provider: generated.provider, taskId: generated.taskId, voiceId: generated.voiceId || input.voiceId, voiceName: input.voiceName,
        settings: { rate: input.rate, volume: input.volume, pitch: input.pitch },
        audio: { file: relativePath, mediaType: mediaTypeForFormat(outputFormat), bytes: written.bytes, durationSeconds: probe.durationSeconds || generated.durationSeconds || null, sampleRate: probe.sampleRate },
      },
    })
    return { project: committed.project, artifact: committed.artifact, audio: { file: relativePath, durationSeconds: probe.durationSeconds, bytes: written.bytes, sampleRate: probe.sampleRate }, taskId: generated.taskId }
  }

  async #generateSubtitles(agent, root, run) {
    const detail = await this.projectsStore.get(agent, { projectId: run.projectId })
    if (detail.revision !== run.expectedRevision) fail('SPOKEN_VIDEO_REVISION_CONFLICT', '上游已更新，已取消旧版本的字幕任务。')
    const script = detail.artifacts?.script?.data?.body
    const voiceover = detail.artifacts?.voiceover?.data
    if (typeof script !== 'string' || !voiceover?.audio?.file) fail('SPOKEN_VIDEO_STAGE_BLOCKED', '缺少已完成配音，不能生成字幕。')
    const audioPath = await this.#file(root, voiceover.audio.file, '配音文件')
    const audio = await readFile(audioPath)
    if (!audio.length || audio.length > MAX_MEDIA_BYTES) fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', '配音文件为空或超出字幕服务上传限制。')
    let result
    if (run.input.provider === 'bailian') {
      const generated = await this.#bailianSubtitles(run, audioPath, run.input.language, script)
      result = { taskId: generated.taskId, subtitle: subtitleResult({ subtitle_srt: generated.srt }), diagnostics: { provider: 'bailian-realtime-asr', alignment: generated.referenceAligned ? 'reference-text' : 'asr' } }
    } else if (run.input.provider === 'lwb') {
      result = await this.#lwbSubtitles(run, audio, audioPath, script, run.input)
    } else {
      const config = this.#legacyConfig()
      const submitted = serviceData(await this.#json(config, '/api/v1/subtitles/generate', {
        method: 'POST',
        body: JSON.stringify({
          audio_base64: audio.toString('base64'),
          audio_format: extname(audioPath).slice(1) || 'wav',
          language: run.input.language,
          reference_text: script,
          return_diagnostics: true,
          subtitle_options: { max_chars: 22, min_duration: 0.6, max_duration: 4, punctuation_policy: 'strip_trailing', ai_optimize: run.input.aiOptimize },
        }),
      }), '字幕对齐提交')
      const taskId = taskIdFromService(submitted, '字幕对齐')
      const completed = await this.#poll(config, `/api/v1/subtitles/tasks/${encodeURIComponent(taskId)}`, '字幕对齐')
      result = { taskId, subtitle: subtitleResult(completed), diagnostics: completed.diagnostics || null }
    }
    const { taskId, subtitle } = result
    const relativePath = `media/subtitles/${run.id}.srt`
    await this.#write(root, relativePath, subtitle.srt)
    await this.#mutateRun(root, run.id, (current) => { executionEvent(current, '识别完成，时间轴字幕已保存', { actor: '字幕服务', detail: { taskId, cueCount: subtitle.cueCount } }); return { ...current, result: { taskId, srt: subtitle.srt, srtFile: relativePath, cueCount: subtitle.cueCount, diagnostics: result.diagnostics || null } } })
    const committed = await this.projectsStore.commitProduced(agent, {
      projectId: run.projectId,
      expectedRevision: run.expectedRevision,
      stage: 'subtitles',
      idempotencyKey: `media-${run.id}`,
      source: 'spoken-video/asr',
      payload: {
        mode: 'asr', taskId, sourceAudioFile: voiceover.audio.file, srt: subtitle.srt, srtFile: relativePath,
        cueCount: subtitle.cueCount, diagnostics: result.diagnostics || null,
      },
    })
    return { project: committed.project, artifact: committed.artifact, cueCount: subtitle.cueCount, taskId }
  }

  async #renderVideo(agent, root, run) {
    if (run.input.renderer === 'local-ffmpeg') return this.#renderLegacyVideo(agent, root, run)
    return this.#renderAiDirectorVideo(agent, root, run)
  }

  async #setVideoPhase(root, runId, phase, details = {}) {
    return this.#mutateRun(root, runId, (current) => {
      const now = new Date().toISOString()
      const previousPhase = current.phase
      const previousPipeline = current.pipeline && typeof current.pipeline === 'object' ? current.pipeline : {}
      const stages = { ...(previousPipeline.stages || {}) }
      if (previousPhase && previousPhase !== phase && stages[previousPhase]?.status === 'running') {
        stages[previousPhase] = { ...stages[previousPhase], status: 'succeeded', completedAt: now }
      }
      if (phase !== 'completed') stages[phase] = { ...(stages[phase] || {}), status: 'running', startedAt: stages[phase]?.startedAt || now }
      return {
        ...current,
        phase,
        pipeline: {
          schemaVersion: 1,
          engine: 'dsh-remotion-ai-director',
          startedAt: previousPipeline.startedAt || now,
          ...previousPipeline,
          ...details,
          phase,
          stages,
          ...(phase === 'completed' ? { completedAt: now } : {}),
        },
      }
    })
  }

  async #renderLegacyVideo(agent, root, run) {
    const detail = await this.projectsStore.get(agent, { projectId: run.projectId })
    if (detail.revision !== run.expectedRevision) fail('SPOKEN_VIDEO_REVISION_CONFLICT', '上游已更新，已取消旧版本的视频渲染任务。')
    const voiceover = detail.artifacts?.voiceover?.data
    const subtitles = detail.artifacts?.subtitles?.data || null
    const subtitleEnabled = run.input.subtitleEnabled !== false
    const orientation = run.input.orientation === 'landscape' ? 'landscape' : 'portrait'
    if (!voiceover?.audio?.file || (subtitleEnabled && typeof subtitles?.srt !== 'string')) fail('SPOKEN_VIDEO_STAGE_BLOCKED', subtitleEnabled ? '必须先完成配音与字幕，才能渲染视频。' : '必须先完成配音，才能渲染视频。')
    const audioPath = await this.#file(root, voiceover.audio.file, '配音文件')
    const videoFile = `media/videos/${run.id}.mp4`
    const videoPath = resolve(root, videoFile)
    await mkdir(dirname(videoPath), { recursive: true, mode: 0o700 })
    const audioProbe = await this.#probe(audioPath)
    await this.#renderLocalFfmpeg(root, run, audioPath, subtitles, subtitleEnabled, videoPath)
    const info = await stat(videoPath)
    if (!info.isFile() || info.size < 1024) fail('SPOKEN_VIDEO_MEDIA_COMMAND_FAILED', '视频渲染没有生成有效文件。')
    const probe = await this.#probe(videoPath)
    const committed = await this.projectsStore.commitProduced(agent, {
      projectId: run.projectId,
      expectedRevision: run.expectedRevision,
      stage: 'video',
      idempotencyKey: `media-${run.id}`,
      source: 'spoken-video/local-ffmpeg',
      payload: {
        mode: 'local-ffmpeg', renderer: 'local-ffmpeg', orientation, visualBrief: run.input.visualBrief, subtitleEnabled, sourceAudioFile: voiceover.audio.file, sourceSubtitleFile: subtitleEnabled ? subtitles.srtFile || null : null,
        video: { file: videoFile, mediaType: 'video/mp4', bytes: info.size, durationSeconds: probe.durationSeconds, width: probe.width, height: probe.height, fps: probe.fps, hasAudio: probe.hasAudio },
      },
    })
    return { project: committed.project, artifact: committed.artifact, video: { file: videoFile, ...probe, bytes: info.size } }
  }

  async #renderAiDirectorVideo(agent, root, run) {
    if (!this.videoCreator) fail('SPOKEN_VIDEO_VIDEO_AGENT_UNAVAILABLE', '当前 DSH 环境未提供视频创作 Agent，任务已终止。')
    if (!this.videoReviewer) fail('SPOKEN_VIDEO_VIDEO_REVIEWER_UNAVAILABLE', '当前 DSH 环境未提供独立视频审核 Agent，任务已终止。')
    const detail = await this.projectsStore.get(agent, { projectId: run.projectId })
    if (detail.revision !== run.expectedRevision) fail('SPOKEN_VIDEO_REVISION_CONFLICT', '上游已更新，已取消旧版本的视频制作任务。')
    const script = detail.artifacts?.script?.data?.body || ''
    const voiceover = detail.artifacts?.voiceover?.data
    const subtitles = detail.artifacts?.subtitles?.data || null
    const subtitleEnabled = run.input.subtitleEnabled !== false
    const orientation = run.input.orientation === 'landscape' ? 'landscape' : 'portrait'
    if (!script || !voiceover?.audio?.file || (subtitleEnabled && typeof subtitles?.srt !== 'string')) {
      fail('SPOKEN_VIDEO_STAGE_BLOCKED', subtitleEnabled ? '必须先完成稿件、配音与字幕，才能制作视频。' : '必须先完成稿件与配音，才能制作视频。')
    }

    await this.#setVideoPhase(root, run.id, 'preparing')
    const audioPath = await this.#file(root, voiceover.audio.file, '配音文件')
    const bgmPath = run.input.backgroundMusic ? await this.#videoBgm(root, run.input.backgroundMusic) : null
    const audioProbe = await this.#probe(audioPath)
    const durationSeconds = audioProbe.durationSeconds || voiceover.audio.durationSeconds || 1
    const cues = subtitleEnabled ? validateSrt(subtitles.srt).cues.map((cue, index) => ({ id: `srt-${index + 1}`, startMs: cue.startMs, endMs: cue.endMs, text: cue.text })) : []
    const workspace = await prepareSpokenVideoAgentProject({
      projectRoot: root, runId: run.id, title: detail.title, script, audioPath, durationSeconds,
      subtitles: cues, subtitleSrt: subtitleEnabled ? subtitles.srt : '', subtitleEnabled, orientation, visualBrief: run.input.visualBrief,
      bgmPath, backgroundMusic: run.input.backgroundMusic, bgmVolume: run.input.bgmVolume,
    })
    await this.#setVideoPhase(root, run.id, 'directing', { workspaceDir: workspace.relativeProjectDir })
    await this.videoCreator({
      prompt: buildVideoCreatorPrompt({ runDir: workspace.projectDir }),
      agent,
      validate: async () => {
        this.signal?.throwIfAborted()
        const report = await inspectSpokenVideoAgentProject(workspace)
        await this.#setVideoPhase(root, run.id, 'preflight', { preflight: { passed: report.passed, failures: report.failures, findings: report.findings, creativeBytes: report.creativeBytes } })
        return report
      },
      repairPrompt: (input) => buildVideoCreatorRepairPrompt({ runDir: workspace.projectDir, ...input }),
      maxRepairs: 2,
      onDshRepair: async ({ attempt, maximum, failures }) => {
        await this.#runEvent(root, run.id, `工程预检修复 ${attempt}/${maximum}`, failures.join('\n'))
        await this.#setVideoPhase(root, run.id, 'directing', { repair: { attempt, maximum, failures } })
      },
      onDshStarted: (started) => this.#recordRunDshStarted(root, run.id, 'creator', '视觉导演', started),
      onDshEvent: (event) => this.#recordRunDshEvent(root, run.id, 'creator', event),
      onDshContinuation: ({ attempt, maximum }) => this.#setVideoPhase(root, run.id, 'directing', {
        continuation: { reason: 'max-tokens', attempt, maximum },
      }),
    })

    await this.#setVideoPhase(root, run.id, 'preflight')
    const inspected = await inspectSpokenVideoAgentProject(workspace)
    const preflight = { passed: inspected.passed, failures: inspected.failures, findings: inspected.findings, creativeBytes: inspected.creativeBytes }
    await this.#setVideoPhase(root, run.id, 'preflight', { preflight })
    if (!inspected.passed) fail('SPOKEN_VIDEO_VIDEO_AGENT_INVALID', `视频 Agent 产物未通过渲染前检查：${inspected.failures.join(' ')}`)

    const subtitleDisplayLimit = orientation === 'landscape' ? 56 : 44
    const subtitleLengths = cues.map((cue) => Array.from(cue.text).length)
    const maxSubtitleChars = subtitleLengths.length ? Math.max(...subtitleLengths) : 0
    const longSubtitleCount = subtitleLengths.filter((length) => length > subtitleDisplayLimit).length
    const subtitleIssues = subtitleEnabled && longSubtitleCount ? [`${longSubtitleCount} 条字幕超过 ${subtitleDisplayLimit} 字的双行可读上限。`] : []
    const editorialRepairHistory = []
    const renderAndReview = async (repairAttempt) => {
      const attemptNumber = repairAttempt + 1
      await this.#setVideoPhase(root, run.id, 'rendering', {
        editorialRepair: { attempts: repairAttempt, maxAttempts: VIDEO_EDITORIAL_REPAIR_MAX_ATTEMPTS, history: editorialRepairHistory },
      })
      const renderedPath = await renderSpokenVideoAgentProject(workspace, {
        signal: this.signal,
        onProgress: (message) => this.#runEvent(root, run.id, repairAttempt ? `修复后渲染 ${repairAttempt}/${VIDEO_EDITORIAL_REPAIR_MAX_ATTEMPTS}` : '渲染输出', message),
      })
      const renderedInfo = await stat(renderedPath)
      if (!renderedInfo.isFile() || renderedInfo.size < 1024) fail('SPOKEN_VIDEO_MEDIA_COMMAND_FAILED', 'Remotion 没有生成有效成片。')
      if (renderedInfo.size > MAX_MEDIA_BYTES) fail('SPOKEN_VIDEO_MEDIA_FILE_TOO_LARGE', 'Remotion 成片超过 80 MiB，无法提交或在工作台预览。请缩短稿件后重新生成。')
      const videoProbe = await this.#probe(renderedPath)

      await this.#setVideoPhase(root, run.id, 'technical-qc')
      const reviewFramesDir = join(workspace.projectDir, 'outputs', 'review-frames', `attempt-${attemptNumber}`)
      const sampled = await extractVideoReviewFrames(renderedPath, reviewFramesDir, videoProbe.durationSeconds || durationSeconds, this.signal)
      const variation = await measureVisualVariation(sampled.frameFiles, orientation, videoProbe.durationSeconds || durationSeconds, this.signal)
      const topology = buildTechnicalReport({ video: videoProbe, audio: audioProbe, subtitles, subtitleEnabled, orientation })
      const variationIssues = variation.passed ? [] : ['主画面变化不足，成片可能退化为静态画面或少量文字卡片。']
      const technical = {
        ...topology,
        passed: topology.passed && variation.passed && subtitleIssues.length === 0,
        issues: [...topology.issues, ...variationIssues, ...subtitleIssues],
        subtitles: { ...topology.subtitles, maxTextChars: maxSubtitleChars, displayLimit: subtitleDisplayLimit, longCueCount: longSubtitleCount },
        variation,
        sampledFrames: sampled.frameFiles.map((file) => portableRelative(root, file)),
        sampledTimestamps: sampled.timestamps,
      }
      const technicalReportPath = join(workspace.projectDir, 'outputs', `technical-qc-attempt-${attemptNumber}.json`)
      const canonicalTechnicalReportPath = join(workspace.projectDir, 'outputs', 'technical-qc.json')
      const technicalReport = { generatedAt: new Date().toISOString(), projectId: run.projectId, videoTaskId: run.id, attempt: attemptNumber, ...technical }
      await Promise.all([writeJson(technicalReportPath, technicalReport), writeJson(canonicalTechnicalReportPath, technicalReport)])
      await this.#setVideoPhase(root, run.id, 'technical-qc', { technical, technicalReportFile: portableRelative(root, technicalReportPath) })
      if (!technical.passed) fail('SPOKEN_VIDEO_VIDEO_TECHNICAL_QC_FAILED', `成片未通过技术质检：${technical.issues.join(' ')}`)

      await this.#setVideoPhase(root, run.id, 'editorial-review')
      const reviewerRole = repairAttempt ? `reviewer-${attemptNumber}` : 'reviewer'
      const rawReview = await this.videoReviewer({
        prompt: buildVideoReviewerPrompt({ runDir: workspace.projectDir, technicalReportFile: technicalReportPath, frameFiles: sampled.frameFiles, timestamps: sampled.timestamps }),
        schema: VIDEO_REVIEW_SCHEMA,
        agent,
        onDshStarted: (started) => this.#recordRunDshStarted(root, run.id, reviewerRole, repairAttempt ? `独立复审 ${repairAttempt}/${VIDEO_EDITORIAL_REPAIR_MAX_ATTEMPTS}` : '独立审片', started),
        onDshEvent: (event) => this.#recordRunDshEvent(root, run.id, reviewerRole, event),
      })
      const review = normalizeVideoReview(rawReview, { technicalPassed: technical.passed, sampledTimestamps: sampled.timestamps })
      const reviewReportPath = join(workspace.projectDir, 'outputs', `editorial-review-attempt-${attemptNumber}.json`)
      const canonicalReviewReportPath = join(workspace.projectDir, 'outputs', 'editorial-review.json')
      const reviewReport = { generatedAt: new Date().toISOString(), projectId: run.projectId, videoTaskId: run.id, attempt: attemptNumber, ...review }
      await Promise.all([writeJson(reviewReportPath, reviewReport), writeJson(canonicalReviewReportPath, reviewReport)])
      editorialRepairHistory.push({ attempt: repairAttempt, passed: review.passed, score: review.score, summary: review.summary, reviewReportFile: portableRelative(root, reviewReportPath) })
      await this.#setVideoPhase(root, run.id, 'editorial-review', {
        review,
        reviewReportFile: portableRelative(root, reviewReportPath),
        editorialRepair: { attempts: repairAttempt, maxAttempts: VIDEO_EDITORIAL_REPAIR_MAX_ATTEMPTS, history: editorialRepairHistory },
      })
      return { renderedPath, renderedInfo, videoProbe, technical, sampled, review, reviewReportPath }
    }

    let reviewed = await renderAndReview(0)
    for (let attempt = 1; !reviewed.review.passed && attempt <= VIDEO_EDITORIAL_REPAIR_MAX_ATTEMPTS; attempt += 1) {
      await this.#runEvent(root, run.id, `独立审片定向修复 ${attempt}/${VIDEO_EDITORIAL_REPAIR_MAX_ATTEMPTS}`, {
        score: reviewed.review.score,
        summary: reviewed.review.summary,
        findings: reviewed.review.findings,
      })
      await this.#setVideoPhase(root, run.id, 'editorial-repair', {
        editorialRepair: { attempts: attempt, maxAttempts: VIDEO_EDITORIAL_REPAIR_MAX_ATTEMPTS, history: editorialRepairHistory },
      })
      const creatorRole = `creator-repair-${attempt}`
      await this.videoCreator({
        prompt: buildVideoEditorialRepairPrompt({
          runDir: workspace.projectDir,
          review: reviewed.review,
          frameFiles: reviewed.sampled.frameFiles,
          timestamps: reviewed.sampled.timestamps,
          attempt,
          maximum: VIDEO_EDITORIAL_REPAIR_MAX_ATTEMPTS,
        }),
        agent,
        validate: async () => {
          this.signal?.throwIfAborted()
          const report = await inspectSpokenVideoAgentProject(workspace)
          await this.#setVideoPhase(root, run.id, 'preflight', { preflight: { passed: report.passed, failures: report.failures, findings: report.findings, creativeBytes: report.creativeBytes } })
          return report
        },
        repairPrompt: (input) => buildVideoCreatorRepairPrompt({ runDir: workspace.projectDir, ...input }),
        maxRepairs: 1,
        onDshRepair: async ({ failures }) => this.#runEvent(root, run.id, `审片修复后的工程预检修复 ${attempt}/${VIDEO_EDITORIAL_REPAIR_MAX_ATTEMPTS}`, failures.join('\n')),
        onDshStarted: (started) => this.#recordRunDshStarted(root, run.id, creatorRole, `视觉定向修复 ${attempt}/${VIDEO_EDITORIAL_REPAIR_MAX_ATTEMPTS}`, started),
        onDshEvent: (event) => this.#recordRunDshEvent(root, run.id, creatorRole, event),
        onDshContinuation: ({ attempt: continuationAttempt, maximum }) => this.#setVideoPhase(root, run.id, 'editorial-repair', {
          continuation: { reason: 'max-tokens', attempt: continuationAttempt, maximum },
        }),
      })
      const repaired = await inspectSpokenVideoAgentProject(workspace)
      if (!repaired.passed) fail('SPOKEN_VIDEO_VIDEO_AGENT_INVALID', `审片定向修复未通过渲染前检查：${repaired.failures.join(' ')}`)
      preflight.passed = repaired.passed
      preflight.failures = repaired.failures
      preflight.findings = repaired.findings
      preflight.creativeBytes = repaired.creativeBytes
      reviewed = await renderAndReview(attempt)
    }
    const { renderedPath, renderedInfo, videoProbe, technical, sampled, review, reviewReportPath } = reviewed
    if (!review.passed) fail('SPOKEN_VIDEO_VIDEO_EDITORIAL_REVIEW_FAILED', `成片经过 ${VIDEO_EDITORIAL_REPAIR_MAX_ATTEMPTS} 次定向修复后仍未通过独立审片：${review.summary}`)

    await this.#setVideoPhase(root, run.id, 'committing')
    const videoFile = `media/videos/${run.id}.mp4`
    const videoPath = resolve(root, videoFile)
    await mkdir(dirname(videoPath), { recursive: true, mode: 0o700 })
    await copyFile(renderedPath, videoPath)
    const reportFile = `media/qc/${run.id}.json`
    const reviewFile = `media/qc/${run.id}-editorial.json`
    await this.#write(root, reportFile, `${JSON.stringify({ generatedAt: new Date().toISOString(), projectId: run.projectId, videoTaskId: run.id, technical, review }, null, 2)}\n`)
    await this.#write(root, reviewFile, `${JSON.stringify({ generatedAt: new Date().toISOString(), projectId: run.projectId, videoTaskId: run.id, ...review }, null, 2)}\n`)
    const videoCommit = await this.projectsStore.commitProduced(agent, {
      projectId: run.projectId, expectedRevision: run.expectedRevision, stage: 'video', idempotencyKey: `media-${run.id}`, source: 'spoken-video/remotion-agent',
      payload: {
        mode: 'ai-director', renderer: 'remotion', orientation, visualBrief: run.input.visualBrief, subtitleEnabled,
        sourceAudioFile: voiceover.audio.file, sourceSubtitleFile: subtitleEnabled ? subtitles.srtFile || null : null,
        sourceBgmFile: run.input.backgroundMusic?.file || null,
        backgroundMusic: run.input.backgroundMusic,
        bgmVolume: run.input.bgmVolume,
        remotion: {
          projectDir: workspace.relativeProjectDir,
          propsFile: `${workspace.relativeProjectDir}/public/task-props.json`,
          entryFile: `${workspace.relativeProjectDir}/src/index.ts`,
          creativeFile: `${workspace.relativeProjectDir}/src/CreativeVideo.tsx`,
          preflight,
          editorialRepair: { attempts: editorialRepairHistory.length - 1, maxAttempts: VIDEO_EDITORIAL_REPAIR_MAX_ATTEMPTS, history: editorialRepairHistory },
        },
        video: { file: videoFile, mediaType: 'video/mp4', bytes: renderedInfo.size, durationSeconds: videoProbe.durationSeconds, width: videoProbe.width, height: videoProbe.height, fps: videoProbe.fps, frameCount: videoProbe.frameCount, hasAudio: videoProbe.hasAudio },
      },
    })
    const qcCommit = await this.projectsStore.commitProduced(agent, {
      projectId: run.projectId, expectedRevision: videoCommit.project.revision, stage: 'qc', idempotencyKey: `media-${run.id}-qc`, source: 'spoken-video/ai-review',
      payload: { mode: 'ai-director', reportFile, reviewFile, passed: true, technical, review, sampledFrames: technical.sampledFrames },
    })
    await this.#setVideoPhase(root, run.id, 'completed', { committedRevision: qcCommit.project.revision })
    return {
      project: qcCommit.project,
      artifact: videoCommit.artifact,
      video: { file: videoFile, ...videoProbe, bytes: renderedInfo.size },
      qc: { passed: true, artifact: qcCommit.artifact, technical, review, reportFile, reviewFile },
      remotion: {
        projectDir: workspace.relativeProjectDir,
        creativeFile: `${workspace.relativeProjectDir}/src/CreativeVideo.tsx`,
        preflight,
        editorialRepair: { attempts: editorialRepairHistory.length - 1, maxAttempts: VIDEO_EDITORIAL_REPAIR_MAX_ATTEMPTS, history: editorialRepairHistory },
      },
    }
  }

  async #renderLocalFfmpeg(root, run, audioPath, subtitles, subtitleEnabled, videoPath) {
    const subtitleFile = subtitleEnabled ? `media/videos/${run.id}.srt` : null
    const subtitlePath = subtitleEnabled ? await this.#write(root, subtitleFile, subtitles.srt) : null
    const dimensions = run.input.orientation === 'landscape' ? '1920x1080' : '1080x1920'
    try {
      const ffmpegArgs = [
        '-y', '-f', 'lavfi', '-i', `color=c=0x102235:s=${dimensions}:r=30`, '-i', audioPath,
        ...(subtitleEnabled ? ['-vf', ffmpegSubtitleFilter(subtitlePath)] : []), '-map', '0:v:0', '-map', '1:a:0',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', videoPath,
      ]
      await execFileAsync('ffmpeg', ffmpegArgs, { signal: this.signal, maxBuffer: 1024 * 1024 * 4 })
    } catch (error) {
      throw commandError(error, '本机视频渲染')
    }
  }

  async #recordRunDshStarted(root, runId, role, label, started) {
    const childSessionId = typeof started?.childSessionId === 'string' ? started.childSessionId : null
    if (!childSessionId) return
    await this.#mutateRun(root, runId, (run) => {
      const trace = ensureDshTrace(run)
      startDshTraceSession(trace, { role, label, childSessionId, parentSessionId: typeof started.parentSessionId === 'string' ? started.parentSessionId : null })
      appendDshSessionTrace(trace, role, dshChildStarted(new Date().toISOString()))
      return run
    })
  }

  async #recordRunDshEvent(root, runId, role, event) {
    const projected = projectDshSessionEvent(event, new Date().toISOString())
    if (!projected) return
    await this.#mutateRun(root, runId, (run) => {
      appendDshSessionTrace(ensureDshTrace(run), role, projected)
      return run
    })
  }

  async #technicalQc(agent, root, run) {
    const detail = await this.projectsStore.get(agent, { projectId: run.projectId })
    if (detail.revision !== run.expectedRevision) fail('SPOKEN_VIDEO_REVISION_CONFLICT', '视频已更新，已取消旧版本的技术质检。')
    const voiceover = detail.artifacts?.voiceover?.data
    const subtitles = detail.artifacts?.subtitles?.data || null
    const video = detail.artifacts?.video?.data
    const subtitleEnabled = video.subtitleEnabled !== false
    if (!voiceover?.audio?.file || !video?.video?.file || (subtitleEnabled && !subtitles?.cueCount)) fail('SPOKEN_VIDEO_STAGE_BLOCKED', subtitleEnabled ? '缺少视频、配音或字幕，不能进行技术质检。' : '缺少视频或配音，不能进行技术质检。')
    const [audioProbe, videoProbe] = await Promise.all([
      this.#probe(await this.#file(root, voiceover.audio.file, '配音文件')),
      this.#probe(await this.#file(root, video.video.file, '视频文件')),
    ])
    const technical = buildTechnicalReport({ video: videoProbe, audio: audioProbe, subtitles, subtitleEnabled, orientation: video.orientation })
    const reportFile = `media/qc/${run.id}.json`
    await this.#write(root, reportFile, `${JSON.stringify({ generatedAt: new Date().toISOString(), projectId: run.projectId, ...technical }, null, 2)}\n`)
    const committed = await this.projectsStore.commitProduced(agent, {
      projectId: run.projectId,
      expectedRevision: run.expectedRevision,
      stage: 'qc',
      idempotencyKey: `media-${run.id}`,
      source: 'spoken-video/ffprobe',
      payload: { mode: 'automatic', reportFile, technical, passed: technical.passed },
    })
    return { project: committed.project, artifact: committed.artifact, technical }
  }

  async readMedia(agent, request) {
    const input = object(request, '读取媒体请求')
    const id = projectId(input.projectId)
    const stage = text(input.stage, '媒体阶段', 20)
    if (!['voiceover', 'video'].includes(stage)) fail('SPOKEN_VIDEO_MEDIA_INVALID_INPUT', '只可读取配音或视频预览。')
    const detail = await this.projectsStore.get(agent, { projectId: id })
    const root = await projectRootFor(agent, id)
    const data = detail.artifacts?.[stage]?.data
    const descriptor = stage === 'voiceover' ? data?.audio : data?.video
    if (!descriptor?.file || !descriptor?.mediaType) fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', '当前阶段没有可预览媒体。')
    const file = await this.#file(root, descriptor.file, '预览媒体')
    const info = await stat(file)
    if (info.size > MAX_MEDIA_BYTES) fail('SPOKEN_VIDEO_MEDIA_FILE_TOO_LARGE', '媒体文件超过浏览器预览的 80 MiB 限制。')
    return { file: descriptor.file, mediaType: descriptor.mediaType, bytes: info.size, data: (await readFile(file)).toString('base64') }
  }
}
