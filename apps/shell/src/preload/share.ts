import { contextBridge, ipcRenderer } from 'electron'
// type-only imports: the preload runs sandboxed, so it must not pull any
// Node builtin at runtime (a `require('node:fs')` here would throw and kill
// the whole preload before contextBridge runs).
import type {
  ShareSendResult,
  ShareTargets,
  ShareWindowSendRequest,
  ShareWindowState,
} from '@hermesoffice/hermes-share'

// mirrored from @hermesoffice/hermes-share (value import would drag Node
// builtins into the sandboxed preload bundle)
const SHARE_CHANNELS = {
  getState: 'share:get-state',
  listChannels: 'share:list-channels',
  send: 'share:send',
} as const

const api = {
  getState: (): Promise<ShareWindowState | null> =>
    ipcRenderer.invoke(SHARE_CHANNELS.getState) as Promise<ShareWindowState | null>,
  listChannels: (): Promise<ShareTargets> => ipcRenderer.invoke(SHARE_CHANNELS.listChannels),
  send: (request: ShareWindowSendRequest): Promise<ShareSendResult> =>
    ipcRenderer.invoke(SHARE_CHANNELS.send, request),
}

export type ShareWindowApi = typeof api

contextBridge.exposeInMainWorld('shareApi', api)
