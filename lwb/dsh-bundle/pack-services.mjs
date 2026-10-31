import { randomUUID } from 'node:crypto'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { packCredentialRef } from './pack-workspaces.mjs'
import { PackTaskScope } from './pack-task-scope.mjs'
import { openPackSettings } from './pack-settings.mjs'
import { dshPackageEntry } from './dsh-adapter/package-paths.mjs'
import { resolveBrowserExecutable } from './browser-shim.mjs'
import { browserStatus, dedicatedCommand, openDedicated } from './pack-browser.mjs'

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

/**
 * Presets a pack may name on its own Sessions.
 *
 * One entry today, deliberately. A preset is a complete child-plugin list and
 * `agentPresets.mount` rebinds rather than merges, so this can never become
 * "standard plus browser": the rows in {@link browserPreset} are the whole
 * composition of a work Session.
 */
export const PACK_PRESETS = Object.freeze({ browser: 'lwb-pack-browser' })

/**
 * What `permission` on a pack Session maps to: DSH's own permission presets,
 * the same two the conversation's access menu offers as 工作区内修改 / 完全权限.
 * Omitted keeps the historical default, `workspace-write`.
 */
export const PACK_PERMISSIONS = Object.freeze({ workspace: 'workspace-write', full: 'danger-full-access' })

/** A pack tool's name: model-facing, so short, lowercase and unambiguous. */
const PACK_TOOL_NAME = /^[a-z][a-z0-9_]{2,63}$/u

/** Longest one-line account a notice row shows unexpanded (DSH's own bound). */
const NOTICE_SUMMARY_MAX = 120

/** Channels a pack-owned Session may be prompted from outside the workbench. */
export const PACK_CHANNELS = Object.freeze(['feishu', 'qq'])

/** Browser backends a pack Session may be composed on, in preference order. */
export const PACK_BROWSER_PROVIDERS = Object.freeze(['playwright', 'chrome-devtools'])

export const PACK_BROWSER_ROWS = Object.freeze({
  playwright: '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp',
  'chrome-devtools': '@deepseek-ai/dsh-experimental-browser-use-chrome-devtools-mcp',
})

/**
 * The compaction row every pack preset carries, resolved to a file URL.
 *
 * Compaction has to survive the whole job: a work Session that drives a browser
 * for dozens of steps stops at the context window without it.
 */
const COMPACTION_ROW = Object.freeze({ id: 'compaction-basic', name: dshPackageEntry('@deepseek-ai/dsh-compaction-basic') })

/**
 * The composition a work Session runs on.
 *
 * Browser tools plus compaction: a job that drives someone's account can take
 * dozens of steps, and an uncompacted transcript stops at the context window
 * halfway through. Files, shell and search are deliberately absent — a Session
 * allowed to click through an account is not also handed the disk.
 *
 * Rows name an installed entry by file URL, not by package name. A preset is
 * mounted into an Agent tree whose resolution base is the profile directory
 * (`dsh-home/profiles/<id>`), whose node_modules holds pack links and nothing
 * else; a bare `@deepseek-ai/*` row therefore never imports there, and the
 * loader reports that as `never started` — a line that names no package and no
 * cause. Resolving once at composition time keeps the rows independent of where
 * the preset is mounted, and turns a missing dependency into an error here.
 *
 * Two backends speak the same config contract. Playwright's MCP is the default
 * because it is the one with a downloaded Chromium behind it, but its published
 * driver crashed on navigate in this build's environment (`Target crashed …
 * Assertion error`), so the choice is a parameter rather than a hard-coded row:
 * whichever backend works, the pack changes nothing.
 * @param options - provider configuration for this activation.
 * @param options.provider - `playwright` or `chrome-devtools`.
 * @param options.mode - `launch` owns its browser, `attach` borrows one over CDP.
 * @param options.headless - launch only; a headed browser is what a user watching
 *   their account being driven would actually want, so callers decide.
 * @param options.endpoint - attach only; the CDP URL of the running browser.
 * @param options.executablePath - launch only; a Chromium binary to use instead
 *   of the one the backend would pick.
 * @returns a preset definition, ready for `agentPresets.register`.
 */
