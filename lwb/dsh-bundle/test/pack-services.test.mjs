import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, realpath, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LwbPackServices } from '../pack-services.mjs'
import { LwbPackWorkspaces } from '../pack-workspaces.mjs'

const manifest = (id) => ({ id, packageName: `@test/${id}`, name: id })
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }
async function setup(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'lwb-services-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const keys = new Map([['BAILIAN_API_KEY', 'ordinary-secret']])
  const settings = { providers: { ordinary: { apiKeyEnv: 'BAILIAN_API_KEY' } } }
  const calls = []
  const sessionAgents = new Map()
  let selection = { provider: 'ordinary', model: 'dsh-default', reasoningEffort: 'high' }
  const ctx = {
    agentDefaultModel: { currentSelection: () => selection },
    credentials: {
      resolve: async (ref) => ({ value: keys.get(ref) }),
      describe: async (ref) => ({ configured: keys.has(ref) }),
      set: async (ref, value) => keys.set(ref, value), unset: async (ref) => keys.delete(ref),
    },
    settings: {
      get: () => settings,
      register: (name) => name,
      mutate: async (ns, ops) => { assert.equal(ns, 'llm-pi-ai'); for (const op of ops) settings.providers[op.path[1]] = op.value },
    },
    agentPresets: { register: async options => calls.push(['preset.register', options]), resolve: async id => ({ id }), mount: async (_, id) => calls.push(['preset', id]) },
    permissionPresets: { set: (_, value) => calls.push(['permission', value]) },
    agents: {
      create: async (options) => {
        const owned = await workspaces.visibility()
        assert.ok(owned.sessionIds.includes(options.sessionId), 'ownership must be durable before Agent publication')
        calls.push(['create', options])
        const agent = { session: { header: { cwd: options.meta.cwd } } }
        // The real setup Context deliberately does not inject `agent`.
        await options.setup({})
        return { agent, dispose: async () => calls.push(['dispose']) }
      },
      get: (sessionId) => sessionAgents.get(sessionId),
    },
    sessionController: {
      async create(options) {
        const owned = await workspaces.visibility()
        assert.ok(owned.sessionIds.includes(options.sessionId), 'ownership must be durable before Session publication')
        calls.push(['session.create', options])
        let agent = sessionAgents.get(options.sessionId)
        if (!agent) {
          agent = {
            ctx: {
              hooks: new Map(),
              on(name, callback) { this.hooks.set(name, callback) },
              tools: { restrict: options => calls.push(['tools.restrict', options]) },
              systemPrompt: { section: options => calls.push(['system.section', options]) },
            },
            id: options.sessionId,
            session: { header: { cwd: options.cwd } },
            whenIdle: async () => calls.push(['session.idle', options.sessionId]),
            cancel: (reason) => calls.push(['session.cancel', options.sessionId, reason]),
          }
          sessionAgents.set(options.sessionId, agent)
        }
        return { sessionId: options.sessionId, agentPreset: options.agentPreset }
      },
      async selectModel(options) {
        calls.push(['session.selectModel', options])
        return { selected: options }
      },
      async prompt(options) {
        calls.push(['session.prompt', options])
        return { accepted: true }
      },
      async projections(request) {
        calls.push(['session.projections', request])
        // A session whose log is gone reads as absent, not as zeroes.
        if (request.sessionId === 'sv-gone') return null
        return { asOfSeq: 171, values: {
          sessionStats: { turns: 1, steps: 28, llmMs: 5 },
          // The wire view of this unit is its state's `totals`, not the state.
          tokenUsage: { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 5 },
          contextPressure: { pressureTokens: 7, contextWindow: 100 },
          // Registered, client-visible, and none of the pack's business.
          titleInput: { first: { seq: 9, text: 'the first prompt verbatim' } },
        } }
      },
    },
  }
  const workspaces = new LwbPackWorkspaces({ root })
  const services = new LwbPackServices(ctx, workspaces)
  const first = await services.mount(manifest('spoken-video'))
  const second = await services.mount(manifest('another-pack'))
  return { root, ctx, keys, settings, calls, sessionAgents, services, workspaces, first, second, setSelection: (value) => { selection = value } }
}

