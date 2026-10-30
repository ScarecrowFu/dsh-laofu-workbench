/**
 * The browser a pack character uses on the owner's behalf.
 *
 * Two routes, chosen by what is installed, and the same shape for the model
 * either way — a script run from the shell, not a tool mounted in a preset:
 *
 * - **ego lite**: the owner's own browser, already signed in. It does not open
 *   a public CDP port; its `ego-browser` command is the only way in, and it can
 *   address any of the owner's ego profiles.
 * - **Chrome / Edge**: a dedicated profile per character, inside the pack
 *   workspace, launched with a remote-debugging port. Chrome refuses remote
 *   debugging on the owner's default profile (136+), so it is never theirs; it
 *   is signed in once and stays signed in.
 *
 * Why scripts and not the browser-use preset: its attach mode is exclusive per
 * browser and is held for as long as the Agent lives, and a pack Session's
 * Agent lives until the process ends. Two tasks of one character would leave
 * the second without a browser. A script connects, works, and disconnects.
 *
 * The dedicated browser is launched by the OS (`open -n` on macOS, detached
 * elsewhere), not as a child of this process: it keeps its own sandbox, and it
 * outlives a workbench restart the way the owner's own browser would.
 *
 * Run as a CLI: `node pack-browser.mjs run --dir <profile dir> <script.mjs>`.
 * The script runs with `page` (a fresh tab), `context` and `browser` in scope;
 * the tab is closed afterwards unless the script sets `keep = true`.
 *
 * @module lwb/pack-browser
 */

import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dshPackageEntry } from './dsh-adapter/package-paths.mjs'

const PORT_FILE = 'cdp-port'
const PROFILE_DIR = 'profile'
const LAUNCH_WAIT_MS = 20_000

/** Where Chromium browsers live, per platform, in preference order. */
function chromiumCandidates(platform = process.platform, env = process.env) {
  if (platform === 'darwin') {
    const apps = [['Google Chrome', 'Google Chrome'], ['Microsoft Edge', 'Microsoft Edge']]
    return apps.flatMap(([app, binary]) => ['/Applications', join(homedir(), 'Applications')]
      .map((root) => ({ name: app, app: join(root, `${app}.app`), executable: join(root, `${app}.app`, 'Contents', 'MacOS', binary) })))
  }
  if (platform === 'win32') {
    const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA].filter(Boolean)
    return [
      ...roots.map((root) => ({ name: 'Google Chrome', executable: join(root, 'Google', 'Chrome', 'Application', 'chrome.exe') })),
      ...roots.map((root) => ({ name: 'Microsoft Edge', executable: join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe') })),
    ]
  }
  const dirs = String(env.PATH || '').split(delimiter).filter(Boolean)
  return ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']
    .flatMap((binary) => dirs.map((dir) => ({ name: binary, executable: join(dir, binary) })))
}

/** The first installed Chrome or Edge, or null. */
export function findChromium(options = {}) {
  return chromiumCandidates(options.platform, options.env).find((item) => existsSync(item.executable)) || null
}

/** The `ego-browser` command, or null. Onboarding puts it in `~/.local/bin`, which a GUI-launched workbench may not have on PATH. */
export function findEgo(env = process.env) {
  const names = process.platform === 'win32' ? ['ego-browser.exe', 'ego-browser.cmd', 'ego-browser'] : ['ego-browser']
  const dirs = [...String(env.PATH || '').split(delimiter), join(homedir(), '.local', 'bin')].filter(Boolean)
  for (const dir of dirs) for (const name of names) if (existsSync(join(dir, name))) return join(dir, name)
  return null
}

function run(command, args, timeout = 30_000) {
  return new Promise((resolvePromise, reject) => {
    execFile(command, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stderr: String(stderr || '') }))
      else resolvePromise(String(stdout || ''))
    })
  })
}

/**
 * Run an `ego-browser nodejs` snippet and return everything it printed.
 *
 * Two quirks of the CLI: with an open stdin it reads the script from there and
 * fails, and its runtime prints `console.log` to stderr. So stdin is closed
 * and both streams are read.
 */
function egoEval(command, code, timeout = 30_000) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, ['nodejs', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    const timer = setTimeout(() => child.kill(), timeout)
    child.stdout.on('data', (data) => { output += data })
    child.stderr.on('data', (data) => { output += data })
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolvePromise(output)
      else reject(Object.assign(new Error(`ego-browser 退出码 ${code}`), { stderr: output }))
    })
  })
}

/** The owner's ego profiles: `{ id, name, isDefault }[]`. */
export async function egoProfiles(command = findEgo()) {
  if (!command) return []
  const output = await egoEval(command, 'console.log(JSON.stringify(await profiles()))')
  const line = output.trim().split('\n').reverse().find((item) => item.trim().startsWith('['))
  const list = line ? JSON.parse(line) : []
  return Array.isArray(list) ? list.filter((item) => item && typeof item.id === 'string') : []
}

