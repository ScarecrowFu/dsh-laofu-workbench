# LWB Product Profile

`lwb/` 是锁定 DeepSeek Harness checkout 之外的产品层。LWB 通过 DSH Profile、Cordis Bundle 和浏览器模块扩展官方运行时，不维护另一套聊天服务。

## 基础版

默认 Profile 装配：

- DSH `base + web-app`；
- DSH 原生文件附件与 LWB 会话归档扩展；
- LWB 三模块浏览器壳；

用户可见导航只有“对话”“场景能力包”和“设置”。普通对话仍是 DSH Session；场景能力包由市场目录和本机安装表组合。“设置 → 系统设置”打开完整的 DSH 原生设置面板，管理语言、外观、模型服务、权限、插件和 Agent 预设等；能力包内部会话使用场景任务默认模型，可跟随 DSH 或选择已有路由，认证仍由 DSH 处理。能力包需要展示原生会话时，页面通过宿主下发的 `renderConversation` 在包内渲染该会话的官方对话，并用 `focusSession` 让 frame 的当前会话指向正在操作的卡片，从而原样获得官方右栏（产物、文件、终端、插件 tab 等）；退出页面时，若用户未另行导航则恢复原会话。见[能力包内的会话与官方右栏](../docs/12-capability-packs.md#包内会话与官方右栏)。

| 路径 | 职责 |
|---|---|
| `UPSTREAM.lock.json` | 精确的上游 tag / commit 锁定 |
| `profile/` | 受跟踪的 DSH Profile manifest |
| `dsh-bundle/archive-gateway.mjs` | DSH 公开归档模型未覆盖的窄恢复接缝 |
| `dsh-bundle/dsh-adapter/` | 当前 DSH 版本的 Loader 和包解析边界 |
| `dsh-bundle/client.js` | 对话、场景能力包（含包内会话与产物面孔）、设置的浏览器壳；对话左栏是官方 `sidebar.workspaces` 浏览区，不接管官方对话与右栏 |
| `pack-sdk/` | 第三方场景能力包的 manifest 与 host 注册契约 |
| `pack-manager.mjs` | 本机能力包目录、安装状态与命令 |
| `packs/` | 可独立安装的场景能力包源码 |
| `desktop/` | 桌面打包入口、版本（edition）清单与产物组装 |
| `upgrade/` | 上游检查和升级流程 |

## 场景能力包

基础 Profile 不直接装配具体领域包。仓库随附的口播包会自动出现在市场，首次需手动加载。使用 `npm run pack:install -- <包目录>` 将一个符合契约的外部包源登记到被忽略的 `lwb/local/current/packs.json`，使其出现在市场中；登记默认不启用。工作台市场加载包后会把它记为启用，使其在后续启动时自动恢复；卸载会取消该状态。加载和卸载均会在当前页面更新浏览器模块与菜单。`npm run pack:remove -- <包 id>` 只删除登记，不会删除包源码或工作区数据。

当前仓库提供 `packs/spoken-video/`（口播八步创作）与 `packs/ai-arena/`（五子棋 / 中国象棋 / 狼人杀模型竞技），业务说明见[口播指南](../docs/spoken-video.md)和[AI 竞技台](../docs/ai-arena.md)。新增业务可以继续以独立包接入；开发步骤见[能力包开发入门](../docs/develop-a-pack.md)，详细契约见[场景能力包文档](../docs/12-capability-packs.md)。

每个能力包加载后自动拥有专属工作区，无需创建普通对话。卸载保留目录、数据和连接配置；详情页提供分开的“清空业务数据”和“解除工作区注册”操作。见[专属工作区说明](../docs/12-capability-packs.md#工作区与执行作用域)。

## 运行数据

默认所有持久化运行数据统一位于 `lwb/local/current/`：原生附件在 `dsh-home/attachments/`，口播数据在 `pack-state/workspaces/spoken-video/data/`。不再创建 `.lwb/` 或普通工作区上传目录；信号采集和内容安排只读取专属工作区，不维护跨工作区索引。测试夹具使用可清理的独立临时目录。详见[目录契约](../docs/31-runtime-data-layout.md)。

## 更新策略

`vendor/deepseek-harness` 必须保持源码 Git 工作树干净。LWB 业务逻辑应位于此目录；不要修改 vendor。

升级 DSH 时，在独立分支中选定精确 commit，在干净临时 checkout 安装和构建，更新 lock，适配 LWB 接缝，并执行 `npm run test` 和浏览器验收。详见[升级说明](upgrade/README.md)与[基座文档](../docs/08-base-lock.md)。

### 单一版本约束

当前只支持锁定的 DSH 0.2.1-rc.2。旧设置兼容桥、旧 API 与数据路径回退均已删除。新版本不自动读取旧数据；旧文件保留。原生设置访问遵循 DSH 当前策略。架构边界与验收门禁见 [总体架构](../docs/01-architecture.md)和[升级门禁](../docs/08-base-lock.md)。
