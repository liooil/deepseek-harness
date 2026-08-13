#!/usr/bin/env bun

import { DESKTOP_HELP, parseDesktopArgs } from './args.ts'
import { embeddedDshRuntimeVersion, startDshWeb } from './dsh-web.ts'
import { openDesktopWindow, type DesktopWindow } from './window.ts'

interface TerminationWatcher {
  promise: Promise<NodeJS.Signals>
  dispose(): void
}

function waitForTerminationSignal(): TerminationWatcher {
  let resolveSignal: ((signal: NodeJS.Signals) => void) | undefined
  const promise = new Promise<NodeJS.Signals>((resolve) => {
    resolveSignal = resolve
  })
  const onSigint = () => resolveSignal?.('SIGINT')
  const onSigterm = () => resolveSignal?.('SIGTERM')
  process.once('SIGINT', onSigint)
  process.once('SIGTERM', onSigterm)
  return {
    promise,
    dispose() {
      process.off('SIGINT', onSigint)
      process.off('SIGTERM', onSigterm)
    },
  }
}

async function readVersion(): Promise<string> {
  const embeddedVersion = embeddedDshRuntimeVersion()
  if (embeddedVersion) return embeddedVersion
  const manifest = await Bun.file(new URL('../package.json', import.meta.url)).json() as { version: string }
  return manifest.version
}

async function runSmoke(url: URL): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`desktop smoke request failed with HTTP ${response.status}`)
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/html')) {
    throw new Error(`desktop smoke request expected text/html, received ${JSON.stringify(contentType)}`)
  }
  await response.body?.cancel()
  console.info(`dsh-desktop: smoke check passed (${url})`)
}

export async function runDesktop(argv: string[]): Promise<void> {
  const options = parseDesktopArgs(argv)
  if (options.help) {
    process.stdout.write(DESKTOP_HELP)
    return
  }
  if (options.version) {
    console.log(`dsh-desktop ${await readVersion()}`)
    return
  }

  console.info(`dsh-desktop: starting dsh web for ${options.cwd}`)
  const web = await startDshWeb({ cwd: options.cwd, port: options.port })
  console.info(`dsh-desktop: ready at ${web.url}`)

  if (options.smoke) {
    try {
      await runSmoke(web.url)
    } finally {
      await web.stop()
    }
    return
  }

  console.info(`dsh-desktop: opening ${options.provider} window`)
  const signal = waitForTerminationSignal()
  let window: DesktopWindow | undefined
  try {
    window = await openDesktopWindow(web.url, options.provider)
    const events: Array<Promise<{ kind: 'server'; code: number } | { kind: 'window' } | { kind: 'signal' }>> = [
      web.exited.then(code => ({ kind: 'server' as const, code })),
      signal.promise.then(() => ({ kind: 'signal' as const })),
    ]
    if (window.exited) events.push(window.exited.then(() => ({ kind: 'window' as const })))
    const event = await Promise.race(events)
    window.close()
    if (event.kind !== 'server') await web.stop()
    if (event.kind === 'server' && event.code !== 0) {
      throw new Error(`dsh web exited with code ${event.code}`)
    }
  } finally {
    signal.dispose()
    window?.close()
    if (web.exitCode === null) await web.stop()
  }
}

if (import.meta.main) {
  void runDesktop(Bun.argv.slice(2)).catch((error: unknown) => {
    console.error(`dsh-desktop: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
