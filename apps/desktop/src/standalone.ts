import * as bundesk from 'bundesk'
import runtimeArchive from '../generated/runtime.zip' with { type: 'file' }
import { runDesktop } from './bin.ts'
import { configureEmbeddedDshRuntime } from './dsh-web.ts'
import { configureBundeskRuntime } from './window.ts'

declare const DSH_DESKTOP_RUNTIME_SHA256: string
declare const DSH_DESKTOP_VERSION: string

configureBundeskRuntime(bundesk)
configureEmbeddedDshRuntime({
  archivePath: String(runtimeArchive),
  sha256: DSH_DESKTOP_RUNTIME_SHA256,
  version: DSH_DESKTOP_VERSION,
})

try {
  await runDesktop(Bun.argv.slice(2))
} catch (error) {
  console.error(`dsh-desktop: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
