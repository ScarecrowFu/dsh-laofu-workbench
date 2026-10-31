/** Product entry point; official files stay intact, with an in-memory entry policy. */
import { app, BrowserWindow } from 'electron'
import { cp, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { installLwbEntryPolicy } from './lwb-entry-policy.mjs'
import { migrateRuntimePackRegistry } from './registry-migration.mjs'

const payload = join(process.resourcesPath, 'lwb-product')
const build = JSON.parse(await readFile(join(payload, 'build.json'), 'utf8'))
const configuredProductHome = process.env.LWB_PRODUCT_HOME
const defaultProductHome = join(app.getPath('appData'), build.productHome || 'LaofuWorkbench')
const legacyProductHome = join(app.getPath('appData'), 'LaofuWorkbenchCommercial')
app.setName(build.productName || 'Laofu Workbench')

/** Keep a missing path from reading as a failure. */
const ignoreMissing = error => { if (error.code !== 'ENOENT') throw error }

/**
 * Bring the window that already exists back to the front.
 *
 * A second launch is a request to look at the workbench, not to start a second
 * one — so the window is restored, raised, and focused.
 */
function focusExistingWindow() {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }
}

/** Ship this build, migrate the data root, then hand control to the official Desktop entry. */
async function boot() {
  if (!configuredProductHome && defaultProductHome.endsWith('LaofuWorkbench')
    && !await stat(defaultProductHome).catch(ignoreMissing)
    && await stat(legacyProductHome).catch(ignoreMissing)) {
    await rename(legacyProductHome, defaultProductHome)
  }
  const productHome = configuredProductHome || defaultProductHome
  const runtime = join(productHome, 'runtime', build.id)
  // The writable copy owns peer links and dynamic pack code. Business data is
  // outside it; replacing a product build never rewrites a pack workspace.
  if (!await stat(join(runtime, 'build.json')).catch(ignoreMissing)) {
    const temporary = `${runtime}.${process.pid}.tmp`
    await mkdir(join(productHome, 'runtime'), { recursive: true })
    try {
      await cp(payload, temporary, { recursive: true })
      await rename(temporary, runtime)
    } finally { await rm(temporary, { recursive: true, force: true }) }
  }
  await migrateRuntimePackRegistry(join(productHome, 'packs.json'), { productHome, currentRuntime: runtime })
  Object.assign(process.env, {
    LWB_PRODUCT_HOME: productHome,
    LWB_DSH_HOME: join(productHome, 'dsh-home'),
    DSH_HOME: join(productHome, 'dsh-home'),
    LWB_PROFILE_ID: 'desktop',
    LWB_PROFILE_DIR: join(productHome, 'dsh-home', 'profiles', 'desktop'),
    LWB_DSH_RUNTIME_DIR: join(app.getAppPath(), 'dsh'),
    LWB_PACKS_DIR: join(runtime, 'lwb', 'packs'),
    LWB_PACK_RUNTIME_DIR: join(runtime, 'lwb', 'packs'),
    DSH_DESKTOP_USER_DATA_DIR: join(productHome, 'electron-user-data'),
    // The Host runs as a Node-mode child, so it sees the Electron binary as its
    // own executable — and on Windows that is the copy inside the portable
    // shell's temporary directory, not the file the user launched. Publish what
    // an in-place update actually has to replace, while `app` is still around to
    // name it.
    LWB_DESKTOP_EXECUTABLE: process.execPath,
    ...(process.platform === 'darwin' ? { LWB_DESKTOP_APP_BUNDLE: resolve(process.resourcesPath, '..', '..') } : {}),
    ...(process.env.PORTABLE_EXECUTABLE_FILE ? { LWB_DESKTOP_PORTABLE_FILE: process.env.PORTABLE_EXECUTABLE_FILE } : {}),
  })
  app.setPath('userData', join(productHome, 'electron-user-data'))
  const { prepareLwbProfile } = await import(pathToFileURL(join(runtime, 'lwb', 'profile-setup.mjs')))
  await prepareLwbProfile()
  installLwbEntryPolicy(new URL('./lib/main.js', import.meta.url))
  await import('./lib/main.js')
}

// One window per data root. The official Desktop entry never asks for the
// single-instance lock, so a second launch — a Windows double-click, macOS
// `open -n`, or a copied `.app` — would serve the same data root twice and the
// two hosts would fight over whichever conversation the other one is holding.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', focusExistingWindow)
  await boot()
}
