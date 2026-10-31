/**
 * The Windows packaging preflight, exercised on a host that is not Windows.
 *
 * Everything under `process.platform === 'win32'` is unreachable from the
 * machines this repository is mostly developed on, and that is not a theoretical
 * gap: an ordering mistake inside the preflight — a constant read before its
 * declaration — passed every local check and failed a twenty-minute build on the
 * release runner. `LWB_CHECK_WINDOWS_LAUNCHER=1` makes `--check` claim the
 * Windows target so the branch runs here too.
 *
 * These tests run the real script rather than importing it: the failure mode
 * lives in module evaluation order, which only executing the module reproduces.
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SCRIPT = join(ROOT, 'lwb', 'desktop', 'package.mjs')
const run = promisify(execFile)
/** Claim the Windows target from a host that is not Windows. */
const CLAIM_WINDOWS = { LWB_CHECK_WINDOWS_LAUNCHER: '1' }

/** Run the packaging script in check mode and report its outcome either way. */
async function packagingCheck(flags) {
  try {
    const { stdout } = await run(process.execPath, [SCRIPT, '--check', '--edition', 'community', ...flags], {
      cwd: ROOT,
      env: { ...process.env, ...CLAIM_WINDOWS },
    })
    return { code: 0, output: stdout }
  } catch (error) {
    return { code: error.code, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

/** Whether this host can actually compile the launcher. */
async function hasGo() {
  try {
    await run('go', ['version'])
    return true
  } catch {
    return false
  }
}

test('a Windows check refuses a run that would ship an unpacked directory', async () => {
  // No --portable: the Electron target is `dir`, so there would be nothing to
  // hand a user. The refusal has to arrive here, not after the payload install.
  const result = await packagingCheck(['--unsigned'])
  assert.equal(result.code, 1)
  assert.match(result.output, /add --portable/u)
})

test('a Windows check refuses a signed build, which has no unpacked output to wrap', async () => {
  // The launch package is assembled around the unpacked output, and only the
  // unsigned flow says where that is. A signed Windows build therefore cannot
  // produce one, and must say so before spending anything.
  const result = await packagingCheck(['--portable'])
  assert.equal(result.code, 1)
  assert.match(result.output, /needs --unsigned/u)
})

test('the Windows preflight runs to completion on a host that is not Windows', async (t) => {
  if (!await hasGo()) return t.skip('no Go toolchain on this host')
  const result = await packagingCheck(['--portable', '--unsigned'])
  assert.equal(result.code, 0, result.output)
  // The toolchain is printed with its cache path: the one build input that
  // differs between a terminal account and the account a runner service uses.
  assert.match(result.output, /Launcher toolchain go version go\d+\.\d+/u)
  assert.match(result.output, /build cache\s+\//u)
  assert.match(result.output, /packaging environment passed/u)
})
