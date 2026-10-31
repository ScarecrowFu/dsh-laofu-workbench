import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

/**
 * Start-up must never leave the browser holding an open request.
 *
 * The reported failure was a workbench whose page loaded and whose console was
 * empty, because `lwbPacks/list`, `lwbAccount/status` and `lwbUpdate/state` were
 * still pending: the bundle was waiting on its pack group and had not registered
 * the gateways yet. These tests pin the three guarantees that fix it — the group
 * wait is bounded, restoration is reported instead of awaited forever, and an
 * empty catalog can be told apart from a finished one.
 */

function groupContext({ activate }) {
  const warnings = []
  const ctx = {
    loader: { builtins: { group: function Group() {} } },
    plugin: () => ({ await: typeof activate === 'function' ? activate : () => Promise.resolve() }),
    fiber: { entry: {} },
    logger: { warn: (message) => warnings.push(String(message)) },
  }
  return { ctx, warnings }
}

test('a pack group that never activates is abandoned instead of blocking the bundle', async () => {
  const { createPackGroup } = await import('../dsh-adapter/loader.mjs')
  const { ctx, warnings } = groupContext({ activate: () => new Promise(() => {}) })
  const startedAt = Date.now()
  const group = await createPackGroup(ctx, { timeoutMs: 20 })
  assert.equal(group, undefined)
  assert.ok(Date.now() - startedAt < 2_000, 'the wait must be bounded by the timeout')
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /pack group did not activate within 20 ms/u)
})

test('an activated group is still used when it arrives in time', async () => {
  const { createPackGroup } = await import('../dsh-adapter/loader.mjs')
  const { ctx, warnings } = groupContext({ activate: () => Promise.resolve() })
  const subgroup = { create: () => {} }
  ctx.fiber.entry = { subgroup }
  assert.equal(await createPackGroup(ctx, { timeoutMs: 20 }), subgroup)
  assert.deepEqual(warnings, [])
})

test('restoration is armed before it starts, so an empty catalog reads as "loading"', async () => {
  const { restoreEnabledPacks } = await import('../dsh-adapter/loader.mjs')
  const runtime = { armed: false, restored: false, arm() { this.armed = true }, setStartupRestore() {} }
  const ctx = { on: () => {}, inject: () => ({ await: async () => {} }), fiber: { state: 0 } }
  restoreEnabledPacks(ctx, runtime)
  assert.equal(runtime.armed, true)
  assert.equal(runtime.restored, false)
})

test('settle gives up on a stuck restoration instead of inheriting it', async () => {
  const { LwbPackRuntime } = await import('../pack-runtime.mjs')
  const runtime = new LwbPackRuntime({ lwbPackRegistry: { list: () => [] }, logger: {} }, { driver: {} })
  runtime.setStartupRestore(new Promise(() => {}))
  assert.equal(runtime.status().restoring, true, 'a pending restoration must be reported as restoring')
  const startedAt = Date.now()
  await runtime.settle(30)
  assert.ok(Date.now() - startedAt < 2_000, 'settle must resolve on its own deadline')
  assert.equal(runtime.status().restoring, true, 'giving up on the wait must not rewrite the host state')
})

test('a runtime that has not restored yet reports "loading", never "nothing installed"', async () => {
  const { LwbPackRuntime } = await import('../pack-runtime.mjs')
  const runtime = new LwbPackRuntime({ lwbPackRegistry: { list: () => [] }, logger: {} }, { driver: {} })
  // The web server answers before the bundle finishes applying, so the first
  // catalog read of a just-opened page lands here. Reporting `armed:false` made
  // the page offer an empty install that nothing ever re-read.
  const status = runtime.status()
  assert.equal(status.armed, true)
  assert.equal(status.started, false)
  assert.deepEqual(status.failed, [])
})

test('a stuck pack mount fails with a reason instead of holding restoration open', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'lwb-startup-guard-'))
  const previousRegistry = process.env.LWB_PACK_REGISTRY
  const previousHome = process.env.LWB_DSH_HOME
  process.env.LWB_PACK_REGISTRY = join(temporary, 'packs.json')
  process.env.LWB_DSH_HOME = join(temporary, 'dsh-home')
  t.after(async () => {
    if (previousRegistry === undefined) delete process.env.LWB_PACK_REGISTRY
    else process.env.LWB_PACK_REGISTRY = previousRegistry
    if (previousHome === undefined) delete process.env.LWB_DSH_HOME
    else process.env.LWB_DSH_HOME = previousHome
    await rm(temporary, { recursive: true, force: true })
  })

  const id = 'stuck-pack'
  const source = join(temporary, id)
  await mkdir(source, { recursive: true })
  await writeFile(join(source, 'lwb-pack.json'), `${JSON.stringify({
    schemaVersion: 1,
    id,
    packageName: '@example/lwb-stuck-pack',
    name: id,
    version: '0.1.0',
    description: 'a pack that never finishes mounting',
    menus: [{ id: 'home', label: 'Home', glyph: 'H', tone: 'blue' }],
  })}\n`)
  await writeFile(join(source, 'package.json'), `${JSON.stringify({
    name: '@example/lwb-stuck-pack',
    version: '0.1.0',
    type: 'module',
    exports: { '.': './index.mjs', './client': './client.js' },
    dsh: { client: { platform: 'web' } },
  })}\n`)
  await writeFile(join(source, 'index.mjs'), 'export function apply() {}\n')
  await writeFile(join(source, 'client.js'), 'export const apply = () => {}\n')

  const tag = `${Date.now()}-${Math.random()}`
  const manager = await import(`../../pack-manager.mjs?guard=${tag}`)
  const { LwbPackRuntime } = await import(`../pack-runtime.mjs?guard=${tag}`)
  await manager.installLwbPack(source, { enabled: true })

  const errors = []
  const runtime = new LwbPackRuntime({
    lwbPackRegistry: { list: () => [] },
    logger: { info: () => {}, error: (value) => errors.push(String(value)) },
  }, { driver: {}, mountTimeoutMs: 40 })
  runtime.mount = () => new Promise(() => {})

  const startedAt = Date.now()
  const restored = await runtime.restore()
  assert.ok(Date.now() - startedAt < 5_000, 'restoration must not wait on a stalled mount')
  assert.deepEqual(restored.loaded, [])
  assert.deepEqual(restored.failed.map((row) => row.id), [id])
  assert.match(restored.failed[0].error, /在 40 毫秒内没有完成加载/u)
  assert.deepEqual(runtime.status().failed.map((row) => row.id), [id])
  assert.equal(errors.length, 1)
})
