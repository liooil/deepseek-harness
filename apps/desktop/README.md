# `@deepseek-ai/dsh-desktop`

English | [中文](README.zh.md)

This package is the BunDesk desktop launcher for DeepSeek Harness. Its release executable boots the `dsh web` composition inside the same Bun process, then opens the loopback URL in a native system webview or a dedicated browser window. GitHub Releases provide native single-file executables containing BunDesk, the compiled DSH server/plugin closure, the Web UI, worker entries, and required native resources; they do not contain or start a Node host.

## Requirements

- A release executable does not require Node.js, Bun, or an npm installation.
- Running from source requires Node.js `^22.19.0` or `>=24.0.0` and [Bun](https://bun.sh) `>=1.3.14`.
- Windows webview mode requires the WebView2 Runtime.
- Linux webview mode requires the WebKit2GTK 4.1 stack and a display server.

## Release executables

The `Release (desktop)` GitHub Actions workflow builds `dsh-desktop-{linux,windows,macos}-{x64,arm64}` on native hosted runners. A manual run retains each executable as its own artifact. A publishing run accepts only the exact `desktop-v<repository-version>` tag, checks that all six files are present, records `SHA256SUMS`, uploads through a draft GitHub Release, and makes the release visible after every upload succeeds.

The first command that starts the server verifies the embedded data archive and extracts it into a content-addressed, owner-only user cache. The archive contains package manifests, profiles, client bundles, and native resources needed as real files; executable JavaScript and the DSH plugin registry remain compiled into the single executable. Completed extractions are reused. Extraction rejects unsafe archive paths and publishes a new cache directory with an atomic rename, so concurrent starts cannot consume partial data.

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
| `--smoke` | Verify the Web UI, declared assets, workers, image decoder, search binary, and terminal backend without opening a window. |
| `--help` | Print help without starting the server. |
| `--version` | Print the launcher version. |

Windows and Linux default to `webview`. macOS defaults to `browser` because BunDesk does not yet provide an in-process macOS webview.

## Lifecycle

The launcher runs the Cordis composition and HTTP server in its own process and streams their logs to its terminal. Closing a managed window disposes that composition; an in-process server shutdown closes the window. `SIGINT` and `SIGTERM` also dispose the server and close the window.

## Known Limitations and Deferred Work

- When BunDesk falls back to the operating system URL opener, it cannot observe when that externally managed browser window closes; use `Ctrl+C` to stop the server.
- The release plugin registry is a closed set generated from the repository's shipped profiles and dynamic Typert entries. A profile that names an arbitrary plugin installed after compilation cannot load that plugin from disk; it must be included in a new desktop build.
- The desktop host reads profile patches at startup but does not enable the Node-only live patch watcher. Restart it to apply `cordis.patch.yml` changes.
- “Single process” describes the DSH host. Browser mode and tools that intentionally execute commands still create external operating-system processes.
- Native resources are target-specific. The six-target Actions matrix is the release portability check; a binary cannot be cross-built on a host that lacks its target's optional native packages.
- The workflow ad-hoc signs macOS executables but does not use an Apple Developer ID or Windows Authenticode certificate. Native installers, trusted signing, automatic updates, and a macOS in-process webview remain deferred packaging work.
