/** Package LWB around the unmodified official shell and verified runtime. */
import { execFile, execFileSync, spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs, promisify } from 'node:util'
import { assertUpstream, DSH_ROOT, UPSTREAM } from '../upstream.mjs'
import { LWB_RUNTIME } from '../dsh-bundle/runtime-config.mjs'
import { desktopPnpmInvocation } from './toolchain.mjs'
import { loadEditionManifest, resolveEdition } from './editions.mjs'
import { assembleProductPayload } from './payload.mjs'
import { relinkDarwinLibraries } from './darwin-library-paths.mjs'
import { artifactDirectory, payloadInstallArguments, resolveHostTarget, resolveTargetArch, unsignedPackagingEnvironment } from './package-inputs.mjs'
import { assembleLaunchPackage } from './launch-package.mjs'

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
// The Windows launcher is compiled from Go source during this run, so the
// toolchain is a build input like any other. Checking it here means a host that
// cannot produce a launch package says so in the first second, instead of after
// the payload install and the Electron preparation.
if (values.portable === true && process.platform === 'win32' && values.dir !== true) await assertLauncherToolchain()
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
  ...(unsigned ? { unsigned: true, version: buildVersion, output: artifactDirectory(LWB_RUNTIME.projectRoot, edition.name, resolveHostTarget(process.platform, arch)) } : {}),
}
const config = join(stage, 'electron-builder.config.mjs')
await writeFile(config, `export default await (await import(${JSON.stringify(new URL('./package-config.mjs', import.meta.url).href)})).createLwbPackageConfig(${JSON.stringify(payload)}, ${JSON.stringify(identity)})\n`)
// The target architecture is explicit: the builder otherwise follows the
// process architecture, which is the build host rather than the package.
await pnpm(['exec', 'electron-builder', '--config', config, '--publish', 'never', `--${arch}`, ...(values.dir ? ['--dir'] : [])])
if (portable && process.platform === 'win32' && !values.dir) {
  // The launch package is assembled around the unpacked output, which only the
  // unsigned flow publishes: a signed build writes wherever upstream decided.
  if (!identity.output) throw new Error('The Windows launch package needs the unsigned flow, which is the only one that names its output directory.')
  await packageForLauncher({ directory: identity.output, arch, buildVersion, edition, unsigned })
}
assertUpstream()
console.log(`LWB Desktop package created for edition "${edition.name}" through the official builder; no artifacts were published.`)

/**
 * Wrap the unpacked Windows build in the launch package.
 *
 * electron-builder leaves an unpacked directory because the Windows target is
 * `dir`; this turns it into what users download: a launcher plus one archive of
 * that directory. The launcher unpacks once into `%LOCALAPPDATA%` and reuses it
 * afterwards, which is the whole point of not shipping the `portable` target.
 * @param options - packaging inputs.
 * @param options.directory - artifact directory of the edition and target.
 * @param options.arch - target architecture.
 * @param options.buildVersion - version this build reports, including any `-test.N`.
 * @param options.edition - resolved edition.
 * @param options.unsigned - whether this is an unsigned build.
 */
async function packageForLauncher({ directory, arch, buildVersion, edition, unsigned }) {
  const app = join(directory, 'win-unpacked')
  const launcher = await buildLauncher(buildVersion)
  console.log(`\nWrapping ${app} in a launch package (launcher ${launcher})`)
  await assembleLaunchPackage({
    appDirectory: app,
    directory,
    launcherBinary: launcher,
    artifactName: edition.artifactName,
    product: 'laofu-workbench',
    productName: edition.productName,
    version: buildVersion,
    platform: 'win32',
    arch,
    unsigned,
  })
}

/** Go release the launcher source needs: `min`/`max` builtins and 1.22 language features. */
const LAUNCHER_GO_VERSION = Object.freeze({ major: 1, minor: 22 })

