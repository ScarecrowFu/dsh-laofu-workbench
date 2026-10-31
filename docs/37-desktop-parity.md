# Desktop 与 Web 等价承载

LWB 桌面端使用锁定的官方 DSH Electron Desktop、Host 和 Web App。两种载体共用同一个 LWB Bundle、客户端页面和能力包业务代码；不维护另一套桌面业务 UI。

静态 Profile 只包含 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` 和 `@scitiger-ai/lwb-dsh-bundle`。能力包仍通过内部注册表动态加载、卸载和恢复。

## 启动

```bash
npm run setup
npm run dev:desktop
# 已构建后快速启动
npm run start:desktop
```

启动器调用官方 `initProfile`，然后调用官方 Desktop 开发入口。pnpm 从 Desktop 自己的依赖解析，无需根目录 `.bin/pnpm`。不会修改上游源码。

启动直接进入 LWB 工作台。DSH 账号是可选连接，在「设置 → DSH 系统设置」旁点击「登录 DSH」发起官方浏览器授权；成功后按钮变为「退出 DSH」。退出或会话过期后保留当前工作台页面，按钮恢复为「登录 DSH」，不会弹出官方欢迎窗口。模型和 API Key 仍通过「打开设置」配置。

当前锁定的官方版本没有欢迎窗口策略配置，LWB 在 `entry-policy.mjs` 中维护一个受版本检查约束的内存适配：只调整主进程 `needsWelcome` 的界面决策。官方源码和构建文件不改写，官方账号授权、凭据管理及任务取消继续执行。开发入口和安装版 bootstrap 共用此适配；详见[总体架构](01-architecture.md#扩展边界)和[升级门禁](08-base-lock.md)。

开发入口默认本地端口 19487（可用 `LWB_DESKTOP_PORT` 覆盖），避免和单独安装的官方应用冲突。以终端启动命令为开发运行入口，官方开发 Dock 启动器不是 LWB 发行包。

## 窗口拖拽

macOS 上窗口没有可拖的标题栏：官方壳用 `titleBarStyle: 'hiddenInset'`，`AppFrame` 也明确声明 frame 自己不带任何拖拽，`-webkit-app-region: drag` 在整个客户端只声明一次——ui-web `base.css` 针对 `html[data-platform='darwin'] [data-window-drag]`。Electron 按几何在文档顺序上合成这些盒子，**最后一个覆盖该点的盒子说了算**：`drag` 加几何、`no-drag` 减几何，没有标记的元素什么都不贡献。所以每一个压在窗口顶部、又要能点的面，都得自己标记一行；没人标记的那一段就是拖不动的死区。

这意味着「谁拥有这一列/这一面，谁就负责标记它的窗口行」。官方侧栏列的两行（`ui-sidebar` 的 `.topStrip` 与 `.logoRow`，即上游 ui-theme `CHROME_ROWS` 清单里的对应项）随 `ui-sidebar` 一起被本组合 `disabled`，因为 LWB 自己拥有侧栏槽位，所以这四行由 LWB 标记（都在 `lwb/dsh-bundle/client.js`）：

| 行 | 覆盖 | 说明 |
| --- | --- | --- |
| `.lwb-sidebar-chrome` | 侧栏列顶部 48px | 红绿灯让位的窗口带。占位由这一行本身提供（因此 darwin 下 `aside` 的 `padding-top` 为 0），`flex:none` 防止矮窗被 flex 压成 0，`sticky` 让列滚动时仍留在窗口边缘 |
| `.lwb-conversation-pane-head` | 会话列表列头 | 该列从窗口顶边开始，列头就是它的窗口行；头内的关闭按钮按 base.css 的交互元素规则自行让位 |
| `.lwb-conversation-gutter` | 会话列与官方对话列之间的间隙 | 两列各自独立、间隙是刻意留的，没有任何包拥有这段 chrome；它的位置与列偏移共用 `--lwb-conversation-panel-width` / `--lwb-conversation-gutter` |
| `.lwb-overlay-head` | 能力包 / 设置页页头 | 这一面盖住 frame 的各列，页头就是它的窗口行 |
| `.lwb-mobile-chrome` | 窄窗口（≤680px）窗口左缘 | 窄窗口把侧栏变成离屏抽屉，抽屉的窗口带随它一起离场；这条带只铺到对话列起始处，且排在移动端触发器之前，避免盖掉它们自己的控件 |

不确定的地方不用猜：CSS 合同由 `lwb/dsh-bundle/test/client-style-contract.test.mjs` 的门禁守住（标记、标记只在 darwin 生效、带宽与占位同源、不得自行声明 `drag`），侧栏那一行另有 `client-nav-preference.test.mjs` 的渲染断言。Windows 不受影响：frame 自己有 caption 行；Web 端没有拖拽区。

## 数据

| 内容 | 源码启动默认位置 |
| --- | --- |
| 产品数据根 | `lwb/local/current` |
| DSH 原生数据 | `lwb/local/current/dsh-home` |
| 注册表 | `lwb/local/current/packs.json` |
| 能力包工作区 | `lwb/local/current/pack-state` |
| Web 激活 Profile | `dsh-home/profiles/lwb` |
| Desktop 激活 Profile | `dsh-home/profiles/desktop` |
| Electron 窗口状态 | `lwb/local/current/electron-user-data` |

`LWB_PRODUCT_HOME` 可整体指定数据根；细分路径变量见 `.env.example`。旧数据目录保留，但不导入、不回退读取。切换两种载体前退出另一 Host；共享数据的并发写入尚不支持。DSH 的 Profile 偏好分别按各自 Profile 存储。

## 打包

```bash
npm run package:desktop -- --check
npm run package:desktop:dir
npm run package:desktop
```

先按官方 `apps/desktop/.env.macos.example` 或 `.env.windows.example` 配置对应的本地文件，使用产品自己的 app ID、更新服务、签名与公证资料。命令复用官方 release 准备和 electron-builder 配置工厂，追加 LWB bootstrap、入口策略与资源，不改写官方 main 或 Host 文件。

安装版由 bootstrap 在系统 appData 下创建产品数据根（可显式覆盖，见下节），将本次构建的产品资源放到可写 runtime 中，再通过公共 Profile API 装配 LWB，最后在加载官方 main 时应用上述入口策略。业务工作区在 runtime 外，能力包不静态启用。发布上传被禁用。

### 一键打包

在本机（macOS 或 Windows）打当前平台的可测试便携包，不需要手写环境变量：

```bash
npm run package:oneclick                 # commercial + 未签名便携包，版本号带 -test.<构建号>
npm run package:mac                      # 同上，但构建机不是 macOS 时直接报错
npm run package:mac:arm64                # macOS Apple Silicon 包
npm run package:mac:x64                  # macOS Intel 包（Intel 原生，或在 Apple Silicon 上经 Rosetta）
npm run package:win                      # 同上，但构建机不是 Windows 时直接报错
npm run package:oneclick -- --dry-run    # 只打印解析后的输入与将要执行的命令
npm run package:oneclick -- --plan       # 只解析版别与随带能力包
npm run package:oneclick -- --community --release
```

`scripts/package-desktop.mjs` 负责补齐三项输入，再复用官方打包流程：

| 输入 | 解析规则 |
| --- | --- |
| `LWB_COMMERCIAL_PACK_DIR` | 未设置时按 `../dsh-laofu-workbench-commercial`、`../laofu-commercial-pack` 顺序探测；显式设置的值不合法时直接失败，不会静默降级成 community |
| `LWB_DESKTOP_BUILD_NUMBER` | 未设置时用本地日期 `YYYYMMDD`；环境里的 `GITHUB_RUN_NUMBER` 次之 |
| `LWB_DESKTOP_TARGET_ARCH` / `--arch` | 未指定时跟随构建机；Windows 恒为 x64。macOS 的 `x64` 可在 Intel 上原生构建，也可在 Apple Silicon 上经 Rosetta 构建 |
| `ELECTRON_MIRROR` | 未设置时先探测 `github.com`；不可达才切到 `https://cdn.npmmirror.com/binaries/electron/`（`LWB_ELECTRON_MIRROR=off` 可关掉探测） |

