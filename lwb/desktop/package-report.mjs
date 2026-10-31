/**
 * Report what one Desktop packaging run produced.
 *
 * The report answers "what did this build just write" rather than "what is in
 * the artifact directory": the unpacked app path is derived from the target,
 * and the artifact files are the ones that appeared or changed while the run
 * was working. Rebuilding on the same day overwrites the same artifact name, so
 * a change in mtime or size counts as produced, exactly like a new file.
 */
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { artifactExtensions, resolveHostTarget, unpackedApp } from './package-inputs.mjs'

/**
 * Snapshot of the artifact files in one directory, keyed by name.
 * @param directory - artifact directory of the edition and target.
 * @returns name to `mtime:size` fingerprint; empty when the directory is absent.
 */
export async function artifactSnapshot(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const files = entries.filter(entry => entry.isFile())
  const snapshot = new Map()
  for (const entry of files) {
    const info = await stat(join(directory, entry.name))
    snapshot.set(entry.name, `${info.mtimeMs}:${info.size}`)
  }
  return snapshot
}

/**
 * Names a run produced: new files and files it rewrote.
 * @param before - snapshot taken before the run.
 * @param after - snapshot taken after the run.
 * @returns the produced names, in directory order.
 */
export function changedArtifacts(before, after) {
  return [...after.keys()].filter(name => after.get(name) !== before.get(name))
}

/**
 * The build record the packager wrote into one target's unpacked app.
 *
 * It is the only place that knows what this build *is*: its version, including
 * a `-test.N` suffix, and whether it is a release. Anything that describes the
 * artifact afterwards reads it from here instead of re-deriving it from the
 * environment, which is how a report once claimed a release build was
 * `0.1.9-test.1` because one variable was missing from a manual run.
 * @param options - record location.
 * @param options.directory - artifact directory of the edition and target.
 * @param options.target - resolved target name.
 * @param options.productName - product name of the edition.
 * @returns the parsed build record.
 * @throws Error when the record is missing, incomplete, or for another target.
 */
export function readBuildRecord({ directory, target, productName }) {
  const { manifest } = unpackedApp(directory, target, productName)
  if (!existsSync(manifest)) throw new Error(`No build record at ${manifest}; package ${target} before collecting its artifacts.`)
  const build = JSON.parse(readFileSync(manifest, 'utf8'))
  if (typeof build.version !== 'string' || build.version === '') throw new Error(`${manifest} records no version.`)
  if (typeof build.release !== 'boolean') throw new Error(`${manifest} does not record whether it is a release.`)
  if (typeof build.platform !== 'string' || typeof build.arch !== 'string' || resolveHostTarget(build.platform, build.arch) !== target) {
    throw new Error(`${manifest} was built for ${build.platform}-${build.arch}, not ${target}.`)
  }
  return build
}

/** Byte size in a short human unit. */
function readable(bytes) {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

/**
 * Whether one written file is a distributable artifact for this target, or a
 * sidecar of one. The builder also rewrites bookkeeping files (a debug
 * manifest, a report) in the same directory, and those are not deliverables.
 * @param name - artifact directory entry name.
 * @param target - resolved target name.
 * @returns whether the file belongs in the report.
 */
function isArtifactFile(name, target) {
  return artifactExtensions(target).some(extension => name.endsWith(extension) || name.endsWith(`${extension}.blockmap`))
}

/** Streamed SHA-256 of one file. */
async function checksum(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

/**
 * Report one run's unpacked app, its product build id, and the artifact files
 * it wrote, with checksums for the target's distributable extensions.
 * @param options - report inputs.
 * @param options.directory - artifact directory of the edition and target.
 * @param options.target - resolved target name.
 * @param options.productName - product name of the edition being packaged.
 * @param options.before - snapshot taken before the run.
 * @param options.log - output sink.
 */
export async function reportArtifacts({ directory, target, productName, before, log = console.log }) {
  const { app, manifest, launch } = unpackedApp(directory, target, productName)
  if (!existsSync(app)) {
    log(`\nNo unpacked app at ${app}; inspect ${directory} for what the build wrote.`)
    return
  }
  log(`\nUnpacked app: ${app}`)
  if (existsSync(manifest)) {
    const build = JSON.parse(readFileSync(manifest, 'utf8'))
    log(`  build id  ${build.id}  (first launch copies it to runtime/${build.id})`)
  }
  log(`Launch with: ${launch}`)

  const extensions = artifactExtensions(target)
  const produced = changedArtifacts(before, await artifactSnapshot(directory)).filter(name => isArtifactFile(name, target))
  if (produced.length === 0) {
    log(`\nNo artifact files written in ${directory}.`)
    return
  }
  log(`\nArtifact files written in ${directory}:`)
  for (const name of produced) {
    const path = join(directory, name)
    const { size } = await stat(path)
    const digest = extensions.some(extension => name.endsWith(extension)) ? `  sha256 ${await checksum(path)}` : ''
    log(`  ${name}  ${readable(size)}${digest}`)
  }
}