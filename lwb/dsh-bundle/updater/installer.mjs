/**
 * Hand a verified release to an updater process that outlives this one.
 *
 * The workbench cannot replace itself: on Windows the executable it is running
 * from is locked, and on macOS the bundle it lives in is the same directory it
 * would have to rewrite. Something outside the app has to do the swap — but
 * that something cannot be *inside* the app either, or it would be the file
 * being replaced. Both platforms therefore ship a plain script, copied into a
 * directory the product owns before it is started, so that whatever the shell
 * does to the app's own directory afterwards cannot take the updater with it.
 *
 * This module resolves what "the app" is on this machine, refuses the cases it
 * cannot handle honestly, and starts that script with everything it needs in
 * the environment.
 */
import { spawn } from 'node:child_process'
import { access, chmod, copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), 'scripts')
const JOB_HISTORY = 5
/** Written once a start has told the user what the last run did. */
const ACKNOWLEDGED = 'acknowledged'

/** Entry script, PowerShell payload and job record for one platform. */
function scriptFiles(platform) {
  return platform === 'darwin'
    ? [{ name: 'lwb-update.sh', mode: 0o755 }]
    : [{ name: 'lwb-update.cmd', mode: 0o644 }, { name: 'lwb-update.ps1', mode: 0o644 }]
}

/** Whether `path` is a directory the current user can write to. */
async function writable(directory) {
  try {
    await access(directory, constants.W_OK)
    return true
  } catch {
    return false
  }
}

/**
 * What this installation is, in terms the updater can replace.
 *
 * `LWB_DESKTOP_*` is published by the Desktop entry point before the Host
 * starts, because the Host runs as a Node-mode child: it sees the Electron
 * binary as its own executable, and on Windows that is the *extracted* app
 * inside the portable shell's temporary directory rather than the portable
 * file the user actually runs.
 * @param options - resolution inputs.
 * @param options.platform - `process.platform` of this install.
 * @param options.env - environment published by the Desktop entry point.
 * @returns the replaceable target, or why this build cannot be updated in place.
 */
export async function resolveInstallTarget({ platform, env = process.env }) {
  if (platform === 'darwin') {
    const bundle = env.LWB_DESKTOP_APP_BUNDLE
    if (!bundle || !bundle.endsWith('.app')) {
      return { ok: false, reason: '未找到应用包位置，无法自动更新。请重新下载安装。' }
    }
    const info = await stat(bundle).catch(() => undefined)
    if (!info?.isDirectory()) return { ok: false, reason: '当前应用包不在预期位置，无法自动更新。请重新下载安装。' }
    // A copy launched from a mounted disk image or a read-only volume can be
    // read but not replaced; failing here leaves the app running and says why.
    if (!await writable(dirname(bundle))) {
      return { ok: false, reason: '当前应用所在目录不可写（可能从磁盘映像运行），请把它移动到「应用程序」后重试。' }
    }
    return { ok: true, platform, target: bundle, kind: 'app-bundle', artifactType: 'mac-app-zip' }
  }
  if (platform === 'win32') {
    const executable = env.LWB_DESKTOP_PORTABLE_FILE
    if (!executable) {
      return { ok: false, reason: '当前不是便携版，无法自动替换。请重新下载安装包。' }
    }
    const info = await stat(executable).catch(() => undefined)
    if (!info?.isFile()) return { ok: false, reason: '未找到便携版可执行文件，无法自动更新。请重新下载安装包。' }
    if (!await writable(dirname(executable))) {
      return { ok: false, reason: '当前可执行文件所在目录不可写，请将它移动到可写目录后重试。' }
    }
    return { ok: true, platform, target: executable, kind: 'portable-exe', artifactType: 'portable-exe' }
  }
  return { ok: false, reason: '当前系统暂不支持自动更新。' }
}

