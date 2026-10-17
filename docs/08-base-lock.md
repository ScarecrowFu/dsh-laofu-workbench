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

失败时修正当前 LWB 接缝，不静默打补丁或回退旧 API。架构见[总体架构](01-architecture.md)，UI 约定见[能力包契约](12-capability-packs.md)。付费模型/媒体、计费和签名发行需单独验收；历史测试数量不代表当前结果。

## 数据与回滚

更新前停止 Host，备份完整 `lwb/local/` 及环境变量指定的其他状态目录。回滚恢复匹配的代码、上游构建和数据副本；只回退 Git commit 不回退数据格式。

普通附件在 `DSH_HOME/attachments/`，业务产物在包工作区 `data/`，无旧 `.lwb/uploads/` 回退。见[运行数据目录](31-runtime-data-layout.md)。过去升级记录从[历史摘要](history.md)追溯，Desktop 发行边界见[双端说明](37-desktop-parity.md)。
