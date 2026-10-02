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

test('the pinned builder disables release signing, policy and updater only in unsigned mode', async () => {
  const source = await readFile(join(DSH_ROOT, 'apps/desktop/scripts/electron-builder-config.mjs'), 'utf8')
  const adapted = adaptUnsignedBuilder(source)
  assert.match(adapted, /identity: unsigned \? '-' : macOSSigning/u)
  assert.match(adapted, /notarize: !unsigned/u)
  assert.match(adapted, /env\.DSH_DESKTOP_UNSIGNED === '1' \? undefined : resolveDesktopPolicyEnvironment/u)
  assert.match(adapted, /const update = unsigned \? undefined : resolveDesktopAutoUpdateConfig/u)
  assert.match(adapted, /resolvedPlatform === 'win32' && env\.LWB_DESKTOP_PORTABLE !== '1'/u)
  assert.throws(() => adaptUnsignedBuilder(source.replace('forceCodeSigning: true,', 'forceCodeSigning: false,')), /no longer matches/u)
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
      LWB_DESKTOP_UNSIGNED_DSH_ROOT: DSH_ROOT, DSH_DESKTOP_UNSIGNED: '1',
      DSH_DESKTOP_APP_ID: 'com.scitiger.laofu.workbench',
      DSH_DESKTOP_TARGET_PLATFORM: 'win32', DSH_DESKTOP_TARGET_ARCH: 'x64',
      NODE_OPTIONS: `--import=${new URL('./unsigned-register.mjs', import.meta.url).href}`,
    },
  })
  assert.equal(result.status, 0, result.stderr)
})

test('the loader preserves native errors for pnpm optional config discovery', () => {
  const appRoot = join(DSH_ROOT, 'apps/desktop')
  const { command, args } = desktopPnpmInvocation(appRoot, ['exec', process.execPath, '-p', 'process.versions.node'])
  const result = spawnSync(command, args, {
    cwd: appRoot, encoding: 'utf8', timeout: 30_000,
    env: {
      ...process.env, LWB_DESKTOP_UNSIGNED: '1', LWB_DESKTOP_UNSIGNED_DSH_ROOT: DSH_ROOT,
      NODE_OPTIONS: `--import=${new URL('./unsigned-register.mjs', import.meta.url).href}`,
    },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), process.versions.node)
})
