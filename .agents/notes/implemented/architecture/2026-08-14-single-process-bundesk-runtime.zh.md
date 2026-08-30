# Agent Note: 单进程 BunDesk 运行时

Status: implemented

[English](2026-08-14-single-process-bundesk-runtime.md) | 中文

## 问题

最初的桌面 Release 设计让 `dsh web` 继续运行在 Node 上，而 BunDesk 只作为监管启动器。该方案虽然只下载一个文件，却包含两个运行时宿主和两个进程，不符合产品对单可执行文件、单 DSH host 进程的要求。此前直接从 Bun standalone 可执行文件加载完整 harness 并不可靠：Cordis 通过运行时字符串解析插件，部分插件家族会动态选择子入口，Bun 要求编译时已知 worker 入口文件，另有若干包假设 Node 专用 API 或依靠文件系统安装布局发现原生模块。

桌面版必须保留现有 profile composition 与 Web transport，不能另行实现一套行为不同的 GUI 服务。同时还必须继续为 Linux、Windows 和 macOS 的 x64 与 arm64 提供原生 Release 产物，并且不要求用户安装 Node 或 Bun。

## 决策

在 BunDesk 可执行文件的 Bun 进程内运行现有 `web` profile。CLI profile boot 路径现在是可调用的宿主 seam：调用方可以提供安装锚点、随附 preset 根目录、运行时路径、进程信号和补丁监听的所有权，以及裸模块 importer。loader 对以字符串命名的包使用该 importer，同时保留常规相对路径和文件路径解析。

桌面构建期间生成一个封闭的静态插件注册表。该注册表覆盖随附配置点名的包、可动态选择的目录选择器实现，以及每个导出 `./typert` 的 workspace 包。注册表的每个分支都使用编译器可见的 import，因此即使 Cordis 仍按运行时名称选择包，Bun 也会把插件代码收入可执行文件。直接从源码执行时，程序会根据包清单构建等价的 workspace 名称映射并 import 源码入口；外部包则回退到普通动态 import。

只嵌入必须以真实文件存在的数据：包清单、Cordis profile 与 preset、客户端 bundle、skill badge 资源和目标平台原生资源。程序会校验该归档，并通过安全路径与原子发布将其解压到按内容寻址、仅属主可访问的缓存。可执行的服务端和插件 JavaScript 仍位于 standalone 二进制内部；归档不包含 Node 运行时，也不包含部署后的 `node_modules` JavaScript 闭包。

分别 bundle 代码运行时和工作流 worker 入口，并把它们作为 standalone 编译时点名的文件资源嵌入。其宿主接受配置后的入口 URL。这样保留了真实 worker 隔离，但没有第二个 DSH host 进程。Node 继续使用已发布的 worker 入口；Bun 使用嵌入入口。

在拥有相应能力的包内提供有针对性的宿主兼容：

- SQLite provider 在 Bun 下选择 `bun:sqlite`，在 Node 下选择 `node:sqlite`。
- 代码运行时使用 Bun TypeScript transpiler；由于 Bun worker 的 ELU 尚未实现，它通过心跳实现连续卡死预算，并允许 worker pipe 为 null。Node 保留原生类型剥离与累计 event-loop-utilization 计量。
- 本地 subprocess provider 在 Bun 下使用 `Bun.Terminal`，在 Node 下延迟加载 `node-pty`。
- 图像 provider 接受可配置的 Sharp loader。目标构建静态嵌入 Sharp addon，启动时预加载解压出的目标 libvips 动态库。
- 搜索 provider 接受解压后的 packaged-ripgrep 路径，不再在运行时发现 optional 平台包。
- 仅为读取静态数据而使用 `createRequire` 的包改用 JSON import。Windows 专用 picker、ACL 和 Koffi 路径继续延迟加载并受平台条件保护。
- Windows 原生集成要求 Koffi 3.1.6 或更高版本；更早版本的 Koffi finalizer 会在原本成功的关闭流程结束后导致 Bun Windows 宿主崩溃。

