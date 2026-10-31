/** Package LWB around the unmodified official shell and verified runtime. */
import { execFile, execFileSync, spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs, promisify } from 'node:util'
import { assertUpstream, DSH_ROOT, UPSTREAM } from '../upstream.mjs'
import { LWB_RUNTIME } from '../dsh-bundle/runtime-config.mjs'
import { desktopPnpmInvocation } from './toolchain.mjs'
import { loadEditionManifest, resolveEdition } from './editions.mjs'
import { assembleProductPayload } from './payload.mjs'
import { relinkDarwinLibraries } from './darwin-library-paths.mjs'
import { payloadInstallArguments, resolveHostTarget, resolveTargetArch, unsignedPackagingEnvironment } from './package-inputs.mjs'

assertUpstream()
const { values } = parseArgs({
  options: {
    dir: { type: 'boolean' },
    check: { type: 'boolean' },
    plan: { type: 'boolean' },
    edition: { type: 'string' },
    arch: { type: 'string' },
    unsigned: { type: 'boolean' },
    portable: { type: 'boolean' },
    release: { type: 'boolean' },
  },
})
/**
 * macOS x64 packaging executes the target Electron while preparing the runtime,
 * so an Apple Silicon host needs Rosetta 2.
 * @param targetArch - Architecture being packaged.
 */
