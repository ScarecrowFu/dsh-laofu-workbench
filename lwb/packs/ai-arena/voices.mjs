/**
 * 选手音色与 logo。素材随包分发，运行时不读个人目录。
 * 匹配看模型 id、供应商和选手名；未命中的选手用通用音色，两名选手不共用同一条。
 * 主持人另有一条固定音色（`assets/voices/host.mp3`），不参与选手匹配。
 *
 * 家族匹配只走 `models.mjs` 的 `MODEL_FAMILIES`（一个模型 = 一个 logo + 一个音色 + 一个形象），
 * 这里只负责「家族键 → 参考音频文件」与「家族键 → 圆形 logo」。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MODEL_FAMILIES, familyOf, logoKey, matchFamily } from './models.mjs'
import { MODEL_ART } from './model-art.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'assets')

/**
 * 参考音频文件与媒体类型。键是**音色键**（家族表里的 `voice`），
 * 与家族键不完全相同：chatgpt 家族的音频文件是 `gpt.mp3`。
 * 改这里的名字会同时让已缓存的配音失效（缓存键含音色键），所以保持原样。
 */
const VOICE_FILE = Object.freeze({
  claude: { file: 'voices/claude.mp3', mediaType: 'audio/mpeg' },
  deepseek: { file: 'voices/deepseek.mp3', mediaType: 'audio/mpeg' },
  gpt: { file: 'voices/gpt.mp3', mediaType: 'audio/mpeg' },
  minimax: { file: 'voices/minimax.wav', mediaType: 'audio/wav' },
  mimo: { file: 'voices/mimo.mp3', mediaType: 'audio/mpeg' },
  qwen: { file: 'voices/qwen.wav', mediaType: 'audio/wav' },
  zhipu: { file: 'voices/zhipu.wav', mediaType: 'audio/wav' },
  kimi: { file: 'voices/kimi.wav', mediaType: 'audio/wav' },
  doubao: { file: 'voices/doubao.wav', mediaType: 'audio/wav' },
})

/** 专属音色。顺序即优先级：更具体的键放前面（顺序沿用家族表，音色匹配口径不变）。 */
export const VOICE_PROFILES = Object.freeze(MODEL_FAMILIES.map(family => Object.freeze({
  key: family.voice, family: family.family, needles: family.needles,
  file: VOICE_FILE[family.voice].file, mediaType: VOICE_FILE[family.voice].mediaType,
})))

export const GENERIC_VOICES = Object.freeze([1, 2, 3, 4, 5, 6].map(index => Object.freeze({
  key: `generic-${index}`, file: `voices/generic-${index}.mp3`, mediaType: 'audio/mpeg',
})))

/** 主持人音色：固定一条，不参与选手匹配，也不与任何选手共用（见 voices 文档与 TTS 缓存键）。 */
export const HOST_VOICE_KEY = 'host'
const HOST_VOICE = Object.freeze({ key: HOST_VOICE_KEY, file: 'voices/host.mp3', mediaType: 'audio/mpeg' })

export function genericLogo() { return MODEL_ART.logos.generic }

/** 选手 → 音色键。匹配规则只有 `models.mjs` 一处，这里不再各存一份 needles。 */
export function matchVoiceKey(player) {
  return familyOf(matchFamily(player))?.voice || null
}

/** 为两名选手分配音色键。同模型自对弈可以共用专属音色。 */
export function assignVoices(players = []) {
  const matched = players.map(matchVoiceKey)
  const usedGeneric = new Set()
  return matched.map((key, index) => {
    if (key && matched.indexOf(key) === index) return key
    if (key) return key
    const generic = GENERIC_VOICES.find(profile => !usedGeneric.has(profile.key)) || GENERIC_VOICES[0]
    usedGeneric.add(generic.key)
    return generic.key
  })
}

export function voiceProfile(key) {
  if (key === HOST_VOICE_KEY) return HOST_VOICE
  return VOICE_PROFILES.find(profile => profile.key === key) || GENERIC_VOICES.find(profile => profile.key === key) || null
}

export function voiceFile(key) {
  const profile = voiceProfile(key)
  if (!profile) throw new Error('音色不存在。')
  const path = join(ROOT, profile.file)
  const bytes = readFileSync(path)
  return { key: profile.key, mediaType: profile.mediaType, path, bytes, sha256: createHash('sha256').update(bytes).digest('hex') }
}

/** 选手展示用的圆形 logo。未收录的模型用通用图。家族键与音色键的差异见 models.mjs。 */
export function playerLogo(player) {
  return MODEL_ART.logos[logoKey(player)] || MODEL_ART.logos.generic
}
