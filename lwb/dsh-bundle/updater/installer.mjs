/**
 * Hand a verified release to an updater process that outlives this one.
 *
 * The workbench cannot replace itself: on macOS the bundle it lives in is the
 * same directory it would have to rewrite. Something outside the app has to do
 * the swap — but that something cannot be *inside* the app either, or it would
 * be the file being replaced.
 *
 * Each platform therefore has its own out-of-process installer:
 *
 * - macOS ships a plain shell script, copied into a directory the product owns
 *   before it is started, so that whatever the shell does to the app's bundle
 *   afterwards cannot take the updater with it.
 * - Windows hands the job to the launcher. It already owns the versioned
 *   installation directory under `%LOCALAPPDATA%`, so an update is "unpack the
 *   new build beside the current one and switch to it" — done by the same code
 *   that installs a first launch, with a rollback if the new build never comes
 *   up. Nothing in the user's own folder is touched.
 *
 * This module resolves what "the app" is on this machine, refuses the cases it
 * cannot handle honestly, and starts that installer with everything it needs in
 * the environment.
 */
import { spawn } from 'node:child_process'
import { access, chmod, copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), 'scripts')
const JOB_HISTORY = 5
/** Written once a start has told the user what the last run did. */
const ACKNOWLEDGED = 'acknowledged'
/** How the launcher recognises a downloaded release waiting beside it. */
const STAGED_RECORD = 'staged.json'

/** Entry script for the one platform whose installer is a script. */
function scriptFiles(platform) {
  return platform === 'darwin' ? [{ name: 'lwb-update.sh', mode: 0o755 }] : []
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
    // Windows is installed by the launcher, which owns the versioned directory
    // under `%LOCALAPPDATA%` and switches between them. Nothing in the user's
    // folder is replaced, so the launch package does not have to be writable —
    // it only has to exist, because the launcher itself starts the new build.
    const launcher = env.LWB_DESKTOP_LAUNCHER
    if (!launcher) {
      // Reaching this means the app was started from somewhere other than the
      // launch package — typically the unpacked directory a build leaves behind,
      // which cannot update itself because it does not own an install directory.
      return { ok: false, reason: '当前不是从启动器打开的，无法自动更新。请用下载包里的「Laofu Workbench.exe」打开后重试。' }
    }
    const info = await stat(launcher).catch(() => undefined)
    if (!info?.isFile()) return { ok: false, reason: '未找到启动器，无法自动更新。请重新下载安装包。' }
    return { ok: true, platform, target: launcher, kind: 'launcher-package', artifactType: 'launch-package-zip' }
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
 * Write the job, prepare the installer, and start it detached.
 *
 * A script installer is copied rather than referenced in place because the
 * shell may remove the directory the product was running from while the
 * updater works: on macOS the bundle being replaced is the one holding it. A
 * copy in the product's own data root survives that. The launcher needs no copy
 * — it lives outside the application entirely.
 *
 * @param options - launch inputs.
 * @param options.updatesRoot - product-owned directory for staged updates.
 * @param options.job - what to install and where.
 * @param options.job.platform - `process.platform` of this install.
 * @param options.job.kind - installation method, as resolved by `resolveInstallTarget`.
 * @param options.job.target - what the installer replaces, or starts.
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
    kind: job.kind,
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
    LWB_UPDATE_TARGET: job.target,
    LWB_UPDATE_ARTIFACT: job.artifact,
    LWB_UPDATE_TYPE: job.artifactType,
    LWB_UPDATE_VERSION: job.version,
    LWB_UPDATE_LOG: logPath,
    LWB_UPDATE_RESULT: resultPath,
    LWB_UPDATE_WAIT_PID: String(job.waitPid),
    LWB_UPDATE_HOST_PID: String(job.hostPid),
  }
  // The command line carries no path at all. Both installers are entered by
  // name or by an executable path this module already resolved, so a data root
  // with spaces or Chinese characters never has to survive command-line quoting
  // or a console code page.
  const invocation = job.kind === 'launcher-package'
    ? await launcherInvocation({ job, environment, resultPath, logPath })
    : job.platform === 'darwin'
      ? { command: '/bin/sh', args: ['lwb-update.sh'], cwd: jobDirectory, environment }
      : undefined
  if (invocation === undefined) throw new Error('当前安装方式没有可用的更新程序，请重新下载安装包。')

  await new Promise((resolveLaunch, rejectLaunch) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: invocation.environment,
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
 * Describe the downloaded release to the launcher, beside the file itself.
 *
 * The launcher trusts the file it finds next to `staged.json` only after
 * re-checking its size and checksum, so this record is a claim, not an
 * instruction: the signature over the release manifest was already verified in
 * this process before the file was staged. The field names are a contract with
 * `lwb/desktop/launcher/staged.go`, which reads `sizeBytes` as either a number
 * or a string and requires `fileName` to be a bare file name.
 * @param options - what is being staged.
 * @param options.artifact - the verified artifact on local disk.
 * @param options.version - version being installed.
 * @param options.sha256 - artifact checksum.
 * @param options.artifactType - ATS artifact type of that file.
 * @returns the record that was written.
 */
export async function writeStagedRecord({ artifact, version, sha256, artifactType }) {
  const { size } = await stat(artifact)
  const record = {
    schemaVersion: 1,
    version,
    fileName: basename(artifact),
    sha256,
    sizeBytes: size,
    artifactType,
    preparedAt: new Date().toISOString(),
  }
  await writeFile(join(dirname(artifact), STAGED_RECORD), `${JSON.stringify(record, null, 2)}\n`)
  return record
}

/**
 * Name the launcher process to run, and where it should look.
 * @param options - launcher inputs.
 * @param options.job - the update being installed.
 * @param options.environment - base environment for the launcher.
 * @param options.resultPath - where the launcher reports its outcome.
 * @param options.logPath - log file the launcher appends to.
 * @returns the spawn description.
 */
async function launcherInvocation({ job, environment, resultPath, logPath }) {
  await writeStagedRecord({
    artifact: job.artifact,
    version: job.version,
    sha256: job.sha256,
    artifactType: job.artifactType,
  })
  const stagedDirectory = dirname(job.artifact)
  return {
    command: job.target,
    args: ['--apply-staged'],
    cwd: stagedDirectory,
    environment: {
      ...environment,
      LWB_STAGED_DIR: stagedDirectory,
      // The launcher's own vocabulary: the two processes it must outlast, and
      // where it reports. `LWB_UPDATE_*` stays inherited as well — the same job
      // record is what the workbench reads next start.
      LWB_WAIT_PID: String(job.waitPid),
      LWB_HOST_PID: String(job.hostPid),
      LWB_UPDATE_LOG: logPath,
      LWB_UPDATE_RESULT: resultPath,
    },
  }
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
