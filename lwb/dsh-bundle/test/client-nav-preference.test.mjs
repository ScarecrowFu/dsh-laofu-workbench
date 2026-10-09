import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'

const require = createRequire(import.meta.url)
const upstreamRequire = createRequire(new URL('../../../vendor/deepseek-harness/package.json', import.meta.url))
const { JSDOM } = upstreamRequire('jsdom')
const React = require('react')
const { createRoot } = require('react-dom/client')

const clientPath = new URL('../client.js', import.meta.url)
const WORKBENCH_KEY = 'lwb.workbench.v3'
const NAV_KEY = 'lwb.nav.v1'

const PACKS = [
  { id: 'pack-a', name: 'Alpha', menus: [{ id: 'home', label: 'Alpha Home' }, { id: 'runs', label: 'Alpha Runs' }] },
  { id: 'pack-b', name: 'Beta', menus: [{ id: 'home', label: 'Beta Home' }] },
]
const MARKET = { packs: PACKS.map((pack) => ({ id: pack.id, name: pack.name, menus: pack.menus })) }

function navPreferenceFunctions(source) {
  const start = source.indexOf('function navStorage(storage) {')
  const end = source.indexOf('\n    function notify(', start)
  assert.ok(start >= 0 && end > start, 'client must define the nav preference store')
  const packId = source.match(/const PACK_ID = (\/.*?\/);/u)?.[1]
  assert.ok(packId, 'client must declare the pack id contract')
  const navKey = source.match(/const NAV_STORAGE_KEY = '([^']+)';/u)?.[1]
  assert.ok(navKey, 'client must declare the nav storage key')
  return vm.runInNewContext(`(() => { const PACK_ID = ${packId}; const NAV_STORAGE_KEY = ${JSON.stringify(navKey)}; ${source.slice(start, end)}\n; return { readNavPreference, writeNavPreference } })()`)
}

function snapshotFunction(source) {
  const start = source.indexOf('function persistedSnapshot(state) {')
  const end = source.indexOf('\n    function persist(', start)
  assert.ok(start >= 0 && end > start, 'client must define the persisted snapshot')
  const version = source.match(/const BASE_CONTRACT_VERSION = (\d+);/u)?.[1]
  assert.ok(version, 'client must declare its contract version')
  return vm.runInNewContext(`(() => { const BASE_CONTRACT_VERSION = ${version}; ${source.slice(start, end)}\n; return persistedSnapshot })()`)
}

function fakeStorage(initial) {
  const values = new Map(initial ? Object.entries(initial) : [])
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
  }
}

test('the recorded group preference tolerates missing, malformed, and hostile storage', async () => {
  const { readNavPreference, writeNavPreference } = navPreferenceFunctions(await readFile(clientPath, 'utf8'))

  assert.equal(readNavPreference(fakeStorage()), null, 'no record means no preference yet')
  assert.equal(readNavPreference(undefined), null, 'a storage-less runtime degrades to no preference')
  assert.equal(readNavPreference(fakeStorage({ [NAV_KEY]: 'not json' })), null)
  assert.equal(readNavPreference(fakeStorage({ [NAV_KEY]: '[]' })), null, 'a bare array is not the record shape')
  assert.equal(readNavPreference({ getItem() { throw new Error('denied') } }), null, 'a throwing read must not break the shell')
  assert.deepEqual([...readNavPreference(fakeStorage({ [NAV_KEY]: JSON.stringify({ expandedPacks: [] }) }))], [], 'an empty record is a real answer')

  const sanitized = readNavPreference(fakeStorage({ [NAV_KEY]: JSON.stringify({ expandedPacks: ['pack-a', 'Not An Id', 'pack-b', 7, null, 'pack-a'] }) }))
  assert.deepEqual([...sanitized].sort(), ['pack-a', 'pack-b'], 'only contract-valid ids survive, deduplicated')

  const storage = fakeStorage()
  writeNavPreference(new Set(['pack-b', 'pack-a']), storage)
  assert.deepEqual(JSON.parse(storage.values.get(NAV_KEY)).expandedPacks, ['pack-a', 'pack-b'], 'the record is written in a stable order')
  assert.deepEqual([...readNavPreference(storage)].sort(), ['pack-a', 'pack-b'], 'the record round-trips')
  writeNavPreference(new Set(), storage)
  assert.deepEqual([...readNavPreference(storage)], [], 'collapsing everything is recorded as an empty set')
  assert.doesNotThrow(() => writeNavPreference(new Set(['pack-a']), { setItem() { throw new Error('quota') } }), 'a failing write stays silent')
  assert.doesNotThrow(() => writeNavPreference(new Set(['pack-a']), undefined), 'a storage-less runtime stops at the guard')
})

