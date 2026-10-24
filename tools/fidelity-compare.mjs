/**
 * pptx rendering fidelity comparison pipeline.
 *
 * Reference side: LibreOffice headless export to PDF → pdftoppm PNG per page (96dpi, 16:9 → 1280×720).
 *   (AppleScript batch export in the new PowerPoint for Mac is broken; LibreOffice serves as
 *   the automatable reference renderer, with PowerPoint used for manual spot checks.)
 * Our side: playwright drives the packaged HermesOffice Slides (Electron) with zoom locked at 100%,
 *   clicks through the thumbnails page by page, and screenshots the canvas element .stage-rel.
 * Compare: pixelmatch per-pixel diff (bilinear-scaled to the same size first), emitting a side-by-side HTML report.
 *
 * Usage: node tools/fidelity-compare.mjs <a.pptx> [b.pptx …] [--max-slides N] [--out DIR]
 * Prereq: npm run build -w @hermesoffice/slides; brew: libreoffice + poppler (pdftoppm).
 */
/* global document, MouseEvent -- used inside page.evaluate() browser context */
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const ELECTRON_BIN = path.join(
  ROOT,
  'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
)
const APP_DIR = path.join(ROOT, 'apps/slides')

const args = process.argv.slice(2)
const files = []
let maxSlides = 12
let outDir = '/tmp/fidelity/run'
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--max-slides') maxSlides = parseInt(args[++i], 10)
  else if (args[i] === '--out') outDir = args[++i]
  else files.push(path.resolve(args[i]))
}
if (!files.length) {
  console.error('usage: node tools/fidelity-compare.mjs <a.pptx> … [--max-slides N] [--out DIR]')
  process.exit(1)
}
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** LibreOffice → PDF → PNG per page; returns the array of png paths. */
function exportRef(pptx, dir) {
  fs.mkdirSync(dir, { recursive: true })
  execFileSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', dir, pptx], {
    stdio: 'pipe',
    timeout: 120_000,
  })
  const pdf = path.join(dir, path.basename(pptx).replace(/\.pptx$/i, '.pdf'))
  if (!fs.existsSync(pdf)) throw new Error('soffice produced no pdf: ' + pdf)
  execFileSync('pdftoppm', ['-png', '-r', '96', pdf, path.join(dir, 'ref')], { stdio: 'pipe' })
  return fs
    .readdirSync(dir)
    .filter((f) => /^ref-\d+\.png$/.test(f))
    .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10))
    .map((f) => path.join(dir, f))
}

/**
 * Opens HermesOffice Slides and, page by page, composites the main canvas's Konva layers into a PNG
 * (in-page toDataURL, unaffected by window size/zoom/DPR; output = slide logical pixels 1280×720).
 */
async function shootOurs(pptx, dir, nSlides) {
  fs.mkdirSync(dir, { recursive: true })
  const app = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: [APP_DIR, pptx],
    timeout: 30_000,
  })
  try {
    const page =
      app.windows().find((w) => !w.url().startsWith('devtools://')) ?? (await app.firstWindow())
    // wait for the open to finish (thumbnails appear)
    for (let i = 0; i < 60; i++) {
      const n = await page.evaluate(() => document.querySelectorAll('.thumb').length)
      if (n > 0) break
      await sleep(500)
    }
    const total = await page.evaluate(() => document.querySelectorAll('.thumb').length)
    const shots = []
    for (let i = 0; i < Math.min(total, nSlides); i++) {
      await page.evaluate((idx) => {
        const thumbs = document.querySelectorAll('.thumb')
        thumbs[idx]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      }, i)
      await sleep(600) // wait for image decode / repaint
      const dataUrl = await page.evaluate(() => {
        const stage = document.querySelector('.stage-rel')
        if (!stage) return null
        const canvases = [...stage.querySelectorAll('canvas')]
        if (!canvases.length) return null
        const w = stage.clientWidth
        const h = stage.clientHeight
        const out = document.createElement('canvas')
        out.width = w
        out.height = h
        const ctx = out.getContext('2d')
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, w, h)
        for (const c of canvases) ctx.drawImage(c, 0, 0, w, h)
        return out.toDataURL('image/png')
      })
      if (!dataUrl) throw new Error('canvas compositing failed (slide ' + (i + 1) + ')')
      const f = path.join(dir, `ours-${i + 1}.png`)
      fs.writeFileSync(f, Buffer.from(dataUrl.split(',')[1], 'base64'))
      shots.push(f)
    }
    return shots
  } finally {
    await app.close().catch(() => {})
  }
}

