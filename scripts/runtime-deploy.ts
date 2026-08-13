import { existsSync } from 'node:fs'
import { cp, lstat, mkdir, readFile, readdir, realpath, rm } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'

export interface RuntimeDeployOptions {
  readonly root: string
  readonly staging: string
  readonly packageFilter: string
  readonly sourceNodeModules: string
  readonly removeRootFiles?: readonly string[]
  readonly dryRun: boolean
  readonly logPrefix: string
  run(label: string, command: string, args: string[]): Promise<void>
}

/**
 * Deploy a production workspace closure and replace every package-manager link
 * with bytes suitable for archives and virtual filesystems.
 */
export async function deployRuntimeClosure(options: RuntimeDeployOptions): Promise<void> {
  const { root, staging } = options
  if (staging === root || root.startsWith(staging + sep)) {
    throw new Error(`${options.logPrefix}: refusing to clear staging dir ${staging}: it contains the repo root.`)
  }
  if (options.dryRun) console.log(`${options.logPrefix}: [dry-run] rm -rf ${staging}`)
  else await rm(staging, { recursive: true, force: true })

  await options.run('deploy', pnpmBin(), [
    '--filter',
    options.packageFilter,
    'deploy',
    '--legacy',
    '--prod',
    '--config.node-linker=hoisted',
    '--config.auto-install-peers=false',
    '--config.link-workspace-packages=true',
    staging,
  ])
  await restoreLegacyHoists(options)
  await materializeStagedLinks(options)

  for (const name of options.removeRootFiles ?? []) {
    const path = join(staging, name)
    if (options.dryRun) console.log(`${options.logPrefix}: [dry-run] rm -f ${path}`)
    else await rm(path, { force: true })
  }
}

/** Restore direct packages that pnpm's legacy deploy hoisted beside the source. */
async function restoreLegacyHoists(options: RuntimeDeployOptions): Promise<void> {
  if (options.dryRun) {
    console.log(`${options.logPrefix}: [dry-run] restore direct dependencies omitted by legacy deploy`)
    return
  }
  const manifestPath = join(options.staging, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    dependencies?: Record<string, string>
  }
  const restored: string[] = []
  for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
    const destination = join(options.staging, 'node_modules', dependency)
    if (existsSync(destination)) continue
    const source = join(options.sourceNodeModules, dependency)
    if (!existsSync(source)) {
      throw new Error(
        `${options.logPrefix}: deployed dependency ${dependency} is absent from both ${destination} and ${source}.`,
      )
    }
    await mkdir(dirname(destination), { recursive: true })
    const nestedNodeModules = join(source, 'node_modules')
    await cp(source, destination, {
      recursive: true,
      dereference: true,
      filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
    })
    restored.push(dependency)
  }
  const stillMissing = Object.keys(manifest.dependencies ?? {})
    .filter(dependency => !existsSync(join(options.staging, 'node_modules', dependency)))
  if (stillMissing.length > 0) {
    throw new Error(`${options.logPrefix}: staged dependencies remain missing: ${stillMissing.join(', ')}.`)
  }
  if (restored.length > 0) {
    console.log(`${options.logPrefix}: restored legacy deploy hoists: ${restored.join(', ')}`)
  }
}

/** Replace deploy-time package links with files and reject any remaining link. */
async function materializeStagedLinks(options: RuntimeDeployOptions): Promise<void> {
  if (options.dryRun) {
    console.log(`${options.logPrefix}: [dry-run] materialize staged package links`)
    return
  }
  const nodeModules = join(options.staging, 'node_modules')
  let remaining = await findSymlink(nodeModules)
  while (remaining !== undefined) {
    const segments = remaining.slice(nodeModules.length + 1).split(sep)
    const binIndex = segments.lastIndexOf('.bin')
    if (binIndex >= 0) {
      await rm(join(nodeModules, ...segments.slice(0, binIndex + 1)), { recursive: true, force: true })
      remaining = await findSymlink(nodeModules)
      continue
    }
    const destination = remaining
    const source = await realpath(destination)
    const nestedNodeModules = join(source, 'node_modules')
    await rm(destination, { recursive: true, force: true })
    await cp(source, destination, {
      recursive: true,
      dereference: true,
      filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
    })
    remaining = await findSymlink(nodeModules)
  }
}

/** Return the first symbolic link below a directory, if one exists. */
async function findSymlink(directory: string): Promise<string | undefined> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink()) return path
    if (metadata.isDirectory()) {
      const nested = await findSymlink(path)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

function pnpmBin(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}
