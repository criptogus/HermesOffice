/**
 * Chat attachment IPC for the slides main process, extracted from
 * slides-main.ts: local files are validated/parsed here and fed to the agent
 * (copied from the apps/docs docs-main attachment chain). Channels get the
 * slides: prefix because the shell already registers the global files:*
 * channels via docs.
 */
import { app, dialog, ipcMain, type WebContents } from 'electron'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { saveAttachmentBytes, showOpenDialogWithMemory } from '@hermesoffice/electron-utils'
import { parseFileToText } from '@hermesoffice/file-parse'
import type {
  AttachmentAddResult,
  AttachmentImageResult,
  AttachmentMeta,
  AttachmentReadResult,
} from '../shared/ipc'
import { ATTACHMENT_IMAGE_EXTS } from '../shared/ipc'
import { tm } from './i18n-main'
import { dialogParent } from './session-state'

const ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024
/** Plain-text extensions, read as UTF-8 */
const ATTACHMENT_TEXT_EXTS = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'tsv',
  'json',
  'yaml',
  'yml',
  'xml',
  'html',
  'htm',
  'log',
  'js',
  'ts',
  'tsx',
  'jsx',
  'py',
  'java',
  'c',
  'h',
  'cpp',
  'go',
  'rs',
  'rb',
  'sh',
  'sql',
  'css',
])
/** office/pdf formats extract text via @hermesoffice/file-parse; images skip text extraction and go multimodal (slides:files-read-image) */
const ATTACHMENT_EXTS = new Set([
  ...ATTACHMENT_TEXT_EXTS,
  'doc',
  'docx',
  'pdf',
  'pptx',
  'ppt',
  'xlsx',
  'xlsm',
  'xls',
  ...ATTACHMENT_IMAGE_EXTS,
])

const ATTACHMENT_IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}
/** Multimodal cap per image attachment (prevents context blowup) */
const ATTACHMENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024

/** Extracted-text cache keyed by path; invalidated when mtime+size change */
const attachmentTextCache = new Map<string, { stamp: string; text: string }>()

/** per-renderer chat-attachment paths granted via the picker, drag-drop/paste
 * registration or a pasted-image temp file — files:read* only serves these, so
 * renderer/agent code cannot read arbitrary filesystem paths */
const attachmentReadablePaths = new Map<number, Set<string>>()
const attachmentHookedWcIds = new Set<number>()

function grantAttachmentRead(wc: WebContents, filePath: string): void {
  if (!attachmentHookedWcIds.has(wc.id)) {
    attachmentHookedWcIds.add(wc.id)
    wc.once('destroyed', () => {
      attachmentReadablePaths.delete(wc.id)
      attachmentHookedWcIds.delete(wc.id)
    })
  }
  const set = attachmentReadablePaths.get(wc.id) ?? new Set<string>()
  set.add(resolve(filePath))
  attachmentReadablePaths.set(wc.id, set)
}

function canReadAttachment(wc: WebContents, filePath: string): boolean {
  return attachmentReadablePaths.get(wc.id)?.has(resolve(filePath)) === true
}

function statAttachment(filePath: string): { meta?: AttachmentMeta; error?: string } {
  const name = basename(filePath)
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (!ATTACHMENT_EXTS.has(ext)) return { error: `${name}: ${tm('errUnsupportedExt', { ext })}` }
  try {
    const stat = statSync(filePath)
    if (!stat.isFile()) return { error: `${name}: ${tm('errNotFile')}` }
    if (stat.size > ATTACHMENT_MAX_BYTES) {
      return {
        error: `${name}: ${tm('errTooLarge', { mb: Math.round(ATTACHMENT_MAX_BYTES / 1024 / 1024) })}`,
      }
    }
    if (ATTACHMENT_IMAGE_EXTS.has(ext) && stat.size > ATTACHMENT_IMAGE_MAX_BYTES) {
      return { error: `${name}: ${tm('errImageTooLarge')}` }
    }
    return { meta: { path: filePath, name, ext, sizeBytes: stat.size } }
  } catch {
    return { error: `${name}: ${tm('errUnreadable')}` }
  }
}

function collectAttachments(paths: string[]): AttachmentAddResult {
  const accepted: AttachmentMeta[] = []
  const rejected: string[] = []
  for (const p of paths) {
    const { meta, error } = statAttachment(p)
    if (meta) accepted.push(meta)
    else if (error) rejected.push(error)
  }
  return { accepted, rejected }
}

/** Save clipboard-pasted image bytes to a temp file (screenshots/bitmaps without a local path); null for non-images or empty data */
let pastedImageSeq = 0
function savePastedImage(data: unknown, ext: unknown): string | null {
  const cleanExt = typeof ext === 'string' ? ext.toLowerCase() : ''
  if (!ATTACHMENT_IMAGE_EXTS.has(cleanExt)) return null
  const bytes =
    data instanceof ArrayBuffer
      ? Buffer.from(data)
      : ArrayBuffer.isView(data)
        ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
        : null
  if (!bytes || bytes.byteLength === 0) return null
  const dir = join(app.getPath('temp'), 'hermesoffice-pasted')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
  const filePath = join(dir, `pasted-${stamp}-${++pastedImageSeq}.${cleanExt}`)
  writeFileSync(filePath, bytes)
  return filePath
}

