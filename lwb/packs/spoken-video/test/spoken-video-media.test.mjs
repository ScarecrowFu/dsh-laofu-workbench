import { lwbAccountFixture } from './lwb-account-fixture.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { WebSocketServer } from 'ws'
import { buildTechnicalReport, DEFAULT_VIDEO_VISUAL_BRIEF, DEFAULT_VOICE_PROFILE, mediaServiceConfig, normalizeProbe, normalizeRenderRequest, normalizeVoiceoverRequest, subtitleResult } from '../spoken-video-media.mjs'
import { SpokenVideoProjectStore, SpokenVideoStoreError } from '../spoken-video-store.mjs'
import { SpokenVideoMediaHost } from '../spoken-video-media-host.mjs'
import { remotionEncodingSettings, remotionRendererAvailable } from '../spoken-video-remotion.mjs'
import { executionDetail, executionAsset } from '../spoken-video-execution.mjs'

function agent(cwd) { return { session: { header: { cwd } } } }

function credentialStore(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    async resolve(ref) {
      const value = values.get(ref)
      return value ? { value, source: 'file' } : undefined
    },
    async describe(ref) {
      return { configured: values.has(ref), source: values.has(ref) ? 'file' : undefined, writable: true }
    },
    async set(ref, value) { values.set(ref, value) },
    async unset(ref) { values.delete(ref) },
  }
}

function connectionSettings(provider = 'bailian') {
  let value = { provider }
  return {
    get: () => value,
    async update(next) { value = { ...value, ...next } },
  }
}

function mediaBinariesAvailable() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' })
    return true
  } catch { return false }
}

function withUnboundedBailianWavLengths(audio) {
  const result = Buffer.from(audio)
  result.writeUInt32LE(0x7fffffc7, 4)
  let offset = 12
  while (offset + 8 <= result.length) {
    const size = result.readUInt32LE(offset + 4)
    if (result.toString('ascii', offset, offset + 4) === 'data') {
      result.writeUInt32LE(0x7fffffc7, offset + 4)
      return result
    }
    offset += 8 + size + (size % 2)
  }
  throw new Error('测试 WAV 缺少 data 块。')
}

async function waitForOperation(host, currentAgent, projectId, operationId, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const run = (await host.operations(currentAgent, { projectId })).find((item) => item.id === operationId)
    if (run?.status === 'succeeded' || run?.status === 'failed') return run
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
  }
  throw new Error(`媒体任务 ${operationId} 在测试时未完成。`)
}

async function waitForAudioTask(host, currentAgent, taskId) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const task = await host.audioTask(currentAgent, { taskId })
    if (task.status === 'succeeded' || task.status === 'failed') return task
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
  }
  throw new Error(`音频任务 ${taskId} 在测试时未完成。`)
}

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'lwb-spoken-video-media-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const cwd = join(root, 'workspace')
  await mkdir(cwd)
  return cwd
}

async function projectWithApprovedScript(currentAgent, store) {
  let project = await store.create(currentAgent, { title: '自动媒体产物' })
  project = (await store.commit(currentAgent, { projectId: project.id, expectedRevision: project.revision, stage: 'topic', payload: { title: '自动媒体产物' }, idempotencyKey: 'media-topic-0001' })).project
  project = (await store.commit(currentAgent, { projectId: project.id, expectedRevision: project.revision, stage: 'script', payload: { body: '这是已确认的口播稿，用于验证自动媒体产物。' }, idempotencyKey: 'media-script-0001' })).project
  return store.approveScript(currentAgent, { projectId: project.id })
}

async function projectWithSavedScript(currentAgent, store) {
  let project = await store.create(currentAgent, { title: '自动媒体产物' })
  project = (await store.commit(currentAgent, { projectId: project.id, expectedRevision: project.revision, stage: 'topic', payload: { title: '自动媒体产物' }, idempotencyKey: 'media-saved-topic-0001' })).project
  return (await store.commit(currentAgent, { projectId: project.id, expectedRevision: project.revision, stage: 'script', payload: { body: '这是已保存的口播稿，用于验证自动媒体产物。' }, idempotencyKey: 'media-saved-script-0001' })).project
}

async function projectWithApprovedSavedScript(currentAgent, store) {
  const project = await projectWithSavedScript(currentAgent, store)
  return store.approveScript(currentAgent, { projectId: project.id })
}

function agentWorkspaceFromPrompt(prompt) {
  const match = String(prompt).match(/任务工作目录：([^\n]+)/u)
  if (!match) throw new Error('测试未收到视频 Agent 工作目录。')
  return match[1].trim()
}

function testCreativeSource() {
  return `import React from "react";
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from "remotion";

export type SubtitleCue = {id: string; startMs: number; endMs: number; text: string};
export type CreativeVideoProps = {title: string; script: string; durationSeconds: number; orientation: "portrait" | "landscape"; subtitleEnabled: boolean; subtitles: SubtitleCue[]};

const palette = {paper: "#f5f2e9", ink: "#17242b", mint: "#2e8b78", coral: "#db6651", yellow: "#efbd4b"};
export const CreativeVideo: React.FC<CreativeVideoProps> = ({title, orientation}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const progress = frame / Math.max(1, durationInFrames - 1);
  const entered = interpolate(frame, [0, 12], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const portrait = orientation === "portrait";
  const bars = [0.28, 0.5, 0.76].map((target, index) => Math.max(0.04, Math.min(target, progress * (1.8 + index * 0.2))));
  return <AbsoluteFill style={{background: palette.paper, color: palette.ink, padding: portrait ? 92 : 76, fontFamily: "PingFang SC, sans-serif", overflow: "hidden"}}>
    <div style={{fontSize: portrait ? 30 : 26, fontWeight: 700, color: palette.mint}}>AI VISUAL DIRECTOR / REMOTION</div>
    <div style={{display: "grid", gridTemplateColumns: portrait ? "1fr" : "1fr 1fr", gap: 46, flex: 1, alignItems: "center", opacity: entered, transform: \`translateY(\${(1 - entered) * 24}px)\`}}>
      <section><h1 style={{fontSize: portrait ? 82 : 68, lineHeight: 1.12, margin: 0, letterSpacing: 0}}>{title}</h1><p style={{fontSize: portrait ? 32 : 28, lineHeight: 1.5}}>从原始信息到可验证结论，画面用流程、对比和数据变化建立叙事。</p></section>
      <section style={{display: "grid", gap: 28}}>{bars.map((value, index) => <div key={index}><div style={{display: "flex", justifyContent: "space-between", fontSize: 24}}><span>{["输入", "判断", "结果"][index]}</span><strong>{Math.round(value * 100)}</strong></div><div style={{height: 30, background: "#d7d5cd", marginTop: 9}}><div style={{height: "100%", width: \`\${value * 100}%\`, background: [palette.mint, palette.coral, palette.yellow][index]}} /></div></div>)}</section>
    </div>
    <div style={{height: 8, width: \`\${progress * 100}%\`, background: palette.coral}} />
  </AbsoluteFill>;
};
`
}

async function withTestVoiceover(cwd, store, currentAgent, project, name, idempotencyKey) {
  const projectRoot = join(cwd, 'data', 'projects', project.id)
  const relativeFile = `media/voiceovers/${name}.wav`
  await mkdir(join(projectRoot, 'media', 'voiceovers'), { recursive: true })
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=1', '-c:a', 'pcm_s16le', join(projectRoot, relativeFile)], { stdio: 'ignore' })
  return (await store.commitProduced(currentAgent, {
    projectId: project.id, expectedRevision: project.revision, stage: 'voiceover', idempotencyKey, source: 'spoken-video/tts',
    payload: { mode: 'tts', provider: 'test', settings: { rate: 1, volume: 1, pitch: 0 }, audio: { file: relativeFile, mediaType: 'audio/wav', bytes: 88_278, durationSeconds: 1 } },
  })).project
}

async function fakeVideoCreator({ prompt, onDshStarted, onDshEvent }) {
  await onDshStarted({ childSessionId: 'creator-child-001', parentSessionId: 'video-parent-001' })
  await onDshEvent({ seq: 1, time: Date.now(), type: 'turn/start' })
  await writeFile(join(agentWorkspaceFromPrompt(prompt), 'src', 'CreativeVideo.tsx'), testCreativeSource())
  await onDshEvent({ seq: 2, time: Date.now(), type: 'turn/end', data: { reason: { kind: 'completed' } } })
  return { childSessionId: 'creator-child-001', output: 'completed' }
}

async function passingVideoReviewer({ prompt, onDshStarted, onDshEvent }) {
  await onDshStarted({ childSessionId: 'reviewer-child-001', parentSessionId: 'video-parent-001' })
  await onDshEvent({ seq: 1, time: Date.now(), type: 'turn/start' })
  const timestamps = [...String(prompt).matchAll(/- ([0-9.]+) 秒：/gu)].map((match) => Number(match[1]))
  return {
    passed: true, technicalPass: true, editorialPass: true, score: 88, summary: '构图、节奏与稿件语义一致。', findings: [],
    reviewEvidence: [
      { timestampSeconds: timestamps[0], observedMainVisual: '开场展示标题、流程标签和三组数据条。' },
      { timestampSeconds: timestamps.at(-1), observedMainVisual: '结尾数据条完成推进并形成清晰的结果收束。' },
    ],
  }
}

test('normalizes service configuration and rejects malformed generated subtitles', () => {
  const config = mediaServiceConfig({ LWB_SPOKEN_VIDEO_TTS_BASE_URL: 'http://127.0.0.1:8020/', LWB_SPOKEN_VIDEO_TTS_USER_ID: 'local-user' })
  assert.equal(config.baseUrl, 'http://127.0.0.1:8020')
  assert.equal(config.configured, true)
  assert.equal(mediaServiceConfig({ LWB_SPOKEN_VIDEO_TTS_OUTPUT_FORMAT: 'MP3' }).outputFormat, 'mp3')
  assert.equal(mediaServiceConfig({ LWB_SPOKEN_VIDEO_BAILIAN_ASR_WS_URL: 'wss://asr.example.com/realtime' }).bailianAsrWebSocketUrl, 'wss://asr.example.com/realtime')
  assert.throws(() => mediaServiceConfig({ LWB_SPOKEN_VIDEO_TTS_BASE_URL: 'file:///tmp/service' }), /CONFIG_INVALID/u)
  assert.throws(() => mediaServiceConfig({ LWB_SPOKEN_VIDEO_BAILIAN_ASR_WS_URL: 'file:///tmp/asr' }), /CONFIG_INVALID/u)
  assert.throws(() => mediaServiceConfig({ LWB_SPOKEN_VIDEO_TTS_OUTPUT_FORMAT: 'flac' }), /只支持 wav/u)
  assert.equal(subtitleResult({ subtitle_srt: '1\n00:00:00,000 --> 00:00:01,000\n你好' }).cueCount, 1)
  const structured = subtitleResult({
    subtitle_srt: '1\n00:00:00,000 --> 00:00:01,000\n旧字幕',
    status: 'completed',
    result: {
      subtitle_segments: [
        { index: 2, start_time: 1200, end_time: 2500, text: '第二条字幕' },
        { index: 1, start_time: 0, end_time: 600, text: '第一条字幕' },
      ],
    },
  })
  assert.equal(structured.cueCount, 2)
  assert.equal(structured.srt, '1\n00:00:00,000 --> 00:00:00,600\n第一条字幕\n\n2\n00:00:01,200 --> 00:00:02,500\n第二条字幕\n')
  assert.throws(() => subtitleResult({ subtitle_srt: '并不是 SRT' }), /SUBTITLES_INVALID/u)
})

test('defaults voiceover requests to the packaged Tiffy reference voice', () => {
  const request = normalizeVoiceoverRequest({ provider: 'lwb' })
  assert.equal(request.voiceSource, 'system')
  assert.equal(request.voiceName, DEFAULT_VOICE_PROFILE.name)
  assert.equal(request.voiceId, null)
  assert.equal(Object.hasOwn(request, 'apiKey'), false)
  assert.throws(() => normalizeVoiceoverRequest({ voiceSource: 'upload' }), /请先上传参考音频/u)
  const uploaded = normalizeVoiceoverRequest({ voiceSource: 'upload', referenceAudio: { id: 'voice-reference', file: 'voice-references/reference.wav', name: '我的音色.wav', mediaType: 'audio/wav' } })
  assert.equal(uploaded.voiceName, '我的音色.wav')
  assert.equal(uploaded.referenceAudio.file, 'voice-references/reference.wav')
  assert.throws(() => normalizeVoiceoverRequest({ voiceSource: 'preset' }), /必须填写音色标识/u)
})

test('allows an empty video brief and applies the protected default layout', () => {
  const request = normalizeRenderRequest({ visualBrief: '   ', subtitleEnabled: false })
  assert.equal(request.visualBrief, DEFAULT_VIDEO_VISUAL_BRIEF)
  assert.equal(request.renderer, 'remotion')
  assert.equal(request.orientation, 'landscape')
  assert.equal(request.subtitleEnabled, false)
  assert.equal(request.backgroundMusic, null)
  assert.equal(normalizeRenderRequest({ orientation: 'landscape' }).orientation, 'landscape')
  assert.equal(normalizeRenderRequest({ orientation: 'landscape', visualBrief: '默认信息型竖屏口播版式。' }).visualBrief, DEFAULT_VIDEO_VISUAL_BRIEF)
  assert.equal(normalizeRenderRequest({ visualBrief: '默认信息型口播版式。' }).visualBrief, DEFAULT_VIDEO_VISUAL_BRIEF)
  assert.throws(() => normalizeRenderRequest({ orientation: 'square' }), /视频方向不受支持/u)
  const backgroundMusic = { id: 'a'.repeat(32), file: `media/bgm-uploads/${'a'.repeat(32)}.mp3`, name: '轻音乐.mp3', mediaType: 'audio/mpeg', bytes: 1024, durationSeconds: 30 }
  const withBgm = normalizeRenderRequest({ backgroundMusic, bgmVolume: 0.18 })
  assert.deepEqual(withBgm.backgroundMusic, backgroundMusic)
  assert.equal(withBgm.bgmVolume, 0.18)
  assert.throws(() => normalizeRenderRequest({ backgroundMusic, renderer: 'local-ffmpeg' }), /仅支持 Remotion/u)
})

test('budgets Remotion encoding below the media limit and caps short-video bitrate', () => {
  const durationSeconds = 276.7
  const encoding = remotionEncodingSettings(durationSeconds)
  const videoBitrateBps = Number.parseInt(encoding.videoBitrate, 10) * 1000
  const audioBitrateBps = Number.parseInt(encoding.audioBitrate, 10) * 1000
  const estimatedBytes = (videoBitrateBps + audioBitrateBps + 64_000) * durationSeconds / 8

  assert.equal(encoding.codec, 'h264')
  assert.equal(encoding.x264Preset, 'medium')
  assert.equal(encoding.audioBitrate, '128k')
  assert.equal(videoBitrateBps >= 1_900_000 && videoBitrateBps <= 2_100_000, true)
  assert.equal(estimatedBytes <= encoding.targetBytes, true)
  assert.equal(encoding.targetBytes < 80 * 1024 * 1024, true)
  assert.equal(remotionEncodingSettings(1).videoBitrate, '8000k')
  assert.equal(remotionEncodingSettings(0).videoBitrate, '8000k')
  assert.equal(remotionEncodingSettings(Number.POSITIVE_INFINITY).videoBitrate, '8000k')
})

