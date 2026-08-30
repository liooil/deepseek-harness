# DeepSeek Harness

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

Documentation: [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## Developer preview

DeepSeek Harness is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

## Run

### Run the desktop binary

Download the matching `dsh-desktop-{linux,windows,macos}-{x64,arm64}` executable from [GitHub Releases](https://github.com/liooil/deepseek-harness/releases). Release executables include the server and Web UI and do not require Node.js, Bun, or npm.

```sh
chmod +x ./dsh-desktop-linux-x64
./dsh-desktop-linux-x64
```

On Windows, run the `.exe` asset directly. Linux webview mode requires WebKit2GTK 4.1; Windows webview mode requires WebView2. Use `--browser` to open a dedicated browser window, or `--smoke --cwd <directory>` to validate a release without opening a window. See the [desktop launcher guide](apps/desktop/README.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/liooil/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

### Run the desktop app from source

The desktop launcher requires both `Node.js` and [Bun](https://bun.sh). Build the repository first, then run:

```sh
pnpm desktop
```

Windows and Linux use the system webview by default; macOS uses a dedicated browser window. Select either mode explicitly with `pnpm desktop --webview` or `pnpm desktop --browser`. See the [desktop launcher guide](apps/desktop/README.md) for requirements and options. `pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.

## Community and support

- Submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
