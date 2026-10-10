/**
 * Resolve the inputs one-click Desktop packaging needs beyond the edition
 * manifest: the build host's target, the private commercial pack checkout, the
 * test build number, and the Electron download source.
 *
 * Everything here is a pure decision over injected facts (`exists`, `readJson`,
 * `probe`, the clock), so the packaging runner can fail loudly before an
 * expensive build starts, and the decisions are unit-testable without a build.
 */
import { join } from 'node:path'

/** Edition names the Desktop manifest accepts. */
export const EDITION_NAMES = ['community', 'commercial']

/** Capability-pack id the commercial edition declares its private source for. */
export const COMMERCIAL_PACK_ID = 'model-review'

/**
 * Electron release host, used only as a fallback. Corporate proxies commonly
 * allow the npm registry but not `github.com`, where @electron/get fetches the
 * release checksum file on every run.
 */
export const ELECTRON_MIRROR_FALLBACK = 'https://cdn.npmmirror.com/binaries/electron/'

/**
 * Variables an unsigned test build must not inherit from the operator's shell:
 * Apple notary and signing credentials, Windows signing credentials, and the
 * production update feed.
 */
const UNSIGNED_ENV_DENY = /^(?:DSH_DESKTOP_|APPLE_|CSC_|WIN_CSC_|DOWNLOAD_(?:TEST|PROD)_)/u

/**
 * The one `DSH_DESKTOP_` variable that carries a package *source* rather than a
 * credential.
 */
export const NPM_REGISTRY_ENV = 'DSH_DESKTOP_NPM_REGISTRY'

/**
 * Environment for the unsigned packaging chain: what the operator exported, minus
 * the variables that belong to a signed release.
 *
 * `DSH_DESKTOP_NPM_REGISTRY` has to survive. The pinned preparation resolves its
 * registry from that variable alone and otherwise falls back to
 * `https://registry.npmjs.org/`, so a blanket `DSH_DESKTOP_` filter leaves the one
 * documented override unreachable -- on a network that cannot reach the default
 * registry that is a build which cannot be produced at all, and nothing in the
 * output names the override that would have fixed it. It picks a package source,
 * not a credential, so unsigned mode keeps it.
 *
 * @param environment - the operator's environment.
 * @returns a shallow copy safe to hand to the unsigned packaging chain.
 */
export function unsignedPackagingEnvironment(environment) {
  return Object.fromEntries(Object.entries(environment).filter(([name]) => (
    name === NPM_REGISTRY_ENV || !UNSIGNED_ENV_DENY.test(name)
  )))
}

/**
 * Resolve the edition to package.
 * @param value - `--edition` value, or undefined for the default.
 * @param fallback - Edition used when no value is given.
 * @returns the validated edition name.
 */
export function resolveEditionName(value, fallback = 'commercial') {
  const edition = (value ?? fallback).trim()
  if (!EDITION_NAMES.includes(edition)) {
    throw new Error(`Unknown Desktop edition "${edition}"; expected one of ${EDITION_NAMES.join(', ')}.`)
  }
  return edition
}

/**
 * Resolve the Desktop target of the build host. The official preparation binds
 * the target platform to the host, so cross-building is not supported: a Windows
 * package is built on Windows, on the release runner or a local Windows host.
 * @param platform - `process.platform` of the build host.
 * @param arch - `process.arch` of the build host.
 * @returns the supported target name.
 */
export function resolveHostTarget(platform, arch) {
  if (platform === 'darwin') return arch === 'x64' ? 'mac-x64' : 'mac-arm64'
  if (platform === 'win32') return 'win-x64'
  throw new Error(`Desktop packaging supports macOS and Windows build hosts; this host is ${platform}.`)
}

/**
 * File extensions one target's distributable artifacts use.
 * @param target - resolved target name.
 * @returns the extensions to report and checksum.
 */
export function artifactExtensions(target) {
  return target.startsWith('mac-') ? ['.zip', '.dmg'] : ['.exe']
}

/**
 * Directory one edition writes its artifacts to for a target.
 * @param projectRoot - repository root.
 * @param edition - resolved edition name.
 * @param target - resolved target name.
 * @returns absolute artifact directory.
 */
export function artifactDirectory(projectRoot, edition, target) {
  return join(projectRoot, '.tooling', 'artifacts', edition, target)
}

/**
 * Where electron-builder leaves the unpacked app of one run, plus the product
 * build manifest inside it. Deriving this from the target reports what the run
 * produced instead of whatever else appeared in the artifact directory.
 * @param directory - artifact directory of the edition and target.
 * @param target - resolved target name.
 * @param productName - product name of the edition being packaged.
 * @returns the app path, its build manifest, and how to launch it.
 */
export function unpackedApp(directory, target, productName) {
  if (target.startsWith('mac-')) {
    const app = join(directory, target, `${productName}.app`)
    return { app, manifest: join(app, 'Contents', 'Resources', 'lwb-product', 'build.json'), launch: `open "${app}"` }
  }
  const app = join(directory, 'win-unpacked', `${productName}.exe`)
  return { app, manifest: join(directory, 'win-unpacked', 'resources', 'lwb-product', 'build.json'), launch: `"${app}"` }
}

