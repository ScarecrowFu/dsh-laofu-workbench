import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { executionDetail, executionList, executionAsset, executionAddress, executionFrame, executionTransition, displayValue } from '../spoken-video-execution.mjs'
import { SpokenVideoGateway } from '../gateway.mjs'

async function fixture(t) {
  const workspacePath = await mkdtemp(join(tmpdir(), 'spoken-execution-'))
  t.after(() => rm(workspacePath, { recursive: true, force: true }))
  const write = async (file, value) => { const path = join(workspacePath, 'data', file); await mkdir(dirname(path), { recursive: true }); await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value)); return path }
  return { workspacePath, write }
}
const projectId = '12345678-1234-1234-1234-123456789abc'

test('execution resolves owned tasks and immutable publish versions without following current pointers', async (t) => {
  const ctx = await fixture(t)
  await ctx.write('publish-tasks.json', { tasks: [{ id: 'old', projectId, resultRevision: 5 }, { id: 'cover', projectId, resultRevision: 6 }] })
  await ctx.write(`projects/${projectId}/artifacts/000005-packaging-old.json`, { revision: 5, data: { taskId: 'old', content: { title: 'Original' } } })
  await ctx.write(`projects/${projectId}/artifacts/000006-packaging-cover.json`, { revision: 6, data: { taskId: 'old', content: { title: 'Regenerated' } } })
  assert.equal((await executionDetail(ctx, { kind: 'publish', id: 'old' })).record.result.content.title, 'Original')
  assert.equal((await executionDetail(ctx, { kind: 'publish', id: 'cover' })).record.result.content.title, 'Regenerated')
  await assert.rejects(executionDetail(ctx, { kind: 'publish', id: '../private' }), /标识无效/u)
  await assert.rejects(executionDetail(ctx, { kind: 'unknown', id: 'old' }), /不支持/u)
  assert.equal(JSON.parse(await readFile(join(ctx.workspacePath, 'data/publish-tasks.json'), 'utf8')).tasks[0].result, undefined)
})

test('assets are task-bound, contained through symlinks, and include project subtitles and render logs', async (t) => {
  const ctx = await fixture(t)
  const prefix = `projects/${projectId}/`
  await ctx.write(`${prefix}media/runs.json`, { runs: [{ id: 'subtitle', type: 'subtitles', result: { artifact: { data: { srtFile: 'media/captions.srt' } } } }, { id: 'render', pipeline: { workspaceDir: 'media/video-agent/render' } }] })
  await ctx.write(`${prefix}media/captions.srt`, '1\n00:00:00,000 --> 00:00:01,000\n字幕\n')
  await ctx.write(`${prefix}media/video-agent/render/outputs/render.log`, 'Rendered 12/12 frames')
  const request = { kind: 'media', id: 'subtitle', projectId }
  const detail = await executionDetail(ctx, request)
  assert.match((await executionAsset(ctx, { ...request, assetId: detail.assets[0].id })).text, /字幕/u)
  await ctx.write(`${prefix}media/runs.json`, { runs: [{ id: 'subtitle', type: 'subtitles', result: { video: { file: 'media/later.mp4' }, artifact: { data: { srtFile: 'media/captions.srt' } } } }, { id: 'render', pipeline: { workspaceDir: 'media/video-agent/render' } }] })
  assert.match((await executionAsset(ctx, { ...request, assetId: detail.assets[0].id })).text, /字幕/u, 'new assets must not renumber existing preview targets')
  await assert.rejects(executionAsset(ctx, { ...request, assetId: 'unowned' }), /不属于/u)
  const render = await executionDetail(ctx, { ...request, id: 'render' })
  const log = render.assets.find((item) => item.label === '渲染日志')
  assert.match((await executionAsset(ctx, { ...request, id: 'render', assetId: log.id })).text, /Rendered/)
  const external = join(ctx.workspacePath, 'secret.txt'); await writeFile(external, 'private')
  await rm(join(ctx.workspacePath, 'data', prefix, 'media/captions.srt'))
  await symlink(external, join(ctx.workspacePath, 'data', prefix, 'media/captions.srt'))
  await assert.rejects(executionAsset(ctx, { ...request, assetId: detail.assets[0].id }), /不属于/u)
})

