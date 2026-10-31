#!/usr/bin/env node
/**
 * Publish one validated Desktop build to the product update channel.
 *
 * Three destinations, one command per build leg:
 *   1. Aliyun OSS  — the artifact users actually download from; the ATS release
 *                    points at this object, so the public URL must be reachable
 *                    before the release row is written.
 *   2. GitHub      — the same artifact on the draft release, for provenance and
 *                    public visibility. Delegated to upload-desktop-release.mjs
 *                    so the Windows workflow keeps one upload implementation.
 *   3. ATS         — the release row the shipped app queries. Every leg is
 *                    created UNPUBLISHED, so no user sees a version until all
 *                    platforms exist; `--publish-all` flips them together.
 *
 *   node scripts/release-desktop.mjs --target mac-arm64
 *   node scripts/release-desktop.mjs --target win-x64
 *   node scripts/release-desktop.mjs --publish-all --version 0.1.9
 *
 * The version is read from the build report, never typed, because the value the
 * app reports at runtime is the one electron-builder stamped into that package.
 * A test build (`0.1.9-test.20261030`) is refused: semver ranks it BELOW the
 * release it was cut from, so publishing it would offer an "update" downwards.
 */
import OSS from 'ali-oss'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PRODUCT = 'laofu-workbench'
const DEFAULT_CHANNEL = 'stable'
const DEFAULT_ATS_URL = 'https://link.scitiger.cn'
const DEFAULT_OSS_PREFIX = 'laofu-workbench/releases'
const MULTIPART_THRESHOLD_BYTES = 64 * 1024 * 1024
const RELEASE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u

/** Platform, architecture and artifact type the ATS release row must declare. */
const TARGETS = {
  'mac-arm64': { platform: 'darwin', arch: 'arm64', artifactType: 'mac-app-zip' },
  'mac-x64': { platform: 'darwin', arch: 'x64', artifactType: 'mac-app-zip' },
  'win-x64': { platform: 'win32', arch: 'x64', artifactType: 'portable-exe' },
}

const HELP = `Usage: npm run release:desktop -- <options>

Upload one build leg to OSS, GitHub and the ATS update channel, or publish the
legs of one version together.

Upload options
  --target <name>        mac-arm64 | mac-x64 | win-x64
  --edition <name>       capability-pack set: commercial (default) or community
  --channel <name>       stable (default) or beta
  --notes <file>         release notes; default is the file's text or a stub
  --skip-github          do not touch the GitHub draft release
  --skip-oss             reuse an artifact already uploaded to OSS
  --publish              publish this leg immediately after uploading it

Publish options
  --publish-all          publish every unpublished leg of --version, then verify
  --version <x.y.z>      required with --publish-all

Other
  --dry-run              print the resolved inputs and planned requests only
  -h, --help             show this message

Environment
  LWB_ATS_URL                        default ${DEFAULT_ATS_URL}
  ATS_ADMIN_TOKEN                    optional bearer token; else log in below
  ATS_ADMIN_EMAIL / ATS_ADMIN_PASSWORD
  LWB_RELEASE_OSS_BUCKET             bucket that serves release artifacts
  LWB_RELEASE_OSS_ENDPOINT           e.g. oss-cn-beijing.aliyuncs.com
  LWB_RELEASE_OSS_ACCESS_KEY_ID
  LWB_RELEASE_OSS_ACCESS_KEY_SECRET
  LWB_RELEASE_OSS_PREFIX             default ${DEFAULT_OSS_PREFIX}
  LWB_RELEASE_OSS_PUBLIC_BASE_URL    CDN origin; default bucket endpoint
  LWB_RELEASE_OSS_OBJECT_ACL         default public-read
  LWB_RELEASE_REPOSITORY / GH_TOKEN  same as upload-desktop-release.mjs
`

function fail(message) {
  throw new Error(message)
}

function text(value) {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed === '' ? undefined : trimmed
}

/** Required environment value; fails before any network call when absent. */
function env(name) {
  const value = text(process.env[name])
  if (value === undefined) fail(`${name} is required for this step`)
  return value
}

/**
 * Read KEY=VALUE pairs from a local file without overriding the shell.
 * Release credentials live outside the repository; the file is a convenience.
 * @param file - Candidate dotenv path; a missing file is not an error.
 */
function loadEnvFile(file) {
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(trimmed)
    if (match === null || process.env[match[1]] !== undefined) continue
    const raw = match[2].trim()
    process.env[match[1]] = /^(['"]).*\1$/u.test(raw) ? raw.slice(1, -1) : raw
  }
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/u, '').replace(/\/v1$/iu, '')
}