test('data access needs no Agent; directories, credentials and settings are isolated', async (t) => {
  const { first, second, calls, keys } = await setup(t)
  assert.notEqual((await first.context()).workspacePath, (await second.context()).workspacePath)
  await first.request(async (context) => writeFile(join(context.workspacePath, 'data'), 'first'))
  assert.equal(calls.length, 0)
  assert.equal((await first.credentials.describe('BAILIAN_API_KEY')).configured, false)
  await first.credentials.set('BAILIAN_API_KEY', 'first-secret')
  assert.equal((await second.credentials.describe('BAILIAN_API_KEY')).configured, false)
  assert.equal((await first.credentials.resolve('BAILIAN_API_KEY')).value, 'first-secret')
  assert.equal(keys.get('BAILIAN_API_KEY'), 'ordinary-secret')
  const firstSettings = await first.settings('media', input => ({ voice: '', ...input }))
  const secondSettings = await second.settings('media', input => ({ voice: '', ...input }))
  await firstSettings.update({ voice: 'first' })
  assert.equal(secondSettings.get().voice, '')
  await assert.rejects(first.assertAgent({ session: { header: { cwd: (await second.context()).workspacePath } } }), /此工具/)
})

test('model catalog marks only the unconfigured DeepSeek API route unavailable', async (t) => {
  const { first, ctx, keys } = await setup(t)
  let ref = 'CUSTOM_DEEPSEEK_KEY'
  ctx.get = (name) => name === 'settings' ? {
    describe: () => [{ ns: 'llm-deepseek', value: { apiKeyEnv: ref } }],
  } : undefined
  ctx.llm = {
    listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }, { id: 'deepseek-account', name: 'DeepSeek Account' }],
    listConfigurableProviders: () => [{ provider: 'deepseek-official', settingsNs: 'llm-deepseek', settingsPath: [] }],
    listModels: async () => [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }],
  }
  let groups = await first.models.list()
  assert.equal(groups[0].selectable, false)
  assert.match(groups[0].unavailableReason, /API Key/)
  assert.equal(groups[1].selectable, undefined)
  keys.set(ref, 'configured')
  groups = await first.models.list()
  assert.equal(groups[0].selectable, true)
  ref = 'ANOTHER_KEY'
  groups = await first.models.list()
  assert.equal(groups[0].selectable, false)
  ctx.credentials.describe = async () => { throw new Error('credential service unavailable') }
  groups = await first.models.list()
  assert.equal(groups[0].selectable, false)
  assert.match(groups[0].unavailableReason, /无法确认/)
})

test('scene model readiness names an unconfigured route and never blocks on an unprovable one', async (t) => {
  const { first, services, ctx, keys, setSelection } = await setup(t)
  // No selection yet.
  setSelection(null)
  assert.equal((await services.modelRoute(first.id)).state, 'unselected')
  // Nothing is registered as configurable for the default route, so nothing
  // can be proven and the round must not be blocked.
  setSelection({ provider: 'ordinary', model: 'dsh-default' })
  assert.equal((await services.modelRoute(first.id)).state, 'not-applicable')
  assert.equal((await services.modelRoute(first.id)).reason, null)

  ctx.get = (name) => name === 'settings' ? { describe: () => [{ ns: 'llm-deepseek', value: { apiKeyEnv: 'DEEPSEEK_API_KEY' } }] } : undefined
  ctx.llm = {
    listProviders: () => [{ id: 'deepseek-official' }],
    listConfigurableProviders: () => [{ provider: 'deepseek-official', settingsNs: 'llm-deepseek', settingsPath: [] }],
    listModels: async () => [],
  }
  setSelection({ provider: 'deepseek-official', model: 'deepseek-flash' })
  const missing = await services.modelRoute(first.id)
  assert.equal(missing.state, 'missing-credential')
  assert.equal(missing.provider, 'deepseek-official')
  assert.equal(missing.ref, 'DEEPSEEK_API_KEY')
  assert.match(missing.reason, /DEEPSEEK_API_KEY/)
  keys.set('DEEPSEEK_API_KEY', 'configured')
  assert.equal((await services.modelRoute(first.id)).state, 'ready')
})

