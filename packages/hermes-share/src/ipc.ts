/**
 * IPC surface between the share window (renderer) and the shell main.
 * Handlers are registered once per process; the window module injects the
 * concrete state/send implementations at open time.
 */

import { ipcMain } from 'electron'
import type {
  ShareSendResult,
  ShareTargets,
  ShareWindowSendRequest,
  ShareWindowState,
} from './types'

export const SHARE_CHANNELS = {
  getState: 'share:get-state',
  listChannels: 'share:list-channels',
  send: 'share:send',
} as const

export interface ShareIpcDeps {
  /** discover deliverable channels via the Hermes CLI */
  listChannels: () => Promise<ShareTargets>
  /** validate + deliver; never throws. filePath is injected from the window state */
  send: (request: ShareWindowSendRequest & { filePath?: string }) => Promise<ShareSendResult>
}

/** state snapshot handed to the window when it opens (set via setShareWindowState) */
let currentState: ShareWindowState | null = null

export function setShareWindowState(state: ShareWindowState | null): void {
  currentState = state
}

let registered = false

/** idempotent: safe to call from every editor/shell init path */
export function registerShareIpc(deps: ShareIpcDeps): void {
  if (registered) return
  registered = true

  ipcMain.handle(SHARE_CHANNELS.getState, () => currentState)
  ipcMain.handle(SHARE_CHANNELS.listChannels, () => deps.listChannels())
  ipcMain.handle(SHARE_CHANNELS.send, (_event, request: ShareWindowSendRequest) =>
    deps.send({ ...request, filePath: currentState?.filePath }),
  )
}
