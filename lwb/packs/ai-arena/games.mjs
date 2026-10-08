import { gomoku } from './gomoku.mjs'
import { xiangqi } from './xiangqi.mjs'
import { werewolf } from './werewolf.mjs'

export class ArenaGames {
  constructor(games = [gomoku, xiangqi, werewolf]) { this.games = new Map(); for (const game of games) this.register(game) }
  register(game) {
    if (!game?.id || this.games.has(game.id) || !['create', 'apply', 'observe'].every(key => typeof game[key] === 'function')) throw new Error('竞技游戏定义无效或重复。')
    this.games.set(game.id, game)
  }
  get(id) { const game = this.games.get(id); if (!game) throw new Error('竞技游戏不存在。'); return game }
  list() { return [...this.games.values()].map(({ id, name, version, description, players }) => ({ id, name, version, description, players })) }
}
