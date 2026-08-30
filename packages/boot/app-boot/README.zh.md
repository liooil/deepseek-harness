---
description: "dsh profile 与临时 Python SDK 运行时的共享 Loader 启动支持：环境层、patch、诊断与配置预览。"
kind: "package-library"
---

# @deepseek-ai/dsh-app-boot

[English](README.md) | 中文

## 概述

`dsh-app-boot` 是 `dsh` profile（包括 Python 运行时 wheel 所打包的 CLI）背后的共享 Loader 启动库。它加载环境层、组合 profile bundle 与 patch、启动每个插件，再返回运行中的应用，或指出失败插件与原因。产品应用使用 `dsh` launcher 而不发布单独 bin；直接配置 helper 只保留给低层嵌入方与测试。你还可以在启动前预览生效配置，按 profile 选择实时或仅启动时应用 patch，并让持有终端的应用在致命退出前恢复终端。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

用此包启动应用是一个小而显式的入口：你给它一个配置文件，它运行整个启动过程。本节说明你能做什么、能得到什么；每个结果背后的 helper 调用记录在下方可折叠的实现章节中。

### 何时使用

在实现共享 `dsh` launcher 或嵌入其低层启动 helper 时使用它。产品功能应放入 profile bundle，而不是新增应用 bin；只向已运行应用添加插件的代码直接挂载插件即可。

### 启动应用

你把配置文件交给入口，进程就会启动整个应用：加载环境层、应用 patch 与 profile、启动每个插件，并在应用运行后返回。在回放模式下，它会启动同级的 `cordis.snapshot.yml` 替代文件，使已记录的会话能够原样复现。最小的入口只需两次调用：

```text
installFailLoud('dsh')
const ctx = await boot('dsh', resolveConfigPath(argv[2], process.env.DSH_SNAPSHOT))
```

有了这个入口，成功就是每个插件都已激活的运行中应用；失败绝不会悄无声息——一行带标签的信息点名失败的插件与阶段，进程以非零码退出。错误上报前会先拆卸应用上下文，因此不会留下半启动的残留。

<a id="profiles"></a>
### Profile

profile 是同一套 dsh 安装提供不同应用界面的方式：`web`、`headless`、`acp`、`sdk` 与 `sdk-minimal` 从同一 launcher 启动不同组合。profile 位于 `$DSH_HOME/profiles/<name>`，由可安装 bundle、自身 `cordis.patch.yml` 与 `patchReload: live | startup` 组成；自定义 profile 省略 reload 策略时保留历史 `live` 默认值。随产品交付的 `web` 模板实时重载，其他随附模板只在启动时应用 patch。`sdk-minimal` 只列出自身的独立 bundle，其他模板保留 base 加模式 bundle 的栈。`dsh plugin` 创建自定义 profile；缺失 bundle 或未声明 patch 的 bundle 会让启动明确失败。

你的机器本地偏好同样位于 harness home 中：

- **`.env`**——你的普通环境层：调用目录的文件优先于 harness home 的文件，两者都低于继承环境。决定进程如何启动的变量（`PATH`、代理、`DSH_*`、`XDG_*` 等）会被文件拒绝：请改为导出。对于只想加载某个目录 `.env` 的非产品 bin，文件缺失不影响启动，文件无法加载时输出一行带标签的警告。
- **`cordis.patch.yml`**——你的 tweak 层，应用在所有组合包层之后（先应用逐 profile 的文件，再应用 home 级文件，因此后者优先级更高）：替换某个条目的整个 config（重述你要保留的字段）、插入新条目，或在启动时插值 `!!js` 表达式。patch 指定的条目不存在时输出 stderr 警告；空文件或仅含注释的文件会导致启动失败——如需禁用该层，请改用 `[]`。

带 `patchReload: live` 的 profile 会监视两份用户 patch 文件：有效编辑无需重启即可重新组合，被拒绝的编辑则让最后一个可用应用继续运行。`startup` profile 既不安装这些监视器，也不安装 launcher 的仅监视 HMR 回退。

### 预览生效配置

启动前，你可以打印应用将挂载的确切配置：dump 会以 `!!js` 表达式原样展示组合后的条目列表，并按注释分组标明每个源文件及其 patch 层，输出是一份可加载的 YAML 文档。未匹配到任何行的 patch 会连同其层标签一起报告；配置缺失、无法解析或字段无效都会使 dump 失败。

### 启动失败时你会看到什么

