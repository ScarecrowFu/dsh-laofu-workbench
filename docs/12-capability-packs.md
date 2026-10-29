# 场景能力包契约

能力包是运行时组合的 DSH 插件。基础 Profile 不依赖具体业务包，公开仓库包含 `spoken-video` 和 `ai-arena`。业务流程见[口播指南](spoken-video.md)与[AI 竞技台](ai-arena.md)，最小代码示例见[开发入门](develop-a-pack.md)。

## 注册与生命周期

仓库 `lwb/packs/` 下的包自动出现在目录中，首次点击“加载”。外部包通过 CLI 登记：

```sh
npm run pack:install -- /absolute/path/to/pack
npm run pack:list
npm run pack:remove -- pack-id
```

登记表默认在被 Git 忽略的 `lwb/local/current/packs.json`。CLI 登记不启用、不复制源码或安装依赖，当前没有在线下载市场或自动更新。

工作台控制加载和卸载。Host 用 Cordis Loader 动态增减条目，浏览器用官方串行模块控制器 `modules.entries.sync()` 同步受控、带版本的 Bundle，再更新菜单，无需整页刷新。加载设 `enabled: true`，重启自动恢复；卸载设为 false，等待释放后保留包源与数据。单包恢复失败不阻止基础启动。浏览器不能自行操作 Loader 内部状态。

| 操作 | 工作区绑定 | 业务文件 | 配置、凭据与审计归属 |
|---|---|---|---|
| 卸载包 | 保留 | 保留 | 保留 |
| 清空业务数据 | 保留原状态 | 移至可恢复副本，重建空目录 | 保留 |
| 解除工作区注册 | 解除活动绑定，保留归属历史 | 保留 | 保留 |
| 再次加载 | 恢复登记，复用目录 | 继续使用 | 继续使用 |
| CLI 删除包源登记 | 不等同解除工作区绑定 | 保留 | 保留 |

清空与解除注册是独立操作，须先卸载并等待任务停止，再分别确认。清空包含业务账号、信号、项目、媒体、任务和安排，返回可恢复目录，不是安全擦除；不导入旧普通工作区数据。重新加载后来源可能再次自动采集，这属于新数据。

## 清单与注册契约

| 文件 | 用途 |
|---|---|
| `lwb-pack.json` | 公开身份、版本、说明与菜单 |
| `package.json` | npm 身份、host/client exports 与 `dsh.client` |
| `index.mjs` | Host entry：manifest、领域服务和 RPC |
| `client.js` | Browser entry：菜单页面 |

`schemaVersion` 为 1；包 id、npm 名称和菜单 id 严格校验，菜单 id 包内唯一。市场只读清单与 package 信息，不执行 entry；加载时才 import。校验后清单规范化并冻结。

`market` 可声明分类、标签、工作流、图标与详情：

| 字段 | 约束 |
|---|---|
| `introduction` | 最多 500 字符；缺省使用 description |
| `workflowHint` | 最多 240 字符 |
| `gettingStarted` | 1–8 条，每条最多 240 字符 |
| `features` | 1–16 项；title ≤80、description ≤240、可选 icon ≤32 字符 |

`features.menuId` 必须引用本包菜单且不重复；缺省从菜单生成卡片。图标支持 pack、target、signal、idea、write、audio、video、publish、calendar，未知名称回退通用图标。详情抽屉固定标题和操作，中部独立滚动，支持 Escape、遮罩关闭、焦点约束及返回入口。

可选服务字段：

| 字段 | 语义 |
|---|---|
| `minHostVersion` | 最低 Host 语义版本 |
| `requiredServices` | 逻辑服务，如 tts、subtitle、cover-image |
| `providers` | 支持 official、ats、custom 来源 |
| `entitlements` | ATS 权益声明，不授予权限 |
| `access` | `{ account: 'lwb', membershipRequired: true }` 启用 Host 会员校验 |

