/** Build one native, single-file DeepSeek Harness desktop executable. */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, globSync, statSync } from 'node:fs'
import { chmod, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { BlobReader, BlobWriter, ZipWriter } from '@zip.js/zip.js'

const root = resolve(import.meta.dirname, '..')
const OUT_DIR = resolve(root, 'dist-desktop')
const GENERATED_DIR = resolve(root, 'apps/desktop/generated')
const GENERATED_ARCHIVE = join(GENERATED_DIR, 'runtime.zip')
const GENERATED_PLUGIN_REGISTRY = join(GENERATED_DIR, 'plugin-registry.ts')
const CLI_PACKAGE = '@deepseek-ai/dsh'

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

interface BunBuildResult {
  readonly success: boolean
  readonly logs: unknown[]
}

interface BunPluginBuilder {
  onLoad(
    options: { filter: RegExp },
    loader: () => { contents: string; loader: 'js' },
  ): void
}

interface BunBuildPlugin {
  readonly name: string
  setup(builder: BunPluginBuilder): void
}

declare const Bun: {
  build(options: Record<string, unknown>): Promise<BunBuildResult>
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
  private workspaceClosure: string[] = []
  private workspaceManifests = new Map<string, WorkspaceManifest>()
  private workspaceDirectories = new Map<string, string>()

  constructor(private readonly cli: BuildCli) {
    this.stagingRoot = join(OUT_DIR, '.staging', cli.target.name)
    this.dshRoot = join(this.stagingRoot, 'dsh')
  }

  async run(): Promise<void> {
    this.cli.target.assertNativeHost()
    if (!this.cli.skipBuild) await this.runCommand('build', pnpmBin(), ['run', 'build'])
    else console.log('build-desktop-executable: skipping pnpm run build (--skip-build)')

    await this.discoverRuntimeClosure()
    await this.generatePluginRegistry()
    await this.generateSharpRuntime()
    await this.generateWorkerBundles()
    await this.stageRuntimeData()
    const runtimeSha256 = await this.createRuntimeArchive()
    await this.compile(runtimeSha256)
  }

  private async generateSharpRuntime(): Promise<void> {
    const platform = this.cli.target.platform === 'windows' ? 'win32' : this.cli.target.platform === 'macos' ? 'darwin' : 'linux'
    await mkdir(GENERATED_DIR, { recursive: true })
    await writeFile(join(GENERATED_DIR, 'sharp-runtime.ts'), [
      "import sharp from 'sharp'",
      'export default sharp',
      '',
    ].join('\n'))
    console.log(`build-desktop-executable: generated native sharp entry for ${platform}-${this.cli.target.arch}`)
  }

  private async generateWorkerBundles(): Promise<void> {
    await mkdir(GENERATED_DIR, { recursive: true })
    for (const [name, entrypoint] of [
      ['code-worker.js', 'packages/code-runtime/code-runtime-worker-thread/src/worker.ts'],
      ['workflow-worker.js', 'packages/workflow/workflow-worker-thread/src/worker.ts'],
    ] as const) {
      const result = await Bun.build({
        entrypoints: [resolve(root, entrypoint)],
        outdir: GENERATED_DIR,
        naming: name,
        target: 'bun',
        format: 'esm',
        minify: true,
      })
      if (!result.success) throw new AggregateError(result.logs, `failed to bundle ${entrypoint}`)
    }
    console.log('build-desktop-executable: generated embedded code and workflow workers')
  }

  /**
   * Keep only files that compiled plugins still consume as data. Server code
   * and ordinary npm dependencies are already in the Bun executable; copying
   * the whole deployed node_modules would duplicate that graph and make first
   * launch expand tens of thousands of files in memory.
   */
  private async stageRuntimeData(): Promise<void> {
    await rm(this.stagingRoot, { recursive: true, force: true })
    const copyFrom = async (source: string, relativePath: string): Promise<void> => {
      if (!existsSync(source)) throw new Error(`build-desktop-executable: missing runtime data ${source}`)
      const destination = join(this.dshRoot, relativePath)
      await mkdir(dirnameOfFs(destination), { recursive: true })
      await cp(source, destination, { recursive: statSync(source).isDirectory(), dereference: true })
    }
    const packageRelative = (name: string): string => join('node_modules', ...name.split('/'))
    const copyPackage = async (name: string): Promise<void> => {
      await copyFrom(resolve(root, 'node_modules/.pnpm/node_modules', ...name.split('/')), packageRelative(name))
    }

    for (const name of this.workspaceClosure) {
      const manifest = this.workspaceManifests.get(name)
      const directory = this.workspaceDirectories.get(name)
      if (manifest === undefined || directory === undefined) continue
      const packageRoot = packageRelative(name)
      const sourcePackageRoot = resolve(root, directory)
      const copyWorkspacePath = async (path: string): Promise<void> => {
        await copyFrom(join(sourcePackageRoot, path), join(packageRoot, path))
      }
      await copyWorkspacePath('package.json')
      const patch = manifest.dsh?.bundle?.patch
      if (patch !== undefined) await copyWorkspacePath(patch)
      if (manifest.dsh?.client !== undefined) {
        const clientEntry = resolvePackageEntry(manifest, 'client')
        if (clientEntry === undefined) throw new Error(`build-desktop-executable: ${name} declares dsh.client without a client export`)
        await copyWorkspacePath(clientEntry)
      }
      if (name === CLI_PACKAGE) await copyWorkspacePath('config')
      if (name === '@deepseek-ai/dsh-web-frontend') await copyWorkspacePath('dist')
      if (name === '@deepseek-ai/dsh-skill-badge') await copyWorkspacePath('assets')
    }

    // Native/runtime-resolved packages cannot live inside Bun's virtual FS.
    for (const name of ['sharp', '@img/colour', 'detect-libc', 'semver', '@vscode/ripgrep']) {
      await copyPackage(name)
    }
    const sharpPlatform = this.cli.target.platform === 'windows' ? 'win32' : this.cli.target.platform === 'macos' ? 'darwin' : 'linux'
    await copyPackage(`@img/sharp-${sharpPlatform}-${this.cli.target.arch}`)
    if (this.cli.target.platform !== 'windows') {
      await copyPackage(`@img/sharp-libvips-${sharpPlatform}-${this.cli.target.arch}`)
    }
    await copyPackage(`@vscode/ripgrep-${sharpPlatform}-${this.cli.target.arch}`)
    if (this.cli.target.platform === 'windows') {
      await copyPackage('koffi')
      await copyPackage(`@koromix/koffi-win32-${this.cli.target.arch}`)
    }

    const files = await listFiles(this.stagingRoot)
    console.log(`build-desktop-executable: staged runtime data in ${files.length} files`)
  }

  private async discoverRuntimeClosure(): Promise<void> {
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
      if (manifest.name) {
        manifests.set(manifest.name, manifest)
        this.workspaceDirectories.set(manifest.name, dirnameOf(path))
      }
    }
    this.workspaceManifests = manifests

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

    this.workspaceClosure = [...closure].sort()
    console.log(`build-desktop-executable: discovered ${closure.size}-package workspace runtime closure`)
  }

  private async generatePluginRegistry(): Promise<void> {
    const closure = new Set(this.workspaceClosure)
    const specifiers = new Set<string>([
      '@deepseek-ai/dsh-host-directory-picker-native',
      '@deepseek-ai/dsh-host-directory-picker-browse',
      '@deepseek-ai/dsh-client-ui-directory-picker-native',
      '@deepseek-ai/dsh-client-ui-directory-picker-browse',
    ])
    for (const name of closure) {
      const manifest = this.workspaceManifests.get(name)
      if (manifest !== undefined && resolvePackageEntry(manifest, 'typert') !== undefined) {
        specifiers.add(`${name}/typert`)
      }
    }
    const configPaths = globSync([
      'apps/cli/config/**/*.{yml,yaml}',
      'packages/*/*/cordis.patch.yml',
    ], { cwd: root }).sort()
    for (const path of configPaths) {
      const source = await readFile(resolve(root, path), 'utf8')
      for (const match of source.matchAll(/^\s*name:\s*['"]?([^'"\s#]+)/gm)) {
        const specifier = match[1]
        if (!specifier?.startsWith('@')) continue
        const packageName = specifier.split('/').slice(0, 2).join('/')
        if (closure.has(packageName)) specifiers.add(specifier)
      }
    }
    const entries = [...specifiers].sort().map((specifier) => {
      const packageName = specifier.split('/').slice(0, 2).join('/')
      const subpath = specifier.slice(packageName.length + 1)
      const manifest = this.workspaceManifests.get(packageName)
      const directory = this.workspaceDirectories.get(packageName)
      const target = manifest === undefined ? undefined : resolvePackageEntry(manifest, subpath)
      if (directory === undefined || target === undefined) {
        throw new Error(`build-desktop-executable: cannot resolve compiled plugin entry ${specifier}`)
      }
      const sourceCandidates = [
        resolve(root, directory, 'src', subpath === '' ? 'index.ts' : `${subpath}.ts`),
        resolve(root, directory, target.replace(/^\.\/lib\//, 'src/').replace(/\.js$/, '.ts')),
      ]
      const absoluteTarget = sourceCandidates.find(existsSync) ?? resolve(root, directory, target)
      let importPath = relative(GENERATED_DIR, absoluteTarget).split(sep).join('/')
      if (!importPath.startsWith('.')) importPath = `./${importPath}`
      return `  ${JSON.stringify(specifier)}: () => import(${JSON.stringify(importPath)}),`
    })
    const source = [
      '/** Generated by scripts/build-desktop-executable.ts; do not edit. */',
      'const modules: Record<string, () => Promise<unknown>> = {',
      ...entries,
      '}',
      '',
      'export function importDesktopPlugin(name: string): Promise<unknown> {',
      '  const load = modules[name]',
      '  if (load === undefined) {',
      '    throw new Error(`dsh-desktop: plugin ${JSON.stringify(name)} is not compiled into this executable`)',
      '  }',
      '  return load()',
      '}',
      '',
    ].join('\n')
    await mkdir(GENERATED_DIR, { recursive: true })
    await writeFile(GENERATED_PLUGIN_REGISTRY, source)
    console.log(`build-desktop-executable: generated ${specifiers.size}-plugin compiled registry`)
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
      plugins: [this.sharpBindingPlugin()],
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

  private sharpBindingPlugin(): BunBuildPlugin {
    const platform = this.cli.target.platform === 'windows' ? 'win32' : this.cli.target.platform === 'macos' ? 'darwin' : 'linux'
    const addonPackage = `@img/sharp-${platform}-${this.cli.target.arch}`
    const addonRoot = resolve(root, 'node_modules/.pnpm/node_modules', ...addonPackage.split('/'))
    const addonFile = globSync('lib/*.node', { cwd: addonRoot })[0]
    if (addonFile === undefined) throw new Error(`build-desktop-executable: no N-API addon found in ${addonRoot}`)
    const addonPath = resolve(addonRoot, addonFile)
    return {
      name: 'dsh-desktop-sharp-binding',
      setup(builder) {
        builder.onLoad({ filter: /[/\\]sharp[/\\]dist[/\\]sharp\.mjs$/ }, () => ({
          contents: `import binding from ${JSON.stringify(addonPath)}; export default binding`,
          loader: 'js',
        }))
      },
    }
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

function pnpmBin(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map(part => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ')
}

function formatSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function dirnameOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '.' : path.slice(0, slash)
}

function conditionalExport(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  return conditionalExport(record.default ?? record.import ?? record.node)
}

function resolvePackageEntry(manifest: WorkspaceManifest, subpath: string): string | undefined {
  const key = subpath === '' ? '.' : `./${subpath}`
  if (typeof manifest.exports === 'string') return subpath === '' ? manifest.exports : undefined
  const exported = manifest.exports?.[key]
  return conditionalExport(exported) ?? (subpath === '' ? manifest.main : undefined)
}

interface WorkspaceManifest {
  readonly name?: string
  readonly main?: string
  readonly exports?: string | Record<string, unknown>
  readonly cpu?: string[]
  readonly os?: string[]
  readonly dependencies?: Record<string, string>
  readonly optionalDependencies?: Record<string, string>
  readonly peerDependencies?: Record<string, string>
  readonly dsh?: {
    readonly bundle?: { readonly patch?: string }
    readonly client?: unknown
  }
}

function dirnameOfFs(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return slash < 0 ? '.' : path.slice(0, slash)
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
