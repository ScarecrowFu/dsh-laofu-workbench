import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const BUNDLE_DIR = resolve(dirname(fileURLToPath(import.meta.url)))
const PROJECT_ROOT = resolve(BUNDLE_DIR, '..', '..')

function text(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function profileId() {
  const explicit = text(process.env.LWB_PROFILE_ID)
  if (explicit) return explicit
  // The official Desktop Host launches dsh through Electron's Node carrier.
  // Keep the web launcher on its historical `lwb` profile unless the Desktop
  // shell explicitly selects another product profile.
  return process.env.ELECTRON_RUN_AS_NODE === '1' ? 'desktop' : 'lwb'
}

// One product data root, independent of carrier, profile and installed DSH version.
const productHome = resolve(text(process.env.LWB_PRODUCT_HOME) || join(PROJECT_ROOT, 'lwb', 'local', 'current'))
const dshHome = resolve(text(process.env.LWB_DSH_HOME) || text(process.env.DSH_HOME) || join(productHome, 'dsh-home'))

/**
 * The private pack checkout. Every capability pack that is finished has to be
 * listed whenever the product starts, no matter which checkout it lives in, so
 * the marketplace scans this directory as a source instead of relying on a
 * per-machine registry entry. Membership decides whether a pack may be loaded;
 * it must not decide whether the pack is visible.
 *
 * Explicit `LWB_COMMERCIAL_PACK_DIR` wins. Otherwise the checkout beside this
 * repository is used, which is where the packaging script looks too. A packaged
 * Desktop build has no such sibling, so discovery simply finds nothing and the
 * edition's own pack list stays authoritative.
 */
function commercialPackDir() {
  const explicit = text(process.env.LWB_COMMERCIAL_PACK_DIR)
  if (explicit) return resolve(explicit)
  const sibling = resolve(PROJECT_ROOT, '..', 'dsh-laofu-workbench-commercial')
  return existsSync(join(sibling, 'packs')) ? sibling : undefined
}

export const LWB_RUNTIME = Object.freeze({
  projectRoot: PROJECT_ROOT,
  dshRuntimeDir: resolve(text(process.env.LWB_DSH_RUNTIME_DIR) || join(PROJECT_ROOT, 'vendor', 'deepseek-harness')),
  dshHome,
  profileId: profileId(),
  profileHome: resolve(text(process.env.LWB_PROFILE_DIR) || join(dshHome, 'profiles', profileId())),
  packStateDir: resolve(text(process.env.LWB_PACK_STATE_DIR) || join(productHome, 'pack-state')),
  productHome,
  registryPath: resolve(text(process.env.LWB_PACK_REGISTRY) || join(productHome, 'packs.json')),
  sourcePacksDir: resolve(text(process.env.LWB_PACKS_DIR) || join(PROJECT_ROOT, 'lwb', 'packs')),
  commercialPacksDir: commercialPackDir(),
  atsBaseUrl: normalizeAtsUrl(process.env.LWB_ATS_URL),
  packRuntimeDir: text(process.env.LWB_PACK_RUNTIME_DIR) ? resolve(process.env.LWB_PACK_RUNTIME_DIR) : undefined,
  // Update bookkeeping belongs to the installation, not to a build: replacing
  // the build must not throw away the staged artifact, the installation id that
  // ATS buckets rollouts by, or the outcome the next start has to report.
  updateStateDir: resolve(text(process.env.LWB_UPDATE_STATE_DIR) || join(productHome, 'updates')),
})

/**
 * The product build this process is serving, as the packager wrote it.
 *
 * A checkout has no `build.json` at its root, so this is `undefined` outside a
 * packaged Desktop build — which is exactly how the updater tells "a release
 * installed on a user's machine" apart from "somebody running the sources".
 * @returns the build record, or `undefined`.
 */
export function readLwbBuild() {
  try {
    return JSON.parse(readFileSync(join(PROJECT_ROOT, 'build.json'), 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * The product version this process is serving.
 *
 * A packaged build answers with what the packager recorded, because that is the
 * value the release was signed and published under — a `-test.N` build must
 * report that suffix, not the version it was cut from. A checkout has no build
 * record and answers with `package.json`, which is the same field the release
 * process bumps and the packager reads, so the number a user sees in Settings
 * cannot drift away from the number the update feed compares against.
 * @returns the version string, or `undefined` when neither source is readable.
 */
export function readProductVersion() {
  const recorded = readLwbBuild()?.version
  if (typeof recorded === 'string' && recorded.trim() !== '') return recorded.trim()
  try {
    const manifest = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8'))
    const version = manifest?.version
    return typeof version === 'string' && version.trim() !== '' ? version.trim() : undefined
  } catch {
    return undefined
  }
}

function normalizeAtsUrl(value) {
  const candidate = text(value)
  if (!candidate) return undefined
  try { return new URL(candidate).href.replace(/\/$/u, '') } catch { return undefined }
}

export function lwbProfilePath(...segments) {
  return join(LWB_RUNTIME.profileHome, ...segments)
}

export function lwbProductPath(...segments) {
  return join(LWB_RUNTIME.productHome, ...segments)
}
