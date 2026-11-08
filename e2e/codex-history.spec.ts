import { test, expect } from '@playwright/test'
import { copyFile, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { launchShell, closeAndSaveVideo, waitForPageWithUrl } from './helpers'

// No model calls or credentials: exercise actual IPC routing, failed opening-turn
// durability, and renderer restoration against a deliberately missing runtime.
test('Codex selection and a failed opening message survive a complete app restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hermesoffice-codex-history-'))
  const doc = join(dir, 'codex-history.docx')
  await copyFile(join(__dirname, 'assets/justify-pagegap-fr.docx'), doc)
  // ai-settings sanitization drops cliPath values that are not existing files,
  // so a missing path would silently fall back to auto-detection. An existing
  // executable that exits immediately fails deterministically instead.
  const fakeCli = join(dir, 'fake-codex')
  await writeFile(fakeCli, '#!/bin/sh\nexit 1\n', { mode: 0o755 })
  await writeFile(
    join(dir, 'ai-settings.json'),
    JSON.stringify({
      provider: 'codex',
      providers: { codex: { apiKey: '', model: '', cliPath: fakeCli } },
    }),
  )
  const options = {
    userDataDir: dir,
    onboardingSeen: true,
    openFile: doc,
    videoDir: 'codex-history',
    env: { APPIMAGE: '/tmp/hermesoffice-e2e' },
  }
  const mark = (stage: string) => console.log(`[codex-history] ${stage} @${Date.now() % 100000}`)
  let launched = await launchShell(options)
  mark('launched')
  try {
    const editor = await waitForPageWithUrl(launched.app, '://docs/')
    mark('docs page')
    await expect
      .poll(() =>
        editor.evaluate(async () => (await (window as any).desktop.getAiSettings()).provider),
      )
      .toBe('codex')
    mark('provider=codex')
    await expect(editor.locator('.ProseMirror').first()).toBeVisible()
    const input = editor.locator('.ai-panel textarea')
    if (await editor.locator('.ai-rail').isVisible())
      await editor.locator('.ai-rail').click({ timeout: 15_000 })
    await expect(input).toBeVisible()
    await input.fill('Remember the failed opening marker COD-87-FAILED.', { timeout: 15_000 })
    mark('filled')
    await input.press('Enter', { timeout: 15_000 })
    mark('sent')
    await expect(editor.getByText('Codex app-server exited', { exact: false })).toBeVisible()
    mark('error shown')
    await expect(editor.locator('.ai-error-signin')).toHaveCount(0)
    // A full second process must restore the failed opening turn from disk.
    await closeAndSaveVideo(launched, 'codex-history-before')
    mark('closed')
    launched = await launchShell(options)
    mark('relaunched')
    const reopened = await waitForPageWithUrl(launched.app, '://docs/')
    mark('docs page 2')
    await expect(reopened.locator('.ProseMirror').first()).toBeVisible()
    if (await reopened.locator('.ai-rail').isVisible())
      await reopened.locator('.ai-rail').click({ timeout: 15_000 })
    await expect(
      reopened
        .locator('.ai-panel')
        .getByText('Remember the failed opening marker COD-87-FAILED.', { exact: true }),
    ).toBeVisible()
    mark('history restored')
    await expect
      .poll(() =>
        reopened.evaluate(async () => (await (window as any).desktop.getAiSettings()).provider),
      )
      .toBe('codex')
  } finally {
    await closeAndSaveVideo(launched, 'codex-history-after')
  }
})