test('the workbench snapshot records the current page so a reload returns to it', async () => {
  const persistedSnapshot = snapshotFunction(await readFile(clientPath, 'utf8'))

  assert.equal(persistedSnapshot({ page: 'packs' }).page, 'packs')
  assert.equal(persistedSnapshot({ page: 'settings' }).page, 'settings')
  assert.equal(persistedSnapshot({ page: 'capability', capabilityPage: 'pack-a:home' }).capabilityPage, 'pack-a:home')
  assert.equal(persistedSnapshot({ page: 'conversation', capabilityPage: 7 }).capabilityPage, null)
  assert.equal(persistedSnapshot({ page: 'unknown' }).page, 'conversation', 'an unknown page falls back to the conversation')
  assert.ok(Number.isFinite(persistedSnapshot({ page: 'packs' }).stateUpdatedAt))
})

/**
 * Boot the real client bundle against a jsdom window and hand back the sidebar
 * seat, its container, and a reload helper that keeps localStorage.
 */
async function mountSidebar(options = {}) {
  const dom = new JSDOM('<!doctype html><title>DSH</title><body></body>', { url: 'http://localhost/' })
  const window = dom.window
  if (options.platform) window.document.documentElement.dataset.platform = options.platform
  if (options.windowsTitlebar) window.document.documentElement.setAttribute('data-windows-titlebar', '')
  let mobile = Boolean(options.mobile)
  const mediaListeners = new Set()
  for (const [key, value] of Object.entries(options.seed || {})) window.localStorage.setItem(key, value)
  try {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true, writable: true,
      value: () => ({ get matches() { return mobile }, addEventListener(_, fn) { mediaListeners.add(fn) }, removeEventListener(_, fn) { mediaListeners.delete(fn) } }),
    })
  } catch (_) {
    window.Window.prototype.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  }

  let packs = options.packs || PACKS
  const events = new Map()
  const cleanups = []
  const ctx = {
    services: new Map(),
    get(name) { return this.services.get(name) },
    provide(name, value) { this.services.set(name, value) },
    on(event, handler) {
      const handlers = events.get(event) || new Set()
      handlers.add(handler)
      events.set(event, handlers)
      return () => handlers.delete(handler)
    },
    emit(event) { for (const handler of [...(events.get(event) || [])]) handler() },
    // The real context owns effect disposal; keep the returned cleanup so a test
    // does not leave the shell's account timer running.
    effect(fn) {
      const cleanup = fn()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
      return cleanup
    },
  }
  const slots = new Map()
  const slotsService = {
    inject(name, register) { return register() },
    register({ name }, component) { slots.set(name, component); return () => slots.delete(name) },
  }
  ctx.slots = slotsService
  ctx.provide('slots', slotsService)
  const rpc = async (path, method) => {
    if (method === 'lwbPacks/visibility') return { ok: true, value: { sessionIds: [], workspacePaths: [] } }
    if (method === 'lwbPacks/list' || method === 'lwbPacks/market') {
      if (options.pendingPacks) return new Promise(() => {})
      return { ok: true, value: method === 'lwbPacks/market' ? MARKET : { packs } }
    }
    return { ok: true, value: {} }
  }
  ctx.provide('connection', { rpc: { call: rpc } })
  for (const name of ['sessions', 'workspaces', 'uiWorkspace', 'layout', 'locale', 'modules']) ctx.provide(name, {})
  let toggleCalls = 0
  ctx.provide('layout', { toggleSidebar() { toggleCalls += 1 } })
  ctx.provide('remote', {})

  let plugin
  const primitives = new Proxy({}, { get: () => () => null })
  vm.runInNewContext(await readFile(clientPath, 'utf8'), {
    window: Object.assign(window, { __ModuleLoader__: { load({ factory }) {
      plugin = factory((name) => name === '@deepseek-ai/dsh-client-ui-primitives' ? primitives : require(name))
    } } }),
    document: window.document, localStorage: window.localStorage,
    MutationObserver: window.MutationObserver, Node: window.Node, NodeFilter: window.NodeFilter,
    AbortController, URL, setInterval, clearInterval, requestAnimationFrame: (callback) => setTimeout(callback, 0), queueMicrotask, console,
  })
  plugin.apply(ctx)

  const container = window.document.createElement('div')
  window.document.body.append(container)
  const root = createRoot(container)
  const originals = Object.fromEntries(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true })
  const Sidebar = slots.get('sidebar')
  assert.ok(Sidebar, 'the product navigation registers on apply')

  const flush = async (rounds = 4) => { for (let index = 0; index < rounds; index += 1) await new Promise((resolve) => setTimeout(resolve, 0)) }
  let layout = { collapsed: Boolean(options.collapsed), width: options.width ?? 248 }
  const render = async (next = {}) => {
    layout = { ...layout, ...next }
    // One act for mount and the catalog round trip that follows it: resolving the
    // pending RPC outside act would report a state update React never saw.
    await React.act(async () => { root.render(React.createElement(Sidebar, layout)); await flush() })
  }
  const click = async (node) => { await React.act(async () => { node.click(); await flush() }) }
  const dispatch = async (node, event) => { await React.act(async () => { node.dispatchEvent(event); await flush() }) }
  const groups = () => [...container.querySelectorAll('.lwb-cap-group')].map((section) => {
    const toggle = section.querySelector('.lwb-cap-toggle')
    return {
      title: toggle.title,
      expanded: toggle.getAttribute('aria-expanded'),
      active: section.getAttribute('data-active'),
      menus: [...section.querySelectorAll('.lwb-cap-menu .lwb-nav-item')].map((button) => button.textContent),
    }
  })
  const navRecord = () => {
    const raw = window.localStorage.getItem(NAV_KEY)
    return raw === null ? null : JSON.parse(raw).expandedPacks
  }
  const pageRecord = () => {
    const raw = window.localStorage.getItem(WORKBENCH_KEY)
    return raw === null ? null : JSON.parse(raw).page
  }
  const unload = async () => {
    await React.act(async () => { root.unmount() })
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
    // apply() hands its teardown to the context, not to the caller.
    for (const cleanup of cleanups.splice(0)) cleanup()
    window.close()
  }

  return {
    window, container, render, click, dispatch, groups, navRecord, pageRecord, unload,
    toggleCalls: () => toggleCalls,
    renderLeading: async () => { await React.act(async () => { root.render(React.createElement(slots.get('shell.leading'))); await flush() }) },
    setMobile: async (value) => { await React.act(async () => { mobile = value; for (const fn of mediaListeners) fn(); await flush() }) },
    setPacks: (next) => { packs = next },
    refreshCatalog: async () => { await React.act(async () => { ctx.emit('connection/reset'); await flush() }) },
  }
}

