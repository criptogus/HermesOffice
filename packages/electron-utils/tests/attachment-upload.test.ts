import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { saveAttachmentBytes } from '../src/attachment-upload'

const EXTS = new Set(['txt', 'png', 'docx'])
const dir = () => mkdtempSync(join(tmpdir(), 'attachment-upload-'))
const opts = (d: string) => ({ allowedExts: EXTS, maxBytes: 1024, dir: d })

describe('saveAttachmentBytes', () => {
  it('writes bytes to a unique temp file and returns its path', () => {
    const d = dir()
    const a = saveAttachmentBytes(new TextEncoder().encode('hello').buffer, 'note.txt', opts(d))
    const b = saveAttachmentBytes(new TextEncoder().encode('world').buffer, 'note.txt', opts(d))
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(a.path).not.toBe(b.path)
      expect(readFileSync(a.path, 'utf8')).toBe('hello')
      expect(a.path.startsWith(d)).toBe(true)
    }
  })

  it('accepts typed-array views', () => {
    const d = dir()
    const r = saveAttachmentBytes(new Uint8Array([1, 2, 3]), 'x.png', opts(d))
    expect(r.ok).toBe(true)
  })

  it.each([
    ['empty buffer', new ArrayBuffer(0), 'a.txt'],
    ['null data', null, 'a.txt'],
    ['oversized', new ArrayBuffer(2048), 'a.txt'],
    ['disallowed ext', new TextEncoder().encode('x').buffer, 'evil.exe'],
    ['no extension', new TextEncoder().encode('x').buffer, 'README'],
  ])('rejects %s', (_label, data, name) => {
    const d = dir()
    const r = saveAttachmentBytes(data, name, opts(d))
    expect(r.ok).toBe(false)
  })

  it('cannot escape the temp dir via a traversal file name', () => {
    const d = dir()
    const r = saveAttachmentBytes(
      new TextEncoder().encode('x').buffer,
      '../../etc/a.txt',
      opts(d),
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.path.startsWith(d + '/')).toBe(true)
  })

  it('sanitizes the stored file name', () => {
    const d = dir()
    const r = saveAttachmentBytes(new TextEncoder().encode('x').buffer, 'a/b:c.txt', opts(d))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.path).not.toContain('/b:c')
  })
})
