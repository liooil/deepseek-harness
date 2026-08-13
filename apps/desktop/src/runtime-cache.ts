import { createHash, randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, posix } from 'node:path'
import { BlobReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js'

const COMPLETE_MARKER = '.complete'

export interface EmbeddedDshRuntime {
  readonly archivePath: string
  readonly sha256: string
  readonly version: string
}

export interface MaterializedDshRuntime {
  readonly root: string
  readonly node: string
  readonly dshBin: string
  readonly extracted: boolean
}

/**
 * Materialize the embedded Node/DSH payload into an owner-only,
 * content-addressed cache directory.
 */
export async function materializeDshRuntime(
  runtime: EmbeddedDshRuntime,
  cacheBase = defaultRuntimeCacheBase(),
): Promise<MaterializedDshRuntime> {
  if (!/^[a-f\d]{64}$/.test(runtime.sha256)) throw new Error('embedded runtime SHA-256 is invalid')
  if (!/^[\w.+-]+$/.test(runtime.version)) throw new Error('embedded runtime version is invalid')

  const runtimeRoot = join(cacheBase, `${runtime.version}-${runtime.sha256.slice(0, 16)}`)
  const cached = await inspectRuntime(runtimeRoot, runtime.sha256)
  if (cached) return { ...cached, extracted: false }

  await mkdir(cacheBase, { recursive: true, mode: 0o700 })
  const archive = await readFile(runtime.archivePath)
  const actualHash = createHash('sha256').update(archive).digest('hex')
  if (actualHash !== runtime.sha256) {
    throw new Error(`embedded runtime checksum mismatch (expected ${runtime.sha256}, received ${actualHash})`)
  }

  const temporaryRoot = join(cacheBase, `.extract-${process.pid}-${randomUUID()}`)
  await mkdir(temporaryRoot, { mode: 0o700 })
  try {
    await extractArchive(archive, temporaryRoot)
    await writeFile(join(temporaryRoot, COMPLETE_MARKER), `${runtime.sha256}\n`, { mode: 0o600 })
    await promoteRuntime(temporaryRoot, runtimeRoot, runtime.sha256)
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true })
    throw error
  }

  const materialized = await inspectRuntime(runtimeRoot, runtime.sha256)
  if (!materialized) throw new Error(`embedded runtime extraction did not create a complete payload at ${runtimeRoot}`)
  return { ...materialized, extracted: true }
}

async function extractArchive(archive: Buffer, destination: string): Promise<void> {
  const reader = new ZipReader(new BlobReader(new Blob([Uint8Array.from(archive)])))
  const seen = new Set<string>()
  try {
    for (const entry of await reader.getEntries()) {
      const relative = normalizeArchivePath(entry.filename)
      if (seen.has(relative)) throw new Error(`embedded runtime contains duplicate entry ${JSON.stringify(relative)}`)
      seen.add(relative)
      const path = join(destination, ...relative.split('/'))
      if (entry.directory) {
        await mkdir(path, { recursive: true, mode: 0o700 })
        continue
      }
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      const bytes = await entry.getData(new Uint8ArrayWriter())
      await writeFile(path, bytes, { mode: entry.executable ? 0o700 : 0o600 })
      if (process.platform !== 'win32') await chmod(path, entry.executable ? 0o700 : 0o600)
    }
  } finally {
    await reader.close()
  }
}

function normalizeArchivePath(filename: string): string {
  const normalized = posix.normalize(filename)
  if (filename === '' || filename.includes('\\') || filename.startsWith('/') || normalized !== filename) {
    throw new Error(`embedded runtime contains unsafe path ${JSON.stringify(filename)}`)
  }
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`embedded runtime contains unsafe path ${JSON.stringify(filename)}`)
  }
  return normalized.replace(/\/$/, '')
}

async function promoteRuntime(
  temporaryRoot: string,
  runtimeRoot: string,
  sha256: string,
): Promise<void> {
  try {
    await rename(temporaryRoot, runtimeRoot)
    return
  } catch (error) {
    if (await inspectRuntime(runtimeRoot, sha256)) return
    if (!await pathExists(runtimeRoot)) throw error
  }

  const quarantined = `${runtimeRoot}.invalid-${randomUUID()}`
  await rename(runtimeRoot, quarantined)
  console.warn(`dsh-desktop: moved an incomplete runtime cache to ${quarantined}`)
  await rename(temporaryRoot, runtimeRoot)
}

async function inspectRuntime(
  root: string,
  sha256: string,
): Promise<Omit<MaterializedDshRuntime, 'extracted'> | undefined> {
  const node = join(root, 'node', process.platform === 'win32' ? 'node.exe' : 'node')
  const dshBin = join(root, 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  try {
    const [rootStat, nodeStat, binStat, marker] = await Promise.all([
      lstat(root),
      lstat(node),
      lstat(dshBin),
      readFile(join(root, COMPLETE_MARKER), 'utf8'),
    ])
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return undefined
    if (!nodeStat.isFile() || nodeStat.isSymbolicLink()) return undefined
    if (!binStat.isFile() || binStat.isSymbolicLink()) return undefined
    if (marker.trim() !== sha256) return undefined
    return { root, node, dshBin }
  } catch {
    return undefined
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch {
    return false
  }
}

function defaultRuntimeCacheBase(): string {
  if (process.platform === 'win32') {
    return join(
      process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'),
      'DeepSeek Harness',
      'DesktopRuntime',
    )
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Caches', 'ai.deepseek.harness.desktop', 'runtime')
  }
  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'dsh-desktop', 'runtime')
}
