import { readFileSync, writeFileSync } from 'node:fs'
import { DEFAULT_CLOUD_CONFIG, type CloudConfig } from './types'

/**
 * Tiny JSON store for the cloud sync settings. The file lives next to the
 * app's user data (passed in by the shell main) so it survives updates.
 */
export function loadCloudConfig(path: string): CloudConfig {
  try {
    const raw = readFileSync(path, 'utf8')
    return normalizeCloudConfig(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_CLOUD_CONFIG }
  }
}

/** validate/coerce any incoming config value (disk JSON or IPC payload) */
export function normalizeCloudConfig(value: unknown): CloudConfig {
  const partial = (value ?? {}) as Partial<CloudConfig>
  return {
    provider: isProvider(partial.provider) ? partial.provider : DEFAULT_CLOUD_CONFIG.provider,
    folder:
      typeof partial.folder === 'string' && partial.folder.trim()
        ? partial.folder.trim()
        : DEFAULT_CLOUD_CONFIG.folder,
    autoSync:
      typeof partial.autoSync === 'boolean' ? partial.autoSync : DEFAULT_CLOUD_CONFIG.autoSync,
  }
}

export function saveCloudConfig(path: string, config: CloudConfig): void {
  writeFileSync(path, JSON.stringify(config, null, 2), { mode: 0o600 })
}

function isProvider(value: unknown): value is CloudConfig['provider'] {
  return value === null || value === 'google-drive' || value === 'dropbox' || value === 'onedrive'
}
