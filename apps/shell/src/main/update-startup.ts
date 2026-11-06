import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import type { UpdateChannel } from '../shared/update-api'
import { checkMainUpdatesNow, initMainUpdater } from './main-updater'
import { checkForUpdatesNow, initAutoUpdater } from './updater'

/** Select one update transport; source builds retain their explicit opt-in gate. */
export function initAppUpdater(
  getWindow: () => BrowserWindow | null,
  channel: UpdateChannel,
): void {
  if (!app.isPackaged || existsSync(join(process.resourcesPath, 'app-update.yml'))) {
    initAutoUpdater(getWindow, channel)
  } else {
    initMainUpdater(getWindow)
  }
}

/** Route menu checks through the transport selected for this build. */
export async function checkAppUpdatesNow(getWindow: () => BrowserWindow | null): Promise<void> {
  if (!app.isPackaged || existsSync(join(process.resourcesPath, 'app-update.yml'))) {
    await checkForUpdatesNow()
  } else if (process.env.HERMESOFFICE_ENABLE_SOURCE_UPDATE === '1') {
    await checkMainUpdatesNow(getWindow)
  } else {
    // Source updater is opt-in (PR #42) and no CDN feed is baked in, so there
    // is no self-update path — but a manual check must still answer the user
    // instead of returning silently. checkForUpdatesNow() with no active
    // updater shows the manual-download dialog.
    await checkForUpdatesNow()
  }
}
