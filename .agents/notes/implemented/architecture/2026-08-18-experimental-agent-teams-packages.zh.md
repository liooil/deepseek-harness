# Agent Note: 将 Agent Teams 作为私有实验性包孵化

Status: implemented

[English](2026-08-18-experimental-agent-teams-packages.md) | 中文

## 问题

Agent Teams 的服务与工具约定仍在变化，但它需要使用真实 Session 日志、subagent 生命周期、工具、示例、快照和仓库检查。把这些包放在产品职责组会掩盖其状态，并让稳定包或应用对它们建立运行时依赖。

没有实际包的 experimental 目录不会为任何消费方落实放置、依赖与 promotion 规则。Agent Teams 提供了具体消费方，但该目录需要机械强制的依赖隔离与包私有性，不能只用文档标记状态。

## 决策

`packages/experimental/agent-team` 与 `packages/experimental/tool-agent-team` 是私有 workspace 包。[实验性包命名决策](2026-08-19-experimental-package-name-prefix.zh.md)负责其 npm 名和 promotion 重命名；本记录负责其目录归属与依赖隔离。

workspace 约束要求每个实验性包使用实验性名称前缀、设置 `private: true` 并省略 `publishConfig`。同一个顶层检查会拒绝每个非实验性 workspace 包或部署根通过 `dependencies`、`optionalDependencies` 或 `peerDependencies` 依赖实验性包。实验性包可以依赖其他 workspace 包和实验性包；测试可以通过 `devDependencies` 使用它们，示例可以显式加载它们。

通用的调用方预留 continuable child 身份和精确 direct-child drain 仍属于稳定 Subagent 服务。它们负责 Subagent 身份与 Activation 生命周期，不 import 或命名 Agent Teams；实验性 Team 服务沿允许的方向消费这些能力。

实验性状态只改变兼容性与交付组合预期。这些包仍须满足仓库的一般文档、不变式、生命周期、安全、单元测试、真实组合测试和快照要求。promotion 前必须评审公开约定、限制、测试证据、桌面 payload、运行时依赖方，并由一名具名 owner 接受稳定包义务。

## 曾考虑的替代方案

**把 Agent Teams 留在产品职责组，并标为显式启用。** 显式启用的组合可以控制模型行为，但不能阻止稳定包对 Team 包建立运行时依赖。

**预留空的 experimental 组。** 没有实际包的目录没有 owner，也没有可供测试的依赖规则。只有具体包需要这套强制处理时，该组才存在。

**把 Subagent 前置能力移入 experimental 目录。** child 身份分配与 Activation teardown 属于 Subagent owner，且不包含 Team 专用约定。移动或复制这些能力会反转依赖方向，或把同一个生命周期拆到多个包中。

## 后果

Agent Teams 可以使用完整仓库依赖图与质量检查，而不进入交付的桌面闭包，也不会成为受支持的运行时依赖。在 Team 包 promotion 前，稳定包和应用不能暴露 Team，因此 CLI 和 Web 实验使用显式示例或实验性组合，而不是交付的基础组合包。

孵化期间的产品职责分组不够直接。promotion 会按照实验性包命名决策产生路径和 npm 名改动。
