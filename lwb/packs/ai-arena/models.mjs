/**
 * 模型家族表：**一个模型 = 一个家族 = 一个 logo + 一个音色 + 一个形象**。
 *
 * 在这之前，三件事各自维护了一份匹配规则，而且键都对不上：
 *   - `voices.mjs` 的 `VOICE_PROFILES`：家族键是 `gpt`（文件 `voices/gpt.mp3`）
 *   - `voices.mjs` 的 `LOGO_FILE`：`gpt` → 图标文件 `chatgpt.png`
 *   - `presentation.mjs` 的 `PORTRAIT_KEY`：家族键是 `chatgpt`（立绘 `chatgpt.jpg`）
 * 于是「同一个模型在三个地方是不是同一个家族」只能靠人肉核对。现在只保留这一张表。
 *
 * 两个键的区别是历史包袱，不要合并：
 *   - `family`：形象与 logo 的家族键，也是素材文件名（`assets/models/<档位>/chatgpt.webp`）
 *   - `voice` ：音色键，也是参考音频文件名（`assets/voices/gpt.mp3`）与配音缓存键的一部分。
 *     改它会同时让已缓存的配音失效，所以 `gpt` 这个名字保持不动。
 *
 * 浏览器安全：不 import `node:*`，观战页、离线回放与视频三处共用（`voices.mjs` 会读文件系统，
 * 不能进浏览器，所以这张表必须放在这里而不是那边）。
 */

/**
 * 家族表。`needles` 是各消费点原有 needle 的**并集**，顺序不影响匹配——
 * 九个家族的 needle 两两不互为子串（`gpt` 只出现在 chatgpt 家族自己内部），
 * 由 `test/models.test.mjs` 守住这条前提；将来新增家族要重新确认。
 */
export const MODEL_FAMILIES = Object.freeze([
  Object.freeze({ family: 'claude', voice: 'claude', logo: 'claude', needles: Object.freeze(['claude']) }),
  Object.freeze({ family: 'deepseek', voice: 'deepseek', logo: 'deepseek', needles: Object.freeze(['deepseek']) }),
  Object.freeze({ family: 'chatgpt', voice: 'gpt', logo: 'chatgpt', needles: Object.freeze(['chatgpt', 'openai', 'gpt']) }),
  Object.freeze({ family: 'minimax', voice: 'minimax', logo: 'minimax', needles: Object.freeze(['minimax']) }),
  Object.freeze({ family: 'mimo', voice: 'mimo', logo: 'mimo', needles: Object.freeze(['mimo', 'mino']) }),
  Object.freeze({ family: 'qwen', voice: 'qwen', logo: 'qwen', needles: Object.freeze(['qwen', '千问', 'qwq']) }),
  Object.freeze({ family: 'zhipu', voice: 'zhipu', logo: 'zhipu', needles: Object.freeze(['zhipu', '智谱', 'glm']) }),
  Object.freeze({ family: 'kimi', voice: 'kimi', logo: 'kimi', needles: Object.freeze(['moonshot', 'kimi', '月之暗面']) }),
  Object.freeze({ family: 'doubao', voice: 'doubao', logo: 'doubao', needles: Object.freeze(['doubao', '豆包']) }),
])

/**
 * 未命中家族时的兜底轮转顺序。这**不是**随便一份列表：
 * `portraitKey(player, seat)` 与 `assignPortraits` 都用它按座位/模型 id 取模，
 * 顺序变了就会让历史对局的形象整体错位，`test/werewolf-replay.test.mjs` 里有断言钉住。
 */
export const FALLBACK_FAMILIES = Object.freeze([
  'chatgpt', 'claude', 'deepseek', 'doubao', 'kimi', 'mimo', 'minimax', 'qwen', 'zhipu', 'generic',
])

/** 家族匹配用的文本：模型 id、供应商与选手名都参与，与音色、形象的旧口径一致。 */
export function familyText(player) {
  return [player?.model, player?.provider, player?.providerName, player?.name].filter(Boolean).join(' ').toLowerCase()
}

/** 玩家 → 家族键；未命中返回 null（不猜、也不退回 generic）。 */
export function matchFamily(player) {
  const text = familyText(player)
  if (!text) return null
  return MODEL_FAMILIES.find(family => family.needles.some(needle => text.includes(needle)))?.family || null
}

/** 家族键 → 表项。 */
export function familyOf(key) {
  return MODEL_FAMILIES.find(family => family.family === key) || null
}

/** 玩家 → 圆形 logo 的素材键（家族键；未命中用 generic）。 */
export function logoKey(player) {
  return familyOf(matchFamily(player))?.logo || 'generic'
}

/** 音色键 → 家族键（配音与缓存键用的是音色键）。 */
export function familyByVoice(voiceKey) {
  return MODEL_FAMILIES.find(family => family.voice === voiceKey)?.family || null
}