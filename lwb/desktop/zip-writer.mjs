/**
 * Write a ZIP archive without an external archiver.
 *
 * The Windows launcher package needs one archive of the whole application
 * directory, produced by whichever host runs the build: a Windows runner for the
 * release, a developer machine for a test build. Shelling out to `zip`, `7z` or
 * `Compress-Archive` would make the same input produce different bytes, sizes and
 * runtimes per host, and none of them is guaranteed to exist on both. This writer
 * is ~200 lines of the format itself, so the archive is the same everywhere.
 *
 * Entries are stored sorted, with a fixed timestamp, so two runs over the same
 * tree produce the same archive.
 *
 * A caller can name entries to store rather than deflate. The launch package
 * wraps a `app.zip` that is already deflated: compressing it again costs minutes
 * of CPU on a multi-hundred-megabyte file and returns almost nothing.
 */
import { createReadStream, createWriteStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { createDeflateRaw } from 'node:zlib'
import { Transform } from 'node:stream'

const LOCAL_HEADER = 0x04034b50
const DATA_DESCRIPTOR = 0x08074b50
const CENTRAL_HEADER = 0x02014b50
const END_OF_CENTRAL = 0x06054b50
const FLAG_DATA_DESCRIPTOR = 0x0008
const FLAG_UTF8 = 0x0800
const METHOD_STORE = 0
const METHOD_DEFLATE = 8
/** 1980-01-01 00:00, the earliest timestamp the format can express. */
const FIXED_TIME = 0
const FIXED_DATE = 0x0021
const MAX_ENTRIES = 100_000
const MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024 - 1

let crcTable

function crc32(chunk, previous = 0) {
  if (crcTable === undefined) {
    crcTable = new Uint32Array(256)
    for (let index = 0; index < 256; index += 1) {
      let value = index
      for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
      crcTable[index] = value >>> 0
    }
  }
  let crc = (previous ^ 0xffffffff) >>> 0
  for (let index = 0; index < chunk.length; index += 1) crc = crcTable[(crc ^ chunk[index]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** Collect every regular file under `root`, as sorted posix relative paths. */
async function collectFiles(root) {
  const files = []
  const walk = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(absolute)
        continue
      }
      if (!entry.isFile()) continue
      files.push({ absolute, name: relative(root, absolute).split(sep).join('/') })
    }
  }
  await walk(root)
  files.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
  return files
}

class Writer {
  constructor(stream) {
    this.stream = stream
    this.offset = 0
  }

  async write(buffer) {
    this.offset += buffer.length
    if (this.stream.write(buffer)) return
    await new Promise((resolve, reject) => {
      this.stream.once('drain', resolve)
      this.stream.once('error', reject)
    })
  }
}

function localHeader(name, method) {
  const nameBytes = Buffer.from(name, 'utf8')
  const header = Buffer.alloc(30)
  header.writeUInt32LE(LOCAL_HEADER, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(FLAG_DATA_DESCRIPTOR | FLAG_UTF8, 6)
  header.writeUInt16LE(method, 8)
  header.writeUInt16LE(FIXED_TIME, 10)
  header.writeUInt16LE(FIXED_DATE, 12)
  header.writeUInt32LE(0, 14)
  header.writeUInt32LE(0, 18)
  header.writeUInt32LE(0, 22)
  header.writeUInt16LE(nameBytes.length, 26)
  header.writeUInt16LE(0, 28)
  return { header, nameBytes }
}

function descriptor(crc, compressed, uncompressed) {
  const buffer = Buffer.alloc(16)
  buffer.writeUInt32LE(DATA_DESCRIPTOR, 0)
  buffer.writeUInt32LE(crc, 4)
  buffer.writeUInt32LE(compressed, 8)
  buffer.writeUInt32LE(uncompressed, 12)
  return buffer
}

function centralHeader(entry) {
  const nameBytes = Buffer.from(entry.name, 'utf8')
  const header = Buffer.alloc(46)
  header.writeUInt32LE(CENTRAL_HEADER, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(20, 6)
  header.writeUInt16LE(FLAG_DATA_DESCRIPTOR | FLAG_UTF8, 8)
  header.writeUInt16LE(entry.method, 10)
  header.writeUInt16LE(FIXED_TIME, 12)
  header.writeUInt16LE(FIXED_DATE, 14)
  header.writeUInt32LE(entry.crc, 16)
  header.writeUInt32LE(entry.compressed, 20)
  header.writeUInt32LE(entry.uncompressed, 24)
  header.writeUInt16LE(nameBytes.length, 28)
  header.writeUInt16LE(0, 30)
  header.writeUInt16LE(0, 32)
  header.writeUInt16LE(0, 34)
  header.writeUInt16LE(0, 36)
  header.writeUInt32LE(0, 38)
  header.writeUInt32LE(entry.offset, 42)
  return Buffer.concat([header, nameBytes])
}

function endOfCentral(count, directorySize, directoryOffset) {
  const buffer = Buffer.alloc(22)
  buffer.writeUInt32LE(END_OF_CENTRAL, 0)
  buffer.writeUInt16LE(0, 4)
  buffer.writeUInt16LE(0, 6)
  buffer.writeUInt16LE(count, 8)
  buffer.writeUInt16LE(count, 10)
  buffer.writeUInt32LE(directorySize, 12)
  buffer.writeUInt32LE(directoryOffset, 16)
  buffer.writeUInt16LE(0, 20)
  return buffer
}

/**
 * Archive `source` into one ZIP at `output`.
 * @param options - archive inputs.
 * @param options.source - directory whose contents become the archive root.
 * @param options.output - archive path to create.
 * @param options.level - deflate level; 1 favours speed on a multi-gigabyte tree.
 * @param options.store - names to store instead of deflating, because they are
 *   already compressed; receives the archive-relative posix path.
 * @param options.onProgress - called with the number of entries written so far.
 * @returns the entry count and the archive's byte size.
 */
export async function writeZip({ source, output, level = 1, store = () => false, onProgress = () => {} }) {
  const files = await collectFiles(source)
  if (files.length === 0) throw new Error(`Nothing to archive in ${source}`)
  if (files.length > MAX_ENTRIES) throw new Error(`Too many files to archive: ${files.length}`)

  const stream = createWriteStream(output, { mode: 0o644 })
  const writer = new Writer(stream)
  const entries = []
  let total = 0
  try {
    for (const [index, file] of files.entries()) {
      const info = await stat(file.absolute)
      if (info.size > MAX_TOTAL_BYTES) throw new Error(`File is too large for a ZIP32 archive: ${file.absolute}`)
      total += info.size
      if (total > MAX_TOTAL_BYTES) throw new Error('Archive would exceed the 4 GB ZIP32 limit')
      const entry = await writeEntry(writer, file, info.size, level, store(file.name))
      entries.push(entry)
      if (index % 500 === 0) onProgress(index + 1)
    }
    const directoryOffset = writer.offset
    let directorySize = 0
    for (const entry of entries) {
      const header = centralHeader(entry)
      directorySize += header.length
      await writer.write(header)
    }
    await writer.write(endOfCentral(entries.length, directorySize, directoryOffset))
    await new Promise((resolve, reject) => {
      stream.once('close', resolve)
      stream.once('error', reject)
      stream.end()
    })
    onProgress(files.length)
    const written = await stat(output)
    return { entries: entries.length, bytes: written.size }
  } catch (error) {
    stream.destroy()
    throw error
  }
}

async function writeEntry(writer, file, size, level, storeBytes) {
  const offset = writer.offset
  if (size === 0) {
    const { header, nameBytes } = localHeader(file.name, METHOD_STORE)
    await writer.write(header)
    await writer.write(nameBytes)
    await writer.write(descriptor(0, 0, 0))
    return { name: file.name, method: METHOD_STORE, crc: 0, compressed: 0, uncompressed: 0, offset }
  }
  const method = storeBytes ? METHOD_STORE : METHOD_DEFLATE
  const { header, nameBytes } = localHeader(file.name, method)
  await writer.write(header)
  await writer.write(nameBytes)
  // The CRC covers the *uncompressed* bytes, so it is taken from the file as it
  // is read, before the deflate transform. Taking it from the compressed stream
  // produces an archive that extracts to the right bytes and still fails every
  // reader's integrity check.
  let crc = 0
  const tap = new Transform({
    transform(chunk, _encoding, callback) {
      crc = crc32(chunk, crc)
      callback(null, chunk)
    },
  })
  const source = createReadStream(file.absolute)
  source.once('error', error => tap.destroy(error))
  const body = source.pipe(tap)
  const out = storeBytes ? body : body.pipe(createDeflateRaw({ level }))
  let written = 0
  for await (const chunk of out) {
    written += chunk.length
    await writer.write(chunk)
  }
  if (written > MAX_TOTAL_BYTES) throw new Error(`Entry is too large: ${file.name}`)
  await writer.write(descriptor(crc, written, size))
  return { name: file.name, method, crc, compressed: written, uncompressed: size, offset }
}
