import type { DesktopProvider } from './args.ts'

interface InProcessWindow {
  readonly exited: Promise<void>
  close(): void
  executeScript(script: string): Promise<unknown>
}

interface BunDeskRuntime {
  createWebKitWindow(options: WindowOptions): Promise<InProcessWindow>
  createWebViewWindow(options: WindowOptions): Promise<InProcessWindow>
  launchAppWindow(options: { appId: string; url: URL }): Promise<Bun.Subprocess | null>
}

let embeddedBunDesk: BunDeskRuntime | undefined

interface WindowOptions {
  url: string
  title: string
  width: number
  height: number
  onNavigateCompleted?(info: { success: boolean; errorStatus: number }): void
}

export interface DesktopWindow {
  readonly exited?: Promise<unknown>
  close(): void
}

export function configureBundeskRuntime(runtime: unknown): void {
  embeddedBunDesk = runtime as BunDeskRuntime
}

async function resolveBunDeskRuntime(): Promise<BunDeskRuntime> {
  if (embeddedBunDesk) return embeddedBunDesk
  // BunDesk currently publishes Bun-native TypeScript. Keep dependency source
  // behind this runtime boundary so the host does not re-check its internals.
  const packageName: string = 'bundesk'
  return await import(packageName) as BunDeskRuntime
}

async function openInProcessWindow(
  create: (options: WindowOptions) => Promise<InProcessWindow>,
  options: WindowOptions,
): Promise<DesktopWindow> {
  let resolveNavigation: (() => void) | undefined
  let rejectNavigation: ((error: Error) => void) | undefined
  const navigation = new Promise<void>((resolve, reject) => {
    resolveNavigation = resolve
    rejectNavigation = reject
  })
  const window = await create({
    ...options,
    onNavigateCompleted(info) {
      if (info.success) resolveNavigation?.()
      else rejectNavigation?.(new Error(`webview navigation failed (status ${info.errorStatus})`))
    },
  })

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      navigation,
      new Promise<void>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('webview navigation timed out after 30s'))
        }, 30_000)
      }),
    ])
    const renderDeadline = Date.now() + 15_000
    let rendered = false
    while (!rendered && Date.now() < renderDeadline) {
      rendered = await window.executeScript(
        "document.getElementById('root')?.childElementCount > 0",
      ) === true
      if (!rendered) await Bun.sleep(100)
    }
    if (!rendered) throw new Error('webview loaded the document but the app root stayed empty for 15s')
    console.info('dsh-desktop: webview navigation and app render completed')
    return {
      exited: window.exited,
      close: () => {
        window.close()
      },
    }
  } catch (error) {
    window.close()
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export async function openDesktopWindow(url: URL, provider: DesktopProvider): Promise<DesktopWindow> {
  const bundesk = await resolveBunDeskRuntime()
  const common = {
    url: String(url),
    title: 'DeepSeek Harness',
    width: 1280,
    height: 840,
  }

  if (provider === 'webview') {
    if (process.platform === 'win32') {
      return openInProcessWindow(options => bundesk.createWebViewWindow(options), common)
    }
    if (process.platform === 'linux') {
      return openInProcessWindow(options => bundesk.createWebKitWindow(options), common)
    }
    throw new Error('The webview provider is available on Windows and Linux; use --browser on macOS')
  }

  const browser = await bundesk.launchAppWindow({
    appId: 'ai.deepseek.harness.desktop',
    url,
  })
  if (!browser) {
    console.info('dsh-desktop: the system browser launcher cannot report window closure; press Ctrl+C to stop')
    return { close() {} }
  }
  return {
    exited: browser.exited,
    close() {
      if (browser.exitCode === null) browser.kill()
    },
  }
}