test('resolves provider credentials privately and keeps them out of media task records', async (t) => {
  const cwd = await workspace(t)
  const store = new SpokenVideoProjectStore()
  const currentAgent = agent(cwd)
  const project = await projectWithApprovedScript(currentAgent, store)
  const host = new SpokenVideoMediaHost({
    projectsStore: store,
    credentials: credentialStore({ DASHSCOPE_API_KEY: 'sk-private-key' }),
    fetch: async () => { throw new Error('test upstream is unavailable') },
  })
  const started = await host.startVoiceover(currentAgent, {
    projectId: project.id,
    expectedRevision: project.revision,
    provider: 'bailian',
    rate: 1,
    volume: 1,
  })
  const runsPath = join(cwd, 'data', 'projects', project.id, 'media', 'runs.json')
  assert.equal((await readFile(runsPath, 'utf8')).includes('sk-private-key'), false)
  const finished = await waitForOperation(host, currentAgent, project.id, started.id)
  assert.equal(finished.status, 'failed')
  assert.equal(String(finished.error).includes('sk-private-key'), false)
  const [task] = await host.listTasks(currentAgent)
  assert.equal(task.projectId, project.id)
  assert.equal(task.projectTitle, project.title)
  assert.equal(task.input.provider, 'bailian')
  assert.equal(JSON.stringify(task).includes('sk-private-key'), false)
})

test('audio task account filters apply before pagination and scope status counts', async (t) => {
  const cwd = await workspace(t)
  const currentAgent = agent(cwd)
  const accountA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const accountB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const host = new SpokenVideoMediaHost({ projectsStore: { async list() {
    return [
      { id: 'project-a', account: { id: accountA } },
      { id: 'project-b', account: { id: accountB } },
      { id: 'project-general', account: null },
    ]
  } } })
  const task = (id, projectId, status, second) => ({
    id, status, createdAt: `2026-09-17T00:00:${String(second).padStart(2, '0')}Z`,
    source: { projectId, title: id, text: '测试口播稿' }, input: { provider: 'bailian' },
  })
  const tasks = [
    task('a-old', 'project-a', 'failed', 1),
    task('a-middle', 'project-a', 'succeeded', 3),
    task('a-new', 'project-a', 'succeeded', 5),
    task('b-old', 'project-b', 'failed', 2),
    task('b-new', 'project-b', 'succeeded', 6),
    task('general-project', 'project-general', 'succeeded', 4),
    task('manual', null, 'failed', 7),
    task('orphan', 'missing-project', 'failed', 8),
  ]
  await mkdir(join(cwd, 'data'), { recursive: true })
  for (const id of ['project-a', 'project-b', 'project-general']) await mkdir(join(cwd, 'data', 'projects', id), { recursive: true })
  await writeFile(join(cwd, 'data', 'audio-tasks.json'), JSON.stringify({ schemaVersion: 1, tasks }))

  const first = await host.listAudioTasks(currentAgent, { accountId: accountA, limit: 2 })
  assert.deepEqual(first.items.map((item) => item.id), ['a-new', 'a-middle'])
  assert.equal(first.total, 3)
  assert.deepEqual(first.counts, { all: 3, queued: 0, running: 0, succeeded: 2, failed: 1 })
  const second = await host.listAudioTasks(currentAgent, { accountId: accountA, offset: 2, limit: 2 })
  assert.deepEqual(second.items.map((item) => item.id), ['a-old'])
  assert.equal(second.total, 3)
  const failed = await host.listAudioTasks(currentAgent, { accountId: accountA, status: 'failed' })
  assert.deepEqual(failed.items.map((item) => item.id), ['a-old'])
  assert.equal(failed.total, 1)
  assert.deepEqual(failed.counts, first.counts, 'status chips count the account, not just the selected status')
  const search = await host.listAudioTasks(currentAgent, { accountId: accountA, query: 'new' })
  assert.deepEqual(search.items.map((item) => item.id), ['a-new'])
  assert.equal(search.total, 1)
  assert.deepEqual(search.counts, first.counts)
  const other = await host.listAudioTasks(currentAgent, { accountId: accountB })
  assert.deepEqual(other.items.map((item) => item.id), ['b-new', 'b-old'])
  assert.equal(other.counts.all, 2)
  const general = await host.listAudioTasks(currentAgent, { general: true })
  assert.deepEqual(general.items.map((item) => item.id), ['orphan', 'manual', 'general-project'])
  assert.deepEqual(general.counts, { all: 3, queued: 0, running: 0, succeeded: 1, failed: 2 })
  const empty = await host.listAudioTasks(currentAgent, { accountId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })
  assert.equal(empty.total, 0)
  assert.equal(empty.counts.all, 0)
  assert.deepEqual(empty.items, [])
  assert.equal((await host.listAudioTasks(currentAgent)).total, tasks.length, 'unscoped callers retain all tasks')
  await assert.rejects(host.listAudioTasks(currentAgent, { accountId: 'invalid' }), /标识/u)
})

test('keeps standalone and saved-script audio task sources immutable, with task-level subtitle saves', async (t) => {
  const cwd = await workspace(t)
  const store = new SpokenVideoProjectStore()
  const currentAgent = agent(cwd)
  const project = await projectWithApprovedScript(currentAgent, store)
  const secret = 'sk-audio-task-private'
  const host = new SpokenVideoMediaHost({
    projectsStore: store,
    credentials: credentialStore({ DASHSCOPE_API_KEY: secret }),
    fetch: async () => { throw new Error('test upstream is unavailable') },
  })
  const manual = await host.startAudioTask(currentAgent, { subtitleEnabled: false, text: '这是用户直接输入的口播稿。', title: '手动稿', provider: 'bailian' })
  assert.equal(manual.source.kind, 'manual-text')
  assert.equal(manual.source.projectId, null)
  assert.equal(manual.source.text, '这是用户直接输入的口播稿。')
  assert.equal((await waitForAudioTask(host, currentAgent, manual.id)).status, 'failed')

  const approvedBody = (await store.get(currentAgent, { projectId: project.id })).artifacts.script.data.body
  const sourced = await host.startAudioTask(currentAgent, { subtitleEnabled: false, text: approvedBody, sourceProjectId: project.id, provider: 'bailian' })
  assert.equal(sourced.source.kind, 'saved-script')
  assert.equal(sourced.source.projectId, project.id)
  assert.equal(sourced.source.text, approvedBody)
  await waitForAudioTask(host, currentAgent, sourced.id)
  assert.equal(JSON.stringify(await host.listAudioTasks(currentAgent, {})).includes(secret), false)

  const root = join(cwd, 'data')
  await mkdir(join(root, 'audio-media', 'voiceovers'), { recursive: true })
  await writeFile(join(root, 'audio-media', 'voiceovers', 'finished.wav'), 'audio')
  await writeFile(join(root, 'audio-tasks.json'), JSON.stringify({
    schemaVersion: 1,
    tasks: [{
      id: 'finished-task', type: 'voiceover', status: 'succeeded', createdAt: new Date().toISOString(),
      source: { kind: 'manual-text', title: '独立音频', text: '独立音频对应的文稿。' }, input: { provider: 'bailian' },
      result: { audio: { file: 'audio-media/voiceovers/finished.wav', mediaType: 'audio/wav', bytes: 5 } }, subtitle: { status: 'idle' },
    }],
  }))
  const saved = await host.saveAudioTaskSubtitles(currentAgent, { taskId: 'finished-task', srt: '1\n00:00:00,000 --> 00:00:01,000\n校对后的字幕。' })
  assert.equal(saved.subtitle.status, 'succeeded')
  assert.equal(saved.subtitle.srt.includes('校对后的字幕。'), true)
  assert.equal(saved.subtitle.cueCount, 1)
  assert.equal(saved.source.text, '独立音频对应的文稿。')
})

test('persists connection credentials outside the media host and never exposes their values', async () => {
  const credentials = credentialStore()
  const settings = connectionSettings()
  const first = new SpokenVideoMediaHost({ projectsStore: new SpokenVideoProjectStore(), credentials, connectionSettings: settings })
  const saved = await first.configureConnection({ provider: 'bailian', apiKey: 'sk-persisted-connection' })
  assert.equal(saved.provider, 'bailian')
  assert.equal(saved.providers.bailian.configured, true)
  assert.equal(JSON.stringify(saved).includes('sk-persisted-connection'), false)

  const restarted = new SpokenVideoMediaHost({ projectsStore: new SpokenVideoProjectStore(), credentials, connectionSettings: settings })
  const status = await restarted.status()
  assert.equal(status.connection.provider, 'bailian')
  assert.equal(status.providers.bailian.credential.configured, true)
  assert.equal(JSON.stringify(status).includes('sk-persisted-connection'), false)

  await restarted.clearConnectionCredential({ provider: 'bailian' })
  assert.equal((await restarted.connection()).providers.bailian.configured, false)
})

test('submits the packaged Tiffy reference audio to LWB before generating voiceover', async (t) => {
  if (!mediaBinariesAvailable()) { t.skip('ffmpeg or ffprobe is unavailable in this environment'); return }
  const cwd = await workspace(t)
  const store = new SpokenVideoProjectStore()
  const currentAgent = agent(cwd)
  const project = await projectWithApprovedScript(currentAgent, store)
  const outputFile = join(cwd, 'upstream.wav')
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5', '-ac', '1', '-ar', '16000', outputFile], { stdio: 'ignore' })
  const outputAudio = await readFile(outputFile)
  const referenceAudio = await readFile(new URL('../assets/voices/tiffy-confident.mp3', import.meta.url))
  const observed = { upload: null, submit: null, authorization: [] }
  const host = lwbMediaHost({
    projectsStore: store,
    lwbTestKey: 'sk-tiffy-reference',
    fetch: async (url, init = {}) => {
      const parsed = new URL(String(url))
      if (parsed.pathname === '/api/v1/media/audio-uploads') {
        assert.equal(init.method, 'POST')
        observed.authorization.push(new Headers(init.headers).get('authorization'))
        const file = init.body.get('file')
        assert.equal(file.type, 'audio/mpeg')
        assert.deepEqual(Buffer.from(await file.arrayBuffer()), referenceAudio)
        observed.upload = true
        return new Response(JSON.stringify({ success: true, data: { assetId: 'asset_tiffy_reference' } }))
      }
      if (parsed.pathname === '/api/v1/tts/jobs') {
        observed.authorization.push(new Headers(init.headers).get('authorization'))
        observed.submit = JSON.parse(init.body)
        return new Response(JSON.stringify({ success: true, data: { job_id: 'tts_tiffy_reference' } }))
      }
      if (parsed.pathname === '/api/v1/tts/jobs/tts_tiffy_reference') {
        observed.authorization.push(new Headers(init.headers).get('authorization'))
        return new Response(JSON.stringify({ success: true, data: { status: 'completed', result: { audio_url: 'https://media.test/tiffy.wav' } } }))
      }
      if (parsed.hostname === 'media.test') {
        observed.authorization.push(new Headers(init.headers).get('authorization'))
        return new Response(outputAudio)
      }
      throw new Error(`unexpected request: ${url}`)
    },
  })
  const started = await host.startVoiceover(currentAgent, {
    projectId: project.id,
    expectedRevision: project.revision,
    provider: 'lwb',
  })
  const finished = await waitForOperation(host, currentAgent, project.id, started.id)
  assert.equal(finished.status, 'succeeded', finished.error)
  assert.equal(observed.upload, true)
  assert.equal(observed.submit.reference_audio_asset_id, 'asset_tiffy_reference')
  // 带参考音频必须显式同意授权，否则服务端 400。
  assert.equal(observed.submit.consent_accepted, true)
  assert.equal(Object.hasOwn(observed.submit, 'voice_source'), false)
  assert.deepEqual(observed.authorization, ['Bearer sk-tiffy-reference', 'Bearer sk-tiffy-reference', 'Bearer sk-tiffy-reference', null])
  const detail = await store.get(currentAgent, { projectId: project.id })
  assert.equal(detail.artifacts.voiceover.data.voiceName, DEFAULT_VOICE_PROFILE.name)
  assert.equal(detail.artifacts.voiceover.data.provider, 'lwb')
})

test('treats the 202 job envelope as a submission and polls until the stage completes', async (t) => {
  if (!mediaBinariesAvailable()) { t.skip('ffmpeg or ffprobe is unavailable in this environment'); return }
  const cwd = await workspace(t)
  const store = new SpokenVideoProjectStore()
  const currentAgent = agent(cwd)
  const outputFile = join(cwd, 'async-output.wav')
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5', '-ac', '1', '-ar', '16000', outputFile], { stdio: 'ignore' })
  const outputAudio = await readFile(outputFile)
  const polls = []
  const host = lwbMediaHost({
    projectsStore: store,
    lwbTestKey: 'sk-async-202',
    fetch: async (url) => {
      const parsed = new URL(String(url))
      if (parsed.pathname === '/api/v1/media/audio-uploads') return new Response(JSON.stringify({ success: true, data: { assetId: 'asset_async_202' } }))
      if (parsed.pathname === '/api/v1/tts/jobs') {
        // 新契约：提交只答 202（code 也是 202），音频此刻还不存在。
        return new Response(JSON.stringify({ code: 202, data: { job_id: 'tts_async_202', status: 'processing', stage: 'enrolling', audio_url: null, result: {} } }), { status: 202 })
      }
      if (parsed.pathname === '/api/v1/tts/jobs/tts_async_202') {
        polls.push(true)
        const stage = ['enrolling', 'synthesizing', 'completed'][Math.min(polls.length - 1, 2)]
        const completed = stage === 'completed'
        return new Response(JSON.stringify({
          code: 200,
          data: {
            job_id: 'tts_async_202',
            status: completed ? 'completed' : 'processing',
            stage,
            audio_url: null,
            result: completed ? { audio_url: 'https://media.test/async-202.wav' } : {},
          },
        }))
      }
      if (parsed.hostname === 'media.test') return new Response(outputAudio)
      throw new Error(`unexpected request: ${url}`)
    },
  })
  const started = await host.startAudioTask(currentAgent, {
    title: '异步任务契约测试',
    text: '这是一段用来验证二零二异步契约的配音文稿。',
    provider: 'lwb',
    subtitleEnabled: false,
  })
  const finished = await waitForAudioTask(host, currentAgent, started.id)
  assert.equal(finished.status, 'succeeded', finished.error)
  assert.equal(polls.length, 3, 'enrolling 与 synthesizing 都要继续轮询，不能提前取音频地址')
})