/** RGBA bilinear scaling. */
function resize(png, w, h) {
  const out = new PNG({ width: w, height: h })
  for (let y = 0; y < h; y++) {
    const sy = (y * png.height) / h
    const y0 = Math.min(Math.floor(sy), png.height - 1)
    const y1 = Math.min(y0 + 1, png.height - 1)
    const fy = sy - y0
    for (let x = 0; x < w; x++) {
      const sx = (x * png.width) / w
      const x0 = Math.min(Math.floor(sx), png.width - 1)
      const x1 = Math.min(x0 + 1, png.width - 1)
      const fx = sx - x0
      for (let c = 0; c < 4; c++) {
        const p00 = png.data[(y0 * png.width + x0) * 4 + c]
        const p01 = png.data[(y0 * png.width + x1) * 4 + c]
        const p10 = png.data[(y1 * png.width + x0) * 4 + c]
        const p11 = png.data[(y1 * png.width + x1) * 4 + c]
        out.data[(y * w + x) * 4 + c] =
          p00 * (1 - fx) * (1 - fy) + p01 * fx * (1 - fy) + p10 * (1 - fx) * fy + p11 * fx * fy
      }
    }
  }
  return out
}

function diffPair(refPath, oursPath, diffPath) {
  const ref = PNG.sync.read(fs.readFileSync(refPath))
  let ours = PNG.sync.read(fs.readFileSync(oursPath))
  if (ours.width !== ref.width || ours.height !== ref.height)
    ours = resize(ours, ref.width, ref.height)
  const diff = new PNG({ width: ref.width, height: ref.height })
  const bad = pixelmatch(ref.data, ours.data, diff.data, ref.width, ref.height, { threshold: 0.18 })
  fs.writeFileSync(diffPath, PNG.sync.write(diff))
  return bad / (ref.width * ref.height)
}

const rows = []
for (const pptx of files) {
  const name = path.basename(pptx).replace(/\.pptx$/i, '')
  const deckDir = path.join(outDir, name)
  console.log(`\n=== ${name} ===`)
  let refs
  try {
    refs = exportRef(pptx, path.join(deckDir, 'ref'))
  } catch (e) {
    console.error('reference export failed:', e.message)
    continue
  }
  const n = Math.min(refs.length, maxSlides)
  const ours = await shootOurs(pptx, path.join(deckDir, 'ours'), n)
  for (let i = 0; i < Math.min(n, ours.length); i++) {
    const diffPath = path.join(deckDir, `diff-${i + 1}.png`)
    const pct = diffPair(refs[i], ours[i], diffPath)
    rows.push({ deck: name, slide: i + 1, pct, ref: refs[i], ours: ours[i], diff: diffPath })
    console.log(`  slide ${i + 1}: mismatch ${(pct * 100).toFixed(1)}%`)
  }
}

// HTML report
const rel = (p) => path.relative(outDir, p)
const html = `<!doctype html><meta charset="utf-8"><title>pptx fidelity comparison</title>
<style>body{font:13px -apple-system,sans-serif;margin:16px;background:#f6f6f8}
h2{margin:24px 0 8px}table{border-collapse:collapse}td{padding:4px;vertical-align:top;text-align:center}
img{width:420px;border:1px solid #ccc;background:#fff}
.pct{font-weight:600}.bad{color:#c00}.ok{color:#080}</style>
<h1>pptx fidelity comparison (reference: LibreOffice)</h1>
${rows
  .map(
    (r) => `
<h2>${r.deck} · slide ${r.slide} · <span class="pct ${r.pct > 0.08 ? 'bad' : 'ok'}">${(r.pct * 100).toFixed(1)}% mismatch</span></h2>
<table><tr><td>reference<br><img src="${rel(r.ref)}"></td><td>HermesOffice Slides<br><img src="${rel(r.ours)}"></td><td>diff<br><img src="${rel(r.diff)}"></td></tr></table>`,
  )
  .join('')}
`
fs.writeFileSync(path.join(outDir, 'report.html'), html)
console.log('\nreport →', path.join(outDir, 'report.html'))
const worst = [...rows].sort((a, b) => b.pct - a.pct).slice(0, 8)
console.log('worst slides:')
for (const r of worst) console.log(`  ${r.deck} #${r.slide}: ${(r.pct * 100).toFixed(1)}%`)
