import { describe, expect, it } from 'vitest'

function isValidOpenPath(p: unknown): boolean {
  return typeof p === 'string' && p.length > 0 && p.length <= 4096
}

describe('home openPath IPC validation', () => {
  it('accepts normal paths', () => {
    expect(isValidOpenPath('/docs/report.docx')).toBe(true)
  })

  it('rejects non-string, empty, and overlong paths', () => {
    expect(isValidOpenPath(123)).toBe(false)
    expect(isValidOpenPath('')).toBe(false)
    expect(isValidOpenPath('x'.repeat(5000))).toBe(false)
  })
})