Host 对会员包加载和业务请求校验 ATS 会员状态；菜单禁用只是反馈。声明与本地校验不替代云端计费授权，也不能把任意 JavaScript 插件变成沙箱。接入见[账号与服务契约](40-lwb-account-model-and-media-services.md)。

Host 通过 `registerLwbPack(ctx, manifest)` 或 `lwbPackRegistry.register(manifest)` 注册；Browser 声明 `inject: ['lwbPackClient']`，两者均由 `ctx.effect()` 托管释放：

```js
ctx.effect(() => ctx.lwbPackClient.register({
  packId: 'example-pack',
  pages: { home: ExamplePage },
}), 'example-pack: register capability pages')
```

页面获得公开 pack/menu、packId、导航回调及宿主会话能力。禁止 import 核心 `lwb/dsh-bundle/client.js` 或假定宿主理解业务路由。动态样式创建时须标记 `data-plugin` 为本包 package name，避免被其他模块认领并在卸载时误删。

## 工作区与执行作用域

每实例每包首次加载由 Host 创建专属工作区，以后按身份复用，不加入普通 DSH Workspace Registry。数据 RPC 使用 Host 上下文 `{ packId, workspaceId, workspacePath, generation, status }`，浏览器不能以 agentId / cwd 选任意数据目录。路径见[运行数据布局](31-runtime-data-layout.md)。

Host 声明 `lwbPackServices`，用 `getLwbPackScope(ctx, manifest)` 或 `ctx.lwbPackServices.forPack(manifest.id)` 获取作用域：

| 接口 | 契约 |
|---|---|
| `context()` | 唯一数据上下文 |
| `request(operation)` | 跟踪完整 RPC |
| `background(promise)` | 跟踪后台任务，包含最后写入及衍生队列工作 |
| `onStop(disposer)` | 停止计时器等资源 |
| `signal` / `fetch` | 包级取消及合并取消的 HTTP |
| `withAgent(operation, signal?)` | 创建、使用、释放包内原生 Agent |
| `sessions.create/resume/get` | 管理包自有会话，登记归属 |
| `sessions.inbound(sessionId, message)` | 把外部渠道消息投进包自有会话，来源保留在消息记录里 |
| `sessions.adopt(agent)` | 接管自行创建的原生根会话，cwd 须等于包工作区 |
| `assertAgent(agent)` | 工具调用验证包目录归属 |
| `credentials` | 包命名空间内的业务凭据 |
| `settings(name, schema)` | 独立 JSON 设置，串行原子写入，加入卸载屏障 |

根会话发布工作前须登记归属；自行创建用 `sessions.adopt`。内部根 Agent 挂载 standard 预设及 workspace-write 权限，子代理继承原生边界。这提供归属与调度隔离，不保证不能读取工作区外文件。

场景模型可跟随 DSH 或独立选已有路由；新任务捕获选择，运行中不随设置变化。认证由 DSH 适配器处理。已声明且确定缺失的凭据引用会提示并使调度轮次预检失败；未声明引用的账号、设备、OAuth 路由和探测报错按未知处理，不拦截。`executionStatus` 只判断选择存在，不表示联网或认证成功。TTS、ASR、封面凭据独立于文本模型。

卸载先关闭入口，再取消 HTTP、Agent、ASR WebSocket、ffmpeg 与计时器，最后等前台、后台、写入和衍生任务结算。子进程取消须等 `close`；Remotion 等 CLI 结算，不把 AbortError 视为已退出。30 秒未停止返回忙碌，禁止数据维护，结算后可重试。Loader 删除组等待异步释放。

## 包内会话与官方右栏

包页面位于宿主 overlay，可自行布局原生会话：

```js
h('article', { onPointerDownCapture: () => focusSession(run.sessionId) },
  h('div', { className: 'example-conversation' },
    renderConversation({ sessionId: run.sessionId })),
)
```

