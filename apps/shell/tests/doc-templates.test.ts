import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseDocx } from '@hermesoffice/docx-engine'
import { createDocFromTemplate, listDocTemplates } from '../src/main/doc-templates'

const REPO_TEMPLATES = resolve(import.meta.dirname, '../../../templates')

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'doc-templates-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function writeManifest(docs: unknown): string {
  const templates = join(dir, 'templates')
  mkdirSync(join(templates, 'docs'), { recursive: true })
  writeFileSync(join(templates, 'manifest.json'), JSON.stringify({ version: 1, docs }))
  writeFileSync(join(templates, 'docs', 'a.docx'), 'template-bytes')
  return templates
}

describe('shipped document templates', () => {
  it('lists every .docx under templates/docs in the manifest', () => {
    const listed = listDocTemplates(REPO_TEMPLATES).map((t) => t.id)
    const onDisk = readdirSync(join(REPO_TEMPLATES, 'docs'))
      .filter((f) => f.endsWith('.docx'))
      .map((f) => f.replace(/\.docx$/, ''))
    expect(listed.length).toBeGreaterThanOrEqual(4)
    expect([...listed].sort()).toEqual([...onDisk].sort())
  })

  it('creates a copy that opens as a document and leaves the template untouched', async () => {
    const before = readFileSync(join(REPO_TEMPLATES, 'docs', 'meeting-notes.docx'))
    const target = createDocFromTemplate(REPO_TEMPLATES, 'meeting-notes', dir)
    expect(target).toBe(join(dir, 'Meeting notes.docx'))
    const copy = readFileSync(target)
    expect(copy.equals(before)).toBe(true)
    expect((await parseDocx(copy)).blocks.length).toBeGreaterThan(0)
    expect(readFileSync(join(REPO_TEMPLATES, 'docs', 'meeting-notes.docx')).equals(before)).toBe(
      true,
    )
  })
})

describe('listDocTemplates', () => {
  it('returns display fields only, without the file path', () => {
    const templates = writeManifest([
      { id: 'a', file: 'docs/a.docx', name: 'A', description: 'Desc', tags: ['x', 'y'] },
    ])
    expect(listDocTemplates(templates)).toEqual([
      { id: 'a', name: 'A', description: 'Desc', tags: ['x', 'y'] },
    ])
  })

  it('drops malformed, duplicate, missing and path-escaping entries', () => {
    const templates = writeManifest([
      { id: 'ok', file: 'docs/a.docx', name: 'OK' },
      { id: 'ok', file: 'docs/a.docx', name: 'Duplicate' },
      { id: 'gone', file: 'docs/missing.docx', name: 'Missing' },
      { id: 'up', file: '../secret.docx', name: 'Up' },
      { id: 'abs', file: '/etc/passwd.docx', name: 'Abs' },
      { id: 'back', file: 'docs\\a.docx', name: 'Backslash' },
      { id: 'ext', file: 'docs/a.txt', name: 'Ext' },
      { id: 'noname', file: 'docs/a.docx' },
      null,
      'nope',
    ])
    expect(listDocTemplates(templates).map((t) => t.id)).toEqual(['ok'])
  })

  it('returns an empty list for a missing or invalid manifest', () => {
    expect(listDocTemplates(join(dir, 'nowhere'))).toEqual([])
    const templates = join(dir, 'bad')
    mkdirSync(templates)
    writeFileSync(join(templates, 'manifest.json'), '{not json')
    expect(listDocTemplates(templates)).toEqual([])
    writeFileSync(join(templates, 'manifest.json'), JSON.stringify({ docs: 'x' }))
    expect(listDocTemplates(templates)).toEqual([])
  })
})

describe('createDocFromTemplate', () => {
  it('picks a non-clashing name and never overwrites an existing file', () => {
    const templates = writeManifest([{ id: 'a', file: 'docs/a.docx', name: 'Report' }])
    const dest = join(dir, 'out')
    const first = createDocFromTemplate(templates, 'a', dest)
    writeFileSync(first, 'user edits')
    const second = createDocFromTemplate(templates, 'a', dest)
    expect(first).toBe(join(dest, 'Report.docx'))
    expect(second).toBe(join(dest, 'Report-2.docx'))
    expect(readFileSync(first, 'utf8')).toBe('user edits')
    expect(readFileSync(second, 'utf8')).toBe('template-bytes')
  })

  it('rejects ids that are not in the manifest, including path-like ones', () => {
    const templates = writeManifest([{ id: 'a', file: 'docs/a.docx', name: 'A' }])
    for (const id of ['nope', '../manifest', 'docs/a.docx', '', 42, null, undefined]) {
      expect(() => createDocFromTemplate(templates, id, dir)).toThrow('Unknown document template')
    }
  })
})
