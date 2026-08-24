# @deepseek-ai/node-addon-landlock-run-linux-arm64

[English](README.md) | 中文

面向 linux-arm64 的预构建 `bin/landlock-run` Landlock 启动器：一个由[入口包的 C 源码](../entry/src/main.c)原生编译而成的静态 musl 二进制文件（不使用交叉工具链）。workspace 包管理器使用 manifest 的 `os`/`cpu` 字段选择此包；私有入口包将其定位到文件路径。该包不包含 JavaScript，也绝不会被导入。

该二进制文件被 git 忽略，并通过 `files` 列表进入内部验证 tarball。如果文件缺失或 ELF 架构错误，`prepack` 检查会拒绝打包；CI 的打包安装验证会按字节核验已安装二进制文件与 workspace 构建产物一致。静态 musl 链接使同一个二进制文件同时适用于 glibc 和 musl 发行版，因此名称中没有 libc 后缀。

同级包：`@deepseek-ai/node-addon-landlock-run-linux-x64`。