`renderConversation` 使用官方 `conversation.content` Factory 与对应 session scope，显示回答、工具、文件 chip 和 composer，不改变 frame 会话。`focusSession` 只接受本页已挂载的自有会话，使官方右栏跟随焦点；最后嵌入释放时，仅在用户未另行导航的情况下恢复原会话。

每会话仅一个 composer。首次嵌入注册优先级 `-10` 的空 `main.conversation` 占位，最后释放移除；保持 `activePanelId === null`，frame session 指向选中卡片。不得手动重绑 editor root；当前会话用 `uiSession.adapter.current`。各卡片独立取消，15 秒就绪超时可重试，过期结果不得覆盖或释放其他卡片。

官方面板由卡片共享。标题提供展开操作，切换卡片后默认收起，官方文件操作打开时除外；开关传明确目标状态。文件 chip 先聚焦、等对应 surface 挂载，再调用官方 `sidebarRight.openResource`，有界重试且不得打开到错误会话。overlay 只测量可见面板，忽略隐藏保留面板，通过 `--lwb-rightbar-inset` 让宽；全屏和窄屏另行适配。

`sessions.create({ provider, model, cwd })` 的 cwd 为包工作区内 `/` 分隔的相对路径，如 `runs/<taskId>/<runId>`；Host 逐段创建并拒绝符号链接和越界，缺省使用包根。`resume` 须用创建时同一 cwd。文件地址为 `dsh-resource://file/session/<sessionId>/<path>`，由官方处理。

会话可以传入 `tools: 'none'` 与完整 `system` 提示词，此时使用无工具预设并启用 DSH 原生自动压缩。`maxTokens` 省略时不新增输出覆盖值，复用已有会话时保留原策略；传入正整数显式设置输出上限，传入 `null` 清除原策略及继承请求头中的上限，恢复模型/适配器默认。竞技台使用 `null` 兼容旧比赛，测评包使用标准会话默认。

会话还可以指名 Host 注册的受控预设：目前只有 `preset: 'browser'`（注册为 `lwb-pack-browser`），用于替用户操作网页的工作会话。它与 `tools: 'none'` 互斥，因为两者都在定义工具集。预设是**完整的子插件清单**，不是叠加：`agentPresets.resolve()` 不返回 plugins，`agentPresets.mount()` 对已绑定 Agent 走 rebind 而非合并，所以它无法表达为"standard 加上浏览器"。浏览器预设只含浏览器工具与自动压缩，不含文件、命令与检索——一个被允许替你点网页的会话，不该同时拿到磁盘。

写预设行有两条硬约束，都只在真宿主里才暴露：

| 约束 | 不遵守的后果 | 怎么做 |
|---|---|---|
| 行名写**入口文件**（`lwb/dsh-bundle/dsh-adapter/package-paths.mjs` 的 `dshPackageEntry('@deepseek-ai/...')`，即 `file://…/lib/index.js`），不写裸包名 | 裸包名按"谁 import 它"的基址解析，而预设被挂进的是 Agent 树，基址是 `dsh-home/profiles/<id>`——那里的 `node_modules` 只有能力包链接。行 import 失败，动因被 `logger.error` 吞掉，`mountPreset` 只报 `never started`，看不出是哪个包 | 组装时用 `dshPackageEntry()` 解析一次；缺包就在注册处报错，而不是运行到一半 |
| 提供服务的插件包进 `cordis:group` + `isolate` | `mountPreset` 以 `Preset services require isolate realms: <name>` 拒绝整个挂载：注册表是单例，泄漏到根 realm 等于越过会话边界 | `{ id, name: 'cordis:group', group: true, isolate: { browserUse: true }, config: [提供者, 消费者] }` |

第二条同样适用于压缩：`compaction-basic` 一直挂着 `isolate: { compaction: true }` 的 group，否则会话拿不到隔离的压缩实例。

预设驱动的浏览器由 `lwb/dsh-bundle/browser-shim.mjs` 决定，不是简单读一个环境变量：

