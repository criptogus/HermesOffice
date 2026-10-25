import { describe, expect, it } from 'vitest'

/** Mirrors MAX_CSV_IMPORT_BYTES in apps/sheets/src/main/sheets-main.ts */
const MAX_CSV_IMPORT_BYTES = 32 * 1024 * 1024

function isCsvImportTooLarge(bytes: number): boolean {
  return bytes > MAX_CSV_IMPORT_BYTES
}

describe('csv import size cap', () => {
  it('rejects oversized CSV', () => {
    expect(isCsvImportTooLarge(MAX_CSV_IMPORT_BYTES + 1)).toBe(true)
    expect(isCsvImportTooLarge(500 * 1024 * 1024)).toBe(true)
  })

  it('accepts normal CSV', () => {
    expect(isCsvImportTooLarge(1024)).toBe(false)
    expect(isCsvImportTooLarge(MAX_CSV_IMPORT_BYTES)).toBe(false)
  })
})
