/**
 * Rewrite bare dylib references in the payload's native binaries.
 *
 * `@remotion/compositor-darwin-*` ships `ffmpeg`, `ffprobe`, `remotion` and seven
 * `libav*` / `libsw*` dylibs whose load commands are bare relative names
 * (`libavdevice.dylib`), not `@loader_path/...`. dyld resolves those against the
 * working directory, which is why `@remotion/renderer` spawns its binaries with
 * `cwd = dirname(executablePath)`. A process that carries the hardened runtime
 * refuses relative paths outright:
 *
 *   Library not loaded: libavdevice.dylib
 *   Reason: tried: 'libavdevice.dylib' (relative path not allowed in hardened program)
 *
 * The Desktop build signs the whole payload — `lwb-product/node_modules`
 * included — with `hardenedRuntime: true`, so every video export in a packaged
 * app died with SIGABRT while the same code kept working in development, where
 * the repository's own (linker-signed) copy of Remotion is used.
 *
 * Rewriting the references to `@loader_path/<name>` keeps the hardened runtime,
 * which upstream enforces and notarization expects, and drops the working
 * directory dependency. The step runs on the freshly installed payload before
 * electron-builder signs it; `install_name_tool` invalidates each file's
 * signature, so the file is ad-hoc re-signed here and the product signature is
 * applied on top afterwards. Any bare reference that survives fails the build,
 * so a future Remotion layout cannot silently reintroduce the bug.
 */
import { createHash } from 'node:crypto'
import { open, readdir, readFile, stat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { join, relative } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const INSTALL_NAME_TOOL = '/usr/bin/install_name_tool'
const CODESIGN = '/usr/bin/codesign'
const OTOOL = '/usr/bin/otool'
/* Thin (both endiannesses), fat and fat64 Mach-O magics. */
const MACH_O_MAGIC = new Set(['cffaedfe', 'cefaedfe', 'cafebabe', 'bebafeca', 'cafebabf'])

/** A bare relative path has no directory and no dyld prefix: hardened processes cannot load it. */
export const isBareLibraryPath = value => Boolean(value) && !value.includes('/') && !value.startsWith('@')

async function isMachO(path) {
  const info = await stat(path).catch(() => null)
  if (!info?.isFile() || info.size < 4) return false
  const handle = await open(path).catch(() => null)
  if (!handle) return false
  try {
    const header = Buffer.alloc(4)
    const { bytesRead } = await handle.read(header, 0, 4, 0)
    return bytesRead === 4 && MACH_O_MAGIC.has(header.toString('hex'))
  } finally { await handle.close() }
}

/** Native files under `directory`, skipping webpack's task-local cache. */
export async function collectMachOFiles(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) { if (entry.name !== '.cache') await collectMachOFiles(path, files) }
    else if (entry.isFile() && await isMachO(path)) files.push(path)
  }
  return files
}

/** `otool -D` is the install name of a dylib; `otool -L` is everything it loads. */
export async function readLibraryReferences(path) {
  const idOutput = await execFileAsync(OTOOL, ['-D', path]).then(result => result.stdout, () => '')
  const listOutput = await execFileAsync(OTOOL, ['-L', path]).then(result => result.stdout, () => '')
  return {
    id: idOutput.split('\n')[1]?.trim() || null,
    dependencies: listOutput.split('\n').slice(1).map(line => line.trim().split(' ')[0]).filter(Boolean),
  }
}

/**
 * Rewrite every bare reference under `root` to `@loader_path/<name>`.
 *
 * @param {string} root Installed dependency tree, usually `<payload>/node_modules`.
 * @param {{ log?: (message: string) => void }} [options]
 * @returns {Promise<{ scanned: number, patched: Array<{ file: string, sha256: string }> }>}
 *   The patched files with their new hashes, so a build id can commit to them.
 */
export async function relinkDarwinLibraries(root, { log = () => {} } = {}) {
  const files = await collectMachOFiles(root)
  const patchedPaths = []
  for (const file of files) {
    const { id, dependencies } = await readLibraryReferences(file)
    const args = []
    if (isBareLibraryPath(id)) args.push('-id', `@loader_path/${id}`)
    for (const dependency of dependencies) {
      if (dependency === id || !isBareLibraryPath(dependency)) continue
      args.push('-change', dependency, `@loader_path/${dependency}`)
    }
    if (args.length === 0) continue
    await execFileAsync(INSTALL_NAME_TOOL, [...args, file])
    /* install_name_tool invalidates the signature; keep the file loadable until
       electron-builder applies the product signature (hardened runtime + entitlements). */
    await execFileAsync(CODESIGN, ['--force', '--sign', '-', file])
    patchedPaths.push(file)
  }
  const survivors = []
  for (const file of files) {
    const { id, dependencies } = await readLibraryReferences(file)
    for (const value of [id, ...dependencies]) if (isBareLibraryPath(value)) survivors.push(`${relative(root, file)}: ${value}`)
  }
  if (survivors.length > 0) {
    throw new Error(`native library paths: ${survivors.length} reference(s) under ${root} still cannot be loaded by a hardened process:\n${survivors.join('\n')}`)
  }
  log(`native library paths: relinked ${patchedPaths.length} of ${files.length} native file(s) under ${root}`)
  const patched = []
  for (const file of patchedPaths) {
    patched.push({ file: relative(root, file), sha256: createHash('sha256').update(await readFile(file)).digest('hex') })
  }
  return { scanned: files.length, patched }
}