目标平台由构建机决定，目标架构由 `--arch`（或 `LWB_DESKTOP_TARGET_ARCH`）决定，未指定时跟随构建机。Windows 包在 Windows x64 上构建：本机或发行 runner；`--host win --dry-run` 可以在 macOS 上查看 Windows 那条命令的确切内容。

macOS 的 arm64 包需要 Apple Silicon 构建机；x64 包可以在 Intel Mac 上原生构建，也可以在 Apple Silicon 上经 Rosetta 构建——准备阶段会用目标 Electron（x64）跑运行时冒烟，缺少 Rosetta 时打包在任何耗时步骤之前就报错。

### macOS 双架构（Apple Silicon / Intel）

两个 macOS 目标共用同一份产品代码和同一套构建输入，区别只在目标架构：

| 目标 | 产出 | 构建宿主 | 用户侧运行 |
| --- | --- | --- | --- |
| `mac-arm64` | `laofu-workbench-<版本>-mac-arm64-portable-unsigned.zip` | Apple Silicon Mac | Apple Silicon 原生 |
| `mac-x64` | `laofu-workbench-<版本>-mac-x64-portable-unsigned.zip` | Intel Mac 原生，或装了 Rosetta 2 的 Apple Silicon Mac | Intel 原生；Apple Silicon 经 Rosetta |

