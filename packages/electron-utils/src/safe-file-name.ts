/// Renderer-controlled file names must never escape the target directory:
/// keep only the basename, strip characters illegal in file names on any
/// platform, and fall back to a safe default. Shared by every app's
/// save-new / AI-draft path so the sanitization rule cannot drift.
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'

const WINDOWS_RESERVED_NAMES = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i

/** basename + illegal-char strip; 'Untitled' when nothing usable remains */
export function sanitizeFileName(fileName: string): string {
  let cleaned = basename(String(fileName ?? ''))
    // eslint-disable-next-line no-control-regex -- control characters are rejected on purpose
    .replace(/[/\\:*?"<>|\u0000-\u001f]/g, '_')
    .trim()
    .replace(/[. ]+$/, '') // Windows disallows trailing dots and spaces in file names

  if (!cleaned || cleaned === '.' || cleaned === '..') return 'Untitled'
  // Windows reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9) with or without extensions
  if (WINDOWS_RESERVED_NAMES.test(cleaned)) {
    cleaned = `_${cleaned}`
  }
  return cleaned
}

export function uniquePathIn(dir: string, fileName: string): string {
  const safeName = sanitizeFileName(fileName)
  const dot = safeName.lastIndexOf('.')
  const base = dot > 0 ? safeName.slice(0, dot) : safeName
  const ext = dot > 0 ? safeName.slice(dot) : ''
  let candidate = join(dir, safeName)
  for (let i = 2; existsSync(candidate); i++) candidate = join(dir, `${base}-${i}${ext}`)
  return candidate
}