启动失败是一行带标签的信息加非零退出码——绝不是静默卡死或原始堆栈倾倒。信息会点名失败的插件；抛错的插件保留原始错误，从未启动的条目会连同它等待的服务一起报告。

如果你的应用持有终端，它可以在进程退出前把终端交还，你的 shell 绝不会残留在 raw 模式。交还过程有界：卡住的清理只会延迟致命退出，而不会取消它。

### 告诉 agent harness 所在位置

当你的应用启动模型驱动的 agent 时，你可以告诉 agent DSH 实现代码 checkout 的位置：它得知该路径，也知道不得据此推断工作目录——它应使用 `pwd`。这条指示在系统提示词靠前位置出现一次。没有系统提示词服务的应用会跳过；开发环境中，重新加载系统提示词后它会消失，直至下次启动。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释上述结果如何实现，并指出实现它们的代码位置；这里的内容面向开发者，使用本包并不需要。

### 设计说明

- **与渠道无关的库。** 此包不包含 loader 钩子，也不提供开发模式接口；[`dsh` 应用](../../../apps/cli/README.zh.md) 持有自己的 Node 源码启动钩子，并在启动序列中使用这些 helper，构建后的消费方则使用普通 Node 包解析。
- **两个 Loader builtin。** `mountRootInclude` 把 `cordis:include` 与 `cordis:group` 注册为 Loader builtin：group 行能把一个提供方与它的消费方放进同一个 `isolate` realm，而位于本工作区之外的 agent preset 无法按名称解析 `@deepseek-ai/cordis-plugin-group`。两者都通过宿主的模块管线加载，而非被包含树自身的说明符解析。
- **Profile 模块后备机制。** 裸插件 specifier 由 Loader 从配置目录解析。普通 Node 会为安装依赖闭包中的每个包维护一个符号链接。打包可执行文件无法让操作系统符号链接进入 pkg 的 `/snapshot` 树，因此会按 Node ESM 条件读取已安装包的 export map，并写入重新导出虚拟模块 URL 的真实代理包。缺失 export 保持不可用，错误 export map 会让启动失败，跨进程 writer lock 则会在不暴露部分代理的情况下替换陈旧条目。所选外部 bundle 若不在安装闭包中，则会获得 profile 本地的 `.dsh-module-fallback` 链接；已有 pnpm 条目优先，后续闭包发现会排除投影链接，清理也只删除 dsh 自有链接。
- **单一 rejection 检查点。** `assertEntriesActivated` 把折入启动诊断的确切原因保持到下一个进程级 rejection 检查点可见，使 `installFailLoud` 能合并 Loader 的重复通知，而所有无关的未处理 rejection 仍然致命。
- **两阶段失败标签。** `boot()` 区分 `host preparation failed`（`prepare` 在任何配置树条目挂载前抛出）与 `plugin tree failed to load`（此后的一切失败），并追加最深层插件错误的堆栈，使启动诊断保留原始激活错误，而不只是包装链。

### Helper 行为

每个导出各负责启动的一个阶段：配置解析与快照回放、分层环境加载、明确报错的保护机制、激活审计、patch 解析、根 include 挂载、配置 dump 渲染、活动 patch 监视、profile 组合，以及 harness 源码段落。各导出的约定在代码中，不在本 README——见 [`src/index.ts`](src/index.ts) 与 [`src/profile.ts`](src/profile.ts)。

### 源码地图

