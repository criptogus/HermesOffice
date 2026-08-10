import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const execFileMock = vi.fn()
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}))

import {
  MAX_ATTACHMENT_BYTES,
  buildSendMessage,
  buildTarget,
  quoteMediaPath,
  sendFileToTarget,
  validateSendRequest,
} from '../src/send'

const tmp = mkdtempSync(join(tmpdir(), 'hermes-share-test-'))
const existing = join(tmp, 'relatório final.docx')
writeFileSync(existing, 'docx bytes')

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('quoteMediaPath', () => {
  it('uses double quotes by default', () => {
    expect(quoteMediaPath('/tmp/a b.docx')).toBe('"/tmp/a b.docx"')
  })

  it('falls back to backticks when the path contains double quotes', () => {
    expect(quoteMediaPath('/tmp/a"b.docx')).toBe('`/tmp/a"b.docx`')
  })

  it('falls back to single quotes when both other delimiters collide', () => {
    expect(quoteMediaPath('/tmp/a"b`c.docx')).toBe("'/tmp/a\"b`c.docx'")
  })
})

describe('buildSendMessage', () => {
  it('emits only the MEDIA tag without a caption', () => {
    expect(buildSendMessage('/tmp/x.docx')).toBe('MEDIA:"/tmp/x.docx"')
  })

  it('appends a trimmed caption after the MEDIA tag', () => {
    expect(buildSendMessage('/tmp/x.docx', '  Para revisão  ')).toBe(
      'MEDIA:"/tmp/x.docx" Para revisão',
    )
  })

  it('omits whitespace-only captions', () => {
    expect(buildSendMessage('/tmp/x.docx', '   ')).toBe('MEDIA:"/tmp/x.docx"')
  })
})

describe('buildTarget', () => {
  it('uses platform alone when no id is known', () => {
    expect(buildTarget({ platform: 'telegram' })).toBe('telegram')
  })

  it('appends the channel id', () => {
    expect(buildTarget({ platform: 'telegram', id: '1088196041' })).toBe('telegram:1088196041')
  })

  it('appends the thread id when present', () => {
    expect(buildTarget({ platform: 'telegram', id: '-1001', threadId: 17585 })).toBe(
      'telegram:-1001:17585',
    )
    expect(buildTarget({ platform: 'telegram', id: '-1001', threadId: null })).toBe(
      'telegram:-1001',
    )
  })
})

describe('validateSendRequest', () => {
  it('accepts an existing file below the size cap', () => {
    expect(validateSendRequest({ filePath: existing, target: 'telegram' })).toBeNull()
  })

  it('rejects missing paths, targets and files', () => {
    expect(validateSendRequest({ filePath: '', target: 'telegram' })).toMatch(/No file/)
    expect(validateSendRequest({ filePath: existing, target: '' })).toMatch(/target/)
    expect(validateSendRequest({ filePath: join(tmp, 'nope.docx'), target: 'telegram' })).toMatch(
      /File not found/,
    )
  })

  it('rejects oversized attachments with a readable message', () => {
    const big = join(tmp, 'big.docx')
    writeFileSync(big, Buffer.alloc(MAX_ATTACHMENT_BYTES + 1))
    const error = validateSendRequest({ filePath: big, target: 'telegram' })
    expect(error).toMatch(/50 MB/)
  })
})

describe('execSend / sendFileToTarget', () => {
  beforeEach(() => {
    execFileMock.mockReset()
  })

  it('invokes hermes send with the MEDIA message', async () => {
    execFileMock.mockImplementation(
      (
        _bin: string,
        _args: string[],
        _opts: unknown,
        cb: (e: Error | null, out: string, err: string) => void,
      ) => cb(null, 'sent to Gustavo\n', ''),
    )
    const result = await sendFileToTarget('/fake/hermes', {
      filePath: existing,
      target: 'telegram:1088196041',
      message: 'Revisar',
    })
    expect(result.ok).toBe(true)
    expect(result.note).toBe('sent to Gustavo')
    expect(execFileMock).toHaveBeenCalledWith(
      '/fake/hermes',
      ['send', '--to', 'telegram:1088196041', `MEDIA:"${existing}" Revisar`],
      expect.objectContaining({ timeout: expect.any(Number) }),
      expect.any(Function),
    )
  })

  it('rejects before spawning when validation fails', async () => {
    const result = await sendFileToTarget('/fake/hermes', {
      filePath: join(tmp, 'missing.docx'),
      target: 'telegram',
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/File not found/)
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('maps CLI failures to a readable error', async () => {
    execFileMock.mockImplementation(
      (
        _bin: string,
        _args: string[],
        _opts: unknown,
        cb: (e: Error, _out: string, err: string) => void,
      ) => cb(new Error('exit code 1'), '', 'telegram: chat not found'),
    )
    const result = await sendFileToTarget('/fake/hermes', {
      filePath: existing,
      target: 'telegram:999999',
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/chat not found/)
  })
})
