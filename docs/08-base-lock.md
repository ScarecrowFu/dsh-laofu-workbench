# Harness 基座锁定与升级核验

当前基线为 DeepSeek Harness `dsh-v0.2.1-rc.2`（developer preview）。必须按精确 commit 复现，不跟随浮动分支或 tag 自动更新。

## 锁定锚点

| 项 | 值 |
|---|---|
| 上游仓库 | `https://github.com/deepseek-ai/deepseek-harness.git` |
| tag | `dsh-v0.2.1-rc.2` |
| commit | `687f282e8625c6b8d11ff58211a90524be2e4317` |
| 核验日期 | `2026-10-17` |
| Node | `^22.19.0 \|\| >=24.0.0` |
| 上游包管理器 | `pnpm@11.28.5` |

机器事实源是 [UPSTREAM.lock.json](../lwb/UPSTREAM.lock.json)。锁定便于审查和回滚，不代表上游已稳定。首次安装使用[快速开始](quickstart.md)。

## 复现与升级门禁

在独立升级分支选择精确上游 commit，先在干净临时 checkout 安装和构建。同步 lock、DSH peer 依赖及 LWB 适配代码；vendor 不得留下业务源码改动。忽略的旧构建产物应重新生成，不能以改源码兼容它们。

在项目根目录执行：

```sh
npm run setup
npm run upstream:check
npm test
npm run test:integration
```

`setup` 获取并构建锁定版本；上游安装、构建使用 `CI=true corepack pnpm install --frozen-lockfile` 与 `CI=true corepack pnpm run build`。clone 过慢时可精确 fetch tag，在专用临时 checkout 清除可再生文件后构建；不要在含未保存文件的用户 checkout 清理。

`upstream:check` 核验源码、lock、声明、UI 导出和构建。自动测试覆盖 Profile、包工作区和卸载等；集成测试用临时数据根启动真实 Host，验收加载、卸载、重载和重启恢复。通过后仍需 Web / Desktop UI 回归：普通对话、工作区、归档、附件、官方面板、包内会话及反复加载。

必须复核的版本接缝：

- Loader 组与异步释放、浏览器 `modules.entries.sync()`、Profile 组合、当前 Config / 设置接口。
- `ui-workspace` 座位、owner props 顺序、`shell.overlay` children 归属、cwd 投影与 sidebar 变量。
- `ui-plugin-manager` 的 `sidebar.panellist` / `main` 配对、AppFrame 默认对话和 layout 方法。
- 官方右栏可见性、`main.conversation` 优先级覆盖、`uiSession.adapter.current` 与独立 composer。
- Desktop 内存入口策略的精确 `needsWelcome` 谓词和调用点。
- 桌面未签名打包：上游 `electron-builder-config.mjs` 的 unsigned 分支与 `prepare-dsh.ts` 的签名准备块。上游自 0.2.1 起原生支持未签名构建，适配器只应保留 LWB 自己的便携包差异；替换文本失配必须失败，不能静默跳过。
- 能力包 AI 执行接缝：`subagents.startActivation` / `start`、`Agent.followup` / `whenIdle` / `cancel`、`AgentRegistry.create` / `get`、`SessionController.create` / `selectModel` / `prompt`，以及 `dsh-tools` / `dsh-llm` / `dsh-typert-protocol` 的导出。详见下一节。

### 能力包 AI 执行接缝

`npm run upstream:check` 现在会 import 锁定版本的 built 模块并检查下表；任何一项改名都会在升级门禁失败，而不是等到用户点“生成”才报错。

| 能力包用法 | 依赖的 DSH 表面 | 检查方式 |
|---|---|---|
| 结构化生成 | `SubagentRuntime.startActivation()`（0.2.1+）或 `start()`（0.1.x） | built prototype |
| 多轮创作 / 修复 | `Agent.followup()` / `whenIdle()` / `cancel()` | `dsh-agent` 的 `runtime-types.d.ts` |
| 多轮会话事件 | `Session.seq` + `ctx.on('session/event')`；`Session` 不再有 `.events` | built prototype + 带抛错 getter 的 pack fake |
| 包内会话 | `AgentRegistry.create/get`、`SessionController.create/selectModel/prompt` | built prototype |
| 结构化 schema / 工具 | `dsh-tools.assertObjectJsonSchema` / `defineTool` | built export |
| 流式投影 / 消息 | `dsh-llm.createUserMessage` / `expandAssistantStream` | built export |
| 包网关 | `dsh-typert-protocol.Remote` / `TypertRemoteService` | built export |

