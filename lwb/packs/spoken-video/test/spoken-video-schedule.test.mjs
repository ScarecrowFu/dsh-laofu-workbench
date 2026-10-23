import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  approvesScript,
  DEPTH_STEPS,
  emptyScheduleFile,
  isoWeekday,
  missedSlot,
  nextRunAt,
  parseScheduleRequest,
  reduceRunStatus,
  SCHEDULE_SCHEMA,
  scheduleDue,
  scheduleFile,
  scriptInputOf,
  SpokenVideoScheduleError,
  stepsForRun,
  topicInputOf,
  validDays,
  validTime,
  weekdayLabels,
} from '../spoken-video-schedule.mjs'
import { SpokenVideoScheduleHost } from '../spoken-video-schedule-host.mjs'

function agent(cwd) { return { session: { header: { cwd } } } }

/** A fixed local clock so weekday and minute matching are deterministic. */
function at(parts) { return new Date(parts).toISOString() }

async function workspace(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'lwb-spoken-video-schedule-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const cwd = join(root, 'workspace')
  await mkdir(join(cwd, 'data'), { recursive: true })
  await writeFile(join(cwd, 'data', 'signals.json'), JSON.stringify({
    schemaVersion: 10,
    sources: [
      { id: 'baidu', name: '百度热榜', kind: 'baidu-hot', url: 'https://top.baidu.com/board', repository: null, enabled: true, intervalMinutes: 60, maxItems: 30, requiredKeywords: [], excludeKeywords: [], tags: [], family: '公开热榜', createdAt: at('2026-09-01'), updatedAt: at('2026-09-01'), cache: { etag: null, lastModified: null }, health: { status: 'ready', lastAttemptAt: at('2026-09-01'), lastSuccessAt: at('2026-09-01'), lastError: null, lastHttpStatus: 200, lastDurationMs: 10, lastNewSignalCount: 1 } },
      { id: 'ai-daily-import', name: 'AI 内容日报', kind: 'ai-daily-json', url: 'https://scitiger.cn/reports/daily.json', repository: null, enabled: true, intervalMinutes: 60, maxItems: 200, requiredKeywords: [], excludeKeywords: [], tags: [], family: '报告导入', createdAt: at('2026-09-01'), updatedAt: at('2026-09-01'), cache: { etag: null, lastModified: null }, health: { status: 'ready', lastAttemptAt: at('2026-09-01'), lastSuccessAt: at('2026-09-01'), lastError: null, lastHttpStatus: 200, lastDurationMs: 10, lastNewSignalCount: 1 } },
    ],
    signals: [], runs: [], batches: [],
  }))
  await writeFile(join(cwd, 'data', 'topic-profile.json'), JSON.stringify({
    schemaVersion: 2,
    defaultAccountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    accounts: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'AI明白局', revision: 1, status: 'active', positioning: null, audience: null, pillars: [], boundary: null, updatedAt: at('2026-09-01'), createdAt: at('2026-09-01') }],
  }))
  return { root, cwd }
}

/* ------------------------------- pure layer ------------------------------- */

test('isoWeekday maps Monday to 1 and Sunday to 7', () => {
  // 2026-09-07 is a Monday, 2026-09-13 a Sunday.
  assert.equal(isoWeekday(new Date('2026-09-07T10:00:00')), 1)
  assert.equal(isoWeekday(new Date('2026-09-11T10:00:00')), 5)
  assert.equal(isoWeekday(new Date('2026-09-13T10:00:00')), 7)
  assert.equal(weekdayLabels([1, 2, 3, 4, 5, 6, 7]), '每天')
  assert.equal(weekdayLabels([1, 2, 3, 4, 5]), '工作日')
  assert.equal(weekdayLabels([6, 7]), '周末')
  assert.equal(weekdayLabels([3, 1]), '周一、周三')
})

test('validDays and validTime reject unusable schedules', () => {
  assert.deepEqual(validDays([5, 1, 1]), [1, 5])
  assert.throws(() => validDays([]), /1-7 天/u)
  assert.throws(() => validDays([0]), /1-7 的整数/u)
  assert.throws(() => validDays([8]), /1-7 的整数/u)
  assert.equal(validTime('21:30'), '21:30')
  assert.throws(() => validTime('24:00'), /HH:MM/u)
  assert.throws(() => validTime('9:00'), /HH:MM/u)
  assert.throws(() => validTime('21:70'), /HH:MM/u)
})

test('scheduleDue only fires on a matching weekday and minute, once per slot', () => {
  const schedule = { enabled: true, days: [5], time: '21:00', lastRunAt: null }
  const friday21 = new Date('2026-09-11T21:00:10')
  assert.equal(scheduleDue(schedule, friday21), true)
  assert.equal(scheduleDue(schedule, new Date('2026-09-11T21:01:00')), false, 'a minute later is not due')
  assert.equal(scheduleDue(schedule, new Date('2026-09-12T21:00:10')), false, 'Saturday is not in days')
  assert.equal(scheduleDue(schedule, new Date('2026-09-11T20:00:10')), false)
  assert.equal(scheduleDue({ ...schedule, enabled: false }, friday21), false)
  // The pre-written stamp is what stops the next 30s tick from restarting.
  assert.equal(scheduleDue({ ...schedule, lastRunAt: friday21.toISOString() }, new Date('2026-09-11T21:00:40')), false)
})

test('nextRunAt finds the next matching local slot and null when disabled', () => {
  const schedule = { enabled: true, days: [5], time: '21:00' }
  const before = nextRunAt(schedule, new Date('2026-09-11T10:00:00'))
  assert.equal(new Date(before).getHours(), 21)
  assert.equal(isoWeekday(new Date(before)), 5)
  const after = nextRunAt(schedule, new Date('2026-09-11T22:00:00'))
  assert.equal(isoWeekday(new Date(after)), 5, 'rolls to next Friday')
  assert.ok(Date.parse(after) > Date.parse(before))
  assert.equal(nextRunAt({ ...schedule, enabled: false }, new Date('2026-09-11T10:00:00')), null)
})

test('missedSlot reports a passed slot without a same-day run and never a future one', () => {
  const schedule = { enabled: true, days: [5], time: '21:00', lastRunAt: null }
  assert.equal(missedSlot(schedule, new Date('2026-09-11T22:00:00')), true)
  assert.equal(missedSlot(schedule, new Date('2026-09-11T20:00:00')), false, 'slot has not passed')
  assert.equal(missedSlot(schedule, new Date('2026-09-12T22:00:00')), false, 'not a scheduled weekday')
  assert.equal(missedSlot({ ...schedule, lastRunAt: at(new Date('2026-09-11T21:00:05')) }, new Date('2026-09-11T22:00:00')), false)
  assert.equal(missedSlot({ ...schedule, lastRunAt: at(new Date('2026-09-04T21:00:05')) }, new Date('2026-09-11T22:00:00')), true, 'last week does not count')
})

test('stepsForRun expands each depth and drops subtitles when disabled', () => {
  assert.deepEqual(stepsForRun('topic'), ['topic'])
  assert.deepEqual(stepsForRun('script'), ['topic', 'script'])
  assert.deepEqual(stepsForRun('video'), ['topic', 'script', 'approve', 'voiceover', 'subtitles', 'video'])
  assert.deepEqual(stepsForRun('packaging'), DEPTH_STEPS.packaging)
  assert.deepEqual(stepsForRun('packaging', false), ['topic', 'script', 'approve', 'voiceover', 'video', 'packaging'])
  assert.throws(() => stepsForRun('queue'), /自动化深度无效/u)
})

test('approvesScript marks only the depths that cross the gate', () => {
  assert.equal(approvesScript('topic'), false)
  assert.equal(approvesScript('script'), false, 'a human still confirms the draft')
  assert.equal(approvesScript('video'), true)
  assert.equal(approvesScript('packaging'), true)
})

