# `@deepseek-ai/dsh-desktop`

English | [中文](README.zh.md)

This package is the BunDesk desktop launcher for DeepSeek Harness. It supervises the existing Node-based `dsh web` process, waits for its stable loopback readiness URL, and opens that URL in a native system webview or a dedicated browser window. GitHub Releases provide native single-file executables with Node.js, BunDesk, the Web UI, and the complete `dsh` runtime embedded.

## Requirements

- A release executable does not require Node.js, Bun, or an npm installation.
- Running from source requires Node.js `^22.19.0` or `>=24.0.0` and [Bun](https://bun.sh) `>=1.3.14`.
- Windows webview mode requires the WebView2 Runtime.
- Linux webview mode requires the WebKit2GTK 4.1 stack and a display server.

## Release executables

The `Release (desktop)` GitHub Actions workflow builds `dsh-desktop-{linux,windows,macos}-{x64,arm64}` on native hosted runners. A manual run retains each executable as its own artifact. A publishing run accepts only the exact `desktop-v<repository-version>` tag, checks that all six files are present, records `SHA256SUMS`, uploads through a draft GitHub Release, and makes the release visible after every upload succeeds.

The first command that starts the server verifies the embedded archive and extracts it into a content-addressed, owner-only user cache. Completed extractions are reused. Extraction rejects unsafe archive paths and publishes a new cache directory with an atomic rename, so concurrent starts cannot consume a partial runtime.

## Run from source

Build the package and Web UI artifacts before starting the launcher:

```sh
pnpm install
pnpm run build
pnpm desktop
```

The invoking directory is the DeepSeek Harness workspace. Use `--cwd` to select a different workspace.

## Options

| Option | Purpose |
|---|---|
| `--browser` | Open a dedicated Chromium or Firefox window. |
| `--webview` | Open WebView2 on Windows or WebKitGTK on Linux. |
| `--provider <browser\|webview>` | Select the window provider explicitly. |
| `--cwd <directory>` | Select the workspace directory. |
| `--port <port>` | Select the loopback server port; `0` chooses a free port. |
| `--smoke` | Start and fetch the Web UI without opening a window. |
| `--help` | Print help without starting the server. |
| `--version` | Print the launcher version. |

Windows and Linux default to `webview`. macOS defaults to `browser` because BunDesk does not yet provide an in-process macOS webview.

## Lifecycle

The launcher streams `dsh web` logs to its own terminal. Closing a managed window terminates the server, and server exit closes the window. `SIGINT` and `SIGTERM` also close both sides, with a bounded graceful shutdown before forced termination.

## Known Limitations and Deferred Work

- When BunDesk falls back to the operating system URL opener, it cannot observe when that externally managed browser window closes; use `Ctrl+C` to stop the server.
- Release executables carry both the Bun launcher and the Node-based harness closure, so downloads and the first extraction are large.
- The workflow ad-hoc signs macOS executables but does not use an Apple Developer ID or Windows Authenticode certificate. Native installers, trusted signing, automatic updates, and a macOS in-process webview remain deferred packaging work.
