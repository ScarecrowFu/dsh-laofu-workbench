import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { replayHtml, reportMarkdown } from './export.mjs'

const initializers = []
export class ArenaGateway extends TypertRemoteService {
  static inject = ['arenaScope', 'arenaStore', 'arenaGames', 'arenaHost', 'arenaExport']
  constructor(ctx) { super(ctx, 'aiArena'); for (const initialize of initializers) initialize.call(this) }
  async within(operation) { await this.ctx.arenaScope.assertAccess(); return this.ctx.arenaScope.request(operation) }
  games() { return this.within(() => this.ctx.arenaGames.list()) }
  models() { return this.within(() => this.ctx.arenaScope.models.list()) }
  matches() { return this.within(() => this.ctx.arenaStore.list()) }
  match(request) { return this.within(() => this.ctx.arenaHost.get(request.id)) }
  start(request) { return this.within(() => this.ctx.arenaHost.start(request)) }
  control(request) { return this.within(() => this.ctx.arenaHost.control(request)) }
  exportVideo(request) { return this.within(() => this.ctx.arenaExport.start(request)) }
  exportReplay(request) { return this.within(() => this.ctx.arenaExport.startReplay(request)) }
  videoChunk(request) { return this.within(() => this.ctx.arenaExport.chunk(request)) }
  exportRecord(request) {
    return this.within(async () => {
      const match = await this.ctx.arenaStore.get(request.id)
      if (request.format === 'html') return { text: replayHtml(match), type: 'text/html', extension: 'html' }
      if (request.format === 'markdown') return { text: reportMarkdown(match), type: 'text/markdown', extension: 'md' }
      if (request.format === 'json') return { text: JSON.stringify(match, null, 2), type: 'application/json', extension: 'json' }
      throw new Error('导出格式无效。')
    })
  }
}
for (const name of ['games', 'models', 'matches', 'match', 'start', 'control', 'exportVideo', 'exportReplay', 'videoChunk', 'exportRecord']) Remote(name)(ArenaGateway.prototype[name], { kind: 'method', name, static: false, private: false, addInitializer(fn) { initializers.push(fn) } })
