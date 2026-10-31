/** Exercise the packaged Electron host without using checkout dependencies or user data. */
import assert from 'node:assert/strict'
import { execFile, fork } from 'node:child_process'
import { once } from 'node:events'
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export function requestPackagedHost(address, { method = 'GET', headers, body, timeout = 30_000 } = {}) {
  const url = new URL(address)
  assert.equal(url.protocol, 'http:')
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Acceptance requests must stay on loopback')
  return new Promise((resolve, reject) => {
    // Build download proxies must never intercept the local acceptance host.
    const req = request(url, { method, headers, agent: false, signal: AbortSignal.timeout(timeout) }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('error', reject)
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

/**
 * Acceptance time budgets for one packaged app.
 *
 * A cross-architecture bundle starts through Rosetta on macOS. Its first launch
 * translates a freshly assembled Electron bundle and can take tens of seconds,
 * so the native preparation budget would abort a healthy build.
 * @param target - Package platform and architecture, when known.
 * @param host - Host platform and architecture (`process` by default).
 * @returns the cross-architecture mode and the budgets it needs.
 */
export function acceptanceBudgets(target, host = process) {
  const crossArch = target?.platform !== undefined && target?.arch !== undefined
    && (target.platform !== host.platform || target.arch !== host.arch)
  const scale = crossArch ? 4 : 1
  return {
    crossArch,
    start: 30_000 * scale,
    ready: 120_000 * scale,
    call: 30_000 * scale,
    auth: 10_000 * scale,
  }
}

/**
 * Exercise the packaged host, capability packs and upgrade paths without using
 * checkout dependencies or the user's product data.
 * @param options - Packaged executable, its resources directory, and its target.
 * @param options.executable - Packaged application executable.
 * @param options.resources - Packaged `Resources` directory.
 * @param options.target - Target platform and architecture, when known.
 */
export async function verifyPackagedPacks({ executable, resources, target }) {
  const budget = acceptanceBudgets(target)
  if (budget.crossArch) {
    console.log(`Packaged acceptance runs ${target.platform}-${target.arch} on ${process.platform}-${process.arch}; the first launch may take a minute.`)
  }
  const home = await realpath(await mkdtemp(join(tmpdir(), 'lwb-packaged-packs-')))
  const runtime = join(home, 'runtime', 'current-build')
  const dsh = join(resources, 'app.asar', 'dsh')
  let child, output = '', starts = 0
  const env = { ...process.env }
  for (const name of Object.keys(env)) {
    if (/^(?:LWB_|DSH_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_)/u.test(name)) delete env[name]
  }
  Object.assign(env, {
    ELECTRON_RUN_AS_NODE: '1',
    LWB_PRODUCT_HOME: home,
    LWB_DSH_HOME: join(home, 'dsh-home'),
    DSH_HOME: join(home, 'dsh-home'),
    LWB_PROFILE_ID: 'desktop',
    LWB_PROFILE_DIR: join(home, 'dsh-home', 'profiles', 'desktop'),
    LWB_DSH_RUNTIME_DIR: dsh,
    LWB_PACKS_DIR: join(runtime, 'lwb', 'packs'),
    LWB_PACK_RUNTIME_DIR: join(runtime, 'lwb', 'packs'),
    LWB_SMOKE_RUNTIME: runtime,
    DSH_CLIENT_VERSION: 'packaged-acceptance',
  })
  const recordOutput = data => { output = (output + data).slice(-80_000) }
  async function stop() {
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return
    const done = once(child, 'exit')
    if (child.connected) child.send({ type: 'shutdown' })
    else child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000)
    try { await done } finally { clearTimeout(timer) }
  }
  async function start() {
    const generation = ++starts
    const reservation = createServer()
    reservation.listen(0, '127.0.0.1')
    await once(reservation, 'listening')
    env.LWB_DESKTOP_PORT = String(reservation.address().port)
    await new Promise(resolve => reservation.close(resolve))
    child = fork(join(dsh, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'index.js'), [
      dsh, env.LWB_PROFILE_DIR, join(resources, 'runtime', 'primary-runtime'),
      join(resources, 'runtime', 'pnpm', 'bin', 'pnpm.mjs'), join(resources, 'runtime', 'bin'),
    ], { execPath: executable, execArgv: ['--expose-internals'], env, cwd: home, silent: true })
    child.stdout.on('data', recordOutput)
    child.stderr.on('data', recordOutput)
    const address = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('Packaged host readiness timed out')) }, budget.ready)
      const cleanup = () => { clearTimeout(timer); child.off('message', onMessage); child.off('exit', onExit); child.off('error', onError) }
      const onMessage = message => {
        if (message.type === 'ready') { cleanup(); resolve(message.url) }
        if (message.type === 'fatal') { cleanup(); reject(new Error(message.diagnostic || message.message)) }
      }
      const onExit = () => { cleanup(); reject(new Error('Packaged host exited before readiness')) }
      const onError = error => { cleanup(); reject(error) }
      child.on('message', onMessage); child.on('exit', onExit); child.on('error', onError)
    })
    const origin = new URL(address).origin
    let auth
    try { auth = await requestPackagedHost(address, { timeout: budget.auth }) }
    catch (error) { throw new Error(`Packaged acceptance host ${generation} authentication failed: ${error.message}`, { cause: error }) }
    const cookie = auth.headers['set-cookie']?.[0]?.split(';')[0]
    assert.ok(cookie, 'packaged host must issue its native authentication cookie')
    console.log(`Packaged acceptance host ${generation}: authenticated`)
    let first = true
    return async (method, args = {}) => {
      // Host readiness precedes enabled-pack restoration. The first list waits
      // for that cold startup using the same deadline as host readiness.
      const timeout = first && method === 'lwbPacks/list' ? budget.ready : budget.call
      first = false
      const started = performance.now()
      console.log(`Packaged acceptance host ${generation}: ${method} started`)
      let response
      try {
        response = await requestPackagedHost(`${origin}/api/${method}`, {
          method: 'POST', timeout,
          headers: { 'content-type': 'application/json', cookie, origin },
          body: JSON.stringify({ type: 'client-request', rpcId: 'packaged-smoke', method, payload: { args } }),
        })
      } catch (error) { throw new Error(`Packaged acceptance host ${generation} ${method} failed after ${Math.round(performance.now() - started)}ms: ${error.message}`, { cause: error }) }
      assert.equal(response.status, 200, method)
      const { result } = JSON.parse(response.text)
      assert.equal(result.ok, true, `${method}: ${result.error?.message}`)
      console.log(`Packaged acceptance host ${generation}: ${method} passed (${Math.round(performance.now() - started)}ms)`)
      return result.value
    }
  }
  // `lwbPacks/list` answers within about two seconds whether or not start-up
  // restoration has finished, and reports which one through `startup`. A read
  // straight after a start can therefore predate the restore — on a Rosetta
  // build it routinely does — so lifecycle assertions wait for the Host to say
  // restoration is over, within the same deadline as host readiness.
  async function restoredCatalog(rpc) {
    const deadline = performance.now() + budget.ready
    for (;;) {
      const catalog = await rpc('lwbPacks/list')
      const startup = catalog.startup ?? {}
      if (startup.started === true && startup.restoring !== true) return catalog
      if (performance.now() > deadline) {
        throw new Error(`Packaged acceptance: pack restoration did not finish within ${budget.ready}ms (${JSON.stringify(startup)})`)
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
  async function prepareProfile() {
    await execFileAsync(executable, ['--expose-internals', '--input-type=module', '--eval', `
      import { pathToFileURL } from 'node:url'
      import { join } from 'node:path'
      const { migrateRuntimePackRegistry } = await import(pathToFileURL(join(${JSON.stringify(resources)}, 'app.asar', 'registry-migration.mjs')))
      await migrateRuntimePackRegistry(join(process.env.LWB_PRODUCT_HOME, 'packs.json'), {
        productHome: process.env.LWB_PRODUCT_HOME, currentRuntime: process.env.LWB_SMOKE_RUNTIME,
      })
      const { prepareLwbProfile } = await import(pathToFileURL(join(process.env.LWB_SMOKE_RUNTIME, 'lwb', 'profile-setup.mjs')))
      await prepareLwbProfile()
    `], { env, cwd: home, timeout: budget.start })
  }
  async function seedUpgrade(packs, enabled) {
    const records = []
    for (const pack of packs) {
      const source = join(home, 'runtime', `old-build-${enabled}`, 'lwb', 'packs', pack.id)
      await cp(join(env.LWB_PACKS_DIR, pack.id), source, {
        recursive: true, filter: source => !source.split(/[\\/]/u).includes('node_modules'),
      })
      const link = join(env.LWB_PROFILE_DIR, 'node_modules', ...pack.packageName.split('/'))
      await mkdir(join(link, '..'), { recursive: true })
      await rm(link, { force: true })
      await symlink(source, link, process.platform === 'win32' ? 'junction' : 'dir')
      records.push({ id: pack.id, packageName: pack.packageName, source,
        installedAt: '2026-01-01T00:00:00.000Z', enabled, manifest: pack })
    }
    await writeFile(join(home, 'packs.json'), JSON.stringify({ schemaVersion: 2, packs: records }))
    await prepareProfile()
    for (const pack of packs) {
      const link = join(env.LWB_PROFILE_DIR, 'node_modules', ...pack.packageName.split('/'))
      assert.equal(await realpath(link), await realpath(join(env.LWB_PACKS_DIR, pack.id)))
    }
    console.log(`Packaged upgrade preparation passed: old registry and Profile links, enabled=${enabled}.`)
  }
  try {
    await cp(join(resources, 'lwb-product'), runtime, { recursive: true })
    const packs = []
    for (const id of await readdir(env.LWB_PACKS_DIR)) {
      packs.push(JSON.parse(await readFile(join(env.LWB_PACKS_DIR, id, 'lwb-pack.json'), 'utf8')))
    }
    const free = packs.filter(pack => !pack.access?.membershipRequired)
    assert.ok(free.length, 'the edition must ship a keyless pack for lifecycle acceptance')
    await prepareProfile()
    let rpc = await start()
    assert.equal((await restoredCatalog(rpc)).packs.length, 0)
    await stop()
    await seedUpgrade(free, false)
    rpc = await start()
    assert.equal((await restoredCatalog(rpc)).packs.length, 0)
    for (const pack of free) {
      const loaded = await rpc('lwbPacks/load', { request: { id: pack.id } })
      assert.equal(loaded.status, 'loaded')
      assert.ok((await rpc('lwbPacks/clientGraph')).entries.some(row => row.id === pack.packageName))
      const catalog = await rpc('lwbPacks/list')
      assert.equal(catalog.packs.find(row => row.id === pack.id).menus.length, pack.menus.length)
      await rpc('lwbPacks/unload', { request: { id: pack.id } })
      assert.ok(!(await rpc('lwbPacks/clientGraph')).entries.some(row => row.id === pack.packageName))
      await rpc('lwbPacks/load', { request: { id: pack.id } })
    }
    await rpc('spokenVideo/createAccount', { request: { name: 'Packaged acceptance account' } })
    // Keep lifecycle acceptance independent of scheduled external feed fetches.
    for (const source of await rpc('spokenVideo/sources')) {
      await rpc('spokenVideo/setSourceEnabled', { request: { sourceId: source.id, enabled: false } })
    }
    await stop()
    await seedUpgrade(free, true)
    rpc = await start()
    const restored = await restoredCatalog(rpc)
    for (const pack of free) {
      assert.ok(restored.packs.some(row => row.id === pack.id), `${pack.id} was not restored: ${JSON.stringify(restored.startup)}`)
    }
    assert.equal((await rpc('spokenVideo/listAccounts')).accounts[0].name, 'Packaged acceptance account')
    for (const pack of free) await rpc('lwbPacks/unload', { request: { id: pack.id } })
    await stop()
    // Membership-gated packs are imported for dependency completeness, without
    // changing access policy or invoking any paid model service.
    await execFileAsync(executable, ['--expose-internals', '--input-type=module', '--eval', `
      import { pathToFileURL } from 'node:url'
      import { join } from 'node:path'
      const runtime = process.env.LWB_SMOKE_RUNTIME
      const { marketplaceLwbPacks } = await import(pathToFileURL(join(runtime, 'lwb/dsh-bundle/pack-manager.mjs')))
      const { linkLwbPackForRuntime } = await import(pathToFileURL(join(runtime, 'lwb/dsh-bundle/pack-runtime-links.mjs')))
      const dsh = process.env.LWB_DSH_RUNTIME_DIR
      const { Context } = await import(pathToFileURL(join(dsh, 'node_modules/@deepseek-ai/cordis/lib/index.js')))
      const { PluginPackages, loadProfileDirectory, createRuntimeResolution } = await import(pathToFileURL(join(dsh, 'node_modules/@deepseek-ai/dsh-app-boot/lib/index.js')))
      const packs = await marketplaceLwbPacks()
      for (const pack of packs) await linkLwbPackForRuntime(pack)
      const installAnchor = join(dsh, 'node_modules/@deepseek-ai/dsh/package.json')
      const profile = loadProfileDirectory('dsh', process.env.LWB_PROFILE_DIR, installAnchor)
      const ctx = new Context()
      await ctx.plugin(PluginPackages, { resolution: await createRuntimeResolution({ installAnchor, profile, home: process.env.DSH_HOME }) }).await()
      for (const pack of packs) await import(pathToFileURL(join(pack.source, pack.hostEntry)))
    `], { env, cwd: home, timeout: budget.start })
    console.log(`Packaged pack acceptance passed: disabled/enabled upgrade links, ${free.length} load/unload/restore lifecycle(s), ${packs.length} host imports, browser graph and persistent account.`)
  } catch (error) {
    console.error(output.replace(/token=[^\s&]+/gu, 'token=[redacted]'))
    throw error
  } finally {
    await stop()
    await rm(home, { recursive: true, force: true })
  }
}
