import { validateSrt } from './spoken-video-subtitles.mjs'

export const MEDIA_OPERATION_TYPES = Object.freeze(['voiceover', 'subtitles', 'video', 'qc'])
export const MEDIA_OPERATION_STATES = Object.freeze(['queued', 'running', 'succeeded', 'failed'])
export const MEDIA_PROVIDERS = Object.freeze(['lwb', 'bailian', 'legacy'])
export const MEDIA_CONNECTION_PROVIDERS = Object.freeze(['lwb', 'bailian'])
export const VIDEO_ORIENTATIONS = Object.freeze(['portrait', 'landscape'])
export const MEDIA_PROVIDER_CREDENTIAL_REFS = Object.freeze({
  bailian: 'DASHSCOPE_API_KEY',
})
export const VOICE_SOURCES = Object.freeze(['system', 'upload', 'reference', 'preset'])
export const DEFAULT_VOICE_PROFILE = Object.freeze({
  id: 'tiffy-confident',
  name: 'Tiffy - 自信',
  file: 'assets/voices/tiffy-confident.mp3',
  mediaType: 'audio/mpeg',
})
export const DEFAULT_VIDEO_VISUAL_BRIEF = '由 AI 视觉导演根据稿件语义完成主题化 Remotion 画面。'
export const DEFAULT_VIDEO_BGM_VOLUME = 0.12

export class SpokenVideoMediaError extends Error {
  constructor(code, message) {
    super(`Error [${code}] ${message}`)
    this.code = code
  }
}

function fail(code, message) {
  return new SpokenVideoMediaError(code, message)
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('SPOKEN_VIDEO_MEDIA_INVALID_INPUT', `${label}必须是对象。`)
  return value
}

function text(value, label, maximum, required = true) {
  if ((value === undefined || value === null) && !required) return undefined
  if (typeof value !== 'string') throw fail('SPOKEN_VIDEO_MEDIA_INVALID_INPUT', `${label}必须是文本。`)
  const result = value.trim()
  if (!result || result.length > maximum) throw fail('SPOKEN_VIDEO_MEDIA_INVALID_INPUT', `${label}长度必须在 1-${maximum} 之间。`)
  return result
}

function number(value, label, minimum, maximum, fallback) {
  if (value === undefined || value === null) return fallback
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw fail('SPOKEN_VIDEO_MEDIA_INVALID_INPUT', `${label}必须在 ${minimum}-${maximum} 之间。`)
  return Number(value)
}

function optionalText(value, label, maximum) {
  return value === undefined || value === null || (typeof value === 'string' && !value.trim())
    ? null
    : text(value, label, maximum)
}

function oneOf(value, label, choices, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  const result = text(value, label, 80).toLowerCase()
  if (!choices.includes(result)) throw fail('SPOKEN_VIDEO_MEDIA_INVALID_INPUT', `${label}不受支持。`)
  return result
}

function outputFormat(value, label, fallback = null) {
  const result = optionalText(value, label, 12)
  if (!result) return fallback
  const format = result.toLowerCase()
  if (!['wav', 'mp3', 'm4a', 'ogg'].includes(format)) {
    throw fail('SPOKEN_VIDEO_MEDIA_INVALID_INPUT', `${label}只支持 wav、mp3、m4a 或 ogg。`)
  }
  return format
}

function endpoint(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  let parsed
  try {
    parsed = new URL(value.trim())
  } catch {
    throw fail('SPOKEN_VIDEO_MEDIA_CONFIG_INVALID', 'TTS 服务地址必须是 HTTP(S) URL。')
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw fail('SPOKEN_VIDEO_MEDIA_CONFIG_INVALID', 'TTS 服务地址无效。')
  }
  return parsed.toString().replace(/\/$/u, '')
}

