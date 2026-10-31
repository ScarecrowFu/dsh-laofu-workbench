# 运行数据目录与原生附件

更新日期：2026-10-11。当前路径如下；旧数据文件保留但不迁移或回退读取。

## 目录契约

产品默认持久化运行数据以 `lwb/local/current/` 为唯一入口，源码与运行数据分离。

```text
lwb/local/current/
├── packs.json
├── dsh-home/                 # DSH 原生凭据、会话、附件、工作区等
│   └── profiles/             # 原生 Profile 配置和依赖链接
│       ├── lwb/
│       └── desktop/
├── electron-user-data/       # 窗口状态
└── pack-state/
    ├── ownership.json
    ├── workspaces/           # 每个能力包一个专属工作区
    │   ├── spoken-video/
    │   │   ├── settings/     # media.json、publish.json；不含模型密钥
    │   │   └── data/         # 账号、项目、任务、媒体
    │   ├── ai-arena/
    │   │   ├── settings/     # arena-voices.json（选手与主持人的音色匹配）
    │   │   └── data/matches/<matchId>/   # match.json、audio/、离线回放与 MP4 产物
    │   └── model-review/     # 题库、任务历史与 runs/<taskId>/<runId>/ 会话目录
    └── retained/             # “清空业务数据”留下的可恢复副本
```

目录按需创建，上面列出当前会出现的三个能力包工作区：`spoken-video`、`ai-arena` 与 `model-review` 随仓库提供；私有会员能力包（如官方发行版的 `yuchi`）加载后同样在这里出现自己的工作区。空白实例不预置账号、会话或能力包业务数据。能力包的根目录由宿主分配，口播模块通过同一 `spokenVideoDataPath()` 函数定位 `data/`，竞技台把每场比赛落在 `<工作区>/data/matches/<matchId>/` 下（`match.json` 是比赛全部输入输出与导出索引，`audio/` 是逐句语音缓存，`replay.html` 与横竖屏 MP4 是导出产物），删掉某一场的目录即从列表消失、不影响其他场。普通工作区的源码和用户要求 Agent 创建的文件仍属于用户自己的目录，不属于产品运行状态。

需要隔离并行运行的包可以在工作区内为每次运行申请一个目录（`sessions.create({ cwd })`，路径限定在包工作区内并逐段拒绝符号链接）。模型博主测评使用 `<包工作区>/runs/<taskId>/<runId>/`：一次测评一个任务目录，任务下每个模型会话一个目录，产物按会话归属。见 [包内会话与官方右栏](12-capability-packs.md#包内会话与官方右栏)。

测试可通过 `LWB_DSH_HOME`、`LWB_PACK_REGISTRY` 指定独立临时位置。自动化测试使用退出后删除的系统临时目录；手动巡检使用 `lwb/local/verification/`，结束后删除，不能在项目根目录建立新的数据入口。

## 普通对话附件

上传、上传回执、待发送附件、消息绑定、历史展示和持久化全部由 DSH 原生服务负责。LWB 不再提供上传模式选择，不注册 `lwbFiles` RPC，不覆盖附件栏或用户消息渲染器，也不修改原生 Session 的 prompt 方法。

已移除旧 `file-intake-*.mjs`、浏览器兼容组件、旧模式开关、专用依赖链接及其测试。Profile 检查继续要求原生 `file-upload` 和 `ui-attachment` 模块存在，并检查旧接管逻辑没有重新装配。

## 调度与工作区隔离

信号自动采集、任务中断恢复和定时内容生产只处理宿主指定的能力包工作区。旧的跨普通工作区索引及读写回退已删除；不再生成 `spoken-video-schedule-workspaces.json`。

内容存储和调度器会拒绝与其绑定目录不一致的上下文。业务目录仍检查符号链接，避免将数据写入另一个工作区。卸载、重新加载、清空和保留副本仍以整个能力包工作区为单位。

## 当前切换与验证

开发期允许不兼容旧数据；旧文件不删除，新版本不读取。用 `LWB_PRODUCT_HOME` 指向独立位置可整体隔离测试实例。两个 Host 不能并发修改同一根目录。DSH 原生 Profile 偏好分别存储。

`npm test` 覆盖业务工作区隔离、设置原子写入、卸载生命周期与原生 Profile 装配；`npm run test:integration` 在临时数据根实测加载、卸载、重载、账号持久化与重启恢复。付费供应商调用另行验证。详见 [升级门禁](08-base-lock.md)。
