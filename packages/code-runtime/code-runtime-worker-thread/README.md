# @deepseek-ai/dsh-code-runtime-worker-thread

English | [中文](README.zh.md)

Worker-thread implementation of the [`@deepseek-ai/dsh-code-runtime`](../code-runtime/README.md) seam: `WorkerThreadCodeRuntime` runs each program in ONE fresh Node or Bun worker — TypeScript in, type-stripped host-side, bindings bridged over the message port, `{ value, logs, error? }` out. **Containment, not a security boundary**: trust posture is bash-equivalent by design (the [Code Mode Agent Note](../../../.agents/notes/implemented/feature/2026-06-15-code-mode.md) § Trust posture), with containment bash does not have — separate isolate, empty environment, heap cap, hard termination.

## Config

```yaml
- id: code-runtime
  name: '@deepseek-ai/dsh-code-runtime-worker-thread'
  config:
    computeMs: 60000              # compute budget (host-specific metering; see Design)
    maxWallMs: 600000             # wall-clock ceiling; never pauses for anything
    maxOutputBytes: 67108864      # combined serialized outer-output cap (64 MiB)
    maxOldGenerationSizeMb: 512   # worker heap cap (resourceLimits)
```

Every field is validated and defaulted; `maxOutputBytes` is a safe integer of at least four bytes, the remaining fields are positive finite numbers, `maxWallMs` is additionally at most `2147483647` (Node's maximum `setTimeout` delay), and there are no other tunables.

## Design

- **One fresh worker per run, no pooling** — a program's world dies with its worker: no cross-run state to log, state bleed unrepresentable, runs reconstructable from the session log alone.
- **Type-strip host-side, in execution context** — the program is wrapped in an async-function shell and stripped by Node's `node:module.stripTypeScriptTypes` or Bun's built-in TypeScript transpiler before it executes as an `AsyncFunction` body, so top-level `await`/`return` work. Node accepts erasable syntax only; Bun performs its ordinary TypeScript transform.
- **The port assumes a hostile peer** — model code can reach `parentPort` and forge traffic, so every inbound message is shape-validated and REBUILT before anything reads it (`null`, primitives, junk types, and malformed payloads drop without a throw; forged extra fields never ride along), the host answers each call id at most once, resolves binding names as OWN properties only (a forged `constructor` cannot walk a prototype chain), drops post-settlement replies, and validates every binding resolution and completion as lossless JSON. Forged `log`/`done` messages cannot bypass the outer cap: the host repeats validation and accounts every admitted log plus the completion or diagnostic. Worker-side namespaces are null-prototype with `defineProperty`, so `__proto__`-shaped binding names are ordinary keys.
- **Binding rejection classes are request data** — an optional namespace descriptor names the constructor global and the own property that receives the failed member name. The worker materializes and injects that real class, so `instanceof` works without hardcoding `tools` or `ToolCallError`; declarations with invalid or colliding globals fail before a worker spawns. Failures use module-captured error and property-definition intrinsics plus null-prototype descriptors, so later model mutations cannot turn a rejected binding into a worker crash.
- **Two independent budgets, because the peer is hostile** — on Node, `computeMs` meters cumulative worker busy time with `worker.performance.eventLoopUtilization()`. Bun exposes that method but does not implement it, so the Bun worker emits heartbeats instead: an awaited tool leaves its event loop responsive, while uninterrupted synchronous code misses heartbeats for `computeMs` and is terminated. The Bun path detects a continuous stall, not the exact cumulative CPU time of several shorter bursts. `maxWallMs` backstops both hosts when a program awaits a promise nobody resolves. Both budgets funnel into `worker.terminate()`; heap overflow surfaces as `kind: 'worker-exit'`.
- **Intermediate binding values are complete JSON** — binding arguments and resolutions undergo iterative lossless-JSON validation. Before program execution, the worker captures its own realm's plain-container prototype identities plus the native function-source check used only for foreign realms, so constructor-slot mutation and user-authored impostors cannot change container classification. It also captures every structural and metering intrinsic used by this JSON boundary, creates property descriptors without a prototype, and bypasses mutable collection prototypes for private traversal state; model mutations of globals, prototype methods, or descriptor-shaped `Object.prototype` fields therefore cannot alter validation, wire transport, or byte accounting. Values flatten into a bounded-depth pre-order wire value for structured clone and rebuild iteratively on the other side. They have no byte, JavaScript call-stack, or nested structured-clone depth cap. They never enter the outer-output ledger or model context; provider/executor acquisition bounds and process/worker memory remain the limits.
- **Logs stream eagerly into one outer ledger** — console/stdout/stderr text crosses the port in emission order, so a timed-out or killed program still shows what it printed. The worker charges exact JSON-string bytes and preflights completion values and exception diagnostics against the remaining combined budget before posting them; a thrown million-byte stack therefore becomes the fixed `output-limit` diagnostic at the worker boundary. Native writes that bypass the patched stream slots arrive on pipes independent of the completion port, so the host repeats the ledger for those bytes and hostile forged traffic; settlement continues bounded pipe capture until worker termination completes before materializing the result. `maxOutputBytes` accounts the JSON serialization of the outer `logs` array plus the completion value or failure-message payload; fixed `CodeRunResult` field names, braces, the bounded error-kind tag, and later presentation whitespace are outside that variable-payload ledger. At or below the cap the exact value returns; a lossy completion is `invalid-output`, and a combined overflow is `output-limit` rather than a substituted inspected string. The failure retains the fitting captured prefix and later follows the normal outer `run_code` spill policy.
- **Empty environment** — the worker gets `env: {}` and `execArgv: []`: no ambient credentials (stronger than the scrubbed-env rule for spawned commands) and no inherited loader flags.
- **Dispose to quiescence** — teardown fails in-flight runs as `abort` and AWAITS each worker's exit before resolving.

## The worker entry, unbuilt and built

Source mode loads erasable-only `src/worker.ts` through Node's native type stripping. Its transitive runtime closure contains only host built-ins and relative source modules, so a fresh checkout never requires a sibling workspace package's unbuilt `lib/` export. The worker-local and session-owned JSON boundaries both flatten and rebuild validated values around the message port so application nesting never reaches structured clone. The Node build passes sibling `lib/worker.cjs` as a filesystem path because pkg's VFS Worker hook expects CommonJS. The Bun desktop build bundles the worker separately and embeds that file entry in the standalone executable because Bun requires worker entrypoints to be named at compile time.

The SDK API is the default/named `WorkerThreadCodeRuntime` class plus `Config`. The operational `./worker` subpath exists only as the packaged spawn entry; the wire protocol and bootstrap helpers are source-private implementation details.

## Model Experience

Indirectly, through Code Mode in [`dsh-tools`](../../core/tools/README.md), which renders the exact outer value when it fits or an explicit `invalid-output` / `output-limit` failure. Only the outer `run_code` result enters model context and its ordinary spill policy; binding traffic and intermediate values remain execution-local.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **OS processes a program spawns survive termination** — `worker.terminate()` ends the thread only, weaker than bash-local's process-group kill; orphan cleanup is a deployment concern until a container backend exists.
- **Node type stripping uses the experimental `stripTypeScriptTypes` API** — amaro or sucrase are the named drop-in replacements if the relied-on behavior shifts; Bun uses its own transpiler and can therefore differ on non-erasable TypeScript syntax.
- **Compute metering differs by host** — Node samples cumulative busy time; Bun detects one continuous unresponsive interval. Expiry can overshoot by up to the 25 ms internal polling interval.
- **Programs get a five-method `console` shim** (`log`/`info`/`warn`/`error`/`debug`) — deliberately not Node's full console API.
- **Intermediate binding values have no byte cap** — a program can exhaust process or worker memory with a value that never becomes outer output.
- **The 64 MiB default is a rejection boundary, not recoverable storage** — outer spill can save only the bounded logs and diagnostic returned after `output-limit`; bytes rejected beyond the runtime cap never reach the spill layer.
