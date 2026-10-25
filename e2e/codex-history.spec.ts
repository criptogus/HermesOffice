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
  await writeFile(
    join(dir, 'ai-settings.json'),
    JSON.stringify({
      provider: 'codex',
      providers: { codex: { apiKey: '', model: '', cliPath: join(dir, 'missing-codex') } },
    }),
  )
  const options = {
    userDataDir: dir,
    onboardingSeen: true,
    openFile: doc,
    videoDir: 'codex-history',
    env: { APPIMAGE: '/tmp/hermesoffice-e2e' },
  }
  let launched = await launchShell(options)
  try {
    const editor = await waitForPageWithUrl(launched.app, '://docs/')
    await expect
      .poll(() =>
        editor.evaluate(async () => (await (window as any).desktop.getAiSettings()).provider),
      )
      .toBe('codex')
    await expect(editor.locator('.ProseMirror').first()).toBeVisible()
    const input = editor.locator('.ai-panel textarea')
    if (await editor.locator('.ai-rail').isVisible()) await editor.locator('.ai-rail').click()
    await expect(input).toBeVisible()
    await input.fill('Remember the failed opening marker COD-87-FAILED.')
    await input.press('Enter')
    await expect(
      editor.getByText('Configured Codex CLI was not found.', { exact: false }),
    ).toBeVisible()
    await expect(editor.locator('.ai-error-signin')).toHaveCount(0)
    // A full second process must restore the failed opening turn from disk.
    await closeAndSaveVideo(launched, 'codex-history-before')
    launched = await launchShell(options)
    const reopened = await waitForPageWithUrl(launched.app, '://docs/')
    await expect(reopened.locator('.ProseMirror').first()).toBeVisible()
    if (await reopened.locator('.ai-rail').isVisible()) await reopened.locator('.ai-rail').click()
    await expect(
      reopened
        .locator('.ai-panel')
        .getByText('Remember the failed opening marker COD-87-FAILED.', { exact: true }),
    ).toBeVisible()
    await expect
      .poll(() =>
        reopened.evaluate(async () => (await (window as any).desktop.getAiSettings()).provider),
      )
      .toBe('codex')
  } finally {
    await closeAndSaveVideo(launched, 'codex-history-after')
  }
})
