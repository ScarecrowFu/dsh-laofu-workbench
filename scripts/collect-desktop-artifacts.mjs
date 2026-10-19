import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { edition: { type: 'string' }, target: { type: 'string' } } })
if (!['community', 'commercial'].includes(values.edition) || !['mac-arm64', 'mac-x64', 'win-x64'].includes(values.target)) throw new Error('Specify a Desktop edition and supported test target')
const directory = resolve('.tooling', 'artifacts', values.edition, values.target)
const extensions = values.target.startsWith('mac-') ? ['.zip'] : ['.exe']
const files = (await readdir(directory)).filter(file => extensions.some(ext => file.endsWith(ext))).sort()
for (const ext of extensions) if (!files.some(file => file.endsWith(ext))) throw new Error(`Missing ${ext} Desktop artifact`)
const records = []
for (const file of files) {
  if (!file.includes('-portable-unsigned.')) throw new Error(`Expected an explicitly unsigned portable artifact: ${file}`)
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of createReadStream(join(directory, file))) { hash.update(chunk); bytes += chunk.length }
  records.push({ file, bytes, sha256: hash.digest('hex') })
}
const upstream = JSON.parse(await readFile('lwb/UPSTREAM.lock.json', 'utf8'))
const product = JSON.parse(await readFile('package.json', 'utf8'))
const buildNumber = process.env.LWB_DESKTOP_BUILD_NUMBER ?? process.env.GITHUB_RUN_NUMBER ?? '1'
if (!/^\d+$/u.test(buildNumber)) throw new Error('Desktop test build number must be numeric')
const release = process.env.LWB_DESKTOP_RELEASE === '1'
const report = {
  edition: values.edition, target: values.target, version: release ? product.version : `${product.version}-test.${buildNumber}`,
  unsigned: true, portable: true, notarized: false, autoUpdate: false,
  workflowCommit: process.env.GITHUB_SHA ?? null, upstream, artifacts: records,
  runner: process.env.RUNNER_NAME ?? null,
  packagedPackAcceptance: true,
}
await writeFile(join(directory, 'SHA256SUMS.txt'), records.map(record => `${record.sha256}  ${record.file}\n`).join(''))
await writeFile(join(directory, 'build-report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
