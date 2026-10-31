/**
 * The pack's CSS is one string inside `client.js`, so nothing else checks that it
 * still describes the markup. This contract keeps the two sides together: a class
 * the pages render must have a rule, and a rule must belong to a class the pages
 * render (dead CSS in a single-file page rots fast).
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const css = source.match(/const css = `([\s\S]*?)`;/u)?.[1]

/** Class names this pack applies, from static strings and template literals. */
function usedClasses() {
  const names = new Set()
  for (const pattern of [/className:\s*'([^']+)'/gu, /className:\s*`([^`]+)`/gu]) {
    for (const match of source.matchAll(pattern)) {
      for (const name of match[1].match(/\bmr-[A-Za-z0-9_-]+/gu) || []) names.add(name)
    }
  }
  return names
}

function definedClasses() {
  return new Set([...css.matchAll(/\.(mr-[A-Za-z0-9_-]+)/gu)].map(match => match[1]))
}

test('the pack defines its own stylesheet', () => {
  assert.ok(css, 'client.js must define its product CSS')
  assert.match(css, /\.mr-page\{--mr-brand:#4f46e5/u, 'the page owns its palette')
})

test('every class the pages render has a rule', () => {
  const missing = [...usedClasses()].filter(name => !css.includes(`.${name}`))
  assert.deepEqual(missing, [], 'a rendered class without a rule is an unstyled element')
})

test('every rule belongs to a class the pages render', () => {
  const stale = [...definedClasses()].filter(name => !usedClasses().has(name))
  assert.deepEqual(stale, [], 'a rule for a class nobody renders is dead weight')
})

test('the three page tones and the run states are styled', () => {
  for (const tone of ['violet', 'orange', 'cyan']) {
    assert.ok(css.includes(`.mr-page[data-tone="${tone}"]`), `tone ${tone} must map to a palette`)
  }
  for (const status of ['queued', 'running', 'succeeded', 'failed', 'cancelled']) {
    assert.ok(css.includes(`data-status="${status}"`), `status ${status} must be visible somewhere`)
  }
  // Every tone in the manifest is one the pack actually paints with.
  assert.match(css, /--mr-tone:var\(--mr-brand\)/u, 'a page without its own tone still has one')
})

test('the palette is redefined for the dark theme, including text on the brand fill', () => {
  assert.match(css, /body\[data-ds-dark-theme\] \.mr-page\{--mr-brand:#a5b4fc/u)
  assert.match(css, /--mr-on-brand:#0f172a/u, 'light text on a light brand fill would be unreadable')
  for (const token of ['--mr-violet', '--mr-orange', '--mr-cyan', '--mr-green', '--mr-amber', '--mr-red', '--mr-run']) {
    assert.ok(css.includes(`${token}-soft`), `${token} needs a soft companion for both themes`)
  }
})

test('interactive marks are not carried by colour alone', () => {
  // Selection is a border plus a bar plus a checkbox state, so it survives a
  // monochrome or high-contrast rendering.
  assert.match(css, /\.mr-qrow\[data-active="true"\]::before/u, 'a chosen row carries a leading bar')
  assert.match(css, /\.mr-mrow\[data-on="true"\]::before/u, 'a chosen model carries a leading bar')
  assert.match(css, /\.mr-qrow\[data-active="true"\] \.mr-qrow-title strong\{color/u, 'and its title takes the page tone')
  // A row is marked by a bar and a fill, never by a border: a bordered row reads
  // as an input field. Only card-shaped things (.mr-qcard) keep a border.
  assert.doesNotMatch(css, /\.mr-qrow\[data-active="true"\]\{border/u)
  assert.doesNotMatch(css, /\.mr-mrow\[data-on="true"\]\{border/u)
  assert.match(css, /\.mr-run\[data-status="failed"\] \.mr-run-stripe/u)
  assert.match(css, /:focus-visible/u)
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/u)
})
test('a scrolling grid pins its rows to their content height', () => {
  // A grid with a max height and overflow has a definite height, so its `auto`
  // tracks are resolved against that box and end up SHORTER than the rows'
  // content: the row's last line is then drawn across its own bottom border (it
  // showed up as a selected row cut in half by its own sub-line). Measured:
  // 50.5px given for 59.3px of content, cured by `grid-auto-rows:max-content`.
  const scrolling = [...css.matchAll(/\.(mr-[A-Za-z0-9_-]+)\{([^}]*max-height[^}]*overflow:auto[^}]*)\}/gu)]
  assert.ok(scrolling.length >= 2, `expected the pack's scrolling lists, found ${scrolling.length}`)
  for (const [, name, body] of scrolling) {
    if (!/display:grid/u.test(body)) continue
    assert.match(body, /grid-auto-rows:max-content/u, `.${name} must keep its rows at content height`)
    assert.match(body, /align-content:start/u, `.${name} must not stretch its rows either`)
  }
})

test('a scroll window is a whole number of rows', () => {
  // Otherwise the last visible row is sliced through its own sub-line, which
  // reads as a broken row rather than as "there is more below".
  const row = Number(css.match(/\.mr-qrow\{[^}]*min-height:(\d+)px/u)?.[1])
  const gap = Number(css.match(/\.mr-picker-list\{[^}]*gap:(\d+)px/u)?.[1])
  assert.ok(row > 0 && gap >= 0, 'the row height and list gap must be readable')
  for (const list of ['mr-picker-list', 'mr-bank-list']) {
    const rule = css.match(new RegExp(`\\.${list}\\{([^}]*)\\}`, 'u'))?.[1] || ''
    // The history list states its window as the floor token it is allowed to grow
    // past, so the whole-row promise is read from whichever of the two carries the
    // pixels. Only the floor has to be whole rows: the growth is a measured leftover,
    // and a list that ends mid-row is how a scrolling list says "there is more below".
    const window = Number((rule.match(/max-height:(\d+)px/u) || rule.match(/--mr-list-floor:(\d+)px/u))?.[1])
    const padding = Number(rule.match(/padding:(\d+)px/u)?.[1]) * 2 || 0
    assert.ok(window > 0, `.${list} must declare a pixel window`)
    assert.equal((window + gap - padding) % (row + gap), 0, `.${list} (${window}px minus ${padding}px padding) must fit whole ${row}px rows`)
  }
})
