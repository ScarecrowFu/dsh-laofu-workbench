import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { inflateRawSync, crc32 } from 'node:zlib'
import { writeZip } from './zip-writer.mjs'

/** Read a ZIP32 archive back: entry names in central-directory order, bodies inflated. */
function readZip(buffer) {
  let end = -1
  for (let index = buffer.length - 22; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) { end = index; break }
  }
  assert.ok(end >= 0, 'no end-of-central-directory record')
  const count = buffer.readUInt16LE(end + 8)
  const directoryOffset = buffer.readUInt32LE(end + 16)
  const entries = []
  let cursor = directoryOffset
  for (let index = 0; index < count; index += 1) {
    assert.equal(buffer.readUInt32LE(cursor), 0x02014b50)
    const method = buffer.readUInt16LE(cursor + 10)
    const crc = buffer.readUInt32LE(cursor + 16)
    const compressed = buffer.readUInt32LE(cursor + 20)
    const uncompressed = buffer.readUInt32LE(cursor + 24)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
    cursor += 46 + nameLength + extraLength + commentLength

    assert.equal(buffer.readUInt32LE(localOffset), 0x04034b50)
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const body = buffer.subarray(dataStart, dataStart + compressed)
    entries.push({
      name,
      method,
      crc,
      compressed,
      uncompressed,
      body: method === 8 ? inflateRawSync(body) : Buffer.from(body),
    })
  }
  return entries
}

async function tree(files) {
  const root = await mkdtemp(join(tmpdir(), 'lwb-zip-'))
  for (const [name, body] of Object.entries(files)) {
    const target = join(root, ...name.split('/'))
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, body)
  }
  return root
}

test('an archive round-trips every file it was given', async () => {
  const root = await tree({
    'App.exe': Buffer.from([0x4d, 0x5a, 0x00, 0x01, 0x02]),
    'resources/app.bundle': 'x'.repeat(4096),
    'resources/empty.txt': '',
    'locales/zh-CN.json': JSON.stringify({ hello: '世界' }),
  })
  const output = join(await mkdtemp(join(tmpdir(), 'lwb-zip-out-')), 'package.zip')
  const result = await writeZip({ source: root, output })
  assert.equal(result.entries, 4)

  const entries = readZip(await readFile(output))
  assert.deepEqual(entries.map(entry => entry.name), [
    'App.exe',
    'locales/zh-CN.json',
    'resources/app.bundle',
    'resources/empty.txt',
  ])
  const byName = new Map(entries.map(entry => [entry.name, entry.body.toString('utf8')]))
  assert.equal(byName.get('resources/empty.txt'), '')
  assert.equal(byName.get('resources/app.bundle').length, 4096)
  assert.equal(byName.get('locales/zh-CN.json'), JSON.stringify({ hello: '世界' }))
  assert.equal(byName.get('App.exe'), Buffer.from([0x4d, 0x5a, 0x00, 0x01, 0x02]).toString('utf8'))
})

test('the same tree produces byte-identical archives', async () => {
  const root = await tree({ 'a/one.txt': 'one', 'b/two.txt': 'two' })
  const first = join(await mkdtemp(join(tmpdir(), 'lwb-zip-a-')), 'a.zip')
  const second = join(await mkdtemp(join(tmpdir(), 'lwb-zip-b-')), 'b.zip')
  await writeZip({ source: root, output: first })
  await writeZip({ source: root, output: second })
  assert.deepEqual(await readFile(first), await readFile(second))
})

test('an archive records the sizes its entries really have', async () => {
  const root = await tree({ 'big.bin': 'a'.repeat(200_000) })
  const output = join(await mkdtemp(join(tmpdir(), 'lwb-zip-size-')), 'package.zip')
  await writeZip({ source: root, output, level: 6 })
  const [entry] = readZip(await readFile(output))
  assert.equal(entry.uncompressed, 200_000)
  assert.equal(entry.body.length, 200_000)
})

