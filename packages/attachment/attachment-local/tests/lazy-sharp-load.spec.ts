import { describe, expect, it, vi } from 'vitest'

vi.mock('sharp', () => {
  throw new Error('sharp native binding loaded during plugin import')
})

describe('attachment-local module loading', () => {
  it('does not evaluate Sharp before an image operation', async () => {
    const plugin = await import('../src/index.ts')

    expect(plugin.LocalAttachmentStore).toBeTypeOf('function')
  })
})
