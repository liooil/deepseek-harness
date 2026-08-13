import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { extractDshWebUrl } from './readiness.ts'

const STARTUP_TIMEOUT_MS = 60_000
const SHUTDOWN_TIMEOUT_MS = 6_000

export interface DshWebSession {
  readonly url: URL
  readonly exited: Promise<number>
  readonly exitCode: number | null
  stop(): Promise<number>
}

async function resolveDshBin(): Promise<string> {
  const require = createRequire(import.meta.url)
  const manifest = require.resolve('@deepseek-ai/dsh/package.json')
  const bin = join(dirname(manifest), 'lib', 'bin.js')
  if (!await Bun.file(bin).exists()) {
    throw new Error(`DeepSeek Harness is not built (${bin} is missing); run pnpm run build first`)
  }
  return bin
}

async function consumeLines(
  stream: ReadableStream<Uint8Array>,
  output: NodeJS.WriteStream,
  onLine: (line: string) => void,
): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  while (true) {
    const { done, value } = await reader.read()
    const text = decoder.decode(value, { stream: !done })
    if (text) {
      output.write(text)
      pending += text
      let newline = pending.indexOf('\n')
      while (newline >= 0) {
        onLine(pending.slice(0, newline).replace(/\r$/, ''))
        pending = pending.slice(newline + 1)
        newline = pending.indexOf('\n')
      }
    }
    if (done) break
  }
  if (pending) onLine(pending)
}

function waitForExit(
  exited: Promise<number>,
  timeoutMs: number,
): Promise<number | undefined> {
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => {
      resolveExit(undefined)
    }, timeoutMs)
    void exited.then((code) => {
      clearTimeout(timer)
      resolveExit(code)
    })
  })
}

export async function startDshWeb(options: { cwd: string; port: number }): Promise<DshWebSession> {
  const node = Bun.which('node')
  if (!node) throw new Error('Node.js is required to run DeepSeek Harness')

  const bin = await resolveDshBin()
  const subprocess = Bun.spawn([node, bin, 'web', '--port', String(options.port)], {
    cwd: resolve(options.cwd),
    env: process.env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const exited = subprocess.exited

  let resolveReady: ((url: URL) => void) | undefined
  let rejectReady: ((error: Error) => void) | undefined
  const ready = new Promise<URL>((resolveUrl, reject) => {
    resolveReady = resolveUrl
    rejectReady = reject
  })
  const inspectLine = (line: string) => {
    const url = extractDshWebUrl(line)
    if (url) resolveReady?.(url)
  }
  void consumeLines(subprocess.stdout, process.stdout, inspectLine).catch((error: unknown) => {
    rejectReady?.(error instanceof Error ? error : new Error(String(error)))
  })
  void consumeLines(subprocess.stderr, process.stderr, inspectLine).catch((error: unknown) => {
    rejectReady?.(error instanceof Error ? error : new Error(String(error)))
  })

  let startupTimer: ReturnType<typeof setTimeout> | undefined
  try {
    const url = await Promise.race([
      ready,
      exited.then(code => Promise.reject(new Error(`dsh web exited before it was ready (code ${code})`))),
      new Promise<URL>((_, reject) => {
        startupTimer = setTimeout(
          () => {
            reject(new Error(`dsh web did not become ready within ${STARTUP_TIMEOUT_MS}ms`))
          },
          STARTUP_TIMEOUT_MS,
        )
      }),
    ])
    clearTimeout(startupTimer)

    let stopPromise: Promise<number> | undefined
    return {
      url,
      exited,
      get exitCode() {
        return subprocess.exitCode
      },
      stop() {
        stopPromise ??= (async () => {
          if (subprocess.exitCode !== null) return exited
          subprocess.kill('SIGTERM')
          const gracefulCode = await waitForExit(exited, SHUTDOWN_TIMEOUT_MS)
          if (gracefulCode !== undefined) return gracefulCode
          subprocess.kill('SIGKILL')
          return exited
        })()
        return stopPromise
      },
    }
  } catch (error) {
    clearTimeout(startupTimer)
    if (subprocess.exitCode === null) subprocess.kill('SIGTERM')
    const gracefulCode = await waitForExit(exited, SHUTDOWN_TIMEOUT_MS)
    if (gracefulCode === undefined && subprocess.exitCode === null) {
      subprocess.kill('SIGKILL')
      await exited
    }
    throw error
  }
}
