import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js'
import { afterEach, describe, expect, it } from 'vitest'
import { materializeDshRuntime } from '../src/runtime-cache.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('embedded desktop runtime cache', () => {
  it('extracts once into a content-addressed owner-only directory', async () => {
    const fixture = await createFixtureArchive([
      { name: process.platform === 'win32' ? 'node/node.exe' : 'node/node', body: 'node', executable: true },
      { name: 'dsh/node_modules/@deepseek-ai/dsh/lib/bin.js', body: 'entry', executable: false },
    ])
    const cache = await createTemporaryDirectory()
    const runtime = { archivePath: fixture.path, sha256: fixture.sha256, version: '1.2.3' }

    const first = await materializeDshRuntime(runtime, cache)
    expect(first.extracted).toBe(true)
    expect(await readFile(first.node, 'utf8')).toBe('node')
    expect(await readFile(first.dshBin, 'utf8')).toBe('entry')
    if (process.platform !== 'win32') {
      expect((await stat(first.node)).mode & 0o777).toBe(0o700)
      expect((await stat(first.dshBin)).mode & 0o777).toBe(0o600)
    }

    const second = await materializeDshRuntime(runtime, cache)
    expect(second).toEqual({ ...first, extracted: false })
  })

  it('rejects a payload whose embedded checksum does not match', async () => {
    const fixture = await createFixtureArchive([
      { name: process.platform === 'win32' ? 'node/node.exe' : 'node/node', body: 'node', executable: true },
      { name: 'dsh/node_modules/@deepseek-ai/dsh/lib/bin.js', body: 'entry', executable: false },
    ])
    const cache = await createTemporaryDirectory()

    await expect(materializeDshRuntime({
      archivePath: fixture.path,
      sha256: '0'.repeat(64),
      version: '1.2.3',
    }, cache)).rejects.toThrow('embedded runtime checksum mismatch')
  })

  it('rejects archive paths that escape the cache directory', async () => {
    const fixture = await createFixtureArchive([
      { name: '../outside', body: 'bad', executable: false },
    ])
    const cache = await createTemporaryDirectory()

    await expect(materializeDshRuntime({
      archivePath: fixture.path,
      sha256: fixture.sha256,
      version: '1.2.3',
    }, cache)).rejects.toThrow('embedded runtime contains unsafe path')
  })
})

async function createFixtureArchive(entries: Array<{ name: string; body: string; executable: boolean }>) {
  const directory = await createTemporaryDirectory()
  const path = join(directory, 'runtime.zip')
  const blobWriter = new BlobWriter('application/zip')
  const writer = new ZipWriter(blobWriter)
  for (const entry of entries) {
    await writer.add(entry.name, new TextReader(entry.body), { executable: entry.executable })
  }
  const blob = await writer.close()
  const bytes = new Uint8Array(await blob.arrayBuffer())
  await writeFile(path, bytes)
  return { path, sha256: createHash('sha256').update(bytes).digest('hex') }
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-desktop-runtime-'))
  temporaryDirectories.push(directory)
  return directory
}
