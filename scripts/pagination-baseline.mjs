#!/usr/bin/env node
/**
 * Pagination fidelity F0 — LibreOffice headless baseline extraction
 *
 * Usage:
 *   node scripts/pagination-baseline.mjs [--docx-dir <path>] [--out <path>]
 *
 * Dependencies:
 *   - soffice (already installed locally, LO headless)
 *   - pdftotext (poppler-utils, already installed locally)
 *
 * Output: apps/docs/tests/pagination-corpus/baseline-lo.json
 *   {
 *     "<stem>": {
 *       source: "libreoffice",
 *       version: "LO version string",
 *       pages: N,
 *       pageStarts: ["first 40 chars of each page's first line", ...],
 *       pageEnds:   ["last 40 chars of each page's last line", ...]  // reserved field
 *     }
 *   }
 *
 * Note: LO layout != Word; the baseline is tagged source:"libreoffice".
 *       When a precise Word baseline coexists later, the field structure stays the same
 *       and only the source value changes to "word".
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')

// ---- Argument parsing ----
let DOCX_DIR = join(REPO_ROOT, 'apps/docs/tests/pagination-corpus/docx')
let OUT_FILE = join(REPO_ROOT, 'apps/docs/tests/pagination-corpus/baseline-lo.json')

for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--docx-dir' && process.argv[i + 1]) DOCX_DIR = resolve(process.argv[++i])
  if (process.argv[i] === '--out' && process.argv[i + 1]) OUT_FILE = resolve(process.argv[++i])
}

// ---- LO version ----
let loVersion = 'unknown'
try {
  loVersion = execFileSync('soffice', ['--version'], { encoding: 'utf8' }).trim()
} catch (_) {
  /* ignore */
}
console.log(`LibreOffice: ${loVersion}`)

// ---- List docx files ----
const docxFiles = readdirSync(DOCX_DIR)
  .filter((f) => extname(f).toLowerCase() === '.docx')
  .sort()

console.log(`found ${docxFiles.length} docx files`)

// ---- Work directory ----
const WORK_DIR = join(tmpdir(), `pagination-baseline-${Date.now()}`)
mkdirSync(WORK_DIR, { recursive: true })

/** Convert docx to PDF with soffice headless; returns the PDF path */
function convertToPdf(docxPath, outDir) {
  execFileSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', outDir, docxPath], {
    timeout: 60_000,
    stdio: 'pipe',
  })
  const stem = basename(docxPath, extname(docxPath))
  return join(outDir, `${stem}.pdf`)
}

/** Extract PDF text with pdftotext; returns an array of per-page texts */
function extractPageTexts(pdfPath) {
  // -layout keeps layout whitespace, -enc UTF-8
  const raw = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', pdfPath, '-'], {
    timeout: 30_000,
    encoding: 'utf8',
  })
  // pdftotext separates pages with \f (Form Feed, 0x0C)
  const pages = raw.split('\f')
  // drop trailing empty pages
  while (pages.length > 0 && pages[pages.length - 1].trim() === '') pages.pop()
  return pages
}

/** Extract the first 40 chars of a page's first (non-empty) line */
function firstLineText(pageText, maxChars = 40) {
  const lines = pageText.split('\n')
  for (const line of lines) {
    const t = line.trim()
    if (t.length > 0) return t.slice(0, maxChars)
  }
  return ''
}

/** Extract the last 40 chars of a page's last (non-empty) line */
function lastLineText(pageText, maxChars = 40) {
  const lines = pageText.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim()
    if (t.length > 0) return t.slice(-maxChars)
  }
  return ''
}

// ---- Per-file processing ----
const results = {}
const errors = []

for (const file of docxFiles) {
  const docxPath = join(DOCX_DIR, file)
  const stem = basename(file, '.docx')
  const fileWorkDir = join(WORK_DIR, stem)
  mkdirSync(fileWorkDir, { recursive: true })

  process.stdout.write(`processing ${file} ... `)
  try {
    // 1. convert to PDF
    const pdfPath = convertToPdf(docxPath, fileWorkDir)
    if (!existsSync(pdfPath)) throw new Error(`PDF was not produced: ${pdfPath}`)

    // 2. extract text
    const pageTexts = extractPageTexts(pdfPath)
    const pages = pageTexts.length

    // 3. first/last line per page
    const pageStarts = pageTexts.map((t) => firstLineText(t, 40))
    const pageEnds = pageTexts.map((t) => lastLineText(t, 40))

    results[stem] = {
      source: 'libreoffice',
      version: loVersion,
      pages,
      pageStarts,
      pageEnds,
    }
    console.log(`✓ ${pages} pages`)
  } catch (err) {
    console.log(`✗ ${err.message}`)
    errors.push({ file, error: err.message })
    results[stem] = {
      source: 'libreoffice',
      version: loVersion,
      pages: 0,
      pageStarts: [],
      pageEnds: [],
      error: err.message,
    }
  }
}

// ---- Clean up the temp directory ----
try {
  rmSync(WORK_DIR, { recursive: true, force: true })
} catch (_) {}

// ---- Write JSON ----
mkdirSync(join(OUT_FILE, '..'), { recursive: true })
writeFileSync(OUT_FILE, JSON.stringify(results, null, 2))
console.log(`\nbaseline written: ${OUT_FILE}`)

// ---- Summary ----
const succeeded = Object.values(results).filter((r) => r.pages > 0).length
const totalPages = Object.values(results).reduce((s, r) => s + r.pages, 0)
console.log(`succeeded: ${succeeded}/${docxFiles.length}, ${totalPages} pages total`)
if (errors.length > 0) {
  console.warn(`\nfailed files (${errors.length}):`)
  for (const e of errors) console.warn(`  ${e.file}: ${e.error}`)
  process.exit(1)
}
