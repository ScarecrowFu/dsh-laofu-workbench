import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { LwbModelAdapter } from '../dsh-adapter/lwb-model.mjs'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

test('LWB delegates real SSE and tool calls to the official adapter with managed credentials', async t => {
  const requests = []
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const data of req) raw += data
    requests.push({ path: req.url, key: req.headers.authorization, body: JSON.parse(raw) })
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const chunk = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'msg-1', object: 'chat.completion.chunk', created: 1, model: 'deepseek-v4.1-flash', choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
    if (requests.length === 1) { chunk({ role: 'assistant', content: '你好' }); chunk({}, 'stop') }
    else { chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{"q":"test"}' } }] }); chunk({}, 'tool_calls') }
    res.end('data: [DONE]\n\n')
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => { server.closeAllConnections(); server.close() })
  const entry = { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', available: true, supportsTools: true, supportsVision: true, contextWindow: 1000000, maxOutputTokens: 393216 }
  const client = { baseUrl: `http://127.0.0.1:${server.address().port}`, generation: 0, serviceAbort: new AbortController(), catalog: async () => ({ models: [entry] }), readSession: async () => ({ user: { id: '7' } }), assertGeneration(g) { assert.equal(g, this.generation) }, serviceCredential: async () => ({ apiKey: 'local-test-key' }), changed() {} }
  const adapter = new LwbModelAdapter(client, { get() {} })
  const advertised = (await adapter.listModels())[0]
  assert.equal(advertised.name, 'DeepSeek V4.1 Flash')
  // The catalog's own capability is advertised unchanged; only the request default is capped.
  assert.equal(advertised.maxOutputTokens, 393216)
  assert.equal(advertised.defaultMaxTokens, 32768)
  const prepared = await adapter.prepareCall('lwb', 'deepseek-v4.1-flash')
  assert.equal(prepared.model.maxOutputTokens, 393216)
  assert.equal(prepared.model.defaultMaxTokens, 32768)
  const options = { provider: 'lwb', model: 'deepseek-v4.1-flash', messages: [createUserMessage({ content: [{ type: 'text', text: '测试' }], source: { kind: 'plugin', plugin: 'test' } })] }
  const textChunks = []; for await (const chunk of prepared.stream(options)) textChunks.push(chunk)
  assert.ok(JSON.stringify(textChunks).includes('你好'), JSON.stringify(textChunks))
  assert.ok(!textChunks.some(chunk => chunk.type === 'error'), JSON.stringify(textChunks))
  const toolChunks = []; for await (const chunk of adapter.stream({ ...options, tools: [{ name: 'lookup', description: 'test lookup', parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } }] })) toolChunks.push(chunk)
  assert.ok(JSON.stringify(toolChunks).includes('lookup'), JSON.stringify(toolChunks))
  assert.ok(JSON.stringify(toolChunks).includes('call-1'), JSON.stringify(toolChunks))
  assert.equal(requests.length, 2)
  assert.equal(requests[0].path, '/api/lwb/v1/chat/completions')
  assert.equal(requests[0].key, 'Bearer local-test-key')
  assert.equal(requests[0].body.model, 'deepseek-v4.1-flash')
  // ATS freezes points against the requested cap, so the request must always name one.
  assert.equal(requests[0].body.max_tokens, 32768)
  assert.equal(requests[1].body.max_tokens, 32768)
  assert.equal(requests[1].body.tools[0].function.name, 'lookup')
  client.generation++
  await assert.rejects(async () => { for await (const _ of prepared.stream(options)) {} }, /账号已变更/)
  assert.equal(requests.length, 2)
})

test('LWB caps only the per-request output budget and honours an explicit caller cap', async t => {
  const requests = []
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const data of req) raw += data
    requests.push(JSON.parse(raw))
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(`data: ${JSON.stringify({ id: 'm', object: 'chat.completion.chunk', created: 1, model: 'x', choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }] })}\n\n`)
    res.write(`data: ${JSON.stringify({ id: 'm', object: 'chat.completion.chunk', created: 1, model: 'x', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`)
    res.end('data: [DONE]\n\n')
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => { server.closeAllConnections(); server.close() })
  const models = [
    { id: 'kimi-k3', name: 'Kimi-K3', available: true, supportsTools: true, supportsVision: true, contextWindow: 1000000, maxOutputTokens: 1048576 },
    { id: 'low-cap', name: 'Low', available: true, supportsTools: true, contextWindow: 262144, maxOutputTokens: 20000 },
    { id: 'no-cap', name: 'Unstated', available: true, supportsTools: true, contextWindow: 131072 },
  ]
  const client = { baseUrl: `http://127.0.0.1:${server.address().port}`, generation: 0, serviceAbort: new AbortController(), catalog: async () => ({ models }), readSession: async () => ({ user: { id: '7' } }), assertGeneration() {}, serviceCredential: async () => ({ apiKey: 'k' }), changed() {} }
  const adapter = new LwbModelAdapter(client, { get() {} })
  const message = createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'plugin', plugin: 'test' } })
  const byId = new Map((await adapter.listModels()).map(model => [model.id, model]))
  // The advertised capability stays the official ceiling; only the request default is bounded.
  assert.equal(byId.get('kimi-k3').maxOutputTokens, 1048576)
  assert.equal(byId.get('kimi-k3').defaultMaxTokens, 32768)
  // A model whose own capability is below the interactive cap keeps its smaller value.
  assert.equal(byId.get('low-cap').maxOutputTokens, 20000)
  assert.equal(byId.get('low-cap').defaultMaxTokens, 20000)
  // An unstated capability falls back rather than sending no cap at all.
  assert.equal(byId.get('no-cap').maxOutputTokens, 32768)
  for (const id of ['kimi-k3', 'low-cap', 'no-cap']) {
    const prepared = await adapter.prepareCall('lwb', id)
    for await (const _ of prepared.stream({ provider: 'lwb', model: id, messages: [message] })) {}
  }
  const explicit = await adapter.prepareCall('lwb', 'kimi-k3')
  for await (const _ of explicit.stream({ provider: 'lwb', model: 'kimi-k3', messages: [message], maxTokens: 131072 })) {}
  assert.deepEqual(requests.map(body => [body.model, body.max_tokens]), [
    ['kimi-k3', 32768],
    ['low-cap', 20000],
    ['no-cap', 32768],
    ['kimi-k3', 131072],
  ])
})

test('LWB retries transient provider failures instead of ending the turn', () => {
  const adapter = new LwbModelAdapter({}, { get() {} })
  const policy = adapter.providerRetryPolicy()
  // An upstream engine abort reports `SERVER`; without a retry the 500 ends the
  // whole turn, which for a task run is minutes of work thrown away.
  assert.equal(policy.mode, 'normal')
  assert.ok(policy.maxRetries > 0, 'transient failures must be retried')
  assert.ok(policy.retryableCodes.includes('SERVER'), 'an engine abort is a transient failure')
  assert.ok(policy.retryableCodes.includes('RATE_LIMIT'))
  assert.ok(policy.retryableCodes.includes('TIMEOUT'))
})
