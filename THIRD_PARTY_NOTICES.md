# 第三方组件与资源说明

当前版本的项目自有代码采用根目录的 [PolyForm Noncommercial License 1.0.0](LICENSE)。第三方代码、工具和素材遵循各自许可，本文件不替换其原始条款，也不为来源尚未确认的素材授予额外权利。项目许可和商业使用边界见[许可证与商业使用](docs/licensing-and-commercial-use.md)。

## 运行依赖

| 组件 | 用途 | 来源与许可 |
|---|---|---|
| DeepSeek Harness | 对话、模型、工具、会话和插件运行时 | [上游仓库](https://github.com/deepseek-ai/deepseek-harness)，锁定版本见 [UPSTREAM.lock.json](lwb/UPSTREAM.lock.json)；该版本根许可证为 MIT，Copyright 2026 DeepSeek |
| React / React DOM | 工作台与视频组件 | [React](https://github.com/facebook/react)，MIT |
| Remotion / Remotion CLI / Bundler / Renderer | 视频工程、预览与渲染 | [Remotion](https://github.com/remotion-dev/remotion)，使用独立的 [Remotion License](https://www.remotion.dev/license)，并非本项目许可证的一部分 |
| @algorithm.ts/gomoku 4.0.5 | 五子棋规则与胜负判定 | [algorithm.ts](https://github.com/guanghechen/algorithm.ts)，MIT |
| lucide-react 0.468.0 | 竞技台图标 | [Lucide](https://github.com/lucide-icons/lucide)，ISC |
| esbuild 0.28.1 | 竞技台客户端构建 | [esbuild](https://github.com/evanw/esbuild)，MIT |
| Babel parser | 解析生成的视频代码 | [Babel](https://github.com/babel/babel)，MIT |
| PostCSS | 样式解析 | [PostCSS](https://github.com/postcss/postcss)，MIT |
| ws | WebSocket 通信 | [ws](https://github.com/websockets/ws)，MIT |
| FFmpeg / ffprobe | 音视频处理与检查 | [FFmpeg](https://ffmpeg.org/legal.html)，具体许可依所安装的构建及启用组件而定 |
| Chrome / Chromium | 渲染浏览器 | 由用户安装或 Remotion 下载，遵循对应浏览器发行版条款 |

直接 npm 依赖版本见 [package.json](package.json)，解析版本见 [package-lock.json](package-lock.json)；上游和传递依赖的完整许可应以实际安装包内的许可证为准。Remotion 的免费与公司许可适用条件请查看原始条款，不能根据工作台自身许可证推断 Remotion 的使用条件。

## 随包资料和音频

| 资源 | 当前出处记录 |
|---|---|
| `lwb/packs/spoken-video/skills/remotion-best-practices/` | 仓库包含 Remotion 编程规则资料；当前未完整记录其原始发布地址、导入版本和独立许可文件，需维护者补充核验。Remotion 软件本身的许可证不能代替这份资料的来源证明。 |
| `lwb/packs/spoken-video/skills/content-video/` | 口播创作规则，历史迁移背景见 [历史摘要与出处说明](docs/history.md#资源出处保留说明)；原始来源及可再分发声明需进一步补充。 |
| `lwb/packs/spoken-video/assets/voices/tiffy-confident.mp3` | 随包参考音频；当前未记录可核验的来源和使用/再分发授权，需维护者补充。 |
| `lwb/packs/ai-arena/assets/voices/host.mp3` | 狼人杀主持人参考音色，由产品负责人提供自有的语音素材（原文件 `Documents/语音备份/planA 语音.mp3`），随包作为 TTS 参考音频使用；对外再分发范围需维护者确认。 |
| `lwb/packs/ai-arena/assets/voices/` 其余参考音频与 `assets/logos/` | 选手音色与模型 logo，随包分发；当前未逐条记录来源和使用/再分发授权，需维护者补充。 |
| `lwb/packs/ai-arena/assets/models/{full,bust}/` | 选手的**角色形象**（跨游戏共用的模型身份资产）。不是新生成的素材，而是由 `.prototypes/arena-model-art/derive.mjs` 从 `assets/werewolf/characters/*.jpg` 抠黑底派生出的带 alpha WebP——**来源与再分发授权沿用上面那条立绘的记录，同样待维护者补充**。派生脚本本身不含第三方内容。 |

以上未完成的出处记录是发布资料缺口，不表示已核验拥有开放再分发许可。贡献新的技能、音频、图片或字体时，应同时提交来源链接、版本、许可及必要署名；用户上传的素材由用户自行确认使用权限。

## 规则与视觉参考（未作为运行时依赖）

AI 竞技台的中国象棋实现只参考下列公开资料的规则、合法着法与棋盘视觉，未复制其代码，也不随发行包分发：

| 资料 | 用途 | 来源与许可 |
|---|---|---|
| `@weshell/xiangqi.js` 1.0.3 | 开发期规则 parity 检查的对照实现 | [west-shell/xiangqi.js](https://github.com/west-shell/xiangqi.js)，BSD-2-Clause |
| `xiangqi.js` | 规则与合法着法参考 | [lengyanyu258/xiangqi.js](https://github.com/lengyanyu258/xiangqi.js)，BSD-2-Clause |
| `xiangqiboardjs` | 棋盘视觉参考 | [lengyanyu258/xiangqiboardjs](https://github.com/lengyanyu258/xiangqiboardjs)，MIT |
| `lhttjdr/xiangqi` | 规则参考 | [lhttjdr/xiangqi](https://github.com/lhttjdr/xiangqi)，MIT |
| `wukong-xiangqi` | 规则参考 | [maksimKorzh/wukong-xiangqi](https://github.com/maksimKorzh/wukong-xiangqi)，MIT |

`@weshell/xiangqi.js` 不写入 manifest：按 `lwb/packs/ai-arena/test/xiangqi-reference-check.mjs` 顶部说明用 `npm install --no-save --package-lock=false` 临时安装，只服务于[AI 竞技台](docs/ai-arena.md)的规则交叉检查，不进发行包。Pikafish / Fairy-Stockfish（GPL-3.0）、ElephantEye（LGPL-2.1）、xqwlight（GPL-2.0）和 pychess-variants（AGPL-3.0）仅作为引擎或服务架构资料查阅，不作为本包运行时依赖。

## 外部服务与内容

百炼、LWB/SciTiger 云端服务、公开信号来源及 AI 内容日报属于外部服务或内容来源。各自的 API 费用、使用规则、内容权利和可用性不由本项目许可证覆盖。工作台源码不附带服务额度；本地保存产物也不代表生成过程完全离线。购买 LWB 会员、积分或服务额度不自动授予项目源码的商业使用权。