/** Directory holding one leg's artifacts and its build report. */
function artifactDirectory(edition, target) {
  return resolve(PROJECT_ROOT, '.tooling', 'artifacts', edition, target)
}

/**
 * @returns The build report electron-builder's packaging wrote for this leg.
 */
async function readBuildReport(edition, target) {
  const path = join(artifactDirectory(edition, target), 'build-report.json')
  if (!existsSync(path)) fail(`No build report at ${path}; build this target first.`)
  return JSON.parse(await readFile(path, 'utf8'))
}

/**
 * The report's first artifact is the distributable; blockmaps, checksums and
 * the report itself are siblings, not release payloads.
 * @param report - Parsed build report.
 * @returns File name, byte size and sha256 exactly as the build produced them.
 */
function releaseArtifact(report) {
  const artifacts = Array.isArray(report.artifacts) ? report.artifacts : []
  if (artifacts.length !== 1) fail(`Expected exactly one artifact in the build report, found ${artifacts.length}.`)
  const [artifact] = artifacts
  if (typeof artifact.file !== 'string' || typeof artifact.sha256 !== 'string') fail('Build report artifact is incomplete.')
  return artifact
}

/** Re-hash the shipped file; a report that disagrees with the file is stale. */
async function hashFile(path) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

function encodeObjectKey(key) {
  return key.split('/').map(segment => encodeURIComponent(segment)).join('/')
}

/** Public object URL; a CDN origin wins because release traffic is large. */
function publicObjectUrl(bucket, endpoint, objectKey) {
  const base = text(process.env.LWB_RELEASE_OSS_PUBLIC_BASE_URL)
  if (base !== undefined) return `${base.replace(/\/+$/u, '')}/${encodeObjectKey(objectKey)}`
  const host = endpoint.replace(/^https?:\/\//iu, '').replace(/\/+$/u, '')
  return `https://${bucket}.${host}/${encodeObjectKey(objectKey)}`
}

function ossClient() {
  return new OSS({
    endpoint: env('LWB_RELEASE_OSS_ENDPOINT'),
    bucket: env('LWB_RELEASE_OSS_BUCKET'),
    accessKeyId: env('LWB_RELEASE_OSS_ACCESS_KEY_ID'),
    accessKeySecret: env('LWB_RELEASE_OSS_ACCESS_KEY_SECRET'),
    timeout: Number(process.env.LWB_RELEASE_OSS_TIMEOUT_MS ?? 30 * 60_000),
  })
}

/**
 * Upload one artifact, then prove it is publicly readable before the release
 * row points at it. A row written against an unreachable URL is worse than a
 * failed upload: the update prompt would be offered and never install.
 */
async function uploadArtifact({ client, bucket, endpoint, objectKey, path, size }) {
  const downloadUrl = publicObjectUrl(bucket, endpoint, objectKey)
  const headers = {}
  const acl = text(process.env.LWB_RELEASE_OSS_OBJECT_ACL) ?? 'public-read'
  if (acl !== undefined) headers['x-oss-object-acl'] = acl
  console.log(`Uploading ${objectKey} (${size} bytes)`)
  if (size >= MULTIPART_THRESHOLD_BYTES) {
    await client.multipartUpload(objectKey, path, {
      headers,
      parallel: Number(process.env.LWB_RELEASE_OSS_UPLOAD_PARALLEL ?? 4),
      partSize: Number(process.env.LWB_RELEASE_OSS_UPLOAD_PART_SIZE ?? 10 * 1024 * 1024),
      timeout: Number(process.env.LWB_RELEASE_OSS_TIMEOUT_MS ?? 30 * 60_000),
    })
  } else {
    await client.put(objectKey, path, { headers, timeout: Number(process.env.LWB_RELEASE_OSS_TIMEOUT_MS ?? 30 * 60_000) })
  }
  await verifyDownload(downloadUrl, size)
  return downloadUrl
}

/** HEAD the public URL until OSS answers; a fresh object can lag briefly. */
async function verifyDownload(url, expectedSize) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(30_000) }).catch(() => undefined)
    if (response?.ok === true) {
      const length = Number(response.headers.get('content-length') ?? 0)
      if (length !== 0 && length !== expectedSize) fail(`Public URL size mismatch: expected ${expectedSize}, got ${length}`)
      return
    }
    if (response !== undefined && response.status < 500 && response.status !== 403) {
      fail(`Public URL is not readable (${response.status}): ${url}`)
    }
    await new Promise(resolve => setTimeout(resolve, attempt * 1_000))
  }
  fail(`Public URL never became readable: ${url}`)
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { accept: 'application/json', 'content-type': 'application/json', ...(options.headers ?? {}) },
    signal: AbortSignal.timeout(60_000),
  })
  const body = await response.text()
  if (!response.ok) fail(`${options.method ?? 'GET'} ${url.pathname} failed (${response.status}): ${body || 'no body'}`)
  return body === '' ? undefined : JSON.parse(body)
}

