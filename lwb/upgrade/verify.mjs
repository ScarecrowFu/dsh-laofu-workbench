import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { assertUpstream, DSH_ROOT, UPSTREAM } from '../upstream.mjs'
import { dshPackageDirectory } from '../dsh-bundle/dsh-adapter/package-paths.mjs'
import { applyLwbEntryPolicy } from '../desktop/entry-policy.mjs'
const result = assertUpstream()
// Inspect the exact built exports consumed by both product clients. Renamed
// upstream primitives must fail upgrade acceptance before opening a window.
const primitives = readFileSync(join(dshPackageDirectory('@deepseek-ai/dsh-client-ui-primitives'), 'src/index.ts'), 'utf8')
const icons = readFileSync(join(dshPackageDirectory('@deepseek-ai/dsh-client-ui-primitives'), 'src/icons/index.tsx'), 'utf8')
for (const file of ['../dsh-bundle/client.js', '../packs/spoken-video/client.js']) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  const names = source.match(/const \{ ([^}]+) \} = require\('@deepseek-ai\/dsh-client-ui-primitives'\)/u)?.[1].split(', ').map(name => name.trim()) ?? []
  for (const name of names) if (!new RegExp(`\\b${name}\\b`, 'u').test(primitives + icons)) throw new Error(`Missing DSH client export: ${name}`)
}
for (const path of ['apps/cli/lib/bin.js', 'apps/desktop/lib/main.js']) {
  if (!existsSync(join(DSH_ROOT, path))) throw new Error(`Missing official build: ${path}; run npm run setup`)
}
// The conversation module hosts the official Workspace browser instead of
// drawing its own history list. Both halves of that seam are version-sensitive:
// the seat must remain the one ui-workspace fills, and owner props must still
// win in the renderer's merge order — that override is how pack Sessions stay
// out of the official list without patching upstream.
const workspaceClient = readFileSync(join(dshPackageDirectory('@deepseek-ai/dsh-client-ui-workspace'), 'src/client/index.ts'), 'utf8')
if (!/ctx\.slots\.inject\('sidebar\.workspaces',/u.test(workspaceClient)) {
  throw new Error('ui-workspace no longer fills the sidebar.workspaces seat; the conversation module would render an empty column')
}
const rendererSlots = readFileSync(join(dshPackageDirectory('@deepseek-ai/dsh-client-ui-renderer'), 'src/client/scoped-slots.tsx'), 'utf8')
if (!/\{\.\.\.slotInjected\.props\} \{\.\.\.contextual\} \{\.\.\.ownerProps\}/u.test(rendererSlots)) {
  throw new Error('owner props no longer override entry props; the conversation filter cannot reach the official Workspace browser')
}
// renderSlot authorization reads the RENDERING entry's own children table, so a
// seat must be declared by the registration whose component renders it. Losing
// this check turns a misplaced declaration into a silently blanked overlay
// instead of a load error.
if (!/entry\.children\?\.\[key\]/u.test(rendererSlots)) {
  throw new Error('renderSlot authorization no longer reads the rendering entry children table; re-derive where the sidebar.workspaces seat must be declared')
}
// Pack Sessions are hidden by ownership id AND by their directory, because a
// pack can create a Session after the ownership index was read. The directory
// rule reads the Session list summary's `cwd`; losing that projection degrades
// it to a silent no-op and pack Sessions reappear in ordinary history.
const sessionService = readFileSync(join(dshPackageDirectory('@deepseek-ai/dsh-api-session-controller'), 'src/client/sessions/service.ts'), 'utf8')
if (!/\.\.\.\(entry\.cwd !== undefined \? \{ cwd: entry\.cwd \} : \{\}\)/u.test(sessionService)) {
  throw new Error('the client Session list no longer projects cwd; the pack-Session directory rule cannot identify a Session created after the ownership read')
}
// The conversation column also carries the official global panel rows. The
// Plugins entry must stay the list seat's occupant, its management page must
// stay an official `main` panel, and the main column must keep falling back to
// the Conversation — the column dispatches the selected id and relies on that
// fallback to return.
const pluginManagerClient = readFileSync(join(dshPackageDirectory('@deepseek-ai/dsh-client-ui-plugin-manager'), 'src/client/index.ts'), 'utf8')
if (!/ctx\.slots\.inject\('sidebar\.panellist',/u.test(pluginManagerClient)) {
  throw new Error('ui-plugin-manager no longer fills the sidebar.panellist seat; the conversation column would lose the Plugins row')
}
if (!/PANEL_ID = 'plugins'/u.test(pluginManagerClient) || !/ctx\.slots\.inject\('main',/u.test(pluginManagerClient)) {
  throw new Error('ui-plugin-manager no longer registers the plugins main panel; the Plugins row could not open its page')
}
const appFrame = readFileSync(join(dshPackageDirectory('@deepseek-ai/dsh-client-ui-layout'), 'src/client/AppFrame.tsx'), 'utf8')
if (!/renderSlot\('main', \{\}, \{ entryKey: panelId \?\? 'conversation' \}\)/u.test(appFrame)) {
  throw new Error('the main column no longer falls back to the conversation entry; a selected panel would replace the Conversation permanently')
}
// The conversation module renders the official global panel rows, whose selection
// state and click both ride this service. Both halves are version-sensitive: a
// row's highlight reads the published selection, and its click must reach the
// layout controller as a method call.
const layoutService = readFileSync(join(dshPackageDirectory('@deepseek-ai/dsh-client-ui-layout'), 'src/client/service.ts'), 'utf8')
if (!/readonly panelInfo: HostObservable<PanelInfo>/u.test(layoutService) || !/selectPanel\(panelId: MainPanelId \| null\): void/u.test(layoutService)) {
  throw new Error('ui-layout no longer publishes its central-panel selection; the conversation module’s panel rows could neither highlight nor open a panel')
}
const layoutIndex = readFileSync(join(dshPackageDirectory('@deepseek-ai/dsh-client-ui-layout'), 'src/client/index.ts'), 'utf8')
if (!/reflect\.provide\('layout', layout\)/u.test(layoutIndex)) {
  throw new Error('the layout selection is no longer provided as the `layout` service; the workbench reads it by that name')
}
// Pack mode keeps the Conversation panel selected for the official right Sidebar,
// while replacing only its covered main.conversation content through the registry.
const sidebarRightIndex = readFileSync(join(dshPackageDirectory('@deepseek-ai/dsh-client-ui-sidebar-right'), 'src/client/index.ts'), 'utf8')
if (!/show\(layout\.panelInfo\.getSnapshot\(\)\.activePanelId === null \? selected\?\.sessionId : undefined\)/u.test(sidebarRightIndex)) {
  throw new Error('ui-sidebar-right no longer ties the on-screen Session to the Conversation filling the main column; the pack-Session surface must be re-derived')
}
const conversationApply = readFileSync(join(dshPackageDirectory('@deepseek-ai/dsh-client-ui-conversation'), 'src/client/apply.ts'), 'utf8')
if (!/name: 'main\.conversation'/u.test(conversationApply)) {
  throw new Error('ui-conversation no longer registers main.conversation; pack mode must be re-derived to avoid duplicate composers')
}
applyLwbEntryPolicy(readFileSync(join(DSH_ROOT, 'apps/desktop/lib/main.js'), 'utf8'))

// Exercise the built server surfaces the capability-pack execution adapter
// calls. A DSH rename must fail HERE, at upgrade acceptance, instead of on the
// first generation request with a misleading "no subagent seam" error.
async function builtModule(name) {
  const entry = join(dshPackageDirectory(name), 'lib', 'index.js')
  if (!existsSync(entry)) throw new Error(`Missing official build entry for ${name}: ${entry}; run npm run setup`)
  return import(pathToFileURL(entry).href)
}
function requireMethods(label, value, methods) {
  if (!value) throw new Error(`${label} is not exported by the locked DSH build`)
  for (const method of methods) {
    if (typeof value[method] !== 'function') throw new Error(`${label} no longer exposes ${method}(); the LWB execution adapter must be re-derived`)
  }
}

const subagent = await builtModule('@deepseek-ai/dsh-subagent')
const subagentRuntime = subagent.SubagentRuntime
if (!subagentRuntime) throw new Error('@deepseek-ai/dsh-subagent no longer exports SubagentRuntime; the LWB structured executor cannot start a child')
if (typeof subagentRuntime.prototype.startActivation !== 'function' && typeof subagentRuntime.prototype.start !== 'function') {
  throw new Error('SubagentRuntime exposes neither startActivation() nor start(); update lwb/pack-sdk/dsh-execution.mjs and accept the new signature')
}

const agent = await builtModule('@deepseek-ai/dsh-agent')
requireMethods('AgentRegistry', agent.AgentRegistry?.prototype, ['create', 'get'])
const sessionController = await builtModule('@deepseek-ai/dsh-api-session-controller')
requireMethods('SessionController', sessionController.SessionController?.prototype, ['create', 'selectModel', 'prompt'])

// DSH 0.2.1 removed the public `Session.events` array. Multi-turn execution
// uses `session.seq` for turn boundaries and the session/event listener for
// turn records; keep the replacement surface asserted so a future rename fails
// here instead of throwing "reading 'length'" during video direction.
const sessionModule = await builtModule('@deepseek-ai/dsh-session')
const sessionClass = sessionModule.Session
if (!sessionClass) throw new Error('@deepseek-ai/dsh-session no longer exports Session; the LWB multi-turn executor cannot observe turns')
if (typeof sessionClass.prototype.snapshotEvents !== 'function') {
  throw new Error('Session no longer exposes snapshotEvents(); re-derive the LWB turn observation seam')
}
if (!Object.getOwnPropertyDescriptor(sessionClass.prototype, 'seq')?.get) {
  throw new Error('Session no longer exposes the `seq` getter; the LWB turn boundary must be re-derived')
}

// Session format v4 retired the catch-all `plugin` message source. Exercise
// the real row admission in both directions: LWB's producer-owned kind must be
// accepted, and the retired wrapper must still be rejected. This is the rule
// that failed a live video task with "format v4 message requires a
// producer-owned source kind".
const v4Format = await builtModule('@deepseek-ai/dsh-session-format-v3-to-v4')
if (typeof v4Format.assertV4RowAdmission !== 'function') {
  throw new Error('session format v3-to-v4 no longer exports assertV4RowAdmission(); the message-source gate must be re-derived')
}
const sourceRow = kind => ({ type: 'user/message', data: { source: { kind } } })
v4Format.assertV4RowAdmission(sourceRow('lwb'))
// A channel message reuses LWB's one producer kind and carries the ingress in
// the same object; the extra fields must stay admissible or inbound prompts
// would fail admission only at runtime.
v4Format.assertV4RowAdmission({ type: 'user/message', data: { source: { kind: 'lwb', channel: 'feishu', externalId: 'ou_1' } } })
// A channel message is the owner typing elsewhere, so it is stamped `user`
// with the ingress beside it — that is what makes the conversation surface show
// it as their own bubble. A pack's account of something that happened is
// DSH's `notice` form on LWB's own kind.
v4Format.assertV4RowAdmission({ type: 'user/message', data: { source: { kind: 'user', channel: 'feishu', externalId: 'ou_1', messageId: 'om_1' } } })
v4Format.assertV4RowAdmission({ type: 'user/message', data: { source: { kind: 'lwb', form: 'notice', summary: '任务汇报' } } })
let retiredSourceRejected = false
try {
  v4Format.assertV4RowAdmission(sourceRow('plugin'))
} catch (error) {
  retiredSourceRejected = /producer-owned source kind/u.test(String(error?.message))
}
if (!retiredSourceRejected) {
  throw new Error('session format v4 no longer rejects the retired `plugin` message source; the LWB source-kind adaptation must be re-derived')
}

// Agent turn-driving methods are on the implementation type, not an exported
// value; the locked build's declaration is the machine-readable contract.
const agentRuntimeTypes = readFileSync(join(dshPackageDirectory('@deepseek-ai/dsh-agent'), 'lib', 'types', 'runtime-types.d.ts'), 'utf8')
for (const signature of ['cancel(cause:', 'whenIdle():', 'followup(message:']) {
  if (!agentRuntimeTypes.includes(signature)) throw new Error(`Agent runtime no longer declares ${signature}; the LWB multi-turn executor must be re-derived`)
}
// Pack Sessions reinstall their prompt and tools on every Agent that
// publishes them, and report run/idle to the pack: both ride these events.
for (const signature of ["'agent/created'(", "'agent/status'(", 'inject(message:']) {
  if (!agentRuntimeTypes.includes(signature)) throw new Error(`Agent runtime no longer declares ${signature}; pack Session restoration must be re-derived`)
}
// 完全权限 for a pack Session is DSH's own preset of that name.
const permissionPresets = readFileSync(join(dshPackageDirectory('@deepseek-ai/dsh-permission-presets'), 'lib', 'index.js'), 'utf8')
if (!permissionPresets.includes('danger-full-access')) throw new Error('permission presets no longer ship danger-full-access; pack full access must be re-derived')
const scheduleTypes = readFileSync(join(dshPackageDirectory('@deepseek-ai/dsh-schedule'), 'lib', 'types', 'index.d.ts'), 'utf8')
for (const signature of ['create(sessionId:', 'list(request:', 'delete(request:', 'history(request:']) {
  if (!scheduleTypes.includes(signature)) throw new Error(`schedule service no longer declares ${signature}; pack schedules must be re-derived`)
}

const tools = await builtModule('@deepseek-ai/dsh-tools')
for (const name of ['assertObjectJsonSchema', 'defineTool']) {
  if (typeof tools[name] !== 'function') throw new Error(`@deepseek-ai/dsh-tools no longer exports ${name}; the capability-pack contract must be re-derived`)
}
const llm = await builtModule('@deepseek-ai/dsh-llm')
for (const name of ['createUserMessage', 'expandAssistantStream']) {
  if (typeof llm[name] !== 'function') throw new Error(`@deepseek-ai/dsh-llm no longer exports ${name}; the capability-pack execution adapter must be re-derived`)
}
const typert = await builtModule('@deepseek-ai/dsh-typert-protocol')
for (const name of ['Remote', 'TypertRemoteService']) {
  if (typeof typert[name] !== 'function') throw new Error(`@deepseek-ai/dsh-typert-protocol no longer exports ${name}; every pack gateway must be re-derived`)
}

// The `subagents` service is version-sensitive and belongs to the SDK adapter.
// A capability pack that binds to it directly would have to change on every DSH
// seam rename; keep that coupling in one reviewed module instead.
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const packSources = execFileSync('git', ['ls-files', 'lwb/packs/**/*.mjs'], { cwd: repoRoot, encoding: 'utf8' })
  .split('\n').map(line => line.trim()).filter(Boolean)
for (const file of packSources) {
  const source = readFileSync(join(repoRoot, file), 'utf8')
  if (/@deepseek-ai\/dsh-subagent/u.test(source) || /\bsubagents\.start(?:Activation)?\s*\(/u.test(source)) {
    throw new Error(`Capability pack ${file} binds directly to the version-sensitive subagents service; route it through @scitiger-ai/lwb-pack-sdk/execution`)
  }
}

console.log(`LWB upstream contract passed: ${UPSTREAM.tag} (${result.commit}); official source clean.`)
