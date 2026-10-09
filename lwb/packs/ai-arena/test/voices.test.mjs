/**
 * 音色分配：选手按模型匹配、未命中错开通用音色；主持人有一条固定音色，两者互不共用。
 * 参考音频随包分发，缺文件必须在这里失败，而不是等到导出时才发现。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { GENERIC_VOICES, HOST_VOICE_KEY, VOICE_PROFILES, assignVoices, matchVoiceKey, voiceFile } from '../voices.mjs'

test('主持人音色随包分发：文件真实存在，且与选手音色不共用', () => {
  const file = voiceFile(HOST_VOICE_KEY)
  assert.match(file.path, /assets\/voices\/host\.mp3$/u)
  assert.equal(file.mediaType, 'audio/mpeg')
  assert.ok(file.bytes.length > 10000, '参考音频不能是空文件')
  assert.match(file.sha256, /^[0-9a-f]{64}$/u)
  const playerKeys = new Set([...VOICE_PROFILES.map(profile => profile.key), ...GENERIC_VOICES.map(profile => profile.key)])
  assert.equal(playerKeys.has(HOST_VOICE_KEY), false, '主持人音色不能出现在选手音色表里')
  assert.deepEqual(assignVoices([{ name: '主持人' }, { name: 'host' }]).includes(HOST_VOICE_KEY), false)
})

test('选手音色按模型匹配，未命中的选手错开通用音色', () => {
  assert.equal(matchVoiceKey({ model: 'deepseek-v3' }), 'deepseek')
  assert.equal(matchVoiceKey({ providerName: '豆包' }), 'doubao')
  assert.equal(matchVoiceKey({ model: 'local-7b' }), null)
  const voices = assignVoices([{ model: 'unknown-a' }, { model: 'unknown-b' }, { model: 'unknown-c' }])
  assert.equal(new Set(voices).size, 3, '三名未匹配选手不能共用同一条通用音色')
  assert.deepEqual(assignVoices([{ model: 'qwen-max' }, { model: 'qwen-max' }]), ['qwen', 'qwen'], '同模型自我对弈可以共用专属音色')
})