test('a reload keeps the capability group the user opened', async () => {
  const first = await mountSidebar()
  try {
    await first.render()
    assert.deepEqual(first.groups().map((group) => group.expanded), ['false', 'false'], 'two packs start collapsed with no recorded preference')
    assert.equal(first.navRecord(), null, 'nothing is written before the user acts')

    await first.click(first.container.querySelectorAll('.lwb-cap-toggle')[0])
    assert.deepEqual(first.groups()[0].expanded, 'true')
    assert.deepEqual(first.groups()[0].menus, ['Alpha Home', 'Alpha Runs'])
    assert.deepEqual(first.navRecord(), ['pack-a'], 'the open group is recorded')

    // A browser reload keeps localStorage but rebuilds the module: this is the
    // regression the grouping shipped with, where the page always came back shut.
    const seed = {
      [WORKBENCH_KEY]: first.window.localStorage.getItem(WORKBENCH_KEY),
      [NAV_KEY]: first.window.localStorage.getItem(NAV_KEY),
    }
    const reloaded = await mountSidebar({ seed })
    try {
      await reloaded.render()
      assert.deepEqual(reloaded.groups().map((group) => group.expanded), ['true', 'false'], 'the reloaded shell restores the open group')
      assert.deepEqual(reloaded.navRecord(), ['pack-a'], 'the restored record is not rewritten away')
    } finally {
      await reloaded.unload()
    }
  } finally {
    await first.unload()
  }
})

