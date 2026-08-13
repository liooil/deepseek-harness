import { describe, expect, it } from 'vitest'
import { extractDshWebUrl } from '../src/readiness.ts'

describe('dsh web readiness', () => {
  it('extracts the stable loopback readiness URL', () => {
    expect(extractDshWebUrl('dsh web: http://127.0.0.1:43117')?.href).toBe(
      'http://127.0.0.1:43117/',
    )
    expect(extractDshWebUrl('info dsh web: http://127.0.0.1:3080, LAN: http://10.0.0.8:3080')?.href)
      .toBe('http://127.0.0.1:3080/')
  })

  it('does not accept a remote or malformed origin', () => {
    expect(extractDshWebUrl('dsh web: http://10.0.0.8:3080')).toBeUndefined()
    expect(extractDshWebUrl('dsh web: https://127.0.0.1:3080')).toBeUndefined()
    expect(extractDshWebUrl('server ready')).toBeUndefined()
  })
})
