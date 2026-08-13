import { parseArgs } from 'node:util'

export type DesktopProvider = 'browser' | 'webview'

export interface DesktopOptions {
  cwd: string
  help: boolean
  port: number
  provider: DesktopProvider
  smoke: boolean
  version: boolean
}

export const DESKTOP_HELP = `Usage: dsh-desktop [options]

Launch the DeepSeek Harness Web UI in a desktop window.

Options:
  --browser             Open a dedicated browser window
  --webview             Open the system webview (WebView2 or WebKitGTK)
  --provider <provider> Select browser or webview
  --cwd <directory>     Use directory as the workspace (default: current directory)
  --port <port>         Set the loopback server port; 0 selects a free port (default: 0)
  --smoke               Start and fetch the UI without opening a window
  -h, --help            Show this help
  -V, --version         Show the version
`

export function defaultDesktopProvider(platform: NodeJS.Platform): DesktopProvider {
  return platform === 'darwin' ? 'browser' : 'webview'
}

export function parseDesktopArgs(
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): DesktopOptions {
  const { values } = parseArgs({
    args: [...args],
    strict: true,
    allowPositionals: false,
    options: {
      browser: { type: 'boolean' },
      webview: { type: 'boolean' },
      provider: { type: 'string' },
      cwd: { type: 'string' },
      port: { type: 'string' },
      smoke: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'V' },
    },
  })

  const selectors = [values.browser, values.webview, values.provider !== undefined]
    .filter(Boolean).length
  if (selectors > 1) {
    throw new TypeError('--browser, --webview, and --provider are mutually exclusive')
  }

  const requestedProvider = values.browser
    ? 'browser'
    : values.webview
      ? 'webview'
      : values.provider
  if (requestedProvider !== undefined
    && requestedProvider !== 'browser'
    && requestedProvider !== 'webview') {
    throw new TypeError(`--provider must be browser or webview, received ${JSON.stringify(requestedProvider)}`)
  }

  const port = values.port === undefined ? 0 : Number(values.port)
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new TypeError(`--port must be an integer from 0 through 65535, received ${JSON.stringify(values.port)}`)
  }

  return {
    cwd: values.cwd ?? process.cwd(),
    help: values.help ?? false,
    port,
    provider: requestedProvider ?? defaultDesktopProvider(platform),
    smoke: values.smoke ?? false,
    version: values.version ?? false,
  }
}
