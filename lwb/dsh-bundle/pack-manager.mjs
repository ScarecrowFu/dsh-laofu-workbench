import { existsSync } from 'node:fs'
import { lstat, mkdir, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LWB_RUNTIME } from './runtime-config.mjs'

// The source checkout resolves the SDK through its sibling workspace package;
// a packaged Desktop bundle resolves the same contract through its dependency.
const { validateLwbPackManifest } = await import('@scitiger-ai/lwb-pack-sdk').catch(() => import('../pack-sdk/index.mjs'))

const DEFAULT_REGISTRY_PATH = LWB_RUNTIME.registryPath
const WORKSPACE_PACKS_DIR = LWB_RUNTIME.sourcePacksDir
const REGISTRY_SCHEMA_VERSION = 2

function plainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value
}

function text(value, label, maxLength = 4096) {
  if (typeof value !== 'string') throw new Error(`${label} must be text`)
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength) throw new Error(`${label} must contain 1-${maxLength} characters`)
  return normalized
}

async function jsonFile(path, label) {
  let source
  try {
    source = await readFile(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`${label} is missing: ${path}`)
    throw error
  }
  try {
    return JSON.parse(source)
  } catch {
    throw new Error(`${label} is not valid JSON: ${path}`)
  }
}

function packageClientEntry(packageJson, packageDir) {
  const client = packageJson?.exports?.['./client']
  const path = typeof client === 'string' ? client : client?.default
  if (typeof path !== 'string' || !path.startsWith('./')) {
    throw new Error(`LWB pack package must export ./client: ${packageDir}`)
  }
  const clientConfig = packageJson?.dsh?.client
  if (!clientConfig || clientConfig.platform !== 'web') {
    throw new Error(`LWB pack package must declare dsh.client.platform as "web": ${packageDir}`)
  }
  return path
}

function packageHostEntry(packageJson, packageDir) {
  const root = packageJson?.exports?.['.']
  const path = typeof root === 'string' ? root : root?.default ?? packageJson?.main
  if (typeof path !== 'string' || !path.startsWith('./')) {
    throw new Error(`LWB pack package must export a host entry from .: ${packageDir}`)
  }
  return path
}

/** Inspect a source directory without installing, executing, or importing it. */
export async function inspectLwbPack(directory) {
  const requested = resolve(directory)
  let source
  try {
    source = await realpath(requested)
  } catch {
    throw new Error(`LWB pack directory does not exist: ${requested}`)
  }
  const manifest = validateLwbPackManifest(await jsonFile(join(source, 'lwb-pack.json'), 'LWB pack manifest'))
  const packageJson = plainObject(await jsonFile(join(source, 'package.json'), 'LWB pack package.json'), 'LWB pack package.json')
  if (text(packageJson.name, 'package.json name', 214) !== manifest.packageName) {
    throw new Error(`LWB pack manifest packageName does not match package.json name: ${source}`)
  }
  if (text(packageJson.version, 'package.json version', 64) !== manifest.version) {
    throw new Error(`LWB pack manifest version does not match package.json version: ${source}`)
  }
  const hostEntry = packageHostEntry(packageJson, source)
  const clientEntry = packageClientEntry(packageJson, source)
  for (const entry of [hostEntry, clientEntry]) {
    if (!existsSync(join(source, entry))) throw new Error(`LWB pack entry is missing: ${join(source, entry)}`)
  }
  return Object.freeze({
    manifest,
    source,
    hostEntry,
    clientEntry,
  })
}

function registryManifest(value, label) {
  try {
    return validateLwbPackManifest(value)
  } catch (error) {
    throw new Error(`${label} is invalid: ${error.message}`)
  }
}

