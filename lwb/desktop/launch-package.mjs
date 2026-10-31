/**
 * Assemble the Windows launch package: a stable launcher plus one archive of
 * the application it installs from.
 *
 * The previous Windows build was an electron-builder `portable` target, which
 * is a self-extracting NSIS shell: every double-click unpacks ~315 MB into a
 * temporary directory, runs the app, then deletes it. Nothing can be shown
 * while that happens, because no application code exists yet. This package
 * replaces the shell with a launcher that unpacks once into a reusable
 * directory under `%LOCALAPPDATA%` and only verifies it afterwards.
 *
 * The layout is a contract with `lwb/desktop/launcher`:
 *
 *   Laofu Workbench.exe                  the launcher (stable path, small)
 *   payload/win32-x64/manifest.json      what the archive is, and its checksum
 *   payload/win32-x64/app.zip            the unpacked Electron app
 *
 * The package directory is itself zipped for distribution, storing `app.zip`
 * uncompressed: it is already deflated, and deflating it again costs minutes of
 * CPU for no size. That outer zip is the single file the release channel, the
 * download page and the in-app updater all point at, so a first install and an
 * update are the same download.
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { spawnSync } from 'node:child_process'
import { writeZip } from './zip-writer.mjs'

/** Launcher executable name inside the package, and what users double-click. */
export const LAUNCHER_FILE_NAME = 'Laofu Workbench.exe'
/** Directory holding one platform's payload, relative to the package root. */
export const PAYLOAD_DIRECTORY = 'payload'
/** Archive name inside the payload directory. Fixed: the manifest carries the version. */
export const PAYLOAD_ARCHIVE = 'app.zip'
export const LAUNCH_PACKAGE_SCHEMA_VERSION = 1

/**
 * Platform-architecture directory the launcher looks in, matching the
 * `payload/%s-%s` pattern in the launcher itself.
 * @param platform - Node `process.platform` of the target.
 * @param arch - Target architecture.
 * @returns the relative payload directory, e.g. `win32-x64`.
 */
export function payloadDirectoryName(platform, arch) {
  return `${platform}-${arch}`
}

/**
 * Where every part of the package lives inside one output directory.
 * @param directory - artifact directory of the edition and target.
 * @returns absolute paths of the package root, launcher, manifest and archive.
 */
export function launchPackageLayout(directory) {
  return {
    root: join(directory, 'launch-package'),
    launcher: join(directory, 'launch-package', LAUNCHER_FILE_NAME),
  }
}

/**
 * Resolve electron-builder's artifact-name template for the outer zip.
 *
 * The template is the edition's, so the launch package keeps the product's
 * naming: `laofu-workbench-0.1.9-win-x64-unsigned.zip`. A launch package is
 * never a `.exe`, so `${ext}` becomes `zip` whatever the template said.
 * @param options - template inputs.
 * @param options.artifactName - edition artifact name template.
 * @param options.version - version being packaged, including any `-test.N`.
 * @param options.platform - Node `process.platform` of the target.
 * @param options.arch - Target architecture.
 * @param options.unsigned - whether this is an unsigned build.
 * @returns the file name, without any directory.
 */
export function launchPackageFileName({ artifactName, version, platform, arch, unsigned }) {
  if (typeof artifactName !== 'string' || artifactName.trim() === '') throw new Error('launchPackageFileName needs an artifact name template.')
  const os = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : platform
  const name = artifactName
    .replace(/\$\{version\}/gu, version)
    .replace(/\$\{os\}/gu, os)
    .replace(/\$\{arch\}/gu, arch)
    .replace(/\$\{ext\}/gu, 'zip')
    .replace(/\.zip$/u, `${unsigned ? '-unsigned' : ''}.zip`)
  if (!name.endsWith('.zip') || name.endsWith('-unsigned.zip') !== unsigned) {
    throw new Error(`Could not derive a launch package name from "${artifactName}".`)
  }
  if (/[\\/]/u.test(name)) throw new Error(`Launch package name must not contain a path: ${name}`)
  return name
}

/** Streamed SHA-256 and byte size of one file. */
export async function fingerprint(path) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  const { size } = await stat(path)
  return { sha256: hash.digest('hex'), sizeBytes: size }
}

/**
 * The manifest the launcher reads before it trusts the archive beside it.
 * @param options - payload description.
 * @param options.product - ATS product slug.
 * @param options.productName - human-readable product name.
 * @param options.version - version of the app inside the archive.
 * @param options.platform - Node `process.platform` of the target.
 * @param options.arch - Target architecture.
 * @param options.channel - release channel.
 * @param options.sha256 - archive checksum.
 * @param options.sizeBytes - archive size.
 * @returns the manifest object to serialize.
 */
export function payloadManifest({ product, productName, version, platform, arch, channel, sha256, sizeBytes }) {
  if (!/^[a-f0-9]{64}$/u.test(sha256)) throw new Error(`Payload checksum must be a lowercase sha256, got "${sha256}".`)
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1) throw new Error(`Payload size must be a positive integer, got ${sizeBytes}.`)
  return {
    schemaVersion: LAUNCH_PACKAGE_SCHEMA_VERSION,
    product,
    productName,
    version,
    platform,
    arch,
    channel,
    artifactType: 'unpacked-zip',
    fileName: PAYLOAD_ARCHIVE,
    sha256,
    sizeBytes,
  }
}