test('a BYOK provider is classified from its own declared credential reference', async (t) => {
  const { first, services, ctx, keys, setSelection } = await setup(t)
  ctx.get = (name) => name === 'settings' ? {
    describe: () => [
      { ns: 'llm-deepseek', value: { apiKeyEnv: 'DEEPSEEK_API_KEY' } },
      { ns: 'llm-pi-ai', value: { providers: { bailian: { apiKeyEnv: 'BAILIAN_API_KEY' } } } },
      { ns: 'llm-deepseek-account', value: {} },
    ],
  } : undefined
  ctx.llm = {
    listProviders: () => [{ id: 'deepseek-official' }, { id: 'bailian' }, { id: 'deepseek-account' }],
    listConfigurableProviders: () => [
      { provider: 'deepseek-official', settingsNs: 'llm-deepseek', settingsPath: [] },
      { provider: 'bailian', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'bailian'] },
      { provider: 'deepseek-account', settingsNs: 'llm-deepseek-account', settingsPath: [] },
    ],
    listModels: async () => [],
  }
  keys.delete('BAILIAN_API_KEY')
  setSelection({ provider: 'bailian', model: 'glm-5.3' })
  const bailian = await services.modelRoute(first.id)
  assert.equal(bailian.state, 'missing-credential')
  assert.equal(bailian.ref, 'BAILIAN_API_KEY')
  keys.set('BAILIAN_API_KEY', 'configured')
  assert.equal((await services.modelRoute(first.id)).state, 'ready')

  // An account route declares no credential reference: DSH resolves its
  // authentication, so the pack reports it as not applicable, never as missing.
  setSelection({ provider: 'deepseek-account', model: 'deepseek-v4-pro' })
  const account = await services.modelRoute(first.id)
  assert.equal(account.state, 'not-applicable')
  assert.equal(account.reason, null)
})

test('AI roots use DSH defaults without pack model credentials and keep owned cwd and permissions', async (t) => {
  const { first, second, calls, services, ctx, settings, keys } = await setup(t)
  // Authentication belongs to the DSH adapter, including OAuth/environment
  // discovery. The pack must neither inspect nor rewrite model credentials.
  ctx.credentials = new Proxy({}, { get() { throw new Error('pack must not touch DSH model authentication') } })
  const originalSettings = structuredClone(settings)
  const originalKeys = [...keys]
  assert.equal((await services.executionStatus(first.id)).configured, true)
  assert.equal((await services.executionStatus(second.id)).configured, true)
  await assert.rejects(first.withAgent(() => { throw new Error('job failed') }), /job failed/)
  const options = calls.find(([kind]) => kind === 'create')[1]
  assert.deepEqual(options.agentOptions, { provider: 'ordinary', model: 'dsh-default', reasoningEffort: 'high' })
  assert.equal(options.meta.cwd, (await first.context()).workspacePath)
  assert.deepEqual(calls.filter(([kind]) => kind !== 'create'), [['preset', 'standard'], ['permission', 'workspace-write'], ['dispose']])
  assert.deepEqual(settings, originalSettings)
  assert.deepEqual([...keys], originalKeys)
})

test('a withAgent caller can preserve a captured route and preset', async (t) => {
  const { first, calls } = await setup(t)
  await first.withAgent(() => {}, undefined, {
    agentOptions: { provider: 'captured', model: 'captured-model', reasoningEffort: 'low', maxTokens: 999 },
    presetId: 'captured-preset',
  })
  const options = calls.find(([kind]) => kind === 'create')[1]
  assert.deepEqual(options.agentOptions, { provider: 'captured', model: 'captured-model', reasoningEffort: 'low' })
  assert.ok(calls.some(([kind, value]) => kind === 'preset' && value === 'captured-preset'))
})

