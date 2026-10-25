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
  } else {
    await checkMainUpdatesNow(getWindow)
  }
}
