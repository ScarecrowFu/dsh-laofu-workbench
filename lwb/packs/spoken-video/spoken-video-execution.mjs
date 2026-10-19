import { createHash } from 'node:crypto'
import { readFile, realpath, stat, readdir } from 'node:fs/promises'
import { resolve, relative, isAbsolute, sep, extname } from 'node:path'
import { spokenVideoDataPath } from './spoken-video-paths.mjs'
import { displayValue } from './spoken-video-redact.mjs'
import { expandAssistantStream } from '@deepseek-ai/dsh-llm'

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u
const KINDS = {
  topic: ['topic-generations.json', 'generations', '选题策划'],
  script: ['script-generations.json', 'generations', '口播写稿'],
  audio: ['audio-tasks.json', 'tasks', '配音与字幕'],
  publish: ['publish-tasks.json', 'tasks', '发布资料'],
  account: ['account-generations.json', 'generations', '账号定位'],
  source: ['signals.json', 'runs', '信号采集'],
}
export { displayValue }

export function executionEvent(record, label, { status = 'done', detail = null, actor = '主机', phase = null } = {}) {
  const events = record.executionEvents ||= []
  events.push({ id: `execution-${events.length + 1}`, at: new Date().toISOString(), label, status, actor, phase, detail: displayValue(detail) })
}

const PHASES = { preparing: '准备素材', directing: 'DSH 视觉创作', preflight: '工程预检', rendering: 'Remotion 渲染', 'technical-qc': '技术质检', 'editorial-review': 'DSH 独立审片', committing: '保存成片', completed: '制作完成', agent: 'DSH 生成发布文案', covers: '封面生图', ready: '发布资料就绪' }
export function executionTransition(before, next, actor) {
  const states = { queued: '任务已提交', running: '开始执行', succeeded: '执行完成', completed: '执行完成', failed: '执行失败' }
  if (before.status !== next.status && states[next.status]) executionEvent(next, states[next.status], { actor, status: next.status === 'failed' ? 'error' : ['running', 'queued'].includes(next.status) ? 'running' : 'done', detail: next.error || null })
  if (before.phase !== next.phase && PHASES[next.phase]) executionEvent(next, PHASES[next.phase], { actor: next.phase === 'directing' || next.phase === 'editorial-review' || next.phase === 'agent' ? 'DSH' : actor, status: ['completed', 'ready'].includes(next.phase) ? 'done' : 'running', phase: next.phase })
  if (before.subtitle?.status !== next.subtitle?.status && next.subtitle?.status) executionEvent(next, `字幕 · ${states[next.subtitle.status] || next.subtitle.status}`, { actor: '字幕服务', status: next.subtitle.status === 'failed' ? 'error' : next.subtitle.status === 'succeeded' ? 'done' : 'running', detail: next.subtitle.error || null })
  if (next.subtitle?.current && before.subtitle?.current?.id !== next.subtitle.current.id) {
    next.subtitle.history = [...(before.subtitle?.history || []), ...(before.subtitle?.current ? [before.subtitle.current] : [])]
    executionEvent(next, next.subtitle.current.mode === 'manual' ? '字幕校对已保存' : '时间轴字幕已保存', { actor: next.subtitle.current.mode === 'manual' ? '人工操作' : '字幕服务', detail: { version: next.subtitle.current.id, cueCount: next.subtitle.current.cueCount } })
  }
}

