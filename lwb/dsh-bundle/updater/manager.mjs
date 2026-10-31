/**
 * The workbench's own update lifecycle, owned by the Host.
 *
 * Everything that can leak — the release channel, the installation id, the
 * downloaded artifact — stays on this side of the RPC boundary. The browser
 * only ever sees a small state object: which version is being offered, whether
 * it is already on disk, and what the user can do about it.
 *
 * The lifecycle is deliberately linear and resumable: check, verify, download
 * and stage; then hand the staged file to an updater that outlives this process
 * and report the outcome on the next start. A crash, a power cut, or a user who
 * closes the window mid-download therefore costs one download, never a broken
 * installation.
 */
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import {
  MAX_ARTIFACT_BYTES,
  normalizeChannel,
  parseManifest,
  parseSignature,
  releaseSummary,
  validateRelease,
} from './manifest.mjs'
import { acknowledgeUpdateResult, launchUpdater, readLastUpdateResult, resolveInstallTarget } from './installer.mjs'

const REQUEST_TIMEOUT_MS = 20_000
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000
const LATEST_PATH = '/api/desktop/releases/v2/latest'
const ACTIVE_PHASES = new Set(['checking', 'downloading', 'installing'])

function nowIso() {
  return new Date().toISOString()
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

async function hashFile(path) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch { return undefined }
}

/**
 * One installation's updater.
 *
 * A build that was not produced as a release — a local `-test.N` package — is
 * never offered an update: it is not the same product as the published release,
 * and silently turning a test build into a release build would hide exactly the
 * difference the test build exists to show.
 */
export class LwbUpdateManager {
  /**
   * @param options - installation facts.
   * @param options.updatesRoot - product-owned directory for update state.
   * @param options.build - product build record from `build.json`.
   * @param options.currentVersion - version of the running build.
   * @param options.baseUrl - ATS base URL.
   * @param options.platform - `process.platform` of this install.
   * @param options.arch - `process.arch` of this install.
   * @param options.env - environment published by the Desktop entry point.
   * @param options.fetch - fetch implementation, injectable for tests.
   */
  constructor(options) {
    this.options = options
    this.product = options.build?.product || 'laofu-workbench'
    this.channel = normalizeChannel(options.build?.channel)
    this.platform = options.platform
    this.arch = options.arch
    this.currentVersion = options.currentVersion
    this.enabled = Boolean(options.build?.release === true && options.baseUrl)
    this.updatesRoot = options.updatesRoot
    this.statePath = join(options.updatesRoot, 'update-state.json')
    this.stagedRoot = join(options.updatesRoot, 'staged')
    this.installationIdPath = join(options.updatesRoot, 'installation-id')
    this.restoring = undefined
    this.checking = undefined
    this.state = this.baseState()
  }

  baseState() {
    return {
      phase: this.enabled ? 'idle' : 'disabled',
      enabled: this.enabled,
      currentVersion: this.currentVersion,
      product: this.product,
      platform: this.platform,
      arch: this.arch,
      channel: this.channel,
      checkedAt: undefined,
      preparedAt: undefined,
      progress: undefined,
      error: undefined,
      release: null,
      ignoredVersion: undefined,
      updatedTo: undefined,
      canInstall: false,
      installHint: undefined,
      logPath: undefined,
      reason: this.enabled ? undefined : this.disabledReason(),
    }
  }

  disabledReason() {
    if (!this.options.build) return '未找到产品构建信息，不检查更新。'
    if (this.options.build.release !== true) return '当前是本地测试构建，不检查更新。'
    if (!this.options.baseUrl) return '未配置更新服务地址，不检查更新。'
    return '当前环境不支持自动更新。'
  }

  /** Snapshot for the browser. Never includes the artifact path or the id. */
  snapshot() {
    return { ...this.state }
  }

  /**
   * Absorb what the previous run left behind, once.
   *
   * A run that reported success clears the staged artifact and records the new
   * version, so the sidebar can confirm the update instead of offering it
   * again. A run that failed keeps the artifact, so the retry is a click rather
   * than another 400 MB download.
   * @returns the current state.
   */
  async ready() {
    if (!this.restoring) this.restoring = this.restore().catch((error) => {
      this.state = { ...this.state, phase: 'failed', error: error.message }
      return this.snapshot()
    })
    return this.restoring
  }

