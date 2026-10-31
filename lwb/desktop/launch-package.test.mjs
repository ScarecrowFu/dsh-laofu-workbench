import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { assembleLaunchPackage, launchPackageFileName, payloadManifest } from './launch-package.mjs'

/** Entry names and compression methods, read from the central directory. */
function entries(buffer) {
  let end = -1
  for (let index = buffer.length - 22; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) { end = index; break }
  }
  assert.ok(end >= 0, 'no end-of-central-directory record')
  const count = buffer.readUInt16LE(end + 8)
  const found = []
  let cursor = buffer.readUInt32LE(end + 16)
  for (let index = 0; index < count; index += 1) {
    assert.equal(buffer.readUInt32LE(cursor), 0x02014b50)
    const method = buffer.readUInt16LE(cursor + 10)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    found.push({ name: buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8'), method })
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return found
}

/** A directory that looks like an unpacked Electron app, plus a fake launcher. */
async function fixture({ withLauncher = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'lwb-launch-'))
  const app = join(root, 'win-unpacked')
  await mkdir(join(app, 'resources'), { recursive: true })
  await writeFile(join(app, 'Laofu Workbench.exe'), Buffer.from([0x4d, 0x5a, 0x00]))
  await writeFile(join(app, 'resources', 'app.bundle'), 'x'.repeat(2048))
  const launcherBinary = join(root, 'launcher-src.exe')
  if (withLauncher) await writeFile(launcherBinary, Buffer.alloc(4096, 0x41))
  const directory = join(root, 'artifacts', 'win-x64')
  await mkdir(directory, { recursive: true })
  return { root, app, launcherBinary, directory }
}

const ARTIFACT_NAME = 'laofu-workbench-${version}-${os}-${arch}.${ext}'

function inputs(fixture, overrides = {}) {
  return {
    appDirectory: fixture.app,
    directory: fixture.directory,
    launcherBinary: fixture.launcherBinary,
    artifactName: ARTIFACT_NAME,
    product: 'laofu-workbench',
    productName: 'Laofu Workbench',
    version: '0.1.9',
    platform: 'win32',
    arch: 'x64',
    unsigned: true,
    log: () => {},
    ...overrides,
  }
}

test('the package keeps the product naming and marks an unsigned build', () => {
  const name = launchPackageFileName({ artifactName: ARTIFACT_NAME, version: '0.1.9', platform: 'win32', arch: 'x64', unsigned: true })
  assert.equal(name, 'laofu-workbench-0.1.9-win-x64-unsigned.zip')
  assert.equal(
    launchPackageFileName({ artifactName: ARTIFACT_NAME, version: '0.1.9-test.20261031', platform: 'win32', arch: 'x64', unsigned: false }),
    'laofu-workbench-0.1.9-test.20261031-win-x64.zip',
  )
  assert.throws(() => launchPackageFileName({ artifactName: '', version: '0.1.9', platform: 'win32', arch: 'x64' }), /artifact name template/u)
})

test('the payload manifest names what the launcher actually reads', () => {
  const manifest = payloadManifest({
    product: 'laofu-workbench', productName: 'Laofu Workbench', version: '0.1.9',
    platform: 'win32', arch: 'x64', channel: 'stable', sha256: 'a'.repeat(64), sizeBytes: 1024,
  })
  assert.equal(manifest.artifactType, 'unpacked-zip')
  assert.equal(manifest.fileName, 'app.zip')
  assert.equal(manifest.schemaVersion, 1)
  assert.throws(() => payloadManifest({ product: 'p', productName: 'P', version: '1.0.0', platform: 'win32', arch: 'x64', channel: 'stable', sha256: 'A'.repeat(64), sizeBytes: 1 }), /lowercase sha256/u)
  assert.throws(() => payloadManifest({ product: 'p', productName: 'P', version: '1.0.0', platform: 'win32', arch: 'x64', channel: 'stable', sha256: 'a'.repeat(64), sizeBytes: 0 }), /positive integer/u)
})

test('the package lays out what the launcher expects, and the manifest matches its archive', async () => {
  const fixtureDirectory = await fixture()
  const result = await assembleLaunchPackage(inputs(fixtureDirectory, { verify: false }))

  assert.equal(result.file, 'laofu-workbench-0.1.9-win-x64-unsigned.zip')
  const packageRoot = join(fixtureDirectory.directory, 'launch-package')
  assert.equal((await stat(join(packageRoot, 'Laofu Workbench.exe'))).size, 4096)
  const archive = join(packageRoot, 'payload', 'win32-x64', 'app.zip')
  const manifest = JSON.parse(await readFile(join(packageRoot, 'payload', 'win32-x64', 'manifest.json'), 'utf8'))

  const hash = createHash('sha256')
  hash.update(await readFile(archive))
  assert.equal(manifest.sha256, hash.digest('hex'), 'the manifest describes the archive beside it, not another build')
  assert.equal(manifest.sizeBytes, (await stat(archive)).size)
  assert.equal(manifest.version, '0.1.9')
  assert.equal(manifest.platform, 'win32')
  assert.equal(manifest.arch, 'x64')

  // The outer archive carries the launcher, the manifest and the payload, and
  // stores the payload rather than deflating an already-deflated file.
  const outer = entries(await readFile(result.path))
  assert.deepEqual(outer.map(entry => entry.name), [
    'Laofu Workbench.exe',
    'payload/win32-x64/app.zip',
    'payload/win32-x64/manifest.json',
  ])
  assert.equal(outer.find(entry => entry.name.endsWith('app.zip')).method, 0, 'app.zip is stored, not re-deflated')
  assert.equal(outer.find(entry => entry.name.endsWith('.exe')).method, 8)
})

test('a package rebuild replaces the previous one instead of mixing builds', async () => {
  const fixtureDirectory = await fixture()
  const first = await assembleLaunchPackage(inputs(fixtureDirectory, { verify: false }))
  const second = await assembleLaunchPackage(inputs(fixtureDirectory, { verify: false, version: '0.1.10' }))
  assert.notEqual(first.file, second.file)
  const manifest = JSON.parse(await readFile(join(fixtureDirectory.directory, 'launch-package', 'payload', 'win32-x64', 'manifest.json'), 'utf8'))
  assert.equal(manifest.version, '0.1.10')
  assert.equal(entries(await readFile(second.path)).length, 3)
})

test('a missing launcher fails before anything is written', async () => {
  const fixtureDirectory = await fixture({ withLauncher: false })
  await assert.rejects(
    () => assembleLaunchPackage(inputs(fixtureDirectory, { verify: false })),
    /No launcher executable/u,
  )
  await assert.rejects(() => stat(join(fixtureDirectory.directory, 'launch-package', 'Laofu Workbench.exe')))
})