/** Admin bearer token, either supplied or obtained from the admin account. */
async function adminToken(baseUrl) {
  const supplied = text(process.env.ATS_ADMIN_TOKEN)
  if (supplied !== undefined) return supplied
  const account = text(process.env.ATS_ADMIN_EMAIL) ?? text(process.env.ATS_ADMIN_ACCOUNT)
  const password = text(process.env.ATS_ADMIN_PASSWORD)
  if (account === undefined || password === undefined) {
    fail('Set ATS_ADMIN_TOKEN, or ATS_ADMIN_EMAIL and ATS_ADMIN_PASSWORD, to write releases.')
  }
  const session = await requestJson(new URL('/api/auth/login', baseUrl), {
    method: 'POST',
    body: JSON.stringify({ account, password, clientType: 'desktop', deviceName: 'Laofu Workbench release script' }),
  })
  if (typeof session?.accessToken !== 'string') fail('ATS login succeeded without an access token.')
  return session.accessToken
}

function adminRequest(baseUrl, token, path, options = {}) {
  return requestJson(new URL(path, baseUrl), { ...options, headers: { authorization: `Bearer ${token}`, ...(options.headers ?? {}) } })
}

/** Existing row for one version, so a re-run updates instead of duplicating. */
async function findRelease(baseUrl, token, { platform, arch, channel, version }) {
  const query = new URLSearchParams({ product: PRODUCT, platform, arch, channel })
  const rows = await adminRequest(baseUrl, token, `/api/admin/desktop-releases?${query.toString()}`)
  return Array.isArray(rows) ? rows.find(row => row.version === version) : undefined
}

/**
 * Create or update one leg as an unpublished release.
 * @returns The release row as ATS serializes it.
 */
async function upsertRelease(baseUrl, token, payload) {
  const { platform, arch, channel, version } = payload
  const existing = await findRelease(baseUrl, token, { platform, arch, channel, version })
  if (existing !== undefined) {
    if (existing.published === true) {
      fail(`${platform}-${arch} ${version} is already published and immutable; bump the version or unpublish it first.`)
    }
    return adminRequest(baseUrl, token, `/api/admin/desktop-releases/${encodeURIComponent(existing.id)}`, {
      method: 'PATCH', body: JSON.stringify(payload),
    })
  }
  return adminRequest(baseUrl, token, '/api/admin/desktop-releases', { method: 'POST', body: JSON.stringify(payload) })
}

async function publishRelease(baseUrl, token, id) {
  await adminRequest(baseUrl, token, `/api/admin/desktop-releases/${encodeURIComponent(id)}/publish`, { method: 'POST' })
}

/**
 * Ask the public endpoint exactly what a shipped app asks, and compare it to
 * the build this repository just produced. This is the only check that proves
 * the channel is serving the intended bytes rather than a stale row.
 */
async function verifyLatest(baseUrl, { platform, arch, channel, version, sha256 }) {
  const query = new URLSearchParams({ product: PRODUCT, platform, arch, channel, currentVersion: '0.0.0' })
  const latest = await requestJson(new URL(`/api/desktop/releases/v2/latest?${query.toString()}`, baseUrl))
  if (latest?.updateAvailable !== true) fail(`${platform}-${arch} reports no update available after publish`)
  if (latest.manifest?.version !== version) fail(`${platform}-${arch} serves ${latest.manifest?.version}, expected ${version}`)
  if (sha256 !== undefined && latest.manifest?.sha256 !== sha256) fail(`${platform}-${arch} serves a different sha256 than the build`)
  return latest
}

function releaseNotes(version) {
  const path = text(process.env.LWB_RELEASE_NOTES_FILE)
  if (path !== undefined && existsSync(resolve(path))) return readFileSync(resolve(path), 'utf8').trim()
  return `Laofu Workbench ${version}`
}