/** Extract attachment text via @hermesoffice/file-parse (docx/pdf/pptx/xlsx/plain text) */
async function extractAttachmentText(filePath: string): Promise<string> {
  const stat = statSync(filePath)
  const stamp = `${stat.mtimeMs}:${stat.size}`
  const cached = attachmentTextCache.get(filePath)
  if (cached && cached.stamp === stamp) return cached.text
  if (stat.size > ATTACHMENT_MAX_BYTES) throw new Error(tm('errFileTooLarge'))
  const parsed = await parseFileToText(filePath)
  if (!parsed.ok || parsed.kind !== 'text' || parsed.text == null) {
    throw new Error(parsed.error ?? tm('errParseFailed'))
  }
  attachmentTextCache.set(filePath, { stamp, text: parsed.text })
  // Bounded cache (keeping a few recent files is enough)
  if (attachmentTextCache.size > 8) {
    const oldest = attachmentTextCache.keys().next().value
    if (oldest) attachmentTextCache.delete(oldest)
  }
  return parsed.text
}

/** Register the slides:files-* attachment channels (called from registerSlidesIpc). */
export function registerAttachmentIpc(): void {
  ipcMain.handle('slides:files-pick', async (e): Promise<AttachmentAddResult | null> => {
    const parent = dialogParent()
    const options = {
      title: tm('dlgAddAttachment'),
      filters: [
        { name: tm('filterSupported'), extensions: [...ATTACHMENT_EXTS] },
        { name: tm('filterAll'), extensions: ['*'] },
      ],
      properties: ['openFile' as const, 'multiSelections' as const],
    }
    const r = await showOpenDialogWithMemory(dialog, parent, options)
    if (r.canceled || r.filePaths.length === 0) return null
    for (const p of r.filePaths) grantAttachmentRead(e.sender, p)
    return collectAttachments(r.filePaths)
  })

  ipcMain.handle('slides:files-add', (e, paths: string[]) => {
    // Renderer-supplied paths are not proof of an OS drop/paste: collect the
    // metadata for display, but do NOT grant read access — grants only come
    // from the picker, pasted-image temp files, and files-add-bytes.
    return collectAttachments(paths)
  })

  // Dragged/pasted files arrive as bytes: webUtils.getPathForFile strings can
  // be forged by page script, so main stores the bytes under temp itself and
  // grants that path — the renderer never names a readable path.
  ipcMain.handle(
    'slides:files-add-bytes',
    (e, name: unknown, data: unknown): AttachmentAddResult => {
      const saved = saveAttachmentBytes(data, name, {
        allowedExts: ATTACHMENT_EXTS,
        maxBytes: ATTACHMENT_MAX_BYTES,
      })
      if (!saved.ok) {
        const ext = typeof name === 'string' ? (name.split('.').pop()?.toLowerCase() ?? '') : ''
        return {
          accepted: [],
          rejected: [
            saved.reason === 'too-large'
              ? tm('errFileTooLarge')
              : saved.reason === 'bad-ext'
                ? tm('errUnsupportedExt', { ext })
                : tm('errUnreadable'),
          ],
        }
      }
      grantAttachmentRead(e.sender, saved.path)
      return collectAttachments([saved.path])
    },
  )

  ipcMain.handle(
    'slides:files-read',
    async (
      e,
      filePath: string,
      offset: number,
      maxChars: number,
    ): Promise<AttachmentReadResult> => {
      if (!canReadAttachment(e.sender, filePath)) {
        return { ok: false, error: tm('errAttachmentNotGranted') }
      }
      const name = basename(filePath)
      const ext = name.split('.').pop()?.toLowerCase() ?? ''
      if (!ATTACHMENT_EXTS.has(ext)) return { ok: false, error: tm('errUnsupportedExt', { ext }) }
      if (ATTACHMENT_IMAGE_EXTS.has(ext)) {
        return { ok: false, error: tm('errImageNoText') }
      }
      try {
        const text = await extractAttachmentText(filePath)
        const start = Math.max(0, Math.floor(offset) || 0)
        const size = Math.min(Math.max(1, Math.floor(maxChars) || 1), 48_000)
        return {
          ok: true,
          name,
          totalChars: text.length,
          offset: start,
          text: text.slice(start, start + size),
        }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
  )

  // Image attachments read raw bytes -> base64; AiPanel puts them into the user message's images for multimodal
  ipcMain.handle('slides:files-read-image', (e, filePath: string): AttachmentImageResult => {
    if (!canReadAttachment(e.sender, filePath)) {
      return { ok: false, error: tm('errAttachmentNotGranted') }
    }
    const name = basename(filePath)
    const ext = name.split('.').pop()?.toLowerCase() ?? ''
    const mime = ATTACHMENT_IMAGE_MIME[ext]
    if (!mime) return { ok: false, error: `${name}: ${tm('errNotImage')}` }
    try {
      const stat = statSync(filePath)
      if (stat.size > ATTACHMENT_IMAGE_MAX_BYTES) {
        return { ok: false, error: `${name}: ${tm('errImageTooLarge')}` }
      }
      return { ok: true, base64: readFileSync(filePath).toString('base64'), mime }
    } catch {
      return { ok: false, error: `${name}: ${tm('errUnreadable')}` }
    }
  })

  // Clipboard-pasted images (screenshots and other bitmaps without a local path): saved to a temp file then take the regular attachment chain
  ipcMain.handle(
    'slides:files-add-pasted-image',
    (e, data: unknown, ext: unknown): AttachmentAddResult => {
      const filePath = savePastedImage(data, ext)
      if (filePath) grantAttachmentRead(e.sender, filePath)
      return filePath
        ? collectAttachments([filePath])
        : { accepted: [], rejected: [tm('errNotImage')] }
    },
  )
}