test('new pack sessions follow updated DSH defaults while each in-flight session keeps its snapshot', async (t) => {
  const { first, second, calls, settings, setSelection } = await setup(t)
  settings.providers['lwb-pack-spoken-video'] = { apiKeyEnv: 'STALE_PACK_KEY', models: [{ id: 'stale-pack-model' }] }
  const entered = deferred(), finish = deferred()
  const inFlight = first.withAgent(async () => { entered.resolve(); await finish.promise })
  await entered.promise
  setSelection({ provider: 'updated-dsh', model: 'new-default' })
  await second.withAgent(() => {})
  await first.withAgent(() => {})
  const roots = calls.filter(([kind]) => kind === 'create').map(([, options]) => options)
  assert.deepEqual(roots.map((options) => options.agentOptions), [
    { provider: 'ordinary', model: 'dsh-default', reasoningEffort: 'high' },
    { provider: 'updated-dsh', model: 'new-default' },
    { provider: 'updated-dsh', model: 'new-default' },
  ])
  assert.notEqual(roots[0].meta.cwd, roots[1].meta.cwd)
  assert.equal(roots[0].meta.cwd, roots[2].meta.cwd)
  finish.resolve(); await inFlight
})

test('missing selection points to scene model settings; native execution errors propagate unchanged', async (t) => {
  const { first, services, setSelection, calls, ctx } = await setup(t)
  setSelection(null)
  assert.equal((await services.executionStatus(first.id)).configured, false)
  await assert.rejects(first.withAgent(() => {}), /场景任务默认模型/)
  assert.equal(calls.length, 0)
  setSelection({ provider: 'ordinary', model: 'dsh-default' })
  const failure = Object.assign(new Error('DSH provider credentials unavailable'), { code: 'MISSING_CREDENTIAL' })
  ctx.agents.create = async () => { throw failure }
  await assert.rejects(first.withAgent(() => {}), (error) => error === failure)
})

test('independent scene model governs all pack roots without modifying DSH defaults', async t => {
  const { services, first, second, calls, ctx } = await setup(t)
  services.taskModel = { selection: () => ({ provider: 'lwb', model: 'deepseek-v4.1-flash' }) }
  await first.withAgent(() => {})
  await second.withAgent(() => {})
  assert.deepEqual(calls.filter(([kind]) => kind === 'create').map(([, options]) => options.agentOptions), [{ provider: 'lwb', model: 'deepseek-v4.1-flash' }, { provider: 'lwb', model: 'deepseek-v4.1-flash' }])
  assert.equal(ctx.agentDefaultModel.currentSelection().model, 'dsh-default')
})

test('pack sessions use the official controller and remain resumable after facade disposal', async t => {
  const { first, calls, ctx } = await setup(t)
  const session = await first.sessions.create({ provider: 'deepseek-account', model: 'deepseek-flash' })
  const create = calls.find(([kind]) => kind === 'session.create')
  assert.equal(create[1].sessionId, session.id)
  assert.equal(create[1].cwd, (await first.context()).workspacePath)
  assert.equal(create[1].agentPreset, 'standard')
  assert.deepEqual(calls.find(([kind]) => kind === 'session.selectModel')[1], {
    sessionId: session.id,
    provider: 'deepseek-account',
    model: 'deepseek-flash',
  })

  await session.followup('  test prompt  ')
  const prompt = calls.find(([kind]) => kind === 'session.prompt')[1]
  assert.equal(prompt.sessionId, session.id)
  assert.equal(prompt.mode, 'queue')
  assert.deepEqual(prompt.content, [{ type: 'text', text: 'test prompt' }])
  assert.match(prompt.requestId, /^[0-9a-f-]{36}$/u)
  await session.whenIdle()
  session.cancel()
  assert.deepEqual(calls.find(([kind]) => kind === 'session.idle'), ['session.idle', session.id])
  assert.deepEqual(calls.find(([kind]) => kind === 'session.cancel'), ['session.cancel', session.id, { kind: 'parent' }])

  const officialAgent = ctx.agents.get(session.id)
  await session.dispose()
  assert.equal(first.sessions.get(session.id), null)
  assert.equal(ctx.agents.get(session.id), officialAgent, 'disposing the pack facade must not destroy the official Session')

  const resumed = await first.sessions.resume(session.id, { provider: 'deepseek-account', model: 'deepseek-flash' })
  assert.equal(resumed.id, session.id)
  assert.equal(calls.filter(([kind]) => kind === 'session.create').length, 2)
  await resumed.whenIdle()
})

