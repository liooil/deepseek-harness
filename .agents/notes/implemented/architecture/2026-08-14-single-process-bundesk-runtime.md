# Agent Note: Single-process BunDesk runtime

Status: implemented

English | [中文](2026-08-14-single-process-bundesk-runtime.zh.md)

## Problem

The first desktop release design kept `dsh web` on Node and used BunDesk only as a supervising launcher. That produced one downloaded file but two runtime hosts and two processes, contrary to the product requirement for one executable and one DSH host process. Loading the complete harness directly from a Bun standalone executable was not initially reliable: Cordis resolves plugins from runtime strings, some plugin families select subentries dynamically, worker entry files must be known to Bun at compile time, and several packages assumed Node-only APIs or native-module discovery from a filesystem installation.

The desktop must retain the existing profile composition and Web transport rather than implement a divergent GUI server. It must also keep native release artifacts for Linux, Windows, and macOS on x64 and arm64, while requiring neither Node nor Bun to be installed by the user.

## Decision

Run the existing `web` profile inside the BunDesk executable's Bun process. The CLI profile boot path is now a callable host seam: callers can provide the install anchor, shipped preset root, runtime paths, process-signal and patch-watch ownership, and a bare-module importer. The loader uses that importer for string-named packages while preserving its normal relative and file resolution.

Generate a closed static plugin registry during the desktop build. The registry covers packages named by shipped configuration, dynamically selectable directory-picker implementations, and every workspace package that exports `./typert`. Each registry arm uses a compile-visible import, so Bun includes plugin code in the executable even though Cordis still chooses the package by its runtime name. Direct source execution builds the equivalent workspace-name map from package manifests and imports source entries, with ordinary dynamic import as the fallback for external packages.

Embed only data that must exist as real files: package manifests, Cordis profiles and presets, client bundles, skill badge assets, and target-native resources. Verify this archive and extract it into a content-addressed, owner-only cache using safe paths and atomic publication. Executable server and plugin JavaScript remains inside the standalone binary; the archive contains no Node runtime and no deployed `node_modules` JavaScript closure.

Bundle the code-runtime and workflow worker entries separately and embed them as file assets named at standalone compile time. Their hosts accept configured entry URLs. This preserves real worker isolation without a second DSH host process. Node continues to use its published worker entries; Bun uses the embedded entries.

Provide focused host compatibility at the packages that own the affected capability:

- SQLite providers select `bun:sqlite` under Bun and `node:sqlite` under Node.
- The code runtime uses Bun's TypeScript transpiler, a heartbeat-based continuous-stall budget because Bun worker ELU is unimplemented, and nullable worker pipes. Node retains native type stripping and cumulative event-loop-utilization metering.
- The local subprocess provider uses `Bun.Terminal` under Bun and lazily loads `node-pty` under Node.
- The image provider accepts a configured Sharp loader. The target build statically embeds Sharp's addon, while startup preloads the extracted target libvips library.
- The search provider accepts the extracted packaged-ripgrep path instead of discovering its optional platform package at runtime.
- Package metadata uses JSON imports where a runtime `createRequire` was only serving static data. Windows-only picker, ACL, and Koffi paths remain lazy and platform-gated.
- Windows native integrations require Koffi 3.1.6 or newer; earlier Koffi finalizers crash the Bun Windows host after an otherwise successful shutdown.

Keep the BunDesk window contract: `--browser`, `--webview`, and `--provider` select the presentation; Windows and Linux default to webview and macOS defaults to browser. Closing a managed window or receiving `SIGINT` or `SIGTERM` disposes the in-process Cordis composition. An in-process server shutdown closes the window. The OS URL-opener fallback remains externally managed and therefore cannot report browser closure.

Disable the Node-only live profile-patch watcher in the Bun desktop host. Profile layers are still read at startup; applying later `cordis.patch.yml` changes requires a restart.

Build six target-native single-file executables in GitHub Actions. Publication requires the exact `desktop-v<repository-version>` tag and all six products, writes `SHA256SUMS`, uploads through a draft Release, and publishes only after every asset succeeds. The executable smoke check fetches the boot document and all declared client resources, then exercises the embedded code and workflow workers, Sharp, ripgrep, and the Bun terminal backend.

## Alternatives considered

- Keep the Node host inside a self-extracting BunDesk launcher. This preserved every existing Node assumption but violated the one-process requirement and duplicated runtime cost.
- Replace Node with a second Bun `dsh web` process. This removed Node from the release but still violated the one-process requirement and retained supervision and cross-process lifecycle complexity.
- Let the standalone executable dynamically import arbitrary extracted plugin JavaScript. Bun's compiled module graph cannot reliably load that unbundled workspace closure, and doing so would restore a large filesystem runtime with weaker build-time verification.
- Embed the complete production `node_modules` tree as runtime data. Most files would be unnecessary because Bun already compiled their JavaScript, while native discovery and worker entry constraints would still need explicit handling.
- Reimplement the Web server or proxy it through a second Bun server. The existing profile already owns trusted-host validation, boot-state injection, static resources, and WebSocket transport; duplicating it would create a second behavioral source of truth.
- Use Electron. It would bundle a Chromium runtime, duplicate the browser transport, and still require a separate decision about how the harness is hosted.

## Consequences

The release product is one executable with one BunDesk/Bun DSH host process and no Node host. Browser mode and tools that intentionally launch commands can still create external operating-system processes; those are consumers of the host, not another harness runtime.

The shipped plugin set is intentionally closed. A custom profile may compose included plugins and extracted configuration, but it cannot load an arbitrary package installed after compilation; adding one requires a new desktop build and registry entry. Source and package-based CLI execution retain open filesystem module resolution.

Target-native packages make the release build native rather than freely cross-compilable. The six-runner Actions matrix owns portability verification. WebView2 on Windows and WebKit2GTK plus a display server on Linux remain operating-system prerequisites. macOS artifacts are ad-hoc signed; trusted Apple Developer ID and Windows Authenticode signing remain credentialed follow-up work.

Bun and Node have a few deliberately documented semantic differences. In particular, Bun's compute budget detects one continuous unresponsive interval rather than exact cumulative busy time across short bursts. The wall-clock ceiling remains the common backstop. Repository development still requires the supported Node version and Bun, while a release executable requires neither to be installed.

The stronger compiled smoke test catches missing front-end resources, plugin composition failures, unavailable worker entries, native image linkage, missing ripgrep, and PTY startup in the produced binary. It does not replace interactive webview testing or the target-native CI matrix.