/** Hand the GitHub half to the existing uploader, which owns draft semantics. */
function uploadToGitHub(edition, target, version) {
  const args = ['scripts/upload-desktop-release.mjs', '--edition', edition, '--target', target, '--tag', `v${version}`]
  const result = spawnSync(process.execPath, args, { cwd: PROJECT_ROOT, stdio: 'inherit', env: process.env })
  if (result.status !== 0) fail(`GitHub upload failed for ${target} (exit ${result.status})`)
}

async function releaseTarget({ target, edition, channel, notesFile, dryRun, skipGithub, skipOss, publish }) {
  const mapping = TARGETS[target]
  if (mapping === undefined) fail(`--target must be one of ${Object.keys(TARGETS).join(', ')}`)
  const report = await readBuildReport(edition, target)
  if (report.target !== target || report.edition !== edition) fail('Build report belongs to another target or edition')
  const version = String(report.version ?? '')
  if (!RELEASE_VERSION.test(version)) {
    fail(`Refusing to publish "${version}": only x.y.z releases belong on the update channel. `
      + 'A -test build ranks below the release it was cut from and would be offered as a downgrade.')
  }
  if (report.autoUpdate === false) {
    console.warn('Warning: this build reports autoUpdate=false; shipped apps will not consult the channel.')
  }
  if (report.unsigned === true) {
    console.warn(mapping.platform === 'darwin'
      ? 'Warning: unsigned build. Gatekeeper will prompt once after the updater replaces the bundle.'
      : 'Warning: unsigned build. SmartScreen will warn the first time the replaced executable runs.')
  }

  const artifact = releaseArtifact(report)
  const directory = artifactDirectory(edition, target)
  const path = join(directory, artifact.file)
  if (!existsSync(path)) fail(`Artifact missing: ${path}`)
  const size = statSync(path).size
  if (size !== artifact.bytes) fail(`Artifact size ${size} does not match the build report (${artifact.bytes})`)
  const sha256 = await hashFile(path)
  if (sha256 !== artifact.sha256) fail(`Artifact sha256 does not match the build report; has the file changed?`)

  const baseUrl = normalizeBaseUrl(text(process.env.LWB_ATS_URL) ?? DEFAULT_ATS_URL)
  const prefix = (text(process.env.LWB_RELEASE_OSS_PREFIX) ?? DEFAULT_OSS_PREFIX).replace(/^\/+|\/+$/gu, '')
  const objectKey = `${prefix}/${target}/${version}/${artifact.file}`

  // A plan is worth reading without credentials: it proves the target, version
  // and artifact wiring before anyone touches a live channel.
  if (dryRun) {
    const bucket = text(process.env.LWB_RELEASE_OSS_BUCKET) ?? '<bucket>'
    const endpoint = text(process.env.LWB_RELEASE_OSS_ENDPOINT) ?? 'oss-cn-beijing.aliyuncs.com'
    console.log(`[dry-run] ${target} ${version}: ${artifact.file} (${size} bytes, sha256 ${sha256.slice(0, 12)}…)`)
    console.log(`[dry-run] OSS object oss://${bucket}/${objectKey}`)
    console.log(`[dry-run] public URL ${publicObjectUrl(bucket, endpoint, objectKey)}`)
    if (!skipGithub) console.log(`[dry-run] GitHub: node scripts/upload-desktop-release.mjs --edition ${edition} --target ${target} --tag v${version}`)
    console.log(`[dry-run] ATS: create or update ${mapping.platform}-${mapping.arch} ${channel} ${version} as unpublished`)
    if (publish === true) console.log('[dry-run] ATS: publish this leg, then verify through the public endpoint')
    return
  }

  let downloadUrl
  if (skipOss) {
    downloadUrl = publicObjectUrl(env('LWB_RELEASE_OSS_BUCKET'), env('LWB_RELEASE_OSS_ENDPOINT'), objectKey)
    console.log(`Reusing OSS object ${objectKey}`)
    await verifyDownload(downloadUrl, size)
  } else {
    downloadUrl = await uploadArtifact({
      client: ossClient(),
      bucket: env('LWB_RELEASE_OSS_BUCKET'),
      endpoint: env('LWB_RELEASE_OSS_ENDPOINT'),
      objectKey, path, size,
    })
  }

  if (!skipGithub) uploadToGitHub(edition, target, version)

  const token = await adminToken(baseUrl)
  const release = await upsertRelease(baseUrl, token, {
    product: PRODUCT,
    version,
    platform: mapping.platform,
    arch: mapping.arch,
    channel,
    artifactType: mapping.artifactType,
    fileName: artifact.file,
    releaseNotes: notesFile === undefined ? releaseNotes(version) : readFileSync(notesFile, 'utf8').trim(),
    downloadUrl,
    sha256,
    sizeBytes: size,
    mandatory: false,
    rolloutPercent: 100,
    // `published` is deliberately absent: ATS refuses it on update (visibility
    // has its own endpoint) and defaults a create to unpublished, which is the
    // whole point of staging every leg before --publish-all.
  })

  if (publish === true) {
    await publishRelease(baseUrl, token, release.id)
    await verifyLatest(baseUrl, { ...mapping, channel, version, sha256 })
    console.log(`Published ${mapping.platform}-${mapping.arch} ${version}`)
  } else {
    console.log(`Staged ${mapping.platform}-${mapping.arch} ${version} (unpublished). Publish the whole version with --publish-all --version ${version}`)
  }
  console.log(JSON.stringify({ product: PRODUCT, target, version, channel, downloadUrl, sha256, sizeBytes: size }, null, 2))
}

