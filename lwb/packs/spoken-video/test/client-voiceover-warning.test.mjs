import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const start = source.indexOf('    const FINISHED_CUT_STAGES = ')
const end = source.indexOf('\n    }', source.indexOf('function replacesFinishedCut(', start)) + 6
const replacesFinishedCut = vm.runInNewContext(`(() => { ${source.slice(start, end)}; return replacesFinishedCut; })()`)

// A new voiceover synced into a project invalidates video, QC and packaging,
// and the cut then disappears from the publish shelf with no message. The
// confirmation is the only place that can say so before it happens.
test('a new voiceover warns only when it would discard a finished cut', () => {
  const projects = [
    { id: 'cut', completedStages: ['topic', 'script', 'voiceover', 'subtitles', 'video', 'qc'] },
    { id: 'packaged', completedStages: ['script', 'voiceover', 'video', 'qc', 'packaging'] },
    { id: 'draft', completedStages: ['topic', 'script', 'voiceover', 'subtitles'] },
  ]
  assert.equal(replacesFinishedCut(projects, { projectId: 'cut' }), true)
  assert.equal(replacesFinishedCut(projects, { projectId: 'packaged' }), true)
  assert.equal(replacesFinishedCut(projects, { projectId: 'draft' }), false)
  // Manual text has no project to invalidate; an unknown id is not a warning.
  assert.equal(replacesFinishedCut(projects, null), false)
  assert.equal(replacesFinishedCut(projects, { title: '手动输入文稿' }), false)
  assert.equal(replacesFinishedCut(projects, { projectId: 'missing' }), false)
})

test('the voiceover confirmation uses that warning and turns into a danger action', () => {
  assert.match(source, /\$\{discardsCut \? '该项目已有成片：新配音同步到项目后，视频、质检和发布资料都会作废/u)
  assert.match(source, /confirm: discardsCut \? '仍然生成' : '确认生成', danger: discardsCut,/u)
})
