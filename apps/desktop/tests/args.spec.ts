import { describe, expect, it } from 'vitest'
import { defaultDesktopProvider, parseDesktopArgs } from '../src/args.ts'

describe('desktop arguments', () => {
  it('defaults to native webviews where BunDesk supports them', () => {
    expect(defaultDesktopProvider('linux')).toBe('webview')
    expect(defaultDesktopProvider('win32')).toBe('webview')
    expect(defaultDesktopProvider('darwin')).toBe('browser')
  })

  it('parses window, workspace, port, and smoke options', () => {
    expect(parseDesktopArgs([
      '--browser',
      '--cwd',
      '/workspace',
      '--port',
      '4100',
      '--smoke',
    ], 'linux')).toEqual({
      cwd: '/workspace',
      help: false,
      port: 4100,
      provider: 'browser',
      smoke: true,
      version: false,
    })
    expect(parseDesktopArgs(['--provider', 'webview'], 'darwin').provider).toBe('webview')
  })

  it('rejects conflicting or invalid provider selections', () => {
    expect(() => parseDesktopArgs(['--browser', '--webview'])).toThrow('mutually exclusive')
    expect(() => parseDesktopArgs(['--provider', 'electron'])).toThrow(
      '--provider must be browser or webview',
    )
  })

  it('rejects invalid server ports', () => {
    expect(() => parseDesktopArgs(['--port=65536'])).toThrow(
      '--port must be an integer from 0 through 65535',
    )
    expect(() => parseDesktopArgs(['--port=1.5'])).toThrow(
      '--port must be an integer from 0 through 65535',
    )
  })
})
