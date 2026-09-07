import { createRequire } from 'node:module'
import { constants, existsSync, globSync } from 'node:fs'
import { access, readFile, readdir } from 'node:fs/promises'
import { delimiter, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadLayeredEnv, type DshRuntimePaths } from '@deepseek-ai/dsh-app-boot'
import { runProfile } from '@deepseek-ai/dsh/profile-boot'
import { detectImage } from '@deepseek-ai/dsh-attachment-local/src/image.ts'
import { configureRipgrepPath, resolveRgPath } from '@deepseek-ai/dsh-tool-fs-search/src/search-core.ts'
import { verifyWorkflowWorkerEntry } from '@deepseek-ai/dsh-workflow-worker-thread'
import { dlopen, FFIType } from 'bun:ffi'
import {
  disposeEmbeddedNativeRuntime,
  type EmbeddedDshRuntime,
  embeddedNativeRuntimeWasMaterialized,
  materializeEmbeddedNativePath,
} from './embedded-runtime.ts'
import { shouldPreloadSharpLibrary } from './native-library.ts'

let embeddedRuntime: EmbeddedDshRuntime | undefined
let compiledPluginImporter: ((name: string) => unknown) | undefined
let sharpNativeLibrary: ReturnType<typeof dlopen> | undefined
let prepareSharpPromise: Promise<void> | undefined
let sourceWorkspacePackages: Promise<Map<string, { root: string; manifest: WorkspaceManifest }>> | undefined

interface WorkspaceManifest {
  readonly name?: string
  readonly main?: string
  readonly exports?: string | Record<string, unknown>
}

export interface DshWebSession {
  readonly url: URL
  readonly exited: Promise<number>
  readonly exitCode: number | null
  /** Exercise Bun-hosted code and workflow worker threads without an LLM call. */
  verifyRuntime(): Promise<void>
  stop(): Promise<number>
}

export function configureEmbeddedDshRuntime(
  runtime: EmbeddedDshRuntime,
  importer: (name: string) => unknown,
): void {
  embeddedRuntime = runtime
  compiledPluginImporter = importer
}

export function embeddedDshRuntimeVersion(): string | undefined {
  return embeddedRuntime?.version
}

