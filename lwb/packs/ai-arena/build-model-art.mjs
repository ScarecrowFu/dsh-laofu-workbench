/**
 * 把 assets/models 下的「模型形象」打成 model-art.mjs（内联 data URL）。
 *
 * 形象是**跨游戏共用**的模型身份资产（五子棋 / 中国象棋 / 狼人杀都用同一套家族形象），
 * 与狼人杀专属的昼夜场景分开：场景在 assets/werewolf，由 build-werewolf-art.mjs 产出。
 *
 * 两个档位：
 *   - full：半身 320×480（2:3）透明底 WebP，用于狼人杀席卡与标准执行者卡（66×86）
 *   - bust：胸像 320×320 方形透明底 WebP，用于紧凑档执行者卡（象棋竖屏，46—58px）
 * 素材是唯一事实源，改完必须重新执行本脚本（test/replay.test.mjs 会拦不同步）。
 *
 * 运行：npm run arena:build（已包含本步骤）
 */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const assets = join(root, 'assets', 'models')
const LOGOS = join(root, 'assets', 'logos')
const OUTPUT = join(root, 'model-art.mjs')
const MIME = { '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }

const extension = name => name.slice(name.lastIndexOf('.')).toLowerCase()
const stem = name => name.slice(0, name.lastIndexOf('.'))

/** 目录里每个图片文件 → [名称, data URL]，按名称排序保证生成物可复现。 */
async function collect(tier) {
  const names = (await readdir(join(assets, tier))).filter(name => MIME[extension(name)]).sort()
  return Object.fromEntries(await Promise.all(names.map(async name => {
    const bytes = await readFile(join(assets, tier, name))
    return [stem(name), `data:${MIME[extension(name)]};base64,${bytes.toString('base64')}`]
  })))
}

/* 圆形 logo 与形象同属「模型身份资产」：观战页在浏览器里跑、读不到文件系统，
   所以 logo 也必须以 data URL 随模块分发（在此之前它只由 voices.mjs 在服务端读盘）。 */
async function collectLogos() {
  const names = (await readdir(LOGOS)).filter(name => MIME[extension(name)]).sort()
  return Object.fromEntries(await Promise.all(names.map(async name => {
    const bytes = await readFile(join(LOGOS, name))
    return [stem(name), `data:${MIME[extension(name)]};base64,${bytes.toString('base64')}`]
  })))
}

const full = await collect('full')
const bust = await collect('bust')
const logos = await collectLogos()
await writeFile(OUTPUT, `/* 由 build-model-art.mjs 从 assets/models 与 assets/logos 生成，请勿手改。 */\nexport const MODEL_ART = ${JSON.stringify({ full, bust, logos })}\n`)
console.log(`model-art.mjs 已生成：full ${Object.keys(full).length} 张，bust ${Object.keys(bust).length} 张，logo ${Object.keys(logos).length} 个`)