function normalizeRegistry(value) {
  const input = plainObject(value, 'LWB pack registry')
  if (input.schemaVersion !== REGISTRY_SCHEMA_VERSION) {
    throw new Error(`LWB pack registry schemaVersion must be ${REGISTRY_SCHEMA_VERSION}`)
  }
  if (!Array.isArray(input.packs)) throw new Error('LWB pack registry packs must be an array')
  const ids = new Set()
  const packages = new Set()
  const packs = input.packs.map((candidate, index) => {
    const record = plainObject(candidate, `LWB pack registry packs[${index}]`)
    const id = text(record.id, `LWB pack registry packs[${index}].id`, 63)
    const packageName = text(record.packageName, `LWB pack registry packs[${index}].packageName`, 214)
    const source = text(record.source, `LWB pack registry packs[${index}].source`)
    if (!isAbsolute(source)) throw new Error(`LWB pack registry packs[${index}].source must be absolute`)
    if (ids.has(id) || packages.has(packageName)) throw new Error('LWB pack registry contains duplicate id or packageName')
    ids.add(id)
    packages.add(packageName)
    const manifest = registryManifest(record.manifest, `LWB pack registry packs[${index}].manifest`)
    if (manifest.id !== id || manifest.packageName !== packageName) {
      throw new Error(`LWB pack registry packs[${index}].manifest identity does not match its registry record`)
    }
    if (typeof record.enabled !== 'boolean') throw new Error(`LWB pack registry packs[${index}].enabled must be boolean`)
    return {
      id,
      packageName,
      source,
      installedAt: text(record.installedAt, `LWB pack registry packs[${index}].installedAt`, 64),
      enabled: record.enabled,
      manifest,
    }
  })
  return { schemaVersion: REGISTRY_SCHEMA_VERSION, packs }
}

async function readRegistry() {
  const path = registryPath()
  if (!existsSync(path)) return { schemaVersion: REGISTRY_SCHEMA_VERSION, packs: [] }
  return normalizeRegistry(await jsonFile(path, 'LWB pack registry'))
}

async function writeRegistry(value) {
  const normalized = normalizeRegistry(value)
  const path = registryPath()
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  await rename(temporary, path)
}

function registryPath() {
  return resolve(process.env.LWB_PACK_REGISTRY || DEFAULT_REGISTRY_PATH)
}

/** Return all currently configured packs, resolving their manifests afresh. */
export async function installedLwbPacks() {
  const registry = await readRegistry()
  const resolved = []
  for (const entry of registry.packs) {
    const inspected = await inspectLwbPack(entry.source)
    if (inspected.manifest.id !== entry.id || inspected.manifest.packageName !== entry.packageName) {
      throw new Error(`Installed LWB pack identity changed at ${entry.source}; remove and install it again.`)
    }
    resolved.push(Object.freeze({ ...inspected, installedAt: entry.installedAt, enabled: entry.enabled }))
  }
  return resolved
}

/** Register an existing package source in the local, ignored marketplace registry. */
export async function installLwbPack(directory, options = {}) {
  const inspected = await inspectLwbPack(directory)
  const registry = await readRegistry()
  const conflict = registry.packs.find((item) => item.id === inspected.manifest.id || item.packageName === inspected.manifest.packageName)
  if (conflict && (conflict.id !== inspected.manifest.id || conflict.packageName !== inspected.manifest.packageName || resolve(conflict.source) !== inspected.source)) {
    throw new Error(`A different LWB pack is already installed as ${conflict.id}; remove it before installing ${inspected.manifest.id}.`)
  }
  // Registration only makes a pack discoverable. Loading it from the workbench
  // explicitly supplies enabled: true, which also records startup intent.
  const installedAt = conflict?.installedAt || new Date().toISOString()
  const enabled = options.enabled === undefined ? conflict?.enabled === true : options.enabled === true
  const record = {
    id: inspected.manifest.id,
    packageName: inspected.manifest.packageName,
    source: inspected.source,
    installedAt,
    enabled,
    manifest: inspected.manifest,
  }
  const packs = conflict
    ? registry.packs.map((item) => item.id === record.id ? record : item)
    : [...registry.packs, record]
  await writeRegistry({ schemaVersion: REGISTRY_SCHEMA_VERSION, packs })
  return Object.freeze({ ...inspected, installedAt, enabled: record.enabled })
}

/** Remove only the local registration. The source package and its files remain untouched. */
export async function removeLwbPack(id) {
  const target = text(id, 'LWB pack id', 63)
  const registry = await readRegistry()
  const packs = registry.packs.filter((item) => item.id !== target)
  if (packs.length === registry.packs.length) throw new Error(`No installed LWB pack has id ${JSON.stringify(target)}.`)
  await writeRegistry({ schemaVersion: REGISTRY_SCHEMA_VERSION, packs })
}

/** Record that a known local package was unloaded without deleting its source or durable data. */
export async function unloadLwbPack(id) {
  const target = text(id, 'LWB pack id', 63)
  const registry = await readRegistry()
  const current = registry.packs.find((item) => item.id === target)
  if (!current) throw new Error(`No installed LWB pack has id ${JSON.stringify(target)}.`)
  if (current.enabled === false) return current
  const packs = registry.packs.map((item) => item.id === target ? { ...item, enabled: false } : item)
  await writeRegistry({ schemaVersion: REGISTRY_SCHEMA_VERSION, packs })
  return { ...current, enabled: false }
}

