import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')

test('readonly official conversations block input and branching while preserving viewing controls', () => {
  // The surface falls back to a product-level notice constant, so the snippet
  // has to take that declaration with it — the assertion is about behaviour,
  // and a stubbed notice would hide a broken default.
  const noticeStart = source.indexOf('const DEFAULT_READ_ONLY_NOTICE')
  const noticeEnd = source.indexOf('\n', noticeStart) + 1
  assert.ok(noticeStart >= 0 && noticeEnd > noticeStart, 'the read-only notice has a default')
  const start = source.indexOf('function ReadOnlyConversationSurface(')
  const end = source.indexOf('\n    }', start) + 6
  const effects = [], cleanups = [], writes = []
  const previous = { reason: 'existing blocker' }
  let block = previous, disconnected = false, update
  const send = {}, copy = { getAttribute: () => '复制' }, branch = { getAttribute: () => '分支' }
  const card = { hidden: false, inert: false, querySelectorAll: () => [send] }
  const seat = { style: {}, querySelector: selector => selector === '[data-composer-card]' ? card : null, querySelectorAll: () => [send] }
  const element = { querySelectorAll: selector => selector.includes('composer') ? [seat] : [copy, branch] }
  const surface = vm.runInNewContext(`(() => { ${source.slice(noticeStart, noticeEnd)} return (${source.slice(start, end)}); })()`, {
    React: { useRef: () => ({ current: element }), useLayoutEffect: effect => effects.push(effect) },
    h: (_component, props) => props,
    services: { composerBlocks: () => ({ storeFor: () => ({ getSnapshot: () => block }), set: (_id, value) => { block = value; writes.push(value) } }), locale: { bind: () => () => '分支' } },
    MutationObserver: class { constructor(callback) { update = callback } observe() {} disconnect() { disconnected = true } },
  })
  const props = surface({ sessionId: 'arena-session', children: 'official-chat' })
  for (const effect of effects) cleanups.push(effect())
  assert.notEqual(block, previous)
  assert.equal(seat.style.display, 'contents')
  assert.equal(card.inert, true)
  assert.equal(card.hidden, true)
  assert.equal(send.disabled, true)
  assert.equal(branch.disabled, true)
  assert.equal(copy.disabled, undefined)
  const lateSend = {}; card.querySelectorAll = () => [lateSend]; update()
  assert.equal(lateSend.disabled, true)
  let refused = 0
  props.onClickCapture({ target: { closest: selector => selector.includes('data-composer-card') ? card : null }, preventDefault() { refused++ }, stopPropagation() { refused++ } })
  assert.equal(refused, 2)
  props.onClickCapture({ target: { closest: () => null }, preventDefault() { refused++ }, stopPropagation() { refused++ } })
  assert.equal(refused, 2)
  for (const cleanup of cleanups) cleanup?.()
  assert.equal(block, previous)
  assert.equal(disconnected, true)
  assert.equal(writes.length, 2)
})

