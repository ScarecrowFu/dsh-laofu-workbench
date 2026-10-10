import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'

/**
 * 客户端作用域哨兵。
 *
 * 回归防线：离线回放的成品体积曾经写成 `${part.bytes}`，而 part 是 videoChunk 下载
 * 循环里的 `const` —— 出了 while 体再引用它，只会抛 `ReferenceError: part is not
 * defined`。文件照样下载成功（saveBlob 在抛错点之前就执行了），所以真机上表现为
 * 「导出成功 + 页面红条」；`node --check` 不会报，esbuild 也不会报，反而会把循环里的
 * part 改名成 part2（它要保住那处自由引用，不让本地声明把它捕获），于是产物里连 part
 * 的声明都不剩 —— 只有真的跑到那一行才炸。
 *
 * 这里按作用域逐处核对：凡是在作用域链里找不到绑定的标识符，都必须列在 GLOBALS 里，
 * 否则视为拼错的局部变量。源码与产物各查一遍：产物才是上线的字节，而 esbuild 的改名
 * 会把「声明在块里、引用在块外」放大成彻底的未声明。
 */

const HERE = dirname(fileURLToPath(import.meta.url))

const FILES = ['client-source.mjs', 'client.js']

/* 浏览器与语言内置的全局。只有真正的全局才该加进来：拼错的局部变量名不允许靠加
   白名单糊过去 —— 加之前先问一句「这是谁声明的」。
   structuredClone 是规则引擎 werewolf.mjs 直接用的标准全局（每次 apply 先克隆局面），
   自 1.1.0 起观战页也要逐手重放，它因此进了客户端产物；Chromium 98+ / Electron 44 与
   Node 17+ 都自带，不是需要兜底的宿主 API。 */
const GLOBALS = new Set([
  'window', 'document', 'URL', 'Blob', 'atob', 'setTimeout', 'setInterval', 'clearInterval',
  'Promise', 'Map', 'Set', 'Uint8Array', 'undefined', 'Object', 'Array', 'String', 'Number',
  'Boolean', 'Error', 'Date', 'Math', 'JSON', 'structuredClone',
])

const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod', 'ClassPrivateMethod'])
const SCOPES = new Set(['Program', 'BlockStatement', 'StaticBlock', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'CatchClause', 'SwitchStatement'])

/** 绑定位置里的名字；默认值属于引用位置，由 walkDefaults 负责。 */
function bindingNames(pattern, names) {
  if (!pattern) return
  switch (pattern.type) {
    case 'Identifier': names.add(pattern.name); return
    case 'ObjectPattern': for (const property of pattern.properties) bindingNames(property.type === 'RestElement' ? property.argument : property.value, names); return
    case 'ArrayPattern': for (const element of pattern.elements) bindingNames(element, names); return
    case 'AssignmentPattern': bindingNames(pattern.left, names); return
    case 'RestElement': bindingNames(pattern.argument, names); return
    default: return
  }
}

/**
 * 找出所有没有绑定的标识符引用。
 *
 * 两趟走同一棵 AST：第一趟把声明灌进作用域树，第二趟才解析引用 —— 函数声明会被提升，
 * 一趟走会把「先引用后声明」误判成未声明（MatchView 就引用了写在它后面的 WerewolfStage）。
 * var 一律记在当前块里：这样只会漏报（var 其实提升出块），不会误报，而漏报方向不是这次
 * 要守的错。JSX 在本仓客户端里没有使用（统一走 h()），所以 JSXIdentifier 不参与解析。
 */
