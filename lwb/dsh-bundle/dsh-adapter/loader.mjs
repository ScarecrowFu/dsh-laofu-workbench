/** The one supported DSH Loader contract. No version fallbacks. */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { LWB_RUNTIME } from '../runtime-config.mjs'
import { dshPackageDirectory } from './package-paths.mjs'

const FIBER_ACTIVE = 2

export function restoreEnabledPacks(ctx, packRuntime) {
  let started = false
  ctx.on('internal/status', (fiber) => {
    if (started || fiber !== ctx.fiber || fiber.state !== FIBER_ACTIVE) return
    started = true
    // Cordis treats callback results as disposal effects, not task results.
    const restore = ctx.inject(['subagents', 'tools'], async () => { await packRuntime.restore() })
    packRuntime.setStartupRestore(restore.await())
  }, { global: true })
  // From here on an empty catalog means "not finished yet", not "nothing
  // installed" — the browser needs that distinction to render anything useful.
  packRuntime.arm?.()
}

/**
 * How long the pack group may take to activate before the bundle stops waiting.
 *
 * The group is only a container for pack entries; the RPC gateways above it are
 * what the browser actually talks to. A composition where the group waits on a
 * service that never arrives must still answer `lwbPacks/list` and
 * `lwbAccount/status` — those requests stay open forever otherwise, and the
 * workbench shows an empty capability page with no error anywhere.
 */
const GROUP_ACTIVATION_TIMEOUT_MS = 8_000

export async function createPackGroup(ctx, { timeoutMs = GROUP_ACTIVATION_TIMEOUT_MS } = {}) {
  const Group = ctx.loader?.builtins?.group
  if (typeof Group !== 'function') {
    throw new Error('LWB capability pack loader group is unavailable.')
  }
  const fiber = ctx.plugin(Group, [])
  let timer
  const activated = await Promise.race([
    fiber.await().then(() => true),
    // Not unref'd: this race is awaited, so the timeout has to be able to fire
    // even when the group's activation is the only thing left pending.
    new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs) }),
  ]).finally(() => { clearTimeout(timer) })
  const group = ctx.fiber.entry?.subgroup
  if (!activated || !group || typeof group.create !== 'function') {
    // Loading through the root loader keeps packs working in the cases where the
    // group is merely late; a group that is genuinely unavailable is reported
    // through the pack failures instead of holding up the whole bundle.
    ctx.logger?.warn?.(`lwb: pack group did not activate within ${timeoutMs} ms; packs load through the root loader instead.`)
    return undefined
  }
  return group
}

function stringList(value, field, packageName) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`能力包 ${JSON.stringify(packageName)} 的浏览器模块图 ${field} 无效。`)
  }
  return [...value]
}

/**
 * Project the host-owned, revisioned browser artifact for one mounted pack.
 * The URL comes from DSH's client-module registry, never from a pack manifest.
 */
export function projectClientBundle(graph, packageName) {
  const entries = graph?.entries
  if (!Array.isArray(entries)) throw new Error('DSH 浏览器模块图尚未就绪。')
  const row = entries.find((candidate) => candidate?.id === packageName)
  if (!row) return undefined
  if (typeof row.url !== 'string' || !row.url.startsWith('plugins/')) {
    throw new Error(`能力包 ${JSON.stringify(packageName)} 缺少受控浏览器 bundle。`)
  }
  if (typeof row.rev !== 'string' || !row.rev) {
    throw new Error(`能力包 ${JSON.stringify(packageName)} 的浏览器 bundle 版本无效。`)
  }
  return Object.freeze({
    id: packageName,
    url: row.url,
    rev: row.rev,
    inject: stringList(row.inject, 'inject', packageName),
    external: stringList(row.external, 'external', packageName),
  })
}

export class DshPackDriver {
  constructor(ctx, group) { this.ctx = ctx; this.group = group }

  async refreshResolution() {
    const { createRuntimeResolution, loadProfileDirectory } = await import(pathToFileURL(join(dshPackageDirectory('@deepseek-ai/dsh-app-boot'), 'lib', 'index.js')))
    const installAnchor = join(dshPackageDirectory('@deepseek-ai/dsh'), 'package.json')
    const profile = loadProfileDirectory('dsh', LWB_RUNTIME.profileHome, installAnchor)
    // New profile links must enter the host's routing table before imports.
    this.ctx.pluginPackages.replace(await createRuntimeResolution({ installAnchor, profile, home: LWB_RUNTIME.dshHome }))
  }

  async importPackage(packageName) {
    // Entry.init logs import errors and returns without a fiber. Import through
    // the same tree first so the caller receives the original dependency error.
    await (this.group?.tree ?? this.ctx.loader).import(packageName)
  }

  entriesFor(packageName) {
    const entries = this.group
      ? [...this.group.tree.entries()].filter((entry) => entry.parent === this.group)
      : [...this.ctx.loader.entries()]
    return entries.filter((entry) => entry.options.name === packageName)
  }

  async clientBundle(packageName) {
    // clientModules reconciles Loader entry changes in a microtask. Loader.await()
    // has settled the pack fiber by this point, so a short bounded yield is enough
    // to observe its immutable, revisioned browser artifact.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const bundle = projectClientBundle(this.ctx.clientModules?.graph?.(), packageName)
      if (bundle) return bundle
      await Promise.resolve()
    }
    throw new Error(`能力包 ${JSON.stringify(packageName)} 未能加入 DSH 浏览器模块图。`)
  }

  async awaitEntries(ids) {
    for (const id of ids) {
      const fiber = this.ctx.loader.resolve(id).fiber
      if (!fiber) throw new Error(`能力包加载条目 ${JSON.stringify(id)} 未能创建运行实例。`)
      await fiber.await()
    }
  }

  async createEntry(options) {
    if (this.group) {
      // EntryGroup.create starts a fiber but does not add its config to data.
      // Keep the group roster so unload and parent disposal own these entries.
      this.group.data.push(options)
      return this.group.create(options)
    }
    return this.ctx.loader.create(options)
  }

  async removeEntry(entry) {
    if (this.group && entry.parent === this.group) {
      this.group.remove(entry.options.id)
    } else {
      await this.ctx.loader.remove(entry.id)
    }
    // Group.remove starts disposal synchronously but does not await effects.
    // Wait before reporting success or registering replacement services.
    while (entry.fiber?.inertia) await entry.fiber.inertia
  }

}
