import { chmodSync, constants, copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { uniquePathIn } from '@hermesoffice/electron-utils'
import type { DocTemplateInfo } from '../shared/home-api'

/**
 * "New document from template…": the built-in `.docx` templates under the
 * repository's `templates/` directory (shipped as an extraResource, so the
 * packaged app reads the same files). `templates/manifest.json` is the single
 * source of truth for what the picker offers; adding a template is adding the
 * file plus a manifest entry.
 */

interface ManifestEntry extends DocTemplateInfo {
  /** path relative to the templates directory, always a `.docx` */
  file: string
}

const MANIFEST_FILE = 'manifest.json'
const MAX_TAGS = 8

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= max ? trimmed : null
}

/** a manifest-relative file path that stays inside the templates directory */
function isSafeRelativeDocx(file: string): boolean {
  if (extname(file).toLowerCase() !== '.docx') return false
  if (file.startsWith('/') || file.includes('\\') || /^[a-zA-Z]:/.test(file)) return false
  return file.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
}

/**
 * Parse the manifest, dropping malformed entries, duplicate ids, unsafe paths
 * and entries whose file is missing, so a damaged entry never breaks the rest
 * of the picker. An unreadable manifest yields an empty list.
 */
function readManifest(templatesDir: string): ManifestEntry[] {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(join(templatesDir, MANIFEST_FILE), 'utf8'))
  } catch {
    return []
  }
  const docs = (raw as { docs?: unknown } | null)?.docs
  if (!Array.isArray(docs)) return []
  const seen = new Set<string>()
  const entries: ManifestEntry[] = []
  for (const item of docs as Array<Record<string, unknown> | null>) {
    const id = cleanString(item?.id, 64)
    const file = cleanString(item?.file, 256)
    const name = cleanString(item?.name, 80)
    if (!id || !file || !name || seen.has(id) || !isSafeRelativeDocx(file)) continue
    if (!existsSync(join(templatesDir, ...file.split('/')))) continue
    const tags = Array.isArray(item?.tags)
      ? item.tags
          .map((tag) => cleanString(tag, 32))
          .filter((tag): tag is string => tag !== null)
          .slice(0, MAX_TAGS)
      : []
    seen.add(id)
    entries.push({
      id,
      file,
      name,
      description: cleanString(item?.description, 200) ?? '',
      tags,
    })
  }
  return entries
}

export function listDocTemplates(templatesDir: string): DocTemplateInfo[] {
  return readManifest(templatesDir).map(({ id, name, description, tags }) => ({
    id,
    name,
    description,
    tags,
  }))
}

/**
 * Copy the template with `id` into `destDir` under a fresh, non-clashing name
 * and return the new path. The template file itself is never modified, and the
 * id is looked up in the manifest rather than used as a path, so a renderer
 * can only ever reach the shipped templates.
 */
export function createDocFromTemplate(templatesDir: string, id: unknown, destDir: string): string {
  const entry = typeof id === 'string' ? readManifest(templatesDir).find((e) => e.id === id) : null
  if (!entry) throw new Error('Unknown document template.')
  mkdirSync(destDir, { recursive: true })
  const source = join(templatesDir, ...entry.file.split('/'))
  const target = uniquePathIn(destDir, `${entry.name}.docx`)
  // COPYFILE_EXCL: never overwrite a file created between the name check and the copy
  copyFileSync(source, target, constants.COPYFILE_EXCL)
  // the copy inherits the template's mode; installs under a read-only location
  // must not hand the user a read-only document
  chmodSync(target, 0o644)
  return target
}