function packFixture() {
  const functions = ['currentSessionId', 'PackConversationPlaceholder', 'packSessionArmed',
    'mountedPackPanelSession', 'collapsePackPanel', 'focusSession', 'armPackSession', 'releasePackSession',
    'toggleEmbeddedRightbar', 'settlePanelGesture', 'collapseWhenSettled']
    .map(name => {
      const start = source.indexOf(`function ${name}(`)
      const end = source.indexOf('\n    }', start) + 6
      assert.ok(start >= 0 && end > start, name)
      return source.slice(start, end)
    }).join('\n')
  const opened = []
  const registrations = []
  const frames = []
  const current = { key: 'original' }
  let mounted = 'original'
  let expanded = true
  const services = {
    sessions: { list: { getSnapshot: () => ({ byId: { original: {}, external: {} } }) } },
    uiSession: { adapter: { current: { getSnapshot: () => current } } },
    layout: { panelInfo: { getSnapshot: () => ({ activePanelId: null }) } },
    sidebarRight: { mounted: { getSnapshot: () => mounted },
      isExpanded: () => expanded, toggleExpanded: () => { expanded = !expanded } },
    uiWorkspace: { openSession(id) { opened.push(id); current.key = id } },
    slots: {
      inject(_name, callback) { return callback() },
      register(options, component) {
        const registration = { options, component, disposed: false }
        registrations.push(registration)
        return () => { registration.disposed = true }
      },
    },
  }
  const api = vm.runInNewContext(`(() => {
    const embeddedHostSessions = new Map(), packSessionRendered = new Set(['a', 'b']);
    let packSessionRestore = null, packConversationDispose, packSessionInset = null,
      pendingPanelCollapse, packPanelEpoch = 0;
    const installPackSessionInset = () => { packSessionInset = () => {} };
    ${functions}
    return { armPackSession, releasePackSession, focusSession, toggleEmbeddedRightbar, settlePanelGesture };
  })()`, { services, h: () => null, requestAnimationFrame: fn => frames.push(fn) })
  return { ...api, opened, registrations, current, services,
    flushFrames: () => { for (const fn of frames.splice(0)) fn() },
    setMounted: id => { mounted = id }, isExpanded: () => expanded }
}

test('pack cards share one placeholder and restore the selected Session after the last unmount', () => {
  const f = packFixture()
  f.armPackSession('a')
  f.armPackSession('b')
  f.armPackSession('a')
  assert.equal(f.registrations.length, 1)
  assert.equal(f.registrations[0].options.name, 'main.conversation')
  assert.equal(f.registrations[0].options.priority, -10)
  f.focusSession('a')
  // The Sidebar has not mounted yet: repeated focus must still be idempotent.
  f.focusSession('a')
  f.focusSession('a', { keepExpanded: true })
  assert.deepEqual(f.opened, ['a'])
  f.releasePackSession('a')
  f.releasePackSession('b')
  assert.equal(f.registrations[0].disposed, false)
  f.setMounted('a')
  f.releasePackSession('a')
  assert.equal(f.isExpanded(), false)
  assert.deepEqual(f.opened, ['a', 'original'])
  assert.equal(f.registrations[0].disposed, true)
})

test('leaving pack mode preserves a selection made elsewhere and restores the official slot', () => {
  const f = packFixture()
  f.armPackSession('a')
  f.focusSession('a')
  f.current.key = 'external'
  f.releasePackSession('a')
  assert.deepEqual(f.opened, ['a'])
  assert.equal(f.registrations[0].disposed, true)
  f.armPackSession('b')
  assert.equal(f.registrations.length, 2)
})

test('a stale Sidebar seat does not prevent selecting its card again', () => {
  const f = packFixture()
  f.armPackSession('a')
  f.armPackSession('b')
  f.focusSession('a')
  f.setMounted('a')
  f.focusSession('b')
  f.focusSession('a')
  assert.deepEqual(f.opened, ['a', 'b', 'a'])
})

test('the official slot is restored even when restoring the previous Session fails', () => {
  const f = packFixture()
  f.armPackSession('a')
  f.focusSession('a')
  f.services.uiWorkspace.openSession = () => { throw new Error('removed session') }
  assert.throws(() => f.releasePackSession('a'), /removed session/u)
  assert.equal(f.registrations[0].disposed, true)
})

test('the Sidebar button opens a remembered expanded seat and ignores superseded gestures', () => {
  const f = packFixture()
  f.armPackSession('a')
  f.armPackSession('b')
  f.toggleEmbeddedRightbar('a', true)
  f.setMounted('a')
  f.flushFrames()
  assert.equal(f.isExpanded(), true)
  f.toggleEmbeddedRightbar('a', false)
  assert.equal(f.isExpanded(), false)
  f.toggleEmbeddedRightbar('b', true)
  f.focusSession('a')
  f.setMounted('b')
  f.flushFrames()
  assert.equal(f.isExpanded(), false)
})

