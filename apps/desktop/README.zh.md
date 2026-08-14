# `@deepseek-ai/dsh-desktop`

[English](README.md) | 中文

本包是 DeepSeek Harness 的 BunDesk 桌面启动器。Release 可执行文件会在同一个 Bun 进程中启动 `dsh web` composition，然后用原生系统 webview 或独立浏览器窗口打开其回环地址。GitHub Release 提供原生单文件可执行文件，其中包含 BunDesk、编译后的 DSH 服务端／插件闭包、Web UI、worker 入口和所需原生资源；它既不包含也不会启动 Node host。

## 要求

- Release 可执行文件不需要安装 Node.js、Bun 或 NPM 包。
- 从源码运行需要 Node.js `^22.19.0` 或 `>=24.0.0`，以及 [Bun](https://bun.sh) `>=1.3.14`。
- Windows webview 模式需要 WebView2 Runtime。
- Linux webview 模式需要 WebKit2GTK 4.1 技术栈和显示服务器。

## Release 可执行文件

`Release (desktop)` GitHub Actions 工作流会在原生托管 runner 上构建 `dsh-desktop-{linux,windows,macos}-{x64,arm64}`。手动运行会将每个可执行文件分别保留为产物。发布运行只接受与仓库版本完全一致的 `desktop-v<repository-version>` 标签；它会检查六个文件全部存在、记录 `SHA256SUMS`、通过 GitHub Release 草稿上传，并在所有文件上传成功后公开 Release。

首次执行会启动服务的命令时，程序会校验嵌入的数据归档，并将其解压到按内容寻址、仅属主可访问的用户缓存中。归档只包含必须以真实文件存在的包清单、profile、客户端 bundle 和原生资源；可执行 JavaScript 与 DSH 插件注册表仍编译在单文件内。完整解压结果会被复用。解压过程拒绝不安全的归档路径，并通过原子重命名发布新的缓存目录，因此并发启动不会使用不完整的数据。

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
| `--smoke` | 不打开窗口，验证 Web UI、声明的资源、worker、图像解码器、搜索二进制和终端后端。 |
| `--help` | 打印帮助且不启动服务。 |
| `--version` | 打印启动器版本。 |

Windows 和 Linux 默认使用 `webview`。macOS 默认使用 `browser`，因为 BunDesk 尚未提供 macOS 进程内 webview。

## 生命周期

启动器会在自身进程内运行 Cordis composition 与 HTTP 服务，并把日志输出到终端。关闭受管窗口会 dispose 该 composition；进程内服务关闭也会关闭窗口。`SIGINT` 和 `SIGTERM` 同样会 dispose 服务并关闭窗口。

## 已知限制和延期工作

- 当 BunDesk 回退到操作系统 URL 打开器时，它无法观察由外部管理的浏览器窗口何时关闭；请使用 `Ctrl+C` 停止服务。
- Release 插件注册表是根据仓库随附 profile 和动态 Typert 入口生成的闭集。若某个 profile 指向编译后才安装的任意插件，则无法从磁盘加载该插件；必须在新的桌面构建中包含它。
- 桌面宿主会在启动时读取 profile patch，但不会启用 Node 专用的实时 patch watcher。修改 `cordis.patch.yml` 后需要重启才能生效。
- “单进程”描述的是 DSH host。browser 模式以及按设计执行命令的工具仍会创建外部操作系统进程。
- 原生资源与目标平台绑定。六目标 Actions 矩阵是 Release 可移植性检查；如果宿主缺少目标平台的 optional native 包，就无法在该宿主上交叉构建对应二进制。
- 工作流会对 macOS 可执行文件进行临时签名，但不使用 Apple Developer ID 或 Windows Authenticode 证书。原生安装器、受信任签名、自动更新和 macOS 进程内 webview 仍属于延期的打包工作。
