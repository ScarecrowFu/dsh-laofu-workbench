import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { ArenaGames } from '../games.mjs'
import { GAME_CARDS, gameCard, gameCoverSvg, werewolfCoverSeats } from '../presentation.mjs'

const read = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8')

test('每款注册游戏都有摘要、标签和可渲染封面，未知游戏退化为首字海报', () => {
  const games = new ArenaGames().list()
  assert.deepEqual(games.map(game => game.id).sort(), ['gomoku', 'werewolf', 'xiangqi'])
  for (const game of games) {
    const card = gameCard(game)
    assert.ok(GAME_CARDS[game.id], `${game.id} 应在 GAME_CARDS 登记卡片口径`)
    assert.ok(card.tagline, `${game.id} 需要一句摘要`)
    assert.ok(card.facts.length > 0, `${game.id} 至少需要一个事实标签`)
    assert.ok(gameCoverSvg(game) || card.poster, `${game.id} 的封面不能是空白`)
  }
  /* 新游戏没登记也不会出现空白方块：用名字首字兜底。 */
  const unknown = gameCard({ id: 'weiqi', name: '围棋', players: 2, version: '0.2.0', description: '19 路围棋' })
  assert.equal(unknown.cover, 'poster')
  assert.equal(unknown.poster, '围')
  assert.equal(unknown.tagline, '19 路围棋')
  assert.deepEqual(unknown.facts, ['2 位选手', '规则 0.2.0'])
  assert.equal(gameCoverSvg({ id: 'weiqi', name: '围棋' }), '')
})

test('棋盘封面画的是真局面：五子棋示例手顺、象棋开局 32 子', () => {
  const gomoku = gameCoverSvg({ id: 'gomoku', name: '五子棋' })
  assert.match(gomoku, /五子棋棋盘，7 手/u)
  /* 最后一手带高亮圈，示例手顺读起来是"黑 4 连、再一子即胜"。 */
  assert.match(gomoku, /stroke="#e45d3c"/u)
  assert.equal((gomoku.match(/ar-stone-black/gu) || []).length >= 4, true)
  const xiangqi = gameCoverSvg({ id: 'xiangqi', name: '中国象棋' })
  assert.match(xiangqi, /中国象棋棋盘，0 手/u)
  assert.equal((xiangqi.match(/r="20"/gu) || []).length, 32)
  assert.equal(gameCoverSvg({ id: 'werewolf', name: '狼人杀' }), '', '狼人杀的封面由客户端六席舞台拼装')
})

test('狼人杀封面六席是固定发牌，身份与立绘都可复现', () => {
  const seats = werewolfCoverSeats()
  assert.equal(seats.length, 6)
  assert.deepEqual(seats.map(seat => seat.role), ['werewolf', 'werewolf', 'seer', 'witch', 'hunter', 'villager'])
  assert.deepEqual(seats.map(seat => seat.mark), ['狼', '狼', '预', '巫', '猎', '民'])
  assert.deepEqual(seats.map(seat => seat.seat), [1, 2, 3, 4, 5, 6])
  assert.equal(new Set(seats.map(seat => seat.portrait)).size, 6, '六席不应共用同一张立绘')
  assert.deepEqual(seats.filter(seat => seat.active).map(seat => seat.seat), [1])
  assert.deepEqual(werewolfCoverSeats(), seats, '同一份展示数据必须每次都一样')
})

test('封面媒体必须有自带尺寸的包裹层，且这层由客户端渲染出来', async () => {
  const css = await read('styles.mjs'), source = await read('client-source.mjs')
  /* 回归防线：曾经把棋盘 SVG 多包了一层没有尺寸的 div，而样式写的是「直系子 svg」，
     于是棋盘塌成 0×0、封面只剩底色。凡是 > svg 的包裹层，都必须自己声明确定尺寸
     （height:100% / 具体高度 / aspect-ratio），不能靠子元素撑开。 */
  const wrappers = [...css.matchAll(/\.(ar-[\w-]+)\s*>\s*svg/gu)].map(match => match[1])
  assert.ok(wrappers.length > 0, '样式表里应当有承载 SVG 的包裹层')
  for (const name of new Set(wrappers)) {
    assert.match(css, new RegExp(`\\.${name}\\s*\\{[^}]*(?:height:\\s*(?:100%|\\d)|aspect-ratio:)`, 'u'), `.${name} 是 SVG 的包裹层，必须自带确定高度`)
    assert.match(source, new RegExp(`'${name}'`, 'u'), `.${name} 必须由客户端渲染出来`)
  }
})

test('游戏库卡片不再直连封面媒体，也不再出现旧的预览类名', async () => {
  const css = await read('styles.mjs'), source = await read('client-source.mjs')
  assert.match(css, /\.ar-game-cover\{position:relative;aspect-ratio:16\/10/u)
  assert.doesNotMatch(css, /\.ar-game-cover\s*>\s*(?:svg|img)/u, '封面媒体不能挂在无尺寸的直系子层上')
  assert.doesNotMatch(`${css}${source}`, /ar-game-preview/u, '旧的 .ar-game-preview 应当已被 .ar-game-cover 取代')
  assert.doesNotMatch(css, /\.ar-game\{[^}]*max-width:460px/u, '卡片不应再被 460px 上限截断网格')
  assert.match(css, /\.ar-game-grid\{display:grid;grid-template-columns:repeat\(auto-fit/u, 'auto-fit 才能让空轨道收回')
  assert.match(css, /\.ar-game-footer\{margin-top:auto/u, '页脚吸底才能让三张卡 CTA 对齐')
  assert.match(source, /gameCoverSvg\(game\)/u)
  assert.match(source, /gameCard\(game\)/u)
})

test('客户端用到的每个 presentation 导出都必须真的被 import', async () => {
  const source = await read('client-source.mjs'), presentation = await read('presentation.mjs')
  /* 客户端是 bundle 出来的浏览器代码，node --check 不会发现漏掉的 import，
     少了名字只会在打开那一页时才炸。这里按"导出 × 引用"对一遍。 */
  const exports = new Set([...presentation.matchAll(/export (?:const|function) (\w+)/gu)].map(match => match[1]))
  const imports = [...source.matchAll(/import \{([^}]+)\} from '\.\/presentation\.mjs'/gu)]
    .flatMap(match => match[1].split(',').map(name => name.trim()))
  const body = source.replace(/^import .*$/gmu, '').replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(?:^|\s)\/\/[^\n]*/gu, '')
  const referenced = [...exports].filter(name => new RegExp(`\\b${name}\\b`, 'u').test(body))
  assert.deepEqual(referenced.filter(name => !imports.includes(name)), [], '客户端引用了未 import 的 presentation 导出')
})