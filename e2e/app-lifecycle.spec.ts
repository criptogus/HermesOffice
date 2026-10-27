import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import { launchShell, waitForPageWithUrl } from './helpers'

// A completed quit must release the process, not only close the last window.
test('quitting a clean Docs tab exits the app process', async () => {
  const launched = await launchShell({
    onboardingSeen: true,
    openFile: join(__dirname, 'assets/justify-pagegap-fr.docx'),
    videoDir: 'app-lifecycle',
    env: { HERMESOFFICE_NO_SPARE_VIEW: '0', APPIMAGE: 'hermesoffice-lifecycle-test' },
  })
  const child = launched.app.process()
  try {
    const docs = await waitForPageWithUrl(launched.app, '://docs/')
    await expect(docs.locator('.ProseMirror').first()).toBeVisible()
    await launched.app
      .evaluate(({ app }) => {
        app.quit()
      })
      .catch(() => {})
    await expect
      .poll(() => child.exitCode !== null || child.signalCode !== null, { timeout: 5_000 })
      .toBe(true)
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
})

for (const finish of ['quit', 'close-window'] as const) {
  test(`cancelling quit preserves the document before a later ${finish}`, async () => {
    test.skip(
      finish === 'close-window' && process.platform !== 'darwin',
      'macOS window-close behavior',
    )
    const launched = await launchShell({
      onboardingSeen: true,
      videoDir: 'cancel-quit',
      env: { APPIMAGE: 'hermesoffice-lifecycle-test' },
    })
    const child = launched.app.process()
    try {
      await launched.page.locator('.quick-card').first().click()
      const docs = await waitForPageWithUrl(launched.app, '://docs/')
      await docs
        .locator('.ProseMirror')
        .first()
        .pressSequentially('Keep this unsaved text after cancelling quit.')
      await launched.app.evaluate(({ app, dialog }) => {
        ;(globalThis as any).__closePromptCount = 0
        dialog.showMessageBox = (async () => {
          const count = ++(globalThis as any).__closePromptCount
          return { response: count === 1 ? 2 : 1, checkboxChecked: false }
        }) as typeof dialog.showMessageBox
        app.quit()
      })
      await expect
        .poll(() => launched.app.evaluate(() => (globalThis as any).__closePromptCount))
        .toBe(1)
      await expect(docs.locator('.ProseMirror').first()).toContainText(
        'Keep this unsaved text after cancelling quit.',
      )
      expect(child.exitCode).toBeNull()
      if (finish === 'close-window') {
        await launched.app.evaluate(({ BrowserWindow }) => {
          BrowserWindow.getAllWindows()
            .find((win) => win.isVisible())!
            .close()
        })
        await expect
          .poll(() =>
            launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
          )
          .toBe(0)
        expect(child.exitCode).toBeNull()
      }
      await launched.app
        .evaluate(({ app }) => {
          app.quit()
        })
        .catch(() => {})
      await expect
        .poll(() => child.exitCode !== null || child.signalCode !== null, { timeout: 5_000 })
        .toBe(true)
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
  })
}

test('closing a clean window on macOS keeps the app available without turning it into Quit', async () => {
  test.skip(process.platform !== 'darwin', 'macOS keeps an app alive without windows')
  const launched = await launchShell({
    onboardingSeen: true,
    openFile: join(__dirname, 'assets/justify-pagegap-fr.docx'),
    videoDir: 'window-close',
    env: { APPIMAGE: 'hermesoffice-lifecycle-test' },
  })
  const child = launched.app.process()
  try {
    const docs = await waitForPageWithUrl(launched.app, '://docs/')
    await expect(docs.locator('.ProseMirror').first()).toBeVisible()
    await launched.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((win) => win.isVisible())!
        .close()
    })
    await expect
      .poll(() =>
        launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
      )
      .toBe(0)
    expect(child.exitCode).toBeNull()
    await launched.app
      .evaluate(({ app }) => {
        app.quit()
      })
      .catch(() => {})
    await expect
      .poll(() => child.exitCode !== null || child.signalCode !== null, { timeout: 5_000 })
      .toBe(true)
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
})
