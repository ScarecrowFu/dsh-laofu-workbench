import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

const clientPath = new URL('../client.js', import.meta.url)

function classNames(source) {
  const names = new Set()
  for (const pattern of [/className:\s*'([^']+)'/gu, /className:\s*`([^`]+)`/gu]) {
    for (const match of source.matchAll(pattern)) {
      for (const name of match[1].match(/lwb-[A-Za-z0-9_-]+/gu) || []) names.add(name)
    }
  }
  return names
}

test('every current static LWB component class has a product style rule', async () => {
  const source = await readFile(clientPath, 'utf8')
  const css = source.match(/const css = `([\s\S]*?)`;/u)?.[1]
  assert.ok(css, 'client must define its product CSS')

  const missing = [...classNames(source)].filter((name) => {
    return !css.includes(`.${name}`)
  })
  assert.deepEqual(missing, [])
})

test('desktop hides controls reserved for the mobile navigation', async () => {
  const source = await readFile(clientPath, 'utf8')
  assert.match(source, /\.lwb-mobile-nav-trigger,\.lwb-mobile-conversation-trigger,\.lwb-mobile-nav-backdrop\s*\{\s*display:none;/u)
  assert.match(source, /@media \(max-width:680px\)[\s\S]*?\.lwb-mobile-nav-trigger,\.lwb-mobile-conversation-trigger\s*\{[\s\S]*?display:grid;/u)
})

test('the browser shell restores UUID generation for plain-HTTP LAN previews', async () => {
  const source = await readFile(clientPath, 'utf8')
  const start = source.indexOf('function installLanCryptoCompatibility()')
  const end = source.indexOf('\n    const STORAGE_KEY', start)
  assert.ok(start >= 0 && end > start, 'browser shell must define the LAN crypto compatibility layer')
  const sandbox = { globalThis: { crypto: { getRandomValues(bytes) { bytes.fill(7); return bytes } } } }
  const install = runInNewContext(`${source.slice(start, end)}; installLanCryptoCompatibility`, sandbox)
  install()
  const uuid = sandbox.globalThis.crypto.randomUUID()
  assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
})

test('settings do not duplicate DSH theme or language controls', async () => {
  const source = await readFile(clientPath, 'utf8')
  assert.doesNotMatch(source, /function setAppearance\(/u)
  assert.doesNotMatch(source, /h\('option', \{ value: 'system' \}, copy\.system\)/u)
  assert.doesNotMatch(source, /services\.locale\.setLocale\(/u)
})

test('settings exposes an optional LWB account without forcing sign-in at startup', async () => {
  const source = await readFile(clientPath, 'utf8')
  assert.match(source, /services\.connection\.rpc\.call\('\/api', `lwbAccount\/\$\{method\}`/u)
  assert.match(source, /lwbAccountAction\(mode === 'login' \? 'login' : 'register'/u)
  assert.match(source, /lwbAccountAction\('logout'/u)
  assert.match(source, /lwbAccountRpc\('status'\)/u)
  assert.match(source, /if \(connectionState === 'connected'\) void refreshLwbAccount\(\)/u)
  assert.match(source, /renderSlot\('sidebar\.settings', \{ wide: true \}\)/u)
  assert.match(source, /lwbLogin: '登录'/u)
  assert.match(source, /lwbLogin: 'Sign in'/u)
})

test('settings groups every configuration area into its own separated card', async () => {
  const source = await readFile(clientPath, 'utf8')
  const css = source.match(/const css = `([\s\S]*?)`;/u)?.[1]
  assert.ok(css, 'client must define its product CSS')
  assert.match(css, /\.lwb-settings \{ display:grid; gap:18px; \}/u)
  assert.match(css, /\.lwb-settings-group-head \{[^}]*border-bottom:1px solid var\(--lwb-line\)/u)

  const start = source.indexOf('function SettingsPage({ renderSlot })')
  const end = source.indexOf('\n    class CapabilityPageBoundary', start)
  assert.ok(start >= 0 && end > start, 'client must define the settings page')
  const page = source.slice(start, end)
  assert.match(page, /className: 'lwb-settings'/u)
  assert.equal((page.match(/className: 'lwb-card lwb-settings-group'/gu) || []).length, 3, 'basic configuration, LWB account, and about are separate cards')
  assert.doesNotMatch(page, /lwb-settings-list|lwb-settings-section/u)
  assert.match(page, /className: 'lwb-account-note'[\s\S]*?copy\.lwbAccountNote/u)
})

test('the LWB account states that signing in stays optional', async () => {
  const source = await readFile(clientPath, 'utf8')
  assert.match(source, /lwbAccountNote: '不登录 LWB 账号也可以正常使用工作台/u)
  assert.match(source, /lwbAccountNote: 'The Workbench works without an LWB account/u)
})

test('settings is the only primary navigation entry to native DSH runtime settings', async () => {
  const source = await readFile(clientPath, 'utf8')
  assert.match(source, /function LwbRuntimeSettingsTrigger\(\{ openSettings \}\)/u)
  assert.match(source, /html\[data-platform='darwin'\] \.lwb-sidebar \{ padding-top:0; \}/u)
  assert.doesNotMatch(source, /\[data-shell-leading\] \{ display:none; \}/u)
  assert.match(source, /const desktopCollapsed = sidebarCollapsed && width === 0/u)
  assert.match(source, /createPortal\(h\(LwbSidebarExpand, \{ className: 'lwb-desktop-expand' \}\), document\.body\)/u)
  assert.match(source, /html\[data-platform='darwin'\] \.lwb-desktop-expand \{ top:11px; left:88px; \}/u)
  assert.match(source, /html\[data-platform='darwin'\]\[data-fullscreen\] \.lwb-desktop-expand \{ left:12px; \}/u)
  assert.match(source, /\.lwb-overlay-head \{[^}]*padding-left:max\(28px,var\(--dsh-frame-leading-clearance,0px\)\);/u)
  assert.match(source, /\.lwb-conversation-pane-head \{[^}]*padding-left:max\(var\(--dsh-sidebar-inline-padding\),var\(--dsh-frame-leading-clearance,0px\)\);/u)
  // The narrow drawer places the pane itself, so the frame's leading clearance
  // must not pad its head there.
  assert.match(source, /@media \(max-width:680px\)[\s\S]*?\.lwb-conversation-pane-head \{ padding-left:var\(--dsh-sidebar-inline-padding\); \}/u)
  assert.doesNotMatch(source, /ctx\.slots\.inject\('shell\.leading'[\s\S]*?LwbSidebarExpand/u)
  assert.match(source, /systemSettings: 'DSH 系统设置'/u)
  assert.match(source, /function SettingsPage\(\{ renderSlot \}\)/u)
  assert.match(source, /renderSlot\('sidebar\.settings', \{ wide: true \}\)/u)
  assert.doesNotMatch(source, /function LwbSidebar\(\{ collapsed, width, renderSlot \}\)/u)
  assert.doesNotMatch(source, /lwb-dsh-models-entry/u)
  assert.match(source, /ctx\.slots\.inject\('settings\.launcher', \(\) => ctx\.slots\.register\(\{[\s\S]*?name: 'settings\.launcher', priority: -10, registrant: 'lwb-workbench'/u)
  assert.match(source, /ctx\.slots\.inject\('shell\.overlay', \(\) => ctx\.slots\.register\(\{[\s\S]*?children: \{[\s\S]*?'sidebar\.settings': \{ kind: 'single', scope: 'root' \}/u)
  assert.match(source, /\.lwb-dsh-settings-launcher button\[aria-haspopup="dialog"\]/u)
})

test('settings exposes the official DSH account controls beside native settings', async () => {
  const source = await readFile(clientPath, 'utf8')
  assert.match(source, /function useDshAccount\(\)/u)
  assert.match(source, /account\.watch\(signal\)/u)
  assert.match(source, /account\.startSignIn\(dshClientMetadata\(\), dshCallbackOrigin\(\), 'desktop'\)/u)
  assert.match(source, /account\.hasRunningAccountTasks\(\)/u)
  assert.match(source, /result\?\.ok === false\) throw result\.error/u)
  assert.match(source, /window\.confirm\(message\)/u)
  assert.match(source, /account\.signOut\(dshClientMetadata\(\)\)/u)
  assert.match(source, /dshAccount\.phase === 'authenticated' \? 'lwb-dsh-account-button is-signed-in'/u)
  assert.match(source, /copy\.dshSignOut/u)
  assert.match(source, /copy\.dshSignIn/u)
  assert.match(source, /remote: ctx\.get\('remote'\)/u)
  assert.match(source, /exports\.inject = \['slots',[\s\S]*'remote',[\s\S]*'loader'/u)
})

test('LWB styles follow the DSH-owned theme runtime', async () => {
  const source = await readFile(clientPath, 'utf8')
  assert.doesNotMatch(source, /function setAppearance\(/u)
  assert.doesNotMatch(source, /services\.theme\.setTheme\(/u)
  assert.match(source, /body\[data-ds-dark-theme\] \{ --lwb-ink:/u)
  assert.match(source, /body\[data-ds-dark-theme\] \.lwb-sidebar \{ background:var\(--lwb-surface\); \}/u)
})

test('LWB interface observes the shared DSH locale state', async () => {
  const source = await readFile(clientPath, 'utf8')
  assert.match(source, /function useLwbCopy\(\) \{[\s\S]*?useObservable\(services\?\.locale, \{ active: 'zh' \}\)[\s\S]*?locale\.active === 'en' \? LWB_COPY\.en : LWB_COPY\.zh/u)
  assert.match(source, /en: \{[\s\S]*?conversation: 'Conversation', packs: 'Capability Packs', settings: 'Settings'/u)

  for (const component of ['ConversationOverlay', 'LwbSidebar', 'SettingsPage', 'WorkbenchOverlay']) {
    const start = source.indexOf(`function ${component}(`)
    const end = source.indexOf('\n    function ', start + 1)
    assert.ok(start >= 0 && end > start, `${component} must be defined as a standalone component`)
    assert.match(source.slice(start, end), /const copy = useLwbCopy\(\);/u, `${component} must react to locale changes`)
  }
})

test('capability packs switch browser entries in place without reloading the page', async () => {
  const source = await readFile(clientPath, 'utf8')
  assert.match(source, /class LwbPackClientRuntime/u)
  assert.match(source, /await this\.modules\.entries\.sync\(response\.value\);/u)
  assert.match(source, /getSnapshot\(\)\.failures/u)
  assert.doesNotMatch(source, /loadBundleScript|this\.loader\.create|this\.modules\.invalidate/u)
  assert.match(source, /await refreshPackCatalog\(\{ retain: true \}\);/u)
  assert.doesNotMatch(source, /window\.location\.reload\(/u)
})

test('retained catalog refresh keeps current marketplace cards visible during a pack switch', async () => {
  const source = await readFile(clientPath, 'utf8')
  const start = source.indexOf('async function refreshPackCatalog(options = {})')
  const end = source.indexOf('\n    class LwbPackClientRegistry', start)
  assert.ok(start >= 0 && end > start, 'client must define the retained catalog refresh')
  const refresh = source.slice(start, end)
  assert.match(refresh, /const retain = options\.retain === true;/u)
  assert.match(refresh, /if \(!retain\) \{[\s\S]*phase: 'pending'/u)
  assert.match(refresh, /if \(retain\) \{[\s\S]*phase: 'ready', packs: packCatalog\.packs/u)
})

test('capability routes carry the current pack and menu identity into shell chrome', async () => {
  const source = await readFile(clientPath, 'utf8')
  assert.match(source, /function pageChrome\(page, selected, copy = currentLwbCopy\(\)\) \{[\s\S]*?title: selected\.pack\.name,[\s\S]*?hint: selected\.menu\.label,[\s\S]*?intro: selected\.pack\.description \|\| copy\.capabilityHint,[\s\S]*?ariaLabel: `\$\{selected\.pack\.name\} · \$\{selected\.menu\.label\}`/u)

  const start = source.indexOf('function WorkbenchOverlay({ renderSlot, renderFactorySlot, SessionProvider, useSessions, useWorkspaces })')
  const end = source.indexOf('\n    function apply(ctx)', start)
  assert.ok(start >= 0 && end > start, 'workbench overlay must remain a standalone component')
  const overlay = source.slice(start, end)
  assert.match(overlay, /const catalog = usePackCatalog\(\);/u)
  assert.match(overlay, /const selected = state\.page === 'capability' \? capabilityAtRoute\(catalog\.packs, state\.capabilityPage\) : undefined;/u)
  assert.match(overlay, /const chrome = pageChrome\(state\.page, selected, copy\);/u)
  assert.match(overlay, /'aria-label': chrome\.ariaLabel/u)
  assert.match(overlay, /h\('b', null, chrome\.title\), h\('span', null, chrome\.hint\)/u)
  assert.match(overlay, /h\('h1', null, chrome\.title\), h\('p', null, chrome\.intro\)/u)
})

test('loaded capability menus stay nested inside independently collapsible pack groups', async () => {
  const source = await readFile(clientPath, 'utf8')
  const start = source.indexOf('function LwbSidebar({ collapsed, width })')
  const end = source.indexOf('\n    async function packOperation(', start)
  assert.ok(start >= 0 && end > start, 'client must define the grouped sidebar')
  const sidebar = source.slice(start, end)

  assert.match(sidebar, /const \[expandedPacks, setExpandedPacks\] = React\.useState/u)
  assert.match(sidebar, /className: 'lwb-cap-group'/u)
  assert.match(sidebar, /className: 'lwb-cap-toggle'/u)
  assert.match(sidebar, /'aria-expanded': wide \? expanded : flyout\?\.id === pack\.id/u)
  assert.match(sidebar, /className: 'lwb-cap-menu' \}, pack\.menus\.map/u)
  assert.doesNotMatch(sidebar, /packs\.flatMap/u)
  // A reload must show the same open groups, and neither a pending catalog nor a
  // catalog refresh may reopen a group the user closed by hand.
  assert.match(sidebar, /const navPreference = React\.useRef\(readNavPreference\(\)\);/u)
  assert.match(sidebar, /writeNavPreference\(expandedPacks\);/u)
  assert.match(sidebar, /if \(catalog\.phase !== 'ready'\) return;/u)
  assert.match(sidebar, /const revealActive = Boolean\(activePack\) && revealedPackId\.current === undefined/u)
  assert.doesNotMatch(sidebar, /if \(activePackId && current\.has\(activePackId\)\) next\.add\(activePackId\);/u)
})

test('marketplace pins the production spoken-video pack to the first card', async () => {
  const source = await readFile(clientPath, 'utf8')
  const start = source.indexOf('function orderMarketplacePacks(packs)')
  const end = source.indexOf('\n    function PacksPage()', start)
  assert.ok(start >= 0 && end > start, 'client must define marketplace ordering')
  const orderMarketplacePacks = runInNewContext(`${source.slice(start, end)}; orderMarketplacePacks`)
  const input = [{ id: 'demo-a' }, { id: 'spoken-video' }, { id: 'demo-b' }]

  assert.deepEqual(Array.from(orderMarketplacePacks(input), (pack) => pack.id), ['spoken-video', 'demo-a', 'demo-b'])
  assert.deepEqual(input.map((pack) => pack.id), ['demo-a', 'spoken-video', 'demo-b'], 'ordering must not mutate the catalog snapshot')
  assert.match(source, /const packs = orderMarketplacePacks\(market\.packs\);/u)
})

test('capability pages use the available workbench canvas', async () => {
  const source = await readFile(clientPath, 'utf8')
  assert.match(source, /\.lwb-page-capability\s*\{\s*width:100%;\s*max-width:none;/u)
  assert.match(source, /state\.page === 'capability' \? 'lwb-page lwb-page-capability' : 'lwb-page'/u)
})

test('new conversation delegates workspace selection to the DSH navigation service', async () => {
  const source = await readFile(clientPath, 'utf8')
  const start = source.indexOf('function createConversation(workspaceId)')
  const end = source.indexOf('\n    /**\n     * Bind one root selector Hook', start)
  assert.ok(start >= 0 && end > start, 'client must define the conversation creation action')

  const action = source.slice(start, end)
  assert.match(action, /typeof services\?\.uiWorkspace\?\.startSession !== 'function'/u)
  assert.match(action, /services\.uiWorkspace\.startSession\(workspaceId\);/u)
  assert.doesNotMatch(action, /resolveWorkspaceForNewSession/u)
  assert.doesNotMatch(action, /sessions\?\.create/u)
  // The official-shaped New Session control lives in this column. Upstream
  // hard-codes it in the sidebar shell it owns, so it cannot be borrowed
  // through a seat; the action is the official startSession navigation.
  assert.match(source, /className: 'lwb-conversation-new'/u)
  assert.match(source, /copy\.newSessionLabel/u)
  assert.match(source, /onClick: \(\) => createConversation\(\),/u)
  // It is usable from the first frame, exactly as the official control is.
  assert.doesNotMatch(source, /disabled: !internal/u)
})

test('history and fork navigation open sessions through the DSH workspace service', async () => {
  const source = await readFile(clientPath, 'utf8')
  const showStart = source.indexOf('function showConversation(sessionId)')
  const showEnd = source.indexOf('\n    const css =', showStart)
  assert.ok(showStart >= 0 && showEnd > showStart, 'client must define the history navigation action')
  const showConversation = source.slice(showStart, showEnd)
  assert.match(showConversation, /services\?\.uiWorkspace\?\.openSession\?\.\(sessionId\)/u)
  assert.doesNotMatch(showConversation, /sessions\?\.open/u)
})

test('the conversation module hosts the official Workspace browser', async () => {
  const source = await readFile(clientPath, 'utf8')
  const start = source.indexOf('function ConversationOverlay({ renderSlot, useSessions, useWorkspaces, usePanelInfo })')
  const end = source.indexOf('\n    function LwbRuntimeSettingsTrigger', start)
  assert.ok(start >= 0 && end > start, 'client must define the conversation module')
  const overlay = source.slice(start, end)

  // The column renders the official browsing region instead of a private list.
  assert.match(overlay, /renderSlot\('sidebar\.workspaces', Object\.assign\(/u)
  assert.match(overlay, /\{ wide: true, expandSidebar: \(\) => \{\} \}/u)
  assert.doesNotMatch(overlay, /lwb-session-row|lwb-workspace-row|lwb-conversation-search/u)
  // It waits for the ownership index rather than letting pack rows flash in.
  assert.match(overlay, /copy\.readingWorkspaces/u)

  // Owner props win in the renderer's merge order, which is how a filtered
  // Session and Workspace view reaches the official browser.
  assert.match(overlay, /useSessions: seatUseSessions/u)
  assert.match(overlay, /useWorkspaces: seatUseWorkspaces/u)
  assert.match(source, /function projectedHook\(hook, project\)/u)
  assert.match(source, /function projectSessionList\(list, isPackSession\)/u)
  assert.match(source, /function projectWorkspaceList\(snapshot, isPackWorkspace, isPackSession\)/u)

  // LWB declares the seat because this composition disables upstream ui-sidebar,
  // and the browser owns the directory-flow hole it declares underneath.
  assert.match(source, /'sidebar\.workspaces': \{ kind: 'single', scope: 'root' \}/u)
  assert.doesNotMatch(source, /'sidebar\.workspaces\.directoryFlow': \{ kind: 'single', scope: 'root' \}/u)

  // The same column carries the official global panel rows: the seat is
  // declared on this entry, the glyph is the registrant's component, and the
  // label and selection state come from the official registry and layout.
  assert.match(source, /'sidebar\.panellist': \{ kind: 'list', scope: 'root' \}/u)
  assert.match(overlay, /renderSlot\('sidebar\.panellist', \{ size: 16, active \}, \{ only: panel\.id \}\)/u)
  assert.match(overlay, /selectConversationPanel\(panel\.id\)/u)
  assert.match(source, /function selectConversationPanel\(panelId\)/u)
  assert.match(source, /if \(panelId !== null && !conversationPanelRegistered\(panelId\)\) return;/u)
  assert.match(source, /ctx\.slots\.subscribe\('sidebar\.panellist', syncConversationPanels\)/u)
  assert.match(source, /function resolvePanelLabel\(label\) \{ return typeof label === 'function' \? label\(\) : label; \}/u)
  assert.match(source, /resolvePanelLabel\(entry\?\.options\?\.label\)/u)
})

test('capability packs render their own Sessions without touching the conversation module', async () => {
  const source = await readFile(clientPath, 'utf8')
  // A pack page embeds the official conversation content for one of its own
  // Sessions, and the frame's current Session only moves when the pack focuses
  // a card. The shell's conversation page keeps rendering the official surfaces.
  assert.ok(source.includes('function EmbeddedConversationHost({ sessionId, SessionProvider, renderFactorySlot })'), 'the host must offer an embedded conversation')
  assert.ok(source.includes("services.sessions.retain(sessionId, { source: 'gateway', signal: controller.signal })"), 'an embedded conversation retains its own Session with cancellation')
  assert.ok(source.includes("renderFactorySlot('conversation.content', {"), 'it renders the official conversation factory')
  assert.ok(source.includes("variant: 'embedded', phase: 'active', hero: false"))
  assert.ok(source.includes("renderSlot('conversation.session', { view: 'chat' })"))
  assert.ok(source.includes("'lwb.embedded.conversation': { kind: 'single', scope: 'session' }"), 'the seat declaration is what supplies the Session scope')
  assert.ok(source.includes('h(CapabilityPage, { renderConversation, focusSession })'), 'both host faces reach the pack page')
  assert.doesNotMatch(source, /openSessionSurface|sessionSurface|selectSurfaceSession/u)
  assert.doesNotMatch(source, /installEmbeddedSidebarRuntime|lwb\.embedded\.rightbar/u)
  assert.doesNotMatch(source, /claimComposerSurface|editor\.setRootElement|editor\.registerRootListener/u, 'the host must not compete with official composer roots')
  assert.doesNotMatch(source, /lwb-pack-stage|holdPackStage|releasePackStage/u, 'pack mode must not change the main panel selection')
})

test('an embedded conversation carries its own right-Sidebar control', async () => {
  const source = await readFile(clientPath, 'utf8')
  // The official expand button lives in the frame's main-panel header, which an
  // embedded conversation cannot render. The host restores that affordance with
  // official state and the official action.
  assert.ok(source.includes('function EmbeddedConversationHead({ sessionId })'), 'every embedded conversation gets the control')
  assert.ok(source.includes('h(EmbeddedConversationHead, { sessionId }),'), 'the strip renders inside the embedded shell')
  assert.ok(source.includes("h('strong', { className: 'lwb-embedded-conversation-title'"), 'the strip names the Session')
  assert.ok(source.includes('lwb-embedded-rightbar-toggle'), 'the toggle is host chrome, not a copied official button')
  assert.ok(source.includes('panelControlState(mounted, sessionId, open)'), 'state is the rendered column, for this card alone')
  assert.ok(source.includes('function subscribePanelOpen(listener)') && source.includes("attributeFilter: ['data-sidebar-right-open']"), 'the column marker is observed, not guessed from the service')
  assert.ok(source.includes('sidebarRight.toggleExpanded()'), 'the action is the official toggle')
  assert.ok(source.includes('function toggleEmbeddedRightbar(sessionId, expanded)') && source.includes('focusSession(sessionId, { keepExpanded: true });'), 'the card is focused before setting the requested panel state')
  assert.ok(source.includes('if (mounted() === sessionId) {'), 'a wait that ran out never toggles another Session')
  assert.ok(source.includes('openPackResource(sidebarRight, openResource, sessionId, address, options);'), 'an official open is routed through the surface-aware route')
  assert.ok(source.includes('PACK_SURFACE_PENDING'), 'a surface the seat has not minted yet is waited for, and a wiring mistake is not')
  assert.ok(source.includes('const mounted = () => sidebarRight.mounted?.getSnapshot?.();'), 'the toggle waits for the mounted seat to publish the focused Session')
  assert.ok(source.includes("sidebarRight: ctx.get('sidebarRight'), shortcuts: ctx.get('shortcuts')"), 'both services are optional lookups')
})

test('the official right Sidebar follows the pack card in use', async () => {
  const source = await readFile(clientPath, 'utf8')
  // The right Sidebar is the frame's own column and serves its current Session,
  // so a pack page only focuses the card in use and stops covering the column.
  assert.ok(source.includes('function focusSession(sessionId, options)'), 'the pack asks the host to focus a Session')
  assert.ok(source.includes('services?.uiWorkspace?.openSession?.(sessionId)'), 'focusing is official navigation')
  assert.ok(source.includes('function armPackSession(sessionId)') && source.includes('function releasePackSession(sessionId)'))
  assert.ok(source.includes('if (count === 0 && !packSessionArmed()) {'), 'the previous Session is captured when the mode arms')
  // One surface, one open panel: a card switch closes the panel it leaves, and
  // a plainly focused card never inherits a remembered expansion.
  assert.ok(source.includes('function collapsePackPanel()'), 'the host can close the panel through the official toggle')
  assert.ok(source.includes('pendingPanelCollapse = { sessionId, epoch: packPanelEpoch };'), 'switching cards owes a collapse instead of performing one')
  assert.ok(source.includes('function settlePanelGesture()'), 'the owed collapse starts once the gesture that focused the card ends')
  assert.ok(source.includes("document.addEventListener('click', settlePanelGesture, false)"), 'the gesture\'s own click settles it, after any official open it carried')
  assert.ok(source.includes('if (epoch !== packPanelEpoch) return;'), 'a queued collapse never closes a panel a later gesture asked for')
  assert.ok(source.includes('function collapseWhenSettled(sessionId, epoch)'), 'a plainly focused card is collapsed once its seat mounts')
  assert.ok(source.includes('focusSession(sessionId, { keepExpanded: true });'), 'panel gestures keep their target expanded')
  assert.ok(source.includes('function onScreenPanel()') && source.includes("panel.closest('[hidden]') === null"), 'the column read is the panel in view, not a hidden one a card left behind')
  assert.ok(source.includes("frameObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] })"), 'a card switch re-binds the measurement without touching the tree')
  assert.ok(source.includes('--lwb-rightbar-inset'), 'the overlay yields the column by width')
  assert.ok(source.includes('sidebarRight.mounted?.getSnapshot?.()'), 'an official open waits for the mounted seat to publish the focused Session')
  assert.ok(source.includes('restoreOpenResource?.();'))
  // No part of the Sidebar or its previews is re-drawn.
  assert.doesNotMatch(source, /renderArtifacts|ArtifactPanel|artifactRequests|allow-scripts/u)
})

test('the hidden-column reopen control outranks the frame overlay layer', async () => {
  // The macOS desktop collapses the sidebar column to zero width, and every LWB
  // page surface then starts at the window's left edge inside the frame's
  // overlay layer. A reopen control below that layer is painted over and cannot
  // be clicked, which is the desktop-only regression this ordering prevents.
  const source = await readFile(clientPath, 'utf8')
  const frame = await readFile(new URL('../../../vendor/deepseek-harness/packages/client/ui-layout/src/client/AppFrame.module.css', import.meta.url), 'utf8')
  const control = Number(source.match(/\.lwb-desktop-expand \{[^}]*z-index:(\d+)/u)?.[1])
  const overlayLayer = Number(frame.match(/\.overlayLayer \{[^}]*z-index: (\d+)/u)?.[1])
  assert.ok(Number.isFinite(control) && Number.isFinite(overlayLayer), 'both layers must declare a z-index')
  assert.ok(control > overlayLayer, `the reopen control (${control}) must outrank the shell overlay layer (${overlayLayer})`)
})

/**
 * Window drag-region ownership for the macOS desktop shell.
 *
 * The shell declares `-webkit-app-region: drag` exactly once — ui-web base.css,
 * for any element marked `data-window-drag` — and Electron composes those boxes
 * by geometry in DOM order, last box wins. A chrome row nobody marks is dead,
 * and a surface covering a marked row keeps dragging the window instead of
 * taking the press. The ui-theme app-region gate pairs each upstream row with
 * its mark; this gate does the same for the rows LWB owns, because LWB owns the
 * frame's sidebar column and both overlay surfaces while the upstream package
 * that marked the sidebar's rows is disabled for this composition.
 */
test('every macOS desktop chrome row LWB owns marks itself for the window drag', async () => {
  const source = await readFile(clientPath, 'utf8')
  const shell = await readFile(new URL('../../../vendor/deepseek-harness/packages/client/web/src/base.css', import.meta.url), 'utf8')
  const frame = await readFile(new URL('../../../vendor/deepseek-harness/packages/client/ui-layout/src/client/AppFrame.module.css', import.meta.url), 'utf8')
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

  // The one shell rule, and the frame's own macOS side of the contract: nothing
  // else can make a box draggable, so a missing mark is a dead band.
  assert.match(shell, /html\[data-platform='darwin'\] \[data-window-drag\] \{\s*-webkit-app-region: drag;\s*\}/u)
  assert.match(frame, /The frame declares no window drag of its own[\s\S]*?The Windows\s*\n\s*caption row above is the other platform's chrome and stays\./u)

  // Why LWB has to own these rows: the package that marked the sidebar column's
  // own chrome rows is disabled, and the sidebar slot is LWB's.
  assert.match(patch, /- id: ui-sidebar\s*\n\s*disabled: true/u)
  assert.match(source, /ctx\.slots\.inject\('sidebar', \(\) => ctx\.slots\.register\(\{/u)

  // Every row LWB renders into chrome carries the mark in markup, and the mark
  // is inert outside darwin because the sheet scopes the rule.
  for (const row of ['lwb-sidebar-chrome', 'lwb-conversation-pane-head', 'lwb-conversation-gutter', 'lwb-mobile-chrome', 'lwb-overlay-head']) {
    assert.match(source, new RegExp(`className: '${row}', 'data-window-drag'`, 'u'), `${row} must mark itself as a window drag row`)
  }
  assert.match(source, /\.lwb-sidebar-chrome,\.lwb-conversation-gutter,\.lwb-mobile-chrome \{ display:none; \}/u, 'the bands stay out of the layout outside darwin')

  // The sidebar band is the column's own clearance: the traffic-light band is the
  // row rather than padding, so geometry and clearance cannot drift apart. It
  // spans past the aside's inline padding and it must not shrink — as a flex item
  // the default flex-shrink would collapse it to nothing in a short window,
  // which is a drag-region hole rather than a cosmetic bug.
  assert.match(source, /html\[data-platform='darwin'\] \.lwb-sidebar \{ padding-top:0; \}/u)
  assert.match(source, /html\[data-platform='darwin'\] \.lwb-sidebar-chrome \{[^}]*flex:none;[^}]*height:var\(--lwb-desktop-chrome-height,48px\);[^}]*margin-inline:-10px; \}/u)

  // The conversation column leaves a deliberate gap to the session column, and
  // the band covering that gap is placed from the same two variables as the
  // offset that creates it, so the two cannot disagree.
  assert.match(source, /padding-left:calc\(var\(--lwb-conversation-panel-width,264px\) \+ var\(--lwb-conversation-gutter,16px\)\)/u)
  assert.match(source, /html\[data-platform='darwin'\] \.lwb-conversation-gutter \{[^}]*left:var\(--lwb-conversation-panel-width,264px\);[^}]*width:calc\(var\(--lwb-conversation-gutter,16px\) \+ 1px\);[^}]*height:var\(--lwb-desktop-chrome-height,48px\); \}/u)

  // Narrow desktop turns LWB's column into an off-canvas drawer, so the window's
  // leading edge needs a band of its own. It is rendered ahead of the mobile
  // triggers and stops where the conversation column begins: covering that column
  // would override the controls it marks ahead of this band in document order.
  assert.match(source, /@media \(max-width:680px\) \{\s*html\[data-platform='darwin'\] \.lwb-mobile-chrome \{[^}]*left:0;[^}]*width:var\(--lwb-conversation-panel-width,264px\);[^}]*height:var\(--lwb-desktop-chrome-height,48px\); \}\s*\}/u)
  assert.match(source, /h\('div', \{ className: 'lwb-mobile-chrome', 'data-window-drag': '', 'aria-hidden': 'true' \}\),\s*\n\s*state\.mobileNavOpen && h\('button'/u)

  // LWB declares no drag region of its own: the shell rule is the only drag
  // source, and LWB's sole app-region declaration subtracts a control.
  const css = source.match(/const css = `([\s\S]*?)`;/u)?.[1]
  assert.ok(css, 'client must define its product CSS')
  const declarations = [...css.replace(/\/\*[\s\S]*?\*\//gu, '').matchAll(/-webkit-app-region:\s*([A-Za-z-]+)/gu)].map((match) => match[1])
  assert.deepEqual(declarations, ['no-drag'], 'LWB may only opt controls out of a drag row, never declare one')
})