test('uploads one reference audio once and reuses its asset id across tasks', async (t) => {
  if (!mediaBinariesAvailable()) { t.skip('ffmpeg or ffprobe is unavailable in this environment'); return }
  const cwd = await workspace(t)
  const store = new SpokenVideoProjectStore()
  const currentAgent = agent(cwd)
  const referenceFile = join(cwd, 'shared-reference.wav')
  const outputFile = join(cwd, 'cache-output.wav')
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=520:duration=4', '-ac', '1', '-ar', '16000', referenceFile], { stdio: 'ignore' })
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=420:duration=0.4', '-ac', '1', '-ar', '16000', outputFile], { stdio: 'ignore' })
  const referenceAudio = await readFile(referenceFile)
  const outputAudio = await readFile(outputFile)
  let uploads = 0
  const settings = connectionSettings('lwb')
  const host = lwbMediaHost({
    projectsStore: store,
    connectionSettings: settings,
    lwbTestKey: 'sk-asset-cache',
    fetch: async (url, init = {}) => {
      const parsed = new URL(String(url))
      if (parsed.pathname === '/api/v1/media/audio-uploads') {
        assert.equal(init.body.get('file').type, 'audio/wav')
        uploads += 1
        // 上传应答带 expiresAt（线上实测 24 小时），缓存要按它算有效期。
        return new Response(JSON.stringify({ success: true, data: { assetId: `asset_cache_${uploads}`, expiresAt: new Date(Date.now() + 6 * 3600_000).toISOString() } }))
      }
      if (parsed.pathname === '/api/v1/tts/jobs') {
        const payload = JSON.parse(init.body)
        return new Response(JSON.stringify({ success: true, data: { job_id: `tts_cache_${payload.text.length}` } }))
      }
      if (parsed.pathname.startsWith('/api/v1/tts/jobs/')) {
        return new Response(JSON.stringify({ success: true, data: { status: 'completed', result: { audio_url: 'https://media.test/cache.wav' } } }))
      }
      if (parsed.hostname === 'media.test') return new Response(outputAudio)
      throw new Error(`unexpected request: ${url}`)
    },
  })
  const uploaded = await host.uploadVoiceReference(currentAgent, {
    name: '共享参考音频.wav',
    mediaType: 'audio/wav',
    data: referenceAudio.toString('base64'),
  })
  for (const text of ['第一次使用同一份参考音频。', '第二次仍然用同一份参考音频。']) {
    const started = await host.startAudioTask(currentAgent, { title: text, text, provider: 'lwb', voiceSource: 'upload', referenceAudio: uploaded, subtitleEnabled: false })
    const finished = await waitForAudioTask(host, currentAgent, started.id)
    assert.equal(finished.status, 'succeeded', finished.error)
  }
  // 上传有小时额度（默认 20 次），同一份音频只能占一次。
  assert.equal(uploads, 1)
  assert.equal(Object.keys(settings.get().lwbVoiceAssets).length, 1)
})

test('re-uploads a reference audio whose asset is about to expire instead of reusing it', async (t) => {
  if (!mediaBinariesAvailable()) { t.skip('ffmpeg or ffprobe is unavailable in this environment'); return }
  const cwd = await workspace(t)
  const store = new SpokenVideoProjectStore()
  const currentAgent = agent(cwd)
  const referenceFile = join(cwd, 'expiring-reference.wav')
  const outputFile = join(cwd, 'expiring-output.wav')
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=520:duration=4', '-ac', '1', '-ar', '16000', referenceFile], { stdio: 'ignore' })
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=420:duration=0.4', '-ac', '1', '-ar', '16000', outputFile], { stdio: 'ignore' })
  const referenceAudio = await readFile(referenceFile)
  const outputAudio = await readFile(outputFile)
  let uploads = 0
  const host = lwbMediaHost({
    projectsStore: store,
    lwbTestKey: 'sk-asset-expiry',
    fetch: async (url, init = {}) => {
      const parsed = new URL(String(url))
      if (parsed.pathname === '/api/v1/media/audio-uploads') {
        uploads += 1
        // 只剩两分钟：落在余量里，必须当过期处理。
        return new Response(JSON.stringify({ success: true, data: { assetId: `asset_expiring_${uploads}`, expiresAt: new Date(Date.now() + 2 * 60_000).toISOString() } }))
      }
      if (parsed.pathname === '/api/v1/tts/jobs') {
        return new Response(JSON.stringify({ success: true, data: { job_id: `tts_expiring_${uploads}` } }))
      }
      if (parsed.pathname.startsWith('/api/v1/tts/jobs/')) {
        return new Response(JSON.stringify({ success: true, data: { status: 'completed', result: { audio_url: 'https://media.test/expiring.wav' } } }))
      }
      if (parsed.hostname === 'media.test') return new Response(outputAudio)
      throw new Error(`unexpected request: ${url}`)
    },
  })
  const uploaded = await host.uploadVoiceReference(currentAgent, {
    name: '将过期参考音频.wav',
    mediaType: 'audio/wav',
    data: referenceAudio.toString('base64'),
  })
  for (const text of ['第一次用快过期的资产。', '第二次必须重新上传。']) {
    const started = await host.startAudioTask(currentAgent, { title: text, text, provider: 'lwb', voiceSource: 'upload', referenceAudio: uploaded, subtitleEnabled: false })
    const finished = await waitForAudioTask(host, currentAgent, started.id)
    assert.equal(finished.status, 'succeeded', finished.error)
  }
  assert.equal(uploads, 2)
})

test('maps LWB insufficient points to an actionable user-facing error', async (t) => {
  const cwd = await workspace(t)
  const currentAgent = agent(cwd)
  const host = lwbMediaHost({
    projectsStore: new SpokenVideoProjectStore(),
    lwbTestKey: 'sk-no-points',
    fetch: async (url) => {
      const parsed = new URL(String(url))
      if (parsed.pathname === '/api/v1/media/audio-uploads') {
        return new Response(JSON.stringify({ success: true, data: { asset_id: 'asset_no_points' } }))
      }
      if (parsed.pathname === '/api/v1/tts/jobs') {
        return new Response(JSON.stringify({ success: false, message: 'Insufficient points' }))
      }
      throw new Error(`unexpected request: ${url}`)
    },
  })
  const started = await host.startAudioTask(currentAgent, {
    text: '这是一段积分不足时不会进入字幕阶段的测试文稿。',
    title: '积分不足测试',
    provider: 'lwb',
    subtitleEnabled: true,
  })
  const finished = await waitForAudioTask(host, currentAgent, started.id)
  assert.equal(finished.status, 'failed')
  assert.equal(finished.error, 'LWB 账户积分不足，请充值后重试，或切换到百炼 BYOK。')
  assert.equal(finished.subtitle.status, 'idle')
  assert.ok(!finished.error.includes('SPOKEN_VIDEO_MEDIA'))
})

test('validates an uploaded reference audio and freezes it into the audio task', async (t) => {
  if (!mediaBinariesAvailable()) { t.skip('ffmpeg or ffprobe is unavailable in this environment'); return }
  const cwd = await workspace(t)
  const store = new SpokenVideoProjectStore()
  const currentAgent = agent(cwd)
  const referenceFile = join(cwd, 'my-reference.wav')
  const outputFile = join(cwd, 'generated.wav')
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=520:duration=4', '-ac', '1', '-ar', '16000', referenceFile], { stdio: 'ignore' })
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=420:duration=0.4', '-ac', '1', '-ar', '16000', outputFile], { stdio: 'ignore' })
  const referenceAudio = await readFile(referenceFile)
  const outputAudio = await readFile(outputFile)
  const observed = { uploadedAudio: null, submit: null }
  const host = lwbMediaHost({
    projectsStore: store,
    lwbTestKey: 'sk-uploaded-reference',
    fetch: async (url, init = {}) => {
      const parsed = new URL(String(url))
      if (parsed.pathname === '/api/v1/media/audio-uploads') {
        const file = init.body.get('file')
        assert.equal(file.type, 'audio/wav')
        observed.uploadedAudio = Buffer.from(await file.arrayBuffer())
        return new Response(JSON.stringify({ success: true, data: { asset_id: 'asset_uploaded_reference' } }))
      }
      if (parsed.pathname === '/api/v1/tts/jobs') {
        observed.submit = JSON.parse(init.body)
        return new Response(JSON.stringify({ success: true, data: { job_id: 'tts_uploaded_reference' } }))
      }
      if (parsed.pathname === '/api/v1/tts/jobs/tts_uploaded_reference') {
        return new Response(JSON.stringify({ success: true, data: { status: 'completed', result: { audio_url: 'https://media.test/uploaded-reference.wav' } } }))
      }
      if (parsed.hostname === 'media.test') return new Response(outputAudio)
      throw new Error(`unexpected request: ${url}`)
    },
  })
  await assert.rejects(
    host.uploadVoiceReference(currentAgent, { name: 'not-audio.wav', mediaType: 'audio/wav', data: Buffer.from('not audio').toString('base64') }),
    /参考音频无法解码/u,
  )
  const uploaded = await host.uploadVoiceReference(currentAgent, {
    name: '我的参考音频.wav',
    mediaType: 'audio/wav',
    data: referenceAudio.toString('base64'),
  })
  assert.match(uploaded.file, /^voice-references\/[a-f0-9]{32}\.wav$/u)
  assert.equal(uploaded.name, '我的参考音频.wav')
  assert.equal(uploaded.bytes, referenceAudio.length)

  const started = await host.startAudioTask(currentAgent, { subtitleEnabled: false,
    title: '上传音色测试',
    text: '这是一次上传参考音频的配音测试。',
    provider: 'lwb',
    voiceSource: 'upload',
    referenceAudio: uploaded,
  })
  const finished = await waitForAudioTask(host, currentAgent, started.id)
  assert.equal(finished.status, 'succeeded', finished.error)
  assert.deepEqual(observed.uploadedAudio, referenceAudio)
  assert.equal(observed.submit.reference_audio_asset_id, 'asset_uploaded_reference')
  assert.equal(observed.submit.consent_accepted, true)
  assert.equal(Object.hasOwn(observed.submit, 'voice_id'), false)
  assert.equal(finished.input.voiceName, '我的参考音频.wav')
  assert.equal(JSON.stringify(finished).includes('audio-media/references'), false)
  const frozen = join(cwd, 'data', 'audio-media', 'references', `${started.id}.wav`)
  assert.deepEqual(await readFile(frozen), referenceAudio)
})

test('rejects a reference audio outside the 3–29 second window before it ever reaches the service', async (t) => {
  if (!mediaBinariesAvailable()) { t.skip('ffmpeg or ffprobe is unavailable in this environment'); return }
  const cwd = await workspace(t)
  const currentAgent = agent(cwd)
  const shortFile = join(cwd, 'too-short.wav')
  const longFile = join(cwd, 'too-long.wav')
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=520:duration=1.5', '-ac', '1', '-ar', '16000', shortFile], { stdio: 'ignore' })
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=520:duration=35', '-ac', '1', '-ar', '16000', longFile], { stdio: 'ignore' })
  // 时长不合规就不该占用上传额度，也不该走到上游：这里让任何一次请求都失败。
  const host = lwbMediaHost({
    projectsStore: new SpokenVideoProjectStore(),
    lwbTestKey: 'sk-duration-window',
    fetch: async () => { throw new Error('时长不合规的参考音频不应发起任何请求'); },
  })
  await assert.rejects(
    host.uploadVoiceReference(currentAgent, { name: '太短.wav', mediaType: 'audio/wav', data: (await readFile(shortFile)).toString('base64') }),
    /参考音频至少要 3 秒，这段只有 1\.5 秒/u,
  )
  // 上游对超长音频是静默截断（不报错），所以我们提前把话说清楚。
  await assert.rejects(
    host.uploadVoiceReference(currentAgent, { name: '太长.wav', mediaType: 'audio/wav', data: (await readFile(longFile)).toString('base64') }),
    /参考音频有 35\.0 秒，超过 29 秒的部分会被上游直接截掉/u,
  )
})

test('converts completed LWB subtitle segments into SRT without downloading the subtitle URL', async (t) => {
  const cwd = await workspace(t)
  const store = new SpokenVideoProjectStore()
  const currentAgent = agent(cwd)
  let project = await projectWithApprovedScript(currentAgent, store)
  const audioRelativePath = 'media/voiceovers/scitiger.wav'
  const audioPath = join(cwd, 'data', 'projects', project.id, audioRelativePath)
  await mkdir(join(cwd, 'data', 'projects', project.id, 'media', 'voiceovers'), { recursive: true })
  await writeFile(audioPath, 'generated audio')
  project = (await store.commitProduced(currentAgent, {
    projectId: project.id, expectedRevision: project.revision, stage: 'voiceover', idempotencyKey: 'media-scitiger-subtitle-voice-0001', source: 'spoken-video/tts',
    payload: { mode: 'tts', provider: 'lwb', settings: { rate: 1, volume: 1, pitch: 0 }, audio: { file: audioRelativePath, mediaType: 'audio/wav', bytes: 15, durationSeconds: 2 } },
  })).project
  const requests = []
  const host = lwbMediaHost({
    projectsStore: store,
    lwbTestKey: 'sk-subtitle-segments',
    fetch: async (url, init = {}) => {
      const parsed = new URL(String(url))
      requests.push(parsed.toString())
      assert.equal(new Headers(init.headers).get('authorization'), 'Bearer sk-subtitle-segments')
      if (parsed.pathname === '/api/v1/media/audio-uploads') {
        return new Response(JSON.stringify({ success: true, data: { asset_id: 'asset_subtitle_audio' } }))
      }
      if (parsed.pathname === '/api/v1/subtitle/jobs') {
        const payload = JSON.parse(init.body)
        assert.equal(payload.audio_asset_id, 'asset_subtitle_audio')
        return new Response(JSON.stringify({ success: true, data: { job_id: 'subtitle_segments_job' } }))
      }
      if (parsed.pathname === '/api/v1/subtitle/jobs/subtitle_segments_job') {
        return new Response(JSON.stringify({
          success: true,
          data: {
            status: 'completed',
            subtitle_segments: [
              { index: 2, start_time: 1300, end_time: 2300, text: '第二句字幕。' },
              { index: 1, start_time: 0, end_time: 700, text: '第一句字幕。' },
            ],
            result: { subtitle_url: 'https://media.test/subtitles.srt?signature=valid' },
          },
        }))
      }
      throw new Error(`unexpected request: ${url}`)
    },
  })
  const started = await host.startSubtitles(currentAgent, {
    projectId: project.id,
    expectedRevision: project.revision,
    provider: 'lwb',
    language: 'zh',
  })
  const finished = await waitForOperation(host, currentAgent, project.id, started.id)
  assert.equal(finished.status, 'succeeded', finished.error)
  assert.equal(requests.some((url) => url.includes('media.test')), false)
  const detail = await store.get(currentAgent, { projectId: project.id })
  assert.equal(detail.artifacts.subtitles.data.cueCount, 2)
  assert.equal(detail.artifacts.subtitles.data.srt, '1\n00:00:00,000 --> 00:00:00,700\n第一句字幕。\n\n2\n00:00:01,300 --> 00:00:02,300\n第二句字幕。\n')
})

