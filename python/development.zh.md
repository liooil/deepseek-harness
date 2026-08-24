# Python 贡献者工作流

[English](development.md) | 中文

根据所需的贡献者成果选择工作流：构建运行时产物、验证 SDK、从源码运行或构建本地 wheel 产物。包行为分别见 [SDK 参考](sdk/README.zh.md) 和[运行时载体参考](sdk-runtime/README.zh.md)。

## 构建运行时产物

各平台可执行文件是构建产物，不检入 git。请在仓库根目录运行构建：

```sh
pnpm install
pnpm exec tsx scripts/build-exe-for-python-sdk.ts
```

所需 `lib/` 产物已存在时使用 `--skip-build`；如需选择平台，请使用 `--targets=node24-linux-x64,node24-linux-arm64,node24-macos-arm64`。产物写入 `dist-exe/`，脚本会将所选载体同步到 `python/sdk-runtime/`。macOS 构建还会同步 `node-pty` 所需的配套 spawn 辅助程序。

## 验证 SDK

请将虚拟环境放在 `python/` 之外，安装测试组，然后运行 Python 测试套件：

```sh
export UV_PROJECT_ENVIRONMENT="$PWD/tmp/py-sdk-venv"
uv sync --project python/sdk --group test
uv run --project python/sdk pytest
```

`python/sdk/tests/test_bundled_runtime.py` 会运行可用的内置载体；某个载体的产物尚未构建时，会跳过该载体。仓库级测试政策见 [测试](../docs/testing.zh.md)。

该套件面向的是伪造的运行时对端。`scripts/smoke-python-runtime.py` 面向真实的打包运行时；必需的 `python-runtime` CI 任务会用新构建的可执行文件运行全部场景：

```sh
uv run --project python/sdk python scripts/smoke-python-runtime.py \
  --scenario sdk-minimal --exe dist-exe/dsh-jsonrpc-agent-pkg-macos-arm64
```

其中两个场景会比对 `scripts/snapshots/python-sdk-single-exe/` 下已提交的期望输出。`minimal/model-visible.json` 固定了签入的极简组合所组装的系统提示词、对外公布的工具 schema 以及模型可见消息，因此插件一旦贡献出计划外的系统分段或 user 消息，该任务即失败；它会丢弃动态运行时上下文快照——同一组合在 macOS 上会发出它，在 Linux 上不会（[#2488](https://github.com/deepseek-harness/deepseek-harness/issues/2488)）。`advanced/` 固定 SDK 结果与持久化的会话日志。重新运行对应场景时加上 `--update-snapshots`，并在提交前审阅该差异。

交互式冒烟测试需要环境变量或仓库根目录 `.env` 中存在 `DEEPSEEK_API_KEY`：

```python
from deepseek_harness import DeepSeekHarness

with DeepSeekHarness() as harness:
    print(harness.run("say hi").final_response)
```

## 针对 Node 源码运行

仓库贡献者可以选择以下任一开发载体：

- 设置 `DSH_RUNTIME_MODE=node`，在系统 Node `>=22.19` 上使用已构建的 Node 载体。构建脚本会刷新该载体，但分发物绝不会包含或自动选择它。
- 将仓库根目录设为 `cwd`，并设置 `launch_args_override=("./node_modules/.bin/tsx", "packages/examples/jsonrpc-demo/src/bin.ts")`，以运行未构建的 TypeScript 源码。默认配置不合适时，请提供 `cordis=...`。

完整的源码模式调用见 `python/sdk/tests/manual_sdk_agent_smoke.py`。

## 构建本地 wheel 产物

根目录 `package.json` 的版本是两个本地 Python wheel 产物的权威版本。暂存脚本会将该版本注入两个 wheel 包，并将 SDK 固定到同版本的 `deepseek-harness-runtime-bin`。此 fork 不会将这两个 Python 分发包发布到 PyPI；最终用户应使用 [GitHub Releases](https://github.com/liooil/deepseek-harness/releases) 页面上的桌面二进制。

纯 SDK wheel 包只需构建一次；每个原生平台分别构建一个运行时 wheel 包：

```sh
version="$(python - <<'PY'
import runpy

release = runpy.run_path("scripts/build-python-release.py")
print(release["pep440_version"](release["repository_version"]()))
PY
)"
python scripts/build-python-release.py --package sdk --output-dir dist-python
python scripts/build-python-release.py --package runtime --platform macos-arm64 --runtime-exe dist-exe/dsh-jsonrpc-agent-pkg-macos-arm64 --output-dir dist-python
pip install \
  "dist-python/deepseek_harness_sdk-$version-py3-none-any.whl" \
  "dist-python/deepseek_harness_runtime_bin-$version-py3-none-macosx_14_0_arm64.whl"
```

运行时产物仅提供 wheel 包。本地验证工作流会连同纯 SDK wheel 包一起构建三个平台 wheel 包：Linux x64、Linux arm64 和 macOS 14 或更高版本的 arm64。`0.0.1-rc.1` 之类的仓库预发布版本会在本地 wheel 包文件名和元数据中使用规范化的 PEP 440 写法，例如 `0.0.1rc1`。

## 验证本地 wheel 产物

`Build single-exe` 工作流及其 CI 调用方会构建全部四个 wheel 包或选定的平台子集，在 Python 3.10 和 3.14 上安装 Linux 集合，检查精确文件名和元数据，验证原生部署约束，并将检查过的 wheel 包保留为工作流产物。这些任务没有注册表凭据，也没有发布 job；添加 `build-exe` 标签或手动运行 workflow dispatch 即可开始验证。