/** Keep the job directory from growing one entry per release, forever. */
async function pruneJobs(root) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const dated = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const info = await stat(join(root, entry.name)).catch(() => undefined)
    dated.push({ name: entry.name, at: info?.mtimeMs ?? 0 })
  }
  dated.sort((left, right) => right.at - left.at)
  for (const { name } of dated.slice(JOB_HISTORY)) {
    await rm(join(root, name), { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Write the job, copy the scripts beside it, and start the updater detached.
 *
 * The scripts are copied rather than referenced in place because both shells
 * may remove the directory the product was running from while the updater
 * works: on Windows the portable shell clears its extraction directory as soon
 * as the app exits, and on macOS the bundle being replaced is the one holding
 * them. A copy in the product's own data root survives both.
 *
 * @param options - launch inputs.
 * @param options.updatesRoot - product-owned directory for staged updates.
 * @param options.job - what to install and where.
 * @param options.job.platform - `process.platform` of this install.
 * @param options.job.target - path the updater replaces.
 * @param options.job.artifact - verified artifact on local disk.
 * @param options.job.artifactType - ATS artifact type of that file.
 * @param options.job.version - version being installed.
 * @param options.job.sha256 - artifact checksum, for the job record and directory name.
 * @param options.job.waitPid - process the updater waits for, then stops.
 * @param options.job.hostPid - this Host process, stopped if it outlives the app.
 * @returns the job directory and log location.
 */
export async function launchUpdater({ updatesRoot, job }) {
  const root = join(updatesRoot, 'jobs')
  await mkdir(root, { recursive: true })
  await pruneJobs(root)
  const jobDirectory = join(root, `${job.version}-${job.sha256.slice(0, 8)}`)
  await rm(jobDirectory, { recursive: true, force: true })
  await mkdir(jobDirectory, { recursive: true })

  const files = scriptFiles(job.platform)
  for (const file of files) {
    const destination = join(jobDirectory, file.name)
    await copyFile(join(SCRIPT_DIRECTORY, file.name), destination)
    // A copied script keeps its bytes but not necessarily its mode; the shell
    // script has to be runnable by /bin/sh even when the copy came from a
    // read-only product directory.
    await chmod(destination, file.mode).catch(() => {})
  }

  const logPath = join(jobDirectory, 'update.log')
  const resultPath = join(jobDirectory, 'result.txt')
  await writeFile(logPath, '')
  await rm(resultPath, { force: true }).catch(() => {})
  const record = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    platform: job.platform,
    target: job.target,
    artifact: job.artifact,
    artifactType: job.artifactType,
    version: job.version,
    sha256: job.sha256,
    waitPid: job.waitPid,
    hostPid: job.hostPid,
    log: logPath,
    result: resultPath,
  }
  await writeFile(join(jobDirectory, 'job.json'), `${JSON.stringify(record, null, 2)}\n`)

  const environment = {
    ...process.env,
    LWB_UPDATE_JOB: join(jobDirectory, 'job.json'),
    LWB_UPDATE_SCRIPT: join(jobDirectory, 'lwb-update.ps1'),
    LWB_UPDATE_TARGET: job.target,
    LWB_UPDATE_ARTIFACT: job.artifact,
    LWB_UPDATE_TYPE: job.artifactType,
    LWB_UPDATE_VERSION: job.version,
    LWB_UPDATE_LOG: logPath,
    LWB_UPDATE_RESULT: resultPath,
    LWB_UPDATE_WAIT_PID: String(job.waitPid),
    LWB_UPDATE_HOST_PID: String(job.hostPid),
  }
  // The command line carries no path at all. Both shells are entered by name
  // from the job directory, so a data root with spaces or Chinese characters
  // never has to survive command-line quoting or a console code page.
  const invocation = job.platform === 'darwin'
    ? { command: '/bin/sh', args: ['lwb-update.sh'] }
    : { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/c', 'lwb-update.cmd'] }

  await new Promise((resolveLaunch, rejectLaunch) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: jobDirectory,
      env: environment,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.once('error', rejectLaunch)
    child.once('spawn', () => { child.unref(); resolveLaunch() })
  })

  return { jobDirectory, logPath, resultPath }
}

/**
 * Read what the last updater run reported.
 *
 * A finished run always writes a result file. Its absence means the updater was
 * never started, was killed, or crashed — all of which are reported as an
 * interrupted update rather than as success, so the staged artifact is kept for
 * another attempt.
 * @param updatesRoot - product-owned directory for staged updates.
 * @returns the newest job's outcome, or undefined when nothing was attempted.
 */
export async function readLastUpdateResult(updatesRoot) {
  const root = join(updatesRoot, 'jobs')
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  // Job directories are named after the version, which sorts lexically rather
  // than semantically — 0.1.10 lands before 0.1.9. Order by the run's own
  // timestamp so the newest attempt is the one that gets reported.
  const jobs = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const jobDirectory = join(root, entry.name)
    const record = await readFileJson(join(jobDirectory, 'job.json'))
    jobs.push({ jobDirectory, record, createdAt: typeof record?.createdAt === 'string' ? record.createdAt : entry.name })
  }
  jobs.sort((left, right) => left.createdAt < right.createdAt ? 1 : left.createdAt > right.createdAt ? -1 : 0)
  const latest = jobs[0]
  if (!latest) return undefined
  const { jobDirectory, record } = latest
  // A run that has already been reported must not be reported again on every
  // later start: the user would see the same "update failed" months on.
  if (await exists(join(jobDirectory, ACKNOWLEDGED))) return undefined
  const text = await readText(join(jobDirectory, 'result.txt'))
  return {
    jobDirectory,
    logPath: join(jobDirectory, 'update.log'),
    version: typeof record?.version === 'string' ? record.version : undefined,
    requestedAt: typeof record?.createdAt === 'string' ? record.createdAt : undefined,
    ...(text === undefined
      ? { ok: false, error: '更新器没有留下结果，更新可能被中断。' }
      : text.startsWith('ok ')
        ? { ok: true }
        : { ok: false, error: text.replace(/^fail\s*/u, '') || '更新失败。' }),
  }
}

/** Mark one run as reported, keeping its log for whoever asks about it later. */
export async function acknowledgeUpdateResult(jobDirectory) {
  await writeFile(join(jobDirectory, ACKNOWLEDGED), `${new Date().toISOString()}\n`).catch(() => {})
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function readText(path) {
  try {
    const value = await readFile(path, 'utf8')
    return value.trim() || undefined
  } catch {
    return undefined
  }
}

async function readFileJson(path) {
  const text = await readText(path)
  if (!text) return undefined
  try { return JSON.parse(text) } catch { return undefined }
}
