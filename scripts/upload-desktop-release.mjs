/** Upload validated build outputs to a draft release in the build repository. */
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: {
  edition: { type: 'string' }, target: { type: 'string' }, tag: { type: 'string' },
} })
const { edition, target, tag } = values
if (edition !== 'commercial' || !['win-x64', 'mac-arm64', 'mac-x64'].includes(target)) throw new Error('Official release uploads require the commercial build and a supported target')
const directory = resolve('.tooling/artifacts', edition, target)
const report = JSON.parse(await readFile(join(directory, 'build-report.json'), 'utf8'))
if (tag !== `v${report.version}` || report.edition !== edition || report.target !== target) throw new Error('Release tag and build report must match')
const repository = process.env.LWB_RELEASE_REPOSITORY || process.env.GITHUB_REPOSITORY
const token = process.env.LWB_RELEASE_TOKEN || process.env.GH_TOKEN
if (!/^[\w.-]+\/[\w.-]+$/u.test(repository ?? '') || !token) throw new Error('A release repository and token are required (use LWB_RELEASE_REPOSITORY/LWB_RELEASE_TOKEN or GITHUB_REPOSITORY/GH_TOKEN).')
const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }
const endpoint = `https://api.github.com/repos/${repository}`
async function request(path, options = {}) {
  const response = await fetch(`${endpoint}${path}`, { ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`GitHub release request failed (${response.status}): ${await response.text()}`)
  return response.status === 204 ? undefined : response.json()
}
// The tag endpoint can omit unpublished drafts; enumerate authenticated releases.
const matches = []
for (let page = 1; ; page++) {
  const rows = await request(`/releases?per_page=100&page=${page}`)
  matches.push(...rows.filter(row => row.tag_name === tag))
  if (rows.length < 100) break
}
if (matches.length > 1) throw new Error(`Multiple releases use ${tag}; consolidate the drafts before uploading`)
let release = matches[0]
if (!release) {
  const targetCommitish = process.env.LWB_RELEASE_TARGET_COMMITISH
    || (repository === process.env.GITHUB_REPOSITORY ? process.env.GITHUB_SHA : undefined)
  release = await request('/releases', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    tag_name: tag, ...(targetCommitish ? { target_commitish: targetCommitish } : {}), name: `Laofu Workbench ${report.version}`,
    draft: true, prerelease: false, body: 'Laofu Workbench unified official portable release. The attached packages are unsigned; verify SHA256 checksums before installation.',
  }) })
}
if (!release.draft) throw new Error('Build uploads may only modify draft releases')
const assets = await request(`/releases/${release.id}/assets?per_page=100`)
const files = [
  ...report.artifacts.map(row => ({ source: row.file, name: row.file })),
  { source: 'SHA256SUMS.txt', name: `${target}-SHA256SUMS.txt` },
  { source: 'build-report.json', name: `${target}-build-report.json` },
]
for (const file of files) {
  const previous = assets.find(asset => asset.name === file.name)
  if (previous) await request(`/releases/assets/${previous.id}`, { method: 'DELETE' })
  const path = join(directory, file.source)
  const size = (await stat(path)).size
  const upload = new URL(release.upload_url.split('{')[0])
  upload.searchParams.set('name', file.name)
  const result = await fetch(upload, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/octet-stream', 'content-length': String(size) },
    body: Readable.toWeb(createReadStream(path)), duplex: 'half', signal: AbortSignal.timeout(20 * 60_000),
  })
  if (!result.ok) throw new Error(`Release upload failed for ${file.name} (${result.status}): ${await result.text()}`)
  const asset = await result.json()
  if (asset.size !== size || asset.state !== 'uploaded') throw new Error(`Incomplete upload: ${file.name}`)
  console.log(`Uploaded ${file.name} (${size} bytes) to draft ${tag}`)
}
console.log(`Draft release: ${release.html_url}`)