/** Everything a page needs to say which route a character has. */
export async function browserStatus() {
  const ego = findEgo()
  let profiles = []
  let egoError = null
  if (ego) {
    try { profiles = await egoProfiles(ego) } catch (error) { egoError = String(error?.stderr || error?.message || error).trim().slice(0, 300) }
  }
  const chromium = findChromium()
  return {
    ego: { available: Boolean(ego), command: ego, profiles, error: egoError },
    chromium: chromium ? { available: true, name: chromium.name, executable: chromium.executable } : { available: false },
    platform: process.platform,
  }
}

async function alive(endpoint) {
  try {
    const response = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1_500) })
    return response.ok
  } catch { return false }
}

function freePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolvePromise(port))
    })
  })
}

/**
 * The port this profile's browser listens on, chosen once and kept.
 *
 * Kept beside the profile so it survives restarts: a browser left open from
 * the last session is found again instead of a second one being launched on
 * the same profile, which Chrome would hand to the first and exit.
 */
async function portOf(dir) {
  const file = join(dir, PORT_FILE)
  const stored = Number((await readFile(file, 'utf8').catch(() => '')).trim())
  if (Number.isInteger(stored) && stored > 1024 && stored < 65536) return stored
  const port = await freePort()
  await mkdir(dir, { recursive: true })
  await writeFile(file, `${port}\n`, 'utf8')
  return port
}

/**
 * The dedicated browser for one profile directory, running.
 * @param dir - absolute directory the profile lives under.
 * @param options.url - page to open when it has to be launched (e.g. a login page).
 * @returns `{ endpoint, launched }`.
 */
export async function ensureDedicated(dir, { url = 'about:blank', chromium = findChromium() } = {}) {
  if (!chromium) throw new Error('这台电脑上没有找到 Chrome 或 Edge。')
  const root = resolve(dir)
  let port = await portOf(root)
  let endpoint = `http://127.0.0.1:${port}`
  if (await alive(endpoint)) return { endpoint, launched: false }
  // Something else took the port since it was chosen: choose again.
  if (await portTaken(port)) {
    port = await freePort()
    await writeFile(join(root, PORT_FILE), `${port}\n`, 'utf8')
    endpoint = `http://127.0.0.1:${port}`
  }
  const args = [
    `--user-data-dir=${join(root, PROFILE_DIR)}`,
    `--remote-debugging-port=${port}`,
    '--no-first-run', '--no-default-browser-check',
    url,
  ]
  if (process.platform === 'darwin' && chromium.app) {
    await run('open', ['-n', '-a', chromium.app, '--args', ...args])
  } else {
    spawn(chromium.executable, args, { detached: true, stdio: 'ignore' }).unref()
  }
  const deadline = Date.now() + LAUNCH_WAIT_MS
  while (Date.now() < deadline) {
    if (await alive(endpoint)) return { endpoint, launched: true }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 300))
  }
  throw new Error(`${chromium.name} 没有在 ${LAUNCH_WAIT_MS / 1000} 秒内打开调试端口。`)
}

function portTaken(port) {
  return new Promise((resolvePromise) => {
    const server = createServer()
    server.unref()
    server.once('error', () => resolvePromise(true))
    server.listen(port, '127.0.0.1', () => server.close(() => resolvePromise(false)))
  })
}

/** Open a page in the dedicated browser for the owner to look at or sign in. */
export async function openDedicated(dir, url = 'about:blank') {
  const { endpoint, launched } = await ensureDedicated(dir, { url })
  if (launched) return { endpoint, opened: url }
  const response = await fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
  if (!response.ok) throw new Error('浏览器没有打开新页面。')
  return { endpoint, opened: url }
}

/** This file, as the command a character runs from the shell. */
export function dedicatedCommand(dir) {
  const quote = (value) => (process.platform === 'win32' ? `"${value}"` : `'${String(value).replaceAll("'", `'\\''`)}'`)
  return `${quote(process.execPath)} ${quote(fileURLToPath(import.meta.url))} run --dir ${quote(resolve(dir))}`
}

/**
 * Run one script against the dedicated browser, then let go of it.
 * @param dir - profile directory.
 * @param file - an ES module; top-level code runs with `page`, `context`, `browser`.
 */
export async function runScript(dir, file) {
  const { endpoint } = await ensureDedicated(dir)
  const driver = await import(dshPackageEntry('playwright-core'))
  const chromium = driver.chromium ?? driver.default?.chromium
  const browser = await chromium.connectOverCDP(endpoint)
  const context = browser.contexts()[0] || await browser.newContext()
  const page = await context.newPage()
  const scope = { page, context, browser, keep: false }
  Object.assign(globalThis, scope)
  try {
    await import(pathToFileURL(resolve(file)).href)
  } finally {
    if (!globalThis.keep) await page.close().catch(() => {})
    // Disconnects; a browser reached over CDP is not closed by this.
    await browser.close().catch(() => {})
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , verb, ...rest] = process.argv
  const flag = rest.indexOf('--dir')
  const dir = flag >= 0 ? rest[flag + 1] : ''
  const file = rest.filter((_, index) => index !== flag && index !== flag + 1)[0]
  if (verb !== 'run' || !dir || !file) {
    console.error('用法：node pack-browser.mjs run --dir <浏览器目录> <脚本.mjs>')
    process.exit(2)
  }
  runScript(dir, file).then(() => process.exit(0), (error) => { console.error(error?.stack || String(error)); process.exit(1) })
}
