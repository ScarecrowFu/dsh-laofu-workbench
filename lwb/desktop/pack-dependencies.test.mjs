import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const COMMERCIAL_ROOT = join(PROJECT_ROOT, '..', 'dsh-laofu-workbench-commercial')

async function packDirectories(root) {
  if (!existsSync(root)) return []
  const entries = await readdir(root, { withFileTypes: true })
  return entries.filter(entry => entry.isDirectory()).map(entry => join(root, entry.name))
    .filter(directory => existsSync(join(directory, 'lwb-pack.json')))
}

// The Desktop payload runs `npm ci --omit=dev` against the product's own
// package.json and copies packs without their node_modules, so a dependency a
// pack declares only for itself is missing from the build. The packaged
// acceptance finds that only at the very end of a long packaging run; this
// finds it in the unit suite. The commercial checkout is checked when it sits
// beside this repository, and skipped where it does not, as in public CI.
test('every runtime dependency a pack declares is a product dependency', async () => {
  const product = JSON.parse(await readFile(join(PROJECT_ROOT, 'package.json'), 'utf8'))
  const declared = new Set(Object.keys(product.dependencies ?? {}))
  const directories = [
    ...await packDirectories(join(PROJECT_ROOT, 'lwb', 'packs')),
    ...await packDirectories(join(COMMERCIAL_ROOT, 'packs')),
  ]
  assert.ok(directories.length > 0, 'the checkout must contain capability packs')
  const missing = []
  for (const directory of directories) {
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      if (!declared.has(name)) missing.push(`${manifest.name}: ${name}`)
    }
  }
  assert.deepEqual(missing, [], 'declare these in the root package.json dependencies')
})
