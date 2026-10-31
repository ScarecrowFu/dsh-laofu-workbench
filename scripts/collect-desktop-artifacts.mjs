import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { readBuildRecord } from '../lwb/desktop/package-report.mjs'

const { values } = parseArgs({ options: { edition: { type: 'string' }, target: { type: 'string' } } })
if (!['community', 'commercial'].includes(values.edition) || !['mac-arm64', 'mac-x64', 'win-x64'].includes(values.target)) throw new Error('Specify a Desktop edition and supported test target')
const directory = resolve('.tooling', 'artifacts', values.edition, values.target)
const editions = JSON.parse(await readFile('lwb/desktop/editions.json', 'utf8'))
// The build describes itself: version (with any `-test.N` suffix) and whether
// it is a release come from the record inside the unpacked app, never from
// the environment of whoever runs this script.
const build = readBuildRecord({ directory, target: values.target, productName: editions.editions[values.edition].productName })
const extensions = values.target.startsWith('mac-') ? ['.zip'] : ['.exe']
// Only this build's artifacts: the directory keeps earlier versions' files
// until someone moves them, and hashing those would describe the wrong build.
const marker = `-${build.version}-${values.target}-`
const files = (await readdir(directory)).filter(file => file.includes(marker) && extensions.some(ext => file.endsWith(ext))).sort()
for (const ext of extensions) if (!files.some(file => file.endsWith(ext))) throw new Error(`Missing ${ext} Desktop artifact for ${build.version}`)
const records = []
for (const file of files) {
  if (!file.includes('-portable-unsigned.')) throw new Error(`Expected an explicitly unsigned portable artifact: ${file}`)
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of createReadStream(join(directory, file))) { hash.update(chunk); bytes += chunk.length }
  records.push({ file, bytes, sha256: hash.digest('hex') })
}
const upstream = JSON.parse(await readFile('lwb/UPSTREAM.lock.json', 'utf8'))
const report = {
  edition: values.edition, target: values.target, version: build.version,
  // Every build ships the updater; whether it ever looks for a release is
  // decided by the build record, and that is `release` itself. A `-test.N`
  // build reports false because it genuinely will not consult the channel —
  // reporting false for a release would be the opposite mistake.
  unsigned: true, portable: true, notarized: false, autoUpdate: build.release,
  workflowCommit: process.env.GITHUB_SHA ?? null, upstream, artifacts: records,
  runner: process.env.RUNNER_NAME ?? null,
  packagedPackAcceptance: true,
}
await writeFile(join(directory, 'SHA256SUMS.txt'), records.map(record => `${record.sha256}  ${record.file}\n`).join(''))
await writeFile(join(directory, 'build-report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
