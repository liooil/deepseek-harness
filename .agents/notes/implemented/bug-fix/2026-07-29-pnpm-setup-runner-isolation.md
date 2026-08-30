# Agent Note: Isolate pnpm setup per GitHub Actions runner

Status: implemented

English | [中文](2026-07-29-pnpm-setup-runner-isolation.zh.md)

## Problem

`pnpm/action-setup@v4` defaults its install destination to `~/setup-pnpm` and replaces that directory during setup. The self-hosted CI failover runs six GitHub Actions runner services under one VM user, so concurrent jobs shared the same destination. In the reproducing run, three jobs entered pnpm setup within 73 milliseconds; one setup removed another process's current working directory and two jobs failed in Node's `uv_cwd` initialization. A retry on another runner passed, making the failure timing-dependent rather than a repository-test regression.

## Decision

Every `pnpm/action-setup` step in [Desktop CI](../../../../.github/workflows/desktop-ci.yml) sets a destination under `runner.temp` containing the run id, attempt, and job name. Each job therefore owns its pnpm installation directory across Linux, macOS, and Windows. The optional [Python SDK executable build](../../../../.github/workflows/build-exe-for-python-sdk.yml) retains its own run/job-scoped destination. The original collision and the organization-runner topology remain recorded in the [upstream CI workflow](https://github.com/deepseek-ai/deepseek-harness/blob/master/.github/workflows/ci.yml).

[The workflow regression test](../../../../scripts/ci-workflow.spec.ts) discovers every Desktop CI `pnpm/action-setup` step and rejects one without the job-private destination. This keeps newly added desktop jobs inside the same isolation boundary.

## Alternatives considered

**Serialize failover jobs.** Rejected because it discards the six-runner pool's intended parallelism and turns an action-local directory collision into queueing across otherwise independent jobs.

**Assign a separate Unix user to every runner service.** This would also separate `HOME`, but it moves the invariant into external VM provisioning and complicates ownership of the deliberately shared persistent pnpm store. The workflow already receives a runner-private temporary directory.

**Retry failed setup steps.** Rejected because retries only reduce the observed collision rate; another concurrent setup can remove the same shared directory again.

## Consequences

pnpm's executable installation is ephemeral and isolated per runner, while package downloads still use the configured persistent or cached store. Hosted jobs use the same explicit destination without changing cache policy. The workflow carries three extra configuration lines per setup step, and the regression test must be updated only if pnpm provisioning intentionally moves to a different isolation mechanism.
