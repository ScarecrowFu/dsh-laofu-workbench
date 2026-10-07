import { randomUUID } from 'node:crypto'
import { packCredentialRef } from './pack-workspaces.mjs'
import { PackTaskScope } from './pack-task-scope.mjs'
import { openPackSettings } from './pack-settings.mjs'

/** How far one model route's authentication can be established without calling the provider. */
export const MODEL_ROUTE_STATES = Object.freeze({
  READY: 'ready',
  MISSING_CREDENTIAL: 'missing-credential',
  UNVERIFIABLE: 'unverifiable',
  NOT_APPLICABLE: 'not-applicable',
})

const MIN_MODEL_OUTPUT_TOKENS = 128
const MAX_MODEL_OUTPUT_TOKENS = 393216
const DEFAULT_MODEL_OUTPUT_LIMIT = 32768

function advertisedOutputLimit(model) {
  const value = [model?.maxOutputTokens, model?.maxTokens, model?.defaultMaxTokens].find(candidate => Number.isInteger(candidate) && candidate >= MIN_MODEL_OUTPUT_TOKENS)
  return Math.max(MIN_MODEL_OUTPUT_TOKENS, Math.min(value ?? DEFAULT_MODEL_OUTPUT_LIMIT, MAX_MODEL_OUTPUT_TOKENS))
}

function unverifiable(ref) {
  return {
    state: MODEL_ROUTE_STATES.UNVERIFIABLE,
    ref: ref || null,
    reason: ref
      ? `无法确认 API Key（${ref}）的状态，请检查模型设置后刷新。`
      : '无法确认该模型服务的凭据状态，请检查模型设置后刷新。',
  }
}

/**
 * Classify one model route's authentication readiness.
 *
 * Only a provider that declares a credential reference in its own settings
 * schema can be proven unconfigured: `deepseek-official` declares
 * `apiKeyEnv = DEEPSEEK_API_KEY`, and a BYOK provider declares its own. A
 * route that authenticates by account, device token or OAuth declares none,
 * so it is reported as not applicable rather than as unavailable — the pack
 * never inspects or rewrites DSH model authentication.
 * @param ctx - host context exposing `llm`, `settings` and `credentials`.
 * @param providerId - the provider id to classify.
 * @returns a `MODEL_ROUTE_STATES` value with the credential reference and a display reason.
 */
export async function modelRouteState(ctx, providerId) {
  const id = typeof providerId === 'string' ? providerId : ''
  try {
    const registrations = typeof ctx?.llm?.listConfigurableProviders === 'function' ? ctx.llm.listConfigurableProviders() : null
    const route = Array.isArray(registrations) ? registrations.find((item) => item?.provider === id) || null : null
    if (!route) return { state: MODEL_ROUTE_STATES.NOT_APPLICABLE, ref: null, reason: null }
    const settings = ctx.get('settings')
    if (!settings) return unverifiable()
    const namespace = settings.describe({ redactSecrets: true }).find((item) => item.ns === route.settingsNs)
    if (!namespace) return unverifiable()
    const profile = route.settingsPath.reduce((value, key) => value?.[key], namespace.value)
    const ref = typeof profile?.apiKeyEnv === 'string' && profile.apiKeyEnv.trim() ? profile.apiKeyEnv.trim() : null
    if (!ref) return { state: MODEL_ROUTE_STATES.NOT_APPLICABLE, ref: null, reason: null }
    try {
      const status = await ctx.credentials.describe(ref)
      if (status.configured) return { state: MODEL_ROUTE_STATES.READY, ref, reason: null }
      return { state: MODEL_ROUTE_STATES.MISSING_CREDENTIAL, ref, reason: `未配置 API Key（${ref}），请先在“设置 → 模型”中完成该模型服务的配置。` }
    } catch {
      return unverifiable(ref)
    }
  } catch {
    return { state: MODEL_ROUTE_STATES.NOT_APPLICABLE, ref: null, reason: null }
  }
}

