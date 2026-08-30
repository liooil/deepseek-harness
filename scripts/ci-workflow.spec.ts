import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'
import { isPlainObject } from '@deepseek-ai/cosmokit'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

const ACTIVE_WORKFLOWS = [
  'build-exe-for-python-sdk.yml',
  'desktop-ci.yml',
  'desktop-release.yml',
  'docs-pages.yml',
  'e2e.yml',
  'sandbox.yml',
  'upstream-sync.yml',
] as const

describe('desktop repository workflows', () => {
  it('keeps automatic CI limited to desktop validation and sandbox portability', () => {
    const workflowDir = resolve(root, '.github/workflows')
    const files = readdirSync(workflowDir)
      .filter(file => file.endsWith('.yml') || file.endsWith('.yaml'))
      .sort()

    expect(files).toEqual([...ACTIVE_WORKFLOWS].sort())

    const automatic = files.filter((file) => {
      const workflow = loadWorkflow(`.github/workflows/${file}`)
      const events = workflowEvents(workflow)
      return events.includes('push') || events.includes('pull_request') || events.includes('schedule')
    })
    expect(automatic).toEqual(['desktop-ci.yml', 'sandbox.yml'])
  })

  it('runs static gates and representative native desktop smokes', () => {
    const workflow = loadWorkflow('.github/workflows/desktop-ci.yml')
    expect(workflowEvents(workflow).sort()).toEqual(['pull_request', 'push', 'workflow_dispatch'])
    const push = workflowEvent(workflow, 'push')
    expect(push.branches).toEqual(['master', 'sync/upstream-**'])
    expect(workflow.concurrency).toMatchObject({ 'cancel-in-progress': true })
    expect(workflow.env).toMatchObject({ BUN_VERSION: '1.4.0' })

    const staticJob = workflowJob(workflow, 'static')
    const staticCommands = commands(staticJob)
    expect(staticCommands).toContain('pnpm run constraints')
    expect(staticCommands).toContain('pnpm run typecheck')
    expect(staticCommands).toContain('pnpm run hygiene')
    expect(staticCommands).toContain('pnpm run doc-sync')
    expect(staticCommands).toContain('scripts/check-expected-filenames.sh')
    expect(staticCommands.join('\n')).toContain('apps/desktop/tests')
    expect(staticCommands.join('\n')).toContain('scripts/ci-workflow.spec.ts')

    expect(staticCommands).toContain('pnpm run build:official')
    expect(staticCommands).toContain('pnpm run build:desktop-exe -- --target=linux-x64 --skip-build')
    expect(staticCommands.join('\n')).toContain('dsh-desktop-linux-x64')
    expect(staticCommands.join('\n')).toContain('--smoke')

    const native = workflowJob(workflow, 'native-smoke')
    if (!isPlainObject(native.strategy)) throw new TypeError('native-smoke must define a strategy')
    const nativeStrategy = native.strategy as Record<string, unknown>
    if (!isPlainObject(nativeStrategy.matrix)) throw new TypeError('native-smoke must define a matrix')
    const nativeMatrix = nativeStrategy.matrix as Record<string, unknown>
    if (!Array.isArray(nativeMatrix.include)) throw new TypeError('native-smoke must define matrix entries')
    expect(native.if).toBe("github.ref == 'refs/heads/master' && github.event_name != 'pull_request'")
    expect(nativeMatrix.include).toEqual([
      { target: 'windows-x64', runner: 'windows-2025', output: 'dsh-desktop-windows-x64.exe' },
      { target: 'macos-arm64', runner: 'macos-15', output: 'dsh-desktop-macos-arm64' },
    ])
    expect(commands(native)).toContain('pnpm run build:desktop-exe -- --target=${{ matrix.target }} --skip-build')
  })

  it('uses isolated pnpm setup directories in desktop CI', () => {
    const workflow = loadWorkflow('.github/workflows/desktop-ci.yml')
    if (!isPlainObject(workflow.jobs)) throw new TypeError('desktop CI must define jobs')
    for (const [jobName, value] of Object.entries(workflow.jobs as Record<string, unknown>)) {
      if (!isPlainObject(value)) continue
      const job = value as Record<string, unknown>
      if (!Array.isArray(job.steps)) continue
      const setup = job.steps.find(step => isPlainObject(step) && Reflect.get(step as object, 'uses') === 'pnpm/action-setup@v4')
      expect(setup, `${jobName} must install pnpm`).toMatchObject({
        with: {
          dest: '${{ runner.temp }}/setup-pnpm-${{ github.run_id }}-${{ github.run_attempt }}-${{ github.job }}',
        },
      })
    }
  })

  it('prepares an upstream merge branch without writing master', () => {
    const workflow = loadWorkflow('.github/workflows/upstream-sync.yml')
    expect(workflowEvents(workflow)).toEqual(['workflow_dispatch'])
    expect(workflow.permissions).toEqual({ contents: 'write' })
    const prepare = workflowJob(workflow, 'prepare')
    if (!Array.isArray(prepare.steps)) throw new TypeError('upstream sync must define steps')
    const mergeStep = prepare.steps.find(step => isPlainObject(step) && Reflect.get(step as object, 'name') === 'Prepare merge-forward branch')
    expect(mergeStep).toMatchObject({
      env: { SYNC_BRANCH: 'sync/upstream-${{ github.run_id }}-${{ github.run_attempt }}' },
    })
    const source = commands(prepare).join('\n')
    expect(source).toContain('https://github.com/deepseek-ai/deepseek-harness.git')
    expect(source).toContain('git merge --no-edit')
    expect(source).toContain('git push origin "HEAD:refs/heads/$SYNC_BRANCH"')
    expect(source).not.toContain('HEAD:master')
  })

  it('keeps credentialed real-API validation manual-only', () => {
    const workflow = loadWorkflow('.github/workflows/e2e.yml')
    expect(workflowEvents(workflow)).toEqual(['workflow_dispatch'])
    const realApi = workflowJob(workflow, 'e2e')
    expect(realApi.if).toBeUndefined()
    expect(commands(realApi).join('\n')).toContain('DEEPSEEK_API_KEY is empty')
  })

  it('keeps optional Python runtime validation off automatic events', () => {
    const workflow = loadWorkflow('.github/workflows/build-exe-for-python-sdk.yml')
    expect(workflowEvents(workflow).sort()).toEqual(['workflow_call', 'workflow_dispatch'])
  })

  it('keeps the full sandbox matrix on master and manual dispatch', () => {
    const workflow = loadWorkflow('.github/workflows/sandbox.yml')
    expect(workflowEvents(workflow).sort()).toEqual(['push', 'workflow_dispatch'])
    const sandbox = workflowJob(workflow, 'sandbox-e2e')
    if (!isPlainObject(sandbox.strategy)) throw new TypeError('sandbox workflow must define a strategy')
    const sandboxStrategy = sandbox.strategy as Record<string, unknown>
    if (!isPlainObject(sandboxStrategy.matrix)) throw new TypeError('sandbox workflow must define a matrix')
    const sandboxMatrix = sandboxStrategy.matrix as Record<string, unknown>
    if (!Array.isArray(sandboxMatrix.include)) throw new TypeError('sandbox workflow must define matrix entries')
    expect(sandboxMatrix.include).toEqual([
      { os: 'ubuntu-latest', runner: 'bwrap' },
      { os: 'ubuntu-24.04', runner: 'landlock' },
      { os: 'ubuntu-24.04-arm', runner: 'landlock' },
      { os: 'macos-latest', runner: 'seatbelt' },
    ])
    const source = commands(sandbox).join('\n')
    expect(source).toContain('packed-install.e2e.ts')
    expect(JSON.stringify(sandbox.steps)).toContain('pack → install → confine')
  })
})