function assertRosetta(targetArch) {
  if (process.platform !== 'darwin' || targetArch !== 'x64' || process.arch === 'x64') return
  try {
    execFileSync('/usr/bin/arch', ['-x86_64', '/usr/bin/true'], { stdio: 'ignore' })
  } catch {
    throw new Error('macOS x64 packaging on Apple Silicon needs Rosetta 2; install it with "softwareupdate --install-rosetta --agree-to-license".')
  }
}
const arch = resolveTargetArch(process.platform, values.arch ?? process.env.LWB_DESKTOP_TARGET_ARCH, process.arch)
const execFileAsync = promisify(execFile)
// A capability pack ships only when this repository owns its manifest. A pack
// cloned or copied into lwb/packs/ is a local installation, not product source;
// packaging it would ship unversioned third-party code inside the app. The
// registry is the supported way to install an external or private pack.
const packsDir = join(LWB_RUNTIME.projectRoot, 'lwb', 'packs')
const ownedPacks = new Set(
  (await execFileAsync('git', ['ls-files', 'lwb/packs/*/lwb-pack.json'], { cwd: LWB_RUNTIME.projectRoot }))
    .stdout.split('\n').filter(Boolean).map(line => line.split('/')[2]),
)
for (const entry of await readdir(packsDir, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name.startsWith('.')) continue
  if (!ownedPacks.has(entry.name)) {
    throw new Error(`lwb/packs/${entry.name} is not owned by this repository; remove it, or register it as an external pack with "npm run pack:install -- <directory>".`)
  }
}
// The edition decides which capability packs this build ships. Resolving it
// before the packaging environment means a wrong pack set fails without any
// signing or notarization material.
const editionManifest = await loadEditionManifest(LWB_RUNTIME.projectRoot)
const edition = await resolveEdition(editionManifest, values.edition ?? editionManifest.default, {
  projectRoot: LWB_RUNTIME.projectRoot,
  ownedPacks,
})
const packList = edition.packs.map(pack => `${pack.id}@${pack.version}`).join(', ')
if (values.plan) {
  console.log(`LWB edition "${edition.name}" ships ${edition.packs.length} capability pack(s): ${packList}`)
  for (const pack of edition.packs) console.log(`  ${pack.id} <- ${pack.source}`)
  console.log(`  productName ${edition.productName} | productHome ${edition.productHome} | scheme ${edition.protocolScheme}://`)
  process.exit(0)
}
// Only a real package preparation executes the target Electron; a plan does not.
assertRosetta(arch)
const appRoot = join(DSH_ROOT, 'apps/desktop')
const { loadDesktopPackageEnvironment, validateDesktopPackageEnvironment } = await import(pathToFileURL(join(appRoot, 'scripts/desktop-package-environment.mjs')))
const unsigned = values.unsigned === true
const portable = values.portable === true
const release = values.release === true || process.env.LWB_DESKTOP_RELEASE === '1'
const env = unsigned ? unsignedPackagingEnvironment(process.env) : loadDesktopPackageEnvironment(process.platform)
if (unsigned) {
  Object.assign(env, {
    DSH_DESKTOP_APP_ID: 'com.scitiger.laofu.workbench',
    DSH_DESKTOP_UNSIGNED: '1',
    LWB_DESKTOP_PORTABLE: portable ? '1' : '0',
    LWB_DESKTOP_UNSIGNED: '1',
    LWB_DESKTOP_UNSIGNED_DSH_ROOT: DSH_ROOT,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    ...(process.platform === 'win32' ? { ELECTRON_BUILDER_7Z_FILTER: 'BCJ' } : {}),
  })
  const registration = new URL('./unsigned-register.mjs', import.meta.url).href
  env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ''} --import=${registration}`.trim()
}
// Never distribute an LWB app which an official DSH update can replace.
if (!env.DSH_DESKTOP_APP_ID || env.DSH_DESKTOP_APP_ID.startsWith('com.deepseek.')) throw new Error('Configure an LWB-owned DSH_DESKTOP_APP_ID in the official local packaging environment.')
if (!unsigned && (env.DSH_DESKTOP_AUTO_UPDATE_ENV !== 'test' || !env.DOWNLOAD_TEST_ORIGIN)) throw new Error('LWB packaging requires its own test update origin; official production feeds are not allowed.')
for (const key of ['DOWNLOAD_TEST_ORIGIN', 'DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN']) {
  if (env[key] && /(^|\.)deepseek\.com$/u.test(new URL(env[key]).hostname)) throw new Error(`LWB requires a product-owned ${key}`)
}
Object.assign(env, { DSH_DESKTOP_TARGET_PLATFORM: process.platform, DSH_DESKTOP_TARGET_ARCH: arch })
if (process.platform === 'darwin' && arch !== process.arch) {
  console.log(`Packaging mac-${arch} on an ${process.arch} host through Rosetta; the first launch of the bundle is slower than native.`)
}
if (!unsigned) validateDesktopPackageEnvironment(env, { platform: process.platform, arch })
if (values.check) { console.log(`LWB packaging environment passed for edition "${edition.name}" (${packList}).`); process.exit(0) }
const run = (command, args, cwd, environment = env) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, env: environment, stdio: 'inherit' })
  child.once('error', reject)
  child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Packaging step failed (${code})`)))
})
const pnpm = async (args) => { const invocation = desktopPnpmInvocation(appRoot, args); await run(invocation.command, invocation.args, appRoot) }
// Upstream owns release packing, runtime preparation, dependency and native checks.
if (unsigned) await pnpm(['exec', 'tsx', fileURLToPath(new URL('./prepare-unsigned.mjs', import.meta.url))])
else await pnpm(['run', 'prepare:package'])
await mkdir(join(LWB_RUNTIME.projectRoot, '.tooling'), { recursive: true })
const stage = await mkdtemp(join(LWB_RUNTIME.projectRoot, '.tooling/lwb-package-'))
const payload = join(stage, 'product')
await mkdir(payload)
// The product version, and whether this build *is* that version. A `-test.N`
// package is built to verify a change, not to be the product: it must never be
// offered as an update, and it must never look like the release with the same
// numbers, so both facts are recorded in the build and folded into its id.
const productVersion = JSON.parse(await readFile(join(LWB_RUNTIME.projectRoot, 'package.json'), 'utf8')).version
const buildNumber = env.LWB_DESKTOP_BUILD_NUMBER ?? env.GITHUB_RUN_NUMBER ?? '1'
if (!/^\d+$/u.test(buildNumber)) throw new Error('Desktop test build number must be numeric')
const isRelease = !unsigned || release
const buildVersion = isRelease ? productVersion : `${productVersion}-test.${buildNumber}`
const digest = createHash('sha256')
  .update(UPSTREAM.commit)
  .update(`version:${buildVersion}`)
  // The target fixes the bundled interpreter and native-dependency
  // architecture; without it one architecture could reuse the other's
  // writable runtime copy under the same build id.
  .update(`target:${resolveHostTarget(process.platform, arch)}`)
  .update(`edition:${edition.name}`)
  .update(`product:${edition.productName}:${edition.productHome}:${edition.protocolScheme}`)
