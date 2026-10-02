/** Exercise the packaged Electron host without using checkout dependencies or user data. */
import assert from 'node:assert/strict'
import { execFile, fork } from 'node:child_process'
import { once } from 'node:events'
import { cp, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises'
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

export async function verifyPackagedPacks({ executable, resources }) {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'lwb-packaged-packs-')))
  const runtime = join(home, 'runtime')
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
      const timer = setTimeout(() => { reject(new Error('Packaged host readiness timed out')) }, 120_000)
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
    try { auth = await requestPackagedHost(address, { timeout: 10_000 }) }
    catch (error) { throw new Error(`Packaged acceptance host ${generation} authentication failed: ${error.message}`, { cause: error }) }
    const cookie = auth.headers['set-cookie']?.[0]?.split(';')[0]
    assert.ok(cookie, 'packaged host must issue its native authentication cookie')
    console.log(`Packaged acceptance host ${generation}: authenticated`)
    let first = true
    return async (method, args = {}) => {
      // Host readiness precedes enabled-pack restoration. The first list waits
      // for that cold startup using the same deadline as host readiness.
      const timeout = first && method === 'lwbPacks/list' ? 120_000 : 30_000
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
  try {
    await cp(join(resources, 'lwb-product'), runtime, { recursive: true })
    await execFileAsync(executable, ['--expose-internals', '--input-type=module', '--eval', `
      import { pathToFileURL } from 'node:url'
      import { join } from 'node:path'
      const { prepareLwbProfile } = await import(pathToFileURL(join(process.env.LWB_SMOKE_RUNTIME, 'lwb', 'profile-setup.mjs')))
      await prepareLwbProfile()
    `], { env, cwd: home, timeout: 30_000 })
    const packs = []
    for (const id of await readdir(env.LWB_PACKS_DIR)) {
      packs.push(JSON.parse(await readFile(join(env.LWB_PACKS_DIR, id, 'lwb-pack.json'), 'utf8')))
    }
    const free = packs.filter(pack => !pack.access?.membershipRequired)
    assert.ok(free.length, 'the edition must ship a keyless pack for lifecycle acceptance')
    let rpc = await start()
    assert.equal((await rpc('lwbPacks/list')).packs.length, 0)
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
    await stop()
    rpc = await start()
    for (const pack of free) assert.ok((await rpc('lwbPacks/list')).packs.some(row => row.id === pack.id))
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
    `], { env, cwd: home, timeout: 30_000 })
    console.log(`Packaged pack acceptance passed: ${free.length} load/unload/restore lifecycle(s), ${packs.length} host imports, browser graph and persistent account.`)
  } catch (error) {
    console.error(output.replace(/token=[^\s&]+/gu, 'token=[redacted]'))
    throw error
  } finally {
    await stop()
    await rm(home, { recursive: true, force: true })
  }
}
