# Agent Note: Incubate Agent Teams as private experimental packages

Status: implemented

English | [中文](2026-08-18-experimental-agent-teams-packages.zh.md)

## Problem

Agent Teams needs the real Session log, subagent lifecycle, tools, examples, snapshots, and repository checks while its service and tool contracts continue to change. Placing those packages in a product-role group obscures that status and lets stable packages or applications take runtime dependencies on them.

An experimental directory without a current package imposes placement, dependency, and promotion rules on no consumer. Agent Teams supplies the concrete consumer, but the directory needs mechanical dependency isolation and package privacy rather than a documentation-only status.

## Decision

`packages/experimental/agent-team` and `packages/experimental/tool-agent-team` are private workspace packages. The [experimental package naming decision](2026-08-19-experimental-package-name-prefix.md) owns their npm names and promotion rename; this note owns their placement and dependency isolation.

Workspace constraints require each experimental package to use the experimental name prefix, set `private: true`, and omit `publishConfig`. The same top-level check rejects `dependencies`, `optionalDependencies`, and `peerDependencies` from every non-experimental workspace package or deployment root to an experimental package. Experimental packages may depend on other workspace packages and each other; tests may use them through `devDependencies`, and examples may load them explicitly.

The generic caller-reserved continuable child identity and selective direct-child drain remain in the stable Subagent service. They own Subagent identity and Activation lifecycle without importing or naming Agent Teams; the experimental Team service consumes them in the permitted direction.

Experimental status changes compatibility and shipped-composition expectations only. The packages retain the repository's ordinary documentation, invariant, lifecycle, security, unit, real-composition, and snapshot requirements. Promotion requires review of the public contracts, limitations, test evidence, desktop payload, runtime dependents, and a named owner accepting stable-package obligations.

## Alternatives considered

**Keep Agent Teams in a product-role group and describe it as opt-in.** Opt-in composition controls model behavior but does not prevent stable packages from taking runtime dependencies on the Team packages.

**Reserve an empty experimental group.** A directory without a current package has no owner or dependency rule to test. The group exists only while concrete packages need its enforced treatment.

**Move the Subagent prerequisites into the experimental directory.** Child identity allocation and Activation teardown belong to the Subagent owner and contain no Team-specific contract. Moving or duplicating them would invert the dependency or split one lifecycle across packages.

## Consequences

Agent Teams can use the full repository graph and quality checks without entering the shipped desktop closure or becoming a supported runtime dependency. Stable packages and applications cannot expose Team until the Team packages are promoted, so CLI and Web experiments use explicit example or experimental compositions instead of the shipped base bundles.

The product-role grouping is less direct while the packages incubate. Promotion creates path and npm-name churn as specified by the experimental package naming decision.