test('enrols the packaged reference voice through the active Bailian endpoint and reuses it after restart', async (t) => {
  if (!mediaBinariesAvailable()) { t.skip('ffmpeg or ffprobe is unavailable in this environment'); return }
  const cwd = await workspace(t)
  const store = new SpokenVideoProjectStore()
  const currentAgent = agent(cwd)
  const outputFile = join(cwd, 'upstream.wav')
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5', '-ac', '1', '-ar', '16000', outputFile], { stdio: 'ignore' })
  const outputAudio = await readFile(outputFile)
  const observed = { enrollments: 0, tts: [] }
  const credentials = credentialStore({ DASHSCOPE_API_KEY: 'sk-bailian-reference' })
  const settings = connectionSettings()
  const hostOptions = {
    projectsStore: store,
    credentials,
    connectionSettings: settings,
    environment: { LWB_SPOKEN_VIDEO_BAILIAN_BASE_URL: 'https://workspace.test/api/v1' },
    fetch: async (url, init = {}) => {
      const parsed = new URL(String(url))
      if (parsed.hostname === 'workspace.test' && parsed.pathname === '/api/v1/services/audio/tts/customization') {
        observed.enrollments += 1
        const payload = JSON.parse(init.body)
        assert.equal(new Headers(init.headers).get('authorization'), 'Bearer sk-bailian-reference')
        assert.equal(payload.model, 'voice-enrollment')
        assert.equal(payload.input.action, 'create_voice')
        assert.equal(payload.input.target_model, 'qwen-audio-3.1-tts-plus')
        assert.match(payload.input.prefix, /^lwbtiffy[a-f0-9]{2}$/u)
        assert.equal(payload.input.audio.startsWith('data:audio/mpeg;base64,'), true)
        assert.deepEqual(payload.input.language_hints, ['zh'])
        return new Response(JSON.stringify({ output: { voice_id: 'tiffy-enrolled-voice' } }))
      }
      if (parsed.pathname === '/api/v1/services/audio/tts/SpeechSynthesizer') {
        const payload = JSON.parse(init.body)
        observed.tts.push(payload)
        assert.equal(new Headers(init.headers).get('authorization'), 'Bearer sk-bailian-reference')
        return new Response(JSON.stringify({ request_id: `tts_${observed.tts.length}`, output: { audio: { url: 'https://media.test/tiffy.wav' } } }))
      }
      if (parsed.hostname === 'media.test') return new Response(outputAudio)
      throw new Error(`unexpected request: ${url}`)
    },
  }
  let host = new SpokenVideoMediaHost(hostOptions)
  assert.equal((await host.status()).providers.bailian.referenceVoiceConfigured, true)
  for (let index = 0; index < 3; index += 1) {
    if (index === 2) host = new SpokenVideoMediaHost(hostOptions)
    const project = await projectWithApprovedScript(currentAgent, store)
    const started = await host.startVoiceover(currentAgent, {
      projectId: project.id,
      expectedRevision: project.revision,
      provider: 'bailian',
    })
    const finished = await waitForOperation(host, currentAgent, project.id, started.id)
    assert.equal(finished.status, 'succeeded', finished.error)
    const detail = await store.get(currentAgent, { projectId: project.id })
    assert.equal(detail.artifacts.voiceover.data.voiceId, 'tiffy-enrolled-voice')
  }
  assert.equal(observed.enrollments, 1)
  assert.equal(observed.tts.length, 3)
  assert.equal(observed.tts.every((payload) => payload.model === 'qwen-audio-3.1-tts-plus' && payload.input.voice === 'tiffy-enrolled-voice'), true)
  assert.equal(JSON.stringify(settings.get()).includes('sk-bailian-reference'), false)
  assert.equal(Object.keys(settings.get().bailianReferenceVoices).length, 1)
})

test('enrols an uploaded reference audio before Bailian synthesis', async (t) => {
  if (!mediaBinariesAvailable()) { t.skip('ffmpeg or ffprobe is unavailable in this environment'); return }
  const cwd = await workspace(t)
  const currentAgent = agent(cwd)
  const referenceFile = join(cwd, 'bailian-reference.wav')
  const outputFile = join(cwd, 'bailian-output.wav')
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=510:duration=4', '-ac', '1', '-ar', '16000', referenceFile], { stdio: 'ignore' })
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=610:duration=0.4', '-ac', '1', '-ar', '16000', outputFile], { stdio: 'ignore' })
  const referenceAudio = await readFile(referenceFile)
  const outputAudio = await readFile(outputFile)
  const observed = { enrollment: null, synthesis: null }
  const host = new SpokenVideoMediaHost({
    projectsStore: new SpokenVideoProjectStore(),
    credentials: credentialStore({ DASHSCOPE_API_KEY: 'sk-bailian-uploaded-reference' }),
    environment: { LWB_SPOKEN_VIDEO_BAILIAN_BASE_URL: 'https://workspace.test/api/v1' },
    fetch: async (url, init = {}) => {
      const parsed = new URL(String(url))
      if (parsed.pathname === '/api/v1/services/audio/tts/customization') {
        observed.enrollment = JSON.parse(init.body)
        return new Response(JSON.stringify({ output: { voice_id: 'uploaded-enrolled-voice' } }))
      }
      if (parsed.pathname === '/api/v1/services/audio/tts/SpeechSynthesizer') {
        observed.synthesis = JSON.parse(init.body)
        return new Response(JSON.stringify({ request_id: 'tts_uploaded_bailian', output: { audio: { url: 'https://media.test/uploaded-bailian.wav' } } }))
      }
      if (parsed.hostname === 'media.test') return new Response(outputAudio)
      throw new Error(`unexpected request: ${url}`)
    },
  })
  const uploaded = await host.uploadVoiceReference(currentAgent, {
    name: '百炼参考.wav', mediaType: 'audio/wav', data: referenceAudio.toString('base64'),
  })
  const started = await host.startAudioTask(currentAgent, { subtitleEnabled: false,
    title: '百炼上传音色测试', text: '这是百炼上传音色测试。', provider: 'bailian', voiceSource: 'upload', referenceAudio: uploaded,
  })
  const finished = await waitForAudioTask(host, currentAgent, started.id)
  assert.equal(finished.status, 'succeeded', finished.error)
  assert.match(observed.enrollment.input.prefix, /^lwbvoice[a-f0-9]{2}$/u)
  const encoded = observed.enrollment.input.audio.replace(/^data:audio\/wav;base64,/u, '')
  assert.deepEqual(Buffer.from(encoded, 'base64'), referenceAudio)
  assert.equal(observed.synthesis.model, 'qwen-audio-3.1-tts-plus')
  assert.equal(observed.synthesis.input.voice, 'uploaded-enrolled-voice')
  assert.equal(finished.result.voiceId, 'uploaded-enrolled-voice')
})

test('accepts Bailian WAVs with an unbounded RIFF size, retries incomplete segments, normalizes, and merges through ffmpeg', async (t) => {
  if (!mediaBinariesAvailable()) { t.skip('ffmpeg or ffprobe is unavailable in this environment'); return }
  const cwd = await workspace(t)
  const store = new SpokenVideoProjectStore()
  const currentAgent = agent(cwd)
  const firstFile = join(cwd, 'first.wav')
  const secondFile = join(cwd, 'second.wav')
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.25', '-ac', '1', '-ar', '16000', firstFile], { stdio: 'ignore' })
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=0.25', '-ac', '2', '-ar', '22050', secondFile], { stdio: 'ignore' })
  const firstAudio = await readFile(firstFile)
  const secondAudio = await readFile(secondFile)
  const firstBailianAudio = withUnboundedBailianWavLengths(firstAudio)
  const requests = { tts: 0, firstDownloads: 0, secondDownloads: 0 }
  const host = new SpokenVideoMediaHost({
    projectsStore: store,
    credentials: credentialStore({ DASHSCOPE_API_KEY: 'sk-bailian-segmented' }),
    environment: { LWB_SPOKEN_VIDEO_BAILIAN_BASE_URL: 'https://workspace.test/api/v1' },
    fetch: async (url, init = {}) => {
      const parsed = new URL(String(url))
      if (parsed.hostname === 'workspace.test' && parsed.pathname === '/api/v1/services/audio/tts/SpeechSynthesizer') {
        requests.tts += 1
        const payload = JSON.parse(init.body)
        assert.equal(payload.model, 'qwen-audio-3.1-tts-plus')
        assert.equal(payload.input.voice, 'test-voice')
        assert.equal(payload.input.format, 'wav')
        assert.equal(payload.input.sample_rate, 24000)
        assert.equal(payload.input.text.length <= 400, true)
        return new Response(JSON.stringify({
          request_id: `tts_segment_${requests.tts}`,
          output: { audio: { url: `https://media.test/segment-${requests.tts}.wav` } },
        }))
      }
      if (parsed.hostname === 'media.test' && parsed.pathname === '/segment-1.wav') {
        requests.firstDownloads += 1
        const audio = requests.firstDownloads === 1 ? firstBailianAudio.subarray(0, 78) : firstBailianAudio
        return new Response(audio, { headers: { 'content-length': String(audio.length), 'content-type': 'audio/wav' } })
      }
      if (parsed.hostname === 'media.test' && parsed.pathname === '/segment-2.wav') {
        requests.secondDownloads += 1
        return new Response(secondAudio, { headers: { 'content-length': String(secondAudio.length), 'content-type': 'audio/wav' } })
      }
      throw new Error(`unexpected request: ${url}`)
    },
  })
  let project = await projectWithSavedScript(currentAgent, store)
  project = (await store.commit(currentAgent, { projectId: project.id, expectedRevision: project.revision, stage: 'script', payload: { body: '甲'.repeat(401) }, idempotencyKey: 'segmented-script-001' })).project
  const task = await host.startAudioTask(currentAgent, { subtitleEnabled: false,
    sourceProjectId: project.id,
    text: '甲'.repeat(401),
    provider: 'bailian',
    voiceSource: 'preset',
    voiceId: 'test-voice',
  })
  const finished = await waitForAudioTask(host, currentAgent, task.id)
  assert.equal(finished.status, 'succeeded', finished.error)
  assert.equal(finished.projectSyncError, null)
  assert.ok(finished.projectSync, 'completion must include automatic project sync')
  assert.ok((await store.get(currentAgent, { projectId: project.id })).completedStages.includes('voiceover'))
  const { executionDetail } = await import('../spoken-video-execution.mjs')
  const execution = await executionDetail({ workspacePath: cwd }, { kind: 'audio', id: task.id })
  assert.ok(execution.record.executionEvents.some((event) => event.label.includes('配音服务已返回')), 'provider completion remains inspectable')
  assert.equal(execution.assets[0].file, finished.result.audio.file)
  assert.equal(requests.tts, 2)
  assert.equal(requests.firstDownloads, 2)
  assert.equal(requests.secondDownloads, 1)
  const audioPath = join(cwd, 'data', finished.result.audio.file)
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,sample_rate,channels', '-of', 'json', audioPath], { encoding: 'utf8' }))
  const audioStream = probe.streams.find((stream) => stream.codec_type === 'audio')
  assert.equal(audioStream.codec_name, 'pcm_s16le')
  assert.equal(audioStream.sample_rate, '24000')
  assert.equal(audioStream.channels, 1)
  assert.equal(Number(probe.format.duration) > 0.45, true)
})

test('names the transport cause behind a bare Bailian fetch failure', async (t) => {
  const cwd = await workspace(t)
  const currentAgent = agent(cwd)
  // undici 的形状：所有传输失败都是 `TypeError: fetch failed`，真正原因在 cause 上；
  // Happy Eyeballs 再为每个候选地址各报一条，挂在 AggregateError.errors 上。
  const refused = Object.assign(new Error('connect ECONNREFUSED 8.152.159.24:443'), { code: 'ECONNREFUSED', syscall: 'connect', address: '8.152.159.24', port: 443 })
  const closed = Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' })
  const failure = new TypeError('fetch failed', { cause: new AggregateError([refused, closed], 'all connections failed') })
  const host = new SpokenVideoMediaHost({
    projectsStore: new SpokenVideoProjectStore(),
    credentials: credentialStore({ DASHSCOPE_API_KEY: 'sk-bailian-transport' }),
    environment: { LWB_SPOKEN_VIDEO_BAILIAN_BASE_URL: 'https://workspace.test/api/v1' },
    fetch: async () => { throw failure },
  })
  const task = await host.startAudioTask(currentAgent, {
    subtitleEnabled: false,
    title: '百炼网络诊断',
    text: '这是用来验证传输失败原因链的口播稿。',
    provider: 'bailian',
    voiceSource: 'preset',
    voiceId: 'test-voice',
  })
  const finished = await waitForAudioTask(host, currentAgent, task.id)
  assert.equal(finished.status, 'failed')
  // 段位与耗时仍要在，且原因链要一路读到 socket 级错误：只写 `fetch failed` 等于没诊断。
  assert.match(finished.error, /^百炼 TTS 第 1\/1 段不可访问（耗时 \d+(?:ms|s)；原因 TypeError: fetch failed/u)
  assert.match(finished.error, /AggregateError: all connections failed/u)
  assert.match(finished.error, /\[ECONNREFUSED\]: connect ECONNREFUSED 8\.152\.159\.24:443/u)
  assert.match(finished.error, /\[UND_ERR_SOCKET\]: other side closed/u)
})

test('retries a segment whose synthesis request never reached a response', async (t) => {
  if (!mediaBinariesAvailable()) { t.skip('ffmpeg or ffprobe is unavailable in this environment'); return }
  const cwd = await workspace(t)
  const currentAgent = agent(cwd)
  const audioFile = join(cwd, 'retry.wav')
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=520:duration=0.3', '-ac', '1', '-ar', '16000', audioFile], { stdio: 'ignore' })
  const audio = await readFile(audioFile)
  let ttsAttempts = 0
  const host = new SpokenVideoMediaHost({
    projectsStore: new SpokenVideoProjectStore(),
    credentials: credentialStore({ DASHSCOPE_API_KEY: 'sk-bailian-retry' }),
    environment: { LWB_SPOKEN_VIDEO_BAILIAN_BASE_URL: 'https://workspace.test/api/v1' },
    fetch: async (url) => {
      const parsed = new URL(String(url))
      if (parsed.pathname === '/api/v1/services/audio/tts/SpeechSynthesizer') {
        ttsAttempts += 1
        // 前两次是链路抖动：一个字节的响应都没拿到，第三次才通。
        if (ttsAttempts <= 2) throw new TypeError('fetch failed', { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) })
        return new Response(JSON.stringify({ request_id: 'tts_after_retry', output: { audio: { url: 'https://media.test/retry.wav' } } }))
      }
      if (parsed.hostname === 'media.test') return new Response(audio, { headers: { 'content-length': String(audio.length), 'content-type': 'audio/wav' } })
      throw new Error(`unexpected request: ${url}`)
    },
  })
  const task = await host.startAudioTask(currentAgent, {
    subtitleEnabled: false, title: '传输重试', text: '这是一段用来验证传输失败重试的稿子。', provider: 'bailian', voiceSource: 'preset', voiceId: 'test-voice',
  })
  const finished = await waitForAudioTask(host, currentAgent, task.id, 30_000)
  assert.equal(finished.status, 'succeeded', finished.error)
  assert.equal(ttsAttempts, 3)
})

test('resumes a multi-segment Bailian voiceover from the segments already synthesised', async (t) => {
  if (!mediaBinariesAvailable()) { t.skip('ffmpeg or ffprobe is unavailable in this environment'); return }
  const cwd = await workspace(t)
  const store = new SpokenVideoProjectStore()
  const currentAgent = agent(cwd)
  const audioFile = join(cwd, 'segment.wav')
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=430:duration=0.3', '-ac', '1', '-ar', '16000', audioFile], { stdio: 'ignore' })
  const audio = await readFile(audioFile)
  // 401 个无标点字符会被切成 400 + 1 两段。
  const text = '甲'.repeat(401)
  const observed = { longSegments: 0, shortSegments: 0 }
  let failShortSegment = true
  const host = new SpokenVideoMediaHost({
    projectsStore: store,
    credentials: credentialStore({ DASHSCOPE_API_KEY: 'sk-bailian-resume' }),
    environment: { LWB_SPOKEN_VIDEO_BAILIAN_BASE_URL: 'https://workspace.test/api/v1' },
    fetch: async (url, init = {}) => {
      const parsed = new URL(String(url))
      if (parsed.pathname === '/api/v1/services/audio/tts/SpeechSynthesizer') {
        const long = Array.from(JSON.parse(init.body).input.text).length > 1
        if (long) observed.longSegments += 1
        else {
          observed.shortSegments += 1
          if (failShortSegment) throw new TypeError('fetch failed', { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) })
        }
        const name = long ? 'long' : 'short'
        return new Response(JSON.stringify({ request_id: `tts_${name}`, output: { audio: { url: `https://media.test/${name}.wav` } } }))
      }
      if (parsed.hostname === 'media.test') return new Response(audio, { headers: { 'content-length': String(audio.length), 'content-type': 'audio/wav' } })
      throw new Error(`unexpected request: ${url}`)
    },
  })
  const request = { subtitleEnabled: false, title: '断点续做', text, provider: 'bailian', voiceSource: 'preset', voiceId: 'test-voice' }
  const first = await waitForAudioTask(host, currentAgent, (await host.startAudioTask(currentAgent, request)).id, 30_000)
  assert.equal(first.status, 'failed')
  assert.match(first.error, /第 2\/2 段不可访问/u)
  assert.equal(observed.longSegments, 1)
  assert.equal(observed.shortSegments, 3, '传输失败要按次重试，而不是一次就放弃')

  // 同一个稿子重跑：第 1 段已在缓存里，不该再花一次合成。
  failShortSegment = false
  const finished = await waitForAudioTask(host, currentAgent, (await host.startAudioTask(currentAgent, request)).id, 30_000)
  assert.equal(finished.status, 'succeeded', finished.error)
  assert.equal(observed.longSegments, 1, '第 1 段必须来自缓存')
  assert.equal(observed.shortSegments, 4, '只有失败的那一段重新合成')
})

