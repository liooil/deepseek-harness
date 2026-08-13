# Agent Note: BunDesk desktop launcher

Status: implemented

English | [中文](2026-08-13-desktop-launcher.zh.md)

## Problem

DeepSeek Harness exposes its complete graphical experience through `dsh web`, but it has no desktop entry that owns a native window and couples that window to the server lifecycle. Reimplementing the host under another runtime would split the existing plugin composition and transport behavior.

## Decision

- Add `@deepseek-ai/dsh-desktop` as a release app whose Bun entry supervises the published Node `dsh web` executable.
- Treat the stable `dsh web: http://127.0.0.1:<port>` line as the readiness contract, validate that it is a loopback HTTP URL, and only then open the window.
- Use BunDesk for WebView2 on Windows, WebKitGTK on Linux, and dedicated Chromium or Firefox windows; expose `--browser`, `--webview`, and `--provider` as explicit choices.
- Couple both lifecycles: window closure or a termination signal stops the server, while server exit closes the window.

## Alternatives considered

- An Electron `file://` shell was rejected because the repository has no desktop IPC bridge, it would duplicate the browser transport, and it would add a bundled Chromium runtime.
- Running DeepSeek Harness itself under Bun was rejected because the supported host runtime is Node.js and the dependency graph includes Node-native behavior.
- A second proxy or Bun HTTP server was rejected because the existing server already owns trusted-host checks, injected boot state, static assets, and WebSocket transport.

## Consequences

- The Web UI and server composition remain unchanged and browser behavior stays the source of truth for desktop rendering.
- The launcher requires both Bun and Node.js; it is not yet a standalone single-binary distribution.
- Native webview installations remain operating-system prerequisites, with browser mode available as the portable fallback.
- Help has a keyless assembled snapshot, while a smoke mode verifies real server readiness and HTML delivery without opening a window.