| 文件 | 职责 |
|---|---|
| `resolveConfigPath(path, snapshotMode, cwd?)` | 生成绝对配置路径；当 `snapshotMode === 'replay'` 时，把 basename 为 `cordis.yml`/`.yaml` 的文件替换为同级 `cordis.snapshot.yml` |
| `loadEnv(binName, dir?, warn?)` | 加载已被 git 忽略的 `.env`（Node `process.loadEnvFile`）；文件不存在不影响启动，文件无法加载时输出一行带标签的警告（默认写入 stderr） |
| `loadLayeredEnv(binName, cwd?, warn?)` | 构建产品 CLI（命令行界面）冻结的「继承环境 > 项目 `.env` > 用户 `.env`」快照，拒绝文件中的 bootstrap-only 变量，并在不替换继承值的前提下物化其余文件值 |
| `installFailLoud(binName, proc?, release?)` | 将启动期或后续未处理的 Loader 拒绝转换为一行带标签的 stderr 消息并执行 `exit(1)`；两者之间会等待可选的 `release` 清理钩子（以 `FAIL_LOUD_RELEASE_TIMEOUT_MS` 为上限），使持有终端的界面能在退出前恢复终端；返回卸载函数 |
| `FAIL_LOUD_RELEASE_TIMEOUT_MS` | `installFailLoud` 等待其 `release` 回调的时长；卡死的 disposer 只会延迟致命退出，而不会取消它 |
| `assertEntriesLoaded(ctx, binName)` | 树结算后，如果其中存在已启用但没有 fiber 的条目，则抛出异常，并以 Cordis 启动故障的形式报告每个未解析插件的名称 |
| `assertEntriesActivated(ctx, binName)` | 先执行 `assertEntriesLoaded` 检查，再在 Loader 结算后等待每个已启用配置项；抛出的错误包含每个失败插件的原始错误堆栈，或每个等待中插件尚未解析的服务 |
| `loadOptionalPatches(binName, file)` | 解析一份可选的 patch 列表文件（即 profile 的 `cordis.patch.yml`）：其顶层是一个 YAML 数组，内容为 include 的 `PatchOptions`（按 id 定位的配置覆盖、`insert` 列表，允许 `!!js`）；文件不存在时返回 `undefined`，文件不可读、不可解析或内容不是数组时抛出异常 |
| `loadOverlayPatches(binName, file)` | 解析必需的顶层 YAML 数组，其中包含与上文相同的 include `PatchOptions` 条目；文件缺失也会抛出异常，因为该文件是调用方指名的 |
| `mountRootInclude(ctx, absoluteConfigPath, patches?, bareModuleBaseUrl?, bareModuleImporter?)` | 注册静态导入的 `cordis:include` 与 `cordis:group` builtin，挂载 include，并保留用户 patch 层 HMR（热模块替换）使用的确切根配置项；可选模块基准会把裸包名锚定到已安装宿主，编译宿主也可以改为提供 importer；相对名称仍以配置目录为基准 |
| `watchUserPatches(ctx, options)` | 向现有 Cordis HMR 服务注册指名的 patch 文件；每次新增、变更或移除都会通过调用方的 `compose` 闭包（应用自有层围绕当前用户层）以事务方式重新组合完整 patch 列表，并返回异步 disposer |
| `resolveProfileDir` / `initProfile` / `loadProfile` / `readProfileManifest` / `writeProfileManifest` / `resolveBundleDir` / `composeEntries` / `healProfilesModuleFallback` / `PROFILE_TEMPLATES` / `DEFAULT_PROFILE_BUNDLES` / `PROFILES_DIR` / `PROFILE_PATCH_FILENAME` | Profile 机制（见 [Profile](#profiles)） |
| `boot(binName, absoluteConfigPath, patches?, prepare?, bareModuleBaseUrl?, bareModuleImporter?)` | 创建根上下文，向 Loader `!!js` 配置表达式暴露 `dshHomePath(...segments)` 并安装 Loader，在配置树条目挂载前执行可选的宿主准备操作（`prepare` 可以使用 Loader，也可以提供由启动器拥有的上下文插槽），再挂载并等待 include 树结算，断言所有条目均已加载并激活，最后返回根上下文——失败时 dispose（资源释放）部分构造的上下文，并以带标签的错误 reject；可选模块基准／importer 与 `mountRootInclude` 的解析语义相同 |
| `DshRuntimePaths` / `ctx.dshRuntimePaths` | 可选的打包宿主文件系统 resolver，用于解析包清单、已导出的客户端子路径和模型可见的 harness 源码根目录；它是启动上下文数据，不是 Cordis service |
| `renderConfigDump(binName, absoluteConfigPath, layers, warn?)` | 使用 include 自己的解析器和补丁算法（`entryListSchema`/`applyEntryPatches`）离线合成基础配置与带标签的覆盖层，使结果与 `boot()` 挂载的内容一致，再渲染为 YAML，并原样保留 `!!js` 表达式；每段来源于同一文件且由相同补丁层修改的连续行之前都有一条 `# ==` 注释，标明该文件和这些补丁层，输出仍是一份可加载的文档；未匹配到行的补丁连同其层标签交给 `warn`（默认：一行 stderr），读取、解析或字段验证失败则抛出 |
| `addHarnessSourceSection(ctx, sourceRoot)` | 添加全局 `harness:source` 提示词段落（顺序紧随 harness 身份、位于 persona 之前），告知 agent（智能体）DSH 实现代码 checkout 的磁盘路径，同时提醒它不得据此推断当前工作目录，而应使用 `pwd`；如果已启动树没有此项服务，则不执行操作并返回 `undefined`。这里的服务是 `systemPrompt`；该段落注册到它的 fiber，因此开发环境 HMR 重新加载系统提示词后，它会消失直至下次启动 |
| `HARNESS_SOURCE_SECTION` | `'harness:source'` 段落名称，供 `addHarnessSourceSection` 注册使用 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

配置中的裸插件 specifier（`@deepseek-ai/dsh-*`、npm 包）通过 Cordis Loader 的内部模块 loader 解析。默认情况下，它们从配置目录解析；已安装的封闭运行时会传入 `bareModuleBaseUrl`，编译后的封闭运行时则传入 `bareModuleImporter`，从而让宿主自己的插件集合保持权威。相对 specifier 始终以配置目录为基准解析。仓库 bin 会安装 Loader 的可选对等依赖（peer dependency） `node-addon-require-builtin`；外部调用方必须提供该组件，或者把插件安装到普通 Node import 解析可以找到的位置。构建后的 `dsh-app-boot` 产物内嵌静态挂载的 Include 实现，但仍将 Loader 保持为外部依赖，因此 include 树与宿主会绑定到同一个 Loader peer。`pnpm dsh` 源码路径还会将 manifest（元数据清单）声明的 workspace 包映射到其 TypeScript 源码；其配置门禁要求每个随附的原始／Web 裸插件都出现在解析所用 manifest 的 `dependencies` 中。

- [Cordis 入门](../../../docs/cordis-primer.zh.md)——Loader、`!!js` 配置表达式，以及 include/group 语义。
- [dsh 应用](../../../apps/cli/README.zh.md)——消费这些 helper 的 `dsh` bin。
- [dsh-cmdline](../cmdline/README.zh.md)——各 bin 使用的启动器到应用命令行交接。
- [Profile 组合包](../../bundle/README.zh.md)——组合进 `dsh --profile` 的可安装 patch 层。
- [dsh-home-paths](../../util/home-paths/README.zh.md)——harness home 解析器（`resolveDshHome`）。
- [配置来源归属](../../../.agents/notes/implemented/architecture/2026-08-04-configuration-source-ownership.zh.md)——被发现的文件为何不得决定 bootstrap 行为。
- [Profile 插件组合包](../../../.agents/notes/implemented/architecture/2026-08-05-profile-plugin-bundles.zh.md)——profile 与组合包组合设计。

-----

<a id="model-experience"></a>
## 模型体验

模型通过此包加载的插件树间接受影响——只有该树贡献模型上下文；唯一贡献模型可见文本的导出 `addHarnessSourceSection`，也只有在消费方启动后调用它时才会产生影响。

#### KV Cache 影响

启动本身不会使请求前缀中的任何内容失效。消费方调用 `addHarnessSourceSection` 时，会在系统提示词靠前位置、逐请求内容之前添加一行短文本，因此不会使跨轮次缓存失效；请求前缀的其他任何变化均由相应的具名消费方负责。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明此启动库在何时不合适，或何时需要特别注意。它们是当前包约束，不是任务积压。

- **裸包 specifier 依赖 Loader 内部机制**——生产 bin 需要 Loader 的可选原生辅助组件；没有该辅助组件的进程内调用方必须使用可解析的相对／file specifier，或提供自己的模块解析钩子。
- **快照回放替换仅识别特定 basename**——只有以 `cordis.yml` 或 `cordis.yaml` 结尾的配置会映射到同级 `cordis.snapshot.yml`；自定义配置名称需要调用方自行选择。
- **环境发现以启动为界**——`loadLayeredEnv` 只读取一次调用目录与 harness home 中的 `.env`；它不搜索父目录，也不跟随之后选择的 workspace。`loadEnv` 仍是非产品 bin 使用的单目录 helper。
- **用户 patch 会替换匹配到的整个配置**——按 id 定位的 patch 不做深度合并，因此 profile 覆盖必须重述需要保留的组合包字段。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：开放设计问题与尚未决定的探索方向。它明确不具权威性——已交付的行为、限制与既定理由以上文、包代码和相关 Agent Note 为准。

#### 待定：配置 dump 稳定性

`renderConfigDump` 的输出是一份可加载的 YAML 文档，其 `# ==` 来源注释与 `!!js` 原样渲染服务于 `--dump-config` 诊断。任何内容都不承诺跨包版本的字节稳定性；在程序化消费该输出之前，请决定 dump 是否成为序列化约定。

</details>
