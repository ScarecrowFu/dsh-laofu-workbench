import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  ALLOW_MULTI_HOST,
  busyReport,
  claimHostLock,
  hostLockPath,
  isHostAlive,
  multiHostAllowed,
  readHostLock,
} from '../host-lock.mjs'

const MODULE = fileURLToPath(new URL('../host-lock.mjs', import.meta.url))

/** A product home nobody else is using, removed when the test ends. */
async function home(t) {
  const root = await mkdtemp(join(tmpdir(), 'lwb-host-lock-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

/** A pid that has already exited. */
async function deadPid() {
  const child = spawn(process.execPath, ['-e', '0'], { stdio: 'ignore' })
  await new Promise(resolve => child.once('exit', resolve))
  return child.pid
}

test('the first host owns a free product home', async (t) => {
  const root = await home(t)
  const claim = await claimHostLock({ home: root, role: 'web' })
  t.after(() => claim.release())

  assert.equal(claim.owned, true)
  assert.equal(claim.skipped, false)
  assert.equal(claim.record.pid, process.pid)
  assert.equal(claim.record.role, 'web')
  const written = JSON.parse(await readFile(hostLockPath(root), 'utf8'))
  assert.equal(written.pid, process.pid)
})

test('a second host over the same home is refused and names the first', async (t) => {
  const root = await home(t)
  const first = await claimHostLock({ home: root })
  t.after(() => first.release())

  const second = await claimHostLock({ home: root })
  assert.equal(second.owned, false)
  assert.equal(second.reason, 'busy')
  assert.equal(second.holder.pid, process.pid)
  assert.equal(second.file, hostLockPath(root))
})

test('a host that died without releasing is taken over', async (t) => {
  const root = await home(t)
  await mkdir(join(root, 'runtime'), { recursive: true })
  await writeFile(hostLockPath(root), JSON.stringify({
    pid: await deadPid(), role: 'web', token: 'gone', startedAt: '2026-01-01T00:00:00.000Z',
  }))

  const claim = await claimHostLock({ home: root })
  t.after(() => claim.release())
  assert.equal(claim.owned, true)
  assert.equal(readHostLock(root).pid, process.pid)
})

test('a half-written lock file is taken over', async (t) => {
  const root = await home(t)
  await mkdir(join(root, 'runtime'), { recursive: true })
  await writeFile(hostLockPath(root), '{"pid": 4')

  const claim = await claimHostLock({ home: root })
  t.after(() => claim.release())
  assert.equal(claim.owned, true)
})

test('update republishes the record for the process that really serves', async (t) => {
  const root = await home(t)
  const claim = await claimHostLock({ home: root })
  t.after(() => claim.release())

  await claim.update({ pid: 4321, url: 'http://127.0.0.1:56335' })
  assert.equal(claim.record.pid, 4321)
  const written = JSON.parse(await readFile(hostLockPath(root), 'utf8'))
  assert.equal(written.pid, 4321)
  assert.equal(written.url, 'http://127.0.0.1:56335')
})

test('release drops the file, and a handle that lost the home leaves it alone', async (t) => {
  const root = await home(t)
  const claim = await claimHostLock({ home: root })
  assert.equal(await claim.release(), true)
  assert.equal(await claim.release(), false)
  assert.equal(readHostLock(root), undefined)

  // Somebody claimed the home while our handle was stale: it must not delete
  // a lock it no longer owns.
  const other = await claimHostLock({ home: root })
  t.after(() => other.release())
  const theirs = await readFile(hostLockPath(root), 'utf8')
  assert.equal(await claim.release(), false)
  assert.equal(await readFile(hostLockPath(root), 'utf8'), theirs)
})

test('the environment can permit a second host', async (t) => {
  const root = await home(t)
  const first = await claimHostLock({ home: root })
  t.after(() => first.release())

  assert.equal(multiHostAllowed({ [ALLOW_MULTI_HOST]: '1' }), true)
  assert.equal(multiHostAllowed({ [ALLOW_MULTI_HOST]: 'no' }), false)
  assert.equal(multiHostAllowed({}), false)
  const second = await claimHostLock({ home: root, env: { [ALLOW_MULTI_HOST]: 'yes' } })
  assert.equal(second.owned, true)
  assert.equal(second.skipped, true)
  // Callers wire the handle up either way, so a skipped claim still answers.
  await second.update({ pid: 1 })
  assert.equal(await second.release(), false)
  assert.equal(second.releaseSync(), false)
  assert.doesNotThrow(() => second.releaseOnExit())
  assert.equal(readHostLock(root)?.pid, process.pid)
})

test('a caller that only sometimes serves can skip the gate', async (t) => {
  const root = await home(t)
  const claim = await claimHostLock({ home: root, skip: true })
  assert.equal(claim.owned, true)
  assert.equal(claim.skipped, true)
  assert.equal(readHostLock(root), undefined)
})

test('the busy report names the holder, when it started, and where the file is', () => {
  const now = new Date('2026-10-30T14:30:00').getTime()
  const report = busyReport({
    holder: { pid: 90797, startedAt: new Date('2026-10-30T14:02:00').toISOString(), url: 'http://127.0.0.1:56335' },
    file: '/tmp/LaofuWorkbench/runtime/host.json',
    now,
  })
  assert.match(report, /90797/u)
  assert.match(report, /14:02:00/u)
  assert.match(report, /http:\/\/127\.0\.0\.1:56335/u)
  assert.match(report, /\/tmp\/LaofuWorkbench\/runtime\/host\.json/u)
  assert.match(report, new RegExp(ALLOW_MULTI_HOST, 'u'))
})

test('the busy report survives a record that says nothing useful', () => {
  const report = busyReport({ holder: undefined, file: '/tmp/host.json' })
  assert.match(report, /未知/u)
  assert.match(report, /启动时间不明/u)
})

test('a pid that has exited reads as dead, and our own reads as alive', async () => {
  assert.equal(isHostAlive(await deadPid()), false)
  assert.equal(isHostAlive(process.pid), true)
  assert.equal(isHostAlive(0), false)
  assert.equal(isHostAlive('12'), false)
})

test('a claim needs a product home', async () => {
  await assert.rejects(() => claimHostLock({}), /product home is required/u)
})

test('a carrier that exits without releasing leaves no lock behind', async (t) => {
  const root = await home(t)
  const script = `import { claimHostLock } from ${JSON.stringify(MODULE)}
    const claim = await claimHostLock({ home: ${JSON.stringify(root)} })
    claim.releaseOnExit()
    process.exit(claim.owned ? 0 : 1)`
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: 'inherit' })
  const code = await new Promise(resolve => child.once('exit', resolve))
  assert.equal(code, 0)
  assert.deepEqual(await readdir(join(root, 'runtime')).catch(() => []), [])
})
