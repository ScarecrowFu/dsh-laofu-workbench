import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { PARKED_TAB_HTML, PARKED_TAB_PATH, registerLwbParkedTab } from '../parked-tab.mjs'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const guardStart = source.indexOf('    const TAB_CHANNEL = ')
const guardEnd = source.indexOf('    function apply(ctx) {', guardStart)

/** One browser: every BroadcastChannel of the same name sees the others' posts. */
function browser() {
  const channels = new Set()
  class FakeBroadcastChannel {
    constructor(name) { this.name = name; this.closed = false; channels.add(this) }
    postMessage(data) {
      for (const peer of channels) {
        if (peer !== this && !peer.closed && peer.name === this.name) peer.onmessage?.({ data: structuredClone(data) })
      }
    }
    close() { this.closed = true; channels.delete(this) }
  }
  let now = 1_000
  let uuid = 0
  const tab = (transport) => {
    const window = { location: { replaced: null, replace(url) { this.replaced = url } } }
    const start = vm.runInNewContext(`(() => { ${source.slice(guardStart, guardEnd)}; return startSingleTabGuard; })()`, {
      window,
      globalThis: { __DSH_TRANSPORT__: transport },
      BroadcastChannel: FakeBroadcastChannel,
      crypto: { randomUUID: () => `tab-${String(++uuid).padStart(4, '0')}` },
      Date: { now: () => now },
      Number,
    })
    return { window, start }
  }
  return { tab, tick: () => { now += 1 }, open: () => channels.size }
}

test('the parked-tab page is static, uncached and links back to the workbench', () => {
  const routes = new Map()
  let dispose
  registerLwbParkedTab({
    effect(register) { dispose = register() },
    webServer: { register(route) {
      assert.equal(route.kind, 'exact')
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    } },
  })
  const route = routes.get(PARKED_TAB_PATH)
  for (const method of ['GET', 'HEAD', 'POST']) {
    const response = { writeHead(status, headers) { this.status = status; this.headers = headers }, end(body) { this.body = body } }
    route.handler({ method }, response)
    assert.equal(response.status, method === 'POST' ? 405 : 200)
    if (method !== 'POST') {
      assert.equal(response.headers['content-type'], 'text/html; charset=utf-8')
      assert.equal(response.headers['cache-control'], 'no-store')
    }
    assert.equal(response.body, method === 'GET' ? PARKED_TAB_HTML : undefined)
  }
  // The whole point is to hold no connection: no script may load a client.
  assert.doesNotMatch(PARKED_TAB_HTML, /<script/iu)
  assert.match(PARKED_TAB_HTML, /<a href="\/">在此标签页继续使用<\/a>/u)
  dispose()
  assert.equal(routes.size, 0)
})

test('the newest workbench tab takes over and older tabs park on the static page', () => {
  const { tab, tick } = browser()
  const first = tab()
  first.start()
  tick()
  const second = tab()
  second.start()
  assert.equal(first.window.location.replaced, PARKED_TAB_PATH)
  assert.equal(second.window.location.replaced, null)
  tick()
  const third = tab()
  third.start()
  assert.equal(second.window.location.replaced, PARKED_TAB_PATH)
  assert.equal(third.window.location.replaced, null)
})

test('a hot reload of the shell never parks its own tab, and an older tab that reclaims is told to park', () => {
  const { tab, tick } = browser()
  const older = tab()
  const disposeOlder = older.start()
  tick()
  const newer = tab()
  const disposeNewer = newer.start()
  assert.equal(older.window.location.replaced, PARKED_TAB_PATH)
  older.window.location.replaced = null
  // Same document, module re-run: the tab identity lives on the window.
  disposeNewer()
  newer.start()
  assert.equal(newer.window.location.replaced, null)
  // The older document reclaims with its original timestamp and is answered.
  disposeOlder()
  older.start()
  assert.equal(older.window.location.replaced, PARKED_TAB_PATH)
  assert.equal(newer.window.location.replaced, null)
})

test('the Desktop shell transport and browsers without BroadcastChannel are left alone', () => {
  const { tab, open } = browser()
  const desktop = tab({ fetch: () => {} })
  desktop.start()()
  assert.equal(open(), 0)
  const start = vm.runInNewContext(`(() => { ${source.slice(guardStart, guardEnd)}; return startSingleTabGuard; })()`, {
    window: { location: { replace() { throw new Error('must not park') } } },
    globalThis: {},
  })
  start()()
})