目标架构决定的不只是 Electron：内置 Node、Python 与 wheel、LibreOffice 引擎、Remotion compositor 以及 `node-pty` / `koffi` / `sharp` 都必须匹配。打包链为此做了四件事：

- `DSH_DESKTOP_TARGET_ARCH` 让官方准备下载并冒烟目标架构的 Electron 与解释器；
- payload 的 `npm ci` 在交叉架构时带上 `--os=darwin --cpu=x64`，否则会把宿主架构的可选依赖（例如 arm64 的 Remotion compositor）装进 x64 包；
- electron-builder 显式收到 `--x64` / `--arm64`，不再跟随构建进程架构；
- 构建 id 纳入目标架构，因此两个架构的可写 runtime 副本不会共用同一个 `runtime/<id>` 目录。

最低系统版本由 Electron 44.7.0 决定，macOS 13.0 起。

交叉架构构建的验收要按 Rosetta 的首次启动成本理解：新组装的 x64 bundle 在 Apple Silicon 上第一次执行要付一次翻译与系统扫描成本，实测 26–45 秒；同一路径第二次约 2–3 秒。打包内置的能力包验收会把超时预算按 4 倍放宽，因此构建耗时变长属于正常现象，不是宿主卡死。

```bash
npm run package:mac:x64                   # 本机 Apple Silicon 经 Rosetta 出 Intel 包
npm run package:mac:arm64                 # 本机 Apple Silicon 出 arm64 包
npm run package:oneclick -- --arch x64    # 等价的一键写法
npm run package:mac:x64 -- --dry-run      # 只看解析结果，不执行
node scripts/collect-desktop-artifacts.mjs --edition commercial --target mac-x64
```

### 发布到更新通道

`npm run release:desktop` 把一条已经打好并经校验的产物同时送到三个地方：阿里云 OSS（客户端实际下载的地址）、GitHub Draft Release（存档与公开可见）、ATS 的桌面发布记录（客户端检查更新时读的那一行）。版本号从 `build-report.json` 读取而不是手填，因为运行时 `app.getVersion()` 返回的正是 electron-builder 写进那个包的值。

每条腿单独执行，因为三个平台本来就出自不同机器：

```bash
npm run release:desktop -- --target mac-arm64 --notes notes/0.1.9.md
npm run release:desktop -- --target mac-x64
npm run release:desktop -- --target win-x64          # 在私有仓库的 Windows runner 上
npm run release:desktop -- --publish-all --version 0.1.9   # 三条腿齐了再统一上线
```

上传阶段一律写成**未发布**：ATS 的 `latest` 接口按 `platform` + `arch` 独立应答，若边传边发，某一刻不同平台会停在不同版本。`--publish-all` 才把同一版本的三条记录一起置为已发布，并逐条用公开接口反查，确认版本与 sha256 与本次构建一致。

两条硬性拒绝规则写在脚本里：`x.y.z` 之外的版本（例如 `0.1.9-test.20261030`）不允许进入更新通道——semver 把它排在它所基于的正式版之下，发上去等于给用户推送一次降级；产物与 `build-report.json` 的 sha256 或体积不符时直接失败。

