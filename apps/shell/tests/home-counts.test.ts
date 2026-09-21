import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createI18n } from '@genoffice/i18n'
import { normalizeRecentQuery, pageRecentPaths } from '../src/main/recent-files'
import { fileCountKey, timelineCountKey, visiblePageCount } from '../src/renderer/src/counts'
import { strings } from '../src/renderer/src/strings'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('home visible counts', () => {
  it('uses the filtered total for the sidebar count', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shell-counts-'))
    tempDirs.push(dir)
    const docPath = join(dir, 'notes.docx')
    const slidePath = join(dir, 'deck.pptx')
    writeFileSync(docPath, 'doc')
    writeFileSync(slidePath, 'slide')

    const page = pageRecentPaths(
      [docPath, slidePath],
      { ext: 'docx', offset: 0, limit: 50 },
      new Set(),
    )

    expect(page.totalAll).toBe(2)
    expect(page.total).toBe(1)
    expect(page.entries.map((entry) => entry.path)).toEqual([docPath])
    expect(visiblePageCount(page)).toBe(1)
  })

  it('counts .xlsm under the sheets (xlsx) filter', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shell-counts-'))
    tempDirs.push(dir)
    const bookPath = join(dir, 'book.xlsx')
    const macroPath = join(dir, 'macro.xlsm')
    const docPath = join(dir, 'notes.docx')
    writeFileSync(bookPath, 'sheet')
    writeFileSync(macroPath, 'sheet')
    writeFileSync(docPath, 'doc')

    const page = pageRecentPaths(
      [bookPath, macroPath, docPath],
      { ext: 'xlsx', offset: 0, limit: 50 },
      new Set(),
    )

    expect(page.total).toBe(2)
    expect(page.entries.map((entry) => entry.path)).toEqual([bookPath, macroPath])
  })

  it('counts legacy .xls under the sheets (xlsx) filter', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shell-counts-'))
    tempDirs.push(dir)
    const bookPath = join(dir, 'book.xlsx')
    const legacyPath = join(dir, 'legacy.xls')
    const docPath = join(dir, 'notes.docx')
    writeFileSync(bookPath, 'sheet')
    writeFileSync(legacyPath, 'sheet')
    writeFileSync(docPath, 'doc')

    const page = pageRecentPaths(
      [bookPath, legacyPath, docPath],
      { ext: 'xlsx', offset: 0, limit: 50 },
      new Set(),
    )

    expect(page.total).toBe(2)
    expect(page.entries.map((entry) => entry.path)).toEqual([bookPath, legacyPath])
  })

  it('keeps unavailable paths listed at their position, flagged missing (r158)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shell-counts-'))
    tempDirs.push(dir)
    const existingPath = join(dir, 'existing.xlsx')
    const missingPath = join(dir, 'missing.xlsx')
    writeFileSync(existingPath, 'sheet')

    const page = pageRecentPaths([missingPath, existingPath], {}, new Set())

    // a transiently unstat-able file (disconnected drive, pending mount) must
    // not vanish from the list — it renders dimmed with an unavailable state
    expect(page.total).toBe(2)
    expect(page.totalAll).toBe(2)
    expect(page.entries.map((entry) => [entry.path, entry.missing === true])).toEqual([
      [missingPath, true],
      [existingPath, false],
    ])
    expect(page.entries[0].mtimeMs).toBe(0)
    expect(page.entries[0].ext).toBe('xlsx')
  })
})

describe('recent query ext normalization', () => {
  it('trims whitespace, strips leading dots, and lowercases the filter', () => {
    expect(normalizeRecentQuery({ ext: '.XLSX' }).ext).toBe('xlsx')
    expect(normalizeRecentQuery({ ext: ' xlsx ' }).ext).toBe('xlsx')
    expect(normalizeRecentQuery({ ext: '...md' }).ext).toBe('md')
    expect(normalizeRecentQuery({ ext: '...' }).ext).toBeUndefined()
    expect(normalizeRecentQuery({ ext: '' }).ext).toBeUndefined()
    expect(normalizeRecentQuery({}).ext).toBeUndefined()
  })

  it('applies the normalized filter to the page', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shell-counts-'))
    tempDirs.push(dir)
    const bookPath = join(dir, 'book.xlsx')
    writeFileSync(bookPath, 'sheet')

    const page = pageRecentPaths([bookPath], { ext: '.XLSX', limit: 50 }, new Set())
    expect(page.total).toBe(1)
    expect(page.entries.map((entry) => entry.path)).toEqual([bookPath])
  })

  it('shares the sheets/html families with the starred view (same helper)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shell-counts-'))
    tempDirs.push(dir)
    const htmPath = join(dir, 'page.htm')
    const htmlPath = join(dir, 'page.html')
    const legacyPath = join(dir, 'legacy.xls')
    writeFileSync(htmPath, 'html')
    writeFileSync(htmlPath, 'html')
    writeFileSync(legacyPath, 'sheet')
    // pageRecentPaths is the recents helper; starred now calls the same
    // matchesExtFamily, so assert the family includes both spellings
    expect(
      pageRecentPaths([htmPath, legacyPath], { ext: 'html', limit: 50 }, new Set()).total,
    ).toBe(1)
    expect(
      pageRecentPaths([htmPath, legacyPath], { ext: 'xlsx', limit: 50 }, new Set()).total,
    ).toBe(1)
    expect(pageRecentPaths([htmlPath], { ext: 'htm', limit: 50 }, new Set()).total).toBe(0)
  })
})

describe('count labels', () => {
  const translate = createI18n(strings)

  it('uses singular and plural file labels', () => {
    expect(translate('en', fileCountKey(1), { n: 1 })).toBe('1 file')
    expect(translate('en', fileCountKey(2), { n: 2 })).toBe('2 files')
  })

  it('uses singular and plural activity item labels', () => {
    expect(translate('en', timelineCountKey(1), { n: 1 })).toBe('1 item')
    expect(translate('en', timelineCountKey(2), { n: 2 })).toBe('2 items')
  })

  it('picks the singular form in every locale with plural inflection', () => {
    expect(translate('fr', fileCountKey(1), { n: 1 })).toBe('1 fichier')
    expect(translate('de', fileCountKey(1), { n: 1 })).toBe('1 Datei')
    expect(translate('zh', fileCountKey(1), { n: 1 })).toBe('1 个文件')
  })
})
