import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import type { UpdateChannel } from '../shared/update-api'
import { initMainUpdater } from './main-updater'
import { initAutoUpdater } from './updater'

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
