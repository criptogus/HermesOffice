#!/usr/bin/env node
/**
 * Rebrand upstream GenOffice merge for HermesOffice fork:
 * - @genoffice → @hermesoffice (npm scope)
 * - User-visible GenOffice → HermesOffice in UI/renderer HTML
 * - Genspark account strings → Hermes gateway (UI i18n only)
 * Skips NOTICE, third-party notices, and upstream attribution in README/PRIVACY.
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'out',
  'dist',
  'release',
  'target',
  'fixtures',
])

const SKIP_FILES = new Set([
  'package-lock.json',
  'NOTICE',
  'tools/rebrand-hermesoffice.mjs',
])

const UI_GLOBS = [
  'apps',
  'packages/ui/src',
  'packages/i18n/src',
]

const CREDIT_PATH_PARTS = [
  '/NOTICE',
  'third-party-notices',
  'gen-third-party-notices',
]

function shouldSkipFile(rel) {
  if (SKIP_FILES.has(path.basename(rel))) return true
  if (rel === 'README.md' || rel === 'PRIVACY.md') return true
  if (CREDIT_PATH_PARTS.some((p) => rel.includes(p))) return true
  return false
}

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(ent.name)) continue
    const full = path.join(dir, ent.name)
    const rel = path.relative(ROOT, full)
    if (ent.isDirectory()) walk(full, out)
    else out.push(rel)
  }
  return out
}

function isTextFile(rel) {
  return /\.(ts|tsx|js|mjs|cjs|json|md|html|css|yml|yaml|xml|txt|sh|py|rs|toml|mts|cts|svg)$/.test(rel)
}

function isUiPath(rel) {
  if (rel.includes('/src/renderer/') || rel.includes('shell/src/renderer/')) return true
  if (rel.endsWith('/index.html') && rel.startsWith('apps/')) return true
  if (rel.includes('/i18n/') && rel.startsWith('apps/')) return true
  if (rel.startsWith('packages/i18n/')) return true
  if (rel.startsWith('packages/ui/src/')) return true
  return false
}

function transformAll(content) {
  let s = content
  s = s.replaceAll('@genoffice/', '@hermesoffice/')
  s = s.replaceAll('"genoffice"', '"hermesoffice"')
  s = s.replaceAll("'genoffice'", "'hermesoffice'")
  if (s.includes('"name": "genoffice"')) {
    s = s.replace('"name": "genoffice"', '"name": "hermesoffice"')
  }
  s = s.replaceAll('productName": "GenOffice', 'productName": "HermesOffice')
  s = s.replaceAll("productName': 'GenOffice", "productName': 'HermesOffice")
  // electron-builder appId often uses com.genspark — keep internal id; user rarely sees it
  return s
}

function transformUi(content) {
  let s = content
  s = s.replaceAll('GenOffice', 'HermesOffice')
  // User-facing CLI / integrations copy
  s = s.replaceAll('genoffice mcp', 'hermesoffice mcp')
  s = s.replaceAll('genoffice ', 'hermesoffice ')
  s = s.replaceAll('`genoffice`', '`hermesoffice`')
  s = s.replaceAll('Genspark', 'Hermes')
  return s
}

const files = walk(ROOT).filter(isTextFile).filter((rel) => !shouldSkipFile(rel))
let changed = 0
for (const rel of files) {
  const full = path.join(ROOT, rel)
  const before = fs.readFileSync(full, 'utf8')
  let after = transformAll(before)
  if (isUiPath(rel)) after = transformUi(after)
  if (after !== before) {
    fs.writeFileSync(full, after)
    changed++
  }
}

console.log(`rebrand: updated ${changed} files`)
