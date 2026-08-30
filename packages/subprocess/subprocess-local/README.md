---
description: "The local host provider for the subprocess service: run managed process trees and real terminal sessions on the host machine."
kind: "package-reference"
---

# @deepseek-ai/dsh-subprocess-local

English | [中文](README.zh.md)

## Summary

Local Service Provider for the [`@deepseek-ai/dsh-subprocess`](../subprocess/README.md) seam. `LocalSubprocessRuntime` resolves local executables, spawns ordinary detached process trees with explicit stdio, and implements terminal processes through Bun's native `Bun.Terminal` or Node's `node-pty`, plus platform process inspection. It has no config: every disposition, limit, terminal dimension, grace, and directory arrives from the calling capability seams ([`dsh-bash-local`](../../shell/bash-local/README.md), [`dsh-lsp-stdio`](../../lsp/lsp-stdio/README.md), and [`dsh-terminal-bash`](../../terminal/terminal-bash/README.md)).


- **Detached process trees with platform-correct signalling** — POSIX children are spawned `detached` (own process group) and signalled by negative pgid with a direct-child fallback; Windows terminates the tree via `taskkill /PID <pid> /T /F`. `terminate()` — the handle's only termination verb — sends SIGTERM then SIGKILL after the spec's grace (OpenCode's escalation; pipelines and subshells die with the parent) and is a no-op once the tree is gone; `waitForExit()` polls whole-tree liveness so consumer teardown confirms real quiescence. After the leader exits, still-open pipes receive the same bounded drain grace so a surviving descendant cannot hold the outcome open indefinitely. ESRCH is tolerated; daemons that re-parent away from the group can still survive.
- **Per-stream dispositions** — `'pipe'` hands the raw stream to the caller untouched (protocol framing stays consumer-owned); `'inherit'` passes the parent descriptor through; collect mode keeps the in-memory TAIL beyond its cap (errors and results cluster at the end — pi/OpenCode rationale) while the FULL stream is appended to a private temp file when a spill cap is configured — omitting `spill` keeps only the tail, the diagnostic shape. A stream larger than the spill cap discards its now-incomplete spill and returns only the marked truncated tail; spill fds are sealed at settlement, and a failed final close withholds the path rather than advertising an incomplete file. Spill files are `0600` with random names under a lazily-created `0700` per-process directory.
- **Credential scrub + explicit merge** — `process.env` minus credential-shaped vars (`*KEY*`/`*PASSWORD*`/`*SECRET*`/`*TOKEN*`) and all ambient `DSH_*` names; the spec's explicit `env` merges after that scrub with no namespace validation, so a deliberately supplied credential or current `DSH_*` fact wins while stale nested-harness identity cannot leak in ambiently. Supplied stdin is written and closed; otherwise fd 0 is `/dev/null`. See the [stdin/env Agent Note](../../../.agents/notes/implemented/architecture/2026-06-30-bash-stdin-env-trusted-plugin-api.md) and [managed environment Agent Note](../../../.agents/notes/implemented/feature/2026-07-10-agent-session-identity-and-log-location.md).
- **Offset-based reads** — collect-mode readers return deltas in whole-stream byte coordinates; the service never holds a cursor, so consumer-owned cursors (the bash background read path) and full-stream re-reads coexist, before and after settlement.
- **Executable lookup** — `resolveExecutable` checks absolute files or searches the scrubbed effective PATH with platform-aware executable extensions; relative paths containing separators are rejected at the seam, and relative PATH entries resolve from the host process cwd.
- **Terminal-process ownership** — `spawnTerminal` allocates Bun's native `Bun.Terminal` on Bun or `node-pty` on Node, bridges UTF-8 terminal text, and exposes one awaited termination operation that sweeps descendants before and after terminating the top-level shell. Each foreground inspection retains exact identities from the rooted tree; Linux also enumerates the POSIX session after its leader exits. A previously observed macOS descendant and any same-session Linux member therefore remain fenced after reparenting, while pid/start identity prevents cleanup from following PID reuse. On Windows the koffi-backed inspector enumerates the process table through Toolhelp32, combines GetProcessTimes start identities with zero-time process-handle waits for liveness, reports the shell pid as the pseudo foreground group (Windows has no POSIX groups), and teardown verifies the shell's termination because externally taskkilled shells may never fire node-pty's exit notification. The higher PTY backend owns prompt readiness, buffers, and model-facing operations.
- **Terminate-and-join disposal** — the service retains live handles so its own disposal can escalate every running tree and await its exit; quiescent and spawn-failed handles leave the live set after whole-tree or terminal-session cleanup finishes.
- **Synchronous host-exit finalization** — while the service effect is active, the JavaScript host's `exit` listener force-terminates every ordinary tree and observable terminal session still in the same live sets. The local-only operations send POSIX SIGKILL to the managed group, run Windows `taskkill /T /F`, and synchronously signal captured/current terminal identities around the PTY root kill; they create no promise or timer, preserve the host's exit code and diagnostic, contain each target's failure, and do not claim quiescence. Normal disposal keeps the awaited graceful path above. See the [host-exit cleanup decision](../../../.agents/notes/implemented/bug-fix/2026-08-11-synchronous-subprocess-exit-cleanup.md).

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the provider beside its consumers and start processes exactly as the subprocess service specifies; this package decides only how those processes run on the host.

### Mounting the provider

Load the provider in the same composition as its consumers. It has no config fields: every choice arrives on the spawn request, so deployment-varying decisions stay with the caller's configuration.

```yaml
- name: '@deepseek-ai/dsh-subprocess-local'
- name: '@deepseek-ai/dsh-bash-local'
```

### Resolving executables

Absolute executable paths are verified; bare names resolve against the scrubbed PATH with platform-aware executable extensions (`.COM`/`.EXE`/`.BAT`/`.CMD` on Windows). Relative paths containing separators are rejected — provide an absolute path or a bare PATH name — and relative PATH entries resolve from the host process cwd.

### Collecting output

Collect mode keeps the last `maxBytes` of a stream in memory — errors and final results cluster at the end — and, when a `spill` cap is configured, appends the complete stream to a private file under a per-process directory in the OS temp dir (a `0700` directory, `0600` random-named files). A stream larger than the spill cap discards its incomplete spill and returns only the marked truncated tail. Reads are offset-based and non-consuming, so background and batch readers coexist before and after exit.

### Running terminal sessions

`spawnTerminal` allocates a real PTY and bridges UTF-8 text; you can inspect and signal the current foreground process group and await a `terminate()` that settles every session member the provider can still observe. On Linux, an exact input wait requires a foreground thread whose fd 0 identifies the shell's controlling terminal and whose current syscall waits on that fd. If the kernel denies the syscall probe, the provider reports no exact wait and leaves the higher PTY backend to its idle inference; process sleep state is not evidence. On Windows, SIGINT is delivered as a Ctrl-C input write, SIGTSTP and SIGHUP are unsupported, and teardown verifies the shell's termination through the process table because an externally killed shell may never fire the PTY exit notification.

### Shutdown behavior

Normal disposal terminates every running tree and terminal and awaits their exit. During a JavaScript-observable host exit — direct `process.exit()`, default uncaught exceptions, default unhandled rejections — a synchronous finalization force-terminates everything still owned (SIGKILL to the group, `taskkill /T /F` on Windows) without creating promises or timers. Unhandled `SIGTERM`/`SIGINT`/`SIGHUP`, `SIGKILL`, fatal OOM, native crashes, and power loss need an external supervisor.

### What can go wrong

An executable that cannot be resolved fails loud with a stable error; a spawn that never starts rejects `done`. A read past the retained tail is `lossy` and points at the spill file when one exists. A daemonized descendant that leaves the tree or terminal session can outlive cleanup — see the limitations below.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the provider and points at the code that realizes them; the observable behavior is covered in [Use this package](#use-this-package).

### Design concept

The provider treats the process tree as the unit of lifetime. POSIX children spawn detached (their own process group) so the whole tree is signalled by negative group id with a direct-child fallback; Windows terminates by root pid through `taskkill /T`. Signalling, escalation, and teardown guard on tree liveness rather than direct-child settlement, so a TERM-trapping helper cannot outlive the handle unnoticed.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Service wiring: live-handle sets, disposal, host-exit finalization, executable lookup |
| [`src/spawn.ts`](src/spawn.ts) | Process plumbing: detached spawn, tail-keep collection, spill files, escalation, tree-exit observer |
| [`src/terminal.ts`](src/terminal.ts) | `node-pty` terminal handle: foreground inspection, session cleanup, Windows teardown |
| [`src/process-inspector.ts`](src/process-inspector.ts) | POSIX process-tree and session inspection |
| [`src/windows-inspector.ts`](src/windows-inspector.ts) | Windows Toolhelp32 process-table inspection via koffi |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion (no runtime invariant; the seam owns the contract) |

### Main flow

A spawn builds the scrubbed child environment, starts the detached process, attaches collectors to the collected streams, and returns a handle. `done` settles at process close after a bounded pipe-drain grace, so a surviving descendant that inherited a pipe cannot hold the outcome open indefinitely; the escalation timer survives direct-child settlement so SIGKILL still reaches tree survivors. Terminal cleanup sweeps descendants by exact identity, stops the shell, re-sweeps, and verifies absence through the process table.

### Safety invariants

Spill files are opened `0600` with `O_EXCL` and random names under a `0700` per-process directory, defeating symlink planting in shared temp dirs; a failed final close withholds the spill path. Process identities carry start times, so cleanup never follows PID reuse. Host-exit finalization creates no promises or timers, preserves the host exit code and diagnostic, contains each target's failure, and does not claim quiescence.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the provider-level contract is not enough. They move from the exhaustive type reference to the abstract contract and the decisions behind the host mechanics.

- [Subprocess subsystem](../../../docs/subsystems/subprocess.md) — spawn specs, output readers, outcomes, and the `DSH_*` environment in full.
- [dsh-subprocess](../subprocess/README.md) — the abstract contract this provider implements.
- [dsh-bash-local](../../shell/bash-local/README.md) — the largest consumer and the concrete stdio shapes it asks for.
- [Subprocess seam Agent Note](../../../.agents/notes/implemented/architecture/2026-07-26-subprocess-seam.md) — why the process half became its own seam.
- [Synchronous subprocess exit cleanup](../../../.agents/notes/implemented/bug-fix/2026-08-11-synchronous-subprocess-exit-cleanup.md) — the host-exit finalization decision and its failure modes.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through consumer seams such as the bash executor family, which own all model-facing rendering of spawned process output and lifecycle.

#### KV Cache effect

No direct invalidation; the named consumers own any request-prefix changes.

## Known Limitations and Deferred Work

- **Windows tree support is best-effort** — termination routes through `taskkill /PID <pid> /T /F` with all outcomes contained (absent tree, races, missing binary), and liveness falls back to the direct-child boundary.
- **Windows terminal signalling is console-wide** — SIGINT is delivered as a `\x03` Ctrl-C input write that conhost turns into a console-wide CTRL_C event; SIGTSTP and SIGHUP are rejected as unavailable; a `taskkill` without `/F` does not terminate console processes, so the teardown TERM tier is a grace wait before the `/F` escalation. Windows readiness has no exact stdin-wait tier: the prompt-marker fast path compares the shell pid as the pseudo foreground group, and silence/timing tiers cover the rest.
- **A daemonized terminal descendant can still escape the observable boundary** — on macOS, a child that reparents before any foreground-inspection snapshot is no longer discoverable from the `node-pty` root; on Linux, a child that calls `setsid` leaves both the tree and owned terminal session. The local provider does not add a continuous process-table monitor.
- **In-process cleanup requires a JavaScript-observable exit** — direct `process.exit()` and ordinary JavaScript fatal paths can emit the host's synchronous `exit` event. The default OS disposition for an unhandled `SIGTERM`, `SIGINT`, or `SIGHUP` may bypass that event; an application covers those signals only by installing a handler that performs normal disposal or calls `process.exit()`. `SIGKILL`, fatal OOM, `process.abort()`, native crashes, power loss, and any failure that cannot run JavaScript require an external supervisor, container init, or equivalent OS owner.
- **The credential scrub is a name heuristic** — `*KEY*`/`*PASSWORD*`/`*SECRET*`/`*TOKEN*` only; differently-named secrets (e.g. `*PASSPHRASE*`) pass through, and a whitelist for over-scrubbed vars is noted future work.
- **Completed spill files are not deleted** — bounded full-output recovery files (and the private per-process spill dir) accumulate under the OS tmpdir until something external cleans them; oversize incomplete spills are discarded and deletion is attempted immediately, but a cleanup failure can leave a bounded file behind.


<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
