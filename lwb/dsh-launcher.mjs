import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { LWB_RUNTIME } from './dsh-bundle/runtime-config.mjs'
import { busyReport, claimHostLock } from './host-lock.mjs'
import { assertUpstream, DSH_ROOT } from './upstream.mjs'
import { prepareLwbProfile } from './profile-setup.mjs'

// One product home serves one host. Two of them would share a session store and
// fight over the same conversations — the fish pond would report whichever fish
// the other window is holding as `already owned by an active write handle`.
// Claim before touching the profile so a second start cannot race the first.
const ONE_SHOT = new Set(['--dump-config', '--dump-default-config', '--dump-config-schema', '--version', '-V', '--help', '-h'])
const claim = await claimHostLock({
  home: LWB_RUNTIME.productHome,
  role: 'web',
  // A config dump or a help screen answers and exits; it must work while a host runs.
  skip: process.argv.slice(2).some(argument => ONE_SHOT.has(argument)),
})
if (!claim.owned) {
  process.stderr.write(busyReport({ holder: claim.holder, file: claim.file }))
  process.exit(1)
}
claim.releaseOnExit()

assertUpstream()
await prepareLwbProfile()
const ROOT_DIR = LWB_RUNTIME.projectRoot
const cliArgs = [join(DSH_ROOT, 'apps', 'cli', 'lib', 'bin.js'), '--profile', LWB_RUNTIME.profileId, ...process.argv.slice(2)]
const child = spawn(process.execPath, cliArgs, {
  cwd: ROOT_DIR,
  env: { ...process.env, DSH_HOME: LWB_RUNTIME.dshHome, LWB_DSH_HOME: LWB_RUNTIME.dshHome },
  stdio: 'inherit',
})
// The launcher is not the host: record the process that actually serves, so the
// lock outlives this wrapper if it is killed and a stray child keeps running.
if (child.pid !== undefined) await claim.update({ pid: child.pid })

const forwardSignal = (signal) => child.kill(signal)
process.once('SIGINT', () => forwardSignal('SIGINT'))
process.once('SIGTERM', () => forwardSignal('SIGTERM'))
child.once('error', (error) => {
  console.error(error)
  claim.releaseSync()
  process.exit(1)
})
child.once('exit', (code, signal) => {
  // Re-raising a signal ends this process without an `exit` event, so the
  // claim has to go first.
  claim.releaseSync()
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
