import { describe, expect, it } from 'vitest'
import { shouldPreloadSharpLibrary } from '../src/native-library.ts'

describe('shouldPreloadSharpLibrary', () => {
  it.each(['linux', 'darwin'] as const)('preloads libvips on %s', (platform) => {
    expect(shouldPreloadSharpLibrary(platform)).toBe(true)
  })

  it('lets the Windows loader resolve Sharp dependencies beside the add-on', () => {
    expect(shouldPreloadSharpLibrary('win32')).toBe(false)
  })
})