test('every entry carries the checksum of its uncompressed bytes', async () => {
  // The one thing a reader checks before it trusts anything: zip's CRC is over
  // the *uncompressed* data. An archive whose CRC was taken from the deflate
  // output inflates to the right bytes and is still rejected by `unzip`,
  // PowerShell and Go's `archive/zip` alike.
  const root = await tree({
    'deflated.txt': 'a'.repeat(5000) + 'b'.repeat(5000),
    'stored.zip': 'c'.repeat(5000),
    'empty.txt': '',
  })
  const output = join(await mkdtemp(join(tmpdir(), 'lwb-zip-crc-')), 'package.zip')
  await writeZip({ source: root, output, level: 6, store: name => name.endsWith('.zip') })

  for (const entry of readZip(await readFile(output))) {
    assert.equal(entry.crc, crc32(entry.body), `${entry.name} carries the checksum of its contents`)
  }
})

test('an entry named by the caller is stored instead of deflated', async () => {
  const root = await tree({ 'payload/app.zip': 'z'.repeat(10_000), 'Launcher.exe': 'x'.repeat(10_000) })
  const output = join(await mkdtemp(join(tmpdir(), 'lwb-zip-store-')), 'package.zip')
  await writeZip({ source: root, output, level: 1, store: name => name.endsWith('.zip') })
  const entries = readZip(await readFile(output))
  const byName = new Map(entries.map(entry => [entry.name, entry]))
  // Stored: the body keeps its exact size. Deflated: ten thousand identical
  // bytes collapse to almost nothing, so the two methods are distinguishable.
  assert.equal(byName.get('payload/app.zip').method, 0)
  assert.equal(byName.get('Launcher.exe').method, 8)
  assert.equal(byName.get('payload/app.zip').body.toString('utf8'), 'z'.repeat(10_000))
  assert.equal(byName.get('payload/app.zip').compressed, 10_000)
  assert.ok(byName.get('Launcher.exe').compressed < 1000)
})

test('an empty directory is refused instead of producing an empty archive', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lwb-zip-empty-'))
  const output = join(await mkdtemp(join(tmpdir(), 'lwb-zip-empty-out-')), 'package.zip')
  await assert.rejects(() => writeZip({ source: root, output }), /Nothing to archive/u)
})

test('a large archive does not collect an error listener per backpressure wait', async () => {
  // Waiting for the disk to catch up is the normal case for a 1.3 GB tree, and a
  // listener per wait both leaks and leaves stale handlers behind: the next
  // write failure lands on handlers whose promises are long settled. Enough
  // incompressible data to back the output stream up more than ten times.
  const root = await mkdtemp(join(tmpdir(), 'lwb-zip-pressure-'))
  const warnings = []
  const record = warning => warnings.push(warning.name)
  process.on('warning', record)
  try {
    const blob = randomBytes(4 * 1024 * 1024)
    for (let index = 0; index < 60; index += 1) await writeFile(join(root, `blob${index}.bin`), blob)
    const output = join(await mkdtemp(join(tmpdir(), 'lwb-zip-pressure-out-')), 'package.zip')
    const result = await writeZip({ source: root, output, level: 1 })
    assert.equal(result.entries, 60)
    assert.ok(!warnings.includes('MaxListenersExceededWarning'), `warnings: ${warnings.join(', ')}`)
  } finally {
    process.off('warning', record)
    await rm(root, { recursive: true, force: true })
  }
})

test('an output that cannot be opened is reported instead of crashing the process', async () => {
  // Before the writer kept its own error listener this was an unhandled `error`
  // event: the packaging step died with a stack trace instead of saying the
  // archive could not be written.
  const root = await tree({ 'a.txt': 'hello' })
  const output = join(root, 'missing-directory', 'package.zip')
  await assert.rejects(() => writeZip({ source: root, output }), /ENOENT/u)
})
