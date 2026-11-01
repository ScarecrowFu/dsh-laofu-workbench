import { LlmAdapter, LlmError, resolveImageAttachmentAccess, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'

// Use published DSH/pi-ai APIs. No upstream files or user provider settings are edited.
const ROUTE = 'lwb'
// The output budget one request asks for. The catalog's `maxOutputTokens` stays the
// model's real capability (ATS reports the official ceiling and asks clients to send
// their own `max_tokens`); this only bounds what a single turn requests. That matters
// for cost: ATS freezes points against the requested cap, so omitting it would freeze
// against the full official ceiling — for Kimi-K3 that is ~105 million points.
const INTERACTIVE_MAX_TOKENS = 32768
// Transient provider failures are retried, the way every other DSH provider route
// already is; the framework default is 5 attempts with 500ms→10s backoff, which is
// too patient for a turn a person is watching, so two. `SERVER` is in the default
// retryable set and is exactly what an upstream engine abort reports: a single one
// ended a 163-step, 28-minute task run with nothing to show for it. ATS settles on
// reported usage, and that attempt reported none, so retrying it costs nothing —
// only a failure after partial output is paid for twice, which two attempts bounds.
const retryPolicy = resolveRetryPolicy({ mode: 'normal', maxRetries: 2 }, 'LWB')
/** The model's own output capability, as advertised by the ATS catalog. */
const modelMaxOutputTokens = item => {
  const declared = Number.isInteger(item?.maxOutputTokens) ? item.maxOutputTokens
    : Number.isInteger(item?.maxTokens) ? item.maxTokens
    : undefined
  return declared !== undefined && declared > 0 ? declared : INTERACTIVE_MAX_TOKENS
}
/** The per-request cap this client sends, never above the model's own capability. */
const requestMaxTokens = item => Math.min(modelMaxOutputTokens(item), INTERACTIVE_MAX_TOKENS)

export class LwbModelAdapter extends LlmAdapter {
  constructor(client, ctx) { super(); this.client = client; this.ctx = ctx }
  providerInfo() { return { id: ROUTE, name: 'LWB 模型服务' } }
  providerRetryPolicy() { return retryPolicy }
  async listModels() {
    if (!await this.client.readSession()) return []
    return (await this.client.catalog()).models.filter(item => item.available).map(item => this.info(item))
  }
  info(item) {
    return { provider: ROUTE, id: item.id, name: item.name, inputModalities: item.supportsVision ? ['text', 'image'] : ['text'], context: { contextWindow: item.contextWindow }, maxOutputTokens: modelMaxOutputTokens(item), defaultMaxTokens: requestMaxTokens(item) }
  }
  async resolveModel(provider, model) {
    if (provider !== ROUTE) throw new LlmError('无效的 LWB 模型来源。', 'NO_ADAPTER')
    const item = (await this.client.catalog()).models.find(value => value.id === model)
    if (!item?.available) throw new LlmError(item?.reason || 'LWB 模型暂不可用。', 'UNKNOWN_MODEL')
    return this.info(item)
  }
  async prepareCall(provider, model) {
    const generation = this.client.generation
    const info = await this.resolveModel(provider, model)
    this.client.assertGeneration(generation)
    return { model: info, stream: options => this.streamBound(options, generation) }
  }
  stream(options) { return this.streamBound(options, this.client.generation) }
  async *streamBound(options, generation) {
    const assertCurrent = () => { if (generation !== this.client.generation) throw new LlmError('LWB 账号已变更，请重新发起请求。', 'MISSING_CREDENTIAL') }
    assertCurrent()
    const catalog = await this.client.catalog()
    const item = catalog.models.find(entry => entry.id === options.model)
    if (!item?.available) throw new LlmError(item?.reason || 'LWB 模型暂不可用。', 'UNKNOWN_MODEL')
    if (options.tools?.length && !item.supportsTools) throw new LlmError('该 LWB 档位尚未开放工具调用，请先在 ATS 配置模型能力。', 'UNSUPPORTED_OPTION')
    const credential = await this.client.serviceCredential()
    assertCurrent()
    const baseUrl = `${this.client.baseUrl}/api/lwb/v1`
    // pi-ai sizes the model with the real ceiling; the request default is what this
    // client actually asks for, so ATS reserves points against the smaller number.
    const modelMaxTokens = modelMaxOutputTokens(item)
    const maxTokens = requestMaxTokens(item)
    const model = { id: item.id, name: item.name, api: 'openai-completions', provider: ROUTE, baseUrl, reasoning: false, input: item.supportsVision ? ['text', 'image'] : ['text'], contextWindow: item.contextWindow, maxTokens: modelMaxTokens, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: 'max_tokens' } }
    const api = openAICompletionsApi()
    const piProvider = { id: ROUTE, name: 'LWB 模型服务', baseUrl, auth: { apiKey: { name: 'LWB', resolve: async ({ credential: key }) => ({ auth: { apiKey: key?.key }, source: 'LWB' }) } }, getModels: () => [model], stream: (...args) => api.stream(...args), streamSimple: (...args) => api.streamSimple(...args) }
    const profiles = new Map([[ROUTE, { provider: ROUTE, displayName: 'LWB 模型服务', api: 'openai-completions', baseURL: baseUrl, streamIdleTimeoutMs: 90000, maxRequestImageBytes: 20 * 1024 * 1024, requestImagePixelBudget: 20000000, requestImageMaxBytes: 10 * 1024 * 1024, retryPolicy, piProvider, modelErrors: new Map(), configuredMaxTokens: new Map([[item.id, maxTokens]]) }]])
    const adapter = new PiAiAdapter({
      profiles: () => profiles,
      resolveApiKey: async () => { assertCurrent(); return credential.apiKey },
      auth: { credentials: { get: async () => undefined, list: async () => [], set: async () => { throw new Error('LWB 凭据由宿主管理。') }, delete: async () => {} }, authContext: { getEnv: () => undefined } },
      resolveAttachments: () => this.ctx.get('attachments'),
      resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(attachments, hostPath => this.ctx.get('fs')?.processPathFromHostPath(hostPath), ref),
    })
    const signal = options.signal ? AbortSignal.any([options.signal, this.client.serviceAbort.signal]) : this.client.serviceAbort.signal
    // DSH's call layer injects `defaultMaxTokens` and enforces it through the prepared
    // config, but a direct dispatch would otherwise fall back to the model's full
    // capability. ATS freezes points against whatever cap the request names, so a
    // request that names none would freeze against the official ceiling (Kimi-K3:
    // ~105 million points). Only fill the gap; an explicit caller cap is respected.
    const request = Number.isInteger(options.maxTokens) && options.maxTokens > 0 ? options : { ...options, maxTokens }
    try {
      for await (const chunk of adapter.stream({ ...request, signal })) {
        if (chunk.type === 'finish' && chunk.reason?.failure?.code === 'AUTH') await this.client.discardServiceCredential(generation)
        yield chunk
      }
    } finally { this.client.changed('usage') }
  }
}

export function registerLwbModels(ctx, client) {
  const adapter = new LwbModelAdapter(client, ctx)
  ctx.llm.registerAdapter([ROUTE], adapter)
  ctx.effect(() => client.subscribe(kind => { if (kind === 'account' || kind === 'catalog') ctx.emit('llm/adapters-updated') }), 'lwb-model: account changes')
  return adapter
}