function resolveRuntime(): {
  installAnchor: string
  shippedPresetRoot: string
  runtimePaths?: DshRuntimePaths
} {
  const installAnchor = embeddedRuntime === undefined
    ? undefined
    : join(embeddedRuntime.root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  const resolvedInstallAnchor = installAnchor
    ?? createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json')
  const packageRoot = dirname(resolvedInstallAnchor)
  const nodeModulesRoot = resolve(packageRoot, '../..')
  const runtime = embeddedRuntime
  if (runtime !== undefined) {
    configureRipgrepPath(() => materializeEmbeddedNativePath(
      runtime,
      join('native', process.platform === 'win32' ? 'rg.exe' : 'rg'),
      true,
    ))
  }
  return {
    installAnchor: resolvedInstallAnchor,
    shippedPresetRoot: join(packageRoot, 'config', 'agent-presets'),
    ...(embeddedRuntime === undefined ? {} : { runtimePaths: {
      resolvePackageJson: packageName => join(nodeModulesRoot, ...packageName.split('/'), 'package.json'),
      resolvePackageExport: (packageName, subpath) => join(nodeModulesRoot, ...packageName.split('/'), subpath),
      harnessSourceRoot: dirname(embeddedRuntime.root),
    } }),
  }
}

/**
 * Prepare Sharp's target-native dependencies when the first image operation needs them.
 * @returns settlement after the native library path is ready.
 */
export function prepareEmbeddedSharpRuntime(): Promise<void> {
  prepareSharpPromise ??= prepareSharp()
  return prepareSharpPromise
}

async function prepareSharp(): Promise<void> {
  if (embeddedRuntime === undefined) return
  const nativeLibraryPath = await materializeEmbeddedNativePath(embeddedRuntime, join('native', 'sharp'))
  const key = process.platform === 'win32' ? 'PATH' : process.platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH'
  process.env[key] = [nativeLibraryPath, process.env[key]].filter(Boolean).join(delimiter)
  const libraryName = (await readdir(nativeLibraryPath)).find(name => /vips.*\.(?:so(?:\.|$)|dylib$|dll$)/i.test(name))
  if (libraryName === undefined) throw new Error(`dsh-desktop: libvips library is missing from ${nativeLibraryPath}`)
  if (shouldPreloadSharpLibrary(process.platform)) {
    sharpNativeLibrary ??= dlopen(join(nativeLibraryPath, libraryName), {
      vips_init: { args: [FFIType.cstring], returns: FFIType.i32 },
    })
  }
}

function conditionalExport(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  return conditionalExport(record.default ?? record.import ?? record.node)
}

function packageEntry(manifest: WorkspaceManifest, subpath: string): string | undefined {
  const key = subpath === '' ? '.' : `./${subpath}`
  if (typeof manifest.exports === 'string') return subpath === '' ? manifest.exports : undefined
  return conditionalExport(manifest.exports?.[key]) ?? (subpath === '' ? manifest.main : undefined)
}

async function scanSourceWorkspace(): Promise<Map<string, { root: string; manifest: WorkspaceManifest }>> {
  const sourceRoot = resolve(import.meta.dirname, '../../..')
  const packages = new Map<string, { root: string; manifest: WorkspaceManifest }>()
  for (const path of globSync([
    'apps/*/package.json',
    'packages/*/*/package.json',
    'vendor/*/package.json',
  ], { cwd: sourceRoot })) {
    const manifest = JSON.parse(await readFile(resolve(sourceRoot, path), 'utf8')) as WorkspaceManifest
    if (manifest.name !== undefined) packages.set(manifest.name, { root: dirname(resolve(sourceRoot, path)), manifest })
  }
  return packages
}

/** Resolve source-workspace plugins when `pnpm desktop` runs directly under Bun. */
async function importSourcePlugin(specifier: string): Promise<unknown> {
  sourceWorkspacePackages ??= scanSourceWorkspace()
  const packageName = specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0] ?? specifier
  const subpath = specifier.slice(packageName.length).replace(/^\//, '')
  const pkg = (await sourceWorkspacePackages).get(packageName)
  if (pkg === undefined) return import(specifier)
  const target = packageEntry(pkg.manifest, subpath)
  if (target === undefined) throw new Error(`dsh-desktop: source plugin ${specifier} has no package export`)
  const sourcePath = target.replace(/^\.\/lib\//, 'src/').replace(/\.js$/, '.ts')
  const candidates = [
    resolve(pkg.root, 'src', subpath === '' ? 'index.ts' : `${subpath}.ts`),
    resolve(pkg.root, sourcePath),
    resolve(pkg.root, sourcePath.replace(/\.ts$/, '/index.ts')),
    resolve(pkg.root, target),
  ]
  const entry = candidates.find(existsSync)
  if (entry === undefined) throw new Error(`dsh-desktop: source plugin ${specifier} has no loadable entry`)
  return import(pathToFileURL(entry).href)
}

export async function startDshWeb(options: { cwd: string; port: number }): Promise<DshWebSession> {
  process.chdir(resolve(options.cwd))
  const runtime = resolveRuntime()
  const importer = compiledPluginImporter ?? importSourcePlugin
  const { ctx, shutdown } = await runProfile({
    environment: loadLayeredEnv('dsh'),
    profile: 'web',
    patchFiles: [],
    args: ['--port', String(options.port), '--no-open'],
    installAnchor: runtime.installAnchor,
    shippedPresetRoot: runtime.shippedPresetRoot,
    bareModuleImporter: importer,
    ...(runtime.runtimePaths === undefined ? {} : { runtimePaths: runtime.runtimePaths }),
    watchPatches: false,
    manageProcessSignals: false,
  })
  const webServer = ctx.get('webServer') as { port: number } | undefined
  if (webServer === undefined) {
    await ctx.fiber.dispose()
    throw new Error('dsh web started without a webServer service')
  }
  const connection = ctx.get('connection') as { authenticatedUrl(url: string): string } | undefined
  if (connection === undefined) {
    await ctx.fiber.dispose()
    throw new Error('dsh web started without a connection service')
  }
  const webUrl = new URL(connection.authenticatedUrl(`http://127.0.0.1:${String(webServer.port)}`))
  if (embeddedNativeRuntimeWasMaterialized()) {
    await ctx.fiber.dispose()
    await disposeEmbeddedNativeRuntime()
    throw new Error('dsh-desktop: startup materialized a native runtime asset')
  }

  let exitCode: number | null = null
  let resolveExited!: (code: number) => void
  const exited = new Promise<number>((resolveExit) => {
    resolveExited = resolveExit
  })
  ctx.effect(() => () => {
    exitCode = 0
    resolveExited(0)
  }, 'dsh-desktop: observe in-process web shutdown')

  let stopPromise: Promise<number> | undefined
  return {
    url: webUrl,
    exited,
    get exitCode() {
      return exitCode
    },
    async verifyRuntime() {
      const codeRuntime = ctx.get('codeRuntime') as {
        run(request: { program: string; bindings: unknown[] }): Promise<{ value?: unknown; error?: { message: string } }>
      } | undefined
      if (codeRuntime === undefined) throw new Error('desktop smoke: codeRuntime service is unavailable')
      const codeResult = await codeRuntime.run({
        program: 'const answer: number = 6 * 7; return answer',
        bindings: [],
      })
      if (codeResult.error !== undefined || codeResult.value !== 42) {
        throw new Error(`desktop smoke: code worker failed (${codeResult.error?.message ?? String(codeResult.value)})`)
      }

      await verifyWorkflowWorkerEntry()
      const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==', 'base64'))
      let image: Awaited<ReturnType<typeof detectImage>>
      try {
        image = await detectImage(png)
      } catch (error) {
        const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : ''
        throw new Error(`desktop smoke: embedded sharp runtime failed${cause}`, { cause: error })
      }
      if (image.mediaType !== 'image/png' || image.width !== 1 || image.height !== 1) {
        throw new Error('desktop smoke: embedded sharp runtime returned unexpected image metadata')
      }
      await access(await resolveRgPath(), constants.X_OK)
      const subprocess = ctx.get('subprocess') as {
        spawnTerminal(spec: {
          argv: string[]
          cwd: string
          rows: number
          cols: number
          graceMs: number
        }): Promise<{
          output: NodeJS.ReadableStream
          done: Promise<{ exitCode: number | null }>
          terminate(): Promise<void>
        }>
      } | undefined
      if (subprocess === undefined) throw new Error('desktop smoke: subprocess service is unavailable')
      const argv = process.platform === 'win32'
        ? [process.env.COMSPEC ?? 'cmd.exe', '/d', '/s', '/c', 'echo DSH_BUN_TERMINAL_OK']
        : ['/bin/sh', '-c', 'printf DSH_BUN_TERMINAL_OK']
      const terminal = await subprocess.spawnTerminal({ argv, cwd: options.cwd, rows: 24, cols: 80, graceMs: 1_000 })
      let terminalOutput = ''
      terminal.output.on('data', (chunk) => { terminalOutput += String(chunk) })
      try {
        const outcome = await terminal.done
        if (outcome.exitCode !== 0 || !terminalOutput.includes('DSH_BUN_TERMINAL_OK')) {
          throw new Error(`desktop smoke: Bun terminal failed (exit=${String(outcome.exitCode)}, output=${JSON.stringify(terminalOutput)})`)
        }
      } finally {
        await terminal.terminate()
      }
    },
    stop() {
      stopPromise ??= shutdown.shutdown(0).then(async () => {
        const code = await exited
        await disposeEmbeddedNativeRuntime()
        return code
      })
      return stopPromise
    },
  }
}