test('uses the documented Bailian realtime ASR event flow to produce timestamped subtitles', async (t) => {
  if (!mediaBinariesAvailable()) { t.skip('ffmpeg or ffprobe is unavailable in this environment'); return }
  const server = new WebSocketServer({ port: 0 })
  await new Promise((resolvePromise) => server.once('listening', resolvePromise))
  t.after(() => new Promise((resolvePromise) => server.close(resolvePromise)))
  const port = server.address().port
  const observed = { authorization: null, model: null, session: null, appends: 0, audioBytes: 0, appendBytes: [], appendAt: [] }
  server.on('connection', (socket, request) => {
    const requestUrl = new URL(request.url, `ws://127.0.0.1:${port}`)
    observed.authorization = request.headers.authorization || null
    observed.model = requestUrl.searchParams.get('model')
    let speechStarted = false
    socket.on('message', (raw) => {
      const event = JSON.parse(String(raw))
      if (event.type === 'session.update') {
        observed.session = event.session
        socket.send(JSON.stringify({ type: 'session.updated' }))
      } else if (event.type === 'input_audio_buffer.append') {
        const bytes = Buffer.from(event.audio, 'base64')
        observed.appends += 1
        observed.audioBytes += bytes.length
        observed.appendBytes.push(bytes.length)
        observed.appendAt.push(Date.now())
        if (!speechStarted) {
          speechStarted = true
          socket.send(JSON.stringify({ type: 'input_audio_buffer.speech_started', item_id: 'item-1', audio_start_ms: 0 }))
        }
      } else if (event.type === 'session.finish') {
        socket.send(JSON.stringify({ type: 'input_audio_buffer.speech_stopped', item_id: 'item-1', audio_end_ms: 500 }))
        socket.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'item-1', transcript: '实时字幕测试。' }))
        socket.send(JSON.stringify({ type: 'session.finished' }))
      }
    })
  })

  const cwd = await workspace(t)
  const store = new SpokenVideoProjectStore()
  const currentAgent = agent(cwd)
  let project = await projectWithApprovedScript(currentAgent, store)
  const audioRelativePath = 'media/voiceovers/realtime.wav'
  const audioPath = join(cwd, 'data', 'projects', project.id, audioRelativePath)
  await mkdir(join(cwd, 'data', 'projects', project.id, 'media', 'voiceovers'), { recursive: true })
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5', '-ac', '1', '-ar', '16000', audioPath], { stdio: 'ignore' })
  project = (await store.commitProduced(currentAgent, {
    projectId: project.id, expectedRevision: project.revision, stage: 'voiceover', idempotencyKey: 'media-realtime-asr-voice-0001', source: 'spoken-video/tts',
    payload: { mode: 'tts', provider: 'bailian', settings: { rate: 1, volume: 1, pitch: 0 }, audio: { file: audioRelativePath, mediaType: 'audio/wav', bytes: 16_000, durationSeconds: 0.5 } },
  })).project
  const host = new SpokenVideoMediaHost({
    projectsStore: store,
    credentials: credentialStore({ DASHSCOPE_API_KEY: 'sk-realtime-test' }),
    environment: { LWB_SPOKEN_VIDEO_BAILIAN_ASR_WS_URL: `ws://127.0.0.1:${port}/api-ws/v1/realtime` },
  })
  const started = await host.startSubtitles(currentAgent, {
    projectId: project.id, expectedRevision: project.revision, provider: 'bailian', language: 'zh',
  })
  const finished = await waitForOperation(host, currentAgent, project.id, started.id)
  assert.equal(finished.status, 'succeeded')
  assert.equal(observed.authorization, 'Bearer sk-realtime-test')
  assert.equal(observed.model, 'qwen3-asr-flash-realtime')
  assert.deepEqual(observed.session, {
    input_audio_format: 'pcm', sample_rate: 16000, input_audio_transcription: { language: 'zh' }, turn_detection: { type: 'server_vad', threshold: 0, silence_duration_ms: 400 },
  })
  assert.equal(observed.appends > 0, true)
  assert.equal(observed.audioBytes > 0, true)
  assert.equal(observed.appends >= 4, true, '500 ms of PCM is streamed in real-time-sized chunks')
  assert.equal(Math.max(...observed.appendBytes) <= 3_200, true)
  assert.equal(observed.appendAt.at(-1) - observed.appendAt[0] >= 250, true, 'audio chunks are paced instead of burst-sent')
  const detail = await store.get(currentAgent, { projectId: project.id })
  assert.match(detail.artifacts.subtitles.data.srt, /00:00:00,000 --> 00:00:00,250/u)
  assert.match(detail.artifacts.subtitles.data.srt, /00:00:00,238 --> 00:00:00,500/u)
  assert.match(detail.artifacts.subtitles.data.srt, /这是已确认的口播稿，/u)
  assert.match(detail.artifacts.subtitles.data.srt, /用于验证自动媒体产物。/u)
  assert.doesNotMatch(detail.artifacts.subtitles.data.srt, /实时字幕测试/u)
})

test('preserves a Bailian ASR service error when the WebSocket closes during audio streaming', async (t) => {
  if (!mediaBinariesAvailable()) { t.skip('ffmpeg or ffprobe is unavailable in this environment'); return }
  const server = new WebSocketServer({ port: 0 })
  await new Promise((resolvePromise) => server.once('listening', resolvePromise))
  t.after(() => new Promise((resolvePromise) => server.close(resolvePromise)))
  const port = server.address().port
  server.on('connection', (socket) => {
    socket.on('message', (raw) => {
      const event = JSON.parse(String(raw))
      if (event.type === 'session.update') socket.send(JSON.stringify({ type: 'session.updated' }))
      else if (event.type === 'input_audio_buffer.append') {
        socket.send(JSON.stringify({ type: 'error', error: { message: '音频流被服务端拒绝' } }))
        socket.close(1008, 'stream rejected')
      }
    })
  })

  const cwd = await workspace(t)
  const store = new SpokenVideoProjectStore()
  const currentAgent = agent(cwd)
  let project = await projectWithApprovedScript(currentAgent, store)
  const audioRelativePath = 'media/voiceovers/realtime-close.wav'
  const audioPath = join(cwd, 'data', 'projects', project.id, audioRelativePath)
  await mkdir(join(cwd, 'data', 'projects', project.id, 'media', 'voiceovers'), { recursive: true })
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-ac', '1', '-ar', '16000', audioPath], { stdio: 'ignore' })
  project = (await store.commitProduced(currentAgent, {
    projectId: project.id, expectedRevision: project.revision, stage: 'voiceover', idempotencyKey: 'media-realtime-close-voice-0001', source: 'spoken-video/tts',
    payload: { mode: 'tts', provider: 'bailian', settings: { rate: 1, volume: 1, pitch: 0 }, audio: { file: audioRelativePath, mediaType: 'audio/wav', bytes: 160_000, durationSeconds: 5 } },
  })).project
  const host = new SpokenVideoMediaHost({
    projectsStore: store,
    credentials: credentialStore({ DASHSCOPE_API_KEY: 'sk-realtime-close' }),
    environment: { LWB_SPOKEN_VIDEO_BAILIAN_ASR_WS_URL: `ws://127.0.0.1:${port}/api-ws/v1/realtime` },
  })
  const started = await host.startSubtitles(currentAgent, { projectId: project.id, expectedRevision: project.revision, provider: 'bailian', language: 'zh' })
  const finished = await waitForOperation(host, currentAgent, project.id, started.id)
  assert.equal(finished.status, 'failed')
  assert.match(finished.error, /音频流被服务端拒绝/u)
  assert.doesNotMatch(finished.error, /readyState|WebSocket is not open/u)
})

test('builds the deterministic technical release gate from ffprobe data', () => {
  const video = normalizeProbe({ format: { duration: '12.2' }, streams: [{ codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920, avg_frame_rate: '30/1' }, { codec_type: 'audio', codec_name: 'aac', sample_rate: '22050' }] })
  const audio = normalizeProbe({ format: { duration: '12.0' }, streams: [{ codec_type: 'audio', codec_name: 'aac', sample_rate: '44100' }] })
  assert.equal(video.sampleRate, 22050)
  assert.equal(audio.sampleRate, 44100)
  const passed = buildTechnicalReport({ video, audio, subtitles: { cueCount: 4 } })
  assert.equal(passed.passed, true)
  const landscape = buildTechnicalReport({ video: { ...video, width: 1920, height: 1080 }, audio, subtitles: { cueCount: 4 }, orientation: 'landscape' })
  assert.equal(landscape.passed, true)
  const failed = buildTechnicalReport({ video: { ...video, width: 1920, height: 1080, hasAudio: false }, audio, subtitles: { cueCount: 0 } })
  assert.equal(failed.passed, false)
  assert.equal(failed.issues.length >= 3, true)
  assert.deepEqual(failed.warnings, [])
  const noCaptions = buildTechnicalReport({ video, audio, subtitles: null, subtitleEnabled: false })
  assert.equal(noCaptions.passed, true)
  assert.equal(noCaptions.subtitles.enabled, false)
})

