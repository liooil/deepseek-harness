# `@deepseek-ai/dsh-desktop`

[English](README.md) | 中文

本包是 DeepSeek Harness 的 BunDesk 桌面启动器。它会监管现有的 Node `dsh web` 进程，等待其稳定的回环就绪地址，然后在原生系统 webview 或独立浏览器窗口中打开该地址。GitHub Release 提供原生单文件可执行文件，其中嵌入了 Node.js、BunDesk、Web UI 和完整的 `dsh` 运行时。

## 要求

- Release 可执行文件不需要安装 Node.js、Bun 或 NPM 包。
- 从源码运行需要 Node.js `^22.19.0` 或 `>=24.0.0`，以及 [Bun](https://bun.sh) `>=1.3.14`。
- Windows webview 模式需要 WebView2 Runtime。
- Linux webview 模式需要 WebKit2GTK 4.1 技术栈和显示服务器。

## Release 可执行文件

`Release (desktop)` GitHub Actions 工作流会在原生托管 runner 上构建 `dsh-desktop-{linux,windows,macos}-{x64,arm64}`。手动运行会将每个可执行文件分别保留为产物。发布运行只接受与仓库版本完全一致的 `desktop-v<repository-version>` 标签；它会检查六个文件全部存在、记录 `SHA256SUMS`、通过 GitHub Release 草稿上传，并在所有文件上传成功后公开 Release。

首次执行会启动服务的命令时，程序会校验嵌入的归档文件，并将其解压到按内容寻址、仅属主可访问的用户缓存中。完整解压结果会被复用。解压过程拒绝不安全的归档路径，并通过原子重命名发布新的缓存目录，因此并发启动不会使用不完整的运行时。

## 从源码运行

启动前请先构建包和 Web UI 产物：

```sh
pnpm install
pnpm run build
pnpm desktop
```

运行命令时所在的目录是 DeepSeek Harness workspace。可使用 `--cwd` 选择其他 workspace。

## 选项

| 选项 | 用途 |
|---|---|
| `--browser` | 打开独立的 Chromium 或 Firefox 窗口。 |
| `--webview` | 在 Windows 上打开 WebView2，或在 Linux 上打开 WebKitGTK。 |
| `--provider <browser\|webview>` | 显式选择窗口提供方。 |
| `--cwd <directory>` | 选择 workspace 目录。 |
| `--port <port>` | 选择回环服务端口；`0` 表示选择空闲端口。 |
| `--smoke` | 启动并抓取 Web UI，但不打开窗口。 |
| `--help` | 打印帮助且不启动服务。 |
| `--version` | 打印启动器版本。 |

Windows 和 Linux 默认使用 `webview`。macOS 默认使用 `browser`，因为 BunDesk 尚未提供 macOS 进程内 webview。

## 生命周期

启动器会将 `dsh web` 日志输出到自身终端。关闭受管窗口会终止服务，服务退出也会关闭窗口。`SIGINT` 和 `SIGTERM` 同样会关闭双方；如有必要，启动器会在有界的优雅关闭等待后强制终止服务。

## 已知限制和延期工作

- 当 BunDesk 回退到操作系统 URL 打开器时，它无法观察由外部管理的浏览器窗口何时关闭；请使用 `Ctrl+C` 停止服务。
- Release 可执行文件同时携带 Bun 启动器和基于 Node 的 harness 闭包，因此下载文件和首次解压结果都比较大。
- 工作流会对 macOS 可执行文件进行临时签名，但不使用 Apple Developer ID 或 Windows Authenticode 证书。原生安装器、受信任签名、自动更新和 macOS 进程内 webview 仍属于延期的打包工作。
