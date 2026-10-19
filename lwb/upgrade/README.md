# DSH Upgrade Workflow

只支持 `lwb/UPSTREAM.lock.json` 的当前版本。官方 checkout 必须无源码修改；产品扩展通过 Profile、Bundle、SDK 和单一版本适配层实现。业务层不保留旧 API 分支或旧数据迁移；**版本适配层**可以保留一个有测试和门禁约束的过渡分支（例如 `startActivation` / `start`），但能力包不得感知版本差异。

```bash
npm run upstream:refs     # 查看远端 refs，不改变锁
npm run setup             # 安装并构建精确版本；保留旧 checkout
npm run upstream:check    # 源码、锁、声明、UI 导出、服务端方法面和构建检查
npm test
npm run test:integration  # 临时数据根，真实 Host 加载/卸载/重启验收
```

升级时同步锁文件、DSH peer 依赖及适配实现，再执行上述门禁和两种载体的 UI 回归。失败时修正 LWB 接缝；不能自动回退旧 API，也不能静默打补丁。只有新版本验收通过才更新产品基线。

`upstream:check` 会直接 import 锁定版本的 built 模块，检查能力包实际调用的服务端表面（`subagents.startActivation` / `start`、`Agent.followup` / `whenIdle` / `cancel`、`Session.seq` 与 `session/event`、`AgentRegistry.create/get`、`SessionController.create/selectModel/prompt`，以及 `dsh-tools` / `dsh-llm` / `dsh-typert-protocol` 的导出）。任何改名应在这一步失败，而不是在用户点“生成”时失败。检查清单与 2026-10-19 的两次断点（`subagents.start` → `startActivation`；`Session.events` 移除）见[基座升级](../../docs/08-base-lock.md#能力包-ai-执行接缝)。

能力包不得直接 import `@deepseek-ai/dsh-subagent` 或调用 `subagents.start` / `startActivation`；结构化生成与多轮创作都走 `@scitiger-ai/lwb-pack-sdk/execution`，由该适配层吸收版本差异。新增能力包或改动执行路径后，除单测外还要各跑一次结构化生成与多轮创作（最低成本模型或 stub 均可）。

在 Rosetta / x64 Node 环境下，`test:integration` 启动的真实 Host 可能让 pnpm 在官方 checkout 写入本地 `supportedArchitectures`。测试后先恢复官方源码（`git -C vendor/deepseek-harness checkout -- pnpm-workspace.yaml`）再复跑 `upstream:check`；官方源码必须保持干净。

源码不被修改并不保证上游接口不变。版本相关接缝和当前验证范围见 [总体架构](../../docs/01-architecture.md)与[升级门禁](../../docs/08-base-lock.md)。旧版本和历史数据留存不是受支持的兼容分支；需要回滚时使用对应版本代码与独立数据副本。