/** Project a route classification onto the pack model catalog's display fields. */
function routeAvailability(route) {
  if (route.state === MODEL_ROUTE_STATES.READY) return { selectable: true }
  if (route.state === MODEL_ROUTE_STATES.MISSING_CREDENTIAL || route.state === MODEL_ROUTE_STATES.UNVERIFIABLE) {
    return { selectable: false, unavailableReason: route.reason }
  }
  return {}
}

/** Scoped services issued by the host to one actually mounted package. */
export class LwbPackServices {
  constructor(ctx, workspaces, { account, taskModel, entitlements } = {}) { this.ctx = ctx; this.workspaces = workspaces; this.scopes = new Map(); this.account = account; this.taskModel = taskModel; this.entitlements = entitlements; this.sessionPolicies = new WeakMap() }

  async mount(manifest) {
    await this.workspaces.activate(manifest)
    if (this.scopes.has(manifest.id)) return this.scopes.get(manifest.id)
    const { id } = manifest
    const tasks = new PackTaskScope()
    const sessions = new Map()
    const settings = new Map()
    const credentialRef = (purpose) => packCredentialRef(id, purpose)
    const credentials = Object.fromEntries(['resolve', 'describe', 'set', 'unset'].map((method) => [method, (ref, ...args) => {
      if (typeof ref !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(ref)) throw new Error('能力包凭据引用无效。')
      return this.ctx.credentials[method](credentialRef(ref.toLowerCase().replaceAll('_', '-')), ...args)
    }]))
    const facade = Object.freeze({
      id, credentialRef, credentials, signal: tasks.signal,
      assertAccess: () => this.assertAccess(manifest),
      modelSelection: () => this.defaultSelection(),
      models: Object.freeze({
        list: async () => Promise.all((this.ctx.llm?.listProviders?.() || []).map(async (provider) => ({
          ...provider,
          ...routeAvailability(await modelRouteState(this.ctx, provider.id)),
          models: await this.listPackModels(provider.id),
        }))),
      }),
      account: Object.freeze({
        status: (service) => this.account?.serviceStatus(service) || Promise.resolve({ configured: false, authenticated: false, reason: 'LWB 账号服务不可用。' }),
        points: () => this.account?.status?.().then(value => value.points).catch(() => null) || Promise.resolve(null),
        open: (service, options = {}) => {
          tasks.signal.throwIfAborted()
          if (!manifest.requiredServices?.includes(service)) throw new Error('能力包未声明此 LWB 服务。')
          if (!this.account) throw new Error('LWB 账号服务不可用。')
          return this.account.openService(service, { ...options, signal: options.signal ? AbortSignal.any([options.signal, tasks.signal]) : tasks.signal })
        },
      }),
      context: () => this.workspaces.context(id),
      settings: (name, validate) => this.workspaces.run(id, async (context) => {
        if (!settings.has(name)) settings.set(name, openPackSettings(context.workspacePath, name, validate).catch(error => { settings.delete(name); throw error }))
        const store = await settings.get(name)
        return Object.freeze({ get: store.get, update: patch => this.workspaces.run(id, () => store.update(patch)) })
      }),
      request: (operation) => this.workspaces.run(id, operation),
      background: (promise) => tasks.track(promise),
      onStop: (dispose) => tasks.addDisposer(dispose),
      fetch: (url, options = {}) => {
        tasks.signal.throwIfAborted()
        return globalThis.fetch(url, { ...options, signal: options.signal ? AbortSignal.any([options.signal, tasks.signal]) : tasks.signal })
      },
      withAgent: (operation, signal = tasks.signal) => tasks.track(this.withAgent(id, operation, AbortSignal.any([signal, tasks.signal]))),
      // Long-lived, pack-owned DSH sessions. The pack chooses the model route
      // explicitly and owns the returned handle until it disposes the session.
      sessions: Object.freeze({
        create: (options = {}) => tasks.track(this.createSession(id, options, tasks.signal, sessions)),
        resume: (sessionId, options = {}) => tasks.track(this.resumeSession(id, sessionId, options, tasks.signal, sessions)),
        // A pack that owns its own Agent lifecycle (an unattended round, for
        // example) bypasses create/resume, so it adopts the root it made.
        adopt: (agent) => this.adoptSession(id, agent),
        get: (sessionId) => sessions.get(sessionId)?.public || null,
        // What the conversation actually did, for the pack to record beside its own
        // results. Pack-owned sessions only; see sessionProjections for the key filter.
        projections: (sessionId, keys) => this.sessionProjections(id, { kind: 'session', sessionId }, keys, tasks.signal),
      }),
      assertAgent: async (agent) => {
        const context = await this.workspaces.context(id)
        if (agent?.session?.header?.cwd !== context.workspacePath) throw new Error('此工具只供该能力包的内部任务使用。')
        return context
      },
    })
    this.workspaces.onStop(id, async () => {
      await tasks.stop()
      await Promise.allSettled([...sessions.values()].map((session) => session.dispose()))
      sessions.clear()
    })
    this.scopes.set(id, facade)
    return facade
  }