凭证只从环境或未跟踪的 `.env.local` / `.env.release` 读取：`ATS_ADMIN_EMAIL` / `ATS_ADMIN_PASSWORD`（或 `ATS_ADMIN_TOKEN`）、`LWB_RELEASE_OSS_*`、`LWB_RELEASE_REPOSITORY` / `GH_TOKEN`。`--dry-run` 不需要任何凭证，只打印解析出的产物、对象键、公开地址与将要执行的请求。

## 自动更新

客户端自己检查、自己下载、自己替换，不依赖安装器、不依赖 electron-updater（LWB 打包 `unsigned`，产物里没有 `app-update.yml`，官方那条链路在本产品里恒为关闭）。

### 组成

| 文件 | 职责 |
| --- | --- |
| `lwb/dsh-bundle/updater/manifest.mjs` | 解析 ATS 的发布清单，按签名顺序重建后做 Ed25519 验签，再校验产品/平台/架构/通道/版本/文件名/大小 |
| `lwb/dsh-bundle/updater/manager.mjs` | 检查 → 下载（边下边算 sha256）→ 暂存；持久化状态、忽略某版本、读取上一轮更新结果 |
| `lwb/dsh-bundle/updater/installer.mjs` | 解析本机可替换的目标，写 job、把更新器脚本复制到数据目录并 detached 拉起 |
| `lwb/dsh-bundle/updater/scripts/lwb-update.sh` | macOS：`ditto` 解压 → 换名替换 `.app` → 去 quarantine → `open` 重开 |
| `lwb/dsh-bundle/updater/scripts/lwb-update.{cmd,ps1}` | Windows：`Move-Item` 换名替换便携 exe → `Start-Process` 重开 |
| `lwb/dsh-bundle/updater-gateway.mjs` | 对浏览器暴露 `state/check/install/ignore/dismiss` |
| 左下角提示 | `client.js` 的 `.lwb-update-pill`（折叠态只剩圆点）+ 更新面板 |

### 为什么必须是外部更新器

Windows 上正在运行的 exe 被占用，macOS 上应用自己就住在要被替换的那个包里——主程序无法替换自己。所以真正做替换的是脚本，而脚本**不能住在应用里**：Windows 便携外壳在主进程退出后会清空临时解压目录，macOS 被替换的正是脚本所在的那个 bundle。因此 `installer.mjs` 先把脚本复制到 `productHome/updates/jobs/<version>-<sha8>/`，再从那里拉起。

替换方式是**同卷换名**：新包先解压到目标旁边（`<target 所在目录>/.lwb-update.XXXX`），再 `mv` 过去。同卷 rename 是原子的，所以应用要么是旧包、要么是新包，不存在拷到一半的树。旧包保留到新包就位并重启成功之后，任何一步失败都换回去。

### 等待与停进程

脚本拿到的 `LWB_UPDATE_WAIT_PID` 是 Electron 主进程，`LWB_UPDATE_HOST_PID` 是 DSH Host。macOS 先 `SIGTERM`（走正常的窗口关闭），8 拍后 `SIGKILL`；Windows 直接 `Stop-Process`，然后**重试换名**——便携外壳在主程序退出后还要几秒钟才释放 exe，一次失败就放弃会让更新永远卡在最后一步。

替换成功这件事本身就证明旧进程已经退出：Windows 上正在运行的 exe 根本换不掉，macOS 上脚本会先等到 pid 结束。因此重开时不会撞上 `bootstrap.mjs` 的 `requestSingleInstanceLock` 把新窗口挡回去——那条分支只会在旧应用还活着时触发。

### 版本号的唯一来源

同一台机器上的版本号只能有一个来源，否则设置页显示的和更新比较用的会悄悄分叉：

- 打包版读 `build.json` 的 `version`（`-test.N` 构建要如实带上后缀，因为它确实不是那个版本）；
- 源码检出没有 `build.json`，读 `package.json`——也就是发布时真正被抬升的那一个字段；
- `cordis.patch.yml` **不再写版本**。它曾经写着 `0.1.0`，而发布流程只改 `package.json`，于是界面上那个数字从来没跟发布对齐过。

