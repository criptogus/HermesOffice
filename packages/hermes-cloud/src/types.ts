/** cloud providers reachable through the Hermes agent's Composio connections */
export type CloudProvider = 'google-drive' | 'dropbox' | 'onedrive'

export const CLOUD_PROVIDERS: readonly CloudProvider[] = ['google-drive', 'dropbox', 'onedrive']

export const CLOUD_PROVIDER_LABEL: Record<CloudProvider, string> = {
  'google-drive': 'Google Drive',
  dropbox: 'Dropbox',
  onedrive: 'OneDrive',
}

/** persisted sync settings (stored next to the Hermes CLI config) */
export interface CloudConfig {
  /** provider to sync to; null = cloud sync disabled */
  provider: CloudProvider | null
  /** target folder name inside the provider (created on demand) */
  folder: string
  /** upload the active documents whenever they change on disk */
  autoSync: boolean
}

export const DEFAULT_CLOUD_CONFIG: CloudConfig = {
  provider: null,
  folder: 'HermesOffice',
  autoSync: false,
}

/** result of a single upload attempt */
export interface CloudUploadResult {
  ok: boolean
  provider: CloudProvider
  filePath: string
  /** remote link returned by the Hermes agent, when the upload succeeded */
  link?: string
  error?: string
}

/** per-file sync status surfaced to the UI */
export interface CloudFileState {
  filePath: string
  link?: string
  error?: string
  lastAttemptAt?: number
}
