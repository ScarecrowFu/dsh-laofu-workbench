import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const MATCH_ID = /^[a-f0-9-]{36}$/u
export const ACTIVE = new Set(['running', 'pausing'])
export async function atomicJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

export class ArenaStore {
  constructor(workspacePath) { this.root = join(workspacePath, 'data', 'matches'); this.tail = Promise.resolve() }
  directory(id) { if (!MATCH_ID.test(id)) throw new Error('比赛标识无效。'); return join(this.root, id) }
  async serial(operation) {
    const next = this.tail.then(operation)
    this.tail = next.catch(() => {})
    return next
  }
  async init() {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    for (const match of await this.list(true)) {
      if (ACTIVE.has(match.status)) await this.update(match.id, value => {
        value.status = 'paused'; value.activeTurn = null
        value.events.push({ type: 'interrupted', at: new Date().toISOString(), message: '工作台停止时比赛尚未完成，待人工继续。' })
      })
      if (match.export?.status === 'running') await this.update(match.id, value => { value.export = { ...value.export, status: 'failed', error: '视频导出被工作台重启中断。' } })
    }
    return this
  }
  async get(id) { return JSON.parse(await readFile(join(this.directory(id), 'match.json'), 'utf8')) }
  async list(full = false) {
    const entries = await readdir(this.root, { withFileTypes: true })
    const matches = await Promise.all(entries.filter(entry => entry.isDirectory() && MATCH_ID.test(entry.name)).map(entry => this.get(entry.name)))
    return matches.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(match => full ? match : {
      id: match.id, title: match.title, game: match.game, players: match.players, status: match.status, result: match.result,
      createdAt: match.createdAt, updatedAt: match.updatedAt, moves: match.state.moves.length, calls: match.calls, export: match.export,
      /* 列表不带上落子序列，但象棋的「距判和还有几手」要在这里就看得出来：
         一局停滞几小时的棋不能只在点进去之后才不像卡死。计数器是规则层写的原值。 */
      halfmoveClock: Number.isInteger(match.state?.halfmoveClock) ? match.state.halfmoveClock : null,
    })
  }
  async create(input) {
    return this.serial(async () => {
      const id = randomUUID(), now = new Date().toISOString()
      const match = { ...structuredClone(input), schemaVersion: 1, id, status: 'running', createdAt: now, updatedAt: now, revision: 1, activeTurn: null, pending: null, result: null, calls: 0, tokens: 0, usageUnknown: false, events: [], export: null }
      await mkdir(this.directory(id), { mode: 0o700 })
      await atomicJson(join(this.directory(id), 'match.json'), match)
      return match
    })
  }
  async update(id, operation) {
    return this.serial(async () => {
      const match = await this.get(id)
      await operation(match)
      match.updatedAt = new Date().toISOString(); match.revision += 1
      await atomicJson(join(this.directory(id), 'match.json'), match)
      return match
    })
  }
}
