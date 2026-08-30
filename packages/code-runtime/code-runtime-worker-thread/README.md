---
description: "Worker-thread code execution for users and maintainers composing, sizing, or debugging the shipped TypeScript backend that runs each program in a fresh Node worker."
kind: "package-reference"
---

# @deepseek-ai/dsh-code-runtime-worker-thread

English | [中文](README.zh.md)

## Summary

Worker-thread implementation of the [`@deepseek-ai/dsh-code-runtime`](../code-runtime/README.md) seam: `WorkerThreadCodeRuntime` runs each program in ONE fresh Node or Bun worker — TypeScript in, type-stripped host-side, bindings bridged over the message port, `{ value, logs, error? }` out. **Containment, not a security boundary**: trust posture is bash-equivalent by design (the [PTC Agent Note](../../../.agents/notes/implemented/feature/2026-06-15-ptc.md)), with containment bash does not have — separate isolate, empty environment, heap cap, hard termination.


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

Mount this backend with the code-runtime seam when a composition should execute model-written TypeScript programs; PTC mode in `dsh-tools` then drives it through `ctx.codeRuntime` whenever the model calls `run_code`. Every execution cap is validated config, so you can size the runtime for your deployment from `cordis.yml`.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-code-runtime'
- name: '@deepseek-ai/dsh-code-runtime-worker-thread'
  config:
    computeMs: 60000              # compute budget (host-specific metering; see Design)
    maxWallMs: 600000             # wall-clock ceiling; never pauses for anything
    maxOutputBytes: 67108864      # combined serialized outer-output cap (64 MiB)
    maxOldGenerationSizeMb: 512   # worker heap cap (resourceLimits)
