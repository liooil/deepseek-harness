# Agent Note: 仅公开发布桌面二进制

Status: implemented

[English](2026-08-21-desktop-binary-only-release.md) | 中文

## Problem

此 fork 包含完整的 DeepSeek Harness 工作区，但它的产品分发物是桌面客户端。发布工作区包或 Python wheel 包会产生公开包面、版本与恢复义务以及客户端二进制并不需要的安装路径。native 和 Python 包树仍需用于构建和验证，因此删除这些包树会把内部构建依赖与公开产品混为一谈。

## Decision

每个工作区包 manifest 都是私有的，并且省略 `publishConfig`。npm 包发布工作流、GitHub 与 GitLab 的 Python 发布工作流、vendor 发布工作流和 Landlock 发布工作流均已移除。它们的包构建器、打包安装检查以及 Python 运行时检查仍作为本地或 CI 验证输入存在，但不会提供公开分发路径。

唯一的公开发布路径是 `.github/workflows/desktop-release.yml`。每个目标都会运行 `pnpm run build:official`，从而在浏览器产物中启用官方品牌插件并嵌入源码版本标识。受保护的手动运行会构建六个原生单文件可执行文件：Linux x64 与 arm64、Windows x64 与 arm64，以及 macOS x64 与 arm64。只有从 `desktop-v<root package.json version>` 运行时才允许发布；发布还要求完整的目标集合，生成 `SHA256SUMS`，将资产上传到草稿 GitHub Release，并且只有在所有资产都存在后才公开该 Release。根目录包版本仍是共享的源码版本；桌面 tag 与 Release 标题标识公开客户端版本。

README 与贡献者文档会将最终用户指向桌面 GitHub Release。Python SDK 与运行时 wheel 包明确标为内部产物，而本地与 CI 的打包安装检查继续验证支持桌面构建的源码和二进制载荷。

## Alternatives considered

**继续私有或公开发布工作区包。** 不采用，因为此 fork 不承诺包消费者；私有发布仍需要注册表凭据和发布恢复机制，公开发布则会产生桌面可执行文件已经包含的 API 面。

**保留 PyPI 作为第二种受支持的客户端载体。** 不采用，因为这会把 Python 分发物变成第二个公开产品，需要处理平台 wheel 可用性与不可变上传协调。Python 代码仍可在本地构建和测试，但不宣称存在公开安装路径。

**将桌面客户端作为 npm 包发布。** 不采用，因为 npm 是包依赖机制，不是原生桌面可执行文件面向用户的载体。GitHub Releases 可以在一个可见的 Release 中保留完整的平台集合及其校验和。

**为每个平台二进制使用独立版本。** 不采用，因为一个根版本与一个 `desktop-v` tag 让六文件 Release 集合更容易审计，并使客户端版本与仓库源码保持一致。

## Consequences

此 fork 只有一个需要记录、授权、生成校验和并提供支持的公开发布面：桌面 GitHub Release。用户获取客户端时不需要在目标机器上安装 Node.js、Bun、npm、Python 解释器或注册表凭据，但仍须满足桌面启动器文档所述的原生 webview 要求。

工作区包、Python wheel 包和 Landlock tarball 仍是有用的中间产物。它们可以由本地或 CI 任务构建、打包、安装和测试，但它们的存在不代表此 fork 会发布它们，也不代表承诺从注册表安装它们。

发布工作流有意采用手动且要求完整目标集合的方式。构建或上传失败时，GitHub Release 会保持未公开，直到操作者提供全部六个可执行文件和 `SHA256SUMS`；已经公开的 Release 会拒绝替换。公开客户端的变更需要新的根目录版本以及匹配的 `desktop-v` tag。

## Verification

工作区约束门禁会拒绝非私有包 manifest 以及任何 `publishConfig`；工作流测试会固定官方客户端构建命令，并断言桌面 GitHub Release 是唯一的公开发布工作流。桌面任务会在上传前对每个独立可执行文件执行冒烟测试；Python、native 和打包安装检查仍是无凭据的验证路径。