function unboundIdentifiers(source) {
  const ast = parse(source, { sourceType: 'unambiguous', plugins: ['jsx'] })
  const scopes = new Map()
  const findings = []

  const open = (node, parent) => {
    let scope = scopes.get(node)
    if (!scope) { scope = { names: new Set(), parent }; scopes.set(node, scope) }
    return scope
  }
  const resolve = (node, scope) => {
    for (let current = scope; current; current = current.parent) if (current.names.has(node.name)) return
    if (GLOBALS.has(node.name)) return
    findings.push({ name: node.name, line: node.loc?.start?.line || 0 })
  }
  const children = function* (node) {
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'start', 'end', 'range', 'extra', 'leadingComments', 'trailingComments', 'innerComments'].includes(key)) continue
      if (Array.isArray(value)) { for (const item of value) if (item && typeof item.type === 'string') yield item }
      else if (value && typeof value.type === 'string') yield value
    }
  }

  function walkDefaults(pattern, scope, phase) {
    if (!pattern) return
    switch (pattern.type) {
      case 'AssignmentPattern': walk(pattern.right, scope, phase); walkDefaults(pattern.left, scope, phase); return
      case 'ObjectPattern': for (const property of pattern.properties) {
        if (property.type !== 'ObjectProperty') { walkDefaults(property.argument, scope, phase); continue }
        if (property.computed) walk(property.key, scope, phase)
        walkDefaults(property.value, scope, phase)
      } return
      case 'ArrayPattern': for (const element of pattern.elements) walkDefaults(element, scope, phase); return
      case 'RestElement': walkDefaults(pattern.argument, scope, phase); return
      default: return
    }
  }

  function walk(node, scope, phase) {
    if (!node || typeof node.type !== 'string') return
    const type = node.type
    if (type === 'Identifier') { if (phase === 'check') resolve(node, scope); return }
    if (type === 'MetaProperty' || type === 'PrivateName' || type === 'ExportAllDeclaration') return
    if (type === 'ImportDeclaration') {
      if (phase === 'collect') for (const specifier of node.specifiers) bindingNames(specifier.local, scope.names)
      return
    }
    if (type === 'LabeledStatement') { walk(node.body, scope, phase); return }
    if (type === 'BreakStatement' || type === 'ContinueStatement') return
    if (type === 'MemberExpression' || type === 'OptionalMemberExpression') {
      walk(node.object, scope, phase)
      if (node.computed) walk(node.property, scope, phase)
      return
    }
    if (type === 'ObjectProperty') {
      if (node.computed) walk(node.key, scope, phase)
      walk(node.value, scope, phase)
      return
    }
    if (type === 'ClassProperty' || type === 'PropertyDefinition' || type === 'ClassAccessorProperty' || type === 'ClassPrivateProperty') {
      if (node.computed) walk(node.key, scope, phase)
      walk(node.value, scope, phase)
      return
    }
    if (type === 'ExportNamedDeclaration') {
      if (node.declaration) walk(node.declaration, scope, phase)
      else if (!node.source) for (const specifier of node.specifiers) walk(specifier.local, scope, phase)
      return
    }
    if (type === 'ExportDefaultDeclaration') { walk(node.declaration, scope, phase); return }
    if (type === 'VariableDeclaration') {
      for (const declarator of node.declarations) {
        if (phase === 'collect') bindingNames(declarator.id, scope.names)
        walkDefaults(declarator.id, scope, phase); walk(declarator.init, scope, phase)
      }
      return
    }
    if (type === 'ClassExpression') {
      const inner = open(node, scope)
      if (phase === 'collect') bindingNames(node.id, inner.names)
      walk(node.superClass, scope, phase); walk(node.body, inner, phase)
      return
    }
    if (type === 'ClassDeclaration') {
      if (phase === 'collect') bindingNames(node.id, scope.names)
      walk(node.superClass, scope, phase); walk(node.body, scope, phase)
      return
    }
    if (FUNCTIONS.has(type)) {
      const inner = open(node, scope)
      if (node.computed) walk(node.key, scope, phase)
      if (phase === 'collect') {
        bindingNames(node.id, type === 'FunctionDeclaration' ? scope.names : inner.names)
        for (const param of node.params) bindingNames(param, inner.names)
      }
      for (const param of node.params) walkDefaults(param, inner, phase)
      walk(node.body, inner, phase)
      return
    }
    if (SCOPES.has(type)) {
      const inner = open(node, scope)
      if (phase === 'collect') bindingNames(node.param, inner.names)
      else walkDefaults(node.param, inner, phase)
      if (type === 'ForStatement') { walk(node.init, inner, phase); walk(node.test, inner, phase); walk(node.update, inner, phase); walk(node.body, inner, phase); return }
      if (type === 'ForInStatement' || type === 'ForOfStatement') { walk(node.left, inner, phase); walk(node.right, inner, phase); walk(node.body, inner, phase); return }
      if (type === 'SwitchStatement') { walk(node.discriminant, inner, phase); walk(node.cases, inner, phase); return }
      if (type === 'CatchClause') { walk(node.body, inner, phase); return }
      for (const child of children(node)) walk(child, inner, phase)
      return
    }
    for (const child of children(node)) walk(child, scope, phase)
  }

  walk(ast.program, open(ast.program, null), 'collect')
  walk(ast.program, open(ast.program, null), 'check')
  return findings
}