  forPack(id) {
    const scope = this.scopes.get(id)
    if (!scope) throw new Error('能力包运行上下文尚未准备好。')
    return scope
  }

  async unmount(id) {
    await this.workspaces.deactivate(id)
    this.scopes.delete(id)
  }

  // Model routing and authentication belong to DSH. This snapshot is refreshed
  // for each new internal Session, independently of the browser's active chat.
  defaultSelection() {
    const selected = this.taskModel ? this.taskModel.selection() : this.ctx.agentDefaultModel.currentSelection()
    if (typeof selected?.provider !== 'string' || !selected.provider.trim()
      || typeof selected?.model !== 'string' || !selected.model.trim()) return null
    return { provider: selected.provider, model: selected.model,
      ...(selected.reasoningEffort === undefined ? {} : { reasoningEffort: selected.reasoningEffort }) }
  }

  async executionStatus(id) {
    this.forPack(id)
    // This checks selection only. Provider availability and authentication are
    // validated by native DSH execution (including non-API-key auth methods),
    // and the pack must not read model credentials on this path.
    return { configured: this.defaultSelection() !== null }
  }

  /**
   * Readiness of the model route the next pack AI task will actually use, so a
   * scheduled round can state "this route has no credential" instead of dying
   * on its first model request and reading as a stage failure.
   *
   * This is deliberately separate from `executionStatus`: that seam answers
   * "is a model selected" without touching credentials, while this one may
   * read one credential reference. Only a route proven to lack its declared
   * credential is reported as unavailable; every unprovable case is reported
   * as unverifiable or not applicable and must not block a task.
   * @param id - capability pack id.
   * @returns the effective selection with its `modelRouteState` classification.
   */
  async modelRoute(id) {
    this.forPack(id)
    const selection = this.defaultSelection()
    if (!selection) {
      return {
        provider: null, model: null, state: 'unselected', ref: null,
        reason: '尚未选择场景任务模型，请在“设置 → 系统设置 → 模型”中完成配置。',
      }
    }
    return { provider: selection.provider, model: selection.model, ...await modelRouteState(this.ctx, selection.provider) }
  }

  async assertAccess(manifest) {
    return this.entitlements?.assertAllowed(manifest) || { allowed: true, required: false, reason: null }
  }

  async listPackModels(provider) {
    const models = await this.ctx.llm.listModels(provider).catch(() => [])
    return Promise.all(models.map(async model => {
      let info = model
      if (typeof this.ctx.llm.resolveModelInfo === 'function') {
        try { info = { ...model, ...await this.ctx.llm.resolveModelInfo(provider, model.id) } }
        catch { /* Native dispatch will report capability lookup failures. */ }
      }
      return { ...info, maxOutputTokens: advertisedOutputLimit(info) }
    }))
  }

