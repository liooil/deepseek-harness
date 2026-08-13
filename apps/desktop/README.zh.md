# `@deepseek-ai/dsh-desktop`

[English](README.md) | 中文

本包是 DeepSeek Harness 的 BunDesk 桌面启动器。它会监管现有的 Node `dsh web` 进程，等待其稳定的回环就绪地址，然后在原生系统 webview 或独立浏览器窗口中打开该地址。

## 要求

- `Node.js` `^22.19.0` 或 `>=24.0.0` 用于运行 DeepSeek Harness。
- [Bun](https://bun.sh) `>=1.3.14` 用于运行桌面启动器和 BunDesk。
- Windows webview 模式需要 WebView2 Runtime。
- Linux webview 模式需要 WebKit2GTK 4.1 技术栈和显示服务器。

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

- 启动器不是独立应用包：当前版本同时需要已发布的 `@deepseek-ai/dsh` 包，以及兼容的 Node.js 和 Bun 安装。
- 当 BunDesk 回退到操作系统 URL 打开器时，它无法观察由外部管理的浏览器窗口何时关闭；请使用 `Ctrl+C` 停止服务。
- 原生安装器、代码签名、自动更新和 macOS 进程内 webview 仍属于延期的打包工作。
