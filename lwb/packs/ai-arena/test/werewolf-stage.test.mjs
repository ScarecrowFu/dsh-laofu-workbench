/**
 * 观战页席位舞台的几何契约：人数 → 列数 / 行数 → 席位条带高度。
 *
 * 这里守住的是 8 / 9 人局撑破画幅那次回归的成因，而不是某一个像素值：
 *  - 席卡高度不能再由宽度推（`aspect-ratio` + `width:100%`）。列数从 6 变 4 / 5、行数从 1 变 2 时，
 *    那样算出来的条带是 6 人局的 1.5 倍高、两行叠起来超过画幅，第一排会被 `overflow:hidden` 裁掉。
 *  - 席位条带高度必须按行数取（`--ar-cast-band` + `data-rows`），并且可被压缩：
 *    抬头、台词、胜负卡都是 `flex:none`，窄窗口下先让席卡变小，不会把文字挤出画幅。
 *  - 抬头 / 主持人 / 台词 / 胜负卡必须待在布局流里。原先它们各自绝对定位（top:20% / bottom:43.5%），
 *    那两个数值只对 6 人局成立，8 / 9 人时台词会压在人物脸上。
 * 观战页没有 DOM 测试，所以这里读的是真源码：presentation 出契约，styles / client-source 落实它。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { werewolfCastColumns, werewolfCastLayout, werewolfStage } from '../presentation.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CSS = await readFile(join(HERE, '..', 'styles.mjs'), 'utf8')
const CLIENT = await readFile(join(HERE, '..', 'client-source.mjs'), 'utf8')
/* 注释里会解释「从前为什么错」，所以否定断言只看声明，不看注释。 */
const strip = text => text.replace(/\/\*[\s\S]*?\*\//gu, '')
const CSS_ONLY = strip(CSS)
const CLIENT_ONLY = strip(CLIENT)

const rule = selector => {
  const found = CSS.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\{([^}]*)\\}`, 'u'))
  assert.ok(found, `CSS 里找不到规则：${selector}`)
  return found[1]
}
const bandOf = selector => {
  const band = rule(selector).match(/--ar-cast-band:([\d.]+)%/u)
  assert.ok(band, `${selector} 没有声明 --ar-cast-band`)
  return Number(band[1])
}

test('席位舞台的人数契约：6 / 8 / 9 人的列数与行数', () => {
  assert.deepEqual(werewolfCastLayout(6), { seats: 6, columns: 6, rows: 1 })
  assert.deepEqual(werewolfCastLayout(8), { seats: 8, columns: 4, rows: 2 })
  assert.deepEqual(werewolfCastLayout(9), { seats: 9, columns: 5, rows: 2 })
  /* 竖屏沿用离线回放 / 视频的 3 / 4 / 3 列口径，8 人是 4×2、9 人是 3×3。 */
  assert.deepEqual(werewolfCastLayout(8, 'portrait'), { seats: 8, columns: 4, rows: 2 })
  assert.deepEqual(werewolfCastLayout(9, 'portrait'), { seats: 9, columns: 3, rows: 3 })
  /* 列数口径不变：离线回放与视频按列数写 --ww-cols，观战页按列数写 --ar-cast-cols。 */
  for (const count of [6, 8, 9]) assert.equal(werewolfCastColumns(count), werewolfCastLayout(count).columns)
  /* 坏人数只可能来自调用方，不要让画幅里的行数变成 NaN 或 0。 */
  assert.deepEqual(werewolfCastLayout(0), { seats: 1, columns: 1, rows: 1 })
  assert.deepEqual(werewolfCastLayout(Number.NaN), { seats: 6, columns: 6, rows: 1 })
})

test('席位投影带出行数：观战页按它取条带高度，8 / 9 人是两行', () => {
  const state = seats => ({ phase: 'day-vote', players: Array.from({ length: seats }, (_, index) => ({ seat: index + 1, role: index === 0 ? 'werewolf' : 'villager', alive: true })) })
  assert.deepEqual([6, 8, 9].map(seats => [werewolfStage({ players: [], state: state(seats) }).columns, werewolfStage({ players: [], state: state(seats) }).rows]),
    [[6, 1], [4, 2], [5, 2]])
})

test('席位条带：高度按行数取，且可被压缩（窄窗口先让席卡变小）', () => {
  const cast = rule('.ar-stage-cast')
  assert.match(cast, /height:var\(--ar-cast-band\)/u, '条带高度必须读 --ar-cast-band，不能再由列宽推')
  assert.match(cast, /grid-template-rows:repeat\(var\(--ar-cast-rows/u, '行模板必须读 --ar-cast-rows')
  assert.match(cast, /flex:0 1 auto/u, '条带必须可收缩：否则窄窗口下被挤出画幅的是抬头或台词')
  assert.match(cast, /min-height:0/u, '可收缩的 flex 项必须放开最小高度')
  /* 每个可能出现的行数都要有自己的条带高度，缺一档就会退回 1 行的 40%（两行 → 卡片被压扁）。 */
  assert.equal(bandOf('.ar-stage'), 40, '默认（1 行）条带')
  assert.equal(bandOf('.ar-stage[data-rows="2"]'), 48, '两行条带')
  assert.equal(bandOf('.ar-stage[data-rows="3"]'), 52, '三行条带')
  for (const selector of ['.ar-stage', '.ar-stage[data-rows="2"]', '.ar-stage[data-rows="3"]']) {
    assert.ok(bandOf(selector) <= 55, `${selector} 的条带超过画幅一半，静场与台词会被挤掉`)
  }
})

test('席卡高度由行高决定，不再由列宽推（8 / 9 人撑破画幅的成因）', () => {
  const face = rule('.ar-cast-face')
  assert.doesNotMatch(face, /aspect-ratio/u, '席卡不能再自带 3:4：列宽一变，高度就跟着涨')
  assert.match(face, /flex:1 1 auto/u, '席卡要吃掉行高减去署名的那一段')
  assert.match(face, /min-height:0/u)
  assert.match(face, /width:100%/u, '宽度填满单元格，立绘按 2:3 居中留边')
  assert.match(rule('.ar-cast-face img'), /object-fit:contain/u, '立绘按原比例居中，不裁脸')
  assert.match(rule('.ar-cast'), /height:100%/u, '席卡要撑满行')
})

test('抬头 / 主持人 / 台词 / 胜负卡都在布局流里，不再用只对 6 人局成立的魔数', () => {
  for (const selector of ['.ar-stage-head', '.ar-stage-host', '.ar-stage .ar-stage-line', '.ar-stage-win']) {
    assert.match(rule(selector), /position:relative/u, `${selector} 必须参与布局流`)
  }
  assert.doesNotMatch(CSS_ONLY, /bottom:43\.5%/u, '台词条的位置不再写死 bottom:43.5%（那个数值只对 6 人局成立）')
  assert.doesNotMatch(rule('.ar-stage-host'), /position:absolute/u)
  /* 唯一可伸缩的一段是静场留白：把自由高度收在一处，条带与文字谁也不挤谁。 */
  assert.match(rule('.ar-stage-center'), /flex:1 1 auto/u)
  assert.match(rule('.ar-stage-center'), /min-height:0/u)
  /* 台词选择器必须压过页面基线的 .ar-page p{margin:0}（(0,1,1) > (0,1,0)）。 */
  assert.match(rule('.ar-stage .ar-stage-line'), /margin:0 5%/u)
  /* 主持人台词最多两行，条带的高度预算才不会被一句长播报吃掉。 */
  assert.match(rule('.ar-stage-host p'), /-webkit-line-clamp:2/u)
  assert.match(rule('.ar-stage-host p'), /overflow:hidden/u)
})

test('舞台是查询容器：字号与窄屏降级都按舞台宽度算，不跟窗口走', () => {
  assert.match(rule('.ar-stage'), /container-type:inline-size/u)
  assert.match(rule('.ar-stage-day'), /cqw/u, '抬头字号随舞台缩放')
  assert.match(rule('.ar-stage .ar-stage-line'), /cqw/u, '台词字号随舞台缩放')
  /* 窄舞台（两行席位每排只剩几十像素）让署名给立绘腾高度：height:0 保留文本，读屏仍读得到。 */
  const narrow = CSS.match(/@container \(max-width:600px\)\{[^}]*\}/u)
  assert.ok(narrow, '缺少窄舞台的席位署名降级规则')
  assert.match(narrow[0], /\.ar-cast figcaption\{height:0;overflow:hidden\}/u)
})

test('观战页把行数与列数写进自定义属性：CSS 不再写死 6 列', () => {
  assert.match(CLIENT_ONLY, /['"]data-rows['"]:\s*stage\.rows/u, '舞台要带 data-rows，条带高度按它取')
  assert.match(CLIENT_ONLY, /['"]--ar-cast-cols['"]:\s*String\(stage\.columns\)/u)
  assert.match(CLIENT_ONLY, /['"]--ar-cast-rows['"]:\s*String\(stage\.rows\)/u)
  assert.doesNotMatch(CLIENT_ONLY, /gridTemplateColumns/u, '列数不再以内联 grid-template-columns 覆盖，避免又出现「列数改了、高度没改」')
})

test('高度预算：设计画幅下条带 + 文字 + 留白仍留得出静场（8 / 9 人不再是满屏席卡）', () => {
  /* 1280×720 是离线回放与视频的画幅，也是观战页在宽窗口下的量级。
     文字段的高度取 CSS 里的对齐数值：抬头（日期胶囊 20 + 间距 4 + 阶段 27×1.1）、
     主持人（徽标 18 + 间距 4 + 两行台词 2×19 + 内边距 10）、台词（10 + 13×1.45）。 */
  const width = 1280, height = 720
  const pad = (2.8 + 1.9) / 100 * width
  const content = height - pad
  const head = 20 + 4 + Math.round(27 * 1.1)
  const host = 18 + 4 + 2 * 19 + 10
  const line = 10 + Math.round(13 * 1.45)
  const hostMargin = 0.04 * width
  const castMargin = 0.016 * width
  for (const rows of [1, 2]) {
    const selector = rows === 1 ? '.ar-stage' : `.ar-stage[data-rows="${rows}"]`
    const band = content * bandOf(selector) / 100
    const used = head + hostMargin + host + line + castMargin + band
    assert.ok(used < content, `${rows} 行的席位条带 + 文字（${Math.round(used)}px）必须小于可用高度（${Math.round(content)}px）`)
  }
})