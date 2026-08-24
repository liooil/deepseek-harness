# native/

[English](README.md) | 中文

与 DeepSeek Harness 一同维护的原生源码和内部包。[`landlock-run/` workspace](landlock-run/README.zh.md) 负责 harness 使用的 Landlock 自限后执行启动器，包括其架构、由三个包组成的 workspace 包家族、平台支持和开发工作流。

## Workspace 与发布边界

`landlock-run/` 及其包属于仓库根 pnpm workspace，并共用根锁文件。开发和 CI 中的 harness 消费方直接使用当前 workspace 的入口包，因此启动器约定变更与消费方更新可以在同一个改动中落地并一起测试。

主仓库的 `Landlock Run` 工作流为每个受支持架构构建并测试。其中的打包安装演练只检查三个本地包产物，不会发布到 npm。入口包继续将平台包声明为可选 workspace 依赖，因此 harness 只会选择与用户操作系统和 CPU 匹配的包。
