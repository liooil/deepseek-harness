import * as bundesk from 'bundesk'
import { join } from 'node:path'
import codeWorkerEntry from '../generated/code-worker.js' with { type: 'file' }
import workflowWorkerEntry from '../generated/workflow-worker.js' with { type: 'file' }
import { importDesktopPlugin } from '../generated/plugin-registry.ts'
import { configureSharpLoader } from '@deepseek-ai/dsh-attachment-local/src/image.ts'
import { configureCodeWorkerEntry } from '@deepseek-ai/dsh-code-runtime-worker-thread'
import { configureWorkflowWorkerEntry } from '@deepseek-ai/dsh-workflow-worker-thread'
import { runDesktop } from './bin.ts'
import { configureEmbeddedDshRuntime, prepareEmbeddedSharpRuntime } from './dsh-web.ts'
import { configureBundeskRuntime } from './window.ts'

declare const DSH_DESKTOP_VERSION: string

configureBundeskRuntime(bundesk)
configureSharpLoader(async () => {
  await prepareEmbeddedSharpRuntime()
  return (await import('../generated/sharp-runtime.ts')).default
})
configureCodeWorkerEntry(String(codeWorkerEntry))
configureWorkflowWorkerEntry(String(workflowWorkerEntry))
configureEmbeddedDshRuntime({
  root: join(import.meta.dir, 'dsh'),
  version: DSH_DESKTOP_VERSION,
}, importDesktopPlugin)

try {
  await runDesktop(Bun.argv.slice(2))
} catch (error) {
  console.error(`dsh-desktop: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
