import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'

/**
 * Hook 顺序哨兵。
 *
 * 回归防线：观战页的 `MatchView` 曾经在「还没读到比赛」的提前 return 之后调用
 * `React.useMemo`。首帧 match 还是 null，提前 return 把第 26 个 hook 整个跳过；
 * 比赛数据到达后的下一次渲染又走到它，React 抛
 * `Rendered more hooks than during the previous render`，被工作台的
 * CapabilityPageBoundary 接住，整页变成「能力包页面暂时不可用」。
 *
 * 旧测试拦不住它：arena 的用例几乎都是纯函数，`client-scope` 只看标识符有没有声明，
 * eslint 也没有接进 CI。所以这里按 AST 逐个体检组件与自定义 hook ——
 * **hook 必须写在函数体最外层，且必须在第一处可能提前 return 的语句之前**。
 * 这两条正是 React 的 Rules of Hooks 里最容易违反、又最难靠肉眼发现的部分：
 * 多人协作时，谁在下面补一句 `if (… ) return` 都会把上面的 hook 变成「上一次渲染没有它」。
 *
 * 源码与产物各查一遍：产物才是上线的字节，也是「源码改了没重新 arena:build」的证据。
 */

const HERE = dirname(fileURLToPath(import.meta.url))

const FILES = ['client-source.mjs', 'client.js']

const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod', 'ClassPrivateMethod'])

/* 只看组件（首字母大写）与自定义 hook（useFoo）：普通工具函数里出现 `useXxx()` 形状的调用
   （例如数据表里的 useCallback 包装）不该被当成组件规则来判。 */
const isComponentOrHook = name => typeof name === 'string' && (/^use[A-Z]/u.test(name) || /^[A-Z]/u.test(name))

/** 函数名：声明名、`const Foo = () => {}` 的绑定名，或对象/类方法的 key。 */
function functionName(node, parent) {
  if (!node.id && parent) {
    if (parent.type === 'VariableDeclarator' && parent.id?.type === 'Identifier') return parent.id.name
    if ((parent.type === 'ObjectProperty' || parent.type === 'ClassProperty' || parent.type === 'PropertyDefinition') && parent.key) return parent.key.name || parent.key.value
  }
  return node.id?.name || null
}

/* hook 调用的两种写法：`React.useXxx(...)`（源码，React 外部引入）与
   `import_react4.default.useXxx(...)`（esbuild 产物把 default 引用接出来）。
   自定义 hook 则是裸名 `useQuery(...)`。 */
function hookName(callee) {
  if (!callee) return null
  if (callee.type === 'Identifier') return /^use[A-Z]/u.test(callee.name) ? callee.name : null
  if (callee.type !== 'MemberExpression' && callee.type !== 'OptionalMemberExpression') return null
  if (callee.computed || callee.property?.type !== 'Identifier') return null
  const { property } = callee
  if (!/^use[A-Z]/u.test(property.name)) return null
  const object = callee.object
  if (object?.type === 'Identifier' && object.name === 'React') return property.name
  /* 产物形态：`import_react4.default.useMemo`。 */
  if (object?.type === 'MemberExpression' && object.property?.type === 'Identifier' && object.property.name === 'default'
    && object.object?.type === 'Identifier' && /^import_react/u.test(object.object.name)) return property.name
  return null
}

/** 该子树里（不越过嵌套函数）出现的 hook 调用。 */
function hooksIn(node) {
  const found = []
  const walk = current => {
    if (!current || typeof current.type !== 'string') return
    if (FUNCTIONS.has(current.type)) return
    if (current.type === 'CallExpression' || current.type === 'OptionalCallExpression') {
      const name = hookName(current.callee)
      if (name) found.push({ name, line: current.loc?.start?.line || 0 })
    }
    for (const [key, value] of Object.entries(current)) {
      if (['loc', 'start', 'end', 'range', 'extra', 'leadingComments', 'trailingComments', 'innerComments'].includes(key)) continue
      if (Array.isArray(value)) { for (const item of value) if (item && typeof item.type === 'string') walk(item) }
      else if (value && typeof value.type === 'string') walk(value)
    }
  }
  walk(node)
  return found
}

/** 该语句是否可能提前返回（不越过嵌套函数）。 */
function returnsEarly(node) {
  let found = false
  const walk = current => {
    if (found || !current || typeof current.type !== 'string') return
    if (FUNCTIONS.has(current.type)) return
    if (current.type === 'ReturnStatement') { found = true; return }
    for (const [key, value] of Object.entries(current)) {
      if (['loc', 'start', 'end', 'range', 'extra', 'leadingComments', 'trailingComments', 'innerComments'].includes(key)) continue
      if (Array.isArray(value)) { for (const item of value) if (item && typeof item.type === 'string') walk(item) }
      else if (value && typeof value.type === 'string') walk(value)
    }
  }
  walk(node)
  return found
}

/**
 * 体检一个函数体。
 *
 * 规则一：hook 必须挂在函数体最外层 —— 走进 if / for / try / 裸块就是条件调用，
 *        上一次渲染调了、这一次没调，同样会让 React 抛错。
 * 规则二：hook 不许排在任何一处可能提前 return 的语句之后。
 * @returns 违规列表 `{ name, line, reason }`
 */