async function workspacePackSources() {
  if (!existsSync(WORKSPACE_PACKS_DIR)) return []
  const entries = await readdir(WORKSPACE_PACKS_DIR, { withFileTypes: true })
  const sources = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    const source = join(WORKSPACE_PACKS_DIR, entry.name)
    try {
      const stats = await lstat(source)
      if (stats.isDirectory() && !stats.isSymbolicLink()) sources.push(source)
    } catch (_) {}
  }
  return sources
}

/**
 * Sources from the private pack checkout, which keeps every pack under
 * `packs/<id>`. A missing directory is normal: packaged builds ship no checkout.
 */
async function commercialPackSources() {
  const directory = LWB_RUNTIME.commercialPacksDir
  if (!directory) return []
  const nested = join(directory, 'packs')
  if (!existsSync(nested)) return []
  const sources = []
  for (const entry of await readdir(nested, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    const source = join(nested, entry.name)
    try {
      const stats = await lstat(source)
      if (stats.isDirectory() && !stats.isSymbolicLink()) sources.push(source)
    } catch (_) {}
  }
  return sources
}

/**
 * Read the marketplace projection without importing package code. Workspace
 * packages are discoverable by convention; external packages become visible
 * after the generic CLI installer registers their source locally.
 */
export async function marketplaceLwbPacks() {
  const registry = await readRegistry()
  const recordsById = new Map(registry.packs.map((record) => [record.id, record]))
  const results = new Map()

  async function add(source, origin, record) {
    try {
      const inspected = await inspectLwbPack(source)
      const existing = results.get(inspected.manifest.id)
      if (existing && existing.source !== inspected.source) {
        throw new Error(`Marketplace has conflicting sources for LWB pack ${JSON.stringify(inspected.manifest.id)}.`)
      }
      const registered = recordsById.get(inspected.manifest.id)
      results.set(inspected.manifest.id, {
        ...inspected,
        installedAt: registered?.installedAt,
        enabled: registered?.enabled === true,
        origin: registered ? 'local' : origin,
        available: true,
      })
    } catch (error) {
      if (!record?.manifest) throw error
      results.set(record.id, {
        manifest: record.manifest,
        source,
        installedAt: record.installedAt,
        enabled: record.enabled === true,
        origin: 'local',
        available: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  for (const record of registry.packs) await add(record.source, 'local', record)
  const discovered = [...await workspacePackSources(), ...await commercialPackSources()]
  for (const source of discovered) {
    let inspected
    try {
      inspected = await inspectLwbPack(source)
    } catch (_) {
      continue
    }
    if (!results.has(inspected.manifest.id)) {
      results.set(inspected.manifest.id, {
        ...inspected,
        enabled: false,
        origin: 'workspace',
        available: true,
      })
    }
  }
  return [...results.values()].sort((left, right) => left.manifest.name.localeCompare(right.manifest.name, 'zh-Hans-CN'))
}

/** Register a catalog package so the host Loader can mount it in this process. */
export async function loadMarketplaceLwbPack(id) {
  const target = text(id, 'LWB pack id', 63)
  const pack = (await marketplaceLwbPacks()).find((item) => item.manifest.id === target)
  if (!pack) throw new Error(`No marketplace LWB pack has id ${JSON.stringify(target)}.`)
  if (!pack.available) throw new Error(`LWB pack ${JSON.stringify(target)} is unavailable: ${pack.error || 'source cannot be inspected'}`)
  const installed = await installLwbPack(pack.source, { enabled: true })
  return Object.freeze({ ...pack, ...installed })
}

function printablePack(pack) {
  return {
    id: pack.manifest.id,
    packageName: pack.manifest.packageName,
    name: pack.manifest.name,
    version: pack.manifest.version,
    source: pack.source,
    installedAt: pack.installedAt,
    enabled: pack.enabled,
  }
}

async function main(argv) {
  const [command, argument] = argv
  if (command === 'list' && argument === undefined) {
    process.stdout.write(`${JSON.stringify((await installedLwbPacks()).map(printablePack), null, 2)}\n`)
    return
  }
  if (command === 'install' && argument !== undefined) {
    process.stdout.write(`${JSON.stringify(printablePack(await installLwbPack(argument)), null, 2)}\n`)
    return
  }
  if (command === 'remove' && argument !== undefined) {
    await removeLwbPack(argument)
    process.stdout.write(`${JSON.stringify({ removed: argument })}\n`)
    return
  }
  throw new Error('Usage: node lwb/pack-manager.mjs <list | install <directory> | remove <id>>')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
