/**
 * The default model a fresh LWB sign-in gets.
 *
 * The bug this covers: sign in, open the fish pond, adopt an egg, press 孵化 —
 * nothing happens. Nothing was configured, so `follow-dsh` resolved to an empty
 * default and the birth died waiting for a model that was never chosen.
 *
 * The rule is narrow on purpose, and each half of it is a test here:
 *
 *   - an empty selection is filled with the LWB everyday model;
 *   - a selection that already exists is never overwritten, whoever made it;
 *   - a route that lists no models is left alone rather than written blind.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { LwbAccountGateway } from '../account-gateway.mjs'
import { Context } from '../../../vendor/deepseek-harness/vendor/cordis/lib/index.js'

const FLASH = 'deepseek-v4.1-flash'

/**
 * A gateway on a host whose default model may be empty, already chosen, or absent.
 *
 * @param options.models - what `lwb` lists; an Error makes the listing fail.
 * @param options.selection - the current default, or null for "nothing chosen".
 * @param options.service - false leaves `agentDefaultModel` out of the host.
 */
async function mount({ models = [{ id: FLASH }], selection = { provider: '', model: '' }, service = true } = {}) {
  const written = []
  const ctx = new Context()
  ctx.provide('lwbAtsClient', {
    async login() { return { user: { id: 'member' } } },
    async register() { return { user: { id: 'member' } } },
    async status() { return { user: { id: 'member' }, membership: null } },
    async catalog() { return {} },
  })
  ctx.provide('lwbPackEntitlements', { invalidate() {} })
  ctx.provide('webServer', { register() { return () => {} } })
  ctx.provide('lwbTaskModel', { get: () => ({ mode: 'follow-dsh' }), selection: () => null, update: async () => {} })
  ctx.provide('llm', {
    listProviders: () => [{ id: 'lwb' }],
    async listModels(provider) {
      if (models instanceof Error) throw models
      assert.equal(provider, 'lwb', 'the default is chosen on the LWB route')
      return models
    },
  })
  if (service) {
    ctx.provide('agentDefaultModel', {
      currentSelection: () => selection,
      async saveSelection(next) { written.push(next) },
    })
  }
  await ctx.plugin(LwbAccountGateway).await()
  return { ctx, written, gateway: ctx.get('lwbAccount') }
}

test('a fresh sign-in gets the LWB everyday model when nothing is chosen', async () => {
  const { ctx, written, gateway } = await mount()
  try {
    const result = await gateway.login({ username: 'a', password: 'b' })
    assert.equal(result.user.id, 'member', 'the sign-in itself still answers with the user')
    assert.deepEqual(written, [{ provider: 'lwb', model: FLASH }])
  } finally {
    await ctx.fiber.dispose()
  }
})

test('a chosen model is never overwritten', async () => {
  const { ctx, written, gateway } = await mount({ selection: { provider: 'deepseek-account', model: 'deepseek-v4-pro' } })
  try {
    await gateway.login({ username: 'a', password: 'b' })
    assert.deepEqual(written, [], 'an operator who picked a model keeps it')
  } finally {
    await ctx.fiber.dispose()
  }
})

test('a route that lists no models is left alone rather than written blind', async () => {
  const { ctx, written, gateway } = await mount({ models: new Error('ATS is not answering') })
  try {
    await gateway.login({ username: 'a', password: 'b' })
    assert.deepEqual(written, [], 'a guess would trade one unexplained failure for another')
  } finally {
    await ctx.fiber.dispose()
  }
})

test('a missing model list falls back to the first model the route does offer', async () => {
  const { ctx, written, gateway } = await mount({ models: [{ id: 'qwen3.8-flash' }] })
  try {
    await gateway.login({ username: 'a', password: 'b' })
    assert.deepEqual(written, [{ provider: 'lwb', model: 'qwen3.8-flash' }])
  } finally {
    await ctx.fiber.dispose()
  }
})

test('a host without the default-model service can still sign in', async () => {
  const { ctx, gateway } = await mount({ service: false })
  try {
    const result = await gateway.login({ username: 'a', password: 'b' })
    assert.equal(result.user.id, 'member', 'the convenience must not become a dependency')
  } finally {
    await ctx.fiber.dispose()
  }
})
