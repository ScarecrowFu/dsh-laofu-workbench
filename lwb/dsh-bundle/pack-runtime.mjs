import {
  loadMarketplaceLwbPack,
  marketplaceLwbPacks,
  unloadLwbPack,
} from './pack-manager.mjs'
import { linkLwbPackForRuntime } from './pack-runtime-links.mjs'
import { DshPackDriver } from './dsh-adapter/loader.mjs'

function requestId(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('能力包操作请求无效。')
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  if (!/^[a-z][a-z0-9-]{1,62}$/u.test(id)) throw new Error('能力包标识无效。')
  return id
}

function clientOnly(entry) {
  return entry.options.config?.clientOnly === true
}

/**
 * Settle `promise` within `ms`, or fail with a sentence a person can act on.
 *
 * Pack mounting runs inside the workbench's own start-up. An entry that waits
 * on a service that never arrives would otherwise hold the whole restoration
 * queue — and every `lwbPacks/list` waiting behind it — open forever.
 */
function withinTimeout(promise, ms, message) {
  if (!Number.isFinite(ms) || ms <= 0) return promise
  let timer
  const timeout = new Promise((_, reject) => {
    // Deliberately not unref'd: the caller is awaiting this race, so when the
    // operation is stuck the timeout is the only thing left to answer with.
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => { clearTimeout(timer) })
}

export { projectClientBundle } from './dsh-adapter/loader.mjs'

/**
 * Generic lifecycle manager for optional packages. It never imports a package
 * while cataloguing. Code is imported only by Cordis Loader from an
 * inspectable package source, either after an explicit user load or while
 * restoring a previously enabled package at startup.
 */
export class LwbPackRuntime {
  static inject = ['lwbPackRegistry', 'clientModules', 'lwbPackServices', 'lwbPackWorkspaces', 'lwbPackEntitlements']

  constructor(ctx, options = {}) {
    this.ctx = ctx
    this.driver = options.driver || new DshPackDriver(ctx, options.group)
    this.tail = Promise.resolve()
    this.restoreFailures = new Map()
    this.startupRestore = Promise.resolve()
    // The browser asks `lwbPacks/list` as soon as it boots. It has to be able to
    // tell "still restoring" from "nothing is installed" — an empty registry
    // means either one, and the page used to render both as "尚未加载".
    //
    // A runtime that exists has not finished restoring, so this starts `true`:
    // the web server answers before the bundle finishes applying, and a read in
    // that window used to report `armed:false`, which the page could only read
    // as "nothing installed" — permanently, because nothing re-read it.
    this.armed = true
    this.started = false
    this.restoring = false
    this.mountTimeoutMs = Number.isFinite(options.mountTimeoutMs) ? options.mountTimeoutMs : 20_000
  }

  /** Record that restoration is about to wait for its activation conditions. */
  arm() {
    this.armed = true
  }

  /** What the browser needs to explain an empty catalog. */
  status() {
    return {
      armed: this.armed,
      started: this.started,
      restoring: this.restoring,
      failed: [...this.restoreFailures].map(([id, message]) => ({ id, message })),
    }
  }

  serial(operation) {
    const result = this.tail.then(operation)
    this.tail = result.catch(() => {})
    return result
  }

  isMounted(id) {
    return this.ctx.lwbPackRegistry.list().some((pack) => pack.id === id)
  }

  entriesFor(packageName) { return this.driver.entriesFor(packageName) }

  clientBundle(packageName) { return this.driver.clientBundle(packageName) }

  async removeCreatedEntries(packageName, previous) {
    const created = this.entriesFor(packageName)
      .filter((entry) => !previous.has(entry.id))
      .sort((left, right) => Number(clientOnly(right)) - Number(clientOnly(left)))
    for (const entry of created) {
      try { await this.removeEntry(entry) } catch (_) {}
    }
  }

  awaitEntries(ids) { return this.driver.awaitEntries(ids) }

  async mount(pack) {
    const { id, packageName } = pack.manifest
    if (!pack.available) {
      throw new Error(`LWB pack ${JSON.stringify(id)} is unavailable: ${pack.error || 'source cannot be inspected'}`)
    }
    await this.ctx.lwbPackEntitlements?.assertAllowed(pack.manifest)
    if (this.isMounted(id)) {
      return {
        id,
        packageName,
        status: 'loaded',
        reloaded: false,
        client: await this.clientBundle(packageName),
      }
    }

    await linkLwbPackForRuntime(pack)
    await this.driver.refreshResolution()
    const before = new Set(this.entriesFor(packageName).map((entry) => entry.id))
    try {
      await this.driver.importPackage(packageName)
      await this.ctx.lwbPackServices?.mount(pack.manifest)
      const entries = [
        await this.createEntry({ name: packageName }),
        await this.createEntry({ name: packageName, config: { clientOnly: true } }),
      ]
      // Do not await the entire Loader here. Startup restoration runs while the
      // LWB root entry is still activating, so the global tree includes us.
      await this.awaitEntries(entries)
      if (!this.isMounted(id)) {
        throw new Error(`能力包 ${JSON.stringify(id)} 未能成功注册到 LWB 宿主。`)
      }
      return { id, packageName, status: 'loaded', reloaded: true, client: await this.clientBundle(packageName) }
    } catch (error) {
      await this.removeCreatedEntries(packageName, before)
      await this.ctx.lwbPackServices?.unmount(id)
      throw error
    }
  }

  createEntry(options) { return this.driver.createEntry(options) }

  removeEntry(entry) { return this.driver.removeEntry(entry) }

  setStartupRestore(task) {
    this.armed = true
    this.started = true
    this.restoring = true
    this.startupRestore = Promise.resolve(task).catch((error) => {
      this.ctx.logger.error(error)
      return { loaded: [], failed: [{ id: 'startup', error: error instanceof Error ? error.message : String(error) }] }
    }).finally(() => { this.restoring = false })
  }

  ready() {
    return this.startupRestore
  }

  /**
   * Wait for restoration, but never longer than `ms`.
   *
   * Read paths (`list`, `market`) use this: a caller that only needs today's
   * shape must not inherit a stuck start-up. The report is dropped on timeout —
   * `status()` already carries the failures.
   */
  async settle(ms = 2_000) {
    await withinTimeout(this.startupRestore, ms, '能力包正在恢复。').catch(() => {})
  }

  async restore() {
    return this.serial(async () => {
      let packs
      try {
        packs = await marketplaceLwbPacks()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // Recorded, not just returned: `status()` is what the page renders, and
        // a read that failed here is exactly the case where the catalog is empty
        // for a reason the user has to see.
        this.restoreFailures.set('marketplace', message)
        this.ctx.logger.error(error)
        return { loaded: [], failed: [{ id: 'marketplace', error: message }] }
      }

      const loaded = []
      const failed = []
      const enabled = packs.filter((candidate) => candidate.enabled === true)
      this.ctx.logger.info?.(`lwb: restoring ${enabled.length} enabled capability pack(s)`)
      const budget = this.mountTimeoutMs >= 1_000
        ? `${Math.round(this.mountTimeoutMs / 1_000)} 秒`
        : `${Math.round(this.mountTimeoutMs)} 毫秒`
      for (const pack of enabled) {
        const id = pack.manifest.id
        const startedAt = Date.now()
        try {
          // The timeout reports the stall; it does not cancel the mount, which
          // may still finish later and register the pack on its own.
          loaded.push(await withinTimeout(
            this.mount(pack),
            this.mountTimeoutMs,
            `能力包 ${JSON.stringify(id)} 在 ${budget}内没有完成加载。`,
          ))
          this.restoreFailures.delete(id)
          this.ctx.logger.info?.(`lwb: restored ${JSON.stringify(id)} in ${Date.now() - startedAt} ms`)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          this.restoreFailures.set(id, message)
          this.ctx.logger.error(`LWB capability pack ${JSON.stringify(id)} was not restored: ${message}`)
          failed.push({ id, error: message })
        }
      }
      this.ctx.logger.info?.(`lwb: capability pack restoration finished — ${loaded.length} loaded, ${failed.length} failed`)
      return { loaded, failed }
    })
  }

  async market() {
    const mounted = new Set(this.ctx.lwbPackRegistry.list().map((pack) => pack.id))
    const packs = await marketplaceLwbPacks()
    const projected = await Promise.all(packs.map(async (pack) => ({
      ...pack.manifest,
      status: mounted.has(pack.manifest.id) ? 'loaded' : pack.available ? 'available' : 'unavailable',
      origin: pack.origin,
      installedAt: pack.installedAt,
      enabled: pack.enabled,
      ...(await this.ctx.lwbPackEntitlements?.check(pack.manifest) || { allowed: true, required: false }),
      ...((pack.error || this.restoreFailures.get(pack.manifest.id)) ? { error: pack.error || this.restoreFailures.get(pack.manifest.id) } : {}),
    })))
    return {
      schemaVersion: 1,
      packs: projected,
    }
  }

  async load(request) {
    const id = requestId(request)
    return this.serial(async () => {
      if (this.isMounted(id)) {
        const pack = (await marketplaceLwbPacks()).find((item) => item.manifest.id === id)
        if (!pack) throw new Error(`未找到能力包 ${JSON.stringify(id)}。`)
        this.restoreFailures.delete(id)
        return {
          id,
          packageName: pack.manifest.packageName,
          status: 'loaded',
          reloaded: false,
          client: await this.clientBundle(pack.manifest.packageName),
        }
      }
      const pack = await loadMarketplaceLwbPack(id)
      try {
        const result = await this.mount(pack)
        this.restoreFailures.delete(id)
        return result
      } catch (error) {
        await unloadLwbPack(id).catch(() => {})
        throw error
      }
    })
  }

  async unload(request) {
    const id = requestId(request)
    return this.serial(async () => {
      const market = await marketplaceLwbPacks()
      const pack = market.find((item) => item.manifest.id === id)
      if (!pack) throw new Error(`未找到能力包 ${JSON.stringify(id)}。`)
      const entries = this.entriesFor(pack.manifest.packageName)
        .sort((left, right) => Number(clientOnly(right)) - Number(clientOnly(left)))
      await this.ctx.lwbPackServices?.unmount(id)
      for (const entry of entries) await this.removeEntry(entry)
      await unloadLwbPack(id)
      this.restoreFailures.delete(id)
      return { id, packageName: pack.manifest.packageName, status: 'available', reloaded: entries.length > 0 }
    })
  }

  async maintain(request, operation) {
    const id = requestId(request)
    if (request.confirm !== true) throw new Error('请明确确认本次能力包数据操作。')
    return this.serial(async () => {
      if (this.isMounted(id)) throw new Error('请先卸载能力包，等待任务停止后再执行数据操作。')
      return this.ctx.lwbPackWorkspaces[operation](id)
    })
  }
}