test('repeated focus within a card gesture preserves the owed panel collapse', () => {
  const f = packFixture()
  f.armPackSession('a')
  f.focusSession('a')
  f.focusSession('a')
  f.setMounted('a')
  f.settlePanelGesture()
  f.flushFrames()
  assert.equal(f.isExpanded(), false)
  assert.deepEqual(f.opened, ['a'])
})

function fixture({ throws } = {}) {
  const timers = new Set()
  const opened = []
  const delivered = []
  const failures = []
  const sessions = { retain(sessionId, options) {
    if (throws) throw throws
    const opening = Promise.withResolvers()
    const reference = { sessionId, ready: opening.promise, releases: 0, release() { this.releases++ } }
    opened.push({ reference, opening, options })
    return reference
  } }
  const start = source.indexOf('function retainEmbeddedSession(')
  const end = source.indexOf('function EmbeddedConversationHost(', start)
  const retain = vm.runInNewContext(`(${source.slice(start, end)})`, {
    services: { sessions }, AbortController, Promise, Error,
    setTimeout(fn) { timers.add(fn); return fn },
    clearTimeout(fn) { timers.delete(fn) },
  })
  return {
    timers, opened, delivered, failures,
    retain: (id) => retain(id, ref => delivered.push(ref), error => failures.push(error)),
    expire: () => { for (const fn of [...timers]) fn() },
  }
}

test('concurrent cards open independently and retain ready sessions until unmount', async () => {
  const f = fixture()
  const releaseA = f.retain('a')
  const releaseB = f.retain('b')
  f.opened[1].opening.resolve()
  await Promise.resolve()
  assert.deepEqual(f.delivered.map(ref => ref.sessionId), ['b'])
  assert.equal(f.opened[1].reference.releases, 0)
  assert.equal(f.timers.size, 1)
  f.opened[0].opening.resolve()
  await Promise.resolve()
  assert.equal(f.timers.size, 0)
  releaseA()
  releaseB()
  releaseB()
  assert.deepEqual(f.opened.map(item => item.reference.releases), [1, 1])
  assert.ok(f.opened.every(item => item.options.signal.aborted))
})

test('a stalled card times out once, releases only its reference, and ignores late readiness', async () => {
  const f = fixture()
  f.retain('stalled')
  f.expire()
  assert.equal(f.failures.length, 1)
  assert.match(f.failures[0].message, /加载超时/u)
  assert.equal(f.opened[0].reference.releases, 1)
  assert.equal(f.opened[0].options.signal.aborted, true)
  assert.equal(f.timers.size, 0)
  f.opened[0].opening.resolve()
  await Promise.resolve()
  assert.equal(f.delivered.length, 0)
  assert.equal(f.failures.length, 1)
  f.retain('stalled')
  f.opened[1].opening.resolve()
  await Promise.resolve()
  assert.equal(f.delivered[0], f.opened[1].reference)
})

test('leaving during loading cancels the waiter without publishing an error', async () => {
  const f = fixture()
  const release = f.retain('leaving')
  release()
  f.expire()
  f.opened[0].opening.reject(new Error('cancelled'))
  await Promise.resolve()
  assert.equal(f.delivered.length, 0)
  assert.equal(f.failures.length, 0)
  assert.equal(f.opened[0].reference.releases, 1)
})

test('synchronous and asynchronous failures clear the deadline and release references', async () => {
  const error = new Error('unavailable')
  const sync = fixture({ throws: error })
  sync.retain('missing')
  assert.equal(sync.failures[0], error)
  assert.equal(sync.timers.size, 0)
  const async = fixture()
  async.retain('broken')
  async.opened[0].opening.reject(error)
  await Promise.resolve()
  assert.equal(async.failures[0], error)
  assert.equal(async.timers.size, 0)
  assert.equal(async.opened[0].reference.releases, 1)
})