  async restore() {
    const stored = await readJson(this.statePath)
    if (!this.enabled) return this.snapshot()
    const base = this.baseState()
    this.state = {
      ...base,
      ...(typeof stored?.ignoredVersion === 'string' ? { ignoredVersion: stored.ignoredVersion } : {}),
      ...(typeof stored?.updatedTo === 'string' ? { updatedTo: stored.updatedTo } : {}),
    }
    const outcome = await readLastUpdateResult(this.updatesRoot)
    if (!outcome) return this.persist()
    // Reported once, then acknowledged: a failure that happened before the last
    // restart is history, not a warning that should greet every future start.
    await acknowledgeUpdateResult(outcome.jobDirectory)
    if (outcome.ok) {
      this.state = { ...this.state, phase: 'idle', release: null, preparedAt: undefined, updatedTo: outcome.version || this.currentVersion, logPath: outcome.logPath }
      await rm(this.stagedRoot, { recursive: true, force: true }).catch(() => {})
      return this.persist()
    }
    // A restart after a successful install never reaches this branch, so a
    // recorded failure here belongs to the run the user just asked for.
    const stillStaged = typeof stored?.release?.version === 'string' ? stored.release : null
    this.state = { ...this.state, phase: stillStaged ? 'ready' : 'failed', release: stillStaged, error: outcome.error, logPath: outcome.logPath }
    return this.persist()
  }

  async persist() {
    if (!this.enabled) return this.snapshot()
    await writeJsonAtomic(this.statePath, {
      schemaVersion: 1,
      ignoredVersion: this.state.ignoredVersion,
      updatedTo: this.state.updatedTo,
      release: this.state.release,
      preparedAt: this.state.preparedAt,
    }).catch(() => {})
    return this.snapshot()
  }

  update(patch) {
    this.state = { ...this.state, ...patch }
    return this.state
  }

  /**
   * Ask ATS what this installation should be running, and stage it if so.
   *
   * Concurrent callers share one request: the sidebar, a manual click, and the
   * startup schedule all want the same answer, and three downloads of the same
   * artifact would be three times the bandwidth for one result.
   * @param options - check inputs.
   * @param options.force - ignore a throttled interval.
   * @returns the resulting state.
   */
  async check({ force = false } = {}) {
    if (!this.enabled) return this.snapshot()
    // The startup schedule and the sidebar can both arrive first; absorbing the
    // previous run's outcome before asking for a new one keeps a "ready"
    // artifact from being reported as a fresh download.
    await this.ready()
    if (this.checking) return this.checking
    if (!force && this.state.phase === 'installing') return this.snapshot()
    this.checking = this.runCheck().finally(() => { this.checking = undefined })
    return this.checking
  }

