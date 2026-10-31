/**
 * A dependency-free renderer for this pack's pages.
 *
 * The pack is a browser module: it registers React components through the host
 * loader and only ever uses `createElement`, `useState`, `useEffect`, `useRef`
 * and `Fragment`. That is a small enough surface to run the real components
 * outside a browser, which is what this harness does: it evaluates `client.js`
 * with a hook engine and a serializer, so a page's actual markup and the pack's
 * actual CSS can be inspected and screenshotted without a bundler or a DOM.
 *
 * It is verification tooling, not product code: hook identity is positional (a
 * slot is keyed by the component's path in the tree), timers do not tick, and
 * there is no unmount. `test/preview.mjs` turns the output into an HTML file.
 */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

/* ------------------------------------------------------------------ hooks -- */

function createEngine() {
  const slots = new Map()
  return {
    slots,
    effects: [],
    dirty: false,
    path: 'root',
    hookIndex: 0,
    warns: [],
    reset() { slots.clear(); this.effects = []; this.dirty = false; this.warns = [] },
    slot(create) {
      const key = `${this.path}#${this.hookIndex++}`
      let slot = slots.get(key)
      if (!slot) { slot = create(); slots.set(key, slot) }
      return slot
    },
  }
}

function createShim(engine) {
  const Fragment = Symbol('Fragment')
  return {
    Fragment,
    createElement: (type, props, ...children) => ({ __el: true, type, props: props || {}, children }),
    useState(initial) {
      const slot = engine.slot(() => ({ value: typeof initial === 'function' ? initial() : initial }))
      return [slot.value, next => {
        const value = typeof next === 'function' ? next(slot.value) : next
        if (Object.is(value, slot.value)) return
        slot.value = value
        engine.dirty = true
      }]
    },
    useEffect(fn, deps) {
      const slot = engine.slot(() => ({ deps: undefined, cleanup: null }))
      const previous = slot.deps
      const changed = !previous || !deps || deps.length !== previous.length || deps.some((value, index) => !Object.is(value, previous[index]))
      slot.deps = deps ? [...deps] : undefined
      if (changed) engine.effects.push({ slot, fn })
    },
    useRef: initial => engine.slot(() => ({ current: initial })),
    // `useCallback`/`useMemo` only need to memoise: identity matters because a
    // changed dependency must produce a new value and an unchanged one must not,
    // and both are decided by the same positional slot the other hooks use.
    useCallback(fn, deps) {
      const slot = engine.slot(() => ({ deps: null, value: fn }))
      if (depsChanged(slot.deps, deps)) { slot.deps = deps ? [...deps] : null; slot.value = fn }
      return slot.value
    },
    useMemo(factory, deps) {
      const slot = engine.slot(() => ({ deps: null, value: undefined }))
      if (depsChanged(slot.deps, deps)) { slot.deps = deps ? [...deps] : null; slot.value = factory() }
      return slot.value
    },
  }
}

function depsChanged(previous, next) {
  if (!previous || !next || next.length !== previous.length) return true
  return next.some((value, index) => !Object.is(value, previous[index]))
}

function expand(node, path, engine) {
  if (node === null || node === undefined || node === false || node === true) return null
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) {
    const list = node.map((child, index) => expand(child, `${path}.${index}`, engine)).filter(child => child !== null)
    return list.length ? list : null
  }
  if (!node.__el) return null
  if (typeof node.type === 'symbol') return expand(node.children, path, engine)
  if (typeof node.type === 'function') {
    const previousPath = engine.path
    const previousIndex = engine.hookIndex
    // State belongs to one component instance, as in React: a different
    // component or a different `key` in the same place starts fresh.
    engine.path = `${path}:${node.type.name || 'anonymous'}${node.props?.key == null ? '' : `@${node.props.key}`}`
    engine.hookIndex = 0
    let output
    try {
      output = node.type({ ...node.props, children: node.children.length === 1 ? node.children[0] : node.children })
    } catch (error) {
      engine.warns.push(`${node.type.name || 'component'} 渲染失败：${error.message}`)
      output = { __el: true, type: 'p', props: { className: 'mr-error' }, children: [`渲染失败：${error.message}`] }
    }
    engine.path = previousPath
    engine.hookIndex = previousIndex
    return expand(output, `${path}:${node.type.name || 'anonymous'}${node.props?.key == null ? '' : `@${node.props.key}`}>`, engine)
  }
  const children = expand(node.children, path, engine)
  return { tag: String(node.type), props: node.props, children: Array.isArray(children) ? children : children === null ? [] : [children] }
}