  async withAgent(id, operation, signal) {
    signal.throwIfAborted()
    const scope = this.forPack(id)
    const context = await scope.context()
    const selection = this.defaultSelection()
    if (!selection) throw new Error('尚未选择场景任务模型，请在“设置 → 场景任务默认模型”中完成配置。')
    const preset = await this.ctx.agentPresets.resolve('standard')
    const sessionId = `lwb-pack-${id}-${randomUUID()}`
    await this.workspaces.recordSession(id, sessionId)
    const handle = await this.ctx.agents.create({
      sessionId, meta: { cwd: context.workspacePath, agentPreset: preset.id },
      agentOptions: selection, signal,
      setup: async (agentCtx) => {
        await this.ctx.agentPresets.mount(agentCtx, preset.id)
      },
    })
    try {
      signal.throwIfAborted()
      // Use the published handle: the preset setup Context does not inject
      // agent. No task is submitted until this policy is installed.
      this.ctx.permissionPresets.set(handle.agent.session, 'workspace-write')
      return await operation(handle.agent)
    } finally { await handle.dispose() }
  }

  /**
   * Resolve the working directory one requested Session runs in.
   *
   * Internal Sessions default to the pack workspace. A pack may name a
   * workspace-relative directory instead — one run per model, for example — so
   * parallel runs of one pack never overwrite each other's files.
   * @param id - capability pack id.
   * @param context - active pack workspace projection.
   * @param cwd - optional `/`-separated directory below the pack workspace.
   * @returns the absolute Session cwd.
   */
  async sessionCwd(id, context, cwd) {
    if (cwd === undefined || cwd === null || cwd === '') return context.workspacePath
    if (typeof cwd !== 'string') throw new Error('会话工作目录必须是能力包工作区内的相对路径。')
    return this.workspaces.ownedDirectory(id, cwd)
  }

  async createSession(id, options = {}, signal, sessions) {
    const scope = this.forPack(id)
    const context = await scope.context()
    const selection = this.normalizeSelection(options, this.defaultSelection())
    const cwd = await this.sessionCwd(id, context, options?.cwd)
    const sessionId = typeof options.sessionId === 'string' && options.sessionId.trim()
      ? options.sessionId.trim() : `lwb-pack-${id}-${randomUUID()}`
    return this.openSession(id, { sessionId, context, cwd, selection, policy: this.sessionPolicy(options), signal, sessions, resume: false })
  }

  async resumeSession(id, sessionId, options = {}, signal, sessions) {
    if (typeof sessionId !== 'string' || !sessionId.trim()) throw new Error('能力包会话标识无效。')
    const scope = this.forPack(id)
    const context = await scope.context()
    const selection = this.normalizeSelection(options, this.defaultSelection())
    const cwd = await this.sessionCwd(id, context, options?.cwd)
    return this.openSession(id, { sessionId: sessionId.trim(), context, cwd, selection, policy: this.sessionPolicy(options), signal, sessions, resume: true })
  }

  normalizeSelection(options, fallback) {
    const candidate = options && typeof options === 'object' && (options.provider || options.model)
      ? options : fallback
    if (typeof candidate?.provider !== 'string' || !candidate.provider.trim()
      || typeof candidate?.model !== 'string' || !candidate.model.trim()) {
      throw new Error('尚未选择可用的模型，请先完成模型配置。')
    }
    return { provider: candidate.provider.trim(), model: candidate.model.trim(),
      ...(candidate.reasoningEffort === undefined ? {} : { reasoningEffort: candidate.reasoningEffort }) }
  }

  // undefined preserves an adopted Session policy; null clears its output cap
  // and restores the model/adapter default, including inherited request headers.
  sessionPolicy(options) {
    if (options.maxTokens !== undefined && options.maxTokens !== null && (!Number.isSafeInteger(options.maxTokens) || options.maxTokens < 128 || options.maxTokens > MAX_MODEL_OUTPUT_TOKENS)) throw new Error('会话输出上限必须是 128—393216 的整数。')
    if (options.tools !== undefined && options.tools !== 'none') throw new Error('会话工具约束无效。')
    if (options.system !== undefined && (typeof options.system !== 'string' || !options.system.trim())) throw new Error('会话系统提示词不能为空。')
    return { maxTokens: options.maxTokens, tools: options.tools, system: options.system }
  }

