#!/usr/bin/env bun

import { DESKTOP_HELP, parseDesktopArgs } from './args.ts'
import { embeddedDshRuntimeVersion, startDshWeb, type DshWebSession } from './dsh-web.ts'
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

async function runSmoke(web: DshWebSession): Promise<void> {
  const request = { signal: AbortSignal.timeout(30_000) }
  const login = await fetch(web.url, { ...request, redirect: 'manual' })
  let cookie: string | undefined
  let response = login
  if (login.status >= 300 && login.status < 400) {
    const location = login.headers.get('location')
    const setCookie = login.headers.get('set-cookie')
    if (location === null || setCookie === null) {
      throw new Error('desktop smoke token exchange omitted its redirect or session cookie')
    }
    const sessionCookie = setCookie.split(';', 1)[0]
    if (sessionCookie === undefined || sessionCookie === '') {
      throw new Error('desktop smoke token exchange returned an empty session cookie')
    }
    cookie = sessionCookie
    await login.body?.cancel()
    response = await fetch(new URL(location, web.url), {
      ...request,
      headers: { cookie: sessionCookie },
    })
  }
  if (!response.ok) throw new Error(`desktop smoke request failed with HTTP ${response.status}`)
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/html')) {
    throw new Error(`desktop smoke request expected text/html, received ${JSON.stringify(contentType)}`)
  }
  const html = await response.text()
  if (!html.includes('globalThis["__DSH_BOOT__"]')) throw new Error('desktop smoke: UI boot manifest is missing')
  const paths = new Set<string>()
  for (const match of html.matchAll(/"url":"([^"#]+)"/g)) {
    const path = match[1]
    if (path !== undefined) paths.add(path)
  }
  for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    const path = match[1]?.replaceAll('&amp;', '&')
    if (path?.startsWith('/')) paths.add(path)
  }
  if (paths.size === 0) throw new Error('desktop smoke: UI declares no client resources')
  await Promise.all([...paths].map(async (path) => {
    const asset = await fetch(new URL(path, web.url), {
      ...request,
      ...(cookie === undefined ? {} : { headers: { cookie } }),
    })
    if (!asset.ok) throw new Error(`desktop smoke: UI resource ${path} returned HTTP ${asset.status}`)
    await asset.body?.cancel()
  }))
  await web.verifyRuntime()
  console.info(`dsh-desktop: smoke check passed (${web.url}; workers + sharp + ripgrep + terminal)`)
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
      await runSmoke(web)
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