test('project media execution resolves its saved artifact pointer and rejects mismatched artifacts', async (t) => {
  const ctx = await fixture(t)
  const file = 'artifacts/4-subtitles-original.json'
  const srt = '1\n00:00:00,000 --> 00:00:01,000\n原始字幕。\n'
  await ctx.write(`projects/${projectId}/${file}`, { id: 'original', projectId, stage: 'subtitles', revision: 4, data: { srt, srtFile: 'media/subtitles/original.srt', cueCount: 1 } })
  await ctx.write(`projects/${projectId}/media/subtitles/original.srt`, srt)
  await ctx.write(`projects/${projectId}/media/runs.json`, { runs: [{ id: 'subtitle', type: 'subtitles', projectId, status: 'succeeded', result: { artifact: { id: 'original', file, revision: 4 } } }] })
  const request = { kind: 'media', projectId, id: 'subtitle' }
  const detail = await executionDetail(ctx, request)
  assert.equal(detail.record.result.artifact.data.srt, srt)
  assert.equal((await executionAsset(ctx, { ...request, assetId: detail.assets[0].id })).text, srt)
  const stored = JSON.parse(await readFile(join(ctx.workspacePath, 'data', `projects/${projectId}/media/runs.json`), 'utf8'))
  assert.equal(stored.runs[0].result.artifact.data, undefined, 'reading a pointer never rewrites stored history')
  await ctx.write(`projects/${projectId}/${file}`, { id: 'wrong', projectId, stage: 'subtitles', data: { srt } })
  await assert.rejects(executionDetail(ctx, request), /产物与记录不匹配/u)
})

test('native history and assistant baseline preserve actual content, positions and redact credentials', () => {
  const stream = [{ type: 'reasoning-chunks', time0: 100, index: 0, dt: [], texts: ['核对来源'] }]
  const frame = executionFrame({ type: 'snapshot', cursor: 4, hasMore: true, records: [
    { type: 'event', event: { type: 'tool/call', seq: 3, time: 100, data: { name: 'search', arguments: '{"query":"字幕","apiKey":"private-value"}' } } },
    { type: 'event', event: { type: 'llm/request', seq: 4, time: 100, data: { headers: 'must not display' } } },
  ], assistantStream: { revision: 9, activeAttempt: { attemptId: 'a', nextIndex: 1, stream } } })
  assert.equal(frame.cursor, 4); assert.equal(frame.hasMore, true)
  assert.equal(frame.records[1].event.type, 'execution/omitted')
  assert.match(frame.records[0].event.data.arguments, /字幕/u)
  assert.doesNotMatch(JSON.stringify(frame), /private-value|must not display/)
  assert.equal(frame.assistantStream.activeAttempt.chunks[0].text, '核对来源')
  const failed = executionFrame({ type: 'event', event: { type: 'assistant/attempt', seq: 5, data: { stream } } })
  assert.equal(failed.event.data.chunks[0].type, 'reasoning-delta')
  const chunk = { type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'a', index: 1, chunk: { type: 'text-delta', index: 1, text: '真实结果' } } }
  assert.deepEqual(executionFrame(chunk), chunk)
  assert.doesNotMatch(JSON.stringify(displayValue({ password: 'secret-value', nested: '{"authorization":"secret-value"}' })), /secret-value/)
})

test('task history returns newest 100 irrespective of insertion order and preserves subtitle versions', async (t) => {
  const ctx = await fixture(t)
  const tasks = Array.from({ length: 110 }, (_, i) => ({ id: String(i), projectId, createdAt: new Date(i * 1000).toISOString() })).reverse()
  await ctx.write('publish-tasks.json', { tasks })
  const items = await executionList(ctx, { kind: 'publish', projectId })
  assert.equal(items.length, 100); assert.equal(items[0].id, '109'); assert.equal(items.at(-1).id, '10')
  const before = { status: 'succeeded', subtitle: { status: 'running', current: { id: 'v1', srt: 'original' } } }
  const next = { ...before, subtitle: { status: 'succeeded', current: { id: 'v2', srt: 'corrected', mode: 'manual' } } }
  executionTransition(before, next, '字幕服务')
  assert.equal(next.subtitle.history[0].srt, 'original')
  assert.match(next.executionEvents.at(-1).label, /校对/u)
})

