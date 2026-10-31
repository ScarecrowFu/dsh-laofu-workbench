import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

const remoteInitializers = []

function decorateRemote(prototype, method, exportName) {
  const decorate = Remote(exportName)
  decorate(prototype[method], {
    kind: 'method',
    name: method,
    static: false,
    private: false,
    addInitializer(initializer) { remoteInitializers.push(initializer) },
  })
}

/**
 * Browser-safe projection of the Desktop update lifecycle.
 *
 * The release channel, the installation id, the ATS base URL and the staged
 * artifact never cross this boundary: the sidebar needs to know which version
 * is offered and what the user can do, and nothing else. `check` returns the
 * state it just moved into rather than the state it eventually reaches, because
 * a first update is a 400 MB download and no RPC should stay open across it —
 * the caller polls `state` while the Host works.
 */
export class LwbUpdateGateway extends TypertRemoteService {
  static inject = ['lwbUpdateManager']

  constructor(ctx) {
    super(ctx, 'lwbUpdate')
    for (const initializer of remoteInitializers) initializer.call(this)
  }

  async state() {
    await this.ctx.lwbUpdateManager.ready()
    return this.ctx.lwbUpdateManager.snapshot()
  }

  async check() {
    const manager = this.ctx.lwbUpdateManager
    await manager.ready()
    void manager.check({ force: true }).catch(() => {})
    return manager.snapshot()
  }

  async install() {
    const manager = this.ctx.lwbUpdateManager
    await manager.ready()
    return manager.install()
  }

  async ignore() {
    const manager = this.ctx.lwbUpdateManager
    await manager.ready()
    return manager.ignore()
  }

  async dismiss() {
    const manager = this.ctx.lwbUpdateManager
    await manager.ready()
    return manager.dismiss()
  }
}

for (const method of ['state', 'check', 'install', 'ignore', 'dismiss']) {
  decorateRemote(LwbUpdateGateway.prototype, method, method)
}

export default LwbUpdateGateway