function websocketEndpoint(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  let parsed
  try {
    parsed = new URL(value.trim())
  } catch {
    throw fail('SPOKEN_VIDEO_MEDIA_CONFIG_INVALID', '百炼 ASR 地址必须是 WebSocket URL。')
  }
  if (!['ws:', 'wss:', 'http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw fail('SPOKEN_VIDEO_MEDIA_CONFIG_INVALID', '百炼 ASR 地址无效。')
  }
  if (parsed.protocol === 'http:') parsed.protocol = 'ws:'
  if (parsed.protocol === 'https:') parsed.protocol = 'wss:'
  return parsed.toString().replace(/\/$/u, '')
}

/** Reads only operator-owned environment configuration. Browser input never supplies an endpoint or credential. */
export function mediaServiceConfig(environment = process.env) {
  const baseUrl = endpoint(environment.LWB_SPOKEN_VIDEO_TTS_BASE_URL || environment.TTS_SERVICE_BASE_URL)
  const scitigerBaseUrl = endpoint(environment.LWB_SPOKEN_VIDEO_SCITIGER_BASE_URL || environment.SCITIGER_BASE_URL || 'https://link.lwb.cn')
  const bailianBaseUrl = endpoint(environment.LWB_SPOKEN_VIDEO_BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/api/v1')
  return {
    baseUrl,
    configured: Boolean(baseUrl),
    userId: optionalText(environment.LWB_SPOKEN_VIDEO_TTS_USER_ID || environment.TTS_USER_ID, 'TTS 用户标识', 120),
    provider: optionalText(environment.LWB_SPOKEN_VIDEO_TTS_PROVIDER || environment.TTS_PROVIDER, 'TTS 提供方', 80) || 'cosyvoice',
    outputFormat: outputFormat(environment.LWB_SPOKEN_VIDEO_TTS_OUTPUT_FORMAT || environment.TTS_OUTPUT_FORMAT, 'TTS 输出格式', 'wav'),
    bailianBaseUrl,
    bailianAsrWebSocketUrl: websocketEndpoint(environment.LWB_SPOKEN_VIDEO_BAILIAN_ASR_WS_URL || 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime'),
    bailianAsrModel: optionalText(environment.LWB_SPOKEN_VIDEO_BAILIAN_ASR_MODEL, '百炼 ASR 模型', 120) || 'qwen3-asr-flash-realtime',
    bailianModel: optionalText(environment.LWB_SPOKEN_VIDEO_BAILIAN_TTS_MODEL, '百炼 TTS 模型', 120) || 'qwen-audio-3.1-tts-plus',
    bailianDefaultVoice: optionalText(environment.LWB_SPOKEN_VIDEO_BAILIAN_DEFAULT_VOICE, '百炼默认音色', 80) || 'longanhuan_v3.1',
    bailianVoiceEnrollmentModel: optionalText(environment.LWB_SPOKEN_VIDEO_BAILIAN_VOICE_ENROLLMENT_MODEL, '百炼声音复刻模型', 120) || 'voice-enrollment',
    bailianVoiceCloneModel: optionalText(environment.LWB_SPOKEN_VIDEO_BAILIAN_VOICE_CLONE_MODEL, '百炼复刻 TTS 模型', 120) || 'qwen-audio-3.1-tts-plus',
  }
}

export function normalizeVoiceoverRequest(value) {
  const input = object(value ?? {}, '配音请求')
  const provider = oneOf(input.provider, '生成方式', MEDIA_PROVIDERS, 'lwb')
  const voiceSource = oneOf(input.voiceSource, '音色来源', VOICE_SOURCES, 'system')
  const voiceId = optionalText(input.voiceId, '音色标识', 160)
  if (voiceSource === 'preset' && !voiceId) {
    throw fail('SPOKEN_VIDEO_MEDIA_INVALID_INPUT', '指定预置音色时必须填写音色标识。')
  }
  // A preset voice is a Bailian system voice ID. Sending it to another
  // provider would pass a foreign identifier as that service's own voice, so
  // reject the combination instead of letting it fail upstream.
  if (voiceSource === 'preset' && provider !== 'bailian') {
    throw fail('SPOKEN_VIDEO_MEDIA_INVALID_INPUT', '预置音色仅适用于百炼渠道，请切换到百炼后重试。')
  }
  const referenceInput = input.referenceAudio == null ? null : object(input.referenceAudio, '参考音频')
  const referenceAudio = referenceInput ? {
    id: optionalText(referenceInput.id, '参考音频标识', 64),
    file: optionalText(referenceInput.file, '参考音频文件', 280),
    name: optionalText(referenceInput.name, '参考音频名称', 255),
    mediaType: optionalText(referenceInput.mediaType, '参考音频类型', 80),
  } : null
  if (voiceSource === 'upload' && (!referenceAudio?.id || !referenceAudio.file || !referenceAudio.name || !referenceAudio.mediaType)) {
    throw fail('SPOKEN_VIDEO_MEDIA_INVALID_INPUT', '使用自定义音色时请先上传参考音频。')
  }
  return {
    provider,
    voiceSource,
    voiceId,
    voiceName: optionalText(input.voiceName, '音色名称', 120)
      || (voiceSource === 'upload' ? referenceAudio.name : ['system', 'reference'].includes(voiceSource) ? DEFAULT_VOICE_PROFILE.name : null),
    referenceAudio: voiceSource === 'upload' ? referenceAudio : null,
    outputFormat: outputFormat(input.outputFormat, '输出格式'),
    rate: number(input.rate, '语速', 0.5, 2, 1),
    volume: number(input.volume, '音量', 0, 2, 1),
    pitch: number(input.pitch, '音高', -12, 12, 0),
  }
}

export function normalizeSubtitleRequest(value) {
  const input = object(value ?? {}, '字幕请求')
  return {
    provider: oneOf(input.provider, '生成方式', MEDIA_PROVIDERS, 'lwb'),
    language: optionalText(input.language, '字幕语言', 16) || 'zh',
    aiOptimize: input.aiOptimize === true,
  }
}

export function mediaCredentialRef(provider) {
  const normalized = oneOf(provider, '生成方式', MEDIA_CONNECTION_PROVIDERS, null)
  if (!MEDIA_PROVIDER_CREDENTIAL_REFS[normalized]) throw fail('SPOKEN_VIDEO_MEDIA_INVALID_INPUT', '该生成方式不支持保存 API Key。')
  return MEDIA_PROVIDER_CREDENTIAL_REFS[normalized]
}

export function normalizeRenderRequest(value) {
  const input = object(value ?? {}, '视频渲染请求')
  const renderer = optionalText(input.renderer, '渲染器', 40) || 'remotion'
  if (!['remotion', 'local-ffmpeg'].includes(renderer)) throw fail('SPOKEN_VIDEO_MEDIA_INVALID_INPUT', '渲染器只支持 remotion 或 local-ffmpeg。')
  const orientation = oneOf(input.orientation, '视频方向', VIDEO_ORIENTATIONS, 'landscape')
  const requestedBrief = optionalText(input.visualBrief, '画面制作说明', 6000)
  const backgroundMusicInput = input.backgroundMusic == null ? null : object(input.backgroundMusic, '背景音乐')
  const backgroundMusic = backgroundMusicInput ? {
    id: optionalText(backgroundMusicInput.id, '背景音乐标识', 64),
    file: optionalText(backgroundMusicInput.file, '背景音乐文件', 280),
    name: optionalText(backgroundMusicInput.name, '背景音乐名称', 255),
    mediaType: optionalText(backgroundMusicInput.mediaType, '背景音乐类型', 80),
    bytes: number(backgroundMusicInput.bytes, '背景音乐字节数', 1, 20 * 1024 * 1024, null),
    durationSeconds: number(backgroundMusicInput.durationSeconds, '背景音乐时长', 0.01, 36_000, null),
  } : null
  if (backgroundMusic && (!backgroundMusic.id || !backgroundMusic.file || !backgroundMusic.name || !backgroundMusic.mediaType)) {
    throw fail('SPOKEN_VIDEO_MEDIA_INVALID_INPUT', '使用背景音乐时请先完成 BGM 上传。')
  }
  if (backgroundMusic && !/^media\/bgm-uploads\/[a-f0-9]{32}\.(?:mp3|wav|m4a|ogg)$/u.test(backgroundMusic.file)) {
    throw fail('SPOKEN_VIDEO_MEDIA_FILE_INVALID', '背景音乐引用无效。')
  }
  if (backgroundMusic && renderer !== 'remotion') {
    throw fail('SPOKEN_VIDEO_MEDIA_INVALID_INPUT', '背景音乐仅支持 Remotion 视频任务。')
  }
  return {
    visualBrief: ['默认信息型竖屏口播版式。', '默认信息型口播版式。'].includes(requestedBrief) ? DEFAULT_VIDEO_VISUAL_BRIEF : requestedBrief || DEFAULT_VIDEO_VISUAL_BRIEF,
    renderer,
    orientation,
    subtitleEnabled: input.subtitleEnabled !== false,
    backgroundMusic,
    bgmVolume: backgroundMusic ? number(input.bgmVolume, 'BGM 音量', 0, 0.5, DEFAULT_VIDEO_BGM_VOLUME) : null,
  }
}

export function serviceHeaders(config) {
  return {
    'Content-Type': 'application/json',
    ...(config.userId ? { 'X-User-Id': config.userId } : {}),
  }
}

export function serviceData(body, operation) {
  if (!body || body.code !== 200) {
    const detail = typeof body?.message === 'string' ? body.message : '服务没有返回成功结果'
    throw fail('SPOKEN_VIDEO_MEDIA_SERVICE_FAILED', `${operation}失败：${detail}`)
  }
  if (!body.data || typeof body.data !== 'object') throw fail('SPOKEN_VIDEO_MEDIA_SERVICE_FAILED', `${operation}没有返回有效数据。`)
  return body.data
}

export function taskIdFromService(data, operation) {
  return text(data?.task_id, `${operation}任务标识`, 200)
}

export function taskState(data, operation) {
  const status = text(data?.status, `${operation}任务状态`, 40).toLowerCase()
  if (!['queued', 'pending', 'processing', 'running', 'completed', 'failed', 'cancelled'].includes(status)) {
    throw fail('SPOKEN_VIDEO_MEDIA_SERVICE_FAILED', `${operation}返回了未知任务状态。`)
  }
  return status
}

export function subtitleResult(data) {
  const result = data?.result && typeof data.result === 'object' && !Array.isArray(data.result) ? data.result : null
  const segments = Array.isArray(result?.subtitle_segments) && result.subtitle_segments.length
    ? result.subtitle_segments
    : Array.isArray(data?.subtitle_segments) && data.subtitle_segments.length
      ? data.subtitle_segments
      : null
  const raw = segments
    ? srtFromSubtitleSegments(segments)
    : typeof result?.subtitle_srt === 'string'
      ? result.subtitle_srt
      : typeof data?.subtitle_srt === 'string'
        ? data.subtitle_srt
        : typeof result?.subtitle_srt_base64 === 'string'
          ? Buffer.from(result.subtitle_srt_base64, 'base64').toString('utf8')
          : typeof data?.subtitle_srt_base64 === 'string'
            ? Buffer.from(data.subtitle_srt_base64, 'base64').toString('utf8')
            : ''
  const srt = raw.replace(/^\uFEFF/u, '').trim()
  const checked = validateSrt(srt)
  if (!srt || checked.errors.length) {
    const detail = checked.errors.length ? checked.errors.join(' ') : '服务没有返回字幕内容。'
    throw fail('SPOKEN_VIDEO_SUBTITLES_INVALID', `自动对齐字幕不可用：${detail}`)
  }
  return { srt: `${srt}\n`, cueCount: checked.cues.length }
}

function srtFromSubtitleSegments(segments) {
  const rows = segments.map((segment, position) => {
    const start = Number(segment?.start_time)
    const end = Number(segment?.end_time)
    const caption = typeof segment?.text === 'string' ? segment.text.trim() : ''
    const label = `第 ${position + 1} 条字幕`
    if (!Number.isFinite(start) || start < 0 || !Number.isFinite(end) || end <= start || !caption) {
      throw fail('SPOKEN_VIDEO_SUBTITLES_INVALID', `自动对齐字幕不可用：${label}时间或文本无效。`)
    }
    return { start: Math.round(start), end: Math.round(end), caption, position }
  }).sort((left, right) => left.start - right.start || left.end - right.end || left.position - right.position)
  return rows.map((row, index) => `${index + 1}\n${srtTimestamp(row.start)} --> ${srtTimestamp(row.end)}\n${row.caption}`).join('\n\n')
}

function srtTimestamp(milliseconds) {
  const total = Math.max(0, Math.round(milliseconds))
  const hours = Math.floor(total / 3_600_000)
  const minutes = Math.floor((total % 3_600_000) / 60_000)
  const seconds = Math.floor((total % 60_000) / 1_000)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(total % 1_000).padStart(3, '0')}`
}

function fps(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parts = String(value || '').split('/').map(Number)
  return parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]) && parts[1] !== 0 ? parts[0] / parts[1] : null
}

export function normalizeProbe(value) {
  const streams = Array.isArray(value?.streams) ? value.streams : []
  const video = streams.find((stream) => stream?.codec_type === 'video' && Number(stream?.disposition?.attached_pic || 0) !== 1) || null
  const audio = streams.find((stream) => stream?.codec_type === 'audio') || null
  const duration = Number(value?.format?.duration || video?.duration || audio?.duration || 0)
  const sampleRate = Number(audio?.sample_rate || 0)
  const videoFps = video ? fps(video.avg_frame_rate || video.r_frame_rate) : null
  const declaredFrames = Number(video?.nb_frames || 0)
  return {
    durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null,
    width: Number.isSafeInteger(video?.width) && video.width > 0 ? video.width : null,
    height: Number.isSafeInteger(video?.height) && video.height > 0 ? video.height : null,
    fps: videoFps,
    frameCount: Number.isSafeInteger(declaredFrames) && declaredFrames > 0 ? declaredFrames : videoFps && Number.isFinite(duration) && duration > 0 ? Math.round(videoFps * duration) : null,
    hasAudio: Boolean(audio),
    sampleRate: Number.isSafeInteger(sampleRate) && sampleRate > 0 ? sampleRate : null,
    videoCodec: typeof video?.codec_name === 'string' ? video.codec_name : null,
    audioCodec: typeof audio?.codec_name === 'string' ? audio.codec_name : null,
  }
}

/** Deterministic release gate for media topology and subtitle availability. */
export function buildTechnicalReport({ video, audio, subtitles, subtitleEnabled = true, orientation = 'portrait' }) {
  const issues = []
  const warnings = []
  const landscape = orientation === 'landscape'
  const expectedWidth = landscape ? 1920 : 1080
  const expectedHeight = landscape ? 1080 : 1920
  if (!video?.durationSeconds) issues.push('视频没有可识别的时长。')
  if (video?.width !== expectedWidth || video?.height !== expectedHeight) issues.push(`视频必须为 ${expectedWidth}x${expectedHeight} ${landscape ? '横屏' : '竖屏'}。`)
  if (!video?.fps || Math.abs(video.fps - 30) > 0.1) issues.push('视频必须为 30fps。')
  if (!video?.hasAudio) issues.push('视频缺少音轨。')
  if (audio?.durationSeconds && video?.durationSeconds && Math.abs(audio.durationSeconds - video.durationSeconds) > 2) {
    issues.push('视频与配音时长差超过 2 秒。')
  }
  if (subtitleEnabled && !subtitles?.cueCount) issues.push('视频没有可用字幕。')
  return {
    passed: issues.length === 0,
    issues,
    warnings,
    video,
    audio,
    subtitles: { enabled: subtitleEnabled, cueCount: subtitles?.cueCount || 0, warnings },
  }
}
