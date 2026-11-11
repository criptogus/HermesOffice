import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

import { sanitizeFileName, uniquePathIn } from '../src/safe-file-name'

const dir = () => mkdtempSync(join(tmpdir(), 'safe-file-name-'))

describe('uniquePathIn', () => {
  it('keeps a normal file name inside dir', () => {
    const d = dir()
    expect(uniquePathIn(d, 'report.docx')).toBe(join(d, 'report.docx'))
  })

  it.each([
    '../../etc/passwd',
    '..\\..\\windows\\system32\\evil.dll',
    'sub/dir/file.txt',
    '/absolute/path/file.txt',
  ])('cannot escape dir via %s', (evil) => {
    const d = dir()
    const out = uniquePathIn(d, evil)
    expect(resolve(out).startsWith(resolve(d) + sep)).toBe(true)
  })

  it('strips characters illegal on Windows/macOS/Linux', () => {
    const d = dir()
    // basename() runs first, so the posix-illegal '/' truncates the name;
    // the rest are replaced with '_'
    const out = uniquePathIn(d, 'a/b\\c:d*e?f"g<h>i|j.txt')
    expect(out).toBe(join(d, 'b_c_d_e_f_g_h_i_j.txt'))
  })

  it('neutralizes windows-style traversal on posix (backslash is not a separator)', () => {
    const d = dir()
    const out = uniquePathIn(d, '..\\..\\windows\\system32\\evil.dll')
    expect(resolve(out)).toBe(join(d, '.._.._windows_system32_evil.dll'))
  })

  it('replaces control characters', () => {
    const d = dir()
    const out = uniquePathIn(d, 'bad\tname\x07.txt')
    expect(out).toBe(join(d, 'bad_name_.txt'))
  })

  it.each(['.', '..', '   ', ''])('falls back to Untitled for %j', (evil) => {
    const d = dir()
    expect(uniquePathIn(d, evil)).toBe(join(d, 'Untitled'))
  })

  it('de-duplicates with -2, -3 suffixes preserving the extension', () => {
    const d = dir()
    writeFileSync(join(d, 'report.docx'), 'x')
    writeFileSync(join(d, 'report-2.docx'), 'x')
    expect(uniquePathIn(d, 'report.docx')).toBe(join(d, 'report-3.docx'))
  })

  it('handles names without an extension', () => {
    const d = dir()
    writeFileSync(join(d, 'notes'), 'x')
    expect(uniquePathIn(d, 'notes')).toBe(join(d, 'notes-2'))
  })

  it('neutralizes Windows reserved device names', () => {
    expect(sanitizeFileName('CON')).toBe('_CON')
    expect(sanitizeFileName('con.docx')).toBe('_con.docx')
    expect(sanitizeFileName('PRN')).toBe('_PRN')
    expect(sanitizeFileName('aux.txt')).toBe('_aux.txt')
    expect(sanitizeFileName('NUL')).toBe('_NUL')
    expect(sanitizeFileName('com1.pdf')).toBe('_com1.pdf')
    expect(sanitizeFileName('LPT9')).toBe('_LPT9')
    // Legitimate names with prefixes/suffixes containing reserved names are allowed
    expect(sanitizeFileName('CONSOLE.docx')).toBe('CONSOLE.docx')
    expect(sanitizeFileName('my-con.docx')).toBe('my-con.docx')
  })

  it('strips trailing dots and spaces', () => {
    expect(sanitizeFileName('report.')).toBe('report')
    expect(sanitizeFileName('report   ')).toBe('report')
    expect(sanitizeFileName('report. . .')).toBe('report')
    expect(sanitizeFileName('...')).toBe('Untitled')
  })
})
