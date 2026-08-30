# Agent Note: Desktop binaries are the only public release

Status: implemented

English | [中文](2026-08-21-desktop-binary-only-release.zh.md)

## Problem

This fork contains the complete DeepSeek Harness workspace, but its product distribution is the desktop client. Publishing workspace packages or Python wheels creates public package surfaces, version and recovery obligations, and install paths that are not required by the client binary. Native and Python package trees still need to exist for builds and verification, so removing those trees would conflate an internal build dependency with a public product.

## Decision

Every workspace package manifest is private and omits `publishConfig`. The npm package release workflows, GitHub and GitLab Python publication workflows, vendor publication workflow, and Landlock publication workflow are removed. Their package builders, packed-install checks, and Python runtime checks remain as local or CI validation inputs and do not grant a public distribution route.

The only public publication path is `.github/workflows/desktop-release.yml`. Each target runs `pnpm run build:official`, enabling the official brand plugin and embedding the source revision in browser artifacts. A protected manual run builds six native single-file executables: Linux x64 and arm64, Windows x64 and arm64, and macOS x64 and arm64. It accepts publication only from `desktop-v<root package.json version>`, requires the complete target set, creates `SHA256SUMS`, uploads the assets to a draft GitHub Release, and makes that release visible only after every asset is present. The root package version remains the shared source version; the desktop tag and release title identify the public client release.

README and contributor documentation direct end users to the desktop GitHub Release. Python SDK and runtime wheels are explicitly described as internal artifacts, while local and CI packed-install checks continue to prove the source and binary payloads that support the desktop build.

The public repository is named `deepseek-harness-desktop` so its downstream distribution role cannot be confused with the upstream source repository. Its default CI surface is desktop-specific: static repository gates, native desktop smoke tests, sandbox portability, and the six-target release. Upstream package publication, organization runner drills, preview deployment, issue automation, Python executable publication, and automatic real-API runs are not fork CI responsibilities. Real-API E2E remains manually dispatchable when a maintainer provides credentials.

## Alternatives considered

**Keep publishing the workspace packages privately or publicly.** Rejected because the fork has no package-consumer promise; private publication still requires registry credentials and release recovery, while public publication creates an API surface that the desktop executable already contains.

**Keep PyPI as a second supported client carrier.** Rejected because it makes Python distribution a second public product with platform wheel availability and immutable upload coordination. The Python code remains testable and buildable locally without claiming a public install route.

**Publish the desktop client as an npm package.** Rejected because npm is a package dependency mechanism, not the user-facing carrier for a native desktop executable. GitHub Releases can retain the complete platform set and its checksums in one visible release.

**Give each platform binary its own independent version.** Rejected because one root version and one `desktop-v` tag make the six-file release set auditable and keep the client release aligned with the repository source.

## Consequences

The fork has one public release surface to document, authorize, checksum, and support: the desktop GitHub Release. A user who needs the client does not need Node.js, Bun, npm, a Python interpreter, or registry credentials on the target machine, subject to the native webview requirements documented by the desktop launcher.

Workspace packages, Python wheels, and Landlock tarballs remain useful intermediate artifacts. They may be built, packed, installed, and tested by local or CI jobs, but their existence does not imply that this fork publishes them or promises registry installation.

The release workflow is intentionally manual and target-complete. A failed build or upload leaves the GitHub Release unpublished until the operator supplies all six executables and `SHA256SUMS`; replacing an already public release is refused. Changes to the public client require a new root version and a matching `desktop-v` tag.

## Verification

The workspace constraint gate rejects non-private package manifests and any `publishConfig`, while workflow tests pin the official client build command and assert that the desktop GitHub Release is the only public release workflow. Desktop jobs smoke-test each standalone executable before upload; Python, native, and packed-install checks remain credential-free validation paths.
