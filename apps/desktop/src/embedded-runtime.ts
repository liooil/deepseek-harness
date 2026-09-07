/** Read-only Bun executable assets with on-demand native-file materialization. */

import { constants } from 'node:fs'
import { access, chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, normalize } from 'node:path'

/** DSH data mounted inside the standalone executable. */
export interface EmbeddedDshRuntime {
  /** Root of the embedded `dsh` asset tree. */
  readonly root: string
  /** Repository version compiled into the executable. */
  readonly version: string
}

let nativeRootPromise: Promise<string> | undefined

/**
 * Return whether a native asset has been copied out of Bun's read-only filesystem.
 * @returns whether this process has requested its native temporary directory.
 */
export function embeddedNativeRuntimeWasMaterialized(): boolean {
  return nativeRootPromise !== undefined
}

/**
 * Return a native runtime asset as an operating-system path.
 *
 * Ordinary files stay inside Bun's virtual filesystem. Native dynamic loaders
 * and process creation require a real path, so their target-specific files are
 * copied into one process-owned temporary directory only on first use.
 *
 * @param runtime - embedded desktop asset root.
 * @param relativePath - slash-independent path below the runtime root.
 * @param executable - whether the copied leaf must be executable.
 * @returns the source path outside standalone mode, or the temporary native path.
 */
export async function materializeEmbeddedNativePath(
  runtime: EmbeddedDshRuntime,
  relativePath: string,
  executable = false,
): Promise<string> {
  const source = runtimePath(runtime, relativePath)
  if (!isBunVirtualPath(source)) return source
  const nativeRoot = await resolveNativeRoot()
  const destination = join(nativeRoot, relativePath)
  await copyRuntimeEntry(source, destination, executable)
  return destination
}

/** Remove native files materialized by this process, when their OS handles permit it. */
export async function disposeEmbeddedNativeRuntime(): Promise<void> {
  const pending = nativeRootPromise
  nativeRootPromise = undefined
  if (pending === undefined) return
  const root = await pending
  try {
    await rm(root, { recursive: true, force: true, maxRetries: 3 })
  } catch (error) {
    // Windows keeps loaded DLLs locked until process teardown; only that host
    // lock can survive cleanup of this process-owned temporary directory.
    const code = (error as NodeJS.ErrnoException).code
    if (process.platform === 'win32' && (code === 'EPERM' || code === 'EBUSY')) return
    throw error
  }
}

function runtimePath(runtime: EmbeddedDshRuntime, relativePath: string): string {
  const normalized = normalize(relativePath)
  const parentPrefix = `..${process.platform === 'win32' ? '\\' : '/'}`
  if (relativePath === '' || isAbsolute(relativePath) || normalized === '..' || normalized.startsWith(parentPrefix)) {
    throw new Error(`dsh-desktop: embedded runtime path is unsafe: ${JSON.stringify(relativePath)}`)
  }
  return join(runtime.root, normalized)
}

function isBunVirtualPath(path: string): boolean {
  return path.startsWith('/$bunfs/') || path.includes(':\\~BUN\\') || path.includes(':/~BUN/')
}

function resolveNativeRoot(): Promise<string> {
  nativeRootPromise ??= mkdtemp(join(tmpdir(), `dsh-desktop-native-${process.pid}-`))
  return nativeRootPromise
}

async function copyRuntimeEntry(source: string, destination: string, executable: boolean): Promise<void> {
  const sourceStat = await lstat(source)
  if (sourceStat.isSymbolicLink()) throw new Error(`dsh-desktop: embedded native asset is a symbolic link: ${source}`)
  if (sourceStat.isDirectory()) {
    await mkdir(destination, { recursive: true, mode: 0o700 })
    for (const entry of await readdir(source, { withFileTypes: true })) {
      await copyRuntimeEntry(join(source, entry.name), join(destination, entry.name), false)
    }
    return
  }
  if (!sourceStat.isFile()) throw new Error(`dsh-desktop: embedded native asset is not a regular file: ${source}`)
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
  try {
    await access(destination, constants.F_OK)
  } catch {
    await writeFile(destination, await readFile(source), { mode: executable ? 0o700 : 0o600 })
  }
  if (executable && process.platform !== 'win32') await chmod(destination, 0o700)
}
