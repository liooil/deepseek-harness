# native/

English | [中文](README.zh.md)

Native source and internal packages maintained with DeepSeek Harness. The [`landlock-run/` workspace](landlock-run/README.md) owns the Landlock self-restrict-then-exec launcher consumed by the harness, including its architecture, three-package workspace family, platform support, and development workflow.

## Workspace and release boundary

`landlock-run/` and its packages belong to the repository's root pnpm workspace and lockfile. Harness consumers use the current workspace entry package during development and CI, so a launcher contract change and its consumer update can land and be tested together.

The main repository's `Landlock Run` workflow builds and tests each supported architecture. Its packed-install rehearsal checks the three local package artifacts without publishing them to npm. The entry package retains platform packages as optional workspace dependencies, so the harness selects only the package matching the user's operating system and CPU.