官方迁移说明（锁定版本内）：

- [subagent activation 迁移](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/docs/upgrade-guide/v0.2.1-alpha.1/subagent-activations/guide.zh.md)：`ctx.subagents.start()` / `startContinuable()` → `startActivation()`，并显式选择 `delivery`；`result` 在清理后结算，先检查 `stopReason`，再用 `dispose()` 处理取消和清理失败。
- [subagent preset 组装](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/docs/upgrade-guide/v0.2.1-alpha.1/subagent-preset-composition/guide.zh.md)：`persona` / `toolFilter` 已从 `SubagentStartRequest` 移除；需要这两项的调用方改用 `agentPreset`。

**2026-10-19 事故记录**：DSH 0.2.1-rc.2 把 `subagents.start(name, request)` 换成 `startActivation(spec)`，并让本地 Activation 在首轮 idle 后自然结算并 dispose 子代理。口播包仍调用旧方法，守卫把“方法不存在”误报成“当前环境不提供子代理执行接缝”，所有生成在约 40ms 内失败。修复把差异收敛在 `lwb/pack-sdk/dsh-execution.mjs`：

- 结构化生成走 `startActivation`（`delivery: 'caller'`，不向父会话注入完成通知），同时保留 0.1.x `start` 分支；
- 多轮视频创作不再使用子代理，而是在 `scope.withAgent()` 创建的 LWB 自有根 Agent 上执行 `followup` / `whenIdle`，因此修复轮和 max-token 续写仍发生在同一会话；
- `assertDshExecution` 在能力包加载时检查接缝，失败信息包含缺失的方法名和升级提示，不再等到生成时；
- `upstream:check` 增加上述 built 方法面断言，单测改为 mock LWB 执行契约而不是某个 DSH 版本的服务形状。

**同日第二个断点**：上述修复让视频导演成功启动后，多轮执行器又读 `agent.session.events.length`，而 DSH 0.2.1 的 `Session` 已不再暴露 `.events`，视频创作在 `directing` 阶段、第一次模型请求之前直接抛 `Cannot read properties of undefined (reading 'length')`。修复为：用 `agent.session.seq` 做轮次 boundary，用已经注册的 `ctx.on('session/event')` 捕获 `turn/end` / `assistant/message`，不再回读 Session 历史；单测的假 `Session` 改成 0.2.1 形状（只有 `seq`，读取 `events` 直接抛错），防止同类问题再次被宽松 fake 掩盖。`Session.snapshotEvents()` / `ownEvents()` 今天仍可用，但已标记为“禁止新增调用”，不作为修复方向。

升级时除 `npm run upstream:check`，还要跑 `npm test` 和 `npm run test:integration`；打包后按[开发入门](develop-a-pack.md#3-加入真实业务能力)的 AI 任务清单，至少各跑一次结构化生成与多轮创作（最低成本模型或 stub 均可）。

失败时修正当前 LWB 接缝，不静默打补丁或回退旧 API。架构见[总体架构](01-architecture.md)，UI 约定见[能力包契约](12-capability-packs.md)。付费模型/媒体、计费和签名发行需单独验收；历史测试数量不代表当前结果。

## 数据与回滚

更新前停止 Host，备份完整 `lwb/local/` 及环境变量指定的其他状态目录。回滚恢复匹配的代码、上游构建和数据副本；只回退 Git commit 不回退数据格式。

普通附件在 `DSH_HOME/attachments/`，业务产物在包工作区 `data/`，无旧 `.lwb/uploads/` 回退。见[运行数据目录](31-runtime-data-layout.md)。过去升级记录从[历史摘要](history.md)追溯，Desktop 发行边界见[双端说明](37-desktop-parity.md)。