test('parseScheduleRequest normalizes defaults and clamps to the topic contract', () => {
  const parsed = parseScheduleRequest({ name: '  晚间自动出片  ', days: [5, 1], time: '21:00', depth: 'video', accountId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' })
  assert.equal(parsed.name, '晚间自动出片')
  assert.deepEqual(parsed.days, [1, 5])
  assert.equal(parsed.accountId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  assert.equal(parsed.enabled, true)
  assert.equal(parsed.depth, 'video')
  assert.equal(parsed.angle, null)
  assert.deepEqual(parsed.sources, { sourceIds: [], platforms: [], excludeSignalIds: [] })
  assert.equal(parsed.perRunLimit, 1)
  assert.deepEqual(parsed.production, { orientation: 'landscape', subtitleEnabled: true, scriptTier: 'medium', voice: null, visualBrief: null })
  // Depth is a deliberate choice, never a silent default.
  assert.throws(() => parseScheduleRequest({ name: 'x', days: [1], time: '09:00' }), /自动化深度无效/u)
  assert.throws(() => parseScheduleRequest({ name: 'x', days: [1], time: '09:00', depth: 'nope' }), /自动化深度无效/u)
  assert.throws(() => parseScheduleRequest({ name: 'x', days: [1], time: '09:00', depth: 'topic', perRunLimit: 9 }), /1-3/u)
  assert.throws(() => parseScheduleRequest({ name: '', days: [1], time: '09:00', depth: 'topic' }), /不能为空/u)
})

test('parseScheduleRequest rejects unknown depths and validates voice through the media normalizer', () => {
  const parsed = parseScheduleRequest({
    name: '带音色', days: [1], time: '09:00', depth: 'video',
    production: { orientation: 'landscape', voice: { provider: 'bailian', voiceSource: 'preset', voiceId: 'Cherry', rate: 1.2, volume: 1, pitch: 0 } },
  })
  assert.equal(parsed.production.orientation, 'landscape')
  assert.equal(parsed.production.voice.voiceId, 'Cherry')
  assert.equal(parsed.production.voice.rate, 1.2)
  // Reusing the media normalizer means an invalid voice cannot be stored.
  assert.throws(() => parseScheduleRequest({
    name: '坏音色', days: [1], time: '09:00', depth: 'video',
    production: { voice: { provider: 'bailian', voiceSource: 'upload' } },
  }), /音色设置无效/u)
  assert.throws(() => parseScheduleRequest({ name: '坏方向', days: [1], time: '09:00', depth: 'topic', production: { orientation: 'square' } }), /portrait 或 landscape/u)
  // A preset voice is a Bailian system voice ID; another provider must reject
  // it rather than forward a foreign identifier as its own voice.
  assert.throws(() => parseScheduleRequest({
    name: '预置音色配错渠道', days: [1], time: '09:00', depth: 'video',
    production: { voice: { provider: 'lwb', voiceSource: 'preset', voiceId: 'longanhuan_v3.1' } },
  }), /预置音色仅适用于百炼渠道/u)
  assert.equal(parseScheduleRequest({
    name: '预置音色配百炼', days: [1], time: '09:00', depth: 'video',
    production: { voice: { provider: 'bailian', voiceSource: 'preset', voiceId: 'longanhuan_v3.1' } },
  }).production.voice.voiceId, 'longanhuan_v3.1')
})

test('parseScheduleRequest drops unknown AI daily platforms instead of storing them', () => {
  const parsed = parseScheduleRequest({ name: '平台', days: [1], time: '09:00', depth: 'topic', sources: { sourceIds: ['ai-daily-import'], platforms: ['抖音', '不存在'] } })
  assert.deepEqual(parsed.sources.platforms, ['抖音'])
})

test('topicInputOf and scriptInputOf replay the stored task verbatim and omit empties', () => {
  const schedule = parseScheduleRequest({
    name: 't', days: [1], time: '09:00', depth: 'packaging', angle: '避坑角度',
    accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    sources: { sourceIds: ['baidu', 'ai-daily-import'], platforms: ['抖音'], excludeSignalIds: ['11111111-1111-4111-8111-111111111111'] },
  })
  assert.deepEqual(topicInputOf(schedule), {
    angle: '避坑角度',
    accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    sourceIds: ['baidu', 'ai-daily-import'],
    platforms: ['抖音'],
    excludeSignalIds: ['11111111-1111-4111-8111-111111111111'],
  })
  const bare = parseScheduleRequest({ name: 't', days: [1], time: '09:00', depth: 'topic' })
  assert.deepEqual(topicInputOf(bare), {}, 'an open generation request stays empty')
  assert.deepEqual(scriptInputOf(schedule, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), {
    projectId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', mode: 'new', tier: 'medium', instructions: '避坑角度',
  })
})

test('reduceRunStatus reports completed, partial and failed from item outcomes', () => {
  assert.equal(reduceRunStatus([{ status: 'completed' }, { status: 'completed' }]), 'completed')
  assert.equal(reduceRunStatus([{ status: 'completed' }, { status: 'failed' }]), 'partial')
  assert.equal(reduceRunStatus([{ status: 'failed' }]), 'failed')
  assert.equal(reduceRunStatus([]), 'failed')
  assert.equal(reduceRunStatus([{ status: 'completed' }], true), 'cancelled')
})

test('scheduleFile rejects version 2 outright under the zero-compatibility rule', () => {
  const legacy = { schemaVersion: 2, schedules: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: '旧安排', enabled: true, time: '09:00', sourceIds: ['baidu'], createdAt: at('2026-09-01'), updatedAt: at('2026-09-01'), lastRunAt: null }], runs: [] }
  assert.throws(
    () => scheduleFile(legacy, { validSourceIds: new Set(['baidu']), validAccountIds: new Set() }),
    (error) => error instanceof SpokenVideoScheduleError && error.code === 'SPOKEN_VIDEO_SCHEDULE_FILE_UNSUPPORTED',
  )
  assert.equal(emptyScheduleFile().schemaVersion, SCHEDULE_SCHEMA)
})

test('scheduleFile drops a deleted source and disables the task with a reason instead of throwing', () => {
  const base = parseScheduleRequest({ name: '混合来源', days: [1], time: '09:00', depth: 'topic', sources: { sourceIds: ['baidu', 'gone'] } })
  const record = { ...base, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', disabledReason: null, createdAt: at('2026-09-01'), updatedAt: at('2026-09-01'), lastRunAt: null }
  const result = scheduleFile({ schemaVersion: SCHEDULE_SCHEMA, schedules: [record], runs: [] }, { validSourceIds: new Set(['baidu']), validAccountIds: new Set() })
  assert.equal(result.changed, true)
  assert.deepEqual(result.data.schedules[0].sources.sourceIds, ['baidu'])
  assert.equal(result.data.schedules[0].enabled, true, 'one source left still runs')

  const orphan = { ...record, sources: { ...base.sources, sourceIds: ['gone'] } }
  const disabled = scheduleFile({ schemaVersion: SCHEDULE_SCHEMA, schedules: [orphan], runs: [] }, { validSourceIds: new Set(['baidu']), validAccountIds: new Set() })
  assert.equal(disabled.data.schedules[0].enabled, false)
  assert.match(disabled.data.schedules[0].disabledReason, /已被删除/u)
})

test('scheduleFile disables a task whose account was hard deleted rather than failing to read', () => {
  const parsed = parseScheduleRequest({ name: '绑定账号', days: [1], time: '09:00', depth: 'topic', accountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', sources: { sourceIds: ['baidu'] } })
  const record = { ...parsed, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', disabledReason: null, createdAt: at('2026-09-01'), updatedAt: at('2026-09-01'), lastRunAt: null }
  const result = scheduleFile({ schemaVersion: SCHEDULE_SCHEMA, schedules: [record], runs: [] }, { validSourceIds: new Set(['baidu']), validAccountIds: new Set() })
  assert.equal(result.data.schedules[0].enabled, false)
  assert.match(result.data.schedules[0].disabledReason, /账号定位/u)
})

test('scheduleFile drops one corrupt run but keeps the rest of the file readable', () => {
  const parsed = parseScheduleRequest({ name: 't', days: [1], time: '09:00', depth: 'topic', sources: { sourceIds: ['baidu'] } })
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const good = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', scheduleId: id, status: 'completed', trigger: 'automatic', triggeredAt: at('2026-09-01'), completedAt: at('2026-09-01'), elapsedMs: 1000, sessionId: null, depth: 'topic', step: 'topic', message: '完成', error: null, refs: { topicGenerationId: null, scriptGenerationIds: [], mediaRunIds: [], publishTaskIds: [] }, items: [] }
  const result = scheduleFile({ schemaVersion: SCHEDULE_SCHEMA, schedules: [{ ...parsed, id, disabledReason: null, createdAt: at('2026-09-01'), updatedAt: at('2026-09-01'), lastRunAt: null }], runs: [good, { id: 'x', status: 'nonsense' }] }, { validSourceIds: new Set(['baidu']), validAccountIds: new Set() })
  assert.equal(result.changed, true)
  assert.equal(result.data.runs.length, 1)
  assert.equal(result.data.runs[0].id, good.id)
})

/* ------------------------------ host harness ------------------------------ */

/**
 * A scripted pipeline double. Each stage resolves after `advance` polls so the
 * orchestrator's sequencing, not the real media chain, is what gets asserted.
 */
function fakeHosts({ depth = 'packaging', perRunLimit = 1, failStep = null, neverDone = null, candidates = 2, voiceoverProvider = null } = {}) {
  const calls = []
  const record = (name, value) => { calls.push({ name, ...(value || {}) }); return value }
  const projectIdFor = (index) => `1111111${index}-1111-4111-8111-111111111111`.slice(0, 36)
  const generationId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  const projects = new Map()
  let pollCounts = new Map()

  const candidateList = Array.from({ length: candidates }, (_, index) => ({
    id: `ddddddd${index}-dddd-4ddd-8ddd-dddddddddddd`.slice(0, 36),
    title: `候选 ${index + 1}`,
    signalIds: ['e1', 'e2'],
    selection: { state: index === 0 ? 'selected' : 'available', projectId: index === 0 ? projectIdFor(0) : null },
  }))

  const bump = (key) => {
    const next = (pollCounts.get(key) || 0) + 1
    pollCounts.set(key, next)
    return next
  }
  const settle = (key, step) => failStep === step && bump(`${key}:fail`) >= 2 ? true : bump(key) >= 2

  const content = {
    async listAccounts() { return { defaultAccountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', accounts: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'AI明白局', status: 'active' }] } },
    async sources() { return [{ id: 'baidu', name: '百度热榜' }, { id: 'ai-daily-import', name: 'AI 内容日报' }] },
    async startTopicGeneration(currentAgent, input) { record('startTopicGeneration', { input }); return { id: generationId } },
    async topicGenerationStatus(currentAgent, { id }) {
      const done = neverDone === 'topic' ? false : settle(id, 'topic')
      // A failed generation must report a terminal non-completed status,
      // exactly as the real content store does.
      const failed = done && failStep === 'topic'
      return {
        id,
        status: done ? failed ? 'failed' : 'completed' : 'running',
        error: failed ? '选题生成失败：测试' : null,
        candidates: done && !failed ? candidateList : [],
      }
    },
    async setTopicCandidateSelection(currentAgent, { candidateId, selected }) {
      record('setTopicCandidateSelection', { candidateId, selected })
      const candidate = candidateList.find((item) => item.id === candidateId)
      const index = candidateList.indexOf(candidate)
      candidate.selection = { state: selected ? 'selected' : 'available', projectId: selected ? projectIdFor(index) : null }
      return {}
    },
    async startScriptGeneration(currentAgent, input) {
      record('startScriptGeneration', { input })
      // Unique per project, otherwise two items would share one poll counter.
      const id = `e${input.projectId}`.slice(0, 36)
      const project = projects.get(input.projectId) || { revision: 2, artifacts: { topic: {} } }
      project.artifacts.script = { revision: 3, data: { body: '这是自动生成的稿件正文。'.repeat(40) } }
      project.title = project.title || '自动选题标题'
      projects.set(input.projectId, project)
      return { id }
    },
    async scriptGenerationStatus(currentAgent, { id }) {
      const done = neverDone === 'script' ? false : settle(id, 'script')
      return { id, status: done ? 'completed' : 'running', error: done && failStep === 'script' ? '写稿失败：测试' : null }
    },
  }

  const store = {
    async get(currentAgent, { projectId }) {
      const project = projects.get(projectId) || { revision: 2, artifacts: { topic: {} } }
      projects.set(projectId, project)
      return { id: projectId, title: project.title || '自动选题标题', revision: project.revision, artifacts: project.artifacts }
    },
    async approveScript(currentAgent, { projectId, source }) {
      record('approveScript', { projectId, source })
      if (failStep === 'approve') throw new Error('确认稿件失败：测试')
      const project = projects.get(projectId)
      return { scriptApproval: { revision: project.artifacts.script.revision, source } }
    },
  }

  const mediaTask = (type, projectId, step) => {
    // Keyed on the full project id: a short prefix collides across items and
    // would make two projects share one poll counter.
    const id = `${type}:${projectId}`
    const done = neverDone === type ? false : settle(id, step)
    const failed = done && failStep === type
    return {
      id, type, status: failed ? 'failed' : done ? 'succeeded' : 'running',
      phase: done ? 'completed' : 'rendering', error: failed ? `${type} 失败：测试` : null,
      result: done && !failed ? (type === 'voiceover'
        ? { audio: { durationSeconds: 47.4 } }
        : type === 'video' ? { video: { durationSeconds: 47.4, width: 1080, height: 1920 } } : { subtitle: { cueCount: 12 } }) : null,
    }
  }

  const media = {
    async status() { return { ttsConfigured: true, connection: { provider: 'bailian', providers: { bailian: { configured: true, source: 'user', writable: true } } }, renderers: { remotion: true, 'local-ffmpeg': true }, providers: { legacy: { configured: false } } } },
    // Mirrors the real host: the unattended round reads the saved media
    // preference when the schedule does not pin a voice of its own.
    async preferredProvider() { return 'bailian' },
    async startVoiceover(currentAgent, request) {
      record('startVoiceover', { request })
      // The real host commits the provider that actually ran, which is what the
      // subtitle stage reads back. `voiceoverProvider` simulates a voiceover
      // that was re-recorded outside this schedule (e.g. by hand), so the
      // recorded provider differs from what the schedule would have picked.
      const project = projects.get(request.projectId)
      const recorded = voiceoverProvider || request.provider || 'lwb'
      if (project) project.artifacts.voiceover = { revision: 4, data: { mode: 'tts', provider: recorded, audio: { file: 'media/voiceovers/test.wav' } } }
      return { id: `voiceover:${request.projectId}` }
    },
    async startSubtitles(currentAgent, request) { record('startSubtitles', { request }); return { id: `subtitles:${request.projectId}` } },
    async startVideoRender(currentAgent, request) { record('startVideoRender', { request }); return { id: `video:${request.projectId}` } },
    async operations(currentAgent, { projectId }) {
      return [mediaTask('video', projectId, 'video'), mediaTask('subtitles', projectId, 'subtitles'), mediaTask('voiceover', projectId, 'voiceover')]
    },
  }

  const publish = {
    async status() { return { configured: true, enabled: true, provider: 'bailian' } },
    async startPackaging(currentAgent, request) { record('startPackaging', { request }); return { id: `packaging:${request.projectId}` } },
    async task(currentAgent, { taskId }) {
      const done = neverDone === 'packaging' ? false : settle(taskId, 'packaging')
      const failed = done && failStep === 'packaging'
      // The real host commits a packaging artifact (with frozen covers) on
      // success; #stagePackaging reads the covers back off the project.
      if (done && !failed) {
        const projectId = taskId.replace('packaging:', '')
        const project = projects.get(projectId) || { revision: 8, artifacts: {} }
        project.artifacts.packaging = { revision: 9, data: { covers: { landscape: { file: 'media/publish-covers/l.png' }, portrait: { file: 'media/publish-covers/p.jpg' } }, coverErrors: { landscape: null, portrait: null } } }
        projects.set(projectId, project)
      }
      return {
        id: taskId, status: done ? failed ? 'failed' : 'succeeded' : 'running', phase: done ? failed ? 'failed' : 'ready' : 'agent',
        error: failed ? '发布资料失败：测试' : null,
        imageProvider: { provider: 'bailian' }, coverErrors: {},
      }
    },
  }

  const disposed = []
  const created = []
  const adopted = []
  const agents = {
    async resume() { throw new Error('no persisted session') },
    async create(options) {
      created.push(options)
      return { agent: { id: options.sessionId, session: { header: { cwd: options.meta.cwd }, id: options.sessionId } }, async dispose() { disposed.push(options.sessionId) } }
    },
  }
  const adoptSession = async (agent) => { adopted.push(agent?.id ?? null) }
  const agentPresets = { async resolve(id) { return { id } }, async mount() {} }
  const agentDefaultModel = { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) }
  const renamed = []
  const sessionTitle = { rename(session, title) { renamed.push(title); return {} } }

  return {
    calls, projects, created, disposed, adopted, renamed, candidateList, projectIdFor,
    reset: () => { pollCounts = new Map() },
    hosts: { content, projects: store, media, publish, agents, agentPresets, agentDefaultModel, sessionTitle, adoptSession },
  }
}

async function setup(t, options = {}) {
  const { root, cwd } = await workspace(t)
  const fake = fakeHosts(options)
  const host = new SpokenVideoScheduleHost({
    ...fake.hosts,
    workspacePath: cwd,
    pollIntervalMs: 2,
    tickIntervalMs: 60_000,
    ...options.hostOptions,
  })
  // A round left in flight (the neverDone fixtures poll until their deadline)
  // would keep the event loop alive after the test ends, so always tear down
  // and wait for the detached rounds to settle.
  t.after(async () => {
    host.stopAll()
    for (let attempt = 0; attempt < 500 && host.active.size; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
  })
  return { root, cwd, host, fake, currentAgent: agent(cwd), file: join(cwd, 'data', 'schedules.json') }
}

async function createTask(host, currentAgent, overrides = {}) {
  return host.createSchedule(currentAgent, {
    name: '晚间自动出片', days: [1, 5], time: '21:00', depth: 'packaging',
    sources: { sourceIds: ['baidu', 'ai-daily-import'], platforms: ['抖音'] },
    ...overrides,
  })
}

/** Wait for one round to leave the running state. */
/**
 * Wait for one round to leave the running state AND release its execution
 * identity. `active` is only cleared after #execute's finally has disposed the
 * agent, so this is the point at which the round is fully torn down.
 */
async function settleRun(host, currentAgent, runId, limit = 2000) {
  for (let attempt = 0; attempt < limit; attempt += 1) {
    const { run, active } = await host.scheduleRun(currentAgent, { runId })
    if (run.status !== 'running' && !active) return run
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  throw new Error('round did not settle in time')
}

/* -------------------------------- host layer ------------------------------ */

test('createSchedule validates the account and the channels against live data', async (t) => {
  const { host, currentAgent } = await setup(t)
  const created = await createTask(host, currentAgent)
  assert.equal(created.name, '晚间自动出片')
  assert.equal(created.daysLabel, '周一、周五')
  assert.equal(created.depthLabel, '发布资料')
  assert.equal(created.approvesScript, true)
  assert.equal(created.nextRunAt && new Date(created.nextRunAt) instanceof Date, true)
  assert.equal(created.latestRun, null)

  await assert.rejects(createTask(host, currentAgent, { accountId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }), /不存在或已归档/u)
  await assert.rejects(createTask(host, currentAgent, { sources: { sourceIds: ['nope'] } }), /不存在的信号来源/u)
  await assert.rejects(createTask(host, currentAgent, { sources: { sourceIds: [] } }), /至少选择一个参与渠道/u)
  await assert.rejects(createTask(host, currentAgent, { days: [] }), /1-7 天/u)
})

test('updateSchedule edits in place and deleteSchedule takes the history with it', async (t) => {
  const { host, currentAgent, file } = await setup(t)
  const created = await createTask(host, currentAgent)
  const updated = await host.updateSchedule(currentAgent, { scheduleId: created.id, name: '改名', days: [6], time: '08:00', depth: 'script', sources: { sourceIds: ['baidu'] } })
  assert.equal(updated.name, '改名')
  assert.equal(updated.daysLabel, '周六')
  assert.equal(updated.approvesScript, false)
  assert.equal(updated.id, created.id)
  assert.equal((await host.listSchedules(currentAgent)).schedules.length, 1)

  await assert.rejects(host.updateSchedule(currentAgent, { scheduleId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', name: 'x', days: [1], time: '09:00', depth: 'topic', sources: { sourceIds: ['baidu'] } }), /不存在/u)
  assert.equal((await host.deleteSchedule(currentAgent, { scheduleId: created.id })).deleted, created.id)
  const after = await host.listSchedules(currentAgent)
  assert.equal(after.schedules.length, 0)
  assert.equal(after.runs.length, 0)
  assert.equal(JSON.parse(await readFile(file, 'utf8')).schedules.length, 0)
})

test('setScheduleEnabled refuses to re-enable a task disabled by a missing reference', async (t) => {
  const { host, currentAgent, file } = await setup(t)
  const created = await createTask(host, currentAgent, { sources: { sourceIds: ['baidu'] } })
  assert.equal((await host.setScheduleEnabled(currentAgent, { scheduleId: created.id, enabled: false })).enabled, false)
  assert.equal((await host.setScheduleEnabled(currentAgent, { scheduleId: created.id, enabled: true })).enabled, true)

  // Removing the source underneath the task self-heals into a disabled state.
  const data = JSON.parse(await readFile(file, 'utf8'))
  data.schedules[0].sources.sourceIds = ['gone']
  await writeFile(file, JSON.stringify(data))
  const listed = await host.listSchedules(currentAgent)
  assert.equal(listed.schedules[0].enabled, false)
  assert.match(listed.schedules[0].disabledReason, /已被删除/u)
  await assert.rejects(host.setScheduleEnabled(currentAgent, { scheduleId: created.id, enabled: true }), /已被删除/u)
  await assert.rejects(host.runSchedule(currentAgent, { scheduleId: created.id }), /已被删除/u)
})

test('a round stamps lastRunAt and writes the running record before any stage starts', async (t) => {
  const { host, currentAgent, fake, file } = await setup(t, { neverDone: 'topic' })
  const created = await createTask(host, currentAgent)
  const before = JSON.parse(await readFile(file, 'utf8')).schedules[0].lastRunAt
  assert.equal(before, null)
  const { runId } = await host.runSchedule(currentAgent, { scheduleId: created.id })

  // While the round is still in flight the stamp and record must already exist,
  // otherwise the next thirty second tick would start the same slot again.
  const inflight = await host.scheduleRun(currentAgent, { runId })
  assert.equal(inflight.run.status, 'running')
  assert.equal(inflight.active, true)
  const stamped = JSON.parse(await readFile(file, 'utf8')).schedules[0].lastRunAt
  assert.ok(stamped && stamped !== before, 'lastRunAt is stamped before the pipeline runs')
  assert.equal(scheduleDue(JSON.parse(await readFile(file, 'utf8')).schedules[0], new Date(stamped)), false)

  await host.cancelScheduleRun(currentAgent, { runId })
  const settled = await settleRun(host, currentAgent, runId)
  assert.equal(settled.status, 'cancelled')
  assert.equal(settled.error, null)
  assert.equal(fake.disposed.length, 1, 'the execution identity is always released')
  await assert.rejects(host.cancelScheduleRun(currentAgent, { runId }), /不在运行中/u)
})

test('depth packaging runs the whole chain and records a full lifeline', async (t) => {
  const { host, currentAgent, fake } = await setup(t, { depth: 'packaging' })
  const created = await createTask(host, currentAgent, { sources: { sourceIds: ['baidu', 'ai-daily-import'], platforms: ['抖音'] } })
  const { runId } = await host.runSchedule(currentAgent, { scheduleId: created.id })
  const run = await settleRun(host, currentAgent, runId)

  assert.equal(run.status, 'completed')
  assert.equal(run.depth, 'packaging')
  assert.equal(run.items.length, 1)
  const item = run.items[0]
  assert.equal(item.status, 'completed')
  assert.equal(item.qcPassed, true)
  assert.equal(item.coverState, 'both')
  assert.ok(item.scriptChars > 0)
  assert.equal(item.durationSeconds, 47.4)
  assert.deepEqual(item.stages.map((stage) => stage.step), ['topic', 'script', 'approve', 'voiceover', 'subtitles', 'video', 'packaging'])
  assert.deepEqual(item.stages.map((stage) => stage.status), Array(7).fill('done'))
  assert.ok(item.stages.every((stage) => stage.startedAt && stage.completedAt))
  assert.match(item.stages[0].message, /依据 2 条信号/u)
  assert.match(item.stages[6].message, /横竖封面已生成/u)
  assert.ok(run.elapsedMs >= 0)

  // Every stage delegated to the host that already owns it, in order.
  assert.deepEqual(fake.calls.map((call) => call.name), [
    'startTopicGeneration', 'startScriptGeneration', 'approveScript',
    'startVoiceover', 'startSubtitles', 'startVideoRender', 'startPackaging',
  ])
  assert.deepEqual(fake.calls[0].input, { sourceIds: ['baidu', 'ai-daily-import'], platforms: ['抖音'] })
  assert.equal(fake.calls[2].source, 'automation', 'the gate crossing is recorded as automation')
  assert.equal(fake.calls[5].request.orientation, 'landscape')
  assert.equal(fake.calls[5].request.subtitleEnabled, true)
  assert.ok(run.refs.topicGenerationId)
  assert.equal(run.refs.scriptGenerationIds.length, 1)
  assert.equal(run.refs.publishTaskIds.length, 1)
  assert.ok(run.sessionId.startsWith('sv-auto-'), 'the run names its execution identity session')
  assert.equal(fake.renamed[0], '自动化 · 晚间自动出片')
  assert.equal(fake.created.length, 1)
  assert.equal(fake.created[0].meta.agentPreset, 'standard')
  assert.equal(fake.created[0].meta.cwd, currentAgent.session.header.cwd, 'the identity gets the task workspace, not process.cwd()')
  assert.deepEqual(fake.created[0].agentOptions, { provider: 'deepseek', model: 'deepseek-chat' })
})

test('scheduled roots use the independent scene model including reasoning selection', async t => {
  const selection = { provider: 'lwb', model: 'deepseek-v4.1-flash', reasoningEffort: 'low' }
  const { host, currentAgent, fake } = await setup(t, { hostOptions: { modelSelection: () => selection } })
  const created = await createTask(host, currentAgent, { depth: 'script' })
  const { runId } = await host.runSchedule(currentAgent, { scheduleId: created.id })
  await settleRun(host, currentAgent, runId)
  assert.deepEqual(fake.created[0].agentOptions, selection)
})

test('depth script stops at the saved draft and never confirms it', async (t) => {
  const { host, currentAgent, fake } = await setup(t, { depth: 'script' })
  const created = await createTask(host, currentAgent, { depth: 'script' })
  const { runId } = await host.runSchedule(currentAgent, { scheduleId: created.id })
  const run = await settleRun(host, currentAgent, runId)

  assert.equal(run.status, 'completed')
  assert.deepEqual(run.items[0].stages.map((stage) => stage.step), ['topic', 'script'])
  assert.equal(run.items[0].qcPassed, false)
  assert.deepEqual(fake.calls.map((call) => call.name), ['startTopicGeneration', 'startScriptGeneration'])
  assert.equal(fake.calls.some((call) => call.name === 'approveScript'), false, 'a human still owns the gate at this depth')
})

test('depth topic stops after the candidates are queued for writing', async (t) => {
  const { host, currentAgent, fake } = await setup(t, { depth: 'topic' })
  const created = await createTask(host, currentAgent, { depth: 'topic' })
  const { runId } = await host.runSchedule(currentAgent, { scheduleId: created.id })
  const run = await settleRun(host, currentAgent, runId)

  assert.equal(run.status, 'completed')
  assert.deepEqual(fake.calls.map((call) => call.name), ['startTopicGeneration'])
  assert.equal(run.items[0].status, 'completed')
  assert.deepEqual(run.items[0].stages.map((stage) => stage.step), ['topic'])
  assert.match(run.message, /待写稿选题/u)
})

test('an unattended round honours the saved media preference and subtitles follow the voiceover', async (t) => {
  // The saved preference is 'bailian', the schedule pins 'lwb', and the
  // committed voiceover was produced by 'bailian'. Three different sources, so
  // the assertion can tell which one the subtitle stage actually read.
  const { host, currentAgent, fake } = await setup(t, { voiceoverProvider: 'bailian' })
  const created = await createTask(host, currentAgent, { production: { orientation: 'landscape', voice: { provider: 'lwb', voiceSource: 'system', rate: 1, volume: 1, pitch: 0 } } })
  const { runId } = await host.runSchedule(currentAgent, { scheduleId: created.id })
  const run = await settleRun(host, currentAgent, runId)

  assert.equal(run.status, 'completed')
  // A pinned voice wins over the saved preference.
  assert.equal(fake.calls.find((call) => call.name === 'startVoiceover').request.provider, 'lwb')
  // Subtitles read the provider recorded on the voiceover artifact
  // ('bailian'), not the schedule's pinned 'lwb'.
  assert.equal(fake.calls.find((call) => call.name === 'startSubtitles').request.provider, 'bailian')
})

test('an unattended round falls back to the saved media preference when no voice is pinned', async (t) => {
  const { host, currentAgent, fake } = await setup(t)
  const created = await createTask(host, currentAgent)
  const { runId } = await host.runSchedule(currentAgent, { scheduleId: created.id })
  const run = await settleRun(host, currentAgent, runId)

  assert.equal(run.status, 'completed')
  // The schedule pins no voice, so the round must fall back to the saved media
  // preference ('bailian') instead of the normalizer's hard default ('lwb').
  assert.equal(fake.calls.find((call) => call.name === 'startVoiceover').request.provider, 'bailian')
  assert.equal(fake.calls.find((call) => call.name === 'startVoiceover').request.voiceSource, 'system')
})

test('subtitles off drops the subtitle stage from the run', async (t) => {
  const { host, currentAgent, fake } = await setup(t)
  const created = await createTask(host, currentAgent, { production: { orientation: 'landscape', subtitleEnabled: false } })
  const { runId } = await host.runSchedule(currentAgent, { scheduleId: created.id })
  const run = await settleRun(host, currentAgent, runId)

  assert.equal(run.status, 'completed')
  assert.deepEqual(run.items[0].stages.map((stage) => stage.step), ['topic', 'script', 'approve', 'voiceover', 'video', 'packaging'])
  assert.equal(fake.calls.some((call) => call.name === 'startSubtitles'), false)
  assert.equal(fake.calls.find((call) => call.name === 'startVideoRender').request.orientation, 'landscape')
  assert.equal(fake.calls.find((call) => call.name === 'startVideoRender').request.subtitleEnabled, false)
})

test('perRunLimit carries more than the recommended candidate in recommendation order', async (t) => {
  const { host, currentAgent, fake } = await setup(t, { candidates: 3 })
  const created = await createTask(host, currentAgent, { depth: 'script', perRunLimit: 2 })
  const { runId } = await host.runSchedule(currentAgent, { scheduleId: created.id })
  const run = await settleRun(host, currentAgent, runId)

  assert.equal(run.items.length, 2)
  assert.equal(run.status, 'completed')
  const picked = fake.calls.filter((call) => call.name === 'setTopicCandidateSelection')
  assert.equal(picked.length, 1, 'the recommended one is already selected by the content store')
  assert.equal(picked[0].candidateId, fake.candidateList[1].id, 'takes the next candidate, not an arbitrary one')
  assert.deepEqual(fake.calls.filter((call) => call.name === 'startScriptGeneration').map((call) => call.input.projectId), [fake.projectIdFor(0), fake.projectIdFor(1)])
})

test('one failing item does not abort the round: the rest continue and it reports partial', async (t) => {
  const { host, currentAgent, fake } = await setup(t, { candidates: 2, failStep: 'voiceover' })
  const created = await createTask(host, currentAgent, { perRunLimit: 2 })
  const { runId } = await host.runSchedule(currentAgent, { scheduleId: created.id })
  const run = await settleRun(host, currentAgent, runId)

  assert.equal(run.status, 'failed', 'every item hit the same stage failure')
  assert.equal(run.items.length, 2)
  assert.equal(run.items[0].status, 'failed')
  assert.match(run.items[0].error, /voiceover 失败/u)
  const voiceStage = run.items[0].stages.find((stage) => stage.step === 'voiceover')
  assert.equal(voiceStage.status, 'failed')
  assert.equal(voiceStage.refId, `voiceover:${run.items[0].projectId}`, 'failed stages retain the task association for execution inspection')
  assert.equal(run.items[0].stages.find((stage) => stage.step === 'video').status, 'skipped', 'later stages are marked skipped, not left pending')
  assert.equal(run.items[0].stages.find((stage) => stage.step === 'script').status, 'done', 'earlier work is preserved')
  assert.equal(fake.calls.filter((call) => call.name === 'startVideoRender').length, 0)
  assert.equal(fake.disposed.length, 1)
})

test('a failing topic stage fails the whole round without producing items', async (t) => {
  const { host, currentAgent } = await setup(t, { failStep: 'topic' })
  const created = await createTask(host, currentAgent)
  const { runId } = await host.runSchedule(currentAgent, { scheduleId: created.id })
  const run = await settleRun(host, currentAgent, runId)

  assert.equal(run.status, 'failed')
  assert.equal(run.step, 'topic')
  assert.equal(run.items.length, 0)
  assert.match(run.error, /选题生成失败/u)
})

test('a round with no candidates fails with an actionable message', async (t) => {
  const { host, currentAgent } = await setup(t, { candidates: 0 })
  const created = await createTask(host, currentAgent)
  const { runId } = await host.runSchedule(currentAgent, { scheduleId: created.id })
  const run = await settleRun(host, currentAgent, runId)
  assert.equal(run.status, 'failed')
  assert.match(run.error, /没有返回可用候选/u)
  assert.match(run.message, /没有可用的选题候选/u)
})

test('a packaging round without configured image generation reports covers as unavailable, not failed', async (t) => {
  const { host, currentAgent } = await setup(t)
  host.publish.status = async () => ({ configured: false, enabled: false })
  host.publish.task = async (currentAgent2, { taskId }) => ({ id: taskId, status: 'succeeded', phase: 'ready', imageProvider: null, coverErrors: {}, error: null })
  const created = await createTask(host, currentAgent)
  // No packaging artifact committed by the double, so covers read as absent.
  const { runId } = await host.runSchedule(currentAgent, { scheduleId: created.id })
  const run = await settleRun(host, currentAgent, runId)
  assert.equal(run.status, 'completed')
  assert.equal(run.items[0].coverState, 'disabled')
  assert.match(run.items[0].stages[6].message, /未配置生图服务/u)
})

test('automation without the DSH agent services fails loudly instead of half-running', async (t) => {
  const { host, currentAgent, fake } = await setup(t, { hostOptions: { agents: null, agentPresets: null, agentDefaultModel: null, ctx: null } })
  const created = await createTask(host, currentAgent)
  const { runId } = await host.runSchedule(currentAgent, { scheduleId: created.id })
  const run = await settleRun(host, currentAgent, runId)

  assert.equal(run.status, 'failed')
  assert.match(run.error, /不提供 Agent 服务/u)
  assert.equal(fake.calls.length, 0, 'no stage ran')
  const status = await host.runtimeStatus()
  assert.equal(status.automationAvailable, false)
  assert.ok(status.blockers.some((item) => item.depth === 'topic'))
})

test('owned schedules use host DSH readiness without acquiring an ordinary conversation', async (t) => {
  const { host, cwd } = await setup(t)
  host.context = { workspacePath: cwd }
  host.ctx = { get() { throw new Error('ordinary service must not be read') } }
  host.overrides = {}
  host.executionStatus = async () => ({ configured: false })
  const missing = await host.runtimeStatus()
  assert.equal(missing.automationAvailable, false)
  assert.match(missing.blockers[0].message, /DSH 尚未选择默认模型/)
  host.executionStatus = async () => ({ configured: true })
  assert.equal((await host.runtimeStatus()).automationAvailable, true)
  const { runId } = await host.runSchedule(host.context, { scheduleId: (await createTask(host, host.context)).id })
  assert.equal((await settleRun(host, host.context, runId)).status, 'completed')
})

test('runtimeStatus warns when the scene model route has no credential before the round can fail', async (t) => {
  const { host, cwd } = await setup(t)
  host.context = { workspacePath: cwd }
  host.executionStatus = async () => ({ configured: true })
  host.modelRoute = async () => ({
    provider: 'deepseek-official', model: 'deepseek-flash', state: 'missing-credential', ref: 'DEEPSEEK_API_KEY',
    reason: '未配置 API Key（DEEPSEEK_API_KEY），请先在“设置 → 模型”中完成该模型服务的配置。',
  })
  const status = await host.runtimeStatus()
  assert.equal(status.automationAvailable, true, 'the selection exists, so automation itself is available')
  assert.equal(status.model.state, 'missing-credential')
  const blocker = status.blockers.find((item) => item.depth === 'topic')
  assert.match(blocker.message, /deepseek-official/u)
  assert.match(blocker.message, /DEEPSEEK_API_KEY/u)
})

test('an unprovable or account-authenticated scene model route never blocks a round', async (t) => {
  const { host, cwd } = await setup(t)
  host.context = { workspacePath: cwd }
  host.executionStatus = async () => ({ configured: true })
  for (const state of ['ready', 'not-applicable', 'unverifiable']) {
    host.modelRoute = async () => ({ provider: 'deepseek-account', model: 'deepseek-v4-pro', state, ref: null, reason: null })
    const status = await host.runtimeStatus()
    assert.equal(status.blockers.some((item) => item.message.includes('场景任务模型')), false, `${state} must not block`)
  }
  // A probe that cannot answer is not evidence of a missing credential.
  host.modelRoute = async () => { throw new Error('probe exploded') }
  const status = await host.runtimeStatus()
  assert.equal(status.model, null)
  assert.equal(status.blockers.some((item) => item.message.includes('场景任务模型')), false)
})

test('a round whose scene model route lacks a credential fails up front without running a stage', async (t) => {
  const { host, cwd, currentAgent, fake } = await setup(t)
  host.context = { workspacePath: cwd }
  host.modelRoute = async () => ({
    provider: 'deepseek-official', model: 'deepseek-flash', state: 'missing-credential', ref: 'DEEPSEEK_API_KEY',
    reason: '未配置 API Key（DEEPSEEK_API_KEY），请先在“设置 → 模型”中完成该模型服务的配置。',
  })
  const created = await createTask(host, currentAgent)
  const { runId } = await host.runSchedule(currentAgent, { scheduleId: created.id })
  const run = await settleRun(host, currentAgent, runId)

  assert.equal(run.status, 'failed')
  assert.equal(run.step, 'topic')
  assert.equal(run.items.length, 0)
  assert.match(run.error, /缺少凭据/u, 'the reason names the route rather than only the failing stage')
  assert.match(run.error, /deepseek-official/u)
  assert.equal(fake.calls.some((call) => call.name === 'startTopicGeneration'), false, 'the topic child never starts')
})

test('a round continues when the scene model route cannot be proven unusable', async (t) => {
  const { host, cwd, currentAgent } = await setup(t)
  host.context = { workspacePath: cwd }
  host.modelRoute = async () => ({ provider: 'deepseek-account', model: 'deepseek-v4-pro', state: 'not-applicable', ref: null, reason: null })
  const created = await createTask(host, currentAgent)
  const { runId } = await host.runSchedule(currentAgent, { scheduleId: created.id })
  assert.equal((await settleRun(host, currentAgent, runId)).status, 'completed')
})

test('runtimeStatus warns about a missing TTS credential or renderer before the round can fail', async (t) => {
  const { host } = await setup(t)
  const ready = await host.runtimeStatus()
  assert.equal(ready.automationAvailable, true)
  assert.equal(ready.remotion, true)
  assert.equal(ready.tts.credential, true)
  assert.equal(ready.coverImage, true)
  assert.deepEqual(ready.blockers, [])

  host.media.status = async () => ({ ttsConfigured: true, connection: { provider: 'bailian', providers: { bailian: { configured: false, source: null, writable: true } } }, renderers: { remotion: false }, providers: { legacy: { configured: false } } })
  const degraded = await host.runtimeStatus()
  assert.equal(degraded.remotion, false)
  assert.equal(degraded.tts.credential, false)
  const messages = degraded.blockers.map((item) => item.message).join(' ')
  assert.match(messages, /TTS 凭据/u)
  assert.match(messages, /Remotion 不可用/u)
  assert.ok(degraded.blockers.every((item) => item.depth === 'video'), 'a topic-only task is unaffected')

  // Regression guard: `status().providers[p]` nests the credential one level
  // deeper than `status().connection.providers[p]`, which IS the credential
  // status. The two views must never be conflated — pin the read path by making
  // them disagree and asserting the host follows `connection.providers[p]`.
  host.media.status = async () => ({
    ttsConfigured: true,
    connection: { provider: 'bailian', providers: { bailian: { configured: true, source: 'user', writable: true } } },
    renderers: { remotion: true, 'local-ffmpeg': true },
    providers: { bailian: { configured: true, credential: { configured: false } }, legacy: { configured: false } },
  })
  const split = await host.runtimeStatus()
  assert.equal(split.tts.credential, true, 'reads connection.providers[p].configured, not the nested providers[p].credential')
  assert.deepEqual(split.blockers, [])
})

test('the scheduler starts due rounds detached and refuses a second one in the same workspace', async (t) => {
  const { host, currentAgent, fake, file } = await setup(t, { neverDone: 'topic' })
  const created = await createTask(host, currentAgent)
  // The task runs Mon+Fri 21:00; freeze the clock on a Friday at that minute.
  host.now = () => new Date('2026-09-11T21:00:05').toISOString()
  const started = Date.now()
  await host.tick()
  // A detached round must not block the tick: this is the defect the old
  // inline await had, where one long pipeline froze every workspace.
  assert.ok(Date.now() - started < 1000, 'tick returned while the round is still running')
  const data = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(data.runs.length, 1)
  assert.equal(data.runs[0].status, 'running')
  assert.equal(data.runs[0].trigger, 'automatic')

  // The detached round reaches the first stage on its own schedule; wait for it
  // (bounded) so the in-flight guard below is exercised against a live round.
  for (let attempt = 0; attempt < 500 && !fake.calls.some((call) => call.name === 'startTopicGeneration'); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  assert.equal(fake.calls.filter((call) => call.name === 'startTopicGeneration').length, 1, 'the detached round started the pipeline')

  // A second tick in the same slot must not start another round.
  host.now = () => new Date('2026-09-11T21:00:35').toISOString()
  await host.tick()
  assert.equal(JSON.parse(await readFile(file, 'utf8')).runs.length, 1, 'in-flight guard plus the stamp prevent a duplicate')
  assert.equal(fake.calls.filter((call) => call.name === 'startTopicGeneration').length, 1)

  const running = (await host.listSchedules(currentAgent)).runs[0]
  await host.cancelScheduleRun(currentAgent, { runId: running.id })
  await settleRun(host, currentAgent, running.id)
  assert.equal(host.active.size, 0)
})

test('tick skips a task that is not due on the current weekday', async (t) => {
  const { host, file, currentAgent } = await setup(t, { neverDone: 'topic' })
  await createTask(host, currentAgent, { days: [3], time: '21:00' })
  host.now = () => new Date('2026-09-11T21:00:05').toISOString() // a Friday
  await host.tick()
  const data = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(data.runs.length, 0)
  assert.equal(data.schedules[0].lastRunAt, null)
})

test('a slot missed while the host was down is logged once and never backfilled', async (t) => {
  const { host, currentAgent, fake, file } = await setup(t, { neverDone: 'topic' })
  const created = await createTask(host, currentAgent, { days: [5], time: '21:00' })
  host.now = () => new Date('2026-09-11T23:30:00').toISOString()
  await host.tick()
  await host.tick()
  await host.tick()

  const data = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(data.runs.length, 1, 'checked once per process start, not once per tick')
  assert.equal(data.runs[0].status, 'missed')
  assert.equal(data.runs[0].scheduleId, created.id)
  assert.match(data.runs[0].message, /不会自动补跑/u)
  assert.equal(fake.calls.length, 0, 'nothing was produced')
  assert.equal(data.schedules[0].lastRunAt, null)

  const listed = await host.listSchedules(currentAgent)
  assert.equal(listed.runs[0].status, 'missed')
  assert.equal(listed.schedules[0].latestRun.status, 'missed')
})

test('restart marks an interrupted round failed instead of leaving it running forever', async (t) => {
  const { cwd, fake } = await setup(t)
  const file = join(cwd, 'data', 'schedules.json')
  const scheduleId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const runId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  await writeFile(file, JSON.stringify({
    schemaVersion: SCHEDULE_SCHEMA,
    schedules: [{ ...parseScheduleRequest({ name: '中断任务', days: [5], time: '21:00', depth: 'video', sources: { sourceIds: ['baidu'] } }), id: scheduleId, disabledReason: null, createdAt: at('2026-09-01'), updatedAt: at('2026-09-01'), lastRunAt: at('2026-09-11T21:00:00') }],
    runs: [{
      id: runId, scheduleId, status: 'running', trigger: 'automatic', triggeredAt: at('2026-09-11T21:00:00'),
      completedAt: null, elapsedMs: null, sessionId: 'sv-auto-x', depth: 'video', step: 'video', message: '执行中', error: null,
      refs: { topicGenerationId: null, scriptGenerationIds: [], mediaRunIds: [], publishTaskIds: [] },
      items: [{ projectId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', title: 'x', status: 'running', reachedStep: 'script', signalCount: 2, scriptChars: 900, scriptRevision: 3, durationSeconds: null, orientation: 'portrait', qcPassed: false, coverState: null, error: null, stages: [{ step: 'topic', status: 'done', startedAt: at('2026-09-11T21:00:00'), completedAt: at('2026-09-11T21:01:00'), refId: null, message: 'ok' }, { step: 'video', status: 'running', startedAt: at('2026-09-11T21:05:00'), completedAt: null, refId: null, message: 'rendering' }, { step: 'packaging', status: 'pending', startedAt: null, completedAt: null, refId: null, message: null }] }],
    }],
  }))

  const host = new SpokenVideoScheduleHost({ ...fake.hosts, workspacePath: cwd, pollIntervalMs: 2 })
  await host.recoverInterrupted()
  const data = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(data.runs[0].status, 'failed')
  assert.match(data.runs[0].error, /重启/u)
  assert.ok(data.runs[0].completedAt)
  assert.ok(data.runs[0].elapsedMs > 24 * 3600_000, 'long host outages remain valid audit durations')
  assert.equal(data.runs[0].items[0].status, 'failed')
  assert.equal(data.runs[0].items[0].stages[0].status, 'done', 'completed stage work is preserved')
  assert.equal(data.runs[0].items[0].stages[1].status, 'failed')
  assert.equal(data.runs[0].items[0].stages[2].status, 'failed')

  // Idempotent: a second pass changes nothing.
  await host.recoverInterrupted()
  assert.equal(JSON.parse(await readFile(file, 'utf8')).runs[0].status, 'failed')
})

test('deleteSchedule refuses while a round is in flight', async (t) => {
  const { host, currentAgent } = await setup(t, { neverDone: 'topic' })
  const created = await createTask(host, currentAgent)
  const { runId } = await host.runSchedule(currentAgent, { scheduleId: created.id })
  await assert.rejects(host.deleteSchedule(currentAgent, { scheduleId: created.id }), /正在执行/u)
  await host.cancelScheduleRun(currentAgent, { runId })
  await settleRun(host, currentAgent, runId)
  assert.equal((await host.deleteSchedule(currentAgent, { scheduleId: created.id })).deleted, created.id)
})

test('a revision conflict from concurrent manual editing fails the item instead of overwriting', async (t) => {
  const { host, currentAgent, fake } = await setup(t)
  fake.hosts.media.startVoiceover = async () => { throw Object.assign(new Error('Error [SPOKEN_VIDEO_REVISION_CONFLICT] 项目已被其他操作更新，请刷新后重试。'), { code: 'SPOKEN_VIDEO_REVISION_CONFLICT' }) }
  const created = await createTask(host, currentAgent)
  const { runId } = await host.runSchedule(currentAgent, { scheduleId: created.id })
  const run = await settleRun(host, currentAgent, runId)

  assert.equal(run.status, 'failed')
  assert.match(run.items[0].error, /REVISION_CONFLICT/u)
  assert.equal(run.items[0].stages.find((stage) => stage.step === 'script').status, 'done')
  assert.equal(fake.disposed.length, 1)
})

test('the execution identity is created with the standard preset, adopted, and always disposed', async (t) => {
  const { host, currentAgent, fake } = await setup(t, { depth: 'topic' })
  const created = await createTask(host, currentAgent, { depth: 'topic' })
  const { runId } = await host.runSchedule(currentAgent, { scheduleId: created.id })
  await settleRun(host, currentAgent, runId)

  assert.equal(fake.created.length, 1)
  assert.equal(fake.created[0].sessionId, `sv-auto-${created.id}`)
  assert.equal(typeof fake.created[0].setup, 'function')
  await fake.created[0].setup({})
  assert.deepEqual(fake.adopted, [fake.created[0].sessionId], 'the pack states ownership of its identity')
  assert.equal(fake.disposed[0], fake.created[0].sessionId)
})

test('a resumed automation identity is adopted again before any round work', async (t) => {
  const { host, cwd, currentAgent, fake } = await setup(t, { depth: 'topic' })
  const created = await createTask(host, currentAgent, { depth: 'topic' })
  // The identity outlives the round, so a later round resumes it and must state
  // its ownership again (a reset or a re-registration can drop the index).
  fake.hosts.agents.resume = async (options) => ({
    agent: { id: options.resumeSessionId, session: { header: { cwd }, id: options.resumeSessionId } },
    async dispose() { fake.disposed.push(options.resumeSessionId) },
  })
  const { runId } = await host.runSchedule(currentAgent, { scheduleId: created.id })
  await settleRun(host, currentAgent, runId)

  assert.equal(fake.created.length, 0, 'the resumed identity is reused, not recreated')
  assert.deepEqual(fake.adopted, [`sv-auto-${created.id}`])
})

test('automation without session adoption fails loudly instead of leaving an unowned identity', async (t) => {
  const { host, currentAgent, fake } = await setup(t, { hostOptions: { adoptSession: null } })
  const created = await createTask(host, currentAgent)
  const { runId } = await host.runSchedule(currentAgent, { scheduleId: created.id })
  const run = await settleRun(host, currentAgent, runId)

  assert.equal(run.status, 'failed')
  assert.match(run.error, /不提供能力包会话归属服务/u)
  assert.equal(fake.created.length, 0, 'no identity was published without ownership')
  assert.equal(fake.calls.length, 0, 'no stage ran')
  const status = await host.runtimeStatus()
  assert.equal(status.automationAvailable, false)
  assert.ok(status.blockers.some((item) => item.depth === 'topic'))
})

test('run history retains more than 100 rounds and filters before paging lightweight results', async (t) => {
  const { host, currentAgent, file } = await setup(t)
  const first = await createTask(host, currentAgent)
  const other = await createTask(host, currentAgent, { name: '另一个账号', accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })
  const { runId } = await host.runSchedule(currentAgent, { scheduleId: first.id })
  const template = await settleRun(host, currentAgent, runId)
  const raw = JSON.parse(await readFile(file, 'utf8'))
  raw.runs = Array.from({ length: 125 }, (_,index) => ({ ...template,
    id: `${index.toString(16).padStart(8, '0')}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`,
    scheduleId: index % 2 ? other.id : first.id,
    triggeredAt: new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
    status: index % 3 === 0 ? 'failed' : 'completed', trigger: index % 4 === 0 ? 'manual' : 'automatic',
    message: `历史轮次 ${index}`,
  }))
  await writeFile(file, JSON.stringify(raw))
  const all = await host.listScheduleRuns(currentAgent)
  assert.equal(all.total, 125)
  assert.equal(all.items.length, 8)
  assert.equal(all.items[0].id, raw.runs[124].id)
  assert.equal(Object.hasOwn(all.items[0], 'refs'), false)
  assert.equal(Object.hasOwn(all.items[0].items[0], 'stages'), false)
  const secondPage = await host.listScheduleRuns(currentAgent, { offset: 8, limit: 8 })
  assert.equal(secondPage.items[0].id, raw.runs[116].id)
  const oldest = await host.listScheduleRuns(currentAgent, { offset: 120, limit: 8 })
  assert.equal(oldest.items.length, 5)
  assert.equal(oldest.items.at(-1).id, raw.runs[0].id)
  assert.equal((await host.scheduleRun(currentAgent, { runId: raw.runs[0].id })).run.items[0].stages.length, template.items[0].stages.length)
  const filtered = await host.listScheduleRuns(currentAgent, { scheduleId: first.id, status: 'failed', trigger: 'manual', limit: 3 })
  const expected = raw.runs.filter(r => r.scheduleId === first.id && r.status === 'failed' && r.trigger === 'manual').reverse()
  assert.equal(filtered.total, expected.length)
  assert.deepEqual(filtered.items.map(r => r.id), expected.slice(0, 3).map(r => r.id))
  assert.equal((await host.listScheduleRuns(currentAgent, { general: true })).total, 63)
  assert.equal((await host.listScheduleRuns(currentAgent, { accountId: other.accountId })).total, 62)
  assert.equal((await host.listScheduleRuns(currentAgent, { query: '历史轮次 124' })).total, 1)
  assert.equal((await host.listScheduleRuns(currentAgent, { query: '不存在的内容' })).total, 0)
  await host.setScheduleEnabled(currentAgent, { scheduleId: first.id, enabled: false })
  assert.equal(JSON.parse(await readFile(file, 'utf8')).runs.length, 125, 'later writes preserve every retained round')
  await assert.rejects(host.listScheduleRuns(currentAgent, { offset: -1 }), /分页参数/u)
  await assert.rejects(host.listScheduleRuns(currentAgent, { limit: 51 }), /分页参数/u)
  await assert.rejects(host.listScheduleRuns(currentAgent, { status: 'invalid' }), /状态筛选/u)
})
