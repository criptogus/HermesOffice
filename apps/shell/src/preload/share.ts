import { contextBridge, ipcRenderer } from 'electron'
import { SHARE_CHANNELS } from '@hermesoffice/hermes-share'
import type {
  ShareSendResult,
  ShareTargets,
  ShareWindowSendRequest,
  ShareWindowState,
} from '@hermesoffice/hermes-share'

const api = {
  getState: (): Promise<ShareWindowState | null> =>
    ipcRenderer.invoke(SHARE_CHANNELS.getState) as Promise<ShareWindowState | null>,
  listChannels: (): Promise<ShareTargets> => ipcRenderer.invoke(SHARE_CHANNELS.listChannels),
  send: (request: ShareWindowSendRequest): Promise<ShareSendResult> =>
    ipcRenderer.invoke(SHARE_CHANNELS.send, request),
}

export type ShareWindowApi = typeof api

contextBridge.exposeInMainWorld('shareApi', api)
