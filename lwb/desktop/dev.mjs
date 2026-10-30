/** Reuse the official Desktop launcher with LWB's profile and entry policy. */
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { LWB_RUNTIME } from '../dsh-bundle/runtime-config.mjs'
import { busyReport, claimHostLock } from '../host-lock.mjs'
import { assertUpstream, DSH_ROOT } from '../upstream.mjs'
import { prepareLwbProfile } from '../profile-setup.mjs'
import { desktopPnpmInvocation } from './toolchain.mjs'
import { desktopDevelopmentEnvironment } from './profile.mjs'

// Same gate as the web launcher: one host per product home. This one also
// covers `npm run dev` (web) and `npm run dev:desktop` racing each other.
const claim = await claimHostLock({ home: LWB_RUNTIME.productHome, role: 'desktop' })
if (!claim.owned) {
  process.stderr.write(busyReport({ holder: claim.holder, file: claim.file }))
  process.exit(1)
}
claim.releaseOnExit()

assertUpstream()
const appRoot = join(DSH_ROOT, 'apps', 'desktop')
const profile = join(LWB_RUNTIME.dshHome, 'profiles', 'desktop')
await prepareLwbProfile(profile)
const environment = {
  ...process.env,
  ...desktopDevelopmentEnvironment(LWB_RUNTIME, profile),
  DSH_DESKTOP_OPEN_DEVTOOLS: process.env.DSH_DESKTOP_OPEN_DEVTOOLS || '0',
  DSH_DESKTOP_USER_DATA_DIR: join(LWB_RUNTIME.productHome, 'electron-user-data'),
  LWB_DESKTOP_ENTRY_URL: pathToFileURL(join(appRoot, 'lib/main.js')).href,
  NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${new URL('./entry-policy.mjs', import.meta.url).href}`].filter(Boolean).join(' '),
}
// The official launcher prepares its runtime project and bundled interpreters.
// DSH_DESKTOP_DSH_DIR is its runtime project, not the repository root.
delete environment.DSH_DESKTOP_DSH_DIR
delete environment.ELECTRON_RUN_AS_NODE
const invocation = desktopPnpmInvocation(appRoot, ['run', process.argv.includes('--skip-build') ? 'start' : 'dev'])
const child = spawn(invocation.command, invocation.args, { cwd: appRoot, env: environment, stdio: 'inherit' })
if (child.pid !== undefined) await claim.update({ pid: child.pid })
child.once('error', (error) => {
  console.error(error)
  claim.releaseSync()
  process.exitCode = 1
})
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal))
child.once('exit', (code) => {
  claim.releaseSync()
  process.exitCode = code ?? 1
})