test('a pack adopts the root Sessions it created through the native Agent service', async (t) => {
  const { first, second, workspaces } = await setup(t)
  const workspacePath = (await first.context()).workspacePath
  const otherPath = (await second.context()).workspacePath
  const adopted = 'sv-auto-schedule-1'
  const agent = { id: adopted, session: { header: { cwd: workspacePath }, id: adopted } }

  assert.equal((await first.sessions.adopt(agent)).workspacePath, workspacePath, 'adoption resolves with the owning workspace')
  assert.ok((await workspaces.visibility(first.id)).sessionIds.includes(adopted), 'the adopted Session is pack-owned')
  assert.ok(!(await workspaces.visibility(second.id)).sessionIds.includes(adopted), 'no other pack gains ownership')

  // Reuse across rounds must not duplicate the record.
  await first.sessions.adopt(agent)
  assert.deepEqual((await workspaces.visibility(first.id)).sessionIds, [adopted])

  // The Agent's cwd is the ownership proof: a foreign or unknown directory is refused.
  for (const cwd of [otherPath, '/tmp/elsewhere', undefined]) {
    await assert.rejects(first.sessions.adopt({ id: 'sv-auto-other', session: { header: { cwd } } }), /只能登记/)
  }
  await assert.rejects(first.sessions.adopt(null), /只能登记/)
  assert.deepEqual((await workspaces.visibility(first.id)).sessionIds, [adopted], 'a refused adoption records nothing')

  // The official controller's own Session may be adopted only by its owner.
  await assert.rejects(
    second.sessions.adopt({ id: adopted, session: { header: { cwd: otherPath } } }),
    { code: 'PACK_WORKSPACE_COLLISION' },
  )

  // The Agent id must be resolvable; the Session header is the fallback.
  await first.sessions.adopt({ session: { header: { cwd: workspacePath }, id: 'sv-auto-fallback' } })
  assert.ok((await workspaces.visibility(first.id)).sessionIds.includes('sv-auto-fallback'))
  await assert.rejects(first.sessions.adopt({ session: { header: { cwd: workspacePath } } }), /无法确认/)
})

test('pack sessions can own one directory each below the pack workspace', async (t) => {
  const { first, calls } = await setup(t)
  const workspacePath = (await first.context()).workspacePath
  const session = await first.sessions.create({
    provider: 'deepseek-account', model: 'deepseek-flash', cwd: 'runs/task-1/run-1',
  })
  const created = calls.find(([kind]) => kind === 'session.create')[1]
  assert.equal(created.cwd, join(workspacePath, 'runs', 'task-1', 'run-1'))
  assert.equal(session.cwd, created.cwd)
  await writeFile(join(created.cwd, 'answer.txt'), 'run one')
  assert.equal(await readFile(join(created.cwd, 'answer.txt'), 'utf8'), 'run one')

  const second = await first.sessions.create({
    provider: 'deepseek-account', model: 'deepseek-flash', cwd: 'runs/task-1/run-2',
  })
  assert.equal(second.cwd, join(workspacePath, 'runs', 'task-1', 'run-2'))
  await assert.rejects(readFile(join(second.cwd, 'answer.txt'), 'utf8'), { code: 'ENOENT' })

  const resumed = await first.sessions.resume(second.id, {
    provider: 'deepseek-account', model: 'deepseek-flash', cwd: 'runs/task-1/run-2',
  })
  assert.equal(calls.filter(([kind]) => kind === 'session.create').at(-1)[1].cwd, second.cwd)
  assert.equal(resumed.cwd, second.cwd)

  const escaped = []
  for (const cwd of ['..', '../outside', '/tmp/lwb-escape', 'runs/../../outside', 'runs/./inner', 'runs/', 'runs//inner', '.hidden', 'a\\b']) {
    escaped.push(await first.sessions.create({ provider: 'deepseek-account', model: 'deepseek-flash', cwd })
      .then(() => undefined, (error) => error))
  }
  const outside = await import('node:fs/promises').then((module) => module.lstat(join(workspacePath, '..', 'outside')).then(() => true, () => false))
  assert.equal(outside, false, 'a rejected cwd must never create a directory outside the pack workspace')
  for (const [index, error] of escaped.entries()) {
    assert.ok(error, `cwd ${index} must be rejected`)
    assert.match(String(error.code || error.message), /PACK_WORKSPACE_INVALID|PACK_WORKSPACE_UNSAFE/, `cwd ${index} reported ${error.message}`)
  }
  await assert.rejects(first.sessions.create({ provider: 'deepseek-account', model: 'deepseek-flash', cwd: 7 }), /会话工作目录必须是能力包工作区内的相对路径/u)
})