/** Render a tree, running effects until the page stops asking to re-render. */
async function settle(element, engine) {
  let tree = null
  for (let pass = 0; pass < 40; pass += 1) {
    engine.effects = []
    engine.dirty = false
    tree = expand(element, 'root', engine)
    for (const effect of engine.effects) {
      if (typeof effect.slot.cleanup === 'function') effect.slot.cleanup()
      let cleanup
      try { cleanup = effect.fn() } catch (error) { engine.warns.push(`effect 失败：${error.message}`) }
      effect.slot.cleanup = typeof cleanup === 'function' ? cleanup : null
    }
    await new Promise(resolve => setTimeout(resolve, 0))
    if (!engine.dirty) break
  }
  return tree
}

/* -------------------------------------------------------------- serialize -- */

const VOID = new Set(['input', 'br', 'img', 'hr', 'meta', 'link', 'source'])
const ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
const esc = value => String(value).replace(/[&<>"]/gu, character => ESCAPE[character])
const PASS_THROUGH = new Set(['role', 'title', 'type', 'value', 'placeholder', 'list', 'id', 'href', 'for', 'form', 'name', 'disabled', 'checked', 'required', 'maxlength', 'tabindex'])

function attrs(props) {
  const out = []
  for (const [key, value] of Object.entries(props || {})) {
    if (key === 'children' || key === 'key' || key === 'ref' || value === null || value === undefined || value === false || typeof value === 'function') continue
    if (key === 'className') { out.push(`class="${esc(value)}"`); continue }
    if (key === 'style' && typeof value === 'object') {
      out.push(`style="${Object.entries(value).map(([property, setting]) => `${property.replace(/[A-Z]/gu, match => `-${match.toLowerCase()}`)}:${setting}`).join(';')}"`)
      continue
    }
    const name = key.startsWith('data-') || key.startsWith('aria-') ? key : key.toLowerCase()
    out.push(PASS_THROUGH.has(name) || name.startsWith('aria-') || name.startsWith('data-') ? `${name}="${esc(value)}"` : `${name}="${esc(value)}"`)
  }
  return out.length ? ` ${out.join(' ')}` : ''
}

export function toHtml(node) {
  if (node === null) return ''
  if (typeof node === 'string') return esc(node)
  if (Array.isArray(node)) return node.map(toHtml).join('')
  // A textarea holds its value as text content, not as an attribute: the browser
  // ignores a `value` attribute on it, and so would anyone reading the preview.
  const textarea = node.tag === 'textarea'
  const open = `<${node.tag}${attrs(textarea ? { ...node.props, value: undefined } : node.props)}>`
  if (VOID.has(node.tag)) return open
  // A style or script element holds raw text: escaping it would corrupt the CSS.
  const raw = node.tag === 'style' || node.tag === 'script'
  const children = textarea && !node.children.length
    ? esc(String(node.props.value ?? ''))
    : node.children.map(child => raw && typeof child === 'string' ? child : toHtml(child)).join('')
  return `${open}${children}</${node.tag}>`
}

export function textOf(node) {
  if (node === null) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join('')
  return node.children.map(textOf).join('')
}

/** Collect nodes matching `{ tag, className, text, aria, hasClick, hasChange }`. */
export function find(node, match, hits = []) {
  if (node === null || typeof node === 'string') return hits
  if (Array.isArray(node)) { for (const child of node) find(child, match, hits); return hits }
  const passes = (!match.tag || node.tag === match.tag) &&
    (!match.className || String(node.props.className || '').split(/\s+/u).includes(match.className)) &&
    (!match.text || textOf(node).includes(match.text)) &&
    (!match.aria || String(node.props['aria-label'] || '').includes(match.aria)) &&
    (!match.hasClick || typeof node.props.onClick === 'function') &&
    (!match.hasChange || typeof node.props.onChange === 'function')
  if (passes) hits.push(node)
  for (const child of node.children) find(child, match, hits)
  return hits
}

/* ------------------------------------------------------------ pack loader -- */

/**
 * Evaluate the pack client in a fresh context and return its pages.
 *
 * @param options.api - substitute for the host RPC: `(method, request) => value`.
 * @param options.client - path to the browser module, relative to this file;
 *   the default is this pack's own client.
 * @returns the three page components, the hook engine, and the RPC call log.
 */
export function loadPack({ api, client = '../client.js' }) {
  const engine = createEngine()
  const shim = createShim(engine)
  const calls = []
  // Every blob the page hands to `URL.createObjectURL`, by its parts. The report
  // is only ever reachable as a blob, so this is how a test gets to read the
  // generated document instead of asserting on the fact that it was generated.
  const blobs = []
  let plugin = null
  const connection = {
    rpc: {
      call: async (_path, method, payload) => {
        // Namespaced as `<pack>/<method>`; the pack under test is the only one in
        // the sandbox, so the prefix is noise here.
        const name = String(method).replace(/^[\w-]+\//u, '')
        const request = payload?.args?.request
        calls.push({ method: name, request })
        try { return { ok: true, value: await api(name, request) } } catch (error) { return { ok: false, error: { message: error.message } } }
      },
    },
  }
  let registered = null
  const sandbox = {
    console, setTimeout, clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    navigator: { clipboard: { writeText: async () => {} } },
    TextEncoder,
    TextDecoder,
    btoa,
    atob,
    // The page sizes its export with `Blob#size`, so the shim has to carry one.
    Blob: class { constructor(parts) { this.parts = parts; this.size = parts.reduce((sum, part) => sum + new TextEncoder().encode(String(part)).length, 0) } },
    // An upload reads the file as a data URL. A test hands in `{ name, type, arrayBuffer }`,
    // so the shim only has to produce what a real reader would.
    FileReader: class {
      readAsDataURL(file) {
        Promise.resolve(file.arrayBuffer()).then((buffer) => {
          this.result = `data:${file.type || 'application/octet-stream'};base64,${Buffer.from(buffer).toString('base64')}`
          this.onload?.()
        }, (error) => { this.onerror?.(error) })
      }
    },
    URL: {
      createObjectURL: blob => { blobs.push(blob.parts.map(String).join('')); return `blob:preview-${blobs.length}` },
      revokeObjectURL: () => {},
    },
    // A pack that ships its stylesheet injects it through a `<style>` element, so
    // `document.head` has to exist with an `append`, and the element carries a
    // `dataset`. The element itself is discarded: the preview writes the CSS it
    // extracted alongside the markup.
    document: {
      createElement: () => ({ click() {}, href: '', download: '', dataset: {}, textContent: '' }),
      head: { append() {}, remove() {} },
    },
    window: {
      __ModuleLoader__: { load: ({ factory }) => { plugin = factory(name => name === 'react' ? shim : {}) } },
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  }
  sandbox.globalThis = sandbox
  vm.runInNewContext(readFileSync(new URL(client, import.meta.url), 'utf8'), sandbox, { filename: client })
  if (!plugin) throw new Error('the pack client did not register itself with the module loader')
  plugin.apply({
    get: name => name === 'connection' ? connection : undefined,
    effect: fn => { fn(); return () => {} },
    lwbPackClient: { register: contribution => { registered = contribution; return () => {} } },
  })
  if (!registered) throw new Error('the pack client did not register its pages')

  const defaultConversation = () => ({ __el: true, type: 'div', props: { className: 'preview-conversation' }, children: [] })
  return {
    pages: registered.pages,
    calls,
    /** Every document the page turned into a blob URL, oldest first. */
    blobs,
    /** Render one page; the engine is reset so pages never share hook slots. */
    async render(name, props = {}) {
      const Component = registered.pages[name]
      if (!Component) throw new Error(`unknown page: ${name}`)
      engine.reset()
      const element = { __el: true, type: Component, children: [], props: {
        renderConversation: props.renderConversation || defaultConversation,
        focusSession: props.focusSession || (() => {}),
      } }
      let tree = await settle(element, engine)
      const result = {
        html: toHtml(tree),
        tree,
        warnings: engine.warns,
        calls,
        /**
         * Let pending requests land, then re-render. A page whose data comes from a
         * real backend answers a few ticks after the first pass has already settled.
         */
        async settle(ms = 40) {
          await new Promise(resolve => setTimeout(resolve, ms))
          tree = await settle(element, engine)
          result.tree = tree
          result.html = toHtml(tree)
          return result
        },
        /** Click the first matching control, then settle the re-render. */
        async click(match) {
          // A change made through a prop (a checkbox's onChange) leaves the tree
          // stale here, because this engine only re-renders when settle asks it
          // to. A browser flushes that first, so the clicked control is the one
          // the fresh markup holds rather than a closure from the previous pass.
          if (engine.dirty) { tree = await settle(element, engine); result.tree = tree; result.html = toHtml(tree) }
          const targets = find(tree, { hasClick: true, ...match })
          if (!targets.length) throw new Error(`no clickable node matched ${JSON.stringify(match)}`)
          targets[0].props.onClick()
          tree = await settle(element, engine)
          result.tree = tree
          result.html = toHtml(tree)
          return result
        },
        /**
         * Toggle the first matching checkbox, then settle the re-render.
         *
         * A checkbox reports through `onChange`, which the click helper cannot
         * reach, and its handler reads `checked` from the event in a browser while
         * this engine passes none — so the value is flipped on the node first.
         */
        async change(match) {
          if (engine.dirty) { tree = await settle(element, engine); result.tree = tree; result.html = toHtml(tree) }
          const targets = find(tree, { tag: 'input', ...match })
          if (!targets.length) throw new Error(`no input matched ${JSON.stringify(match)}`)
          const node = targets[0]
          node.props.checked = !node.props.checked
          node.props.onChange?.({ target: { checked: node.props.checked } })
          tree = await settle(element, engine)
          result.tree = tree
          result.html = toHtml(tree)
          return result
        },
      }
      return result
    },
  }
}