/**
 * Resolve the test build number: an explicit request, the environment CI sets,
 * or the local date so consecutive builds do not overwrite each other.
 * @param requested - `--build-number` value.
 * @param env - process environment.
 * @param now - clock, for the date default.
 * @returns a numeric build number.
 */
export function resolveBuildNumber(requested, env, now = new Date()) {
  const candidates = [requested, env.LWB_DESKTOP_BUILD_NUMBER, env.GITHUB_RUN_NUMBER]
  for (const candidate of candidates) {
    if (candidate === undefined || String(candidate).trim() === '') continue
    const value = String(candidate).trim()
    if (!/^\d+$/u.test(value)) throw new Error(`Desktop test build number must be numeric, got "${value}".`)
    return value
  }
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}${month}${day}`
}

/**
 * Sibling checkouts a commercial pack source is expected at, in probe order.
 * @param projectRoot - repository root.
 * @returns absolute candidate directories.
 */
export function commercialPackCandidates(projectRoot) {
  return [
    join(projectRoot, '..', 'dsh-laofu-workbench-commercial'),
    join(projectRoot, '..', 'laofu-commercial-pack'),
  ]
}

/**
 * Read one candidate commercial pack directory.
 * @param directory - candidate directory.
 * @param exists - path-existence check.
 * @param readJson - JSON reader.
 * @returns the pack directory, or undefined when the candidate is not a pack.
 */
function readCommercialPack(directory, exists, readJson) {
  const manifestPath = join(directory, 'lwb-pack.json')
  if (!exists(manifestPath) || !exists(join(directory, 'package.json'))) return undefined
  const manifest = readJson(manifestPath)
  if (manifest?.id !== COMMERCIAL_PACK_ID) {
    throw new Error(`${manifestPath} declares pack "${manifest?.id}"; the commercial edition needs "${COMMERCIAL_PACK_ID}".`)
  }
  return directory
}

/**
 * Resolve the private commercial pack source. An explicit `LWB_COMMERCIAL_PACK_DIR`
 * is authoritative and never falls back: a wrong path must fail, not silently
 * ship a build without the member pack.
 * @param options - resolution inputs.
 * @returns the resolved directory and how it was found.
 */
export function resolveCommercialPackDir({ env, projectRoot, exists, readJson }) {
  const configured = env.LWB_COMMERCIAL_PACK_DIR?.trim()
  if (configured) {
    const directory = readCommercialPack(configured, exists, readJson)
    if (directory === undefined) {
      throw new Error(`LWB_COMMERCIAL_PACK_DIR=${configured} is not a capability pack (needs lwb-pack.json and package.json).`)
    }
    return { directory, source: 'LWB_COMMERCIAL_PACK_DIR' }
  }
  const candidates = commercialPackCandidates(projectRoot)
  for (const candidate of candidates) {
    const directory = readCommercialPack(candidate, exists, readJson)
    if (directory !== undefined) return { directory, source: 'sibling checkout' }
  }
  throw new Error(
    `The commercial edition needs the private pack source. Set LWB_COMMERCIAL_PACK_DIR to the `
    + `${COMMERCIAL_PACK_ID} checkout, or place it beside this repository. Tried: ${candidates.join(', ')}.`,
  )
}

/**
 * Decide which host @electron/get downloads from. The check is the release
 * checksum file for the exact Electron version being prepared, because that is
 * the one request @electron/get makes on every run — a proxy that answers the
 * release homepage is not enough.
 * @param options - resolution inputs.
 * @param options.env - process environment.
 * @param options.version - Electron version being prepared, when known.
 * @param options.probe - `(url) => Promise<boolean>`, true when that file downloads.
 * @param options.fallback - mirror used when the release host cannot serve it.
 * @returns the mirror to export and why it was chosen.
 */
export async function resolveElectronMirror({ env, version, probe, fallback = ELECTRON_MIRROR_FALLBACK }) {
  const configured = env.ELECTRON_MIRROR?.trim()
  if (configured) return { mirror: configured, source: 'ELECTRON_MIRROR' }
  if (env.LWB_ELECTRON_MIRROR?.trim() === 'off') return { mirror: undefined, source: 'probing disabled' }
  if (version === undefined) return { mirror: undefined, source: 'unknown Electron version' }
  if (await probe(releaseChecksumUrl(version))) return { mirror: undefined, source: 'release host' }
  if (await probe(`${fallback}${version}/SHASUMS256.txt`)) return { mirror: fallback, source: 'mirror fallback' }
  return { mirror: undefined, source: 'no reachable download source' }
}

/**
 * The release checksum URL @electron/get fetches for one Electron version.
 * @param version - Electron version.
 * @returns the absolute URL.
 */
export function releaseChecksumUrl(version) {
  return `https://github.com/electron/electron/releases/download/v${version}/SHASUMS256.txt`
}

/**
 * Probe whether one URL can actually be downloaded, following redirects the way
 * the downloader does.
 * @param url - file to reach.
 * @param timeoutMs - probe budget.
 * @returns whether the file answered successfully.
 */
export async function probeDownload(url, timeoutMs = 5000) {
  try {
    const response = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
    return response.ok
  } catch {
    return false
  }
}