`readProductVersion()` 按这个顺序解析，`runtime-config.test.mjs` 会比对它和 `package.json`，并检查组合文件里没有重新长出版本字段。

### 只在正式构建里生效

`build.json` 现在带 `version / release / product / channel / platform / arch`：

- 源码检出没有 `build.json` → `enabled=false`；
- `-test.N` 构建 `release=false` → 不检查更新。测试包即使手动发到 ATS 也不会被自己当成正式版；
- 版本号同时被折进 build id，所以换版本一定换运行时目录（否则 `runtime/<id>` 复用会让新包读到旧版本号）。

`bootstrap.mjs` 负责把 `LWB_DESKTOP_EXECUTABLE` / `LWB_DESKTOP_APP_BUNDLE` / `LWB_DESKTOP_PORTABLE_FILE` 传下去：Host 是 `ELECTRON_RUN_AS_NODE` 子进程，它看到的 `process.execPath` 是 Electron 本体，Windows 上更是便携外壳临时目录里的那份，直接拿它替换等于替换了个临时文件。

### 已知边界

- macOS 未签名包首次启动仍会被 Gatekeeper 拦一次（更新器会清 quarantine，但签名本身没有）；
- 从磁盘映像（DMG）里直接运行的应用所在目录不可写，`canInstall=false`，面板只说明原因、不给按钮；
- 安装版（非便携）Windows 构建不支持自动替换，同样只说明原因。


### Windows 构建输入（产品源码快照）

Windows 的 `Desktop portable test builds` **不克隆本仓库**：它解压私有商业仓库里签入的 `.build/product-source.tar.gz` 作为产品源码，插件的 `pack-source` 则来自该仓库自身的 HEAD。因此公开仓库推送之后，还必须刷新这份快照，否则 Windows 包仍是上一次快照的内容：

```bash
npm run snapshot:product                      # 归档 origin/main（可复现，同一提交同一 sha256）
npm run snapshot:product -- --ref <commit>    # 归档指定提交
npm run snapshot:product -- --worktree        # 归档当前工作区（含未提交改动，记录会标记）
npm run snapshot:product -- --dry-run         # 只报告将写入什么
```

默认写入 `../dsh-laofu-workbench-commercial/.build/`：新的 `product-source.tar.gz` 与更新后的 `inputs.json`。`inputs.json` 只刷新本次能确定的三项（`productSnapshotCommit`、`productArchiveSha256`、`includesLocalTrackedChanges`），`productBaseCommit`、`commercialBaseCommit`、`mode`、`buildHosts`、`targets`、`editions` 等发布输入保持不变。该文件没有任何工具读取，只作溯源记录。刷新后需在私有仓库提交推送 `.build/`，再触发 workflow。构建结束后脚本打印本次新增的产物、大小与 SHA256，并给出可复现的命令行。`--signed` 改用官方签名环境文件，`--release` 使用正式版本号，`--dir` 只出未打包 App。发行用的 `SHA256SUMS.txt` 与构建报告仍由 `node scripts/collect-desktop-artifacts.mjs --edition <edition> --target <target>` 汇总。版本号和是否正式版都从产物里的 `build.json` 读取，不依赖运行时的环境变量；只汇总文件名带本次版本号的产物，目录里残留的旧版本文件不会被算进去。

### 统一官方便携版构建

当前阶段发布便携版测试包，不需要安装器或管理员权限。缺少正式发行证书时，可构建未签名便携包：

```bash
# 官方完整发行版需要私有会员能力包源码
LWB_COMMERCIAL_PACK_DIR=/absolute/path/to/commercial-pack npm run package:desktop:official -- --unsigned --portable
```

也可以显式构建便携版（正式签名环境仍需配置）：

```bash
npm run package:desktop:portable                 # 公开源码开发包
LWB_COMMERCIAL_PACK_DIR=/absolute/path/to/commercial-pack npm run package:desktop:official -- --portable
```