/**
 * Build the package directory and the distributable zip in one step.
 * @param options - assembly inputs.
 * @param options.appDirectory - unpacked Electron app, as electron-builder left it.
 * @param options.directory - artifact directory of the edition and target.
 * @param options.launcherBinary - the built launcher executable.
 * @param options.artifactName - edition artifact name template.
 * @param options.product - ATS product slug.
 * @param options.productName - human-readable product name.
 * @param options.version - version of the app being packaged.
 * @param options.platform - Node `process.platform` of the target.
 * @param options.arch - Target architecture.
 * @param options.channel - release channel.
 * @param options.unsigned - whether this is an unsigned build.
 * @param options.verify - install the package through the launcher before
 *   shipping it; off only for tests and for a non-Windows host.
 * @param options.log - output sink.
 * @returns the outer zip path, its fingerprint, and the payload manifest.
 */
export async function assembleLaunchPackage({
  appDirectory, directory, launcherBinary, artifactName, product, productName,
  version, platform, arch, channel = 'stable', unsigned = true,
  verify = process.env.LWB_LAUNCHER_SELFCHECK !== '0', log = console.log,
}) {
  const executable = await stat(appDirectory).catch(() => undefined)
  if (!executable?.isDirectory()) throw new Error(`No unpacked application at ${appDirectory}.`)
  const launcher = await stat(launcherBinary).catch(() => undefined)
  if (!launcher?.isFile()) throw new Error(`No launcher executable at ${launcherBinary}.`)

  const payloadDirectory = join(directory, 'launch-package', PAYLOAD_DIRECTORY, payloadDirectoryName(platform, arch))
  // A stale package is refused rather than half-overwritten: the archive inside
  // it would otherwise describe a build that no longer exists.
  await rm(join(directory, 'launch-package'), { recursive: true, force: true })
  await mkdir(payloadDirectory, { recursive: true })

  const { launcher: launcherPath } = launchPackageLayout(directory)
  await copyFile(launcherBinary, launcherPath)

  const archive = join(payloadDirectory, PAYLOAD_ARCHIVE)
  log(`  archiving ${appDirectory} -> ${archive}`)
  const written = await writeZip({ source: appDirectory, output: archive, level: 1 })
  const { sha256, sizeBytes } = await fingerprint(archive)
  const manifest = payloadManifest({ product, productName, version, platform, arch, channel, sha256, sizeBytes })
  await writeFile(join(payloadDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  log(`  payload ${PAYLOAD_ARCHIVE}  ${sizeBytes} bytes  ${written.entries} entries  sha256 ${sha256.slice(0, 12)}…`)

  if (verify) {
    await verifyPackage(launcherPath, log)
  }

  const file = launchPackageFileName({ artifactName, version, platform, arch, unsigned })
  const output = join(directory, file)
  log(`  packaging launcher + payload -> ${output}`)
  await writeZip({
    source: join(directory, 'launch-package'),
    output,
    level: 9,
    // `app.zip` and the launcher are the two large entries. The archive is
    // already deflated; the launcher is worth compressing, so only the former
    // is stored verbatim.
    store: name => name.endsWith('.zip'),
  })
  const outer = await fingerprint(output)
  log(`  package ${file}  ${outer.sizeBytes} bytes  sha256 ${outer.sha256}`)
  return { file, path: output, ...outer, manifest, payload: { path: archive, sha256, sizeBytes } }
}

/**
 * Install the package through its own launcher, into a throwaway directory.
 *
 * This is the only check that proves the thing about to be published actually
 * works: that the launcher finds its manifest, trusts the archive, and can
 * unpack it. Every failure mode it covers — a wrong `payload/<platform>-<arch>`
 * path, a manifest that disagrees with the archive, an entry the extractor
 * refuses — would otherwise surface on a user's machine, after a 300 MB
 * download.
 * @param launcherPath - the launcher inside the assembled package.
 * @param log - output sink.
 */
async function verifyPackage(launcherPath, log) {
  const root = await mkdtemp(join(tmpdir(), 'lwb-launcher-verify-'))
  try {
    log('  installing the package through the launcher to verify it')
    const result = spawnSync(launcherPath, ['--verify-bootstrap'], {
      env: { ...process.env, LWB_VERIFY_ROOT: root, LWB_LAUNCHER_ROOT: root },
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 10 * 60_000,
      windowsHide: true,
    })
    if (result.error !== undefined) throw new Error(`Launcher self-check could not run: ${result.error.message}`)
    if (result.status !== 0) {
      const detail = (result.stderr ?? '').toString().trim()
      throw new Error(`Launcher self-check failed (exit ${result.status})${detail === '' ? '' : `: ${detail}`}. The log is in %LOCALAPPDATA%\\LaofuWorkbench\\launcher.log.`)
    }
    log('  self-check passed: the package installs and verifies')
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {})
  }
}