  async restrictedPreset() {
    this.noToolsPreset ??= this.ctx.agentPresets.register({
      id: 'lwb-pack-no-tools', name: '场景纯模型会话',
      plugins: [{ id: 'compaction', name: 'cordis:group', group: true,
        isolate: { compaction: true },
        config: [{ id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' }],
      }],
    })
    await this.noToolsPreset
    return 'lwb-pack-no-tools'
  }

  installSessionPolicy(agent, selection, policy) {
    const installed = this.sessionPolicies.get(agent)
    const state = installed || { selection, policy: {} }
    state.selection = selection
    // Omitted options on a later adoption do not loosen existing constraints.
    state.policy = { ...state.policy, ...Object.fromEntries(Object.entries(policy).filter(([, value]) => value !== undefined)) }
    if (state.policy.tools === 'none' && !state.toolsRestricted) {
      agent.ctx.tools.restrict({ allow: [] })
      state.toolsRestricted = true
    }
    if (state.policy.system !== undefined && !state.systemInstalled) {
      agent.ctx.systemPrompt.section({
        name: 'lwb-pack:complete-system', order: 0, complete: true,
        interpolate: false, text: () => state.policy.system,
      })
      state.systemInstalled = true
    }
    if (installed) return
    agent.ctx.on('system-prompt/assemble', async (_, _context, next) => {
      const assembly = await next()
      return { ...assembly, variables: { ...assembly.variables, provider: state.selection.provider, model: state.selection.model } }
    }, { prepend: true })
    agent.ctx.on('agent/request', async (_, next) => {
      const resolved = await next()
      const { reasoningEffort: _inherited, ...config } = resolved
      if (state.policy.maxTokens === null) delete config.maxTokens
      return { ...config, ...state.selection,
        ...(state.policy.maxTokens == null ? {} : { maxTokens: state.policy.maxTokens }),
        ...(state.policy.tools === 'none' ? { tools: [] } : {}),
      }
    }, { prepend: true })
    this.sessionPolicies.set(agent, state)
  }

  async openSession(id, { sessionId, context, cwd, selection, policy, signal, sessions, resume }) {
    if (sessions.has(sessionId)) {
      const existing = sessions.get(sessionId)
      const agent = this.ctx.agents.get(sessionId)
      if (agent) this.installSessionPolicy(agent, selection, policy)
      return existing.public
    }
    await this.workspaces.recordSession(id, sessionId)
    const presetId = policy.tools === 'none'
      ? await this.restrictedPreset() : (await this.ctx.agentPresets.resolve('standard')).id
    signal.throwIfAborted()
    // DSH resolves a Session's location once: a resume must name the same cwd the
    // Session was created with, so the caller passes it back for both paths.
    const sessionCwd = cwd ?? context.workspacePath
    await this.ctx.sessionController.create({ sessionId, cwd: sessionCwd,
      ...(resume && policy.tools === 'none' ? {} : { agentPreset: presetId }),
    })
    // selectModel also saves the ordinary chat's global default. Restricted
    // pack Sessions route through scoped public waterfalls instead.
    if (policy.tools !== 'none') await this.ctx.sessionController.selectModel({ sessionId, ...selection })
    const agent = this.ctx.agents.get(sessionId)
    if (!agent) throw new Error(`会话 "${sessionId}" 创建后不可用。`)
    if (policy.tools === 'none' || policy.maxTokens !== undefined || policy.system !== undefined) this.installSessionPolicy(agent, selection, policy)
    this.ctx.permissionPresets.set(agent.session, 'workspace-write')
    const session = {
      public: null,
      async dispose() {
        if (sessions.get(sessionId) !== session) return
        sessions.delete(sessionId)
      },
    }
    const address = Object.freeze({ kind: 'session', sessionId })
    session.public = Object.freeze({
      id: sessionId,
      address,
      provider: selection.provider,
      model: selection.model,
      cwd: sessionCwd,
      followup: async (text) => {
        if (typeof text !== 'string' || !text.trim()) throw new Error('会话消息不能为空。')
        signal.throwIfAborted()
        return this.ctx.sessionController.prompt({
          requestId: randomUUID(), sessionId, mode: 'queue',
          content: [{ type: 'text', text: text.trim() }],
        }, signal)
      },
      whenIdle: async () => {
        const current = this.ctx.agents.get(sessionId)
        if (!current) throw new Error(`会话 "${sessionId}" 不可用。`)
        await current.whenIdle()
      },
      cancel: () => this.ctx.agents.get(sessionId)?.cancel({ kind: 'parent' }),
      dispose: () => session.dispose(),
      page: (request = {}, pageSignal = signal) => this.sessionPage(id, address, request, pageSignal),
      follow: (request = {}, followSignal = signal) => this.sessionFollow(id, address, request, followSignal),
    })
    sessions.set(sessionId, session)
    return session.public
  }

  /**
   * Record one root Session a pack created through the native Agent service.
   *
   * Ordinary conversation projections hide pack-owned Sessions, and the
   * ownership index is the host's durable record of them. A pack that creates
   * its own root Agent bypasses `sessions.create`, so without this call the
   * Session is owned only by convention and would surface in the operator's
   * history. The Agent's own cwd is the proof: only a root inside the pack
   * workspace may be adopted, so a pack can never adopt a user's Session.
   * @param id - capability pack id.
   * @param agent - live root Agent the pack created in its own workspace.
   * @returns the pack workspace projection the Agent belongs to.
   */
  async adoptSession(id, agent) {
    const context = await this.workspaces.context(id)
    if (agent?.session?.header?.cwd !== context.workspacePath) {
      throw new Error('只能登记该能力包工作区内的内部会话。')
    }
    const sessionId = typeof agent?.id === 'string' && agent.id !== '' ? agent.id
      : typeof agent?.session?.id === 'string' ? agent.session.id : ''
    if (!sessionId) throw new Error('无法确认需要登记的能力包会话标识。')
    await this.workspaces.recordSession(id, sessionId)
    return context
  }

  assertSession(id, address) {
    if (!address || address.kind !== 'session' || typeof address.sessionId !== 'string') throw new Error('能力包会话地址无效。')
    const owned = this.workspaces.visibility(id)
    return owned.then((value) => {
      if (!value.sessionIds.includes(address.sessionId)) throw new Error('该会话不属于此能力包。')
      return address
    })
  }

  async sessionPage(id, address, request, signal) {
    await this.assertSession(id, address)
    if (!this.ctx.sessionController?.page) throw new Error('当前环境不提供会话读取服务。')
    return this.ctx.sessionController.page({ ...request, address }, signal)
  }

  async *sessionFollow(id, address, request, signal) {
    await this.assertSession(id, address)
    if (!this.ctx.sessionController?.follow) throw new Error('当前环境不提供会话流服务。')
    const observing = AbortSignal.any([signal, this.forPack(id).signal])
    yield* this.ctx.sessionController.follow({ ...request, address, assistantStream: true }, observing)
  }

  /**
   * Read a pack-owned session's registered projection values without activating an
   * Agent, so a pack can record what the conversation actually did — model time,
   * token buckets, context pressure — alongside its own results.
   *
   * Only the requested keys come back: the full baseline also carries unrelated
   * projections (first-prompt text, todos, plans, permissions) that a pack has no
   * business reading, and returning them would bloat every settle-time write.
   * @param id - capability pack id.
   * @param address - pack-owned session address.
   * @param keys - projection keys to return, e.g. `['sessionStats', 'tokenUsage']`.
   * @param signal - cancellation for the projection observation.
   * @returns `{ asOfSeq, values }`, or null when the session no longer exists.
   */
  async sessionProjections(id, address, keys, signal) {
    await this.assertSession(id, address)
    if (!this.ctx.sessionController?.projections) throw new Error('当前环境不提供会话投影读取服务。')
    const baseline = await this.ctx.sessionController.projections({ sessionId: address.sessionId }, signal)
    if (!baseline) return null
    const values = baseline.values || {}
    const wanted = Array.isArray(keys) ? keys : []
    return { asOfSeq: baseline.asOfSeq, values: Object.fromEntries(wanted.filter((key) => Object.hasOwn(values, key)).map((key) => [key, values[key]])) }
  }
}
