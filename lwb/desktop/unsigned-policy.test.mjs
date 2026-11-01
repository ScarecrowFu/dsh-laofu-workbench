import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DSH_ROOT } from '../upstream.mjs'
import { desktopPnpmInvocation } from './toolchain.mjs'
import { adaptUnsignedBuilder, adaptUnsignedPreparation } from './unsigned-policy.mjs'
import { registers } from './unsigned-register.mjs'

test('the pinned builder disables release signing, policy and updater only in unsigned mode', async () => {
  const source = await readFile(join(DSH_ROOT, 'apps/desktop/scripts/electron-builder-config.mjs'), 'utf8')
  const adapted = adaptUnsignedBuilder(source)
  assert.match(adapted, /identity: unsigned \? '-' : macOSSigning/u)
  assert.match(adapted, /notarize: !unsigned/u)
  assert.match(adapted, /forceCodeSigning: !unsigned/u)
  assert.match(adapted, /const policy = unsigned \? undefined : resolveDesktopPolicyEnvironment/u)
  assert.match(adapted, /const update = unsigned \? undefined : resolveDesktopAutoUpdateConfig/u)
  assert.match(adapted, /resolvedPlatform === 'win32' && env\.LWB_DESKTOP_PORTABLE !== '1'/u)
  assert.match(adapted, /resolvedPlatform !== 'win32' \|\| env\.LWB_DESKTOP_PORTABLE === '1'/u)
  assert.throws(() => adaptUnsignedBuilder(source.replace("const unsigned = env.DSH_DESKTOP_UNSIGNED === '1'", 'const unsigned = false')), /no longer matches/u)
})

test('preparation keeps official runtime checks and uses verified ad-hoc signatures', async () => {
  const source = await readFile(join(DSH_ROOT, 'apps/desktop/scripts/prepare-dsh.ts'), 'utf8')
  const require = createRequire(join(DSH_ROOT, 'apps/desktop/package.json'))
  const { transformSync } = require('esbuild')
  for (const input of [source, transformSync(source, { loader: 'ts', format: 'esm' }).code]) {
    const adapted = adaptUnsignedPreparation(input)
    assert.match(adapted, /signAdHocRuntime\(DSH_OUTPUT_ROOT\)/u)
    assert.match(adapted, /smokePreparedRuntime/u)
    assert.match(adapted, /verifyDesktopRuntime/u)
    assert.doesNotMatch(adapted, /'sign:dsh-native'/u)
  }
  assert.throws(() => adaptUnsignedPreparation(source.replace('sign:dsh-native', 'changed')), /no longer matches/u)
})

test('the portable Windows builder skips NSIS preparation and keeps production dependencies', () => {
  const module = pathToFileURL(join(DSH_ROOT, 'apps/desktop/scripts/electron-builder-config.mjs')).href
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    const { createElectronBuilderConfig } = await import(${JSON.stringify(module)})
    const config = createElectronBuilderConfig()
    if (await config.beforeBuild() !== true) throw new Error('Production dependencies must still be collected')
  `], {
    encoding: 'utf8', timeout: 30_000,
    env: {
      ...process.env, LWB_DESKTOP_UNSIGNED: '1', LWB_DESKTOP_PORTABLE: '1',
      LWB_DESKTOP_UNSIGNED_HOOK: 'always',
      LWB_DESKTOP_UNSIGNED_DSH_ROOT: DSH_ROOT, DSH_DESKTOP_UNSIGNED: '1',
      DSH_DESKTOP_APP_ID: 'com.scitiger.laofu.workbench',
      DSH_DESKTOP_TARGET_PLATFORM: 'win32', DSH_DESKTOP_TARGET_ARCH: 'x64',
      NODE_OPTIONS: `--import=${new URL('./unsigned-register.mjs', import.meta.url).href}`,
    },
  })
  assert.equal(result.status, 0, result.stderr)
})

test('the loader still applies while the preparation runs under the TypeScript hooks', () => {
  // The unsigned preparation is `pnpm exec tsx`, and tsx brings loader hooks of
  // its own. The hook has to survive that, and it has to stay asynchronous while
  // doing it: a synchronous hook validates the CommonJS passthrough tsx answers
  // with and fails the step outright.
  const appRoot = join(DSH_ROOT, 'apps/desktop')
  const target = pathToFileURL(join(appRoot, 'scripts/package-target.ts')).href
  const { command, args } = desktopPnpmInvocation(appRoot, ['exec', 'tsx', '-e',
    `import(${JSON.stringify(target)}).then(module => console.log(Object.keys(module).length))`])
  const result = spawnSync(command, args, {
    cwd: appRoot, encoding: 'utf8', timeout: 120_000,
    env: {
      ...process.env, LWB_DESKTOP_UNSIGNED: '1', LWB_DESKTOP_UNSIGNED_HOOK: 'always',
      LWB_DESKTOP_UNSIGNED_DSH_ROOT: DSH_ROOT,
      NODE_OPTIONS: `--import=${new URL('./unsigned-register.mjs', import.meta.url).href}`,
    },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.ok(Number(result.stdout.trim()) > 0, result.stdout)
})

test('the hook registers only in the processes that load the adapted files', () => {
  // Registering it in the build itself breaks every CommonJS module it compiles:
  // the build's own loader hook is synchronous, and Node rejects the null-source
  // CommonJS passthrough once a second hook is chained after it.
  const env = { LWB_DESKTOP_UNSIGNED: '1' }
  assert.equal(registers(['node', 'tsx', 'scripts/prepare-dsh.ts'], env), true)
  assert.equal(registers(['node', 'pnpm.mjs', 'exec', 'electron-builder', '--config', 'x.mjs'], env), true)
  assert.equal(registers(['node', 'tsdown', '--config-loader', 'native'], env), false)
  assert.equal(registers(['node', 'tsc', '-b'], env), false)
  assert.equal(registers(['node', 'tsx', 'scripts/prepare-dsh.ts'], { LWB_DESKTOP_UNSIGNED: '0' }), false)
  assert.equal(registers(['node', 'tsx', 'scripts/prepare-dsh.ts'], { ...env, LWB_DESKTOP_UNSIGNED_HOOK: 'always' }), true)
})

test('the loader preserves native errors for pnpm optional config discovery', () => {
  const appRoot = join(DSH_ROOT, 'apps/desktop')
  const { command, args } = desktopPnpmInvocation(appRoot, ['exec', process.execPath, '-p', 'process.versions.node'])
  const result = spawnSync(command, args, {
    cwd: appRoot, encoding: 'utf8', timeout: 30_000,
    env: {
      ...process.env, LWB_DESKTOP_UNSIGNED: '1', LWB_DESKTOP_UNSIGNED_DSH_ROOT: DSH_ROOT,
      LWB_DESKTOP_UNSIGNED_HOOK: 'always',
      NODE_OPTIONS: `--import=${new URL('./unsigned-register.mjs', import.meta.url).href}`,
    },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), process.versions.node)
})