test('an explicitly collapsed group is not reopened by a reload of its own page', async () => {
  const seed = {
    [WORKBENCH_KEY]: JSON.stringify({ page: 'capability', capabilityPage: 'pack-a:home' }),
    [NAV_KEY]: JSON.stringify({ expandedPacks: [] }),
  }
  const harness = await mountSidebar({ seed })
  try {
    await harness.render()
    const groups = harness.groups()
    assert.equal(groups[0].active, 'true', 'the capability route is restored')
    assert.equal(groups[0].expanded, 'false', 'a recorded collapse wins over the route reveal')
    assert.equal(groups[1].expanded, 'false')
    assert.deepEqual(harness.navRecord(), [], 'the recorded collapse survives the boot')
  } finally {
    await harness.unload()
  }
})

test('a first-run capability route reveals its pack without a recorded preference', async () => {
  const seed = { [WORKBENCH_KEY]: JSON.stringify({ page: 'capability', capabilityPage: 'pack-b:home' }) }
  const harness = await mountSidebar({ seed })
  try {
    await harness.render()
    const groups = harness.groups()
    assert.equal(groups[1].active, 'true')
    assert.deepEqual(groups.map((group) => group.expanded), ['false', 'true'], 'only the active pack is revealed')
    assert.deepEqual(harness.navRecord(), ['pack-b'], 'the reveal becomes the starting record')
  } finally {
    await harness.unload()
  }
})

test('a pending catalog never erases the recorded groups', async () => {
  const seed = { [NAV_KEY]: JSON.stringify({ expandedPacks: ['pack-b'] }) }
  const harness = await mountSidebar({ seed, pendingPacks: true })
  try {
    await harness.render()
    assert.deepEqual(harness.groups(), [], 'no pack renders while the catalog is pending')
    assert.deepEqual(harness.navRecord(), ['pack-b'], 'the empty pending frame must not be written back')
  } finally {
    await harness.unload()
  }
})

test('a catalog refresh neither erases nor reopens a hand-collapsed group', async () => {
  const seed = {
    [WORKBENCH_KEY]: JSON.stringify({ page: 'capability', capabilityPage: 'pack-b:home' }),
    [NAV_KEY]: JSON.stringify({ expandedPacks: ['pack-b'] }),
  }
  const harness = await mountSidebar({ seed })
  try {
    await harness.render()
    assert.equal(harness.groups()[1].expanded, 'true', 'the recorded group is restored')

    await harness.click(harness.container.querySelectorAll('.lwb-cap-toggle')[1])
    assert.equal(harness.groups()[1].expanded, 'false')
    assert.deepEqual(harness.navRecord(), [], 'the collapse is recorded')

    // A pack switch or a connection reset reprojects the same catalog as a new
    // array: that refresh used to force the active pack back open.
    await harness.refreshCatalog()
    assert.equal(harness.groups()[1].expanded, 'false', 'a refresh is not a route entry')
    assert.deepEqual(harness.navRecord(), [], 'the collapse stays recorded')
  } finally {
    await harness.unload()
  }
})

test('unloading a pack prunes it from the recorded groups', async () => {
  const harness = await mountSidebar()
  try {
    await harness.render()
    const toggles = harness.container.querySelectorAll('.lwb-cap-toggle')
    await harness.click(toggles[0])
    await harness.click(harness.container.querySelectorAll('.lwb-cap-toggle')[1])
    assert.deepEqual(harness.navRecord(), ['pack-a', 'pack-b'])

    harness.setPacks([PACKS[1]])
    await harness.refreshCatalog()
    assert.deepEqual(harness.groups().map((group) => group.title), ['Beta'], 'the unloaded pack leaves the navigation')
    assert.deepEqual(harness.navRecord(), ['pack-b'], 'its record is pruned with it')
  } finally {
    await harness.unload()
  }
})

test('primary navigation records the page the user leaves behind', async () => {
  const harness = await mountSidebar()
  try {
    await harness.render()
    await harness.click(harness.container.querySelector('.lwb-nav-item[data-icon="packs"]'))
    assert.equal(harness.pageRecord(), 'packs', 'the marketplace page is recorded')
    await harness.click(harness.container.querySelector('.lwb-cap-toggle'))
    assert.deepEqual(harness.navRecord(), ['pack-a'])
    await harness.click(harness.container.querySelector('.lwb-nav-item[data-icon="conversation"]'))
    assert.equal(harness.pageRecord(), 'conversation', 'returning to the conversation is recorded too')
  } finally {
    await harness.unload()
  }
})