Windows 产物是可直接运行的 portable `.exe`，macOS 产物是包含 `.app` 的 `.zip`，不生成 NSIS 安装器或 DMG。程序数据写入用户数据目录，不要求把压缩包目录作为可写目录。未签名模式不读取签名环境文件，不调用 Apple 公证或 Windows 签名硬件。macOS 原生组件使用临时 ad-hoc 签名满足对应架构的加载要求，不代表 Developer ID 签名或公证；首次打开仍可能受到 Gatekeeper 或 SmartScreen 提示。

macOS payload 的原生依赖在签名之前会重写加载路径。`@remotion/compositor-darwin-*` 的 `ffmpeg` / `ffprobe` / `remotion` 与七个 `libav*` dylib 用的是裸相对名（`libavdevice.dylib`），dyld 只在未硬化的进程里才肯按工作目录解析这些名字；而产物给整个 payload（含 `lwb-product/node_modules`）做的是 hardened runtime 签名，于是这些引用会被直接拒绝——`Library not loaded: libavdevice.dylib` / `relative path not allowed in hardened program`，打包版里所有视频导出都因此 SIGABRT，而开发态用仓库里那份未硬化的副本，永远复现不出来。打包步骤把它们改成 `@loader_path/<name>`：保留 hardened runtime（上游强制、公证预期），也不再有工作目录依赖。重写后的字节计入构建 id（否则同一 id 的旧 runtime 副本会继续被沿用），`lwb/desktop/darwin-library-paths.test.mjs` 会在硬化签名下真的把二进制跑一遍；打包时若仍有裸名残留则直接失败。

官方便携版不再经过 electron-updater：那条链路要求 `app-update.yml`，而未签名产物里没有，所以它恒为关闭。替换由本产品自带的更新器完成，见上节「自动更新」。发行版使用 LWB 根版本号；构建编号仅用于 Windows 构建目录和两端构建关联。文件名明确带 `-portable-unsigned`，官方发行版统一使用 `LaofuWorkbench` 的应用身份和数据目录。

Windows 官方发行版在商业私有仓库的自托管 Windows x64 Runner 上构建，通过 Actions 的 `Desktop portable test builds` 手动触发，填写构建编号。macOS 官方发行版在本机构建：Apple Silicon 出 arm64 包，Intel 包在 Intel Mac 上原生构建，或在 Apple Silicon 上经 Rosetta 构建：

```bash
export LWB_DESKTOP_BUILD_NUMBER=20261003
LWB_COMMERCIAL_PACK_DIR=/absolute/path/to/commercial-pack npm run package:desktop:official -- --unsigned --portable --release --arch arm64
node scripts/collect-desktop-artifacts.mjs --edition commercial --target mac-arm64
LWB_COMMERCIAL_PACK_DIR=/absolute/path/to/commercial-pack npm run package:desktop:official -- --unsigned --portable --release --arch x64
node scripts/collect-desktop-artifacts.mjs --edition commercial --target mac-x64
```

两个架构的产物文件名都带架构后缀，可以同时挂到同一个 Draft Release。

官方产物必须通过实际打包宿主的能力包加载、卸载、重新加载、浏览器模块注册和重启恢复验收。验收还要包含一次**打包版视频导出**（竞技台导出 MP4 与口播成片各一次）：这类原生依赖只在打包版里被硬化签名，开发态用的是仓库副本，渲染链路必须实测，不能用开发态结果代替。交叉架构构建（Apple Silicon 上打 x64）还要预留首次启动时间：内置验收已按 4 倍放宽超时，人工复验时同样不要用 30 秒内的启动结果判断失败。Windows workflow 和本机 macOS 构建将成品、SHA256 校验值和构建报告汇总到公开仓库的同一个 Draft Release，验收通过后发布为正式 Release。未签名状态会在发布说明和构建报告中明确标注。

官方源码保持原样。未签名模式通过仅在构建子进程启用的内存适配复用官方运行时准备、完整性校验与烟雾测试；适配与锁定的上游结构不匹配时会报错。此模式只用于测试分发，正式签名构建仍使用原有校验。

## 构建输入与官方发行版

安装包随带哪些能力包由**构建输入**决定，不由工作树状态决定。代码保留 `community` 和 `commercial` 两个内部构建输入，分别用于公开源码开发包和官方完整发行包；用户下载的发行版只有一个，不再按版本名称区分。