describe('desktop publication', () => {
  it('builds six native single-file targets and publishes only the complete tag set', () => {
    const workflow = loadWorkflow('.github/workflows/desktop-release.yml')
    const dispatch = workflowEvent(workflow, 'workflow_dispatch')
    const build = workflowJob(workflow, 'build')
    const publish = workflowJob(workflow, 'publish')
    if (!isPlainObject(dispatch.inputs)) throw new TypeError('desktop release must define inputs')
    expect(workflow.env).toMatchObject({ BUN_VERSION: '1.4.0' })
    const inputs = dispatch.inputs as Record<string, unknown>
    if (!isPlainObject(inputs.publish)) throw new TypeError('desktop release must define the publish input')
    if (!isPlainObject(build.strategy)) throw new TypeError('desktop release must define a strategy')
    const strategy = build.strategy as Record<string, unknown>
    if (!isPlainObject(strategy.matrix)) throw new TypeError('desktop release must define a matrix')
    const matrix = strategy.matrix as Record<string, unknown>
    if (!Array.isArray(matrix.include) || !Array.isArray(publish.steps)) {
      throw new TypeError('desktop release workflow must define matrix and publish steps')
    }

    expect(inputs.publish).toMatchObject({ type: 'boolean', default: false })
    expect(matrix.include).toEqual([
      { target: 'linux-x64', runner: 'ubuntu-24.04', output: 'dsh-desktop-linux-x64' },
      { target: 'linux-arm64', runner: 'ubuntu-24.04-arm', output: 'dsh-desktop-linux-arm64' },
      { target: 'windows-x64', runner: 'windows-2025', output: 'dsh-desktop-windows-x64.exe' },
      { target: 'windows-arm64', runner: 'windows-11-arm', output: 'dsh-desktop-windows-arm64.exe' },
      { target: 'macos-x64', runner: 'macos-15-intel', output: 'dsh-desktop-macos-x64' },
      { target: 'macos-arm64', runner: 'macos-15', output: 'dsh-desktop-macos-arm64' },
    ])
    expect(commands(build)).toContain('pnpm run build:official')
    expect(commands(build).join('\n')).toContain('npm_config_build_from_source=true pnpm run install')
    expect(commands(build)).toContain('pnpm run build:desktop-exe -- --target=${{ matrix.target }} --skip-build')
    expect(commands(build).join('\n')).toContain('--smoke')

    expect(publish).toMatchObject({
      if: 'inputs.publish',
      needs: 'build',
      permissions: { contents: 'write' },
    })
    const publication = JSON.stringify(publish.steps)
    expect(publication).toContain('desktop-v$version')
    expect(publication).toContain('SHA256SUMS')
    expect(publication).toContain('gh release create')
    expect(publication).toContain('--prerelease')
    expect(publication).toContain('gh release edit')
  })

  it('keeps the desktop GitHub Release as the only public publication path', () => {
    const workflowDir = resolve(root, '.github/workflows')
    const forbidden = [
      'npm publish',
      'pnpm publish',
      'pypa/gh-action-pypi-publish',
      'twine upload',
      'uv publish',
      'pnpm run release:publish',
      'node ./scripts/publish-release.mjs',
    ]
    for (const file of ACTIVE_WORKFLOWS) {
      const source = readFileSync(resolve(workflowDir, file), 'utf8')
      for (const marker of forbidden) {
        expect(source, `${file} must not publish ${marker}`).not.toContain(marker)
      }
    }
  })

  it('keeps Pages deployment manual and release-tag gated', () => {
    const workflow = loadWorkflow('.github/workflows/docs-pages.yml')
    expect(workflowEvents(workflow)).toEqual(['workflow_dispatch'])
    expect(commands(workflowJob(workflow, 'build')).join('\n')).toContain('desktop-v$version')
    expect(workflowJob(workflow, 'deploy').environment).toMatchObject({ name: 'github-pages' })
  })
})

