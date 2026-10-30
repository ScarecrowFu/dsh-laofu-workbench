import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, rm, writeFile, chmod, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dedicatedCommand, findChromium, findEgo } from '../pack-browser.mjs'

test('Chrome or Edge is found where each platform installs it, and only there', async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'lwb-browser-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.equal(findChromium({ platform: 'linux', env: { PATH: root } }), null)
  await writeFile(join(root, 'chromium'), '')
  assert.deepEqual(findChromium({ platform: 'linux', env: { PATH: root } }), { name: 'chromium', executable: join(root, 'chromium') })
  const program = join(root, 'pf')
  await mkdir(join(program, 'Microsoft', 'Edge', 'Application'), { recursive: true })
  await writeFile(join(program, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), '')
  assert.equal(findChromium({ platform: 'win32', env: { ProgramFiles: program } }).name, 'Microsoft Edge')
})

test('ego-browser is found on PATH, the way onboarding registers it', async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'lwb-ego-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const before = findEgo({ PATH: root })
  await writeFile(join(root, 'ego-browser'), '#!/bin/sh\n')
  await chmod(join(root, 'ego-browser'), 0o755)
  assert.equal(findEgo({ PATH: root }), join(root, 'ego-browser'))
  // Without it on PATH the answer is whatever ~/.local/bin holds, never the empty dir.
  assert.notEqual(before, join(root, 'ego-browser'))
})

test('the command a character runs names this node, this runner and the profile, quoted', () => {
  const command = dedicatedCommand("/tmp/it's here")
  assert.ok(command.includes(process.execPath))
  assert.match(command, /pack-browser\.mjs' run --dir '\/tmp\/it'\\''s here'$/u)
})
