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
- Build six native single-file release executables for Linux, Windows, and macOS on x64 and arm64. Each compiled BunDesk launcher embeds an archive containing an official Node.js 24 executable and the complete production workspace closure reachable from `@deepseek-ai/dsh`.
- Verify the embedded archive and materialize it once into a content-addressed, owner-only cache. Extraction rejects absolute, traversing, non-normalized, backslash, and duplicate paths; a completion hash plus atomic directory rename keeps concurrent or interrupted launches from consuming partial files.
- Let a manually dispatched GitHub Actions workflow build and smoke all six targets. Publication requires the exact `desktop-v<repository-version>` tag and the complete target set, writes `SHA256SUMS`, uploads to a draft GitHub Release, and publishes that draft only after every asset succeeds.

## Alternatives considered

- An Electron `file://` shell was rejected because the repository has no desktop IPC bridge, it would duplicate the browser transport, and it would add a bundled Chromium runtime.
- Running DeepSeek Harness itself under Bun was rejected because the supported host runtime is Node.js and the dependency graph includes Node-native behavior.
- A second proxy or Bun HTTP server was rejected because the existing server already owns trusted-host checks, injected boot state, static assets, and WebSocket transport.
- Compiling the harness itself into the Bun launcher was rejected because dynamic Cordis plugin loading, worker files, and Node-native packages need the supported Node module runtime. A self-extracting Node closure preserves those semantics while keeping the downloaded product to one file.

## Consequences

- The Web UI and server composition remain unchanged and browser behavior stays the source of truth for desktop rendering.
- Source execution requires Bun and Node.js, while release executables require neither runtime to be installed.
- Native webview installations remain operating-system prerequisites, with browser mode available as the portable fallback.
- Help has a keyless assembled snapshot, while a smoke mode verifies real server readiness and HTML delivery without opening a window.
- Carrying both runtimes and the complete harness closure produces large downloads and first-run caches. Content-addressed reuse avoids repeating that cost for the same payload.
- macOS artifacts receive ad-hoc signatures; trusted Apple Developer ID and Windows Authenticode signing remain separate credentialed release work.
