/**
 * 把 assets/werewolf 下的昼夜场景与六席立绘打成 werewolf-art.mjs（内联 data URL）。
 *
 * 观战与视频都在浏览器里跑，不能读文件系统；离线 HTML 还要自包含、零网络。
 * 所以图片一律以 data URL 形式随模块分发。素材是唯一事实源，改完必须重新执行本脚本。
 *
 * 运行：npm run arena:build（已包含本步骤）
 */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const assets = join(root, 'assets', 'werewolf')
const OUTPUT = join(root, 'werewolf-art.mjs')
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }

const extension = name => name.slice(name.lastIndexOf('.')).toLowerCase()
const stem = name => name.slice(0, name.lastIndexOf('.'))

/** 目录里每个图片文件 → [名称, data URL]，按名称排序保证生成物可复现。 */
async function collect(directory) {
  const names = (await readdir(join(assets, directory))).filter(name => MIME[extension(name)]).sort()
  return Promise.all(names.map(async name => {
    const bytes = await readFile(join(assets, directory, name))
    return [stem(name), `data:${MIME[extension(name)]};base64,${bytes.toString('base64')}`]
  }))
}

/* 立绘命名约定：`<模型>.jpg` 与 `<模型>-dead.jpg`，观战按 key 取图。 */
const scenes = Object.fromEntries(await collect('scenes'))
const portraits = Object.fromEntries(await collect('characters'))

await writeFile(OUTPUT, `/* 由 build-werewolf-art.mjs 从 assets/werewolf 生成，请勿手改。 */\nexport const WEREWOLF_ART = ${JSON.stringify({ scenes, portraits })}\n`)
console.log(`werewolf-art.mjs 已生成：${Object.keys(scenes).length} 个场景，${Object.keys(portraits).length} 张立绘`)