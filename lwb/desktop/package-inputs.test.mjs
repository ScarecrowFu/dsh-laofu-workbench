import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import {
  COMMERCIAL_PACKS_DIR, ELECTRON_MIRROR_FALLBACK, artifactDirectory, artifactExtensions, commercialPackCandidates,
  payloadInstallArguments, releaseChecksumUrl, resolveBuildNumber, resolveCommercialPackDir, resolveEditionName,
  resolveElectronMirror, resolveHostTarget, resolveTargetArch, unpackedApp, unsignedPackagingEnvironment,
} from './package-inputs.mjs'

const ROOT = '/repo'
const SIBLING = join(ROOT, '..', 'dsh-laofu-workbench-commercial')
const EXPLICIT = join(ROOT, '..', 'pack-checkout')

/** Existence check over the `packs/` directories of the given checkouts and nothing else. */
function checkoutExists(...directories) {
  const folders = new Set(directories.map(directory => join(directory, COMMERCIAL_PACKS_DIR)))
  return path => folders.has(path)
}

test('the edition is validated before any build work', () => {
  assert.equal(resolveEditionName(undefined), 'commercial')
  assert.equal(resolveEditionName('community'), 'community')
  assert.equal(resolveEditionName(' commercial '), 'commercial')
  assert.equal(resolveEditionName(undefined, 'community'), 'community')
  assert.throws(() => resolveEditionName('official'), /Unknown Desktop edition "official"/u)
})

test('the target follows the build host and rejects unsupported hosts', () => {
  assert.equal(resolveHostTarget('darwin', 'arm64'), 'mac-arm64')
  assert.equal(resolveHostTarget('darwin', 'x64'), 'mac-x64')
  assert.equal(resolveHostTarget('win32', 'x64'), 'win-x64')
  assert.equal(resolveHostTarget('win32', 'arm64'), 'win-x64', 'the Windows target is x64 on every host arch')
  assert.throws(() => resolveHostTarget('linux', 'x64'), /supports macOS and Windows build hosts/u)
})

test('the target architecture follows the host unless one is requested', () => {
  assert.equal(resolveTargetArch('darwin', undefined, 'arm64'), 'arm64')
  assert.equal(resolveTargetArch('darwin', 'arm64', 'arm64'), 'arm64')
  assert.equal(resolveTargetArch('darwin', 'x64', 'arm64'), 'x64', 'Apple Silicon builds x64 through Rosetta')
  assert.equal(resolveTargetArch('darwin', undefined, 'x64'), 'x64')
  assert.equal(resolveTargetArch('win32', undefined, 'x64'), 'x64')
  assert.equal(resolveTargetArch('win32', 'x64', 'x64'), 'x64')
  assert.equal(resolveTargetArch('darwin', 'arm64', undefined), 'arm64', 'a dry-run for another host skips feasibility')
})

test('the target architecture rejects what the platform cannot produce', () => {
  assert.throws(() => resolveTargetArch('darwin', 'arm64', 'x64'), /Apple Silicon build host/u)
  assert.throws(() => resolveTargetArch('win32', 'arm64', 'x64'), /x64 only/u)
  assert.throws(() => resolveTargetArch('win32', 'x64', 'arm64'), /Windows x64 build host/u)
  assert.throws(() => resolveTargetArch('linux', 'x64', 'x64'), /macOS and Windows build hosts/u)
  assert.throws(() => resolveTargetArch('darwin', 'ia32', 'arm64'), /Unknown Desktop architecture "ia32"/u)
})

test('cross-architecture payload installs select the target optional dependencies', () => {
  assert.deepEqual(payloadInstallArguments('darwin', 'arm64', 'darwin', 'arm64'), [], 'a native build needs no override')
  assert.deepEqual(payloadInstallArguments('win32', 'x64', 'win32', 'x64'), [])
  assert.deepEqual(payloadInstallArguments('darwin', 'x64', 'darwin', 'arm64'), ['--os=darwin', '--cpu=x64'])
  assert.deepEqual(payloadInstallArguments('win32', 'x64', 'darwin', 'arm64'), ['--os=win32', '--cpu=x64'])
})