test('compact packs expose every submenu without changing saved group preferences', async () => {
  const app = await mountSidebar({ collapsed: true, width: 56, seed: { [NAV_KEY]: JSON.stringify({ expandedPacks: ['pack-b'] }) } })
  try {
    await app.render()
    const toggle = app.container.querySelector('.lwb-cap-toggle')
    await app.click(toggle)
    const popup = app.window.document.querySelector('.lwb-cap-flyout')
    assert.ok(popup && !app.container.contains(popup), 'the flyout escapes the clipped sidebar')
    assert.equal(toggle.getAttribute('aria-expanded'), 'true')
    assert.equal(toggle.getAttribute('aria-controls'), popup.id)
    assert.deepEqual([...popup.querySelectorAll('button')].map((node) => node.textContent), ['Alpha Home', 'Alpha Runs'])
    assert.deepEqual(app.navRecord(), ['pack-b'], 'viewing the flyout preserves preferences')
    assert.equal(app.pageRecord(), null, 'opening a pack does not navigate to its first page')
    await app.click(popup.querySelectorAll('button')[1])
    assert.equal(app.window.document.querySelector('.lwb-cap-flyout'), null)
    assert.equal(JSON.parse(app.window.localStorage.getItem(WORKBENCH_KEY)).capabilityPage, 'pack-a:runs')
    assert.equal(app.window.document.activeElement, toggle)
    await app.click(toggle)
    assert.equal(app.window.document.querySelector('.lwb-cap-flyout [aria-current="page"]').textContent, 'Alpha Runs')
  } finally { await app.unload() }
})

test('flyouts support keyboard navigation, Escape and outside dismissal', async () => {
  const app = await mountSidebar({ collapsed: true, width: 56 })
  try {
    await app.render()
    const doc = app.window.document
    const toggle = app.container.querySelector('.lwb-cap-toggle')
    const key = (name) => new app.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })
    await app.dispatch(toggle, key('ArrowDown'))
    assert.equal(doc.activeElement.textContent, 'Alpha Home')
    await app.dispatch(doc.activeElement, key('ArrowDown'))
    assert.equal(doc.activeElement.textContent, 'Alpha Runs')
    await app.dispatch(doc.activeElement, key('Home'))
    assert.equal(doc.activeElement.textContent, 'Alpha Home')
    await app.dispatch(doc.activeElement, key('End'))
    assert.equal(doc.activeElement.textContent, 'Alpha Runs')
    await app.dispatch(doc.activeElement, key('Escape'))
    assert.equal(doc.querySelector('.lwb-cap-flyout'), null)
    assert.equal(doc.activeElement, toggle)
    await app.click(toggle)
    await app.dispatch(doc.body, new app.window.Event('pointerdown', { bubbles: true }))
    assert.equal(doc.querySelector('.lwb-cap-flyout'), null)
    await app.click(toggle)
    await app.dispatch(app.container.querySelector('.lwb-nav-item'), new app.window.FocusEvent('focusin', { bubbles: true }))
    assert.equal(doc.querySelector('.lwb-cap-flyout'), null, 'leaving with Tab also dismisses the flyout')
  } finally { await app.unload() }
})

