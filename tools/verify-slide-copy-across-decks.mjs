// End-to-end check for Copy Slide / Paste Slide across two open decks: opens deck A
// in the shell, opens deck B in a second tab, copies A's first slide, pastes it into
// B, saves B, and reports what landed on disk.
import { copyFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright-core'

const fixtures = 'packages/pptx-engine/tests/fixtures'
const work = mkdtempSync(join(tmpdir(), 'slide-copy-'))
const deckA = join(work, 'deckA.pptx')
const deckB = join(work, 'deckB.pptx')
copyFileSync(join(fixtures, '05_unicode_cjk_emoji.pptx'), deckA)
copyFileSync(join(fixtures, '01_standard_business.pptx'), deckB)

const app = await electron.launch({
  args: ['apps/shell', deckA],
  env: { ...process.env, HERMESOFFICE_USER_DATA: join(work, 'userData') },
})
await app.firstWindow()

const shellView = () =>
  app.evaluate(
    ({ webContents }) =>
      webContents.getAllWebContents().find((w) => /shell\/out\/renderer/.test(w.getURL()))?.id ??
      null,
  )

const slideViews = () =>
  app.evaluate(({ webContents }) =>
    webContents
      .getAllWebContents()
      .filter((w) => /slides\/out\/renderer/.test(w.getURL()))
      .map((w) => w.id)
      .sort((a, b) => a - b),
  )

const waitFor = async (predicate, label, tries = 40) => {
  for (let i = 0; i < tries; i += 1) {
    const value = await predicate()
    if (value) return value
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`timed out waiting for ${label}`)
}

const run = (wcId, code) =>
  app.evaluate(
    async ({ webContents }, [id, script]) => {
      const wc = webContents.fromId(id)
      if (!wc) return 'no-view'
      try {
        return await wc.executeJavaScript(script, true)
      } catch (error) {
        return `eval-error: ${String(error).slice(0, 200)}`
      }
    },
    [wcId, code],
  )

await waitFor(async () => (await slideViews()).length >= 1, 'deck A slides view')
await new Promise((r) => setTimeout(r, 6000))

const shellId = await waitFor(shellView, 'shell renderer')
console.log(
  'open deck B in a second tab:',
  await run(shellId, `window.aiOffice.openPath(${JSON.stringify(deckB)})`),
)
const views = await waitFor(async () => {
  const ids = await slideViews()
  return ids.length >= 2 ? ids : null
}, 'deck B slides view')
await new Promise((r) => setTimeout(r, 8000))

const [viewA, viewB] = views
console.log('slide counts before:', {
  a: await run(viewA, `document.querySelectorAll('[data-slide-thumb]').length`),
})
console.log('copy from deck A:', await run(viewA, `window.slidesApi.copySlide(0)`))
console.log(
  'clipboard visible to deck B:',
  await run(viewB, `window.slidesApi.hasSlideClipboard()`),
)
console.log(
  'paste into deck B:',
  await run(
    viewB,
    `window.slidesApi.pasteSlide({ afterIndex: 0, fitWidthPx: 960 }).then(r => r ? { index: r.index, slides: r.slides.length } : null)`,
  ),
)
await new Promise((r) => setTimeout(r, 3000))
console.log('save deck B:', JSON.stringify(await run(viewB, `window.slidesApi.save()`)))
await new Promise((r) => setTimeout(r, 3000))
console.log('deck B path:', deckB)
await app.close()
