/**
 * Share window: a small frameless modal card (same visual language as the
 * auto-update window) where the user picks a delivery channel, types an
 * optional message and sends the current document through the Hermes CLI.
 *
 * Content lives in the shell renderer (share.html) with a dedicated preload
 * (share.ts); this module owns the window lifecycle only.
 */

import { join } from 'node:path'
import { basename } from 'node:path'
import { BrowserWindow } from 'electron'
import { setShareWindowState } from './ipc'
import type { ShareWindowState } from './types'

interface ShareWindowOptions {
  /** window the modal is attached to; the shell window in practice */
  parent: BrowserWindow | null
  /** absolute path of the document to share; undefined for unsaved tabs */
  filePath?: string
  /** localized window strings (owner of UI language is the main process) */
  state: ShareWindowState
}

let shareWin: BrowserWindow | null = null

export function openShareWindow(options: ShareWindowOptions): void {
  const { parent, filePath, state } = options

  // the window asks for its state after load; stash it (with the filename)
  // until then — and keep it for the send handler, which injects filePath
  setShareWindowState({
    ...state,
    filePath,
    fileName: filePath ? basename(filePath) : undefined,
  })

  if (shareWin && !shareWin.isDestroyed()) {
    shareWin.focus()
    return
  }

  const win = new BrowserWindow({
    width: 420,
    height: 430,
    ...(parent && !parent.isDestroyed() ? { parent, modal: true } : {}),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: state.strings.title,
    webPreferences: {
      preload: join(__dirname, '../preload/share.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  shareWin = win

  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    shareWin = null
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/share.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/share.html'))
  }
}