```

| Field | Default | Meaning |
|---|---|---|
| `computeMs` | `60,000` | Busy-time budget: the run fails with `timeout` once the worker's measured event-loop active time exceeds it |
| `maxWallMs` | `600,000` | Wall-clock ceiling, the backstop for waits that busy time cannot see; at most `2_147_483_647` |
| `maxOutputBytes` | `67,108,864` | Hard cap for serialized logs plus the completion value or failure message; at least `4` |
| `maxOldGenerationSizeMb` | `512` | Worker heap cap; overflow kills the worker and surfaces as `worker-exit` |

Every field is validated and defaulted at load; there are no other tunables. The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-code-runtime-worker-thread) is the exhaustive source for every accepted field.

- **One fresh worker per run, no pooling** — a program's world dies with its worker: no cross-run state to log, state bleed unrepresentable, runs reconstructable from the session log alone.
- **Type-strip host-side, in execution context** — the program is wrapped in an async-function shell and stripped by Node's `node:module.stripTypeScriptTypes` or Bun's built-in TypeScript transpiler before it executes as an `AsyncFunction` body, so top-level `await`/`return` work. Node accepts erasable syntax only; Bun performs its ordinary TypeScript transform.
- **The port assumes a hostile peer** — model code can reach `parentPort` and forge traffic, so every inbound message is shape-validated and REBUILT before anything reads it (`null`, primitives, junk types, and malformed payloads drop without a throw; forged extra fields never ride along), the host answers each call id at most once, resolves binding names as OWN properties only (a forged `constructor` cannot walk a prototype chain), drops post-settlement replies, and validates every binding resolution and completion as lossless JSON. Forged `log`/`done` messages cannot bypass the outer cap: the host repeats validation and accounts every admitted log plus the completion or diagnostic. Worker-side namespaces are null-prototype with `defineProperty`, so `__proto__`-shaped binding names are ordinary keys.
- **Binding rejection classes are request data** — an optional namespace descriptor names the constructor global and the own property that receives the failed member name. The worker materializes and injects that real class, so `instanceof` works without hardcoding `tools` or `ToolCallError`; declarations with invalid or colliding globals fail before a worker spawns. Failures use module-captured error and property-definition intrinsics plus null-prototype descriptors, so later model mutations cannot turn a rejected binding into a worker crash.
- **Two independent budgets, because the peer is hostile** — on Node, `computeMs` meters cumulative worker busy time with `worker.performance.eventLoopUtilization()`. Bun exposes that method but does not implement it, so the Bun worker emits heartbeats instead: an awaited tool leaves its event loop responsive, while uninterrupted synchronous code misses heartbeats for `computeMs` and is terminated. The Bun path detects a continuous stall, not the exact cumulative CPU time of several shorter bursts. `maxWallMs` backstops both hosts when a program awaits a promise nobody resolves. Both budgets funnel into `worker.terminate()`; heap overflow surfaces as `kind: 'worker-exit'`.
- **Intermediate binding values are complete JSON** — binding arguments and resolutions undergo iterative lossless-JSON validation. Before program execution, the worker captures its own realm's plain-container prototype identities plus the native function-source check used only for foreign realms, so constructor-slot mutation and user-authored impostors cannot change container classification. It also captures every structural and metering intrinsic used by this JSON boundary, creates property descriptors without a prototype, and bypasses mutable collection prototypes for private traversal state; model mutations of globals, prototype methods, or descriptor-shaped `Object.prototype` fields therefore cannot alter validation, wire transport, or byte accounting. Values flatten into a bounded-depth pre-order wire value for structured clone and rebuild iteratively on the other side. They have no byte, JavaScript call-stack, or nested structured-clone depth cap. They never enter the outer-output ledger or model context; provider/executor acquisition bounds and process/worker memory remain the limits.
- **Logs stream eagerly into one outer ledger** — console/stdout/stderr text crosses the port in emission order, so a timed-out or killed program still shows what it printed. The worker charges exact JSON-string bytes and preflights completion values and exception diagnostics against the remaining combined budget before posting them; a thrown million-byte stack therefore becomes the fixed `output-limit` diagnostic at the worker boundary. Native writes that bypass the patched stream slots arrive on pipes independent of the completion port, so the host repeats the ledger for those bytes and hostile forged traffic; settlement continues bounded pipe capture until worker termination completes before materializing the result. `maxOutputBytes` accounts the JSON serialization of the outer `logs` array plus the completion value or failure-message payload; fixed `CodeRunResult` field names, braces, the bounded error-kind tag, and later presentation whitespace are outside that variable-payload ledger. At or below the cap the exact value returns; a lossy completion is `invalid-output`, and a combined overflow is `output-limit` rather than a substituted inspected string. The failure retains the fitting captured prefix and later follows the normal outer `run_code` spill policy.
- **Empty environment** — the worker gets `env: {}` and `execArgv: []`: no ambient credentials (stronger than the scrubbed-env rule for spawned commands) and no inherited loader flags.
- **Dispose to quiescence** — teardown fails in-flight runs as `abort` and AWAITS each worker's exit before resolving.

A successful run returns the program's lossless-JSON completion value as `result.value` and the text it printed, in order, as `result.logs`. Top-level `await` and `return` work, and the program can call the host-provided binding functions (PTC mode exposes one `tools` object) as ordinary async calls.

Source mode loads erasable-only `src/worker.ts` through Node's native type stripping. Its transitive runtime closure contains only host built-ins and relative source modules, so a fresh checkout never requires a sibling workspace package's unbuilt `lib/` export. The worker-local and session-owned JSON boundaries both flatten and rebuild validated values around the message port so application nesting never reaches structured clone. The Node build passes sibling `lib/worker.cjs` as a filesystem path because pkg's VFS Worker hook expects CommonJS; the same path also runs under ordinary Node. The Bun desktop build bundles the worker separately and embeds that file entry in the standalone executable because Bun requires worker entrypoints to be named at compile time. The repository-level requirement that exercises the published entry path lives in the [testing policy](../../../docs/testing.md).

A program runs with authority comparable to the bash tool: it can reach Node APIs, and the backend deliberately does not promise isolation from the host. What it does provide is containment — a separate isolate, an empty environment (no ambient credentials, no inherited loader flags), a configurable heap cap, and hard termination that also stops a hot synchronous loop. OS processes a program spawns survive `terminate()` and need deployment-level cleanup.

### What can go wrong

Every program outcome resolves as a result, so a failed run is a `result.error`, not a rejection: a syntax error or non-erasable TypeScript (`enum`, namespaces) fails as `exception` before any worker spawns; budget expiry is `timeout`; the abort signal is `abort`; a heap overflow or other worker death is `worker-exit`; a completion value that is not lossless JSON is `invalid-output`; and serialized output beyond the cap is `output-limit` — with the fitting captured log prefix retained. Rejection means caller misuse, such as a run submitted after disposal.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design behind the backend; observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

The backend rests on one separation: **containment, not a security boundary**. Model code has bash-equivalent trust (the [PTC mode Agent Note](../../../.agents/notes/implemented/feature/2026-06-15-ptc.md) Trust posture), so the design optimizes for reconstructability and bounded resource use rather than for a hard multi-tenant boundary — that awaits a container-class backend. Each run gets one fresh worker, so a program's world dies with its worker: no cross-run state exists to leak or to log, and a run is reconstructable from the session log alone.

### Execution flow

A run is type-stripped host-side (`node:module`'s `stripTypeScriptTypes`, position-preserving), wrapped as the body of an async function so top-level `await`/`return` work, and sent to a fresh worker whose bootstrap materializes the binding namespaces. Binding calls cross the message port as lossless JSON and are answered at most once per call id. Log text streams to the host eagerly so a killed program still shows what it printed. Exactly one outcome settles the run — a `done` frame, a budget expiry, an abort, or worker death — after which the host terminates the worker and awaits its exit.

### Hostile-peer port

Model code can reach `parentPort` and forge traffic, so every inbound message is shape-validated and rebuilt field by field before anything reads it: forged extra fields never ride along, a non-number call id can never be echoed into a reply, binding names resolve as own properties only (a forged `constructor` cannot walk a prototype chain), and junk drops silently. Worker-side namespaces are null-prototype, so `__proto__`-shaped binding names are ordinary keys.

### Budgets

Two independent budgets exist because the peer is hostile: `computeMs` meters the worker's measured busy time (`eventLoopUtilization()` polling every 25 ms), so a hot loop expires it whether or not a decoy dispatch is in flight, while a program idling on a slow binding accrues nothing; `maxWallMs` backstops what busy time cannot see, such as a promise nobody resolves. Both funnel into `worker.terminate()`. `maxWallMs` is range-checked at load against `MAX_TIMER_DELAY_MS` because `setTimeout` clamps a longer delay to 1 ms.

### Output ledger

`maxOutputBytes` accounts the JSON serialization of the outer `logs` array plus the completion value or failure-message payload; fixed `CodeRunResult` field names and envelope syntax are outside that ledger. At or below the cap the exact value returns; a lossy completion is `invalid-output`, and a combined overflow is `output-limit` rather than a substituted inspected string. The failure retains a fitting captured prefix of the logs.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema, `WorkerThreadCodeRuntime`, run orchestration, output ledger |
| [`src/worker.ts`](src/worker.ts) | Source-mode worker entry (erasable TypeScript, no `lib/` dependency) |
| [`src/bootstrap.ts`](src/bootstrap.ts) | Worker-side bootstrap: namespace materialization, console shim, log capture |
| [`src/protocol.ts`](src/protocol.ts) | Port message vocabulary between host and worker |
| [`src/worker-json.ts`](src/worker-json.ts) | Worker-side lossless-JSON encode/decode |
| [`src/output-json.ts`](src/output-json.ts) | Byte metering and truncation for the outer ledger |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion (no runtime invariant; see its reason) |

### The worker entry, unbuilt and built

Source mode loads erasable-only `src/worker.ts` through Node's native type stripping; its transitive runtime closure contains only Node built-ins and relative source modules, so a fresh checkout never requires a sibling workspace package's unbuilt `lib/` export. Built mode passes the sibling `lib/worker.cjs` as a filesystem path because pkg's VFS Worker hook expects CommonJS; the same path works under ordinary Node.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these when the backend contract is not enough. They move from the seam definition to the consumer and the configuration surface.

- [Code runtime seam](../code-runtime/README.md) — the abstract contract this backend implements.
- [PTC mode Agent Note](../../../.agents/notes/implemented/feature/2026-06-15-ptc.md) — how `dsh-tools` consumes `ctx.codeRuntime` and presents `run_code`.
- [Code runtime subsystem reference](../../../docs/subsystems/code-runtime.md) — request/result vocabulary, bindings, and failure taxonomy.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-code-runtime-worker-thread) — every accepted config field and its source declaration.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through PTC mode in `dsh-tools`, which renders the exact outer value when it fits or an explicit `invalid-output` / `output-limit` failure, while only the outer `run_code` result enters model context under its ordinary spill policy and binding traffic plus intermediate values remain execution-local.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the backend is a poor fit or needs special operational care. They are current package constraints, not a task backlog.

- **OS processes a program spawns survive termination** — `worker.terminate()` ends the thread only, weaker than bash-local's process-group kill; orphan cleanup is a deployment concern until a container backend exists.
- **Node type stripping uses the experimental `stripTypeScriptTypes` API** — amaro or sucrase are the named drop-in replacements if the relied-on behavior shifts; Bun uses its own transpiler and can therefore differ on non-erasable TypeScript syntax.
- **Compute metering differs by host** — Node samples cumulative busy time; Bun detects one continuous unresponsive interval. Expiry can overshoot by up to the 25 ms internal polling interval.
- **Programs get a five-method `console` shim** (`log`/`info`/`warn`/`error`/`debug`) — deliberately not Node's full console API.
- **Intermediate binding values have no byte cap** — a program can exhaust process or worker memory with a value that never becomes outer output.
- **The default 64 MiB cap is a rejection boundary, not recoverable storage** — outer spill can save only the bounded logs and diagnostic returned after `output-limit`; bytes rejected beyond the runtime cap never reach the spill layer.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