// Packs come only from the resolved edition; see lwb/desktop/payload.mjs.
await assembleProductPayload({
  projectRoot: LWB_RUNTIME.projectRoot,
  edition,
  payload,
  onFile: async (key, source) => { digest.update(key).update(await readFile(source)) },
})
for (const path of ['bootstrap.mjs', 'entry-policy.mjs', 'registry-migration.mjs']) {
  digest.update(`desktop-entry:${path}`).update(await readFile(join(LWB_RUNTIME.projectRoot, 'lwb', 'desktop', path)))
}
for (const path of ['package.json', 'package-lock.json']) await cp(join(LWB_RUNTIME.projectRoot, path), join(payload, path))
// Install only the product's declared production dependencies; never package
// checkout node_modules, credentials, local state, or upstream source backups.
// A cross-architecture build selects this target's optional packages instead of
// the host's, so the payload never carries the other architecture's binaries.
if (!process.env.npm_execpath) throw new Error('Run Desktop packaging through npm run package:desktop.')
await run(process.execPath, [process.env.npm_execpath, 'ci', '--omit=dev', '--no-audit', '--no-fund',
  ...payloadInstallArguments(process.platform, arch)], payload)
// The product signature below carries the hardened runtime, which refuses
// relative library paths; native dependencies must load from their own
// directory. The rewritten bytes are part of the build id, so an existing
// runtime copy with the old bytes can never masquerade as this payload.
if (process.platform === 'darwin') {
  const relinked = await relinkDarwinLibraries(join(payload, 'node_modules'), { log: message => console.log(message) })
  for (const entry of relinked.patched) digest.update(`native-libraries:${entry.file}:${entry.sha256}`)
}
digest.update(await readFile(join(payload, 'package-lock.json')))
await writeFile(join(payload, 'build.json'), JSON.stringify({
  id: digest.digest('hex').slice(0, 24),
  edition: edition.name,
  productName: edition.productName,
  productHome: edition.productHome,
  unsigned,
  upstream: UPSTREAM,
  // What the update client needs to describe this installation to ATS, and to
  // decide whether this build is allowed to replace itself at all.
  version: buildVersion,
  release: isRelease,
  product: 'laofu-workbench',
  channel: 'stable',
  platform: process.platform,
  arch,
}))
const identity = {
  productName: edition.productName,
  artifactName: edition.artifactName.replace('.${ext}', `${portable ? '-portable' : ''}${unsigned ? '-unsigned' : ''}.${'${ext}'}`),
  protocolScheme: edition.protocolScheme,
  portable,
  targetPlatform: process.platform,
  targetArch: arch,
  ...(unsigned ? { unsigned: true, version: buildVersion, output: join(LWB_RUNTIME.projectRoot, '.tooling', 'artifacts', edition.name, `${process.platform === 'darwin' ? 'mac' : 'win'}-${arch}`) } : {}),
}
const config = join(stage, 'electron-builder.config.mjs')
await writeFile(config, `export default await (await import(${JSON.stringify(new URL('./package-config.mjs', import.meta.url).href)})).createLwbPackageConfig(${JSON.stringify(payload)}, ${JSON.stringify(identity)})\n`)
// The target architecture is explicit: the builder otherwise follows the
// process architecture, which is the build host rather than the package.
await pnpm(['exec', 'electron-builder', '--config', config, '--publish', 'never', `--${arch}`, ...(values.dir ? ['--dir'] : [])])
assertUpstream()
console.log(`LWB Desktop package created for edition "${edition.name}" through the official builder; no artifacts were published.`)