/**
 * Prove this host can compile the launcher before the build spends minutes
 * producing something it cannot package.
 *
 * The launcher is compiled from source on every packaging run, so the Go
 * toolchain is a build input. The two ways it goes wrong on a Windows build host
 * both look like "the build failed late": no `go` on PATH, or a self-hosted
 * runner service that still holds the environment it was started with.
 * @returns the toolchain version, as reported by `go version`.
 */
async function assertLauncherToolchain() {
  const cwd = join(LWB_RUNTIME.projectRoot, 'lwb', 'desktop', 'launcher')
  let reported
  try {
    reported = (await execFileAsync('go', ['version'], { cwd })).stdout.trim()
  } catch (error) {
    throw new Error([
      `The Windows launch package is compiled from Go source, and this build host has no usable Go toolchain (${error.code ?? error.message}).`,
      `Install Go ${LAUNCHER_GO_VERSION.major}.${LAUNCHER_GO_VERSION.minor}+ and make sure it is on the PATH the build actually runs with.`,
      'A self-hosted runner keeps the environment it started with: restart the runner service (or the machine) after installing Go.',
      'To package without a toolchain, set LWB_LAUNCHER_BINARY to a prebuilt launcher.',
    ].join(' '))
  }
  const match = /go version go(\d+)\.(\d+)/u.exec(reported)
  if (match === null) throw new Error(`Could not read a Go version out of "${reported}".`)
  const major = Number(match[1])
  const minor = Number(match[2])
  const current = major * 1000 + minor
  if (current < LAUNCHER_GO_VERSION.major * 1000 + LAUNCHER_GO_VERSION.minor) {
    throw new Error(`The launcher needs Go ${LAUNCHER_GO_VERSION.major}.${LAUNCHER_GO_VERSION.minor}+ but this host reports "${reported}". An older toolchain would try to fetch a newer one first, which a build host without network cannot do.`)
  }
  console.log(`Launcher toolchain ${reported}`)
  return reported
}

/**
 * The launcher binary, built from `lwb/desktop/launcher` with the version this
 * build reports.
 *
 * `LWB_LAUNCHER_BINARY` skips the compile on a host without a Go toolchain, but
 * a release build must not fall back to a stale artifact: the launcher ships
 * inside the package, so the wrong one is a wrong download.
 * @param version - version to stamp into the binary.
 * @returns absolute path of the executable to package.
 */
async function buildLauncher(version) {
  const prebuilt = process.env.LWB_LAUNCHER_BINARY
  if (prebuilt) {
    const info = await stat(prebuilt).catch(() => undefined)
    if (!info?.isFile()) throw new Error(`LWB_LAUNCHER_BINARY points at ${prebuilt}, which is not a file.`)
    console.log(`Using the launcher at ${prebuilt} (LWB_LAUNCHER_BINARY, ${info.size} bytes) — it is not rebuilt by this run.`)
    return prebuilt
  }
  const output = join(LWB_RUNTIME.projectRoot, '.tooling', 'launcher', 'laofu-workbench-launcher.exe')
  await mkdir(dirname(output), { recursive: true })
  const started = Date.now()
  try {
    await run('go', [
      'build', '-trimpath',
      // `windowsgui` keeps a console window from flashing up; `-s -w` drops the
      // debug tables the launcher has no use for. The version is stamped in
      // because the package records which launcher it carries.
      '-ldflags', `-H windowsgui -s -w -X main.launcherVersion=${version}`,
      '-o', output, '.',
    ], join(LWB_RUNTIME.projectRoot, 'lwb', 'desktop', 'launcher'), {
      // The target is this package's, not the host's: a Windows-on-ARM build
      // host or a Go default would otherwise produce a binary the package
      // claims is x64 but is not.
      ...env,
      GOOS: 'windows',
      GOARCH: arch === 'arm64' ? 'arm64' : 'amd64',
      CGO_ENABLED: '0',
    })
  } catch (error) {
    throw new Error(`Could not build the Windows launcher (${error.message}). See the "Windows 启动器包" section of docs/37-desktop-parity.md for what this host needs.`)
  }
  const { size } = await stat(output)
  console.log(`  launcher ${version} built in ${Date.now() - started} ms (${size} bytes)`)
  return output
}