function inside(root, target) {
  const path = relative(root, target)
  return path && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

/** Resolve only known record/asset paths inside the host-owned workspace, including symlinks. */
export async function executionFile(context, file) {
  const workspace = await realpath(context.workspacePath)
  const root = await realpath(spokenVideoDataPath(workspace))
  if (!inside(workspace, root)) throw new Error('执行数据目录越界。')
  const target = await realpath(resolve(root, file))
  if (!inside(root, target)) throw new Error('执行文件不属于该能力包。')
  return target
}

async function readJson(context, file) {
  try { return JSON.parse(await readFile(await executionFile(context, file), 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
}

/** Resolve the immutable artifact saved by a media run, never the current stage. */
export async function mediaRunArtifact(context, record, projectId = record.projectId) {
  const pointer = record.result?.artifact
  if (pointer?.data) return pointer.data
  if (!pointer?.file) return null
  if (!/^[a-f0-9-]{36}$/iu.test(projectId || '') || !/^artifacts\/[A-Za-z0-9._-]+\.json$/u.test(pointer.file)) throw new Error('媒体任务产物路径无效。')
  const artifact = await readJson(context, `projects/${projectId}/${pointer.file}`)
  if (!artifact) return null
  if (artifact.id !== pointer.id || artifact.stage !== record.type || artifact.projectId !== projectId) throw new Error('媒体任务产物与记录不匹配。')
  return artifact.data
}

function descriptor(request) {
  if (!request || !ID.test(request.id || '')) throw new Error('执行任务标识无效。')
  if (request.kind === 'media') {
    if (!/^[a-f0-9-]{36}$/iu.test(request.projectId || '')) throw new Error('项目标识无效。')
    return [`projects/${request.projectId}/media/runs.json`, 'runs', '媒体制作']
  }
  if (!KINDS[request.kind]) throw new Error('不支持的执行任务类型。')
  return KINDS[request.kind]
}

export async function executionList(context, request) {
  if (!['account', 'publish'].includes(request?.kind)) throw new Error('不支持的历史记录类型。')
  const [file, key, title] = KINDS[request.kind]
  const data = await readJson(context, file)
  return (data?.[key] || []).filter((record) => !request.projectId || record.projectId === request.projectId)
    .sort((a, b) => String(b.createdAt || b.startedAt).localeCompare(String(a.createdAt || a.startedAt))).slice(0, 100).map((record) => ({ id: record.id, kind: request.kind, title: record.projectTitle || record.input?.name || title, status: record.status, createdAt: record.createdAt || record.startedAt }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
}

export async function executionDetail(context, request) {
  const [file, key, fallbackTitle] = descriptor(request)
  const data = await readJson(context, file)
  const record = data?.[key]?.find((item) => item.id === request.id)
  if (!record) throw new Error('该执行记录已不存在或未保存。')
  if (request.kind === 'media' && record.result?.artifact) {
    const artifact = await mediaRunArtifact(context, record, request.projectId)
    if (artifact) record.result.artifact = { ...record.result.artifact, data: artifact }
  }
  const title = request.kind === 'media' ? ({ voiceover: '配音生成', subtitles: '字幕生成', video: '视频制作', qc: '技术质检' })[record.type] || fallbackTitle : fallbackTitle
  const sessions = record.dsh?.sessions?.length ? record.dsh.sessions : record.dsh?.childSessionId
    ? [{ role: 'agent', label: title, childSessionId: record.dsh.childSessionId, parentSessionId: record.dsh.parentSessionId }] : []
  const result = { kind: request.kind, id: record.id, projectId: request.projectId || record.projectId || record.source?.projectId || null,
    title: record.projectTitle || record.source?.title || record.input?.name || title, moduleLabel: title,
    status: record.status, createdAt: record.createdAt || record.startedAt || record.completedAt,
    completedAt: record.completedAt || null, record, sessions: sessions.filter((item) => item.childSessionId && item.parentSessionId).map(({ role, label, childSessionId, parentSessionId }) => ({ role, label, childSessionId, parentSessionId })), assets: [] }
  // Old publish tasks refer to immutable packaging artifacts, never to the project's current pointer.
  if (request.kind === 'publish' && !record.result && record.projectId) {
    try {
      const dir = await executionFile(context, `projects/${record.projectId}/artifacts`)
      for (const name of (await readdir(dir)).filter((name) => /-packaging-.*\.json$/u.test(name))) {
        const artifact = await readJson(context, `projects/${record.projectId}/artifacts/${name}`)
        if (record.resultRevision ? artifact?.revision === record.resultRevision : artifact?.data?.taskId === record.id) { record.result = artifact.data; break }
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  const base = request.kind === 'audio' ? '' : result.projectId ? `projects/${result.projectId}/` : ''
  const asset = (label, candidate, type) => {
    const path = typeof candidate === 'string' ? candidate : candidate?.file
    if (path && typeof path === 'string') result.assets.push({ id: createHash('sha256').update(`${type}:${base}${path}`).digest('hex').slice(0, 24), label, file: `${base}${path}`, type })
  }
  const produced = record.result?.artifact?.data || record.result
  asset('配音', record.result?.audio || record.source?.voiceover?.audio, 'audio')
  asset('成片', record.result?.video, 'video')
  asset('字幕 SRT', record.subtitle?.current?.file || produced?.srtFile, 'text')
  const packaging = record.result?.covers ? record.result : record.result?.artifact?.data
  asset('横版封面', packaging?.covers?.landscape, 'image')
  asset('竖版封面', packaging?.covers?.portrait, 'image')
  const technical = record.pipeline?.technical || record.result?.qc?.technical || record.result?.technical
  for (const [i, frame] of (technical?.sampledFrames || []).entries()) asset(`审片抽帧 · ${technical.sampledTimestamps?.[i] ?? i} 秒`, frame, 'image')
  asset('技术质检报告', record.pipeline?.technicalReportFile || record.result?.qc?.reportFile, 'text')
  asset('独立审片报告', record.pipeline?.reviewReportFile || record.result?.qc?.reviewFile, 'text')
  asset('创意工程', record.result?.remotion?.creativeFile || (record.pipeline?.workspaceDir ? `${record.pipeline.workspaceDir}/src/CreativeVideo.tsx` : null), 'text')
  asset('渲染日志', record.pipeline?.workspaceDir ? `${record.pipeline.workspaceDir}/outputs/render.log` : null, 'text')
  return displayValue(result)
}

export async function executionAsset(context, request) {
  const detail = await executionDetail(context, request)
  const asset = detail.assets.find((item) => item.id === request.assetId)
  if (!asset) throw new Error('产物不属于该任务。')
  const path = await executionFile(context, asset.file).catch((error) => { if (error.code === 'ENOENT') throw new Error('该产物尚未生成或文件已被移除。'); throw error })
  const info = await stat(path)
  if (!info.isFile() || info.size > (asset.type === 'text' ? 2 : 80) * 1024 * 1024) throw new Error('产物过大，无法在详情内预览。')
  const mediaType = { '.mp4': 'video/mp4', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[extname(path).toLowerCase()] || 'application/octet-stream'
  return asset.type === 'text' ? { ...asset, text: displayValue(await readFile(path, 'utf8')) } : { ...asset, mediaType, data: (await readFile(path)).toString('base64') }
}

export async function executionAddress(context, request) {
  const detail = await executionDetail(context, request)
  const session = detail.sessions.find((item) => item.role === request.role)
  if (!session) throw new Error('该阶段没有可读取的 DSH 会话。')
  // The history reader only needs durable lineage. DSH 0.2.1 creates
  // `startActivation` children as continuable, while older `start` children
  // were one-shot; `unknown` skips the descriptor-mode equality check without
  // weakening the parent/child authorization above.
  return { kind: 'subagent', parentSessionId: session.parentSessionId, childSessionId: session.childSessionId, mode: 'unknown' }
}

// Keep the native stream/cursors and their settlement semantics. Request headers,
// system configuration, and opaque events aren't needed by a task transcript.
export function executionFrame(frame) {
  const event = (item) => {
    const { type, seq, time, data } = item
    if (!['user/message', 'assistant/message', 'assistant/attempt', 'tool/call', 'tool/result', 'step/start', 'step/end', 'turn/start', 'turn/end', 'llm/retry-started', 'llm/retry', 'approval/asked', 'approval/decided'].includes(type)) return { type: 'execution/omitted', seq, time, data: {} }
    return { type, seq, time, data: displayValue(type === 'assistant/attempt' ? { ...data, stream: undefined, chunks: expandAssistantStream(data.stream || []).map((item) => item.chunk) } : data) }
  }
  if (frame.type === 'snapshot') {
    const stream = frame.assistantStream
    const active = stream?.activeAttempt
    return { type: frame.type, cursor: frame.cursor, hasMore: frame.hasMore, records: frame.records.map((item) => ({ type: 'event', event: event(item.event) })), assistantStream: active ? displayValue({ ...stream, activeAttempt: { ...active, stream: undefined, chunks: expandAssistantStream(active.stream).map((item) => item.chunk) } }) : stream }
  }
  if (frame.type === 'event') return { type: frame.type, event: event(frame.event) }
  if (frame.type === 'assistant-stream') return displayValue(frame)
  return { records: frame.records.map((item) => ({ type: 'event', event: event(item.event) })), hasMore: frame.hasMore }
}
