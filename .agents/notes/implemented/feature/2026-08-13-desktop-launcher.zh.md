# Agent Note: BunDesk 桌面启动器

Status: implemented

[English](2026-08-13-desktop-launcher.md) | 中文

## 问题

DeepSeek Harness 通过 `dsh web` 提供完整的图形体验，但此前没有拥有原生窗口并将该窗口与服务生命周期绑定的桌面入口。在另一运行时下重新实现宿主会拆分现有的插件组合与传输行为。

## 决策

- 新增发布应用 `@deepseek-ai/dsh-desktop`，其 Bun 入口负责监管已发布的 Node `dsh web` 可执行文件。
- 将稳定输出 `dsh web: http://127.0.0.1:<port>` 作为就绪约定，验证其为回环 HTTP 地址后再打开窗口。
- 通过 BunDesk 在 Windows 上使用 WebView2、在 Linux 上使用 WebKitGTK，或打开独立的 Chromium 或 Firefox 窗口；提供 `--browser`、`--webview` 和 `--provider` 作为显式选择。
- 绑定双方生命周期：关闭窗口或收到终止信号会停止服务，服务退出也会关闭窗口。
- 为 Linux、Windows 和 macOS 的 x64 与 arm64 构建六个原生单文件 Release 可执行文件。每个编译后的 BunDesk 启动器都嵌入一个归档文件，其中包含官方 Node.js 24 可执行文件，以及从 `@deepseek-ai/dsh` 可达的完整生产 workspace 闭包。
- 校验嵌入归档文件，并将其一次性写入按内容寻址、仅属主可访问的缓存中。解压过程拒绝绝对路径、向上穿越路径、非规范路径、反斜杠路径和重复路径；完成哈希与原子目录重命名可避免并发或中断的启动使用不完整文件。
- 由手动派发的 GitHub Actions 工作流构建并冒烟测试全部六个目标。发布需要与仓库版本完全一致的 `desktop-v<repository-version>` 标签和完整目标集合；工作流会写入 `SHA256SUMS`、上传到 GitHub Release 草稿，并仅在全部产物成功后公开该草稿。

## 考虑过的替代方案

- 未采用 Electron `file://` 外壳，因为仓库没有桌面 IPC 桥接层，该方案会重复浏览器传输并增加随附的 Chromium 运行时。
- 未采用由 Bun 运行 DeepSeek Harness 本身的方案，因为受支持的宿主运行时是 Node.js，且依赖图包含 Node 原生行为。
- 未采用第二层代理或 Bun HTTP 服务，因为现有服务已经负责可信主机检查、注入启动状态、静态资源和 WebSocket 传输。
- 未采用将 harness 本身编译进 Bun 启动器的方案，因为动态 Cordis 插件加载、worker 文件和 Node 原生包需要受支持的 Node 模块运行时。自解压 Node 闭包可以保留这些语义，同时使下载产物保持为一个文件。

## 结果

- Web UI 与服务组合保持不变，浏览器行为继续作为桌面渲染的真源。
- 从源码执行需要 Bun 和 Node.js，而 Release 可执行文件不要求安装这两个运行时。
- 原生 webview 安装仍是操作系统前置条件，浏览器模式可作为可移植的回退方案。
- 帮助信息具有无密钥的组装快照，冒烟模式则无需打开窗口即可验证真实服务就绪与 HTML 交付。
- 同时携带两个运行时和完整 harness 闭包会产生较大的下载文件与首次运行缓存。按内容寻址的复用可避免同一载荷重复承担该开销。
- macOS 产物会获得临时签名；受信任的 Apple Developer ID 与 Windows Authenticode 签名仍属于独立的凭证化发布工作。