export function browserPreset({ provider = 'playwright', mode = 'launch', headless = true, endpoint, executablePath } = {}) {
  if (!Object.hasOwn(PACK_BROWSER_ROWS, provider)) throw new Error('浏览器后端无效。')
  if (mode !== 'launch' && mode !== 'attach') throw new Error('浏览器会话模式无效。')
  const attached = mode === 'attach'
  if (attached && (typeof endpoint !== 'string' || !endpoint.trim())) throw new Error('附加模式需要浏览器调试端点。')
  const binary = !attached && typeof executablePath === 'string' && executablePath.trim() ? executablePath.trim() : ''
  return {
    id: PACK_PRESETS.browser,
    name: '场景浏览器会话',
    description: '只带浏览器工具与自动压缩，供能力包执行网页任务。',
    plugins: [
      { id: 'compaction', name: 'cordis:group', group: true, isolate: { compaction: true },
        config: [COMPACTION_ROW] },
      /*
       * Both browser rows share one `browserUse` realm: the registry is a
       * singleton a provider registers into, and a preset is mounted into the
       * root realm, so publishing it there is what `mountPreset` refuses as a
       * service leak. The group keeps the registration inside the Session.
       */
      { id: 'browser', name: 'cordis:group', group: true, isolate: { browserUse: true },
        config: [
          { id: 'browser-use', name: dshPackageEntry('@deepseek-ai/dsh-browser-use') },
          {
            id: `browser-${provider}`,
            name: dshPackageEntry(PACK_BROWSER_ROWS[provider]),
            config: {
              mode,
              headless,
              ...(attached ? { endpoint: endpoint.trim() } : {}),
              ...(binary ? { executablePath: binary } : {}),
            },
          },
        ] },
    ],
  }
}

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
  constructor(ctx, workspaces, { account, taskModel, entitlements } = {}) {
    this.ctx = ctx; this.workspaces = workspaces; this.scopes = new Map(); this.account = account; this.taskModel = taskModel; this.entitlements = entitlements
    this.sessionPolicies = new WeakMap(); this.packPresets = new Map()
    /**
     * What each pack Session was opened with, by Session id.
     *
     * A Session's Agent is not permanent: the host disposes and restores it
     * (a scheduled delivery wakes a cold Session, the conversation page
     * retains one). Everything installed on an Agent — system prompt, tools —
     * dies with it, so the options live here and are reapplied to whichever
     * Agent next publishes that Session.
     */
    this.sessionSpecs = new Map()
    /** Tools installed on one Agent, so a reapplication does not register twice. */
    this.agentTools = new WeakMap()
    /** Per pack: how to reopen a Session this process has not opened yet, and who hears its status. */
    this.restorers = new Map()
    this.statusListeners = new Map()
  }

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
      withAgent: (operation, signal = tasks.signal, options = {}) => tasks.track(this.withAgent(id, operation, AbortSignal.any([signal, tasks.signal]), options)),
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
        // A channel message is not the owner typing here: it keeps its own sender
        // identity in the durable source, so retries and "she was offline then"
        // stay answerable. Delivery belongs to the pack; this only admits one message.
        inbound: (sessionId, message) => tasks.track(this.inboundSession(id, sessionId, message, tasks.signal)),
        // Something that happened, told to the Session: a finished task, a line
        // said in her own time. Not the owner typing, and not a channel message.
        notice: (sessionId, notice) => tasks.track(this.noticeSession(id, sessionId, notice, tasks.signal)),
        // Options for a Session the host restores before this pack reopened it,
        // e.g. a scheduled delivery to a cold Session after a restart.
        restore: (handler) => {
          if (typeof handler !== 'function') throw new Error('会话恢复回调无效。')
          this.restorers.set(id, handler)
          this.watchAgents()
          return () => { if (this.restorers.get(id) === handler) this.restorers.delete(id) }
        },
        // `{ sessionId, status: 'running' | 'idle' }` for this pack's Sessions only.
        onStatus: (listener) => {
          if (typeof listener !== 'function') throw new Error('会话状态回调无效。')
          if (!this.statusListeners.has(id)) this.statusListeners.set(id, new Set())
          this.statusListeners.get(id).add(listener)
          this.watchAgents()
          return () => this.statusListeners.get(id)?.delete(listener)
        },
      }),
      // The browser a pack character drives on the owner's behalf: the owner's
      // ego lite when installed, else a dedicated Chrome/Edge profile kept in a
      // directory this pack owns. See pack-browser.mjs for why it is a script.
      browser: Object.freeze({
        status: () => browserStatus(),
        dedicated: async (dir) => {
          const path = await this.workspaces.ownedDirectory(id, dir)
          return { dir: path, command: dedicatedCommand(path) }
        },
        open: async (dir, url) => openDedicated(await this.workspaces.ownedDirectory(id, dir), typeof url === 'string' && /^https?:\/\//u.test(url) ? url : 'about:blank'),
      }),
      // DSH's durable timer, bound to this pack's own Sessions. Delivery is a
      // message into the bound Session, which the host restores when cold.
      schedule: Object.freeze({
        create: (sessionId, request) => this.scheduleCall(id, sessionId, (service) => service.create(sessionId, request, tasks.signal)),
        list: (sessionId) => this.scheduleCall(id, sessionId, (service) => service.list({ sessionId })),
        update: (request) => this.scheduleCall(id, request?.sessionId, (service) => service.update(request, tasks.signal)),
        delete: (sessionId, scheduleId) => this.scheduleCall(id, sessionId, (service) => service.delete({ sessionId, id: scheduleId }, tasks.signal)),
        history: (sessionId, scheduleId, limit = 20) => this.scheduleCall(id, sessionId, (service) => service.history({ sessionId, id: scheduleId, limit })),
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
      this.restorers.delete(id)
      this.statusListeners.delete(id)
      // Tools close over this pack's code; an Agent that outlives the unload
      // (a conversation page still open) must not keep calling into it.
      for (const [sessionId, spec] of [...this.sessionSpecs]) {
        if (spec.packId !== id) continue
        this.sessionSpecs.delete(sessionId)
        const agent = this.ctx.agents?.get?.(sessionId)
        const installed = agent && this.agentTools.get(agent)
        if (installed) { for (const dispose of installed) { try { dispose() } catch { /* already gone */ } } this.agentTools.delete(agent) }
      }
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

  /**
   * Run one pack-owned operation on a fresh internal Agent.
   *
   * The Agent is a root in the pack workspace, recorded as pack-owned so it
   * stays out of ordinary conversation history, and disposed when the operation
   * settles. `options.agentOptions` lets a caller preserve the route captured by
   * an outer task (for example an unattended round); omission uses the scene
   * task default. `options.presetId` is the tool/persona composition to mount.
   *
   * @param id - capability pack id.
   * @param operation - receives the published Agent and returns the task result.
   * @param signal - caller cancellation, combined with the pack lifetime.
   * @param options - optional route and preset overrides.
   * @returns the operation result after the internal Agent is disposed.
   */
  async withAgent(id, operation, signal, options = {}) {
    signal.throwIfAborted()
    const scope = this.forPack(id)
    const context = await scope.context()
    const candidate = options.agentOptions ?? this.defaultSelection()
    const selection = typeof candidate?.provider === 'string' && candidate.provider.trim()
      && typeof candidate?.model === 'string' && candidate.model.trim()
      ? { provider: candidate.provider.trim(), model: candidate.model.trim(),
        ...(candidate.reasoningEffort === undefined ? {} : { reasoningEffort: candidate.reasoningEffort }) }
      : null
    if (!selection) throw new Error('尚未选择场景任务模型，请在“设置 → 场景任务默认模型”中完成配置。')
    const preset = await this.ctx.agentPresets.resolve(options.presetId ?? 'standard')
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
    // A named preset replaces the tool set wholesale, so pairing it with the
    // empty-tool constraint would be two contradictory instructions.
    if (options.preset !== undefined) {
      if (options.tools === 'none') throw new Error('会话不能同时指定 preset 与 tools: none。')
      if (!Object.hasOwn(PACK_PRESETS, options.preset)) throw new Error('能力包会话预设无效。')
    }
    if (options.permission !== undefined && !Object.hasOwn(PACK_PERMISSIONS, options.permission)) throw new Error('会话权限无效。')
    const addTools = options.addTools === undefined ? undefined : this.packToolSpecs(options.addTools)
    if (addTools?.length && options.tools === 'none') throw new Error('会话不能同时指定 tools: none 与 addTools。')
    if (options.denyTools !== undefined && (!Array.isArray(options.denyTools) || options.denyTools.some((name) => typeof name !== 'string' || !name))) throw new Error('会话屏蔽工具清单无效。')
    return { maxTokens: options.maxTokens, tools: options.tools, system: options.system, preset: options.preset,
      permission: options.permission, addTools, denyTools: options.denyTools }
  }

  /**
   * Validate the tools a pack hands to one of its Sessions.
   *
   * A pack passes plain descriptions and the host wraps them, so a pack does
   * not depend on `@deepseek-ai/dsh-tools` and every pack tool answers the same
   * way: the returned value as JSON text.
   * @param list - `{ name, description, parameters, execute(args, { sessionId }) }[]`.
   * @returns the same list, checked.
   */
  packToolSpecs(list) {
    if (!Array.isArray(list)) throw new Error('会话工具清单无效。')
    const names = new Set()
    for (const spec of list) {
      if (!spec || typeof spec !== 'object') throw new Error('会话工具定义无效。')
      if (typeof spec.name !== 'string' || !PACK_TOOL_NAME.test(spec.name)) throw new Error(`会话工具名无效：${spec?.name}`)
      if (names.has(spec.name)) throw new Error(`会话工具重名：${spec.name}`)
      names.add(spec.name)
      if (typeof spec.description !== 'string' || !spec.description.trim()) throw new Error(`会话工具 ${spec.name} 缺少说明。`)
      if (spec.parameters !== undefined && (typeof spec.parameters !== 'object' || spec.parameters === null)) throw new Error(`会话工具 ${spec.name} 的参数无效。`)
      if (typeof spec.execute !== 'function') throw new Error(`会话工具 ${spec.name} 缺少执行函数。`)
    }
    return list
  }

  /** `@deepseek-ai/dsh-tools`, loaded once from the DSH installation. */
  async toolKit() {
    this.toolKitModule ??= import(dshPackageEntry('@deepseek-ai/dsh-tools'))
    return this.toolKitModule
  }

  /**
   * Install the pack's tools on one Agent, once.
   *
   * Scoped to the Agent, not global: a pack tool must exist only in the
   * Sessions that asked for it, never in the user's ordinary conversations.
   * The deny list is best effort — a name the composition does not carry is
   * not an error worth refusing the Session over.
   */
  async installPackTools(agent, policy) {
    if (this.agentTools.has(agent) || (!policy.addTools?.length && !policy.denyTools?.length)) return
    const disposers = []
    this.agentTools.set(agent, disposers)
    const { defineTool } = await this.toolKit()
    for (const spec of policy.addTools || []) {
      disposers.push(agent.ctx.tools.register(defineTool({
        name: spec.name,
        description: spec.description,
        parameters: spec.parameters || {},
        output: {
          schema: { type: 'object', additionalProperties: true },
          render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value ?? null) }],
        },
        execute: (args, exec) => spec.execute(args, { sessionId: exec?.agent?.id ?? agent.id, signal: exec?.signal }),
        presentCall: () => ({ card: 'generic', title: spec.title || spec.description.split(/[。\n]/u)[0], kind: 'execute' }),
      })))
    }
    if (policy.denyTools?.length) {
      try { disposers.push(agent.ctx.tools.restrict({ deny: policy.denyTools })) } catch { /* see above */ }
    }
  }

  /**
   * Everything a pack Session is opened with, put on its current Agent.
   *
   * Idempotent per Agent: the first open, a later reopen and a restore after
   * the host disposed the Agent all go through here.
   */
  async applySession(agent, selection, policy) {
    if (policy.tools === 'none' || policy.maxTokens !== undefined || policy.system !== undefined) this.installSessionPolicy(agent, selection, policy)
    this.ctx.permissionPresets.set(agent.session, PACK_PERMISSIONS[policy.permission] || PACK_PERMISSIONS.workspace)
    await this.installPackTools(agent, policy)
  }

  /**
   * Listen once for Agents publishing a pack Session.
   *
   * `agent/created` is awaited before the Agent takes its first queued input,
   * so a scheduled message delivered to a cold Session runs with the pack's
   * prompt and tools — not with the bare preset.
   */
  watchAgents() {
    if (this.watching || typeof this.ctx.on !== 'function') return
    this.watching = true
    this.ctx.on('agent/created', async ({ agent }) => {
      try {
        let spec = this.sessionSpecs.get(agent.id)
        if (!spec) spec = await this.restoredSpec(agent.id)
        if (spec) await this.applySession(agent, spec.selection, spec.policy)
      } catch (error) {
        this.ctx.logger?.warn?.(`lwb pack session ${agent.id}: ${error?.message || error}`)
      }
      return undefined
    })
    this.ctx.on('agent/status', ({ agent, status }) => {
      const spec = this.sessionSpecs.get(agent.id)
      if (!spec) return
      for (const listener of this.statusListeners.get(spec.packId) || []) {
        try { listener({ sessionId: agent.id, status }) } catch { /* one listener does not silence the others */ }
      }
    })
  }

  /** Ask the owning pack how to reopen a Session nothing in this process opened. */
  async restoredSpec(sessionId) {
    for (const [packId, handler] of this.restorers) {
      const owned = await this.workspaces.visibility(packId).catch(() => null)
      if (!owned?.sessionIds.includes(sessionId)) continue
      const options = await handler(sessionId)
      if (!options) return null
      const spec = { packId, selection: this.normalizeSelection(options, this.defaultSelection()), policy: this.sessionPolicy(options) }
      this.sessionSpecs.set(sessionId, spec)
      return spec
    }
    return null
  }

  async restrictedPreset() {
    this.noToolsPreset ??= this.ctx.agentPresets.register({
      id: 'lwb-pack-no-tools', name: '场景纯模型会话',
      plugins: [{ id: 'compaction', name: 'cordis:group', group: true,
        isolate: { compaction: true },
        config: [COMPACTION_ROW],
      }],
    }).catch((error) => {
      /*
       * "Duplicate agent preset" is not this Session's problem: the registry is
       * process-wide and outlives this service, so a second instance (a
       * remounted pack, a reloaded bundle) finds the id already there. Treating
       * that as a failure used to take every conversation in every pack down
       * with it — the drawer showed the raw error and would not open — and
       * because the rejected promise stayed in the cache the outage lasted
       * until the process restarted. The id is what the caller needs, and it
       * exists either way.
       */
      if (!/duplicate/iu.test(String(error?.message ?? error))) throw error
      return this.ctx.agentPresets.resolve('lwb-pack-no-tools')
    })
    await this.noToolsPreset
    return 'lwb-pack-no-tools'
  }

  /**
   * Register the pack's own preset once per process and hand back its id.
   *
   * `agentPresets.register` rejects a duplicate id and the registry spans every
   * pack, so the promise lives on the service rather than on one facade. A
   * failed activation is dropped from the cache: the next caller retries
   * instead of inheriting one bad answer forever.
   * @param name - a key of {@link PACK_PRESETS}.
   * @returns the preset id a Session may be created with.
   */
  async packPreset(name) {
    const id = PACK_PRESETS[name]
    if (!this.packPresets.has(name)) {
      /*
       * The browser a packaged build can drive is not one this code can guess,
       * so both knobs stay environment-only and both say so in their name.
       *
       * `LWB_BROWSER_PROVIDER` picks the backend. `LWB_BROWSER_EXECUTABLE` is
       * resolved rather than read: unset means "the packaged Chromium, behind a
       * shim that turns its sandbox off", because the mounted MCP provider
       * launches with the sandbox on and that sandbox does not come up from a
       * child process here — see {@link resolveBrowserExecutable}. An explicit
       * value still wins untouched.
       */
      const executablePath = resolveBrowserExecutable()
      const provider = process.env['LWB_BROWSER_PROVIDER'] || 'playwright'
      const pending = this.ctx.agentPresets.register(browserPreset({ provider, executablePath })).then(dispose => ({ id, dispose }))
      pending.catch(() => this.packPresets.delete(name))
      this.packPresets.set(name, pending)
    }
    return (await this.packPresets.get(name)).id
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

  /**
   * The live Agent of a stored Session, resumed from disk when needed.
   *
   * `sessionController.create` reuses only blank Sessions: one that has started a
   * turn is left alone and a new identity is minted, so resuming through it loses
   * every conversation that ever had a reply. `resolveAgent` is the resume path.
   * @returns the Agent, or null when no Session is stored under this identity.
   */
  async storedAgent(sessionId, cwd) {
    const found = await this.ctx.sessionController.resolveAgent(sessionId)
    if ('error' in found) {
      if (found.error?.code === 'session/not-found') return null
      throw found.error
    }
    if (found.agent.session.header.cwd !== cwd) throw new Error(`会话 "${sessionId}" 属于另一个工作目录，不能在这里恢复。`)
    return found.agent
  }

  async openSession(id, { sessionId, context, cwd, selection, policy, signal, sessions, resume }) {
    if (sessions.has(sessionId)) {
      const existing = sessions.get(sessionId)
      const spec = this.sessionSpecs.get(sessionId)
      const merged = { ...spec?.policy, ...Object.fromEntries(Object.entries(policy).filter(([, value]) => value !== undefined)) }
      this.sessionSpecs.set(sessionId, { packId: id, selection, policy: merged })
      const agent = this.ctx.agents.get(sessionId)
      if (agent) await this.applySession(agent, selection, merged)
      return existing.public
    }
    await this.workspaces.recordSession(id, sessionId)
    // Sessions written by an older build were opened on the no-tools preset,
    // and that preset is registered lazily. A pack that stops asking for it —
    // because it now wants real tools — would leave every old Session
    // unresolvable ("Unknown agent preset"). Register it on every resume: one
    // idempotent registration keeps existing conversations openable.
    if (resume) await this.restrictedPreset()
    const presetId = policy.tools === 'none'
      ? await this.restrictedPreset()
      : policy.preset
        ? await this.packPreset(policy.preset)
        : (await this.ctx.agentPresets.resolve('standard')).id
    signal.throwIfAborted()
    // DSH resolves a Session's location once: a resume must name the same cwd the
    // Session was created with, so the caller passes it back for both paths.
    const sessionCwd = cwd ?? context.workspacePath
    const stored = resume ? await this.storedAgent(sessionId, sessionCwd) : null
    if (!stored) {
      await this.ctx.sessionController.create({ sessionId, cwd: sessionCwd,
        ...(resume && policy.tools === 'none' ? {} : { agentPreset: presetId }),
      })
    }
    // selectModel also saves the ordinary chat's global default. Restricted
    // pack Sessions route through scoped public waterfalls instead.
    if (policy.tools !== 'none') await this.ctx.sessionController.selectModel({ sessionId, ...selection })
    const agent = this.ctx.agents.get(sessionId)
    if (!agent) throw new Error(`会话 "${sessionId}" 创建后不可用。`)
    this.sessionSpecs.set(sessionId, { packId: id, selection, policy })
    if (policy.addTools?.length || policy.denyTools?.length) this.watchAgents()
    await this.applySession(agent, selection, policy)
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

  /**
   * Admit one externally delivered message into an existing pack-owned Session.
   *
   * `SessionController.prompt` stamps every accepted message as `user-rpc`, which
   * would claim the owner typed it in the workbench. A channel needs the durable
   * source instead: retry identity, plus the difference between "she ignored it"
   * and "she was offline". So the message is built here and handed to the live
   * Agent, with the same admission order as the official path.
   *
   * Text only. Attachments arrive through the browser composer's upload receipts,
   * which a channel has no equivalent of; an adapter that wants them must land
   * them in the pack workspace first.
   * @param id - capability pack id.
   * @param sessionId - a Session this pack owns.
   * @param message - text plus the channel identity it arrived on.
   * @param signal - pack lifetime cancellation.
   * @returns `{ accepted: true }` once the Agent queued the message.
   */
  async inboundSession(id, sessionId, message, signal) {
    signal.throwIfAborted()
    const owned = await this.workspaces.visibility(id)
    if (!owned.sessionIds.includes(sessionId)) throw new Error('该会话不属于此能力包。')
    const text = typeof message?.text === 'string' ? message.text.trim() : ''
    if (!text) throw new Error('消息不能为空。')
    const channel = typeof message?.channel === 'string' ? message.channel.trim() : ''
    if (!PACK_CHANNELS.includes(channel)) throw new Error('消息渠道无效。')
    const agent = this.ctx.agents.get(sessionId)
    if (!agent) throw new Error('这个会话还没就绪，先在能力包里打开它。')
    signal.throwIfAborted()
    agent.followup(createUserMessage({
      content: [{ type: 'text', text }],
      source: {
        // The owner, typing on another device: `user`, so the conversation
        // surface shows it as their own message rather than as a collapsed
        // "request" row. The channel rides inside the source, which keeps
        // retries and "she was offline then" answerable.
        kind: 'user',
        channel,
        externalId: typeof message.externalId === 'string' ? message.externalId : '',
        ...(typeof message.messageId === 'string' ? { messageId: message.messageId } : {}),
      },
    }))
    return { accepted: true }
  }

  /**
   * Tell a pack Session about something that happened outside it.
   *
   * A `notice` is DSH's own form for this: a one-line account shown without
   * expanding, never mistaken for the owner typing. `wake` (the default)
   * starts a turn so the Session answers it in its own words; `wake: false`
   * leaves it for the next turn. A cold Session is restored first, so a
   * report can land while nobody has the conversation open.
   * @param id - capability pack id.
   * @param sessionId - a Session this pack owns.
   * @param notice - `{ text, summary?, wake? }`.
   * @param signal - pack lifetime cancellation.
   * @returns `{ accepted: true, messageId }`.
   */
  async noticeSession(id, sessionId, notice, signal) {
    signal.throwIfAborted()
    const owned = await this.workspaces.visibility(id)
    if (!owned.sessionIds.includes(sessionId)) throw new Error('该会话不属于此能力包。')
    const text = typeof notice?.text === 'string' ? notice.text.trim() : ''
    if (!text) throw new Error('通知不能为空。')
    const line = (typeof notice.summary === 'string' && notice.summary.trim() ? notice.summary.trim() : text.split('\n')[0]).replace(/\s+/gu, ' ')
    const summary = line.length <= NOTICE_SUMMARY_MAX ? line : `${line.slice(0, NOTICE_SUMMARY_MAX - 1)}…`
    let agent = this.ctx.agents.get(sessionId)
    if (!agent) {
      const found = await this.ctx.sessionController.resolveAgent(sessionId)
      if ('error' in found) throw found.error
      agent = found.agent
    }
    signal.throwIfAborted()
    const message = createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'lwb', form: 'notice', summary } })
    if (notice.wake === false) agent.inject(message)
    else agent.followup(message)
    return { accepted: true, messageId: message.id }
  }

  /** Run one schedule operation on a Session this pack owns. */
  async scheduleCall(id, sessionId, operation) {
    if (typeof sessionId !== 'string' || !sessionId) throw new Error('定时任务需要绑定会话。')
    const owned = await this.workspaces.visibility(id)
    if (!owned.sessionIds.includes(sessionId)) throw new Error('该会话不属于此能力包。')
    const service = this.ctx.get?.('schedule') ?? this.ctx.schedule
    if (!service) throw new Error('当前环境不提供定时服务。')
    return operation(service)
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