const report = findings => findings.map(finding => `${finding.name} @ L${finding.line}`)

test('作用域哨兵能分辨块内声明与块外引用', () => {
  /* 正对照：哨兵必须先能失败，才值得信任。下面两段只差一个绑定位置。 */
  const broken = 'const sink = value => value\nfunction f(source) { while (true) { const part = source(); if (part.done) break }\n  return sink(part.bytes) }'
  const fixed = 'const sink = value => value\nfunction f(source) { let part\n  while (true) { part = source(); if (part.done) break }\n  return sink(part.bytes) }'
  assert.deepEqual(report(unboundIdentifiers(broken)), ['part @ L3'])
  assert.deepEqual(report(unboundIdentifiers(fixed)), [])
  /* 提升同样不能被误判：函数声明写在引用之后。 */
  assert.deepEqual(report(unboundIdentifiers('const h = tag => tag\nconst page = h(Later, null)\nfunction Later() { return page }')), [])
})

test('客户端源码与产物里都没有未声明的标识符', async () => {
  for (const file of FILES) {
    const source = await readFile(join(HERE, '..', file), 'utf8')
    assert.deepEqual(report(unboundIdentifiers(source)), [], `${file} 引用了没有声明的标识符：拼错的局部变量会在浏览器里炸成 ReferenceError；确实是浏览器/语言全局的，才加进 GLOBALS`)
  }
})

/* 终局图层（五连金带 / 点亮环 / 终局胶囊 / 胜和徽标）与席位身份（席号 + 徽记 + 中文名）
   只活在呈现层：源码改了不重建产物，软件里就是「改了但没生效」。
   这里按产物里的字面量核对，不依赖未被压缩的标识符。 */
test('客户端产物带上终局图层与席位身份，源码与样式改动必须重新 arena:build', async () => {
  const bundle = await readFile(join(HERE, '..', 'client.js'), 'utf8')
  for (const marker of ['winband', 'winring', '#F0B429', 'ar-pill', 'ar-player-badge', 'ar-cast-badge', 'ar-winring', 'ar-seat', 'ar-role', 'ar-speaking-figure', 'ar-speaking-face']) {
    assert.ok(bundle.includes(marker), `client.js 缺少 ${marker}：改了 presentation.mjs / styles.mjs / client-source.mjs 之后必须执行 npm run arena:build`)
  }
})

/* 观战页与导出侧的形象必须同源（同一个模型标识、同一批素材、同一套逐手条件）。
   观战页是各写一套渲染，最容易漂移的就是这里。 */
test('观战页的模型形象与导出侧同源：同一份分配、同一批素材、同一套逐手条件', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(join(HERE, '..', 'client-source.mjs'), 'utf8')
  /* 形象必须来自 model-art.mjs 的 full 档（与席卡同一张图），不是另取一套。 */
  assert.match(source, /MODEL_ART\.full\[portrait\]/u, '观战页形象没有走 MODEL_ART.full')
  assert.match(source, /MODEL_ART\.logos\[logoKey\(player\)\]/u, '观战页 logo 没有走 MODEL_ART.logos')
  /* 整局分配只在呈现层算一次，与 replay/data.mjs 用同一个 assignPortraits。
     表达式要容下「比赛还没读到」的那一帧，否则这个 hook 只能写在提前 return 之后
     ——hook 顺序哨兵（client-hooks.test.mjs）守着那件事。 */
  assert.match(source, /assignPortraits\(match\?\.players \|\| \[\]\)/u, '观战页没有用 assignPortraits 做整局分配')
  /* 逐手条件：本手有发言才画人。 */
  assert.match(source, /const actorSpeaks = !thinking && Boolean\(String\(frame\.current\?\.speech \|\| ''\)\.trim\(\)\)/u, '观战页缺少逐手条件')
  /* 版式口径：形象那一格不许有底板（否则又会变成一块黑底）。 */
  const { CSS } = await import('../styles.mjs')
  const figure = CSS.match(/(?:^|\n)\.ar-speaking-figure\{([^}]*)\}/u)
  assert.ok(figure, 'styles.mjs 缺少 .ar-speaking-figure')
  assert.doesNotMatch(figure[1], /background/u, '形象那一格不能有背景色')
  assert.match(CSS, /\.ar-speaking-figure\[data-quiet=true\] \.ar-speaking-mark\{/u, '无发言时 logo 要变成这一格的主标')
})