import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { join, resolve } from 'node:path'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { desktopDevelopmentEnvironment } from '../../desktop/profile.mjs'

const modulePath = resolve('lwb/dsh-bundle/runtime-config.mjs')

function runtimeScript(environment, source) {
  const env = { ...process.env }
  for (const name of ['DSH_HOME', 'ELECTRON_RUN_AS_NODE', 'LWB_DSH_HOME', 'LWB_PACK_REGISTRY', 'LWB_PRODUCT_HOME', 'LWB_PROFILE_ID', 'LWB_PACKS_DIR', 'LWB_PACK_RUNTIME_DIR', 'LWB_PROFILE_DIR', 'LWB_PACK_STATE_DIR']) delete env[name]
  Object.assign(env, environment)
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { LWB_RUNTIME } from ${JSON.stringify(modulePath)}
    ${source}
  `], { env, encoding: 'utf8' }))
}

function readRuntime(environment = {}) {
  return runtimeScript(environment, 'process.stdout.write(JSON.stringify(LWB_RUNTIME))')
}

test('runtime config uses one carrier-independent product data root', () => {
  const runtime = readRuntime()
  assert.equal(runtime.profileId, 'lwb')
  assert.equal(runtime.dshHome, resolve('lwb/local/current/dsh-home'))
  assert.equal(runtime.profileHome, resolve('lwb/local/current/dsh-home/profiles/lwb'))
  assert.equal(runtime.packStateDir, resolve('lwb/local/current/pack-state'))
  assert.equal(runtime.productHome, resolve('lwb/local/current'))
  assert.equal(runtime.registryPath, resolve('lwb/local/current/packs.json'))
  assert.equal(runtime.sourcePacksDir, resolve('lwb/packs'))
})

test('runtime config selects the Desktop profile and user product home', () => {
  const dshHome = '/tmp/lwb-desktop-runtime-config'
  const runtime = readRuntime({ DSH_HOME: dshHome, ELECTRON_RUN_AS_NODE: '1' })
  assert.equal(runtime.profileId, 'desktop')
  assert.equal(runtime.profileHome, join(dshHome, 'profiles', 'desktop'))
  assert.equal(runtime.productHome, resolve('lwb/local/current'))
  assert.equal(runtime.registryPath, resolve('lwb/local/current/packs.json'))
  assert.equal(runtime.packRuntimeDir, undefined)
})

test('explicit product paths take precedence over transport defaults', () => {
  const runtime = readRuntime({
    DSH_HOME: '/tmp/lwb-desktop-runtime-config',
    ELECTRON_RUN_AS_NODE: '1',
    LWB_PROFILE_ID: 'preview',
    LWB_PRODUCT_HOME: '/tmp/lwb-shared-product',
    LWB_PACK_REGISTRY: '/tmp/lwb-shared-product/registry.json',
    LWB_PACKS_DIR: '/tmp/lwb-pack-sources',
    LWB_PACK_RUNTIME_DIR: '/tmp/lwb-runtime-copies',
    LWB_DSH_HOME: '/tmp/lwb-original-home',
    LWB_PROFILE_DIR: '/tmp/lwb-desktop-project',
    LWB_PACK_STATE_DIR: '/tmp/lwb-original-workspaces',
  })
  assert.equal(runtime.profileId, 'preview')
  assert.equal(runtime.dshHome, '/tmp/lwb-original-home')
  assert.equal(runtime.profileHome, '/tmp/lwb-desktop-project')
  assert.equal(runtime.packStateDir, '/tmp/lwb-original-workspaces')
  assert.equal(runtime.productHome, '/tmp/lwb-shared-product')
  assert.equal(runtime.registryPath, '/tmp/lwb-shared-product/registry.json')
  assert.equal(runtime.sourcePacksDir, '/tmp/lwb-pack-sources')
  assert.equal(runtime.packRuntimeDir, '/tmp/lwb-runtime-copies')
})

test('checkout Desktop inherits every durable Web path while activating packs in its own project', () => {
  for (const overrides of [{}, {
    LWB_DSH_HOME: '/tmp/lwb-custom-home',
    LWB_PACK_REGISTRY: '/tmp/lwb-custom-registry.json',
    LWB_PACK_STATE_DIR: '/tmp/lwb-custom-state',
  }, { LWB_DSH_HOME: './lwb/local/custom-home' }]) {
    const web = readRuntime(overrides)
    const project = '/tmp/lwb-disposable-desktop-project'
    const environment = desktopDevelopmentEnvironment(web, project)
    assert.equal(environment.LWB_DSH_HOME, web.dshHome)
    const desktop = readRuntime({ ...overrides, ...environment })
    for (const field of ['dshHome', 'productHome', 'registryPath', 'packStateDir', 'sourcePacksDir']) {
      assert.equal(desktop[field], web[field], field)
    }
    assert.equal(desktop.profileId, 'desktop')
    assert.equal(desktop.profileHome, project)
    assert.notEqual(desktop.profileHome, web.profileHome)
    assert.equal(desktop.packRuntimeDir, web.sourcePacksDir)
  }
})

test('the product version has one source per installation and no configured copy', async () => {
  const declared = JSON.parse(await readFile(resolve('package.json'), 'utf8')).version
  const reported = runtimeScript({}, `
    import { readProductVersion } from ${JSON.stringify(modulePath)}
    process.stdout.write(JSON.stringify({ version: readProductVersion() }))
  `)
  // A checkout answers with `package.json` — the field the release bumps and the
  // packager reads, so Settings and the update feed cannot disagree.
  assert.equal(reported.version, declared)
  // And the composition must not declare its own copy: that is the value nobody
  // bumps at release time, and it would silently win over the real one.
  const patch = await readFile(resolve('lwb/dsh-bundle/cordis.patch.yml'), 'utf8')
  const entry = patch.split('- id: lwb-profile')[1]
  assert.ok(entry, 'the composition must still register the lwb-profile entry')
  assert.doesNotMatch(entry.split(/\n\s*- id:/u)[0], /^\s*version:/mu)
})

test('switching Web → Desktop → Web retains enabled packs, accounts, projects and configuration', async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'lwb-carrier-data-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const home = join(root, 'dsh-home')
  await mkdir(home)
  const settings = 'ui-theme:\n  preference: light\n'
  const credentials = 'fixture: test-only-credential\n'
  await writeFile(join(home, 'settings.yaml'), settings)
  await writeFile(join(home, '.credentials.yaml'), credentials)
  const webEnvironment = { LWB_DSH_HOME: home, LWB_PRODUCT_HOME: root }
  const web = readRuntime(webEnvironment)
  const desktopEnvironment = desktopDevelopmentEnvironment(web, join(root, 'desktop-project'))
  const imports = `
    import { LwbPackWorkspaces } from ${JSON.stringify(resolve('lwb/dsh-bundle/pack-workspaces.mjs'))}
    import { installLwbPack, installedLwbPacks } from ${JSON.stringify(resolve('lwb/dsh-bundle/pack-manager.mjs'))}
    import { SpokenVideoContentStore } from ${JSON.stringify(resolve('lwb/packs/spoken-video/spoken-video-content-store.mjs'))}
    import { SpokenVideoProjectStore } from ${JSON.stringify(resolve('lwb/packs/spoken-video/spoken-video-store.mjs'))}
    const manager = new LwbPackWorkspaces({ root: LWB_RUNTIME.packStateDir })
    const context = await manager.activate({ id: 'spoken-video', packageName: '@scitiger-ai/lwb-spoken-video' })
    const content = new SpokenVideoContentStore({ workspacePath: context.workspacePath })
    const projects = new SpokenVideoProjectStore()
  `
  const original = runtimeScript(webEnvironment, `${imports}
    await installLwbPack(${JSON.stringify(resolve('lwb/packs/spoken-video'))}, { enabled: true })
    await content.createAccount(context, { name: 'Existing Web account' })
    await projects.create(context, { title: 'Existing Web project' })
    process.stdout.write(JSON.stringify(context))
  `)
  const restored = runtimeScript(desktopEnvironment, `${imports}
    const packs = await installedLwbPacks()
    const accounts = await content.listAccounts(context)
    const existing = await projects.list(context)
    await projects.create(context, { title: 'Desktop project' })
    process.stdout.write(JSON.stringify({ context, packs, accounts, existing }))
  `)
  assert.deepEqual(restored.context, original)
  assert.equal(restored.packs[0].enabled, true)
  assert.equal(restored.accounts.accounts[0].name, 'Existing Web account')
  assert.equal(restored.existing[0].title, 'Existing Web project')
  const returned = runtimeScript(webEnvironment, `${imports}
    process.stdout.write(JSON.stringify(await projects.list(context)))
  `)
  assert.deepEqual(returned.map((item) => item.title).sort(), ['Desktop project', 'Existing Web project'])
  assert.equal(await readFile(join(home, 'settings.yaml'), 'utf8'), settings)
  assert.equal(await readFile(join(home, '.credentials.yaml'), 'utf8'), credentials)
})
