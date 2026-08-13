import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'

const bin = fileURLToPath(new URL('../src/bin.ts', import.meta.url))
const root = fileURLToPath(new URL('../../..', import.meta.url))

describe('dsh desktop assembled CLI snapshot', () => {
  it('prints help through the real Bun entry without starting the app', async () => {
    const result = await execa('bun', [bin, '--help'], { cwd: root })

    expect(result.stderr).toBe('')
    expect(result.stdout).toMatchInlineSnapshot(`
      "Usage: dsh-desktop [options]

      Launch the DeepSeek Harness Web UI in a desktop window.

      Options:
        --browser             Open a dedicated browser window
        --webview             Open the system webview (WebView2 or WebKitGTK)
        --provider <provider> Select browser or webview
        --cwd <directory>     Use directory as the workspace (default: current directory)
        --port <port>         Set the loopback server port; 0 selects a free port (default: 0)
        --smoke               Start and fetch the UI without opening a window
        -h, --help            Show this help
        -V, --version         Show the version"
    `)
  })
})