test('artifact paths and extensions follow the resolved target', () => {
  assert.equal(artifactDirectory(ROOT, 'commercial', 'mac-arm64'), join(ROOT, '.tooling', 'artifacts', 'commercial', 'mac-arm64'))
  assert.deepEqual(artifactExtensions('mac-arm64'), ['.zip', '.dmg'])
  assert.deepEqual(artifactExtensions('mac-x64'), ['.zip', '.dmg'])
  assert.deepEqual(artifactExtensions('win-x64'), ['.zip'], 'Windows ships a launch package, not a bare executable')
})

test('the unpacked app path follows the target layout', () => {
  const mac = unpackedApp(join('/out', 'mac-arm64'), 'mac-arm64', 'Laofu Workbench')
  assert.equal(mac.app, join('/out', 'mac-arm64', 'mac-arm64', 'Laofu Workbench.app'))
  assert.equal(mac.manifest, join(mac.app, 'Contents', 'Resources', 'lwb-product', 'build.json'))
  assert.equal(mac.launch, `open "${mac.app}"`)

  const macX64 = unpackedApp(join('/out', 'mac-x64'), 'mac-x64', 'Laofu Workbench')
  assert.equal(macX64.app, join('/out', 'mac-x64', 'mac', 'Laofu Workbench.app'), 'electron-builder names the x64 bundle directory `mac`')

  const win = unpackedApp(join('/out', 'win-x64'), 'win-x64', 'Laofu Workbench')
  assert.equal(win.app, join('/out', 'win-x64', 'win-unpacked', 'Laofu Workbench.exe'))
  assert.equal(win.manifest, join('/out', 'win-x64', 'win-unpacked', 'resources', 'lwb-product', 'build.json'))
  assert.equal(win.launch, `"${win.app}"`)
})

test('the build number prefers an explicit request, then CI, then the local date', () => {
  const now = new Date('2026-10-06T12:00:00')
  assert.equal(resolveBuildNumber('7', {}, now), '7')
  assert.equal(resolveBuildNumber(undefined, { LWB_DESKTOP_BUILD_NUMBER: '20261006' }, now), '20261006')
  assert.equal(resolveBuildNumber(undefined, { GITHUB_RUN_NUMBER: '42' }, now), '42')
  assert.equal(resolveBuildNumber('9', { LWB_DESKTOP_BUILD_NUMBER: '1' }, now), '9', 'an explicit request outranks the environment')
  assert.equal(resolveBuildNumber(undefined, {}, new Date('2026-01-09T00:00:00')), '20260109', 'the default is the local date, zero padded')
  assert.equal(resolveBuildNumber(undefined, { LWB_DESKTOP_BUILD_NUMBER: '  ' }, now), '20261006', 'a blank environment value falls through')
  assert.throws(() => resolveBuildNumber('v2', {}, now), /must be numeric/u)
  assert.throws(() => resolveBuildNumber(undefined, { LWB_DESKTOP_BUILD_NUMBER: '2026-10-06' }, now), /must be numeric/u)
})

test('an explicit commercial pack checkout is authoritative and validated', () => {
  assert.deepEqual(resolveCommercialPackDir({
    env: { LWB_COMMERCIAL_PACK_DIR: EXPLICIT },
    projectRoot: ROOT,
    exists: checkoutExists(EXPLICIT, SIBLING),
  }), { directory: EXPLICIT, source: 'LWB_COMMERCIAL_PACK_DIR' })

  assert.throws(() => resolveCommercialPackDir({
    env: { LWB_COMMERCIAL_PACK_DIR: join(ROOT, '..', 'missing') },
    projectRoot: ROOT,
    exists: checkoutExists(SIBLING),
  }), /is not a commercial pack checkout/u, 'a wrong explicit path never falls back to a sibling checkout')
})

test('a sibling checkout is discovered by its packs directory', () => {
  assert.deepEqual(resolveCommercialPackDir({
    env: {},
    projectRoot: ROOT,
    exists: checkoutExists(SIBLING),
  }), { directory: SIBLING, source: 'sibling checkout' })

  // A checkout that is itself a pack, with no packs/ directory, is not a commercial checkout.
  assert.throws(() => resolveCommercialPackDir({
    env: {},
    projectRoot: ROOT,
    exists: path => path === join(SIBLING, 'lwb-pack.json'),
  }), /LWB_COMMERCIAL_PACK_DIR/u)
})

test('the commercial pack candidates stay beside the repository', () => {
  assert.deepEqual(commercialPackCandidates(ROOT), [
    SIBLING,
    join(ROOT, '..', 'laofu-commercial-pack'),
  ])
})

