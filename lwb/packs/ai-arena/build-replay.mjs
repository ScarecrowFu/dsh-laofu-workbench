/**
 * 打包离线回放的浏览器运行时，并导出视频侧需要的样式字符串。
 *
 * 1. replay/entry.mjs → replay/runtime.js
 *    把 presentation.mjs 的棋盘绘制打包成浏览器可用脚本，由 export.mjs 内联进单文件 HTML。
 * 2. replay/scene.css → replay/styles.mjs
 *    Remotion 跑在浏览器里，不能读文件系统，需要把布局样式作为字符串交给它。
 *    生成物是提交进仓库的，改完 scene.css 必须重新执行本脚本（有测试守住这个约定）。
 *
 * 运行：npm run arena:build
 */
import { build } from 'esbuild'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))

await build({
  entryPoints: [join(root, 'replay', 'entry.mjs')],
  outfile: join(root, 'replay', 'runtime.js'),
  bundle: true, write: true, format: 'iife', platform: 'browser', target: 'es2022',
  minify: true, legalComments: 'none',
  /* presentation.mjs 用 Object.freeze 登记的常量（棋盘之外的卡片口径等）不进这个包：
     没有这个标记时 esbuild 不敢丢弃 freeze 调用，离线回放会被塞进用不到的展示数据。 */
  pure: ['Object.freeze'],
})
console.log('replay/runtime.js 已生成')

const sceneCss = await readFile(join(root, 'replay', 'scene.css'), 'utf8')
await writeFile(join(root, 'replay', 'styles.mjs'), `/* 由 build-replay.mjs 从 replay/scene.css 生成，请勿手改。 */
export const SCENE_CSS = ${JSON.stringify(sceneCss)}
`)
console.log('replay/styles.mjs 已生成')