/**
 * Publish every leg of one version at once, so no platform is left behind.
 * Verifies through the public endpoint afterwards.
 */
async function publishAll({ version, channel, dryRun }) {
  if (version === undefined || !RELEASE_VERSION.test(version)) fail('--publish-all needs --version x.y.z')
  const baseUrl = normalizeBaseUrl(text(process.env.LWB_ATS_URL) ?? DEFAULT_ATS_URL)
  if (dryRun) {
    const legs = Object.values(TARGETS).map(mapping => `${mapping.platform}-${mapping.arch}`)
    console.log(`[dry-run] publish ${legs.join(', ')} on ${channel} for ${version}, then verify each through the public endpoint`)
    return
  }
  const token = await adminToken(baseUrl)
  const query = new URLSearchParams({ product: PRODUCT, channel })
  const rows = await adminRequest(baseUrl, token, `/api/admin/desktop-releases?${query.toString()}`)
  const legs = (Array.isArray(rows) ? rows : []).filter(row => row.version === version)
  if (legs.length !== Object.keys(TARGETS).length) {
    fail(`Found ${legs.length} release rows for ${version}, expected ${Object.keys(TARGETS).length}. Upload every target first.`)
  }
  for (const leg of legs) {
    if (leg.published === true) {
      console.log(`Already published ${leg.platform}-${leg.arch} ${version}`)
      continue
    }
    await publishRelease(baseUrl, token, leg.id)
    console.log(`Published ${leg.platform}-${leg.arch} ${version}`)
  }
  for (const leg of legs) {
    await verifyLatest(baseUrl, { platform: leg.platform, arch: leg.arch, channel, version })
  }
  console.log(`Verified all ${legs.length} legs of ${version} on ${channel}.`)
}

async function main() {
  const { values } = parseArgs({
    options: {
      target: { type: 'string' },
      version: { type: 'string' },
      channel: { type: 'string' },
      edition: { type: 'string' },
      notes: { type: 'string' },
      publish: { type: 'boolean' },
      'publish-all': { type: 'boolean' },
      'skip-github': { type: 'boolean' },
      'skip-oss': { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  if (values.help === true) {
    console.log(HELP)
    return
  }
  loadEnvFile(join(PROJECT_ROOT, '.env.local'))
  loadEnvFile(join(PROJECT_ROOT, '.env.release'))
  const edition = text(values.edition) ?? 'commercial'
  if (!['commercial', 'community'].includes(edition)) fail('--edition must be commercial or community')
  const channel = text(values.channel) ?? DEFAULT_CHANNEL
  if (!['stable', 'beta'].includes(channel)) fail('--channel must be stable or beta')
  const notesPath = text(values.notes)
  if (notesPath !== undefined && !existsSync(notesPath)) fail(`Release notes not found: ${notesPath}`)

  if (values['publish-all'] === true) {
    await publishAll({ version: text(values.version), channel, dryRun: values['dry-run'] === true })
    return
  }
  const target = text(values.target)
  if (target === undefined) fail('Pass --target <name>, or --publish-all --version <x.y.z>')
  // A typed version would silently do nothing here — the target's version comes
  // from its own build report, because that is what the artifact actually is.
  // Accepting the flag and ignoring it is how someone publishes 0.1.8 thinking
  // they published 0.1.9.
  if (text(values.version) !== undefined) {
    fail('--version only applies to --publish-all. A single target publishes the version in its build-report.json.')
  }
  await releaseTarget({
    target,
    edition,
    channel,
    notesFile: notesPath,
    dryRun: values['dry-run'] === true,
    skipGithub: values['skip-github'] === true,
    skipOss: values['skip-oss'] === true,
    publish: values.publish === true,
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
