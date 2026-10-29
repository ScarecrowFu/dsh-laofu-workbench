import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, stat, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveBrowserExecutable, packagedBrowser } from '../browser-shim.mjs'

const posix = process.platform !== 'win32' ? test : test.skip

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'lwb-browser-shim-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

/**
 * An explicitly named binary is a decision this module must not second-guess:
 * wrapping it would silently override what the user asked for.
 */
test('an explicit LWB_BROWSER_EXECUTABLE is returned untouched', async (t) => {
  const root = await workspace(t)
  const resolved = resolveBrowserExecutable({ environment: { LWB_BROWSER_EXECUTABLE: ' /Applications/Some Chrome.app ' }, directory: root })
  assert.equal(resolved, '/Applications/Some Chrome.app')
  await assert.rejects(stat(join(root, 'chromium-nosandbox.sh')), { code: 'ENOENT' })
})

/**
 * The whole point of the shim: the mounted provider can only be steered through
 * `executablePath`, so the flag that keeps its sandbox from killing the renderer
 * has to arrive as part of the binary it launches.
 */
posix('an unset override yields an executable shim that adds --no-sandbox', async (t) => {
  const root = await workspace(t)
  const shim = resolveBrowserExecutable({ environment: {}, directory: root, binary: '/tmp/Chrome for Testing' })
  assert.equal(shim, join(root, 'chromium-nosandbox.sh'))
  const body = await readFile(shim, 'utf8')
  assert.match(body, /^#!\/bin\/sh\n/u)
  assert.match(body, /exec '\/tmp\/Chrome for Testing' --no-sandbox "\$@"\n$/u)
  const mode = (await stat(shim)).mode & 0o777
  assert.equal(mode, 0o755)
})

/**
 * A warm start must not rewrite the file: the shim is unchanged, and touching it
 * on every activation turns a no-op boot into a disk write per Session.
 */
posix('a second resolution leaves an identical shim alone', async (t) => {
  const root = await workspace(t)
  const options = { environment: {}, directory: root, binary: '/tmp/Chrome' }
  const first = resolveBrowserExecutable(options)
  const before = await stat(first)
  await new Promise((resolve) => setTimeout(resolve, 20))
  const second = resolveBrowserExecutable(options)
  assert.equal(second, first)
  assert.equal((await stat(second)).mtimeMs, before.mtimeMs)
})

/** A space or a quote in the path is normal on macOS; the shim has to survive both. */
posix('a path with a quote is escaped rather than breaking the script', async (t) => {
  const root = await workspace(t)
  const shim = resolveBrowserExecutable({ environment: {}, directory: root, binary: "/tmp/it's here/Chrome" })
  const body = await readFile(shim, 'utf8')
  assert.match(body, /exec '\/tmp\/it'\\''s here\/Chrome' --no-sandbox "\$@"\n$/u)
})

/**
 * A browser that cannot be found must not stop the Session from being composed:
 * `undefined` leaves the provider on its own default, which is a browser that
 * may crash rather than a job that refuses to start.
 */
test('an unresolvable browser degrades to undefined instead of throwing', async (t) => {
  const root = await workspace(t)
  const resolved = resolveBrowserExecutable({ environment: {}, runtime: join(root, 'nowhere'), directory: root })
  assert.equal(resolved, undefined)
})

/** The wrapped binary has to be the one the mounted driver would pick itself. */
test('the packaged browser is the one playwright-core reports', () => {
  const binary = packagedBrowser()
  assert.match(binary, /(chrome-headless-shell|Chromium|Google Chrome for Testing|chrome)$/u)
})