function loadWorkflow(path: string): Record<string, unknown> {
  const workflow: unknown = yaml.load(readFileSync(resolve(root, path), 'utf8'))
  if (!isPlainObject(workflow)) throw new TypeError(`${path} must define an object`)
  return workflow as Record<string, unknown>
}

function workflowEvents(workflow: Record<string, unknown>): string[] {
  if (!isPlainObject(workflow.on)) throw new TypeError('workflow must define on')
  return Object.keys(workflow.on as Record<string, unknown>)
}

function workflowEvent(workflow: Record<string, unknown>, event: string): Record<string, unknown> {
  if (!isPlainObject(workflow.on)) throw new TypeError('workflow must define on')
  const value = Reflect.get(workflow.on as object, event) as unknown
  if (value === null) return {}
  if (!isPlainObject(value)) throw new TypeError(`workflow event ${event} must define an object`)
  return value as Record<string, unknown>
}

function workflowJob(workflow: Record<string, unknown>, name: string): Record<string, unknown> {
  if (!isPlainObject(workflow.jobs)) throw new TypeError('workflow must define jobs')
  const job = Reflect.get(workflow.jobs as object, name) as unknown
  if (!isPlainObject(job)) throw new TypeError(`workflow must define job ${name}`)
  return job as Record<string, unknown>
}

function commands(job: Record<string, unknown>): string[] {
  if (!Array.isArray(job.steps)) throw new TypeError('workflow job must define steps')
  return job.steps.flatMap((step) => {
    if (!isPlainObject(step)) return []
    const run = Reflect.get(step as object, 'run')
    return typeof run === 'string' ? [run] : []
  })
}