test('unload waits for late background final writes admitted by an in-flight request', async (t) => {
  const { first, second, services, workspaces } = await setup(t)
  const entered = deferred(), release = deferred(), backgroundStarted = deferred(), finish = deferred()
  const path = join((await first.context()).workspacePath, 'final')
  const request = first.request(async () => {
    entered.resolve(); await release.promise
    first.background((async () => { backgroundStarted.resolve(); await finish.promise; await writeFile(path, 'settled') })())
  })
  await entered.promise
  let stopped = false
  const stopping = services.unmount(first.id).then(() => { stopped = true })
  await new Promise((resolve) => setImmediate(resolve))
  release.resolve(); await request; await backgroundStarted.promise
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(stopped, false)
  await assert.rejects(workspaces.clearData(first.id), { code: 'PACK_WORKSPACE_BUSY' })
  assert.equal(second.signal.aborted, false)
  finish.resolve(); await stopping
  assert.equal(await readFile(path, 'utf8'), 'settled')
  assert.equal(first.signal.aborted, true)
  await assert.rejects(first.request(() => {}), { code: 'PACK_WORKSPACE_INACTIVE' })
  const replacement = await services.mount(manifest(first.id))
  assert.equal(replacement.signal.aborted, false)
})

test('stopping a pack cancels its HTTP and explicit-signal AI operations only', async (t) => {
  const { first, second, services } = await setup(t)
  await services.unmount(first.id)
  assert.throws(() => first.fetch('http://127.0.0.1:1'), /停止/)
  await assert.rejects(first.withAgent(() => {}, new AbortController().signal), /停止/)
  assert.equal(second.signal.aborted, false)
})


test('settings share one writer per scope and cannot write after unload', async t => {
  const { first, services } = await setup(t)
  const validate = input => ({ left: 0, right: 0, ...input })
  const [a, b] = await Promise.all([first.settings('media', validate), first.settings('media', validate)])
  await Promise.all([a.update({ left: 1 }), b.update({ right: 2 })])
  assert.deepEqual(a.get(), { left: 1, right: 2 })
  assert.deepEqual(b.get(), a.get())
  await services.unmount(first.id)
  await assert.rejects(a.update({ left: 3 }))
})