- `LWB_BROWSER_EXECUTABLE` 显式给了值，就原样用——谁点名了二进制，就不该被这层改写。
- 没给，就没有"缺省交给上游下载"这回事：bundle 解析出 `playwright-core` 自己会用的那颗 Chromium，生成一个两行 shim（`exec <binary> --no-sandbox "$@"`）放进 `pack-state/browser/chromium-nosandbox.sh`，把 shim 当 `executablePath` 传下去。内容没变就不重写，权限固定 `0o755`。
- Windows 跳过（`.cmd` 没法被 provider 那样 exec，且那边不撞这个沙箱问题）；任何一步失败返回 `undefined`，让 provider 用它自己的默认值——一个可能崩的浏览器，强过一条起不来的会话。

为什么要包一层：`@playwright/mcp` 默认 `chromiumSandbox: true`，而 Playwright 自己的 API 默认 `false`。从 Node 子进程拉起浏览器时，那个沙箱在这里初始不起来（`sandbox initialization failed: Operation not permitted`），GPU 与 network 服务接连倒下，渲染进程收 `SIGSEGV`，调用方只看到 `browserBackend.callTool: Target crashed`。该开的开关 MCP 自己有（`--no-sandbox`），但 `BrowserMcpConfig` 没有转发 args 的字段，它还会把所有 `PLAYWRIGHT_MCP_*` 变量清成空串再 spawn——而 MCP 的 `envToBoolean('')` 返回 `undefined`，等于没设。`executablePath` 是唯一能碰到命令行的口子，所以开关搭在 shim 上进来。代价是浏览器进程沙箱被关掉，这是产品决策，记录在商业包 `docs/yuchi-p2-plan.md` §7。

`sessions.inbound(sessionId, message)` 把一条外部渠道消息投进包自有会话。它不走 `sessionController.prompt`：那条路径把来源固定写成 `user-rpc`，会声称消息是用户在工作台里打的。入站消息在 Host 内构造 `user/message`，沿用 LWB 唯一的自有来源 `kind: 'lwb'`，渠道信息放在同一对象里（`channel` / `externalId` / `messageId`），渠道重投与"她当时不在线"因此可判定。只接受文本；附件必须由适配器先落进包工作区。来源不是 `user` 的消息不会被技能触发扫描命中，这是刻意的：渠道里来的字不能当成本地指令。

`SessionController.prompt` 本身不因此改动。`createUserMessage` 是 `@deepseek-ai/dsh-llm` 的公开导出，已列入基座复核项。

## 对话模块的官方左栏

Workspace 浏览器用 `sidebar.workspaces`，面板行用 `sidebar.panellist`；两者必须声明在实际渲染它们的 `shell.overlay` entry 的 children 下，放在 sidebar entry 会使 overlay 崩溃。新对话按钮硬编码在官方 shell 中，LWB 对应按钮按官方行为调用 `uiWorkspace.startSession()`。

这些功能位于对话的 264px 次级栏，产品导航放品牌、三模块与设置。面板行读取 `entriesOfSlot`、订阅变化和 locale；label 可为函数，Glyph 用注册组件。以 `layout.panelInfo` 判定选中，用绑定到服务对象的 `services.layout.selectPanel(id)` 切换，确认同名 main 存在；进入对话或新会话调用 `selectPanel(null)`。

以归属 id 和 cwd 位于包工作区内两条事实过滤包根会话，路径比较须有分隔符边界。投影后的 `useSessions` / `useWorkspaces` 只从 owner props 传给官方座位，保持 snapshot identity；归属 RPC 未完成延迟首次渲染，未知归属不擅自隐藏。子代理与空会话由官方过滤，清空或解绑仍保留历史归属，不改 Session 格式。

owner hook 覆盖依赖未文档化的合并顺序，与上游“业务不把 hook selector 作为 prop”的指导存在偏离，升级须核验。回归见 `lwb/dsh-bundle/test/client-conversation-seat.test.mjs`，门禁见[基座升级](08-base-lock.md)。
