# DeepSeek Harness Python SDK

[English](README.md) | 中文

通过 JSON-RPC stdio 驱动 DeepSeek Harness 的 Python 子进程 SDK。此 fork 不会将 SDK 或其运行时 wheel 包发布到 PyPI；它们只是内部开发与 CI 产物。最终用户应从 [GitHub Releases](https://github.com/liooil/deepseek-harness-desktop/releases) 页面下载匹配的桌面可执行文件。运行时继承常规的 DeepSeek Harness 环境变量（如 `DEEPSEEK_BASE_URL` 与 `DEEPSEEK_API_KEY`），本地调用方可以直接使用真实模型端点，也可以把这些变量指向本地代理。

如需在仓库内验证，请构建本机运行时并同步可编辑的 SDK 环境：

```sh
pnpm install
pnpm exec tsx scripts/build-exe-for-python-sdk.ts
uv sync --project python/sdk
```

## 启动运行时

Python SDK 没有独立的应用入口。它以 `--profile sdk` 启动内置的 `dsh` CLI；所选 profile 负责 JSON-RPC 服务器、agent 组合、凭据、持久化、工具和关闭流程。

每次启动都必须显式指定 Harness home。请传入 `dsh_home`，或在子进程环境中提供非空的 `DSH_HOME`。SDK 刻意不会发现 `~/.dsh`。

```py
from deepseek_harness import DeepSeekHarness

with DeepSeekHarness(
    dsh_home="/absolute/path/to/isolated-dsh-home",
    cwd="/absolute/path/to/workspace",
    provider="deepseek-official",
    model="deepseek-v4-flash",
    reasoning_effort="max",
    max_tokens=49_152,
) as harness:
    result = harness.run("Say hi.", session_id="example-001")

print(result.final_response)
```

`DeepSeekHarness` 延迟启动运行时，并在调用 `close()` 或退出上下文管理器前复用该进程。首次 profile 握手通过 `initialize_timeout_seconds` 使用独立的 30 秒默认上限；普通轮次在未设置 `request_timeout_seconds` 时仍不设上限。超时诊断会指明所选 profile，并包含保留的运行时诊断。`cwd` 是 agent workspace；`runtime_cwd` 独立选择子进程工作目录。两者都会在启动前转成绝对路径。`provider`、`model`、可选的 `reasoning_effort` 和可选的正整数 `max_tokens` 通过 JSON-RPC 初始化发送。`base_url` 与 `api_key` 会显式覆盖子进程环境中的 `DEEPSEEK_BASE_URL` 与 `DEEPSEEK_API_KEY`。

## 自定义插件

持久自定义属于 `dsh` profile。使用运行时 wheel 提供的 `dsh` 命令初始化随附的 SDK profile，并安装外部 bundle：

```sh
export DSH_HOME=/absolute/path/to/isolated-dsh-home
dsh --profile sdk --dump-default-config >/dev/null
dsh plugin --profile sdk add file:/absolute/path/to/my-plugin-bundle
```

`file:` 形式会把本地 bundle 安装到 profile 包树中，使其 peer import 可以到达内置安装后备。Profile manifest 会记录已安装依赖与有序 bundle 层；`$DSH_HOME/profiles/sdk/cordis.patch.yml` 是持久用户 patch。只有管理外部包时，`dsh plugin` 才需要 `pnpm`。运行 SDK 不需要系统 Node.js。

对于单次调用的变更，可传入一个或多个 patch 文件。它们会转成绝对路径，并在 profile 层与 home patch 层之后按顺序传给 CLI：

```py
with DeepSeekHarness(
    dsh_home="/absolute/path/to/isolated-dsh-home",
    profile="sdk",
    patches=("/absolute/path/to/first.patch.yml", "/absolute/path/to/last.patch.yml"),
) as harness:
    result = harness.run("Make the requested code change.")
```

`profile` 可以选择另一个已存在的 profile，但该组合必须保留 `@deepseek-ai/dsh-sdk-app` 或另一个 `@deepseek-ai/dsh-sdk-jsonrpc-server` 配置项。配置错误会在 CLI 启动或 SDK 初始化时失败；不存在完整配置回退。`dsh_bin` 可以选择另一个 `dsh` 可执行程序，同时保持相同的 profile 语法。任意 argv 替换仅是内部 fake-runtime 测试适配器，不属于公开 API。

[Python SDK 教程](https://github.com/liooil/deepseek-harness-desktop/blob/master/docs/user/guide/python-sdk.md)提供一套无需使用 Web UI、按步骤完成本地构建和首次运行的流程。该教程所用的完整独立 Cordis 配置文件位于 [`jsonrpc-agent` 示例](https://github.com/liooil/deepseek-harness-desktop/blob/master/examples/jsonrpc-agent/README.md)中。

随附的 `sdk-minimal` profile 是独立显式配置树，而不是 `dsh-base` 上的 overlay。使用 `profile="sdk-minimal"` 选择它；普通 `model` 参数是唯一运行时模型选择，也适用于不在适配器建议目录中的模型 id。它提供持久 Bash、字符串替换 editor、本地执行与 JSONL 会话；settings、托管凭据、遥测、Web 工具与完整默认工具清单仍由独立的完整 `sdk` 与 `web` profile 提供。

## 结果与通知

也可以通过 `DSH_CORDIS_CONFIG` 为运行时子进程指定配置。注入逻辑位于 `HarnessClient.start()`，因此底层客户端按默认方式启动时也具有该行为：如果启动方式最终解析为内置运行时，且既没有设置 `cordis`，也没有设置非空的 `DSH_CORDIS_CONFIG`（运行时将空值视为未设置，注入检查也是如此），系统就会使用内置默认配置；显式指定 `runtime_bin`、`bridge_bin` 或 `launch_args_override` 时，则会完全禁用该注入。运行时载体（生产用 exe 与仅限开发的 `node` 闭包）及其获取方式见 [sdk-runtime README](https://github.com/liooil/deepseek-harness-desktop/blob/master/python/sdk-runtime/README.md)。

`HarnessClient` 会在运行时进程的整个生命周期内保留已发现的子 agent 祖先关系。在 `Session.run()` 期间，`RunResult.notifications` 与 `on_notification` 按协议顺序接收根会话和已知后代的通知。`RunResult.events` 只包含根会话事件，因此后代输出不会替换根响应。底层 `session_prompt()` 会立即返回已排队消息的 id；绕过 `Session.run()` 的调用方自行负责后续活动边界。

所选 home 保存 profile、插件与每个 profile 自有的持久资源。完整 `sdk` profile 使用其中的凭据、设置与会话存储；`sdk-minimal` 只使用自己的 JSONL 会话存储。需要隔离这些资源时应使用新的 home；独立工作应使用新的 session id。同时复用 harness 与 session id 会延续持久对话和会话资源。

另见 [Python 教程](../../docs/user/guide/python-sdk.zh.md)、[可运行示例](examples/README.zh.md)和[运行时 wheel 参考](../sdk-runtime/README.zh.md)。
