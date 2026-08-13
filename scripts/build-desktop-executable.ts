/** Build one native, single-file DeepSeek Harness desktop executable. */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, globSync, statSync } from 'node:fs'
import { chmod, copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { BlobReader, BlobWriter, ZipWriter } from '@zip.js/zip.js'
import { deployRuntimeClosure } from './runtime-deploy.ts'

const root = resolve(import.meta.dirname, '..')
const OUT_DIR = resolve(root, 'dist-desktop')
const GENERATED_DIR = resolve(root, 'apps/desktop/generated')
const GENERATED_ARCHIVE = join(GENERATED_DIR, 'runtime.zip')
const DEPLOY_MANIFEST_DIR = resolve(root, 'apps/desktop-runtime-build')
const CLI_PACKAGE = '@deepseek-ai/dsh'
const DEPLOY_PACKAGE = 'dsh-desktop-runtime-build'
const ROOT_DOCS = ['README.md', 'README.zh.md', 'README.i18n.yaml']

const TARGET_NAMES = [
  'linux-x64',
  'linux-arm64',
  'windows-x64',
  'windows-arm64',
  'macos-x64',
  'macos-arm64',
] as const
type TargetName = (typeof TARGET_NAMES)[number]
type DesktopPlatform = 'linux' | 'windows' | 'macos'
type DesktopArch = 'x64' | 'arm64'
type BunCompileTarget =
  | 'bun-linux-x64-baseline'
  | 'bun-linux-arm64'
  | 'bun-windows-x64-baseline'
  | 'bun-windows-arm64'
  | 'bun-darwin-x64'
  | 'bun-darwin-arm64'

interface BunDeskBuildRuntime {
  buildDesktopApp(config: Record<string, unknown>): Promise<{ outfile: string; size: number; sha256: string }>
}

class DesktopTarget {
  private constructor(
    readonly name: TargetName,
    readonly platform: DesktopPlatform,
    readonly arch: DesktopArch,
  ) {}

  get bunTarget(): BunCompileTarget {
    if (this.platform === 'linux') return this.arch === 'x64' ? 'bun-linux-x64-baseline' : 'bun-linux-arm64'
    if (this.platform === 'windows') return this.arch === 'x64' ? 'bun-windows-x64-baseline' : 'bun-windows-arm64'
    return this.arch === 'x64' ? 'bun-darwin-x64' : 'bun-darwin-arm64'
  }

  get output(): string {
    return join(OUT_DIR, `dsh-desktop-${this.name}${this.platform === 'windows' ? '.exe' : ''}`)
  }

  static parse(value: string): DesktopTarget {
    if (!(TARGET_NAMES as readonly string[]).includes(value)) {
      throw new Error(`target must be one of ${TARGET_NAMES.join(', ')}, received ${JSON.stringify(value)}`)
    }
    const name = value as TargetName
    const [platform, arch] = name.split('-') as [DesktopPlatform, DesktopArch]
    return new DesktopTarget(name, platform, arch)
  }

  assertNativeHost(): void {
    const hostPlatform = process.platform === 'darwin'
      ? 'macos'
      : process.platform === 'win32'
        ? 'windows'
        : process.platform === 'linux'
          ? 'linux'
          : process.platform
    if (hostPlatform !== this.platform || process.arch !== this.arch) {
      throw new Error(
        `target ${this.name} requires a native ${this.platform}-${this.arch} host; current host is ${hostPlatform}-${process.arch}`,
      )
    }
  }
}

interface BuildCli {
  readonly target: DesktopTarget
  readonly skipBuild: boolean
}

function parseCli(argv: string[]): BuildCli {
  const { values } = parseArgs({
    args: argv,
    options: {
      target: { type: 'string' },
      'skip-build': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  })
  if (values.help) {
    console.log([
      'Usage: bun scripts/build-desktop-executable.ts --target <target> [--skip-build]',
      '',
      `Targets: ${TARGET_NAMES.join(', ')}`,
      'The target must match the native host so Node and native packages match the release executable.',
    ].join('\n'))
    process.exit(0)
  }
  if (!values.target) throw new Error('--target is required')
  return { target: DesktopTarget.parse(values.target), skipBuild: values['skip-build'] }
}

class DesktopExecutableBuild {
  private readonly stagingRoot: string
  private readonly dshRoot: string

  constructor(private readonly cli: BuildCli) {
    this.stagingRoot = join(OUT_DIR, '.staging', cli.target.name)
    this.dshRoot = join(this.stagingRoot, 'dsh')
  }

  async run(): Promise<void> {
    this.cli.target.assertNativeHost()
    if (!this.cli.skipBuild) await this.runCommand('build', pnpmBin(), ['run', 'build'])
    else console.log('build-desktop-executable: skipping pnpm run build (--skip-build)')

    await this.createDeployManifest()
    try {
      await deployRuntimeClosure({
        root,
        staging: this.dshRoot,
        packageFilter: DEPLOY_PACKAGE,
        sourceNodeModules: join(DEPLOY_MANIFEST_DIR, 'node_modules'),
        removeRootFiles: ROOT_DOCS,
        dryRun: false,
        logPrefix: 'build-desktop-executable',
        run: (label, command, args) => this.runCommand(label, command, args),
      })
      await this.stageNodeRuntime()
      await this.restoreLinuxPtyAddon()
      const runtimeSha256 = await this.createRuntimeArchive()
      await this.compile(runtimeSha256)
    } finally {
      await rm(DEPLOY_MANIFEST_DIR, { recursive: true, force: true })
    }
  }

  private async createDeployManifest(): Promise<void> {
    const manifests = new Map<string, WorkspaceManifest>()
    const patterns = [
      'apps/*/package.json',
      'packages/*/*/package.json',
      'vendor/*/package.json',
      'native/landlock-run/packages/*/package.json',
    ]
    for (const path of globSync(patterns, { cwd: root }).sort()) {
      if (path.startsWith('apps/desktop-runtime-build/')) continue
      const manifest = JSON.parse(await readFile(resolve(root, path), 'utf8')) as WorkspaceManifest
      if (manifest.name) manifests.set(manifest.name, manifest)
    }

    const closure = new Set<string>()
    const queue = [CLI_PACKAGE]
    while (queue.length > 0) {
      const packageName = queue.shift()
      if (!packageName || closure.has(packageName)) continue
      const manifest = manifests.get(packageName)
      if (!manifest) continue
      closure.add(packageName)
      const dependencies = {
        ...manifest.dependencies,
        ...manifest.peerDependencies,
      }
      for (const dependency of Object.keys(dependencies).sort()) {
        if (manifests.has(dependency) && !closure.has(dependency)) queue.push(dependency)
      }
      for (const dependency of Object.keys(manifest.optionalDependencies ?? {}).sort()) {
        const optional = manifests.get(dependency)
        if (optional && supportsTarget(optional, this.cli.target) && !closure.has(dependency)) {
          queue.push(dependency)
        }
      }
    }

    await rm(DEPLOY_MANIFEST_DIR, { recursive: true, force: true })
    await mkdir(DEPLOY_MANIFEST_DIR, { recursive: true })
    const dependencies = Object.fromEntries([...closure].sort().map(name => [name, 'workspace:^']))
    await writeFile(join(DEPLOY_MANIFEST_DIR, 'package.json'), `${JSON.stringify({
      name: DEPLOY_PACKAGE,
      version: '0.0.0',
      private: true,
      type: 'module',
      dependencies,
    }, null, 2)}\n`)
    console.log(`build-desktop-executable: generated ${closure.size}-package workspace runtime closure`)
  }

  private async stageNodeRuntime(): Promise<void> {
    const node = (await capture('node', ['-p', 'process.execPath'])).trim()
    const version = await capture(node, ['--version'])
    if (!/^v24\./.test(version.trim())) {
      throw new Error(`build-desktop-executable: Node.js 24 is required, received ${JSON.stringify(version.trim())}`)
    }
    const destination = join(this.stagingRoot, 'node', process.platform === 'win32' ? 'node.exe' : 'node')
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(node, destination)
    if (process.platform !== 'win32') await chmod(destination, 0o755)
  }

  private async restoreLinuxPtyAddon(): Promise<void> {
    if (this.cli.target.platform !== 'linux') return
    const source = resolve(
      root,
      'packages/subprocess/subprocess-local/node_modules/node-pty/build/Release/pty.node',
    )
    const destination = join(this.dshRoot, 'node_modules/node-pty/build/Release/pty.node')
    if (!existsSync(source)) {
      throw new Error(`build-desktop-executable: Linux node-pty addon is missing at ${source}`)
    }
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(source, destination)
  }

  private async createRuntimeArchive(): Promise<string> {
    await mkdir(GENERATED_DIR, { recursive: true })
    const blobWriter = new BlobWriter('application/zip')
    const writer = new ZipWriter(blobWriter, { level: 6 })
    for (const path of await listFiles(this.stagingRoot)) {
      const name = relative(this.stagingRoot, path).split(sep).join('/')
      const mode = statSync(path).mode
      const bytes = Uint8Array.from(await readFile(path))
      await writer.add(name, new BlobReader(new Blob([bytes])), {
        executable: (mode & 0o111) !== 0,
        lastModDate: new Date('1980-01-01T00:00:00.000Z'),
      })
    }
    const archive = await writer.close()
    const archiveBytes = new Uint8Array(await archive.arrayBuffer())
    await writeFile(GENERATED_ARCHIVE, archiveBytes)
    const sha256 = createHash('sha256').update(archiveBytes).digest('hex')
    console.log(`build-desktop-executable: runtime archive ${formatSize(archive.size)} sha256=${sha256}`)
    return sha256
  }

  private async compile(runtimeSha256: string): Promise<void> {
    const version = (JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as { version: string }).version
    const require = createRequire(resolve(root, 'apps/desktop/package.json'))
    const bundeskEntry = require.resolve('bundesk')
    const bundesk = await import(pathToFileURL(bundeskEntry).href) as BunDeskBuildRuntime
    await mkdir(OUT_DIR, { recursive: true })
    await rm(this.cli.target.output, { force: true })
    const result = await bundesk.buildDesktopApp({
      root,
      entrypoint: 'apps/desktop/src/standalone.ts',
      outfile: this.cli.target.output,
      target: this.cli.target.bunTarget,
      minify: true,
      define: {
        DSH_DESKTOP_RUNTIME_SHA256: JSON.stringify(runtimeSha256),
        DSH_DESKTOP_VERSION: JSON.stringify(version),
      },
      compile: { autoloadDotenv: false, autoloadBunfig: false },
      ...(this.cli.target.platform === 'windows'
        ? {
          windows: {
            console: 'detached',
            title: 'DeepSeek Harness',
            description: 'DeepSeek Harness desktop application',
            publisher: 'DeepSeek',
            version,
          },
        }
        : {}),
    })
    if (!existsSync(result.outfile)) throw new Error(`build-desktop-executable: missing output ${result.outfile}`)
    if (this.cli.target.platform !== 'windows') await chmod(result.outfile, 0o755)
    console.log(
      `build-desktop-executable: product ${result.outfile} (${formatSize(result.size)}, sha256=${result.sha256})`,
    )
  }

  private async runCommand(label: string, command: string, args: string[]): Promise<void> {
    console.log(`build-desktop-executable: ${label}: ${formatCommand(command, args)}`)
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(command, args, {
        cwd: root,
        stdio: 'inherit',
        env: { ...process.env, CI: 'true' },
      })
      child.once('error', (error) => {
        reject(new Error(`build-desktop-executable: ${label}: ${error.message}`))
      })
      child.once('exit', (code, signal) => {
        if (code === 0) resolvePromise()
        else reject(new Error(`build-desktop-executable: ${label} failed (${code ?? signal ?? 'unknown'})`))
      })
    })
  }
}

