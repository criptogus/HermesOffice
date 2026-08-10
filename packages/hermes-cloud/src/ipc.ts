import type { CloudConfig, CloudFileState, CloudProvider } from './types'

export const CLOUD_CHANNELS = {
  getConfig: 'cloud:get-config',
  setConfig: 'cloud:set-config',
  /** immediate upload of the given file (or the active document) */
  uploadNow: 'cloud:upload-now',
  /** current per-file sync states */
  getStates: 'cloud:get-states',
  /** broadcast from main → renderer whenever sync states change */
  statesChanged: 'cloud:states-changed',
  /** start the embedded Google OAuth flow (opens the consent window) */
  connect: 'cloud:connect',
  /** revoke the stored token */
  disconnect: 'cloud:disconnect',
  /** whether Google Drive is connected right now */
  getAuthState: 'cloud:get-auth-state',
  /** broadcast when the connection state changes */
  authChanged: 'cloud:auth-changed',
} as const

export interface CloudIpcDeps {
  getConfig(): CloudConfig
  setConfig(config: CloudConfig): void
  uploadNow(filePath?: string): Promise<CloudFileState>
  getStates(): CloudFileState[]
  /** register a listener for state changes; returns unsubscribe */
  onStatesChanged(handler: (states: CloudFileState[]) => void): () => void
}

export interface CloudIpcHandlers {
  register(deps: CloudIpcDeps): void
}

/**
 * Pure registration helper — the shell main wires these to ipcMain.handle.
 * Kept dependency-free so the package stays testable without Electron.
 */
export function createCloudHandlers(deps: CloudIpcDeps): Record<string, unknown> {
  return {
    [CLOUD_CHANNELS.getConfig]: () => deps.getConfig(),
    [CLOUD_CHANNELS.setConfig]: (_config: CloudConfig) => {
      deps.setConfig(_config)
      return deps.getConfig()
    },
    [CLOUD_CHANNELS.uploadNow]: (filePath?: string) => deps.uploadNow(filePath),
    [CLOUD_CHANNELS.getStates]: () => deps.getStates(),
  }
}

export function isCloudProvider(value: unknown): value is CloudProvider {
  return value === 'google-drive' || value === 'dropbox' || value === 'onedrive'
}