| 构建输入 | 产品名 | 数据根 | 协议 | 随带能力包 |
| --- | --- | --- | --- | --- |
| `community` | Laofu Workbench | `LaofuWorkbench` | `lwb://` | 本仓库自有的 `spoken-video`、`ai-arena`、`model-review` |
| `commercial`（官方发行） | Laofu Workbench | `LaofuWorkbench` | `lwb://` | 公开包加上 `yuchi`，源码由 `LWB_COMMERCIAL_PACK_DIR/packs/yuchi` 指定 |

```bash
LWB_COMMERCIAL_PACK_DIR=/absolute/path/to/commercial-pack npm run package:plan -- --edition commercial
LWB_COMMERCIAL_PACK_DIR=/absolute/path/to/commercial-pack npm run package:desktop:official
```

规则：

- 未声明 `source` 的能力包必须由本仓库拥有：目录在 `lwb/packs/<id>`，且 `lwb-pack.json` 已被 Git 跟踪。`lwb/packs/` 下出现非本仓库的目录时打包直接失败，提示改用 `npm run pack:install` 登记。
- 声明了 `source` 的能力包是构建方给出的绝对目录，用 `${VARIABLE}` 固定到具体 checkout。会员包源码因此不必进入本仓库：官方发行版是**同一个内核加额外的会员能力包**，不需要第二份工作台内核。
- 商业 checkout（`LWB_COMMERCIAL_PACK_DIR`，未设置时取本仓库旁边的 `dsh-laofu-workbench-commercial`）本身不是能力包，每个商业包放在它的 `packs/<id>` 下；识别依据只是 `packs/` 目录存在。哪些包属于商业版只由 `editions.json` 决定，宿主代码不写死任何商业包 id。
- 只有清单列出的能力包会被复制进产物。版本解析在打包环境校验之前完成，所以包集合写错时不需要签名资料就会失败。
- 每个能力包在打包时用宿主加载能力包时的同一套规则校验（`inspectLwbPack`），运行时会被拒绝的包无法进入产物。
- 构建 id 只由上游 commit、版本名、清单内能力包内容和依赖锁决定。能力包按 id 计入，因此同一份商业包换一个 checkout 目录不会改变构建 id。
- 依赖、能力包测试目录和仓库元数据（`.git`）一律不进产物。
- 官方发行版使用统一的数据根与协议；产品身份写进 `build.json`，由 bootstrap 在运行时读取。首次升级商业版时会承接到统一的 `LaofuWorkbench` 数据目录。

### 调整能力包的公开 / 商业归属

一个包属于公开还是商业，由三处一起决定：源码所在仓库（决定许可证）、`editions.json`（决定随带范围）、`lwb-pack.json` 的 `access`（决定是否要求会员）。商业包一律要求会员。调整归属不需要改宿主代码：

| 方向 | 操作 |
|---|---|
| 公开 → 商业 | 目录从 `lwb/packs/<id>` 移到商业 checkout 的 `packs/<id>`，`package.json` 的 `license` 改为 `UNLICENSED`；`editions.json` 里从 `community` 移除，`commercial` 中该项加上 `"source": "${LWB_COMMERCIAL_PACK_DIR}/packs/<id>"`；清单加上 `"access": {"account": "lwb", "membershipRequired": true}` |
| 商业 → 公开 | 反向操作：目录移入 `lwb/packs/<id>` 并由 Git 跟踪，`license` 改为本仓库许可证，`editions.json` 两个构建输入都列出且不写 `source`，清单删除 `access`；同步本文、README 与[许可证说明](licensing-and-commercial-use.md)的能力包表格 |

包数据按 id 存放在 `pack-state/workspaces/<id>/`，归属调整不影响已有数据。开发机上若 `lwb/local/current/packs.json` 还登记着旧的源码路径，用 `npm run pack:remove -- <id>` 清掉，让市场重新发现。

当前仓库未配置 macOS 签名环境，因此已验证开发入口、打包预检报错路径和公开源码/官方完整构建输入的包集合解析；尚未生成、安装或验收签名发行包。Windows 打包也需在目标环境验收。详细边界与升级门禁见 [总体架构](01-architecture.md#扩展边界)和[升级门禁](08-base-lock.md)。
