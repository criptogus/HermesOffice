/**
 * @hermesoffice/hermes-cloud
 *
 * Cloud sync for HermesOffice: uploads the documents open in the shell to
 * Google Drive through the Hermes-owned google-workspace scripts
 * (`google_api.py drive upload`) — a native, deterministic integration with
 * the user's existing Google OAuth (no agent loop, no third-party relay).
 */
export { loadCloudConfig, normalizeCloudConfig, saveCloudConfig } from './config'
export { CLOUD_UPLOAD_TIMEOUT_MS, uploadFileToCloud, driveAuthState } from './upload'
export {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_AUTH_URL,
  GOOGLE_TOKEN_URL,
  GOOGLE_DRIVE_FILE_SCOPE,
  buildAuthUrl,
  exchangeCode,
  refreshAccessToken,
  TokenStore,
  type GoogleOAuthConfig,
  type GoogleToken,
} from './auth'
export { CloudSyncManager, type CloudSyncDeps } from './cloud-sync'
export { CLOUD_CHANNELS, createCloudHandlers, isCloudProvider, type CloudIpcDeps } from './ipc'
export {
  CLOUD_PROVIDERS,
  CLOUD_PROVIDER_LABEL,
  DEFAULT_CLOUD_CONFIG,
  type CloudConfig,
  type CloudFileState,
  type CloudProvider,
  type CloudUploadResult,
} from './types'