test('treats an attached album cover as audio metadata, not a real video stream', () => {
  const audio = normalizeProbe({
    format: { duration: '199.56' },
    streams: [
      { codec_type: 'audio', codec_name: 'mp3', sample_rate: '48000', duration: '199.56', disposition: { attached_pic: 0 } },
      { codec_type: 'video', codec_name: 'mjpeg', width: 360, height: 360, disposition: { attached_pic: 1 } },
    ],
  })
  assert.equal(audio.hasAudio, true)
  assert.equal(audio.durationSeconds, 199.56)
  assert.equal(audio.videoCodec, null)
  assert.equal(audio.width, null)

  const actualVideo = normalizeProbe({
    format: { duration: '10' },
    streams: [
      { codec_type: 'video', codec_name: 'mjpeg', width: 360, height: 360, disposition: { attached_pic: 1 } },
      { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, avg_frame_rate: '30/1', disposition: { attached_pic: 0 } },
      { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000' },
    ],
  })
  assert.equal(actualVideo.videoCodec, 'h264')
  assert.equal(actualVideo.width, 1920)
})

test('allows media production from a saved script without approval and renders without subtitles', async (t) => {
  if (!mediaBinariesAvailable()) { t.skip('ffmpeg or ffprobe is unavailable in this environment'); return }
  const cwd = await workspace(t)
  const store = new SpokenVideoProjectStore()
  const currentAgent = agent(cwd)
  let project = await projectWithSavedScript(currentAgent, store)
  const projectRoot = join(cwd, 'data', 'projects', project.id)
  const audioDirectory = join(projectRoot, 'media', 'voiceovers')
  const audioFile = join(audioDirectory, 'no-captions.wav')
  await mkdir(audioDirectory, { recursive: true })
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=1', '-c:a', 'pcm_s16le', audioFile], { stdio: 'ignore' })
  project = (await store.commitProduced(currentAgent, {
    projectId: project.id, expectedRevision: project.revision, stage: 'voiceover', idempotencyKey: 'media-no-captions-voice-0001', source: 'spoken-video/tts',
    payload: { mode: 'tts', provider: 'test', settings: { rate: 1, volume: 1, pitch: 0 }, audio: { file: 'media/voiceovers/no-captions.wav', mediaType: 'audio/wav', bytes: 88_278, durationSeconds: 1 } },
  })).project
  const host = new SpokenVideoMediaHost({ projectsStore: store })
  const render = await host.startVideoRender(currentAgent, { projectId: project.id, expectedRevision: project.revision, subtitleEnabled: false, orientation: 'landscape', renderer: 'local-ffmpeg' })
  const rendered = await waitForOperation(host, currentAgent, project.id, render.id)
  assert.equal(rendered.status, 'succeeded', rendered.error)
  const renderedProject = await store.get(currentAgent, { projectId: project.id })
  assert.equal(renderedProject.artifacts.video.data.subtitleEnabled, false)
  assert.equal(renderedProject.artifacts.video.data.orientation, 'landscape')
  assert.equal(renderedProject.artifacts.video.data.video.width, 1920)
  assert.equal(renderedProject.artifacts.video.data.video.height, 1080)
  assert.equal(renderedProject.artifacts.video.data.sourceSubtitleFile, null)
  assert.equal(renderedProject.artifacts.video.data.visualBrief, DEFAULT_VIDEO_VISUAL_BRIEF)
  const qc = await host.startTechnicalQc(currentAgent, { projectId: project.id, expectedRevision: renderedProject.revision })
  const checked = await waitForOperation(host, currentAgent, project.id, qc.id)
  assert.equal(checked.status, 'succeeded', checked.error)
  assert.equal((await store.get(currentAgent, { projectId: project.id })).artifacts.qc.data.passed, true)
})

test('lists video renders as independent frozen tasks and reads their bound media', async (t) => {
  if (!mediaBinariesAvailable()) { t.skip('ffmpeg or ffprobe is unavailable in this environment'); return }
  const cwd = await workspace(t)
  const store = new SpokenVideoProjectStore()
  const currentAgent = agent(cwd)
  let project = await projectWithApprovedSavedScript(currentAgent, store)
  const projectRoot = join(cwd, 'data', 'projects', project.id)
  const audioPath = join(projectRoot, 'media', 'voiceovers', 'frozen.wav')
  await mkdir(join(projectRoot, 'media', 'voiceovers'), { recursive: true })
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=1', '-c:a', 'pcm_s16le', audioPath], { stdio: 'ignore' })
  project = (await store.commitProduced(currentAgent, {
    projectId: project.id, expectedRevision: project.revision, stage: 'voiceover', idempotencyKey: 'frozen-task-voice-0001', source: 'spoken-video/tts',
    payload: { mode: 'tts', provider: 'test', settings: { rate: 1, volume: 1, pitch: 0 }, audio: { file: 'media/voiceovers/frozen.wav', mediaType: 'audio/wav', bytes: 88_278, durationSeconds: 1 } },
  })).project
  const host = new SpokenVideoMediaHost({ projectsStore: store })
  const started = await host.startVideoRender(currentAgent, { projectId: project.id, expectedRevision: project.revision, visualBrief: '冻结的任务说明。', subtitleEnabled: false, renderer: 'local-ffmpeg' })
  assert.equal(started.source.script.body.includes('已保存的口播稿'), true)
  assert.equal(started.source.voiceover.audio.file, 'media/voiceovers/frozen.wav')
  const finished = await waitForOperation(host, currentAgent, project.id, started.id)
  assert.equal(finished.status, 'succeeded', finished.error)
  const listing = await host.listVideoTasks(currentAgent, { status: 'succeeded', query: '冻结的任务说明。', limit: 8 })
  assert.equal(listing.total, 1)
  assert.equal(listing.items[0].id, started.id)
  assert.equal(listing.items[0].source.script.body.includes('已保存的口播稿'), true)
  const [video, voiceover] = await Promise.all([
    host.readVideoTaskMedia(currentAgent, { projectId: project.id, taskId: started.id, stage: 'video' }),
    host.readVideoTaskMedia(currentAgent, { projectId: project.id, taskId: started.id, stage: 'voiceover' }),
  ])
  assert.equal(video.mediaType, 'video/mp4')
  assert.equal(video.bytes > 1024, true)
  assert.equal(voiceover.mediaType, 'audio/wav')
  await assert.rejects(
    host.readVideoTaskMedia(currentAgent, { projectId: project.id, taskId: started.id, stage: 'subtitles' }),
    /只可读取任务配音、背景音乐或成片预览/u,
  )
})

test('commits host-produced media through the existing revision and downstream gates', async (t) => {
  const cwd = await workspace(t)
  const store = new SpokenVideoProjectStore()
  const currentAgent = agent(cwd)
  let project = await projectWithApprovedScript(currentAgent, store)

  project = (await store.commitProduced(currentAgent, {
    projectId: project.id, expectedRevision: project.revision, stage: 'voiceover', idempotencyKey: 'media-voice-0001', source: 'spoken-video/tts',
    payload: { mode: 'tts', provider: 'cosyvoice', taskId: 'task-voice-1', voiceId: 'voice-1', voiceName: '测试音色', settings: { rate: 1, volume: 1, pitch: 0 }, audio: { file: 'media/voiceovers/run-1.wav', mediaType: 'audio/wav', bytes: 4096, durationSeconds: 2 } },
  })).project
  project = (await store.commitProduced(currentAgent, {
    projectId: project.id, expectedRevision: project.revision, stage: 'subtitles', idempotencyKey: 'media-subtitle-0001', source: 'spoken-video/asr',
    payload: { mode: 'asr', taskId: 'task-subtitle-1', sourceAudioFile: 'media/voiceovers/run-1.wav', srtFile: 'media/subtitles/run-1.srt', srt: '1\n00:00:00,000 --> 00:00:02,000\n自动对齐字幕。' },
  })).project
  project = (await store.commitProduced(currentAgent, {
    projectId: project.id, expectedRevision: project.revision, stage: 'video', idempotencyKey: 'media-video-0001', source: 'spoken-video/local-ffmpeg',
    payload: { mode: 'local-ffmpeg', renderer: 'local-ffmpeg', visualBrief: '竖屏口播视频。', sourceAudioFile: 'media/voiceovers/run-1.wav', sourceSubtitleFile: 'media/subtitles/run-1.srt', video: { file: 'media/videos/run-1.mp4', mediaType: 'video/mp4', bytes: 4096, durationSeconds: 2, width: 1080, height: 1920, fps: 30, hasAudio: true } },
  })).project
  await assert.rejects(
    store.commitProduced(currentAgent, {
      projectId: project.id, expectedRevision: project.revision, stage: 'qc', idempotencyKey: 'media-qc-inconsistent-0001', source: 'spoken-video/ffprobe',
      payload: { mode: 'automatic', reportFile: 'media/qc/inconsistent.json', passed: true, technical: { passed: false, issues: ['视频缺少音轨。'], warnings: [], video: { hasAudio: false }, audio: {}, subtitles: { cueCount: 1 } } },
    }),
    (error) => error instanceof SpokenVideoStoreError && error.code === 'SPOKEN_VIDEO_QC_FAILED',
  )
  project = (await store.commitProduced(currentAgent, {
    projectId: project.id, expectedRevision: project.revision, stage: 'qc', idempotencyKey: 'media-qc-0001', source: 'spoken-video/ffprobe',
    payload: { mode: 'automatic', reportFile: 'media/qc/run-1.json', passed: false, technical: { passed: false, issues: ['视频缺少音轨。'], warnings: [], video: { hasAudio: false }, audio: {}, subtitles: { cueCount: 1 } } },
  })).project
  await assert.rejects(
    store.commit(currentAgent, {
      projectId: project.id, expectedRevision: project.revision, stage: 'qc', idempotencyKey: 'media-manual-qc-override-0001',
      payload: { checks: { script: true, voiceover: true, subtitles: true, video: true }, notes: '不应覆盖自动失败。' },
    }),
    (error) => error instanceof SpokenVideoStoreError && error.code === 'SPOKEN_VIDEO_STAGE_AUTOMATION_REQUIRED',
  )
  await assert.rejects(
    store.commit(currentAgent, { projectId: project.id, expectedRevision: project.revision, stage: 'approval', payload: { confirm: true }, idempotencyKey: 'media-approval-0001' }),
    (error) => error instanceof SpokenVideoStoreError && error.code === 'SPOKEN_VIDEO_INVALID_INPUT',
  )
  const detail = await store.get(currentAgent, { projectId: project.id })
  assert.equal(detail.artifacts.voiceover.data.audio.file, 'media/voiceovers/run-1.wav')
  assert.equal(detail.artifacts.subtitles.data.mode, 'asr')
  assert.equal(detail.artifacts.qc.passed, false)
})

test('rejects manual video production and manual technical-qc submissions', async (t) => {
  const cwd = await workspace(t)
  const store = new SpokenVideoProjectStore()
  const currentAgent = agent(cwd)
  const project = await projectWithSavedScript(currentAgent, store)
  await assert.rejects(
    store.commit(currentAgent, { projectId: project.id, expectedRevision: project.revision, stage: 'video', idempotencyKey: 'manual-video-block-0001', payload: { visualBrief: '外部制作说明。' } }),
    (error) => error instanceof SpokenVideoStoreError && error.code === 'SPOKEN_VIDEO_STAGE_AUTOMATION_REQUIRED',
  )
  await assert.rejects(
    store.commit(currentAgent, { projectId: project.id, expectedRevision: project.revision, stage: 'qc', idempotencyKey: 'manual-qc-block-0001', payload: { checks: { script: true, voiceover: true, video: true } } }),
    (error) => error instanceof SpokenVideoStoreError && error.code === 'SPOKEN_VIDEO_STAGE_AUTOMATION_REQUIRED',
  )
})

test('marks media runs interrupted by a host restart as failed', async (t) => {
  const cwd = await workspace(t)
  const store = new SpokenVideoProjectStore()
  const currentAgent = agent(cwd)
  const project = await store.create(currentAgent, { title: '恢复媒体任务' })
  const mediaRoot = join(cwd, 'data', 'projects', project.id, 'media')
  await mkdir(mediaRoot, { recursive: true })
  await writeFile(join(mediaRoot, 'runs.json'), `${JSON.stringify({ schemaVersion: 1, runs: [{ id: 'interrupted-1', type: 'voiceover', status: 'running', projectId: project.id, expectedRevision: project.revision, createdAt: new Date(Date.now() - 5_000).toISOString() }] })}\n`)
  const host = new SpokenVideoMediaHost({ projectsStore: store })
  const [run] = await host.operations(currentAgent, { projectId: project.id })
  assert.equal(run.status, 'failed')
  assert.match(run.error, /主机在任务完成前已重启/u)
})

test('refuses preview media reached through a symlinked project directory', async (t) => {
  const cwd = await workspace(t)
  const store = new SpokenVideoProjectStore()
  const currentAgent = agent(cwd)
  let project = await projectWithApprovedScript(currentAgent, store)
  project = (await store.commitProduced(currentAgent, {
    projectId: project.id, expectedRevision: project.revision, stage: 'voiceover', idempotencyKey: 'media-preview-link-0001', source: 'spoken-video/tts',
    payload: { mode: 'tts', provider: 'cosyvoice', settings: { rate: 1, volume: 1, pitch: 0 }, audio: { file: 'media/voiceovers/run-1.wav', mediaType: 'audio/wav', bytes: 4, durationSeconds: 1 } },
  })).project
  const root = join(cwd, 'data', 'projects', project.id)
  const external = join(cwd, 'outside-media')
  await mkdir(join(root, 'media'), { recursive: true })
  await mkdir(external)
  await writeFile(join(external, 'run-1.wav'), 'fake')
  await symlink(external, join(root, 'media', 'voiceovers'))
  const host = new SpokenVideoMediaHost({ projectsStore: store })
  await assert.rejects(host.readMedia(currentAgent, { projectId: project.id, stage: 'voiceover' }), /路径无效/u)
})

test('defaults a local render to landscape and passes ffprobe technical qc', async (t) => {
  if (!mediaBinariesAvailable()) { t.skip('ffmpeg or ffprobe is unavailable in this environment'); return }
  const cwd = await workspace(t)
  const store = new SpokenVideoProjectStore()
  const currentAgent = agent(cwd)
  let project = await projectWithApprovedScript(currentAgent, store)
  const projectRoot = join(cwd, 'data', 'projects', project.id)
  const audioDirectory = join(projectRoot, 'media', 'voiceovers')
  const audioFile = join(audioDirectory, 'render.wav')
  await mkdir(audioDirectory, { recursive: true })
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=1', '-c:a', 'pcm_s16le', audioFile], { stdio: 'ignore' })
  project = (await store.commitProduced(currentAgent, {
    projectId: project.id, expectedRevision: project.revision, stage: 'voiceover', idempotencyKey: 'media-render-voice-0001', source: 'spoken-video/tts',
    payload: { mode: 'tts', provider: 'test', settings: { rate: 1, volume: 1, pitch: 0 }, audio: { file: 'media/voiceovers/render.wav', mediaType: 'audio/wav', bytes: 88_278, durationSeconds: 1 } },
  })).project
  project = (await store.commitProduced(currentAgent, {
    projectId: project.id, expectedRevision: project.revision, stage: 'subtitles', idempotencyKey: 'media-render-subtitles-0001', source: 'spoken-video/asr',
    payload: { mode: 'asr', sourceAudioFile: 'media/voiceovers/render.wav', srtFile: 'media/subtitles/render.srt', srt: '1\n00:00:00,000 --> 00:00:01,000\nRender test' },
  })).project
  const host = new SpokenVideoMediaHost({ projectsStore: store })
  const render = await host.startVideoRender(currentAgent, { projectId: project.id, expectedRevision: project.revision, visualBrief: '测试渲染。', renderer: 'local-ffmpeg' })
  const rendered = await waitForOperation(host, currentAgent, project.id, render.id)
  assert.equal(rendered.status, 'succeeded', rendered.error)
  const renderedProject = await store.get(currentAgent, { projectId: project.id })
  assert.equal(renderedProject.artifacts.video.data.video.width, 1920)
  assert.equal(renderedProject.artifacts.video.data.video.height, 1080)
  const qc = await host.startTechnicalQc(currentAgent, { projectId: project.id, expectedRevision: renderedProject.revision })
  const qcRun = await waitForOperation(host, currentAgent, project.id, qc.id)
  assert.equal(qcRun.status, 'succeeded', qcRun.error)
  const checkedProject = await store.get(currentAgent, { projectId: project.id })
  assert.equal(checkedProject.artifacts.qc.data.passed, true)
})

test('runs the DSH Remotion creator, deterministic QC, and independent reviewer before committing', async (t) => {
  if (!mediaBinariesAvailable() || !await remotionRendererAvailable()) { t.skip('ffmpeg, ffprobe, or Remotion is unavailable in this environment'); return }
  const cwd = await workspace(t)
  const store = new SpokenVideoProjectStore()
  const currentAgent = agent(cwd)
  let project = await projectWithApprovedSavedScript(currentAgent, store)
  const projectRoot = join(cwd, 'data', 'projects', project.id)
  const audioDirectory = join(projectRoot, 'media', 'voiceovers')
  const audioFile = join(audioDirectory, 'remotion.wav')
  await mkdir(audioDirectory, { recursive: true })
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=1', '-c:a', 'pcm_s16le', audioFile], { stdio: 'ignore' })
  project = (await store.commitProduced(currentAgent, {
    projectId: project.id, expectedRevision: project.revision, stage: 'voiceover', idempotencyKey: 'media-remotion-voice-0001', source: 'spoken-video/tts',
    payload: { mode: 'tts', provider: 'test', settings: { rate: 1, volume: 1, pitch: 0 }, audio: { file: 'media/voiceovers/remotion.wav', mediaType: 'audio/wav', bytes: 88_278, durationSeconds: 1 } },
  })).project
  project = (await store.commitProduced(currentAgent, {
    projectId: project.id, expectedRevision: project.revision, stage: 'subtitles', idempotencyKey: 'media-remotion-subtitles-0001', source: 'spoken-video/asr',
    payload: { mode: 'asr', sourceAudioFile: 'media/voiceovers/remotion.wav', srtFile: 'media/subtitles/remotion.srt', srt: '1\n00:00:00,000 --> 00:00:01,000\nRemotion 渲染测试。' },
  })).project
  const host = new SpokenVideoMediaHost({
    projectsStore: store,
    videoCreator: fakeVideoCreator,
    videoReviewer: passingVideoReviewer,
  })
  const bgmSource = join(cwd, 'test-bgm.wav')
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=44100:duration=0.4', '-c:a', 'pcm_s16le', bgmSource], { stdio: 'ignore' })
  const backgroundMusic = await host.uploadVideoBgm(currentAgent, {
    projectId: project.id,
    name: '测试背景音乐.wav',
    mediaType: 'audio/wav',
    data: (await readFile(bgmSource)).toString('base64'),
  })
  const started = await host.startVideoRender(currentAgent, { projectId: project.id, expectedRevision: project.revision, visualBrief: '清晰、克制的信息视觉。', orientation: 'landscape', renderer: 'remotion', backgroundMusic, bgmVolume: 0.16 })
  assert.equal(started.input.backgroundMusic.name, '测试背景音乐.wav')
  assert.equal(started.input.bgmVolume, 0.16)
  const finished = await waitForOperation(host, currentAgent, project.id, started.id)
  assert.equal(finished.status, 'succeeded', finished.error)
  const rendered = await store.get(currentAgent, { projectId: project.id })
  assert.equal(rendered.artifacts.video.data.renderer, 'remotion', JSON.stringify(rendered.artifacts.video.data.fallback || null))
  assert.equal(rendered.artifacts.video.data.orientation, 'landscape')
  assert.equal(rendered.artifacts.video.data.video.width, 1920)
  assert.equal(rendered.artifacts.video.data.video.height, 1080)
  assert.equal(rendered.artifacts.video.data.video.frameCount > 0, true)
  assert.match(rendered.artifacts.video.data.remotion.projectDir, /^media\/video-agent\//u)
  assert.equal(rendered.artifacts.video.data.remotion.preflight.passed, true)
  assert.equal(rendered.artifacts.video.data.backgroundMusic.name, '测试背景音乐.wav')
  assert.equal(rendered.artifacts.video.data.bgmVolume, 0.16)
  assert.equal(rendered.artifacts.qc.data.passed, true)
  assert.equal(rendered.artifacts.qc.data.technical.subtitles.maxTextChars, 14)
  assert.equal(rendered.artifacts.qc.data.technical.subtitles.displayLimit, 56)
  assert.equal(rendered.artifacts.qc.data.technical.subtitles.longCueCount, 0)
  assert.equal(rendered.artifacts.qc.data.review.score, 88)
  const [operation] = await host.operations(currentAgent, { projectId: project.id })
  assert.equal(operation.phase, 'completed')
  assert.equal(operation.pipeline.engine, 'dsh-remotion-ai-director')
  assert.deepEqual(operation.dsh.sessions.map((session) => session.role), ['creator', 'reviewer'])
  assert.equal(operation.result.qc.review.passed, true)
  const props = JSON.parse(await readFile(join(projectRoot, rendered.artifacts.video.data.remotion.propsFile), 'utf8'))
  assert.match(props.bgmFileName, /^background-music\.wav$/u)
  assert.equal(props.bgmVolume, 0.16)
  const bgmPreview = await host.readVideoTaskMedia(currentAgent, { projectId: project.id, taskId: started.id, stage: 'bgm' })
  assert.equal(bgmPreview.mediaType, 'audio/wav')
  assert.equal(bgmPreview.bytes, backgroundMusic.bytes)
})

test('rejects overlong subtitles during deterministic QC before independent review', async (t) => {
  if (!mediaBinariesAvailable() || !await remotionRendererAvailable()) { t.skip('ffmpeg, ffprobe, or Remotion is unavailable in this environment'); return }
  const cwd = await workspace(t)
  const store = new SpokenVideoProjectStore()
  const currentAgent = agent(cwd)
  let project = await projectWithApprovedSavedScript(currentAgent, store)
  const projectRoot = join(cwd, 'data', 'projects', project.id)
  const audioDirectory = join(projectRoot, 'media', 'voiceovers')
  const audioFile = join(audioDirectory, 'long-subtitle.wav')
  await mkdir(audioDirectory, { recursive: true })
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=1', '-c:a', 'pcm_s16le', audioFile], { stdio: 'ignore' })
  project = (await store.commitProduced(currentAgent, {
    projectId: project.id, expectedRevision: project.revision, stage: 'voiceover', idempotencyKey: 'media-long-subtitle-voice-0001', source: 'spoken-video/tts',
    payload: { mode: 'tts', provider: 'test', settings: { rate: 1, volume: 1, pitch: 0 }, audio: { file: 'media/voiceovers/long-subtitle.wav', mediaType: 'audio/wav', bytes: 88_278, durationSeconds: 1 } },
  })).project
  project = (await store.commitProduced(currentAgent, {
    projectId: project.id, expectedRevision: project.revision, stage: 'subtitles', idempotencyKey: 'media-long-subtitle-captions-0001', source: 'spoken-video/asr',
    payload: { mode: 'asr', sourceAudioFile: 'media/voiceovers/long-subtitle.wav', srtFile: 'media/subtitles/long-subtitle.srt', srt: `1\n00:00:00,000 --> 00:00:01,000\n${'这是一条需要在技术质检阶段被拦截的超长字幕'.repeat(3)}` },
  })).project
  let reviewerCalled = false
  const host = new SpokenVideoMediaHost({
    projectsStore: store,
    videoCreator: fakeVideoCreator,
    videoReviewer: async () => { reviewerCalled = true; return passingVideoReviewer() },
  })
  const started = await host.startVideoRender(currentAgent, { projectId: project.id, expectedRevision: project.revision, orientation: 'portrait', renderer: 'remotion' })
  const finished = await waitForOperation(host, currentAgent, project.id, started.id)
  assert.equal(finished.status, 'failed')
  assert.match(finished.error, /字幕超过 44 字/u)
  assert.equal(finished.pipeline.technical.subtitles.longCueCount, 1)
  assert.equal(finished.pipeline.technical.subtitles.maxTextChars > 44, true)
  assert.equal(reviewerCalled, false)
  const detail = await store.get(currentAgent, { projectId: project.id })
  assert.equal(detail.artifacts.video, undefined)
  assert.equal(detail.artifacts.qc, undefined)
})

test('fails a Remotion task without a creator and does not commit a fallback video', async (t) => {
  const cwd = await workspace(t)
  const store = new SpokenVideoProjectStore()
  const currentAgent = agent(cwd)
  const project = await projectWithSavedScript(currentAgent, store)
  const host = new SpokenVideoMediaHost({ projectsStore: store, videoReviewer: passingVideoReviewer })
  const started = await host.startVideoRender(currentAgent, { projectId: project.id, expectedRevision: project.revision, renderer: 'remotion', subtitleEnabled: false })
  const finished = await waitForOperation(host, currentAgent, project.id, started.id)
  assert.equal(finished.status, 'failed')
  assert.match(finished.error, /视频创作 Agent/u)
  assert.equal((await store.get(currentAgent, { projectId: project.id })).artifacts.video, undefined)
})

test('rejects an unchanged Agent placeholder before rendering and never commits video', async (t) => {
  if (!mediaBinariesAvailable() || !await remotionRendererAvailable()) { t.skip('ffmpeg, ffprobe, or Remotion is unavailable in this environment'); return }
  const cwd = await workspace(t)
  const store = new SpokenVideoProjectStore()
  const currentAgent = agent(cwd)
  let project = await projectWithApprovedSavedScript(currentAgent, store)
  project = await withTestVoiceover(cwd, store, currentAgent, project, 'placeholder', 'placeholder-voice-0001')
  const host = new SpokenVideoMediaHost({ projectsStore: store, videoCreator: async () => ({ output: 'done' }), videoReviewer: passingVideoReviewer })
  const started = await host.startVideoRender(currentAgent, { projectId: project.id, expectedRevision: project.revision, renderer: 'remotion', subtitleEnabled: false })
  const finished = await waitForOperation(host, currentAgent, project.id, started.id)
  assert.equal(finished.status, 'failed')
  assert.match(finished.error, /占位画面/u)
  assert.equal((await store.get(currentAgent, { projectId: project.id })).artifacts.video, undefined)
})

test('rejects creator changes to protected Remotion files before rendering', async (t) => {
  if (!mediaBinariesAvailable() || !await remotionRendererAvailable()) { t.skip('ffmpeg, ffprobe, or Remotion is unavailable in this environment'); return }
  const cwd = await workspace(t)
  const store = new SpokenVideoProjectStore()
  const currentAgent = agent(cwd)
  let project = await projectWithApprovedSavedScript(currentAgent, store)
  project = await withTestVoiceover(cwd, store, currentAgent, project, 'protected', 'protected-voice-0001')
  const host = new SpokenVideoMediaHost({
    projectsStore: store,
    videoCreator: async ({ prompt }) => {
      const runDir = agentWorkspaceFromPrompt(prompt)
      await writeFile(join(runDir, 'src', 'CreativeVideo.tsx'), testCreativeSource())
      await writeFile(join(runDir, 'src', 'Root.tsx'), '// forbidden mutation\n')
      return { output: 'done' }
    },
    videoReviewer: passingVideoReviewer,
  })
  const started = await host.startVideoRender(currentAgent, { projectId: project.id, expectedRevision: project.revision, renderer: 'remotion', subtitleEnabled: false })
  const finished = await waitForOperation(host, currentAgent, project.id, started.id)
  assert.equal(finished.status, 'failed')
  assert.match(finished.error, /受保护文件 src\/Root\.tsx/u)
  assert.equal((await store.get(currentAgent, { projectId: project.id })).artifacts.video, undefined)
})

test('fails an independently rejected video without committing video or QC artifacts', async (t) => {
  if (!mediaBinariesAvailable() || !await remotionRendererAvailable()) { t.skip('ffmpeg, ffprobe, or Remotion is unavailable in this environment'); return }
  const cwd = await workspace(t)
  const store = new SpokenVideoProjectStore()
  const currentAgent = agent(cwd)
  let project = await projectWithApprovedSavedScript(currentAgent, store)
  project = await withTestVoiceover(cwd, store, currentAgent, project, 'review-fail', 'review-fail-voice-0001')
  let creatorCalls = 0
  let reviewerCalls = 0
  const host = new SpokenVideoMediaHost({
    projectsStore: store,
    videoCreator: async (input) => { creatorCalls += 1; return fakeVideoCreator(input) },
    videoReviewer: async ({ prompt }) => {
      reviewerCalls += 1
      const timestamps = [...String(prompt).matchAll(/^- ([0-9.]+) 秒：/gmu)].map((match) => Number(match[1]))
      return {
        passed: false, technicalPass: true, editorialPass: false, score: 52, summary: '画面叙事与稿件关联不足。',
        findings: [{ severity: 'major', category: 'relevance', timestampSeconds: timestamps[0], message: '开场主画面没有建立稿件提出的问题。' }],
        reviewEvidence: [
          { timestampSeconds: timestamps[0], observedMainVisual: '开场只有通用图表，没有呈现稿件中的具体问题。' },
          { timestampSeconds: timestamps.at(-1), observedMainVisual: '结尾仍是相同图表结构，缺少与结论对应的收束。' },
        ],
      }
    },
  })
  const started = await host.startVideoRender(currentAgent, { projectId: project.id, expectedRevision: project.revision, renderer: 'remotion', subtitleEnabled: false })
  const finished = await waitForOperation(host, currentAgent, project.id, started.id)
  assert.equal(finished.status, 'failed')
  assert.match(finished.error, /未通过独立审片/u)
  assert.match(finished.error, /2 次定向修复/u)
  assert.equal(finished.pipeline.review.passed, false)
  assert.equal(finished.pipeline.editorialRepair.attempts, 2)
  assert.equal(finished.pipeline.editorialRepair.history.length, 3)
  assert.equal(creatorCalls, 3)
  assert.equal(reviewerCalls, 3)
  const detail = await store.get(currentAgent, { projectId: project.id })
  assert.equal(detail.artifacts.video, undefined)
  assert.equal(detail.artifacts.qc, undefined)
})

test('repairs an editorial rejection, rerenders, and commits only the passing revision', async (t) => {
  if (!mediaBinariesAvailable() || !await remotionRendererAvailable()) { t.skip('ffmpeg, ffprobe, or Remotion is unavailable in this environment'); return }
  const cwd = await workspace(t)
  const store = new SpokenVideoProjectStore()
  const currentAgent = agent(cwd)
  let project = await projectWithApprovedSavedScript(currentAgent, store)
  project = await withTestVoiceover(cwd, store, currentAgent, project, 'review-repair', 'review-repair-voice-0001')
  let creatorCalls = 0
  let reviewerCalls = 0
  let repairPrompt = ''
  const host = new SpokenVideoMediaHost({
    projectsStore: store,
    videoCreator: async (input) => {
      creatorCalls += 1
      if (creatorCalls > 1) repairPrompt = input.prompt
      return fakeVideoCreator(input)
    },
    videoReviewer: async (input) => {
      reviewerCalls += 1
      if (reviewerCalls > 1) return passingVideoReviewer(input)
      await input.onDshStarted({ childSessionId: 'reviewer-child-initial', parentSessionId: 'video-parent-001' })
      await input.onDshEvent({ seq: 1, time: Date.now(), type: 'turn/start' })
      const timestamps = [...String(input.prompt).matchAll(/^- ([0-9.]+) 秒：/gmu)].map((match) => Number(match[1]))
      return {
        passed: false, technicalPass: true, editorialPass: false, score: 60, summary: '主体集中在上半部，画面下方留白过大。',
        findings: [{ severity: 'major', category: 'composition', timestampSeconds: timestamps[0], message: '需要重新分配主体尺度和垂直构图。' }],
        reviewEvidence: [
          { timestampSeconds: timestamps[0], observedMainVisual: '开场主体只占据画面上半部，底部没有有效视觉信息。' },
          { timestampSeconds: timestamps.at(-1), observedMainVisual: '结尾沿用相同结构，没有形成独立的视觉收束。' },
        ],
      }
    },
  })
  const started = await host.startVideoRender(currentAgent, { projectId: project.id, expectedRevision: project.revision, renderer: 'remotion', subtitleEnabled: false })
  const finished = await waitForOperation(host, currentAgent, project.id, started.id, 180_000)
  assert.equal(finished.status, 'succeeded', finished.error)
  assert.equal(creatorCalls, 2)
  assert.equal(reviewerCalls, 2)
  assert.match(repairPrompt, /主体集中在上半部/u)
  assert.match(repairPrompt, /重新分配主体尺度和垂直构图/u)
  const detail = await store.get(currentAgent, { projectId: project.id })
  assert.equal(detail.artifacts.video.data.remotion.editorialRepair.attempts, 1)
  assert.equal(detail.artifacts.video.data.remotion.editorialRepair.history.length, 2)
  assert.equal(detail.artifacts.qc.data.review.passed, true)
  assert.deepEqual(finished.dsh.sessions.map((session) => session.role), ['creator', 'reviewer', 'creator-repair-1', 'reviewer-2'])
})

test('rejects an unsafe automatic media path before it becomes an artifact', async (t) => {
  const cwd = await workspace(t)
  const store = new SpokenVideoProjectStore()
  const currentAgent = agent(cwd)
  const project = await projectWithApprovedScript(currentAgent, store)
  await assert.rejects(
    store.commitProduced(currentAgent, {
      projectId: project.id, expectedRevision: project.revision, stage: 'voiceover', idempotencyKey: 'media-unsafe-0001', source: 'spoken-video/tts',
      payload: { mode: 'tts', provider: 'cosyvoice', settings: { rate: 1, volume: 1, pitch: 0 }, audio: { file: '../outside.wav', mediaType: 'audio/wav', bytes: 10, durationSeconds: 1 } },
    }),
    (error) => error instanceof SpokenVideoStoreError && error.code === 'SPOKEN_VIDEO_FILE_INVALID',
  )
})

async function savedAudioFixture(t, { subtitle = true } = {}) {
  const cwd = await workspace(t)
  const store = new SpokenVideoProjectStore()
  const currentAgent = agent(cwd)
  const project = await projectWithSavedScript(currentAgent, store)
  const detail = await store.get(currentAgent, { projectId: project.id })
  const root = join(cwd, 'data')
  await mkdir(join(root, 'audio-media', 'voiceovers'), { recursive: true })
  await writeFile(join(root, 'audio-media', 'voiceovers', 'saved-audio.wav'), 'audio')
  const task = {
    id: 'saved-audio', type: 'voiceover', status: 'succeeded', createdAt: new Date().toISOString(),
    source: { kind: 'saved-script', projectId: project.id, title: project.title, text: detail.artifacts.script.data.body, scriptRevision: detail.artifacts.script.revision },
    input: { provider: 'bailian', rate: 1, volume: 1, pitch: 0 }, projectRevision: project.revision,
    result: { provider: 'bailian', audio: { file: 'audio-media/voiceovers/saved-audio.wav', mediaType: 'audio/wav', bytes: 5, durationSeconds: 1 } },
    subtitle: subtitle ? { status: 'succeeded', current: { id: 'subtitle-one', mode: 'asr', srt: '1\n00:00:00,000 --> 00:00:01,000\n已有字幕。', cueCount: 1 } } : { status: 'idle' },
  }
  await writeFile(join(root, 'audio-tasks.json'), JSON.stringify({ schemaVersion: 1, tasks: [task] }))
  const host = new SpokenVideoMediaHost({ projectsStore: store, fetch: async () => { assert.fail('sync must not call a media provider') } })
  return { cwd, root, store, currentAgent, project, task, host }
}

test('recovers completed audio and subtitles into an unapproved saved project without regeneration', async (t) => {
  const { root, store, currentAgent, project, task, host } = await savedAudioFixture(t)
  // A previous failed commit may already have copied the immutable media file.
  const orphanDirectory = join(root, 'projects', project.id, 'media', 'voiceovers')
  await mkdir(orphanDirectory, { recursive: true })
  await writeFile(join(orphanDirectory, `${task.id}.wav`), 'audio')
  const synced = await host.syncAudioTask(currentAgent, { taskId: task.id })
  assert.equal(synced.status, 'succeeded')
  assert.equal(synced.projectSyncError, null)
  assert.equal(synced.subtitleSyncError, null)
  let detail = await store.get(currentAgent, { projectId: project.id })
  assert.equal(detail.scriptApproval, null)
  assert.ok(detail.completedStages.includes('voiceover'))
  assert.ok(detail.completedStages.includes('subtitles'))
  assert.equal(detail.artifacts.subtitles.data.sourceAudioFile, detail.artifacts.voiceover.data.audio.file)
  const revision = detail.revision
  const repeated = await host.syncAudioTask(currentAgent, { taskId: task.id })
  assert.equal(repeated.projectSyncError, null)
  assert.equal(repeated.subtitleSyncError, null)
  assert.equal((await store.get(currentAgent, { projectId: project.id })).revision, revision, 'repeated recovery must not invalidate downstream work')
  const updated = await host.saveAudioTaskSubtitles(currentAgent, { taskId: task.id, srt: '1\n00:00:00,000 --> 00:00:01,000\n校对后的字幕。' })
  assert.equal(updated.subtitleSyncError, null)
  detail = await store.get(currentAgent, { projectId: project.id })
  assert.match(detail.artifacts.subtitles.data.srt, /校对后的字幕/u)
  await host.syncAudioTask(currentAgent, { taskId: task.id })
  assert.equal((await store.get(currentAgent, { projectId: project.id })).revision, detail.revision)
})

test('sync preserves independent audio and reports changed scripts or newer voiceovers', async (t) => {
  const { store, currentAgent, project, task, host } = await savedAudioFixture(t, { subtitle: false })
  await host.syncAudioTask(currentAgent, { taskId: task.id })
  let detail = await store.get(currentAgent, { projectId: project.id })
  detail = (await store.commit(currentAgent, { projectId: detail.id, expectedRevision: detail.revision, stage: 'voiceover', idempotencyKey: 'newer-voice-version', payload: { notes: '其他配音' } })).project
  const stale = await host.syncAudioTask(currentAgent, { taskId: task.id })
  assert.match(stale.projectSyncError, /其他配音版本/u)
  assert.equal(stale.status, 'succeeded')
  assert.equal((await store.get(currentAgent, { projectId: project.id })).revision, detail.revision)
  detail = (await store.commit(currentAgent, { projectId: detail.id, expectedRevision: detail.revision, stage: 'script', idempotencyKey: 'changed-script-version', payload: { body: '修改后的新稿件。' } })).project
  const changed = await host.syncAudioTask(currentAgent, { taskId: task.id })
  assert.match(changed.projectSyncError, /当前稿件版本不一致/u)
  assert.ok(!(await store.get(currentAgent, { projectId: project.id })).completedStages.includes('voiceover'))
})

test('missing audio produces a visible recoverable sync error without marking generation failed', async (t) => {
  const { root, host, currentAgent, task, store, project } = await savedAudioFixture(t)
  const file = join(root, task.result.audio.file)
  await rm(file)
  const failed = await host.syncAudioTask(currentAgent, { taskId: task.id })
  assert.equal(failed.status, 'succeeded')
  assert.match(failed.projectSyncError, /同步项目失败/u)
  assert.equal(failed.projectSync, null)
  assert.ok(!(await store.get(currentAgent, { projectId: project.id })).completedStages.includes('voiceover'))
  await writeFile(file, 'audio')
  const retried = await host.syncAudioTask(currentAgent, { taskId: task.id })
  assert.equal(retried.projectSyncError, null)
  assert.equal(retried.subtitleSyncError, null)
  assert.ok((await store.get(currentAgent, { projectId: project.id })).completedStages.includes('subtitles'))
})

test('audio tasks default to automatic subtitles, isolate ASR failures, and allow opting out', async (t) => {
  if (!mediaBinariesAvailable()) { t.skip('ffmpeg or ffprobe is unavailable'); return }
  const cwd = await workspace(t)
  const voiceFile = join(cwd, 'auto-subtitle.wav')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', voiceFile])
  const audio = await readFile(voiceFile)
  const currentAgent = agent(cwd)
  for (const scenario of ['success', 'asr-failure', 'submission-failure', 'opt-out']) {
    const store = new SpokenVideoProjectStore()
    const project = await projectWithApprovedScript(currentAgent, store)
    const work = []
    let asrCalls = 0
    const host = new SpokenVideoMediaHost({
      projectsStore: store, pollIntervalMs: 1,
      background: (promise) => { work.push(promise); return promise },
      environment: { LWB_SPOKEN_VIDEO_TTS_BASE_URL: 'https://fixture.test' },
      fetch: async (url) => {
        const path = new URL(String(url)).pathname
        if (path === '/api/v1/tts/synthesize') return new Response(JSON.stringify({ code: 200, data: { task_id: 'voice' } }))
        if (path === '/api/v1/tts/tasks/voice') return new Response(JSON.stringify({ code: 200, data: { status: 'completed', duration: 1 } }))
        if (path === '/api/v1/tts/tasks/voice/audio') return new Response(audio)
        if (path === '/api/v1/subtitles/generate') {
          asrCalls += 1
          if (scenario === 'asr-failure') throw new Error('fixture ASR unavailable')
          return new Response(JSON.stringify({ code: 200, data: { task_id: 'subtitle' } }))
        }
        if (path === '/api/v1/subtitles/tasks/subtitle') return new Response(JSON.stringify({ code: 200, data: { status: 'completed', subtitle_srt: '1\n00:00:00,000 --> 00:00:01,000\n自动生成字幕。' } }))
        throw new Error(`unexpected fixture request ${path}`)
      },
    })
    if (scenario === 'submission-failure') host.startAudioTaskSubtitles = async () => { throw new Error('fixture subtitle submission failed') }
    const started = await host.startAudioTask(currentAgent, { text: (await store.get(currentAgent, { projectId: project.id })).artifacts.script.data.body, sourceProjectId: project.id, provider: 'legacy', ...(scenario === 'opt-out' ? { subtitleEnabled: false } : {}) })
    // Drain voiceover plus any work it schedules; no background writes survive cleanup.
    for (let index = 0; index < work.length; index += 1) await work[index]
    const finished = await host.audioTask(currentAgent, { taskId: started.id })
    assert.equal(finished.status, 'succeeded', `${scenario}: ${finished.error}`)
    assert.equal(finished.error, null)
    assert.deepEqual(Buffer.from((await host.readAudioTaskMedia(currentAgent, { taskId: started.id })).data, 'base64'), audio)
    assert.ok(finished.projectSync, `${scenario}: audio still syncs into the project`)
    assert.equal(finished.subtitle.status, scenario === 'success' ? 'succeeded' : scenario === 'opt-out' ? 'idle' : 'failed')
    if (scenario === 'success') {
      assert.equal(asrCalls, 1)
      assert.equal(finished.subtitle.cueCount, 1)
      assert.ok((await store.get(currentAgent, { projectId: project.id })).completedStages.includes('subtitles'))
    } else if (scenario === 'opt-out') assert.equal(asrCalls, 0)
    else assert.match(finished.subtitle.error, /fixture/u)
  }
})

test('scheduled project media appears in the audio feed with playback, subtitle editing, retries and frozen history', async (t) => {
  if (!mediaBinariesAvailable()) { t.skip('ffmpeg or ffprobe is unavailable'); return }
  const cwd = await workspace(t)
  const currentAgent = agent(cwd)
  const store = new SpokenVideoProjectStore()
  const project = await projectWithApprovedScript(currentAgent, store)
  const audioFile = join(cwd, 'fixture.wav')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', audioFile])
  const audio = await readFile(audioFile)
  const work = []
  let failAsr = false
  let voiceCalls = 0
  const host = new SpokenVideoMediaHost({
    projectsStore: store, environment: { LWB_SPOKEN_VIDEO_TTS_BASE_URL: 'https://fixture.test' },
    background: (promise) => { work.push(promise); return promise },
    fetch: async (url) => {
      const path = new URL(String(url)).pathname
      const reply = (data) => new Response(JSON.stringify({ code: 200, data }))
      if (path === '/api/v1/tts/synthesize') { voiceCalls++; return reply({ task_id: 'voice' }) }
      if (path === '/api/v1/tts/tasks/voice') return reply({ status: 'completed', duration: 1 })
      if (path === '/api/v1/tts/tasks/voice/audio') return new Response(audio)
      if (path === '/api/v1/subtitles/generate') {
        if (failAsr) throw new Error('fixture ASR unavailable')
        return reply({ task_id: 'subtitle' })
      }
      if (path === '/api/v1/subtitles/tasks/subtitle') return reply({ status: 'completed', subtitle_srt: '1\n00:00:00,000 --> 00:00:01,000\n自动字幕。' })
      throw new Error(`Unexpected URL ${url}`)
    },
  })
  const drain = async () => { for (let i = 0; i < work.length; i++) await work[i] }
  // These are exactly the project entry points used by the schedule host.
  const voice = await host.startVoiceover(currentAgent, { projectId: project.id, expectedRevision: project.revision, provider: 'legacy' })
  assert.equal((await host.listAudioTasks(currentAgent, { status: 'active' })).items[0].id, voice.id)
  await drain()
  const voiced = await store.get(currentAgent, { projectId: project.id })
  const captions = await host.startSubtitles(currentAgent, { projectId: project.id, expectedRevision: voiced.revision, provider: 'legacy' })
  await drain()
  const context = { workspacePath: cwd }
  let task = (await host.listAudioTasks(currentAgent)).items[0]
  assert.equal(task.id, voice.id)
  assert.equal(task.status, 'succeeded')
  assert.equal(task.current, true)
  assert.equal(task.subtitle.status, 'succeeded')
  assert.match(task.subtitle.srt, /自动字幕/u)
  assert.equal(task.subtitleExecution.id, captions.id)
  assert.deepEqual(Buffer.from((await host.readAudioTaskMedia(currentAgent, { taskId: voice.id })).data, 'base64'), audio)
  assert.equal((await host.readAudioTaskMedia(currentAgent, { taskId: voice.id })).mediaType, 'audio/wav')
  const details = await executionDetail(context, task.execution)
  assert.equal(details.id, voice.id)
  assert.equal((await executionDetail(context, task.subtitleExecution)).id, captions.id)
  const originalRevision = (await store.get(currentAgent, { projectId: project.id })).revision
  await host.syncAudioTask(currentAgent, { taskId: voice.id })
  assert.equal((await store.get(currentAgent, { projectId: project.id })).revision, originalRevision)
  const edited = '1\n00:00:00,000 --> 00:00:01,000\n校对后的字幕。'
  task = await host.saveAudioTaskSubtitles(currentAgent, { taskId: voice.id, srt: edited })
  assert.equal(task.subtitle.srt, `${edited}\n`)
  assert.equal((await store.get(currentAgent, { projectId: project.id })).artifacts.subtitles.data.srt, `${edited}\n`)
  const editedDetails = await executionDetail(context, task.execution)
  const asset = editedDetails.assets.find((item) => item.label === '字幕 SRT')
  assert.equal((await executionAsset(context, { ...task.execution, assetId: asset.id })).text, `${edited}\n`)
  const originalCaptions = await executionDetail(context, task.subtitleExecution)
  assert.match(originalCaptions.record.result.artifact.data.srt, /自动字幕/u, 'editing preserves the original ASR result')
  failAsr = true
  await host.startAudioTaskSubtitles(currentAgent, { taskId: voice.id, provider: 'legacy' })
  await drain()
  task = await host.audioTask(currentAgent, { taskId: voice.id })
  assert.equal(task.status, 'succeeded')
  assert.equal(task.subtitle.status, 'failed')
  assert.match(task.subtitle.error, /fixture ASR/u)
  failAsr = false
  await host.startAudioTaskSubtitles(currentAgent, { taskId: voice.id, provider: 'legacy' })
  await drain()
  task = await host.audioTask(currentAgent, { taskId: voice.id })
  assert.equal(task.subtitle.status, 'succeeded')
  assert.match(task.subtitle.srt, /自动字幕/u)
  const detail = await store.get(currentAgent, { projectId: project.id })
  const second = await host.startVoiceover(currentAgent, { projectId: project.id, expectedRevision: detail.revision, provider: 'legacy' })
  await drain()
  const historical = await host.audioTask(currentAgent, { taskId: voice.id })
  assert.equal(historical.current, false)
  assert.match(historical.subtitle.srt, /自动字幕/u)
  assert.equal((await host.audioTask(currentAgent, { taskId: second.id })).subtitle.status, 'idle', 'old subtitles never attach to the new audio')
  assert.deepEqual(Buffer.from((await host.readAudioTaskMedia(currentAgent, { taskId: voice.id })).data, 'base64'), audio)
  await assert.rejects(host.saveAudioTaskSubtitles(currentAgent, { taskId: voice.id, srt: edited }), /历史版本/u)
  await assert.rejects(host.startAudioTaskSubtitles(currentAgent, { taskId: voice.id, provider: 'legacy' }), /历史版本/u)
  assert.equal(voiceCalls, 2, 'listing and subtitle operations never regenerate voiceovers')
  await assert.rejects(readFile(join(cwd, 'data', 'audio-tasks.json')), { code: 'ENOENT' }, 'project history is not duplicated into standalone storage')
  const accountId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  await writeFile(join(cwd, 'data', 'audio-tasks.json'), JSON.stringify({ schemaVersion: 1, tasks: [
    { id: 'standalone', status: 'failed', createdAt: '2099-01-01T00:00:00.000Z', source: { title: '独立配音', text: '独立文稿' } },
  ] }))
  const scopedHost = new SpokenVideoMediaHost({ projectsStore: {
    list: async () => (await store.list(currentAgent)).map((item) => ({ ...item, account: { id: accountId } })),
    get: (...args) => store.get(...args),
  } })
  const mixed = await scopedHost.listAudioTasks(currentAgent, { limit: 1 })
  assert.equal(mixed.total, 3)
  assert.equal(mixed.items[0].id, 'standalone')
  assert.equal(mixed.counts.succeeded, 2)
  assert.equal(mixed.counts.failed, 1)
  assert.equal((await scopedHost.listAudioTasks(currentAgent, { general: true })).total, 1)
  const scoped = await scopedHost.listAudioTasks(currentAgent, { accountId, limit: 1, offset: 1 })
  assert.equal(scoped.total, 2)
  assert.equal(scoped.items.length, 1)
  assert.equal(scoped.counts.failed, 0)
  assert.equal((await scopedHost.listAudioTasks(currentAgent, { accountId, query: '已确认的口播稿' })).total, 2)
  assert.equal((await scopedHost.listAudioTasks(currentAgent, { accountId, status: 'failed' })).total, 0)
  assert.equal((await scopedHost.listAudioTasks(currentAgent, { accountId, provider: 'legacy' })).total, 2)
})

function lwbMediaHost({ lwbTestKey, ...options }) {
  return new SpokenVideoMediaHost({ ...options, account: lwbAccountFixture(options.fetch, lwbTestKey) })
}
