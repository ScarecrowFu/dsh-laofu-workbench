/**
 * One host per product home.
 *
 * Two workbench processes over the same product home share one DSH home, one
 * session store and one credential file. The store hands out a write lease per
 * session, so the second process loses whichever conversation the first one is
 * already holding — which the fish pond surfaces as
 * `session "…" is already owned by an active write handle`. Nothing is corrupt;
 * the two carriers simply fight over the same conversations.
 *
 * This lock is the coarser gate: whoever owns `runtime/host.json` is the host
 * that serves that product home. It is deliberately advisory —
 * `LWB_ALLOW_MULTI_HOST=1` skips it — because a development tool that cannot be
 * started at all is worse than one that says why it refused.
 *
 * @module lwb/host-lock
 */
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { readFileSync, rmSync } from 'node:fs'
import { copyFile, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Directory under a product home that holds runtime state. */
const RUNTIME_DIR = 'runtime'
/** Runtime-state file naming the host that owns this product home. */
export const LOCK_FILENAME = 'host.json'
/** Escape hatch: any of `1`, `true`, `yes`, `on` permits a second host. */
export const ALLOW_MULTI_HOST = 'LWB_ALLOW_MULTI_HOST'
/** How many times a stale file may be cleared before giving up on the claim. */
const RECLAIM_ATTEMPTS = 3
/** Values of {@link ALLOW_MULTI_HOST} that read as "yes". */
const AFFIRMATIVE = new Set(['1', 'true', 'yes', 'on'])

/**
 * Where a product home records its running host.
 * @param productHome - the resolved product data root.
 * @returns the absolute path of the lock file.
 */
export function hostLockPath(productHome) {
  return join(productHome, RUNTIME_DIR, LOCK_FILENAME)
}

/**
 * Whether a second host may start anyway.
 * @param env - environment to read; defaults to this process's.
 * @returns true when {@link ALLOW_MULTI_HOST} asks for the check to be skipped.
 */
export function multiHostAllowed(env = process.env) {
  const value = env[ALLOW_MULTI_HOST]
  return typeof value === 'string' && AFFIRMATIVE.has(value.trim().toLowerCase())
}

/**
 * Whether a pid still names a running process.
 *
 * `kill(pid, 0)` only probes: it delivers nothing. `EPERM` means the process
 * exists and belongs to somebody else, which still counts as alive. A recycled
 * pid reads as alive too; that is the price of a probe that needs no shell, and
 * {@link ALLOW_MULTI_HOST} is how the user overrides a wrong answer.
 * @param pid - candidate process id.
 * @returns true when the pid is plausibly running.
 */
export function isHostAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

/**
 * Read the lock file without claiming it.
 * @param productHome - the resolved product data root.
 * @returns the record when the file parses, otherwise undefined.
 */
export function readHostLock(productHome) {
  try {
    return parse(readFileSync(hostLockPath(productHome), 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * Describe the host that refused this one, in the product's own voice.
 * @param options - the holder record, the lock path, and the clock.
 * @returns the lines to print, newline-terminated.
 */
export function busyReport({ holder, file, now = Date.now() }) {
  const started = Number.isFinite(Date.parse(holder?.startedAt ?? '')) ? Date.parse(holder.startedAt) : undefined
  const since = started === undefined ? '启动时间不明' : `${clock(started, now)}启动`
  const where = typeof holder?.url === 'string' && holder.url !== '' ? `，${holder.url}` : ''
  return [
    `老傅工作台已经在跑了（进程 ${holder?.pid ?? '未知'}，${since}${where}）。`,
    '同一个数据目录只能有一个工作台：再开一份会和它抢同一批对话，鱼池里的鱼会提示"被另一个工作台占着"。',
    `那份确实卡死了，就删掉这个文件再启动：${file}`,
    `要强行再开一份，带上环境变量 ${ALLOW_MULTI_HOST}=1。`,
    '',
  ].join('\n')
}

/**
 * Claim this product home for the calling host.
 *
 * The write is one `copyFile` with `COPYFILE_EXCL` from a private temporary
 * file, so a claim either lands whole or loses the race; a half-written file
 * means a crashed writer, and is reclaimed like a dead pid.
 * @param options - the product home, the role recorded for diagnostics, the clock, an env, and
 *   a `skip` for callers that only sometimes serve (a config dump, a `--help`).
 * @returns a verdict: `{ owned: false, holder, file }` when another live host owns the home,
 *   otherwise `{ owned: true, file, record, update, release, releaseSync, releaseOnExit }`.
 */
export async function claimHostLock({ home, role = 'host', now = Date.now, env = process.env, skip = false } = {}) {
  if (typeof home !== 'string' || home === '') throw new Error('host-lock: a product home is required')
  const file = hostLockPath(home)
  if (skip || multiHostAllowed(env)) return inert(file)

  await mkdir(join(home, RUNTIME_DIR), { recursive: true })
  const token = randomUUID()
  const record = { pid: process.pid, role, token, startedAt: new Date(now()).toISOString() }

  for (let attempt = 0; attempt < RECLAIM_ATTEMPTS; attempt += 1) {
    if (await createExclusive(file, record)) return handle({ file, token, record, now })

    const seen = await inspect(file)
    // A corrupt file has no owner left to ask. A live pid — including our own,
    // which means this very process already holds the home — keeps the lock.
    if (seen.state === 'corrupt' || !isHostAlive(seen.record.pid)) {
      await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error })
      continue
    }
    return { owned: false, reason: 'busy', file, holder: seen.record }
  }

  // Every attempt lost a race to somebody who then vanished. Report the file
  // rather than spin: a human can delete it faster than we can guess right.
  const seen = await inspect(file)
  return { owned: false, reason: 'busy', file, holder: seen.state === 'held' ? seen.record : undefined }
}

/**
 * A handle for a carrier that was told not to take the lock, so callers can
 * wire it up once whether or not the gate applied.
 * @param file - the path the lock would have used.
 * @returns a handle whose methods do nothing.
 */
function inert(file) {
  const noop = () => {}
  return {
    owned: true,
    skipped: true,
    file,
    record: undefined,
    update: async () => undefined,
    release: async () => false,
    releaseSync: () => false,
    releaseOnExit: noop,
  }
}

/**
 * Build the moving parts of a claimed lock.
 * @param options - the lock path, the private ownership token, the record, and the clock.
 * @returns the handle the caller keeps for the life of the host.
 */
function handle({ file, token, record, now }) {
  const state = { record }
  const owns = () => {
    try {
      return parse(readFileSync(file, 'utf8'))?.token === token
    } catch {
      return false
    }
  }
  const releaseSync = () => {
    if (!owns()) return false
    rmSync(file, { force: true })
    return true
  }
  return {
    owned: true,
    skipped: false,
    file,
    get record() {
      return state.record
    },
    /**
     * Republish the record — used when the real host process replaces the
     * launcher that spawned it.
     * @param patch - fields to merge over the record.
     * @returns after the file is rewritten.
     */
    async update(patch = {}) {
      state.record = { ...state.record, ...patch, updatedAt: new Date(now()).toISOString() }
      await writeFile(file, JSON.stringify(state.record), { mode: 0o600 })
      return state.record
    },
    /**
     * Drop the claim when this process still holds it.
     * @returns true when the file named us and is now gone.
     */
    async release() {
      if (!owns()) return false
      await rm(file, { force: true })
      return true
    },
    /**
     * Drop the claim from a path where only synchronous work runs — an `exit`
     * handler, or the moment before a signal is re-raised.
     * @returns true when the file named us and is now gone.
     */
    releaseSync,
    /** Release on the way out of this process, however it leaves. */
    releaseOnExit() {
      process.once('exit', releaseSync)
    },
  }
}

/**
 * Create the lock file only if nobody else has.
 * @param file - the lock path.
 * @param record - the record to publish.
 * @returns true when this call created the file.
 */
async function createExclusive(file, record) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(record), { mode: 0o600 })
  try {
    await copyFile(temporary, file, constants.COPYFILE_EXCL)
    return true
  } catch (error) {
    if (error.code === 'EEXIST') return false
    throw error
  } finally {
    await rm(temporary, { force: true })
  }
}

/**
 * Classify the lock file.
 * @param file - the lock path.
 * @returns `{ state: 'absent' }`, `{ state: 'corrupt' }`, or `{ state: 'held', record }`.
 */
async function inspect(file) {
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return { state: 'absent' }
    throw error
  }
  const record = parse(text)
  return record === undefined ? { state: 'corrupt' } : { state: 'held', record }
}

/**
 * Parse a record, rejecting anything without a pid to probe.
 * @param text - file contents.
 * @returns the record, or undefined when the bytes name no host.
 */
function parse(text) {
  try {
    const record = JSON.parse(text)
    return record !== null && typeof record === 'object' ? record : undefined
  } catch {
    return undefined
  }
}

/**
 * Render a wall-clock time for the busy report.
 * @param at - epoch milliseconds.
 * @param now - the current epoch milliseconds.
 * @returns `HH:MM:SS ` today, or `MM-DD HH:MM:SS ` on another day.
 */
function clock(at, now) {
  const when = new Date(at)
  const today = new Date(now)
  const pad = value => String(value).padStart(2, '0')
  const time = `${pad(when.getHours())}:${pad(when.getMinutes())}:${pad(when.getSeconds())}`
  const sameDay = when.getFullYear() === today.getFullYear()
    && when.getMonth() === today.getMonth()
    && when.getDate() === today.getDate()
  return sameDay ? `${time} ` : `${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${time} `
}
