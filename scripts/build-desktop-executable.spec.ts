import { describe, expect, it } from 'vitest'
import { dirnameOfFs } from './build-desktop-executable.ts'

describe('desktop executable path handling', () => {
  it.each([
    ['apps/cli/package.json', 'apps/cli'],
    ['apps\\cli\\package.json', 'apps\\cli'],
    ['package.json', '.'],
  ])('finds the parent of %s', (path, expected) => {
    expect(dirnameOfFs(path)).toBe(expected)
  })
})