保留 BunDesk 窗口约定：`--browser`、`--webview` 和 `--provider` 选择展示方式；Windows 与 Linux 默认使用 webview，macOS 默认使用 browser。关闭受管窗口或收到 `SIGINT`／`SIGTERM` 时，程序会 dispose 进程内 Cordis composition。进程内服务关闭时会关闭窗口。OS URL opener 回退仍由外部管理，因此无法报告浏览器关闭。

在 Bun 桌面宿主中禁用 Node 专用的实时 profile patch watcher。程序仍会在启动时读取 profile 层；之后修改 `cordis.patch.yml` 需要重启才能生效。

通过 GitHub Actions 构建六个目标平台原生单文件可执行文件。发布要求与仓库版本完全一致的 `desktop-v<repository-version>` 标签以及完整的六项产物；工作流会写入 `SHA256SUMS`，先上传到 Release 草稿，并仅在所有资源成功后公开。可执行文件 smoke 检查会抓取启动文档及其声明的全部客户端资源，然后验证嵌入的代码和工作流 worker、Sharp、ripgrep 与 Bun terminal 后端。

## 考虑过的替代方案

- 在自解压 BunDesk 启动器内保留 Node host。该方案能保留所有既有 Node 假设，但违反单进程要求，并产生重复运行时成本。
- 用第二个 Bun `dsh web` 进程替代 Node。该方案从 Release 移除了 Node，却仍违反单进程要求，并保留监管与跨进程生命周期复杂度。
- 让 standalone 可执行文件动态 import 任意解压后的插件 JavaScript。Bun 编译后的模块图无法可靠加载这份未 bundle 的 workspace 闭包，而且这样会恢复庞大的文件系统运行时并削弱构建时验证。
- 将完整生产 `node_modules` 树作为运行时数据嵌入。Bun 已经编译了其中大部分 JavaScript，这些文件没有必要；原生发现和 worker 入口限制仍需显式处理。
- 重新实现 Web 服务，或通过第二个 Bun 服务代理。现有 profile 已经负责 trusted-host 校验、启动状态注入、静态资源与 WebSocket transport；复制它会产生第二个行为真源。
- 使用 Electron。它会随附 Chromium 运行时、重复浏览器 transport，并且仍需另行决定如何托管 harness。

## 结果

Release 产品是一个可执行文件，只有一个 BunDesk/Bun DSH host 进程，不存在 Node host。browser 模式以及按设计执行命令的工具仍可创建外部操作系统进程；它们是宿主的消费方，不是另一套 harness 运行时。

随附插件集合有意保持封闭。自定义 profile 可以组合已包含的插件和解压出的配置，但无法加载编译后才安装的任意包；新增插件需要新的桌面构建和注册表入口。源码与基于包的 CLI 执行仍保留开放的文件系统模块解析。

目标平台原生包使 Release 构建必须在对应平台进行，不能任意交叉编译。六 runner Actions 矩阵负责可移植性验证。Windows 上的 WebView2，以及 Linux 上的 WebKit2GTK 与显示服务器仍是操作系统前置条件。macOS 产物使用临时签名；受信任的 Apple Developer ID 与 Windows Authenticode 签名仍是需要凭证的后续工作。

Bun 与 Node 存在少量有意记录的语义差异。尤其是 Bun 计算预算检测一次连续无响应区间，而不是精确累计多段短突发的忙碌时间；wall-clock 上限仍是共同兜底。仓库开发仍需要受支持的 Node 版本和 Bun，而 Release 可执行文件不要求安装二者。

增强后的编译产物 smoke 检查可以发现缺失的前端资源、插件 composition 失败、worker 入口不可用、原生图像链接失败、ripgrep 缺失和 PTY 启动失败。它不能替代交互式 webview 测试或目标平台原生 CI 矩阵。