test('restricted persistent Sessions enforce per-request parameters without saving the global model', async t => {
  const { first, calls, ctx } = await setup(t)
  const options = { provider: 'bailian', model: 'qwen', maxTokens: 4096, tools: 'none', system: '只下棋。{{literal}}' }
  const session = await first.sessions.create(options)
  const agent = ctx.agents.get(session.id)
  assert.equal(calls.find(([kind]) => kind === 'session.create')[1].agentPreset, 'lwb-pack-no-tools')
  assert.equal(calls.some(([kind]) => kind === 'session.selectModel'), false)
  assert.deepEqual(calls.find(([kind]) => kind === 'tools.restrict')[1], { allow: [] })
  const section = calls.find(([kind]) => kind === 'system.section')[1]
  assert.equal(section.complete, true)
  assert.equal(section.interpolate, false)
  assert.equal(section.text(), options.system)
  const request = () => agent.ctx.hooks.get('agent/request')({}, async () => ({ provider: 'other', model: 'default', reasoningEffort: 'high', maxTokens: 16, tools: [{ name: 'bash' }] }))
  assert.deepEqual(await request(), { provider: 'bailian', model: 'qwen', maxTokens: 4096, tools: [] })
  await session.dispose()
  assert.equal((await request()).tools.length, 0, 'facade disposal keeps the live Agent restricted')
  await first.sessions.resume(session.id, { ...options, maxTokens: 8192, reasoningEffort: 'low' })
  assert.equal(calls.filter(([kind]) => kind === 'session.create').at(-1)[1].agentPreset, undefined, 'legacy preset identity is preserved on resume')
  assert.equal((await request()).maxTokens, 8192)
  assert.equal((await request()).reasoningEffort, 'low')
  assert.equal(calls.filter(([kind]) => kind === 'tools.restrict').length, 1)
  await first.sessions.resume(session.id, { provider: options.provider, model: options.model })
  assert.equal((await request()).maxTokens, 8192, 'omission preserves an existing output cap')
  await first.sessions.resume(session.id, { ...options, maxTokens: null })
  assert.equal(Object.hasOwn(await request(), 'maxTokens'), false, 'explicit reset also removes the inherited request header cap')
  assert.deepEqual((await request()).tools, [])
  await session.dispose()
  await first.sessions.resume(session.id, { ...options, maxTokens: null })
  assert.equal(Object.hasOwn(await request(), 'maxTokens'), false, 'reset survives facade disposal and readoption')
  const preset = calls.find(([kind]) => kind === 'preset.register')[1]
  assert.deepEqual(preset.plugins, [{ id: 'compaction', name: 'cordis:group', group: true,
    isolate: { compaction: true }, config: [{ id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' }],
  }])
  for (const maxTokens of [0, 127, 393217, 1.5, NaN]) await assert.rejects(first.sessions.create({ ...options, maxTokens }), /输出上限/)
})

test('a pack reads only the projection keys it asked for, and only from its own sessions', async (t) => {
  const { first, second, calls } = await setup(t)
  const session = await first.sessions.create({ provider: 'deepseek-account', model: 'deepseek-flash' })

  const read = await first.sessions.projections(session.id, ['sessionStats', 'tokenUsage', 'contextPressure'])
  assert.equal(read.asOfSeq, 171, 'the log position travels with the values')
  assert.deepEqual(Object.keys(read.values).sort(), ['contextPressure', 'sessionStats', 'tokenUsage'])
  // The baseline also carries the first prompt verbatim and other domains' state:
  // a pack asks for what it needs and gets only that.
  assert.equal('titleInput' in read.values, false)

  // A key the host does not serve is simply absent rather than an error, so a pack
  // written against a newer host still works on an older one.
  const partial = await first.sessions.projections(session.id, ['sessionStats', 'subagentTiming'])
  assert.deepEqual(Object.keys(partial.values), ['sessionStats'])

  // The ownership fence applies exactly as it does to page and follow.
  await assert.rejects(second.sessions.projections(session.id, ['sessionStats']), /该会话不属于此能力包/u)
  // The read is async, so a bad address rejects rather than throwing. A non-string
  // id never reaches a lookup; an unknown one is simply not owned.
  await assert.rejects(first.sessions.projections(undefined, ['sessionStats']), /能力包会话地址无效/u)
  await assert.rejects(first.sessions.projections('', ['sessionStats']), /该会话不属于此能力包/u)

  // A session that no longer exists reports nothing to read, not an empty record.
  await first.sessions.adopt({ session: { header: { cwd: (await first.context()).workspacePath }, id: 'sv-gone' } })
  assert.equal(await first.sessions.projections('sv-gone', ['sessionStats']), null)

  // Reads never activate an Agent or a Session: they only consult projections.
  assert.equal(calls.filter(([kind]) => kind === 'create').length, 0)
  // Three reads reached the host; the refused ones never got that far.
  assert.equal(calls.filter(([kind]) => kind === 'session.projections').length, 3)
})