test('only one flyout survives and layout, route, catalog changes clean it up', async () => {
  const app = await mountSidebar({ collapsed: true, width: 56 })
  let unloaded = false
  try {
    await app.render()
    const doc = app.window.document
    const open = () => app.click(app.container.querySelector('.lwb-cap-toggle'))
    await open()
    await app.click(app.container.querySelectorAll('.lwb-cap-toggle')[1])
    assert.equal(doc.querySelectorAll('.lwb-cap-flyout').length, 1)
    assert.equal(doc.querySelector('.lwb-cap-flyout').getAttribute('aria-label'), 'Beta')
    await app.click(app.container.querySelectorAll('.lwb-cap-toggle')[1])
    assert.equal(doc.querySelector('.lwb-cap-flyout'), null, 'clicking the trigger again closes it')
    await open()
    await app.click(app.container.querySelector('[data-icon="settings"]'))
    assert.equal(doc.querySelector('.lwb-cap-flyout'), null, 'route changes close the flyout')
    await open()
    await app.render({ collapsed: false, width: 248 })
    assert.equal(doc.querySelector('.lwb-cap-flyout'), null)
    await app.render({ collapsed: true, width: 56 })
    await open()
    await app.setMobile(true)
    assert.equal(doc.querySelector('.lwb-cap-flyout'), null)
    assert.equal(app.container.querySelector('.lwb-sidebar').dataset.collapsed, 'false')
    await app.setMobile(false)
    await open()
    app.setPacks([PACKS[1]])
    await app.refreshCatalog()
    assert.equal(doc.querySelector('.lwb-cap-flyout'), null, 'unloading a pack removes its flyout')
    await open()
    await app.unload()
    unloaded = true
    assert.equal(doc.querySelector('.lwb-cap-flyout'), null, 'unmount removes the portal')
  } finally { if (!unloaded) await app.unload() }
})

test('reopen controls delegate to the native layout and mobile uses full groups', async () => {
  for (const options of [{ collapsed: true, width: 56 }, { collapsed: true, width: 0 }, { collapsed: true, width: 0, windowsTitlebar: true }, { collapsed: true, width: 0, platform: 'darwin' }]) {
    const app = await mountSidebar(options)
    try {
      await app.render()
      const control = app.window.document.querySelector(options.width === 0 ? '.lwb-desktop-expand' : '.lwb-expand')
      assert.equal(control.getAttribute('aria-label'), '展开侧栏')
      assert.equal(control.className, options.width === 0 ? 'lwb-desktop-expand' : 'lwb-expand')
      // A zero-width column clips its own rail, so the desktop control has to
      // live outside the sidebar element; the stylesheet then places it in the
      // window chrome for both platforms.
      assert.equal(app.container.contains(control), options.width !== 0)
      await app.click(control)
      assert.equal(app.toggleCalls(), 1)
    } finally { await app.unload() }
  }
  const app = await mountSidebar({ mobile: true, collapsed: true, width: 0 })
  try {
    await app.render()
    await app.click(app.container.querySelector('.lwb-cap-toggle'))
    assert.deepEqual(app.groups()[0].menus, ['Alpha Home', 'Alpha Runs'])
    assert.equal(app.window.document.querySelector('.lwb-cap-flyout'), null)
    await app.click(app.container.querySelector('.lwb-collapse'))
    assert.equal(app.toggleCalls(), 0, 'closing the drawer does not change native sidebar layout')
    assert.equal(app.container.querySelector('.lwb-collapse').getAttribute('aria-label'), '关闭导航')
    await app.click(app.container.querySelectorAll('.lwb-cap-menu button')[1])
    assert.equal(app.container.querySelector('.lwb-sidebar').dataset.mobileOpen, 'false')
    assert.equal(JSON.parse(app.window.localStorage.getItem(WORKBENCH_KEY)).capabilityPage, 'pack-a:runs')
  } finally { await app.unload() }
})

test('the sidebar renders its own window chrome row ahead of every control', async () => {
  // The sidebar column's drag geometry is this row and nothing else: the shell
  // turns the mark into `-webkit-app-region: drag` for darwin only, and the
  // package that used to mark the column's chrome rows is disabled for this
  // composition. It has to precede the brand and collapse controls so their own
  // no-drag still wins over it, and it must exist in both column states because
  // a collapsed rail is still part of the window's top edge.
  for (const options of [{}, { collapsed: true, width: 56 }, { collapsed: true, width: 0 }, { mobile: true }]) {
    const app = await mountSidebar(options)
    try {
      await app.render()
      const sidebar = app.container.querySelector('.lwb-sidebar')
      const band = sidebar.querySelector('.lwb-sidebar-chrome')
      assert.ok(band, 'the sidebar marks a window chrome row')
      assert.equal(band.hasAttribute('data-window-drag'), true, 'the row carries the shell mark')
      assert.equal(sidebar.firstElementChild, band, 'the row leads the column, so controls subtract from it')
      assert.equal(band.getAttribute('aria-hidden'), 'true', 'the row is geometry, not content')
      assert.equal(band.textContent, '')
    } finally { await app.unload() }
  }
})
