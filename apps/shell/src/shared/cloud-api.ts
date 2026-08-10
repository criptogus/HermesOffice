import type { CloudConfig, CloudFileState, CloudProvider } from '@hermesoffice/hermes-cloud'

/** IPC channels for the cloud sync UI (mirrors CLOUD_CHANNELS in the package) */
export const CLOUD_CHANNELS = {
  getConfig: 'cloud:get-config',
  setConfig: 'cloud:set-config',
  uploadNow: 'cloud:upload-now',
  getStates: 'cloud:get-states',
  statesChanged: 'cloud:states-changed',
  connect: 'cloud:connect',
  disconnect: 'cloud:disconnect',
  getAuthState: 'cloud:get-auth-state',
  authChanged: 'cloud:auth-changed',
} as const

/** providers offered in the sidebar picker (browser-safe copies of the
 *  package constants — the package itself pulls node builtins) */
export const CLOUD_PROVIDERS: readonly CloudProvider[] = ['google-drive', 'dropbox', 'onedrive']

export const CLOUD_PROVIDER_LABEL: Record<CloudProvider, string> = {
  'google-drive': 'Google Drive',
  dropbox: 'Dropbox',
  onedrive: 'OneDrive',
}

export interface DriveAuthState {
  connected: boolean
  error?: string
}

export interface ConnectResult {
  ok: boolean
  error?: string
}

export interface CloudApi {
  getConfig(): Promise<CloudConfig>
  setConfig(config: CloudConfig): Promise<CloudConfig>
  /** upload the active document now (no path → active tab's file) */
  uploadNow(filePath?: string): Promise<CloudFileState>
  getStates(): Promise<CloudFileState[]>
  onStatesChanged(handler: (states: CloudFileState[]) => void): () => void
  /** start the embedded Google OAuth flow (opens the consent window) */
  connect(): Promise<ConnectResult>
  /** revoke the stored token */
  disconnect(): Promise<boolean>
  getAuthState(): Promise<DriveAuthState>
  onAuthChanged(handler: (state: DriveAuthState) => void): () => void
}

export type { CloudConfig, CloudFileState, CloudProvider }