test('gateway observes only stored child addresses, preserves live frames and cancels the viewer independently', async (t) => {
  const ctx = await fixture(t)
  await ctx.write('topic-generations.json', { generations: [{ id: 'job', dsh: { parentSessionId: 'owned-parent', childSessionId: 'owned-child' } }] })
  const lifetime = new AbortController(); const viewer = new AbortController(); let receivedSignal
  const receiver = { ctx: { spokenVideoScope: { request: (operation) => operation(ctx), signal: lifetime.signal }, sessionController: {
    async *follow(request, signal) {
      assert.deepEqual(request.address, { kind: 'subagent', mode: 'unknown', parentSessionId: 'owned-parent', childSessionId: 'owned-child' })
      assert.equal(request.assistantStream, true); receivedSignal = signal
      yield { type: 'snapshot', cursor: -1, records: [], hasMore: false }
      yield { type: 'assistant-stream', frame: { type: 'start', attemptId: 'a', revision: 1 } }
      yield { type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'a', revision: 2, index: 0, chunk: { type: 'text-delta', index: 0, text: '开始创作' } } }
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
    },
    async page(request) { assert.equal(request.beforeSeq, 3); return { records: [], hasMore: false } },
  } } }
  const request = { kind: 'topic', id: 'job', role: 'agent', childSessionId: 'forged', parentSessionId: 'forged' }
  assert.equal((await executionAddress(ctx, request)).childSessionId, 'owned-child')
  await assert.rejects(executionAddress(ctx, { ...request, role: 'forged' }), /没有可读取/u)
  const it = SpokenVideoGateway.prototype.followExecution.call(receiver, request, viewer.signal)
  assert.equal((await it.next()).value.type, 'snapshot')
  assert.equal((await it.next()).value.frame.type, 'start')
  assert.equal((await it.next()).value.frame.chunk.text, '开始创作')
  const ended = it.next(); viewer.abort(); await ended
  assert.equal(receivedSignal.aborted, true); assert.equal(lifetime.signal.aborted, false)
  assert.deepEqual(await SpokenVideoGateway.prototype.executionPage.call(receiver, { ...request, throughSeq: 10, beforeSeq: 3 }, viewer.signal), { records: [], hasMore: false })
})

test('account completion persists its own session and suggestion, and interrupted history recovers', async (t) => {
  const { SpokenVideoContentStore } = await import('../spoken-video-content-store.mjs')
  const ctx = await fixture(t)
  const id = '12345678-1234-1234-1234-123456789def'
  const store = new SpokenVideoContentStore({ accountExecutor: async ({ onDshStarted }) => {
    await onDshStarted({ parentSessionId: 'account-parent', childSessionId: 'account-child' })
    return { name: '测试账号', positioning: '通俗解释技术', summary: '完善定位' }
  } })
  const response = await store.suggestAccountProfile(ctx, { name: '测试账号', executionId: id })
  const detail = await executionDetail(ctx, { kind: 'account', id })
  assert.deepEqual(detail.record.suggestion, response)
  assert.equal(detail.status, 'completed'); assert.equal(detail.sessions[0].childSessionId, 'account-child')
  await ctx.write('account-generations.json', { schemaVersion: 1, generations: [{ id, status: 'running' }] })
  // workspacePath is canonically bound in production; a test fixture may use /var's alias.
  const { realpath } = await import('node:fs/promises')
  const restarted = new SpokenVideoContentStore({ workspacePath: await realpath(ctx.workspacePath) })
  await restarted.recoverInterruptedAccountGenerations()
  assert.equal((await executionDetail(ctx, { kind: 'account', id })).status, 'failed')
})