async function listFiles(directory: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`build-desktop-executable: runtime archive contains link ${path}`)
    if (entry.isDirectory()) files.push(...await listFiles(path))
    else if (entry.isFile()) files.push(path)
    else throw new Error(`build-desktop-executable: unsupported runtime entry ${path}`)
  }
  return files.sort()
}

async function capture(command: string, args: string[]): Promise<string> {
  return await new Promise<string>((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise(stdout)
      else reject(new Error(`${basename(command)} failed (${code ?? signal ?? 'unknown'}): ${stderr.trim()}`))
    })
  })
}

function pnpmBin(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map(part => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ')
}

function formatSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface WorkspaceManifest {
  readonly name?: string
  readonly cpu?: string[]
  readonly os?: string[]
  readonly dependencies?: Record<string, string>
  readonly optionalDependencies?: Record<string, string>
  readonly peerDependencies?: Record<string, string>
}

function supportsTarget(manifest: WorkspaceManifest, target: DesktopTarget): boolean {
  const platform = target.platform === 'windows' ? 'win32' : target.platform === 'macos' ? 'darwin' : 'linux'
  if (manifest.os && !manifest.os.includes(platform)) return false
  if (manifest.cpu && !manifest.cpu.includes(target.arch)) return false
  return true
}

if (import.meta.main) {
  await new DesktopExecutableBuild(parseCli(process.argv.slice(2))).run()
}
