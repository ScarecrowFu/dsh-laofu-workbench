import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  LWB_RETIRED_TIER_MODELS,
  migrateLwbModelSelection,
  rewriteAgentDefaultModelPatch,
} from '../profile-setup.mjs'

const PATCH = [
  '# Your patch layer for this dsh profile.',
  '- id: locale',
  '  name: "@deepseek-ai/dsh-client-locale"',
  '  config:',
  '    preference: zh',
  '- id: agent-default-model',
  '  name: "@deepseek-ai/dsh-agent-default-model"',
  '  config:',
  '    provider: lwb',
  '    model: lwb-balanced',
  '',
].join('\n')

/** Windows has no POSIX permission bits: `stat().mode` is always 0o666 there. */
const POSIX_MODES = process.platform !== 'win32'

test('retired tier ids rewrite only the LWB default model entry', () => {
  const migrated = rewriteAgentDefaultModelPatch(PATCH)
  assert.ok(migrated.includes('    model: deepseek-v4.1-flash'))
  assert.ok(!migrated.includes('lwb-balanced'))
  // Everything else in the layer is preserved byte for byte.
  assert.ok(migrated.startsWith('# Your patch layer for this dsh profile.\n'))
  assert.ok(migrated.includes('    preference: zh\n'))
  assert.deepEqual(Object.keys(LWB_RETIRED_TIER_MODELS), ['lwb-fast', 'lwb-balanced', 'lwb-ultimate'])
})

test('a quoted value keeps its quoting, and a non-LWB provider is never touched', () => {
  const quoted = PATCH.replace('model: lwb-balanced', 'model: "lwb-ultimate"')
  assert.ok(rewriteAgentDefaultModelPatch(quoted).includes('model: "deepseek-v4.1-flash"'))
  const other = PATCH.replace('provider: lwb', 'provider: bailian')
  assert.equal(rewriteAgentDefaultModelPatch(other), undefined)
  const unrelated = PATCH.replace('model: lwb-balanced', 'model: kimi-k3')
  assert.equal(rewriteAgentDefaultModelPatch(unrelated), undefined)
  assert.equal(rewriteAgentDefaultModelPatch(''), undefined)
})

test('profile preparation rewrites saved selections once and stays idempotent', async t => {
  const home = await mkdtemp(join(tmpdir(), 'lwb-model-migration-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const patchFile = join(home, 'cordis.patch.yml')
  const settingsDir = join(home, 'settings')
  const taskModelFile = join(settingsDir, 'task-model.json')
  await mkdir(settingsDir, { recursive: true })
  await writeFile(patchFile, PATCH)
  // Mirrors the pack settings store, which creates its file 0600.
  await writeFile(taskModelFile, `${JSON.stringify({ mode: 'specified', provider: 'lwb', model: 'lwb-ultimate' }, null, 2)}\n`, { mode: 0o600 })

  const applied = await migrateLwbModelSelection({ profileHome: home, productHome: home })
  assert.deepEqual(applied, ['agent-default-model', 'task-model'])
  assert.ok((await readFile(patchFile, 'utf8')).includes('    model: deepseek-v4.1-flash'))
  const stored = JSON.parse(await readFile(taskModelFile, 'utf8'))
  assert.deepEqual(stored, { mode: 'specified', provider: 'lwb', model: 'deepseek-v4.1-flash' })
  // The rewrite keeps the pack settings store's own permissions, where the
  // platform has any. The idempotency assertions below still run everywhere.
  if (POSIX_MODES) assert.equal((await stat(taskModelFile)).mode & 0o777, 0o600)
  // A second launch finds nothing left to change.
  assert.deepEqual(await migrateLwbModelSelection({ profileHome: home, productHome: home }), [])
})

test('a missing or unrelated task-model selection is left alone', async t => {
  const home = await mkdtemp(join(tmpdir(), 'lwb-model-migration-noop-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  assert.deepEqual(await migrateLwbModelSelection({ profileHome: home, productHome: home }), [])
  const settingsDir = join(home, 'settings')
  await mkdir(settingsDir, { recursive: true })
  for (const stored of [
    { mode: 'follow-dsh' },
    { mode: 'specified', provider: 'bailian', model: 'lwb-fast' },
    { mode: 'specified', provider: 'lwb', model: 'kimi-k3' },
  ]) {
    await writeFile(join(settingsDir, 'task-model.json'), `${JSON.stringify(stored)}\n`)
    assert.deepEqual(await migrateLwbModelSelection({ profileHome: home, productHome: home }), [])
  }
})