/**
 * 选手音色与 logo。素材随包分发，运行时不读个人目录。
 * 匹配看模型 id、供应商和选手名；未命中的选手用通用音色，两名选手不共用同一条。
 * 主持人另有一条固定音色（`assets/voices/host.mp3`），不参与选手匹配。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'assets')

/** 专属音色。顺序即优先级：更具体的键放前面。 */
export const VOICE_PROFILES = Object.freeze([
  { key: 'claude', file: 'voices/claude.mp3', mediaType: 'audio/mpeg', needles: ['claude'] },
  { key: 'deepseek', file: 'voices/deepseek.mp3', mediaType: 'audio/mpeg', needles: ['deepseek'] },
  { key: 'gpt', file: 'voices/gpt.mp3', mediaType: 'audio/mpeg', needles: ['chatgpt', 'openai', 'gpt'] },
  { key: 'minimax', file: 'voices/minimax.wav', mediaType: 'audio/wav', needles: ['minimax'] },
  { key: 'mimo', file: 'voices/mimo.mp3', mediaType: 'audio/mpeg', needles: ['mimo', 'mino'] },
  { key: 'qwen', file: 'voices/qwen.wav', mediaType: 'audio/wav', needles: ['qwen', '千问', 'qwq'] },
  { key: 'zhipu', file: 'voices/zhipu.wav', mediaType: 'audio/wav', needles: ['zhipu', '智谱', 'glm'] },
  { key: 'kimi', file: 'voices/kimi.wav', mediaType: 'audio/wav', needles: ['moonshot', 'kimi', '月之暗面'] },
  { key: 'doubao', file: 'voices/doubao.wav', mediaType: 'audio/wav', needles: ['doubao', '豆包'] },
])

export const GENERIC_VOICES = Object.freeze([1, 2, 3, 4, 5, 6].map(index => Object.freeze({
  key: `generic-${index}`, file: `voices/generic-${index}.mp3`, mediaType: 'audio/mpeg',
})))

/** 主持人音色：固定一条，不参与选手匹配，也不与任何选手共用（见 voices 文档与 TTS 缓存键）。 */
export const HOST_VOICE_KEY = 'host'
const HOST_VOICE = Object.freeze({ key: HOST_VOICE_KEY, file: 'voices/host.mp3', mediaType: 'audio/mpeg' })

/** logo 文件名与音色键不完全相同：gpt 的图标文件是 chatgpt。 */
const LOGO_FILE = Object.freeze({
  claude: 'claude', deepseek: 'deepseek', gpt: 'chatgpt', minimax: 'minimax', mimo: 'mimo',
  qwen: 'qwen', zhipu: 'zhipu', kimi: 'kimi', doubao: 'doubao',
})

const logoCache = new Map()
function logoDataUrl(name) {
  if (logoCache.has(name)) return logoCache.get(name)
  const bytes = readFileSync(join(ROOT, 'logos', `${name}.png`))
  const url = `data:image/png;base64,${bytes.toString('base64')}`
  logoCache.set(name, url)
  return url
}

export function genericLogo() { return logoDataUrl('generic') }

function haystack(player) {
  return [player?.model, player?.provider, player?.providerName, player?.name].filter(Boolean).join(' ').toLowerCase()
}

export function matchVoiceKey(player) {
  const text = haystack(player)
  return VOICE_PROFILES.find(profile => profile.needles.some(needle => text.includes(needle)))?.key || null
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

/** 选手展示用的圆形 logo。未收录的模型用通用图。 */
export function playerLogo(player) {
  const key = matchVoiceKey(player)
  return logoDataUrl(key ? LOGO_FILE[key] : 'generic')
}
