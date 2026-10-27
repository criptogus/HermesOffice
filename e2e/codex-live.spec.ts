import { test, expect, type Page } from '@playwright/test'
import { copyFile, mkdtemp, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { launchShell, closeAndSaveVideo, waitForPageWithUrl, type LaunchedApp } from './helpers'

// Explicit opt-in: uses the signed-in local Codex account and consumes model
// usage. Always isolated from the user's documents and Office settings.
test('live Codex: two Docs conversations remain isolated after a full process restart', async () => {
  test.skip(process.env.HERMESOFFICE_CODEX_LIVE !== '1', 'Requires explicit live-model opt-in')
  test.setTimeout(360_000)
  const dir = await mkdtemp(join(tmpdir(), 'hermesoffice-codex-live-'))
  await writeFile(
    join(dir, 'ai-settings.json'),
    JSON.stringify({
      provider: 'codex',
      providers: {
        codex: { apiKey: '', model: '', cliPath: process.env.HERMESOFFICE_CODEX_CLI ?? '' },
      },
    }),
  )
  const docs = [join(dir, 'Codex-A.docx'), join(dir, 'Codex-B.docx')]
  for (const doc of docs) await copyFile(join(__dirname, 'assets/justify-pagegap-fr.docx'), doc)
  const markers = ['ORION-4729', 'PAVAO-8361']
  const options = {
    userDataDir: dir,
    onboardingSeen: true,
    openFile: docs[0],
    videoDir: 'codex-live',
    ...(process.env.HERMESOFFICE_TEST_EXECUTABLE
      ? { executablePath: process.env.HERMESOFFICE_TEST_EXECUTABLE }
      : {}),
    env: {
      HERMESOFFICE_AUTH_DIR: join(dir, 'auth'),
      APPIMAGE: '/tmp/hermesoffice-live-validation',
      HERMESOFFICE_ENABLE_SOURCE_UPDATE: '0',
    },
  }
  const observations: unknown[] = []
  const ask = async (page: Page, prompt: string) => {
    const prior = await page.locator('.ai-msg-assistant').count()
    await page.locator('.ai-panel textarea').fill(prompt)
    await page.locator('.ai-panel textarea').press('Enter')
    await expect(page.locator('.ai-msg-assistant')).toHaveCount(prior + 1, { timeout: 60_000 })
    await expect(page.locator('.ai-msg-assistant').last()).not.toHaveClass(/ai-msg-streaming/, {
      timeout: 90_000,
    })
    await expect(page.locator('.ai-msg-error')).toHaveCount(0)
    return (await page.locator('.ai-msg-assistant').last().innerText()).trim()
  }
  const openPair = async (launched: LaunchedApp) => {
    launched.page = await waitForPageWithUrl(launched.app, '/out/renderer/index.html')
    const a = await waitForPageWithUrl(launched.app, '://docs/')
    await expect(a.locator('.ProseMirror').first()).toBeVisible()
    const old = new Set(launched.app.windows())
    await launched.page.evaluate((path) => window.aiOffice.openPath(path), docs[1]!)
    let b: Page | undefined
    await expect
      .poll(() => {
        b = launched.app.windows().find((p) => !old.has(p) && p.url().includes('://docs/'))
        return !!b
      })
      .toBe(true)
    await expect(b!.locator('.ProseMirror').first()).toBeVisible()
    return [a, b!] as const
  }
  let launched = await launchShell(options)
  const firstPid = launched.app.process().pid
  try {
    let pages = await openPair(launched)
    const initialSessions = await Promise.all(
      docs.map((path) =>
        pages[0].evaluate(
          (filePath) => window.projectApi.resolveChat({ filePath, tempChatId: 'unused' }),
          path,
        ),
      ),
    )
    for (const i of [0, 1]) {
      await launched.page
        .locator('.tab-item')
        .filter({ hasText: basename(docs[i]!) })
        .click()
      const reply = await ask(
        pages[i]!,
        `Remember my private chat-only marker ${markers[i]}. Do not write it into the document. Reply with only that marker.`,
      )
      expect(reply).toContain(markers[i])
      expect(reply).not.toContain(markers[1 - i])
      observations.push({ phase: 'initial', document: basename(docs[i]!), reply })
    }
    await launched.page
      .locator('.tab-item')
      .filter({ hasText: basename(docs[0]!) })
      .click()
    expect(
      await ask(pages[0], 'What is my chat-only marker? Reply with only the marker.'),
    ).toContain(markers[0])
    await closeAndSaveVideo(launched, 'codex-live-before-restart')
    launched = await launchShell(options)
    expect(launched.app.process().pid).not.toBe(firstPid)
    pages = await openPair(launched)
    for (const i of [0, 1]) {
      await launched.page
        .locator('.tab-item')
        .filter({ hasText: basename(docs[i]!) })
        .click()
      await expect(pages[i]!.locator('.ai-msg-historic.ai-msg-user').first()).toContainText(
        markers[i],
      )
      const reply = await ask(
        pages[i]!,
        'What is my chat-only marker from our previous conversation? Reply with only that marker.',
      )
      expect(reply).toContain(markers[i])
      expect(reply).not.toContain(markers[1 - i])
      observations.push({ phase: 'after-restart', document: basename(docs[i]!), reply })
      await pages[i]!.screenshot({ path: join(dir, `after-restart-${i}.png`) })
    }
    const sessions = await Promise.all(
      docs.map((path) =>
        pages[0].evaluate(
          (filePath) => window.projectApi.resolveChat({ filePath, tempChatId: 'unused' }),
          path,
        ),
      ),
    )
    expect(sessions[0]!.chatId).not.toBe(sessions[1]!.chatId)
    expect(sessions).toEqual(initialSessions)
    await pages[1]
      .locator('.ai-panel textarea')
      .fill(
        'Use the document editing tools to append one new final paragraph containing exactly: Codex controlled edit verified. Preserve all existing content.',
      )
    await pages[1].locator('.ai-panel textarea').press('Enter')
    await expect(
      pages[1]
        .locator('.ProseMirror')
        .filter({ hasText: 'Codex controlled edit verified.' })
        .first(),
    ).toBeVisible({ timeout: 90_000 })
    await expect(pages[1].locator('.ai-stop-btn')).toHaveCount(0, { timeout: 90_000 })
    await pages[1].locator('.ai-rollback-btn').last().click()
    await expect(
      pages[1].locator('.ProseMirror').filter({ hasText: 'Codex controlled edit verified.' }),
    ).toHaveCount(0)
    observations.push({ controlledEdit: true, rollback: true })
    observations.push({
      firstPid,
      secondPid: launched.app.process().pid,
      sessions,
      appVersion: await launched.app.evaluate(({ app }) => app.getVersion()),
    })
    const report = { ok: true, userDataDir: dir, docs, markers, observations }
    await writeFile(join(dir, 'live-result.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
    if (process.env.HERMESOFFICE_CODEX_REPORT)
      await writeFile(process.env.HERMESOFFICE_CODEX_REPORT, JSON.stringify(report, null, 2))
  } finally {
    await closeAndSaveVideo(launched, 'codex-live-after-restart')
  }
})
