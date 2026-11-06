/// Dragged/pasted files reach the renderer as File objects, not trustworthy
/// paths: webUtils.getPathForFile strings can be forged by any script running
/// in the page, so attachment grants must never be based on renderer-supplied
/// paths. Instead the renderer sends the file's bytes and a display name; the
/// main process writes them under the OS temp dir and grants that path.
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sanitizeFileName } from './safe-file-name'

export type SaveAttachmentBytesResult =
  { ok: true; path: string } | { ok: false; reason: 'empty' | 'bad-name' | 'bad-ext' | 'too-large' }

export interface SaveAttachmentBytesOptions {
  /// lowercase extensions without dot that may be stored ('' entries ignored)
  readonly allowedExts: ReadonlySet<string>
  readonly maxBytes: number
  /// injectable for tests; defaults to <tmpdir>/hermesoffice-attachments
  readonly dir?: string
}

let seq = 0

/**
 * Persist renderer-supplied attachment bytes to a unique temp file and return
 * its path. The caller is responsible for granting read access to the
 * webContents that will consume it.
 */
export function saveAttachmentBytes(
  data: unknown,
  fileName: unknown,
  opts: SaveAttachmentBytesOptions,
): SaveAttachmentBytesResult {
  const bytes =
    data instanceof ArrayBuffer
      ? Buffer.from(data)
      : ArrayBuffer.isView(data)
        ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
        : null
  if (!bytes || bytes.byteLength === 0) return { ok: false, reason: 'empty' }
  if (bytes.byteLength > opts.maxBytes) return { ok: false, reason: 'too-large' }

  const safe = sanitizeFileName(typeof fileName === 'string' ? fileName : '')
  if (!safe || safe === 'Untitled') return { ok: false, reason: 'bad-name' }
  const ext = safe.split('.').pop()?.toLowerCase() ?? ''
  if (!opts.allowedExts.has(ext)) return { ok: false, reason: 'bad-ext' }

  const dir = opts.dir ?? join(tmpdir(), 'hermesoffice-attachments')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
  const path = join(dir, `${stamp}-${++seq}-${safe}`)
  writeFileSync(path, bytes)
  return { ok: true, path }
}
