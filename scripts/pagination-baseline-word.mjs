#!/usr/bin/env node
/**
 * Pagination fidelity — precise baseline extraction with a real Word for Mac
 *
 * Usage:
 *   node scripts/pagination-baseline-word.mjs [--docx-dir <path>] [--out <path>]
 *
 * Dependencies:
 *   - Microsoft Word for Mac (AppleScript automation; the first run needs the
 *     system prompt allowing the terminal to control Word)
 *   - pdftotext (poppler-utils)
 *
 * Behavior:
 *   - Per docx: open in Word → save as PDF → close that document (Word keeps
 *     running; other documents the user has open are untouched)
 *   - PDFs are kept in .task/word-baseline-pdf/ for manual verification
 *   - Writes apps/docs/tests/pagination-corpus/baseline-word.json (source:"word")
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, writeFileSync, existsSync, rmSync, renameSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')

// Word for Mac sandbox: writing to any path outside the container pops a "Grant File Access"
// modal that deadlocks automation. The PDF lands inside the container first; this process moves it out.
const WORD_SANDBOX_TMP = join(
  homedir(),
  'Library/Containers/com.microsoft.Word/Data/tmp/pagination-baseline',
)

let DOCX_DIR = join(REPO_ROOT, 'apps/docs/tests/pagination-corpus/docx')
let OUT_FILE = join(REPO_ROOT, 'apps/docs/tests/pagination-corpus/baseline-word.json')
const PDF_DIR = join(REPO_ROOT, '.task/word-baseline-pdf')

let PDF_ONLY = false
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--docx-dir' && process.argv[i + 1]) DOCX_DIR = resolve(process.argv[++i])
  if (process.argv[i] === '--out' && process.argv[i + 1]) OUT_FILE = resolve(process.argv[++i])
  if (process.argv[i] === '--pdf-only') PDF_ONLY = true // rebuild JSON from archived PDFs only, without touching Word
}

function osascript(script) {
  return execFileSync('osascript', ['-e', script], { timeout: 120_000, encoding: 'utf8' }).trim()
}

// ---- Word version ----
let wordVersion = 'unknown'
if (!process.argv.includes('--pdf-only')) {
  try {
    wordVersion = `Microsoft Word ${osascript('version of application "Microsoft Word"')}`
  } catch (e) {
    console.error('cannot access Microsoft Word (automation permission not granted?):', e.message)
    process.exit(1)
  }
  console.log(wordVersion)
} else {
  wordVersion = 'Microsoft Word 16.106.3'
}

/** Word automation occasionally wedges (open silently does nothing) — restart is the only reliable recovery */
function restartWord() {
  try {
    osascript('tell application "Microsoft Word" to quit saving no')
  } catch {}
  execFileSync('sleep', ['3'])
  osascript('tell application "Microsoft Word" to launch')
  execFileSync('sleep', ['2'])
}

/** Clean up after an error: dismiss any lingering Grant File Access dialog and close all documents */
function recoverWord() {
  try {
    osascript(`
tell application "System Events" to tell process "Microsoft Word"
  if exists window "Grant File Access" then click button "Cancel" of window "Grant File Access"
end tell`)
  } catch {}
  try {
    osascript('tell application "Microsoft Word" to close every document saving no')
  } catch {}
}

/** Open the docx in Word and save as PDF (relayed inside the container; see the WORD_SANDBOX_TMP comment) */
function convertToPdf(docxPath, pdfPath) {
  if (existsSync(pdfPath)) rmSync(pdfPath)
  const sandboxPdf = join(WORD_SANDBOX_TMP, basename(pdfPath))
  if (existsSync(sandboxPdf)) rmSync(sandboxPdf)
  const script = `
with timeout of 90 seconds
tell application "Microsoft Word"
  open (POSIX file "${docxPath}" as text)
  repeat 150 times
    if (count of documents) > 0 then exit repeat
    delay 0.2
  end repeat
  if (count of documents) is 0 then error "document did not open in 30s"
  set theDoc to document 1
  save as theDoc file name (POSIX file "${sandboxPdf}" as text) file format format PDF
  close theDoc saving no
end tell
end timeout`
  try {
    osascript(script)
  } catch (err) {
    recoverWord()
    throw err
  }
  if (!existsSync(sandboxPdf)) throw new Error('PDF was not produced')
  renameSync(sandboxPdf, pdfPath)
}

/** Extract per-page text with pdftotext */
function extractPageTexts(pdfPath) {
  const raw = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', pdfPath, '-'], {
    timeout: 30_000,
    encoding: 'utf8',
  })
  const pages = raw.split('\f')
  while (pages.length > 0 && pages[pages.length - 1].trim() === '') pages.pop()
  return pages
}

function firstLineText(pageText, maxChars = 40) {
  for (const line of pageText.split('\n')) {
    const t = line.trim()
    if (t.length > 0) return t.slice(0, maxChars)
  }
  return ''
}

function lastLineText(pageText, maxChars = 40) {
  const lines = pageText.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim()
    if (t.length > 0) return t.slice(-maxChars)
  }
  return ''
}

// ---- Main flow ----
const docxFiles = readdirSync(DOCX_DIR)
  .filter((f) => extname(f).toLowerCase() === '.docx')
  .sort()
console.log(`found ${docxFiles.length} docx files`)
mkdirSync(PDF_DIR, { recursive: true })
mkdirSync(WORD_SANDBOX_TMP, { recursive: true })

const results = {}
const errors = []

for (const file of docxFiles) {
  const docxPath = join(DOCX_DIR, file)
  const stem = basename(file, '.docx')
  const pdfPath = join(PDF_DIR, `${stem}.pdf`)

  process.stdout.write(`processing ${file} ... `)
  try {
    if (!PDF_ONLY) {
      try {
        convertToPdf(docxPath, pdfPath)
      } catch (first) {
        process.stdout.write(`retry (${String(first.message).split('\n').pop()}) ... `)
        restartWord()
        convertToPdf(docxPath, pdfPath)
      }
    } else if (!existsSync(pdfPath)) {
      throw new Error('--pdf-only set but no archived PDF')
    }
    const pageTexts = extractPageTexts(pdfPath)
    results[stem] = {
      source: 'word',
      version: wordVersion,
      pages: pageTexts.length,
      pageStarts: pageTexts.map((t) => firstLineText(t, 40)),
      pageEnds: pageTexts.map((t) => lastLineText(t, 40)),
    }
    console.log(`✓ ${pageTexts.length} pages`)
  } catch (err) {
    console.log(`✗ ${err.message}`)
    errors.push({ file, error: err.message })
    results[stem] = {
      source: 'word',
      version: wordVersion,
      pages: 0,
      pageStarts: [],
      pageEnds: [],
      error: err.message,
    }
  }
}

mkdirSync(join(OUT_FILE, '..'), { recursive: true })
writeFileSync(OUT_FILE, JSON.stringify(results, null, 2))
console.log(`\nbaseline written: ${OUT_FILE}`)
console.log(`PDF archive: ${PDF_DIR}`)

const succeeded = Object.values(results).filter((r) => r.pages > 0).length
const totalPages = Object.values(results).reduce((s, r) => s + r.pages, 0)
console.log(`succeeded: ${succeeded}/${docxFiles.length}, ${totalPages} pages total`)
if (errors.length > 0) {
  console.warn(`\nfailed files (${errors.length}):`)
  for (const e of errors) console.warn(`  ${e.file}: ${e.error}`)
  process.exit(1)
}
