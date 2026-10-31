import { LWB_RUNTIME, readLwbBuild, readProductVersion } from './runtime-config.mjs'
import { createPackGroup, restoreEnabledPacks } from './dsh-adapter/loader.mjs'

const PROFILE_ID = LWB_RUNTIME.profileId

// The pack runtime projects Loader-managed browser bundles through DSH's
// client-module graph. Declare both host services at the bundle boundary.
export const inject = ['loader', 'pluginPackages', 'clientModules', 'agents', 'agentPresets', 'permissionPresets', 'credentials', 'agentDefaultModel', 'webServer', 'llm', 'sessionController']

import { LwbPackWorkspaces } from './pack-workspaces.mjs'
import { LwbPackServices } from './pack-services.mjs'
import { LwbPackEntitlements } from './pack-entitlements.mjs'

import LwbArchiveGateway from './archive-gateway.mjs'
import LwbPackGateway from './pack-gateway.mjs'
import { LwbPackRegistry } from './pack-registry.mjs'
import { LwbPackRuntime } from './pack-runtime.mjs'
import { DEFAULT_BASE_URL, LwbAtsClient } from './ats-client.mjs'
import LwbAccountGateway from './account-gateway.mjs'
import LwbUpdateGateway from './updater-gateway.mjs'
import { LwbUpdateManager } from './updater/manager.mjs'
import { openTaskModel } from './task-model.mjs'
import { registerLwbModels } from './dsh-adapter/lwb-model.mjs'
import { registerLwbBranding } from './branding.mjs'
import { registerLwbParkedTab } from './parked-tab.mjs'
import { registerLwbWebRouter } from './web-router.mjs'

/**
 * Host-side product identity for the LWB DSH composition.
 *
 * This intentionally contributes a small service first. Product features will
 * be added as separate host/client bundles instead of growing a parallel HTTP
 * application beside the Harness tree.
 */
export async function apply(ctx, config = {}) {
  // The browser roster needs the same package name as the host bundle. Its
  // dedicated loader row is host-side only to expose ./client, so do not
  // register the identity service a second time for that row.
  if (config.clientOnly) return
  // Start-up stages are logged with elapsed time: a workbench that answers the
  // page but never lists a pack has to say where it stopped, and "nothing in the
  // console" is what made the last report impossible to act on.
  const startedAt = Date.now()
  const stage = (message) => ctx.logger?.info?.(`lwb: ${message} (${Date.now() - startedAt} ms)`)
  stage('bundle activated')
  await registerLwbBranding(ctx)
  registerLwbParkedTab(ctx)
  const identity = Object.freeze({
    id: PROFILE_ID,
    name: String(config.name || '老傅工作台'),
    // The build record, then `package.json`. A configured version stays only as
    // a last resort — it is the one place nobody bumps at release time, so
    // trusting it would show every installation a version that never shipped.
    version: String(readProductVersion() || config.version || '0.1.0'),
    architecture: 'dsh-profile',
  })
  ctx.provide('lwbProfile', identity)
  ctx.provide('lwbPackRegistry', new LwbPackRegistry())
  const workspaces = new LwbPackWorkspaces({ root: LWB_RUNTIME.packStateDir })
  ctx.provide('lwbPackWorkspaces', workspaces)
  const account = new LwbAtsClient({ credentials: ctx.credentials, baseUrl: LWB_RUNTIME.atsBaseUrl })
  const entitlements = new LwbPackEntitlements(account)
  const taskModel = await openTaskModel(LWB_RUNTIME.productHome, ctx)
  ctx.provide('lwbAtsClient', account)
  ctx.provide('lwbPackEntitlements', entitlements)
  ctx.provide('lwbTaskModel', taskModel)
  ctx.provide('lwbPackServices', new LwbPackServices(ctx, workspaces, { account, taskModel, entitlements }))
  // Product updates. The build record decides whether this installation may
  // update at all: a checkout has no `build.json`, and a local test build is not
  // the published product, so neither is ever offered a release.
  const build = readLwbBuild()
  const updateManager = new LwbUpdateManager({
    updatesRoot: LWB_RUNTIME.updateStateDir,
    build,
    currentVersion: String(build?.version || identity.version),
    baseUrl: LWB_RUNTIME.atsBaseUrl || DEFAULT_BASE_URL,
    platform: process.platform,
    arch: process.arch,
  })
  ctx.provide('lwbUpdateManager', updateManager)
  // Answer the account and update RPCs even if the pack half of the bundle is
  // late. Both gateways depend only on services provided above, so registering
  // them before the pack group means a slow loader shows up as "packs are still
  // starting" instead of two open requests and a blank capability page.
  ctx.plugin(LwbAccountGateway)
  ctx.plugin(LwbUpdateGateway)
  stage('account and update gateways registered')
  registerLwbModels(ctx, account)
  // Web search / fetch routing. Registered in a scoped inject so a profile
  // without the `web` seam still applies the rest of this bundle, and so the
  // router reads the live `agents` / `lwbAtsClient` services at call time.
  ctx.inject(['web'], (webScope) => {
    registerLwbWebRouter(webScope)
  })
  const packGroup = await createPackGroup(ctx)
  stage(packGroup === undefined ? 'pack group unavailable; using the root loader' : 'pack group ready')
  const packRuntime = new LwbPackRuntime(ctx, { group: packGroup })
  ctx.provide('lwbPackRuntime', packRuntime)
  ctx.plugin(LwbArchiveGateway)
  ctx.plugin(LwbPackGateway)
  stage('pack gateways registered')
  // Look for a release once the workbench is up, then rarely: an update is
  // never urgent enough to compete with start-up, and a user who leaves the
  // workbench open for a week still learns about one within a day.
  ctx.effect(() => {
    if (!updateManager.enabled) return undefined
    const first = setTimeout(() => { void updateManager.check().catch(() => {}) }, 20_000)
    const periodic = setInterval(() => { void updateManager.check().catch(() => {}) }, 6 * 60 * 60 * 1000)
    first.unref?.()
    periodic.unref?.()
    return () => { clearTimeout(first); clearInterval(periodic) }
  }, 'lwb-update: background release check')
  // The bundle's own services are only injectable once this fiber is active.
  // Start restoration on that transition, after the baseline pack dependencies
  // are available, and let the gateway await the resulting task.
  restoreEnabledPacks(ctx, packRuntime)
  stage('pack restoration scheduled')
}
