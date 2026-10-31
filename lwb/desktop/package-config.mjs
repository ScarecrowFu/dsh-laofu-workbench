import { join } from 'node:path'
import { cp, mkdir } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DSH_ROOT } from '../upstream.mjs'
import { verifyPackagedPacks } from './pack-smoke.mjs'

/**
 * Extend the official builder configuration without modifying its source.
 *
 * The identity is the resolved build input. The official build uses the
 * complete capability set while keeping one product name, data root and URL
 * scheme for every user.
 */
export async function createLwbPackageConfig(payload, identity) {
  if (!identity?.productName || !identity?.artifactName || !identity?.protocolScheme) {
    throw new Error('createLwbPackageConfig needs a resolved edition identity.')
  }
  const { createElectronBuilderConfig } = await import(pathToFileURL(join(DSH_ROOT, 'apps/desktop/scripts/electron-builder-config.mjs')))
  if (identity.unsigned && process.env.LWB_DESKTOP_UNSIGNED !== '1') throw new Error('Unsigned package config requires the test-build loader')
  const config = createElectronBuilderConfig()
  if (identity.unsigned) {
    config.directories.output = identity.output
    config.extraMetadata.version = identity.version
  }
  config.productName = identity.productName
  config.artifactName = identity.artifactName
  config.protocols = [{ name: identity.productName, schemes: [identity.protocolScheme] }]
  if (identity.portable) applyLwbDistributionTargets(config)
  config.extraMetadata = { ...config.extraMetadata, main: 'lwb-bootstrap.mjs' }
  const entry = join(payload, '..', 'desktop-entry')
  await mkdir(entry, { recursive: true })
  await cp(fileURLToPath(new URL('./bootstrap.mjs', import.meta.url)), join(entry, 'lwb-bootstrap.mjs'))
  await cp(fileURLToPath(new URL('./entry-policy.mjs', import.meta.url)), join(entry, 'lwb-entry-policy.mjs'))
  await cp(fileURLToPath(new URL('./registry-migration.mjs', import.meta.url)), join(entry, 'registry-migration.mjs'))
  config.files.push({ from: entry, to: '.', filter: ['lwb-bootstrap.mjs', 'lwb-entry-policy.mjs', 'registry-migration.mjs'] })
  applyLwbProductResources(config, payload)
  const afterPack = config.afterPack
  config.afterPack = async context => {
    await afterPack?.(context)
    const filename = context.packager.appInfo.productFilename
    const executable = context.electronPlatformName === 'darwin'
      ? join(context.appOutDir, `${filename}.app`, 'Contents', 'MacOS', filename)
      : join(context.appOutDir, `${filename}.exe`)
    await verifyPackagedPacks({
      executable,
      resources: context.packager.getResourcesDir(context.appOutDir),
      // Acceptance budgets widen when the package architecture differs from the
      // host: a first launch of a fresh x64 bundle on Apple Silicon runs through
      // Rosetta and can take far longer than a native start.
      ...(identity.targetPlatform === undefined || identity.targetArch === undefined
        ? {}
        : { target: { platform: identity.targetPlatform, arch: identity.targetArch } }),
    })
  }
  return config
}

export function applyLwbProductResources(config, payload) {
  const resources = fileURLToPath(new URL('./resources/', import.meta.url))
  const logo = fileURLToPath(new URL('../dsh-bundle/assets/laofu-workbench-logo.png', import.meta.url))
  config.mac = { ...config.mac, icon: join(resources, 'icon-macos.icns') }
  config.win = { ...config.win, icon: join(resources, 'icon-windows.ico') }
  // Replace the upstream runtime icons as well as the executable/bundle icon.
  config.extraResources = config.extraResources.map(resource => {
    if (resource.to === 'icon.png') return { ...resource, from: logo }
    if (resource.to === 'tray.ico') return { ...resource, from: join(resources, 'tray-windows.ico') }
    return resource
  })
  config.extraResources.push(
    { from: payload, to: 'lwb-product', filter: ['**/*'] },
    // electron-builder excludes a FileSet source's root node_modules.
    { from: join(payload, 'node_modules'), to: 'lwb-product/node_modules', filter: ['**/*'] },
  )
  return config
}

/**
 * Distributable shapes for a package the user installs by copying it.
 *
 * macOS ships the `.app` in a zip and is replaced in place, so it needs nothing
 * beyond that. Windows produces an unpacked directory instead of an artifact:
 * the launch package (`launch-package.mjs`) is assembled from it around a
 * launcher that unpacks once into a reusable directory. The `portable` target
 * this replaces was a self-extracting shell that re-created the whole tree on
 * every double-click, which is exactly the delay the launcher removes.
 * @param config - electron-builder configuration to adjust in place.
 * @returns the same configuration.
 */
export function applyLwbDistributionTargets(config) {
  config.mac = { ...config.mac, target: ['zip'] }
  config.win = { ...config.win, target: ['dir'] }
  return config
}