  async runCheck() {
    this.update({ phase: 'checking', error: undefined, progress: undefined })
    try {
      const url = new URL(LATEST_PATH, this.options.baseUrl)
      url.searchParams.set('product', this.product)
      url.searchParams.set('platform', this.platform)
      url.searchParams.set('arch', this.arch)
      url.searchParams.set('channel', this.channel)
      url.searchParams.set('currentVersion', this.currentVersion)
      url.searchParams.set('installationId', await this.installationId())
      const response = await (this.options.fetch ?? fetch)(url, {
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof payload?.message === 'string' && payload.message ? payload.message : `检查更新失败（${response.status}）。`)

      if (payload.updateAvailable !== true) {
        // A release staged earlier stays usable when the rollout later hides it.
        if (this.state.phase === 'ready' && this.state.release) return this.update({ phase: 'ready', checkedAt: nowIso(), error: undefined })
        return this.update({ phase: 'idle', checkedAt: nowIso(), release: null, preparedAt: undefined, error: undefined, canInstall: false, installHint: undefined })
      }

      const manifest = parseManifest(payload.manifest)
      const signature = parseSignature(payload.signature, payload.signatureAlgorithm)
      validateRelease(manifest, signature, {
        product: this.product,
        platform: this.platform,
        arch: this.arch,
        channel: this.channel,
        currentVersion: this.currentVersion,
      })
      if (manifest.version === this.state.ignoredVersion) {
        return this.update({ phase: 'idle', checkedAt: nowIso(), release: null, canInstall: false, ignoredVersion: this.state.ignoredVersion })
      }

      if (await this.stagedArtifactIsValid(manifest)) {
        const target = await this.installTarget()
        return this.update({
          phase: 'ready',
          checkedAt: nowIso(),
          preparedAt: this.state.preparedAt || nowIso(),
          release: releaseSummary(manifest),
          canInstall: target.ok,
          installHint: target.ok ? undefined : target.reason,
          error: undefined,
        })
      }

      this.update({ phase: 'downloading', checkedAt: nowIso(), release: releaseSummary(manifest), progress: { received: 0, total: Number(manifest.sizeBytes) } })
      await this.stage(manifest)
      const target = await this.installTarget()
      const next = this.update({
        phase: 'ready',
        preparedAt: nowIso(),
        progress: undefined,
        canInstall: target.ok,
        installHint: target.ok ? undefined : target.reason,
        error: undefined,
      })
      await this.persist()
      return next
    } catch (error) {
      this.update({ phase: 'failed', checkedAt: nowIso(), error: error.message, progress: undefined, canInstall: false })
      return this.snapshot()
    }
  }

  /** Whether this installation can replace itself, and where. */
  async installTarget() {
    return resolveInstallTarget({ platform: this.platform, env: this.options.env ?? process.env })
  }

  /** A stable, anonymous install id: ATS uses it for rollout bucketing. */
  async installationId() {
    try {
      const existing = (await readFile(this.installationIdPath, 'utf8')).trim()
      if (/^[A-Za-z0-9_-]{16,128}$/u.test(existing)) return existing
    } catch {}
    const value = randomBytes(24).toString('base64url')
    await mkdir(dirname(this.installationIdPath), { recursive: true })
    await writeFile(this.installationIdPath, value, { mode: 0o600 })
    return value
  }

  stageDirectory(manifest) {
    return join(this.stagedRoot, `${manifest.version}-${manifest.sha256.slice(0, 16)}`)
  }

  /** Whether the artifact for this exact release is already on disk, intact. */
  async stagedArtifactIsValid(manifest) {
    const directory = this.stageDirectory(manifest)
    const artifact = join(directory, manifest.fileName)
    try {
      const info = await stat(artifact)
      if (info.size !== Number(manifest.sizeBytes)) return false
      const marker = await readJson(join(directory, 'staged.json'))
      if (marker?.sha256 !== manifest.sha256 || marker?.version !== manifest.version) return false
      return (await hashFile(artifact)) === manifest.sha256
    } catch {
      return false
    }
  }

  /**
   * Download the artifact, hashing as it arrives.
   *
   * The checksum is computed over the bytes that were actually written, not
   * over a second read of the file, so a truncated or substituted body cannot
   * pass. The staging directory is removed on any failure, which keeps a
   * half-written artifact from being mistaken for a prepared update.
   */
  async stage(manifest) {
    const directory = this.stageDirectory(manifest)
    const artifact = join(directory, manifest.fileName)
    const partial = `${artifact}.partial-${process.pid}`
    await rm(directory, { recursive: true, force: true })
    await mkdir(directory, { recursive: true })
    const expected = Number(manifest.sizeBytes)
    try {
      const response = await (this.options.fetch ?? fetch)(manifest.downloadUrl, {
        headers: { accept: 'application/octet-stream' },
        redirect: 'error',
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      })
      if (!response.ok || !response.body) throw new Error(`下载更新包失败（${response.status}）。`)
      if (!response.url.startsWith('https://')) throw new Error('更新包下载地址必须使用 HTTPS。')
      const advertised = Number(response.headers.get('content-length') || 0)
      if (advertised && advertised !== expected) throw new Error('更新包大小与发布清单不一致。')

      const output = createWriteStream(partial, { flags: 'wx', mode: 0o600 })
      const hash = createHash('sha256')
      let received = 0
      try {
        for await (const chunk of response.body) {
          received += chunk.byteLength
          if (received > expected || received > MAX_ARTIFACT_BYTES) throw new Error('更新包大小超过发布清单限制。')
          hash.update(chunk)
          if (!output.write(chunk)) await new Promise((resolveDrain, rejectDrain) => {
            output.once('drain', resolveDrain)
            output.once('error', rejectDrain)
          })
          // Progress is read by the sidebar while this loop runs; writing it
          // into the state object costs nothing and avoids a second channel.
          if (received - (this.state.progress?.received ?? 0) > 4 * 1024 * 1024) {
            this.update({ progress: { received, total: expected } })
          }
        }
        output.end()
        await new Promise((resolveFinish, rejectFinish) => {
          output.once('finish', resolveFinish)
          output.once('error', rejectFinish)
        })
      } catch (error) {
        output.destroy()
        throw error
      }
      if (received !== expected) throw new Error('更新包大小校验失败。')
      if (hash.digest('hex') !== manifest.sha256) throw new Error('更新包完整性校验失败。')
      await rename(partial, artifact)
      await writeJsonAtomic(join(directory, 'staged.json'), {
        schemaVersion: 1,
        version: manifest.version,
        fileName: manifest.fileName,
        sha256: manifest.sha256,
        sizeBytes: manifest.sizeBytes,
        artifactType: manifest.artifactType,
        preparedAt: nowIso(),
      })
    } catch (error) {
      await rm(directory, { recursive: true, force: true }).catch(() => {})
      throw error
    } finally {
      await rm(partial, { force: true }).catch(() => {})
    }
  }

  /**
   * Hand the staged release to the updater and let it stop this application.
   *
   * Nothing after the spawn can run reliably — the updater kills the window
   * that would show an error — so every condition that could make the swap fail
   * is rejected here, while the workbench is still alive to explain it.
   * @returns the state the browser renders while it waits to be restarted.
   */
  async install() {
    if (!this.enabled) throw new Error(this.disabledReason())
    if (this.state.phase !== 'ready') throw new Error('更新包尚未准备完成。')
    const release = this.state.release
    if (!release?.version) throw new Error('更新包尚未准备完成。')
    const staged = await this.findStagedMarker(release.version)
    if (!staged) throw new Error('已暂存的更新包已失效，请重新检查更新。')
    // Check the destination before reading 400 MB back off the disk: a read-only
    // application directory is the common failure, and it is cheap to detect.
    const target = await this.installTarget()
    if (!target.ok) throw new Error(target.reason)
    if (staged.artifactType !== target.artifactType) {
      throw new Error('更新包类型与当前安装方式不匹配，请重新下载安装包。')
    }

    const artifact = join(this.stagedRoot, `${staged.version}-${staged.sha256.slice(0, 16)}`, staged.fileName)
    const info = await stat(artifact).catch(() => undefined)
    if (!info?.isFile() || info.size !== Number(staged.sizeBytes)) throw new Error('已暂存的更新包已失效，请重新检查更新。')
    if ((await hashFile(artifact)) !== staged.sha256) throw new Error('已暂存的更新包已损坏，请重新检查更新。')

    const launched = await launchUpdater({
      updatesRoot: this.updatesRoot,
      job: {
        platform: this.platform,
        kind: target.kind,
        target: target.target,
        artifact,
        artifactType: staged.artifactType,
        version: staged.version,
        sha256: staged.sha256,
        waitPid: process.ppid,
        hostPid: process.pid,
      },
    })
    this.update({ phase: 'installing', logPath: launched.logPath, error: undefined })
    await this.persist()
    return this.snapshot()
  }

  /** The newest staged marker, used when the state file lost its checksum. */
  async findStagedMarker(version) {
    const entries = await readdir(this.stagedRoot, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith(`${version}-`)) continue
      const marker = await readJson(join(this.stagedRoot, entry.name, 'staged.json'))
      if (marker?.version === version && typeof marker.sha256 === 'string') return marker
    }
    return undefined
  }

  /** Stop offering this version until a newer one appears. */
  async ignore() {
    const version = this.state.release?.version
    if (!version) return this.snapshot()
    this.update({ phase: 'idle', ignoredVersion: version, release: null, canInstall: false, installHint: undefined, preparedAt: undefined, progress: undefined, error: undefined })
    await rm(this.stagedRoot, { recursive: true, force: true }).catch(() => {})
    await this.persist()
    return this.snapshot()
  }

  /** Close a notice without recording a preference. */
  async dismiss() {
    if (this.state.phase === 'installing') return this.snapshot()
    this.update({ phase: 'idle', release: null, error: undefined, canInstall: false, installHint: undefined })
    await this.persist()
    return this.snapshot()
  }

  /** Whether a phase is worth polling quickly. */
  static isActive(state) {
    return ACTIVE_PHASES.has(state?.phase)
  }
}
