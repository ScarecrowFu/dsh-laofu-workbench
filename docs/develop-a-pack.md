# 开发场景能力包

场景能力包是可动态加载的 DSH 插件，包含菜单、业务页面和可选的后端服务。工作台负责发现、加载、卸载、专属工作区与共享执行能力，包负责自己的业务流程。

口播视频内容创作是第一个实际业务包，可用于参考复杂的任务、媒体与持久化实现。下面的最小示例仅用于说明扩展契约，**不会作为内置 Demo 加入市场**。

## 1. 创建独立目录

在仓库外准备一个绝对路径目录，例如 `/absolute/path/to/my-pack`，放置以下四个文件。示例统一使用包 ID `my-pack`、npm 包名 `lwb-my-pack` 和菜单 ID `home`。

### lwb-pack.json

```json
{
  "schemaVersion": 1,
  "id": "my-pack",
  "packageName": "lwb-my-pack",
  "name": "我的场景包",
  "version": "0.1.0",
  "description": "用于验证独立场景包的注册与页面加载。",
  "menus": [
    { "id": "home", "label": "首页", "glyph": "页", "tone": "blue" }
  ]
}
```

### package.json

```json
{
  "name": "lwb-my-pack",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "index.mjs",
  "exports": {
    ".": "./index.mjs",
    "./client": "./client.js",
    "./lwb-pack.json": "./lwb-pack.json",
    "./package.json": "./package.json"
  },
  "peerDependencies": {
    "@scitiger-ai/lwb-pack-sdk": "workspace:*"
  },
  "dsh": {
    "client": {
      "platform": "web",
      "inject": ["@scitiger-ai/lwb-dsh-bundle"]
    }
  }
}
```

示例中的 SDK peer 由 LWB 加载器链接到当前工作台的版本，不需要为这个最小包单独执行 `npm install`。其他第三方依赖需由包作者自行安装、构建；当前没有在线发布或依赖安装服务。

### index.mjs

```js
import manifest from './lwb-pack.json' with { type: 'json' }
import { registerLwbPack } from '@scitiger-ai/lwb-pack-sdk'

export const inject = ['lwbPackRegistry']

export function apply(ctx, config = {}) {
  if (config.clientOnly) return
  ctx.effect(() => registerLwbPack(ctx, manifest), 'my-pack: register')
}
```

### client.js

```js
window.__ModuleLoader__.load({
  id: 'lwb-my-pack',
  inject: ['@scitiger-ai/lwb-dsh-bundle'],
  external: ['react'],
  factory(require) {
    const React = require('react');
    function HomePage() {
      return React.createElement('section', null,
        React.createElement('h2', null, '我的场景包'),
        React.createElement('p', null, '独立页面已加载。'));
    }
    async function apply(ctx) {
      ctx.effect(() => ctx.lwbPackClient.register({
        packId: 'my-pack',
        pages: { home: HomePage },
      }), 'my-pack: register pages');
    }
    return { inject: ['lwbPackClient'], apply };
  },
});
```

包名必须在两个 JSON 文件和浏览器模块 ID 中一致；版本也应一致。`pages` 的键必须对应 manifest 中的菜单 ID。host 和 client 都通过 `ctx.effect()` 返回注销回调，卸载时才能清理贡献。

## 2. 注册和加载

先按[快速开始](quickstart.md)构建并启动工作台，再在项目根目录执行：

```bash
npm run pack:install -- /absolute/path/to/my-pack
npm run pack:list
```

然后进入「场景能力包」，找到“我的场景包”并加载。验证左侧菜单出现，点击“首页”能够看到示例文字。卸载后菜单应消失，再次加载应恢复且不重复注册。

`pack:install` 登记本机源目录，不复制源码、不上传 npm，也不会直接启用。包目录应保持存在。开发时修改源码后，卸载并重新加载；涉及基础 Profile 或工作台后端改动时重启服务。

移除外部包时，先在页面卸载，再执行：

```bash
npm run pack:remove -- my-pack
```

此命令删除市场源登记，保留源码和业务数据。仓库 `lwb/packs/` 下的包会被自动发现，因此删除登记不会隐藏仍存在于该目录的包。

## 3. 加入真实业务能力

最小示例没有业务存储或 AI 任务。实现业务包时，按以下契约逐步增加：

- **专属数据**：host 声明 `lwbPackServices` 依赖，使用 SDK 的 `getLwbPackScope(ctx, manifest)` 获取作用域；`scope.context()` 提供宿主分配的工作区。不要由浏览器传入任意路径决定存储位置。
- **前后端通信**：注册包自己的 DSH RPC 服务，页面调用业务接口；参考口播包的 [gateway.mjs](../lwb/packs/spoken-video/gateway.mjs)。
- **AI 任务**：通过 `scope.withAgent()` 获取受管理的内部 Agent，使用工作台的「场景任务默认模型」；该设置可跟随 DSH 默认模型，也可指定独立模型。普通页面数据读取无需创建 Agent。结构化/一次性生成使用 `@scitiger-ai/lwb-pack-sdk/execution` 的 `createDshExecutor(..., true)`；多轮创作与修复使用同一 SDK 的非结构化执行器（在 `scope.withAgent()` 的根 Agent 上 `followup` / `whenIdle`）。**不要直接 import `@deepseek-ai/dsh-subagent` 或调用 `subagents.start` / `startActivation`**：DSH 的版本差异由 SDK 适配层吸收，能力包只依赖 LWB 契约。多轮会话不要读 `Session.events`（0.2.1 已移除）；用 `session.seq` 做轮次边界，用 `ctx.on('session/event')` 消费 `turn/end` 与 `assistant/message`。
- **后台生命周期**：使用 `scope.request()`、`scope.background()` 跟踪完整操作，接入取消信号与 `scope.onStop()`；卸载必须能停止计时器并等待写入结束。
- **业务配置**：使用包级设置命名空间及凭据接口，勿将密钥写入 manifest、前端脚本或 Git。
- **样式与页面**：动态样式设置自己的 `data-plugin` 包名，样式选择器避免污染其他包；遵循工作台的主题与可用画布。

专属目录与受管理的任务不等于对任意第三方 JS 的安全沙箱。包代码在本机运行，作者应清楚记录网络连接、外部依赖、收费接口与数据用途。

完整接口见[能力包契约](12-capability-packs.md)和[工作区与执行作用域](12-capability-packs.md#工作区与执行作用域)。提交新包之前，应验证首次加载、卸载、重载、后台取消、错误展示、数据持久化和对其他包的隔离。
