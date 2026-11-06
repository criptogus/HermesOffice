import { join } from 'node:path'
import { BrowserWindow, ipcMain } from 'electron'
import type { QuickSwitcherState } from '../shared/quick-switcher-api'
import { QS_CHANNELS } from '../shared/quick-switcher-api'

/**
 * Quick Switcher (issue #25): a small always-on-top child window opened with
 * Cmd/Ctrl+O for Obsidian-style fuzzy file/tab switching. It cannot be a DOM
 * overlay in the shell renderer because editor tabs are sibling
 * WebContentsViews that would cover it — same reason the PDF password prompt
 * is its own window. File/tab data is fetched by the window's preload through
 * the existing home/tabs IPC channels; this module owns only the window
 * lifecycle and the one-shot localized state.
 */

let qsWin: BrowserWindow | null = null
let currentState: QuickSwitcherState | null = null
let ipcRegistered = false

function registerIpc(): void {
  if (ipcRegistered) return
  ipcRegistered = true
  ipcMain.handle(QS_CHANNELS.getState, () => currentState)
  ipcMain.handle(QS_CHANNELS.close, () => {
    if (qsWin && !qsWin.isDestroyed()) qsWin.close()
  })
}

/** Open (or refocus) the switcher. `state` carries the UI language + strings
 * resolved by the caller, which owns the main-process i18n table. */
export function openQuickSwitcher(
  parent: BrowserWindow | null,
  state: QuickSwitcherState,
): void {
  currentState = state
  registerIpc()

  if (qsWin && !qsWin.isDestroyed()) {
    qsWin.focus()
    return
  }

  const win = new BrowserWindow({
    width: 620,
    height: 420,
    ...(parent && !parent.isDestroyed() ? { parent } : {}),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: 'HermesOffice',
    webPreferences: {
      preload: join(__dirname, '../preload/quick-switcher.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  qsWin = win

  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    qsWin = null
    currentState = null
  })
  // Clicking outside the palette dismisses it (no overlay to click through)
  win.on('blur', () => {
    if (!win.isDestroyed()) win.close()
  })
  // Escape / Cmd+W inside the window also closes it (renderer sends close too)
  win.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape' || (input.meta && input.key === 'w')) {
      event.preventDefault()
      win.close()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/quick-switcher.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/quick-switcher.html'))
  }
}