test('an explicit Electron mirror wins and is never probed', async () => {
  let probed = 0
  const resolved = await resolveElectronMirror({
    env: { ELECTRON_MIRROR: 'https://mirror.example/electron/' },
    version: '44.0.0',
    probe: async () => { probed += 1; return false },
  })
  assert.deepEqual(resolved, { mirror: 'https://mirror.example/electron/', source: 'ELECTRON_MIRROR' })
  assert.equal(probed, 0)
})

test('the mirror fallback is used only when the release host cannot serve the checksum', async () => {
  const probes = []
  const reachable = await resolveElectronMirror({
    env: {},
    version: '44.0.0',
    probe: async (url) => { probes.push(url); return url === releaseChecksumUrl('44.0.0') },
  })
  assert.deepEqual(reachable, { mirror: undefined, source: 'release host' })
  assert.deepEqual(probes, [releaseChecksumUrl('44.0.0')], 'the release host is tried first and alone')

  const blocked = await resolveElectronMirror({
    env: {},
    version: '44.0.0',
    probe: async url => url === `${ELECTRON_MIRROR_FALLBACK}44.0.0/SHASUMS256.txt`,
  })
  assert.deepEqual(blocked, { mirror: ELECTRON_MIRROR_FALLBACK, source: 'mirror fallback' })

  const neither = await resolveElectronMirror({ env: {}, version: '44.0.0', probe: async () => false })
  assert.deepEqual(neither, { mirror: undefined, source: 'no reachable download source' })

  const unknown = await resolveElectronMirror({
    env: {},
    probe: async () => { probes.push('unexpected'); return true },
  })
  assert.deepEqual(unknown, { mirror: undefined, source: 'unknown Electron version' })
})

test('the release checksum URL is the file @electron/get fetches', () => {
  assert.equal(releaseChecksumUrl('44.0.0'), 'https://github.com/electron/electron/releases/download/v44.0.0/SHASUMS256.txt')
})

test('probing disabled keeps the release host without any request', async () => {
  let probed = 0
  const disabled = await resolveElectronMirror({
    env: { LWB_ELECTRON_MIRROR: 'off' },
    version: '44.0.0',
    probe: async () => { probed += 1; return false },
  })
  assert.deepEqual(disabled, { mirror: undefined, source: 'probing disabled' })
  assert.equal(probed, 0, 'opting out skips the probe entirely')
})

test('an unsigned build drops release credentials but keeps the npm registry', () => {
  const environment = unsignedPackagingEnvironment({
    PATH: '/usr/bin',
    HOME: '/Users/build',
    DSH_DESKTOP_APP_ID: 'com.deepseek.official',
    DSH_DESKTOP_NPM_REGISTRY: 'https://registry.npmmirror.com',
    APPLE_ID: 'release@example.com',
    APPLE_APP_SPECIFIC_PASSWORD: 'secret',
    CSC_LINK: 'certificate.p12',
    WIN_CSC_LINK: 'certificate.pfx',
    DOWNLOAD_TEST_ORIGIN: 'https://updates.example.com',
    DOWNLOAD_PROD_ORIGIN: 'https://production.example.com',
  })
  /* Everything a signed release owns is gone: a test build must not be able to
     sign, notarize, or point an installed app at a production feed. */
  for (const name of ['DSH_DESKTOP_APP_ID', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'CSC_LINK', 'WIN_CSC_LINK', 'DOWNLOAD_TEST_ORIGIN', 'DOWNLOAD_PROD_ORIGIN']) {
    assert.equal(environment[name], undefined, `${name} must not reach an unsigned build`)
  }
  assert.equal(environment.PATH, '/usr/bin', 'ordinary variables pass through')
  assert.equal(environment.HOME, '/Users/build')
  /* The registry is the one DSH_DESKTOP_ variable that is a package source rather
     than a credential. The pinned preparation reads it from there and nowhere else,
     so dropping it leaves a network that cannot reach registry.npmjs.org with no way
     to build at all — and nothing in the output naming the override that would have
     fixed it. */
  assert.equal(environment.DSH_DESKTOP_NPM_REGISTRY, 'https://registry.npmmirror.com')
  assert.deepEqual(unsignedPackagingEnvironment({}), {})
})