function inspectBody(body) {
  const violations = []
  let earlyReturnAt = null
  for (const statement of body.body) {
    for (const hook of hooksIn(statement)) {
      if (earlyReturnAt !== null) violations.push({ ...hook, reason: `hook 排在 L${earlyReturnAt} 的提前 return 之后` })
      if (hookNesting(statement, hook.line) > 0) violations.push({ ...hook, reason: 'hook 没有写在函数体最外层（条件调用）' })
    }
    if (earlyReturnAt === null && returnsEarly(statement)) earlyReturnAt = statement.loc?.start?.line || 0
  }
  return violations
}

/** 这条语句里的某个 hook 被几层块包住：0 层就是函数体的直接子句。 */
function hookNesting(statement, hookLine) {
  let depth = null
  const walk = (node, blocks) => {
    if (depth !== null || !node || typeof node.type !== 'string') return
    if (FUNCTIONS.has(node.type)) return
    if ((node.type === 'CallExpression' || node.type === 'OptionalCallExpression') && hookName(node.callee) && (node.loc?.start?.line || 0) === hookLine) { depth = blocks; return }
    const nested = node.type === 'BlockStatement' && node !== statement ? blocks + 1 : blocks
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'start', 'end', 'range', 'extra', 'leadingComments', 'trailingComments', 'innerComments'].includes(key)) continue
      if (Array.isArray(value)) { for (const item of value) if (item && typeof item.type === 'string') walk(item, nested) }
      else if (value && typeof value.type === 'string') walk(value, nested)
    }
  }
  walk(statement, 0)
  return depth ?? 0
}

/** 收集文件里所有组件 / 自定义 hook 的违规。 */
function hookOrderViolations(source) {
  const ast = parse(source, { sourceType: 'unambiguous', plugins: ['jsx'] })
  const findings = []
  const parents = new Map()

  const walk = (node, parent) => {
    if (!node || typeof node.type !== 'string') return
    const name = FUNCTIONS.has(node.type) ? functionName(node, parent) : null
    if (FUNCTIONS.has(node.type) && isComponentOrHook(name) && node.body?.type === 'BlockStatement') {
      for (const violation of inspectBody(node.body)) {
        findings.push({ component: name, ...violation })
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'start', 'end', 'range', 'extra', 'leadingComments', 'trailingComments', 'innerComments'].includes(key)) continue
      if (Array.isArray(value)) { for (const item of value) { if (item && typeof item.type === 'string') { parents.set(item, node); walk(item, node) } } }
      else if (value && typeof value.type === 'string') { parents.set(value, node); walk(value, node) }
    }
  }
  walk(ast.program, null)
  return findings
}

const report = findings => findings.map(finding => `${finding.component} 的 ${finding.name} @ L${finding.line}（${finding.reason}）`)

test('hook 顺序哨兵能分辨 hook 与提前 return 的先后', () => {
  /* 正对照：哨兵必须先能失败，才值得信任。两段只差 hook 的位置。 */
  const broken = `import React from 'react'
function Page({ match }) {
  const [step, setStep] = React.useState(0)
  if (!match) return null
  const rows = React.useMemo(() => match.rows, [match])
  return React.createElement('p', null, rows, step, setStep)
}`
  const fixed = `import React from 'react'
function Page({ match }) {
  const [step, setStep] = React.useState(0)
  const rows = React.useMemo(() => match?.rows, [match?.rows])
  if (!match) return null
  return React.createElement('p', null, rows, step, setStep)
}`
  assert.deepEqual(report(hookOrderViolations(broken)), ['Page 的 useMemo @ L5（hook 排在 L4 的提前 return 之后）'])
  assert.deepEqual(report(hookOrderViolations(fixed)), [])
  /* 条件调用同样要抓：写在 if 里的 hook 上一次渲染可能整个不存在。 */
  const conditional = `import React from 'react'
function Page({ open }) {
  if (open) { React.useEffect(() => {}, []) }
  return null
}`
  assert.equal(hookOrderViolations(conditional).length, 1)
  /* 产物形态（esbuild 把 default 引用接出来）也要认。 */
  const bundle = `function Card({ match }) {
  if (!match) return null;
  const rows = import_react4.default.useMemo(() => match.rows, [match]);
  return rows;
}`
  assert.deepEqual(report(hookOrderViolations(bundle)), ['Card 的 useMemo @ L3（hook 排在 L2 的提前 return 之后）'])
  /* 嵌套函数各算各的：回调里的调用不该替外层背锅，也不该被漏掉。 */
  const nested = `function Panel({ list }) {
  const rows = list.map((item) => {
    if (!item) return null
    return React.useMemo(() => item, [item])
  })
  return rows
}`
  assert.deepEqual(report(hookOrderViolations(nested)), [])
})

test('观战页与比赛回放的组件里，hook 都在提前 return 之前、且都是无条件调用', async () => {
  for (const file of FILES) {
    const source = await readFile(join(HERE, '..', file), 'utf8')
    assert.deepEqual(report(hookOrderViolations(source)), [], `${file} 的 hook 顺序违反 Rules of Hooks：首帧被提前 return 绕过的 hook，会在数据到达后的下一次渲染里让 React 抛「Rendered more hooks than during the previous render」，整页被 CapabilityPageBoundary 换成「能力包页面暂时不可用」`)
  }
})