# @deepseek-ai/node-addon-landlock-run-linux-x64

English | [中文](README.zh.md)

Prebuilt `bin/landlock-run` Landlock launcher for linux-x64 — a static musl binary compiled natively (no cross toolchain) from the [entry package's C source](../entry/src/main.c). The workspace package manager uses the manifest's `os`/`cpu` fields to select this package; the private entry package resolves it to a file path. It ships no JavaScript and is never imported.

The binary is git-ignored and enters internal validation tarballs through the `files` list. The `prepack` check refuses to pack when it is missing or has the wrong ELF architecture, and the packed-install CI rehearsal byte-pins the installed binary against the workspace build. Static musl linking means one binary for glibc and musl distros alike — hence no libc suffix in the name.

Sibling: `@deepseek-ai/node-addon-landlock-run-linux-arm64`.
