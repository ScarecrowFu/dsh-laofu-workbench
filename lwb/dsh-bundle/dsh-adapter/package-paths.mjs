import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { LWB_RUNTIME } from '../runtime-config.mjs'

/** Dependency lookup for an installed runtime or an official pnpm checkout. */
export function dshPackageDirectory(name, runtime = LWB_RUNTIME.dshRuntimeDir) {
  for (const modules of [join(runtime, 'node_modules'), join(runtime, 'node_modules', '.pnpm', 'node_modules')]) {
    const directory = join(modules, ...name.split('/'))
    const manifest = join(directory, 'package.json')
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === name) return realpathSync(directory)
  }
  throw new Error(`DSH dependency ${name} is unavailable in ${runtime}; run npm run setup.`)
}

/**
 * A plugin row's `name` for one installed dependency: the entry module as a file
 * URL rather than a bare package name.
 *
 * A bare name resolves against the tree that imports it, and a preset mounted
 * inside a pack Session is not that tree: the profile's own node_modules holds
 * pack links and nothing else, so `@deepseek-ai/*` is unresolvable there and the
 * loader reports the row as `never started` — an error that names no cause. A
 * file URL is resolved by Node itself from any base, which is what a composition
 * that lives outside the profile needs.
 * @param name - the dependency's package name.
 * @param runtime - DSH installation to read it from.
 * @returns the package's entry module as a `file://` URL.
 */
export function dshPackageEntry(name, runtime = LWB_RUNTIME.dshRuntimeDir) {
  const directory = dshPackageDirectory(name, runtime)
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  const entry = manifest?.exports?.['.']?.default ?? manifest?.main
  if (typeof entry !== 'string' || entry === '') throw new Error(`DSH dependency ${name} declares no entry module.`)
  return pathToFileURL(join(directory, entry)).href
}
