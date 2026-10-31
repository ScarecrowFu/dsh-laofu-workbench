import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import { applyLwbDistributionTargets, applyLwbProductResources } from './package-config.mjs'
import { join } from 'node:path'

test('product resources explicitly include installed production dependencies', () => {
  const config = applyLwbProductResources({ extraResources: [] }, '/product')
  assert.ok(config.extraResources.some(resource => resource.from === join('/product', 'node_modules') && resource.to === 'lwb-product/node_modules' && resource.filter.includes('**/*')))
})

test('Desktop branding replaces upstream application and tray resources', async () => {
  const runtime = { from: '/upstream/runtime', to: 'runtime' }
  const config = applyLwbProductResources({
    extraResources: [runtime, { from: '/upstream/icon.png', to: 'icon.png' }, { from: '/upstream/tray.ico', to: 'tray.ico' }],
    mac: { icon: '/upstream/icon.png', target: ['zip'] },
    win: { icon: '/upstream/icon.png', target: ['dir'] },
  }, '/product')
  assert.deepEqual(config.mac.target, ['zip'])
  assert.deepEqual(config.win.target, ['dir'])
  assert.equal(config.extraResources[0], runtime)
  assert.ok(config.mac.icon.endsWith(join('lwb', 'desktop', 'resources', 'icon-macos.icns')))
  assert.ok(config.win.icon.endsWith(join('lwb', 'desktop', 'resources', 'icon-windows.ico')))
  for (const name of ['icon.png', 'tray.ico']) {
    const resources = config.extraResources.filter(resource => resource.to === name)
    assert.equal(resources.length, 1, 'one owner per runtime icon')
    assert.ok(!resources[0].from.startsWith('/upstream/'))
    await access(resources[0].from)
  }
  await access(config.mac.icon)
  await access(config.win.icon)
})

test('the packaged Desktop entry includes runtime registry migration', async () => {
  const source = await readFile(new URL('./package-config.mjs', import.meta.url), 'utf8')
  assert.match(source, /registry-migration\.mjs/u)
})

test('distributable targets emit a macOS app zip and an unpacked Windows directory', () => {
  const config = applyLwbDistributionTargets({
    mac: { target: ['dmg', 'zip'], hardenedRuntime: true },
    win: { target: ['nsis'], forceCodeSigning: false },
  })
  assert.deepEqual(config.mac, { target: ['zip'], hardenedRuntime: true })
  // Windows is built to a directory and wrapped by the launch package; asking
  // electron-builder for a `portable` artifact would bring back the per-launch
  // self-extraction this whole design removes.
  assert.deepEqual(config.win, { target: ['dir'], forceCodeSigning: false })
})
