/// Renderer-controlled file names must never escape the target directory:
/// keep only the basename, strip characters illegal in file names on any
/// platform, and fall back to a safe default. Shared by every app's
/// save-new / AI-draft path so the sanitization rule cannot drift.
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'

export function uniquePathIn(dir: string, fileName: string): string {
  const cleaned = basename(String(fileName ?? ''))
    // eslint-disable-next-line no-control-regex -- control characters are rejected on purpose
    .replace(/[/\\:*?"<>|\u0000-\u001f]/g, '_')
    .trim()
  const safeName = cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : 'Untitled'
  const dot = safeName.lastIndexOf('.')
  const base = dot > 0 ? safeName.slice(0, dot) : safeName
  const ext = dot > 0 ? safeName.slice(dot) : ''
  let candidate = join(dir, safeName)
  for (let i = 2; existsSync(candidate); i++) candidate = join(dir, `${base}-${i}${ext}`)
  return candidate
}
