import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.mjs'

const PACK_ID = 'spoken-video'

/**
 * Mount the pack entry against stub host services. `index.mjs` is the seam
 * that decides which service call answers "may this round run at all", and a
 * silently unwired hook would leave a scheduled round failing on its first
 * model request again with nothing to catch it.
 */
function packHarness(workspacePath, { executionStatus, modelRoute } = {}) {
  const provided = new Map()
  const projections = []
  const scope = {
    id: PACK_ID,
    signal: new AbortController().signal,
    context: async () => ({ packId: PACK_ID, workspaceId: `lwb-pack-workspace-${PACK_ID}`, workspacePath, generation: 0, status: 'registered' }),
    settings: async () => ({ get: () => ({}), update: async () => ({}) }),
    background: (work) => work,
    fetch: (url, options) => globalThis.fetch(url, options),
    account: { serviceStatus: async () => ({ configured: false, authenticated: false }), openService: async () => ({}) },
    // DSH owns model authentication; this seam must stay credential-free.
    credentials: new Proxy({}, { get() { throw new Error('the pack must not read model credentials here') } }),
    modelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-flash' }),
    sessions: { adopt: async () => {}, create: async () => { throw new Error('unused') }, resume: async () => { throw new Error('unused') }, get: () => null },
    request: (operation) => operation({ packId: PACK_ID, workspacePath }),
    onStop: () => {},
    assertAgent: async () => ({ packId: PACK_ID, workspacePath }),
    withAgent: async (operation) => operation({ id: 'entry-test-agent', session: { events: [] }, options: {}, whenIdle: async () => {}, followup: () => {} }),
  }
  const services = {
    forPack: (id) => { assert.equal(id, PACK_ID); return scope },
    executionStatus: async () => executionStatus ?? { configured: true },
    modelRoute: async () => modelRoute ?? { provider: 'deepseek-official', model: 'deepseek-flash', state: 'ready', ref: 'DEEPSEEK_API_KEY', reason: null },
  }
  const ctx = {
    lwbPackRegistry: { register: () => ({}) },
    lwbPackServices: services,
    provide: (name, value) => { provided.set(name, value); return value },
    plugin: () => {},
    effect: (fn) => fn(),
    on: () => () => {},
    get: () => null,
    subagents: { start: async () => { throw new Error('no child may start') } },
    tools: { register: (tool) => tool },
  }
  return { ctx, provided, projections }
}

async function mounted(t, options) {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'lwb-spoken-video-entry-')))
  t.after(() => rm(workspacePath, { recursive: true, force: true }))
  const harness = packHarness(workspacePath, options)
  await apply(harness.ctx, {})
  return harness
}

test('the pack entry wires the scene model route into the content scheduler', async (t) => {
  const { provided } = await mounted(t, {
    modelRoute: { provider: 'deepseek-official', model: 'deepseek-flash', state: 'missing-credential', ref: 'DEEPSEEK_API_KEY', reason: '未配置 API Key（DEEPSEEK_API_KEY），请先在“设置 → 模型”中完成该模型服务的配置。' },
  })
  const schedule = provided.get('spokenVideoSchedule')
  assert.ok(schedule, 'the pack provides its content schedule host')

  const status = await schedule.runtimeStatus()
  assert.equal(status.automationAvailable, true, 'a selected model keeps the Agent seam available')
  assert.equal(status.model.provider, 'deepseek-official')
  assert.equal(status.model.state, 'missing-credential')
  const blocker = status.blockers.find((item) => item.depth === 'topic')
  assert.match(blocker.message, /deepseek-official/u)
  assert.match(blocker.message, /DEEPSEEK_API_KEY/u)
})

test('the pack entry leaves an unprovable route unblocked and still reports DSH readiness', async (t) => {
  const { provided } = await mounted(t, {
    modelRoute: { provider: 'deepseek-account', model: 'deepseek-v4-pro', state: 'not-applicable', ref: null, reason: null },
  })
  const schedule = provided.get('spokenVideoSchedule')
  const ready = await schedule.runtimeStatus()
  assert.equal(ready.model.state, 'not-applicable')
  assert.equal(ready.blockers.some((item) => item.message.includes('场景任务模型')), false)

  const { provided: unselected } = await mounted(t, { executionStatus: { configured: false } })
  const blocked = await unselected.get('spokenVideoSchedule').runtimeStatus()
  assert.equal(blocked.automationAvailable, false)
  assert.match(blocked.blockers[0].message, /DSH 尚未选择默认模型/u)
})