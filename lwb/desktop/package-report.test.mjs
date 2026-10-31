import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { artifactSnapshot, changedArtifacts, readBuildRecord, reportArtifacts } from './package-report.mjs'

const PRODUCT = 'Laofu Workbench'

/** SHA-256 of a small in-memory value, matching the report's own digest. */
function digestOf(value) {
  return createHash('sha256').update(value).digest('hex')
}

/** A scratch artifact directory for one test. */
async function scratch() {
  const root = await mkdtemp(join(tmpdir(), 'lwb-report-'))
  const directory = join(root, 'mac-arm64')
  await mkdir(join(directory, 'mac-arm64', `${PRODUCT}.app`, 'Contents', 'Resources', 'lwb-product'), { recursive: true })
  await writeFile(join(directory, 'mac-arm64', `${PRODUCT}.app`, 'Contents', 'Resources', 'lwb-product', 'build.json'), '{"id":"abc123"}')
  await writeFile(join(directory, 'stale.zip'), 'older build')
  await writeFile(join(directory, 'SHA256SUMS.txt'), 'older sums')
  return { root, directory }
}

/** Lines captured from one report call. */
async function report(directory, { target = 'mac-arm64', before }) {
  const lines = []
  await reportArtifacts({ directory, target, productName: PRODUCT, before, log: line => lines.push(line) })
  return lines.join('\n')
}

test('a changed artifact counts as produced, like a new one', () => {
  const before = new Map([['kept.zip', '1:10'], ['rewritten.zip', '1:10']])
  const after = new Map([['kept.zip', '1:10'], ['rewritten.zip', '2:20'], ['fresh.zip', '3:30']])
  assert.deepEqual(changedArtifacts(before, after), ['rewritten.zip', 'fresh.zip'])
  assert.deepEqual(changedArtifacts(after, after), [], 'a rerun that writes nothing produces nothing')
  assert.deepEqual(changedArtifacts(new Map(), after), ['kept.zip', 'rewritten.zip', 'fresh.zip'], 'no snapshot reports everything present')
})

test('the report names the app, its build id and only what the run wrote', async () => {
  const { root, directory } = await scratch()
  try {
    await writeFile(join(directory, 'laofu-workbench-0.1.3-test.1-mac-arm64-portable-unsigned.zip'), 'first build')
    const before = await artifactSnapshot(directory)

    await writeFile(join(directory, 'laofu-workbench-0.1.3-test.1-mac-arm64-portable-unsigned.zip'), 'second build')
    await writeFile(join(directory, 'laofu-workbench-0.1.3-test.1-mac-arm64-portable-unsigned.zip.blockmap'), 'map')
    await writeFile(join(directory, 'builder-debug.yml'), 'bookkeeping')
    const output = await report(directory, { before })

    assert.match(output, new RegExp(`Unpacked app: ${join(directory, 'mac-arm64', `${PRODUCT}.app`)}`.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))
    assert.match(output, /build id {2}abc123 {2}\(first launch copies it to runtime\/abc123\)/u)
    assert.match(output, /Launch with: open "/u)
    assert.match(output, new RegExp(`laofu-workbench-0\\.1\\.3-test\\.1-mac-arm64-portable-unsigned\\.zip {2}12 B {2}sha256 ${digestOf('second build')}`, 'u'), 'the overwritten artifact reports its new checksum')
    assert.match(output, /\.zip\.blockmap {2}3 B$/mu, 'a rewritten sidecar is reported without a checksum')
    assert.doesNotMatch(output, /stale\.zip/u, 'an unrelated pre-existing file is not reported')
    assert.doesNotMatch(output, /SHA256SUMS\.txt|builder-debug\.yml/u, 'build bookkeeping is not a deliverable')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the report stays quiet about a build that wrote nothing', async () => {
  const { root, directory } = await scratch()
  try {
    const before = await artifactSnapshot(directory)
    const output = await report(directory, { before })
    assert.match(output, /No artifact files written in/u)
    assert.match(output, /build id {2}abc123/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the Windows report points at the unpacked executable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lwb-report-win-'))
  const directory = join(root, 'win-x64')
  await mkdir(join(directory, 'win-unpacked', 'resources', 'lwb-product'), { recursive: true })
  await writeFile(join(directory, 'win-unpacked', `${PRODUCT}.exe`), 'stub executable')
  await writeFile(join(directory, 'win-unpacked', 'resources', 'lwb-product', 'build.json'), '{"id":"win999"}')
  try {
    const output = await report(directory, { target: 'win-x64', before: await artifactSnapshot(directory) })
    assert.match(output, /Launch with: ".*Laofu Workbench\.exe"/u)
    assert.match(output, /build id {2}win999/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a missing unpacked app is reported instead of guessed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lwb-report-empty-'))
  try {
    const output = await report(join(root, 'mac-arm64'), { before: new Map() })
    assert.match(output, /No unpacked app at/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
/** Write one build record into a scratch mac-arm64 unpacked app. */
async function withRecord(record) {
  const { root, directory } = await scratch()
  const manifest = join(directory, 'mac-arm64', `${PRODUCT}.app`, 'Contents', 'Resources', 'lwb-product', 'build.json')
  await writeFile(manifest, JSON.stringify(record))
  return { root, directory }
}

test('the build record says what the build is, whatever the environment says', async () => {
  const { root, directory } = await withRecord({ id: 'abc', version: '0.1.9', release: true, platform: 'darwin', arch: 'arm64' })
  try {
    const previous = process.env.LWB_DESKTOP_RELEASE
    delete process.env.LWB_DESKTOP_RELEASE
    try {
      const build = readBuildRecord({ directory, target: 'mac-arm64', productName: PRODUCT })
      assert.equal(build.version, '0.1.9')
      assert.equal(build.release, true)
    } finally { if (previous !== undefined) process.env.LWB_DESKTOP_RELEASE = previous }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('a build record for another target, or without its facts, is refused', async () => {
  for (const [record, pattern] of [
    [{ version: '0.1.9', release: true, platform: 'darwin', arch: 'x64' }, /built for darwin-x64, not mac-arm64/u],
    [{ release: true, platform: 'darwin', arch: 'arm64' }, /records no version/u],
    [{ version: '0.1.9', platform: 'darwin', arch: 'arm64' }, /whether it is a release/u],
  ]) {
    const { root, directory } = await withRecord(record)
    try {
      assert.throws(() => readBuildRecord({ directory, target: 'mac-arm64', productName: PRODUCT }), pattern)
    } finally { await rm(root, { recursive: true, force: true }) }
  }
  const root = await mkdtemp(join(tmpdir(), 'lwb-report-'))
  try {
    assert.throws(() => readBuildRecord({ directory: root, target: 'mac-arm64', productName: PRODUCT }), /No build record/u)
  } finally { await rm(root, { recursive: true, force: true }) }
})
