import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  embeddedNativeRuntimeWasMaterialized,
  materializeEmbeddedNativePath,
} from '../src/embedded-runtime.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('embedded desktop runtime', () => {
  it('leaves ordinary filesystem assets at their original path', async () => {
    const root = await createTemporaryDirectory()
    const nativeDirectory = join(root, 'native')
    const rgPath = join(nativeDirectory, 'rg')
    await mkdir(nativeDirectory)
    await writeFile(rgPath, 'fixture')

    await expect(materializeEmbeddedNativePath({ root, version: '1.2.3' }, join('native', 'rg'), true))
      .resolves.toBe(rgPath)
    expect(embeddedNativeRuntimeWasMaterialized()).toBe(false)
  })

  it('rejects a path outside the runtime root', async () => {
    const root = await createTemporaryDirectory()

    await expect(materializeEmbeddedNativePath({ root, version: '1.2.3' }, join('..', 'outside')))
      .rejects.toThrow('embedded runtime path is unsafe')
  })
})

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-desktop-runtime-test-'))
  temporaryDirectories.push(directory)
  return directory
}
