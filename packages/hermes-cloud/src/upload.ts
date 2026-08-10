import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  TokenStore,
  refreshAccessToken,
  type GoogleOAuthConfig,
  type GoogleToken,
} from './auth'
import type { CloudProvider, CloudUploadResult } from './types'

export const CLOUD_UPLOAD_TIMEOUT_MS = 60_000

const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'

export interface UploadOptions {
  /** folder name inside the provider; created when missing (Google Drive) */
  folder?: string
  /** where the OAuth token lives (userData/google-token.json) */
  tokenPath?: string
  /** how long to wait before failing */
  timeoutMs?: number
}

export interface GoogleDriveAuth {
  /** OAuth client credentials (embedded, public desktop client) */
  config: GoogleOAuthConfig
  /** path to the persisted token */
  tokenPath: string
}

export interface DriveAuthState {
  connected: boolean
  error?: string
}

/** true when a usable token exists for Google Drive */
export function driveAuthState(auth: GoogleDriveAuth): DriveAuthState {
  const token = new TokenStore(auth.tokenPath).load()
  return { connected: Boolean(token?.access_token) }
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** load the token, refreshing it when close to expiry */
async function validToken(
  auth: GoogleDriveAuth,
  timeoutMs: number,
): Promise<{ token: GoogleToken; error?: string }> {
  const store = new TokenStore(auth.tokenPath)
  const current = store.load()
  if (!current?.access_token) {
    return { token: current as GoogleToken, error: 'Google Drive is not connected' }
  }
  if (current.expires_at > Date.now() + 60_000) {
    return { token: current }
  }
  if (!current.refresh_token) {
    return { token: current, error: 'Google Drive session expired — reconnect' }
  }
  const refreshed = await refreshAccessToken(auth.config, current.refresh_token, timeoutMs)
  if (!refreshed.ok || !refreshed.token) {
    return { token: current, error: refreshed.error ?? 'Google Drive session expired — reconnect' }
  }
  store.save({ ...current, ...refreshed.token, refresh_token: current.refresh_token })
  return { token: refreshed.token }
}

interface DriveFileMeta {
  id?: string
  name?: string
  webViewLink?: string
}

/** find the target folder by name (or create it), returning its id */
async function ensureDriveFolder(
  auth: GoogleDriveAuth,
  accessToken: string,
  folder: string,
  timeoutMs: number,
): Promise<{ id?: string; error?: string }> {
  const query = encodeURIComponent(
    `name='${folder.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  )
  const listUrl = `${DRIVE_API}/files?q=${query}&fields=files(id,name)&pageSize=1&spaces=drive`
  const listRes = await fetchJson(
    listUrl,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    timeoutMs,
  )
  if (!listRes.ok) {
    return { error: `Drive search failed (HTTP ${listRes.status})` }
  }
  const list = (await listRes.json()) as { files?: DriveFileMeta[] }
  if (list.files && list.files.length > 0 && list.files[0]?.id) {
    return { id: list.files[0].id }
  }

  const createRes = await fetchJson(
    `${DRIVE_API}/files`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: folder,
        mimeType: 'application/vnd.google-apps.folder',
      }),
    },
    timeoutMs,
  )
  if (!createRes.ok) {
    return { error: `Drive folder creation failed (HTTP ${createRes.status})` }
  }
  const created = (await createRes.json()) as DriveFileMeta
  return { id: created.id }
}

/** multipart upload of a local file to the target folder */
async function uploadFile(
  auth: GoogleDriveAuth,
  accessToken: string,
  filePath: string,
  folderId: string,
  timeoutMs: number,
): Promise<{ link?: string; error?: string }> {
  let bytes: Buffer
  try {
    bytes = readFileSync(filePath)
  } catch {
    return { error: `Could not read the file: ${filePath}` }
  }

  const name = basename(filePath)
  const metadata = JSON.stringify({ name, parents: [folderId] })
  const boundary = `ho-${Date.now().toString(36)}`
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
  )
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`)

  const res = await fetchJson(
    `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,webViewLink`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: Buffer.concat([prefix, bytes, suffix]),
    },
    timeoutMs,
  )
  if (!res.ok) {
    return { error: `Drive upload failed (HTTP ${res.status})` }
  }
  const meta = (await res.json()) as DriveFileMeta
  return { link: meta.webViewLink || meta.id }
}

/**
 * Upload a local file to Google Drive with the app's own OAuth token —
 * deterministic, no agent loop, no third-party relay. Never throws; failures
 * come back in the result.
 */
export async function uploadFileToCloud(
  _bin: string,
  provider: CloudProvider,
  filePath: string,
  options: UploadOptions = {},
): Promise<CloudUploadResult> {
  const folder = options.folder ?? 'HermesOffice'
  const timeoutMs = options.timeoutMs ?? CLOUD_UPLOAD_TIMEOUT_MS

  if (provider !== 'google-drive') {
    return {
      filePath,
      provider,
      ok: false,
      error: `Provider '${provider}' is not wired up yet — only Google Drive is available`,
    }
  }
  if (!options.tokenPath) {
    return { filePath, provider, ok: false, error: 'Google Drive is not configured' }
  }

  const auth: GoogleDriveAuth = {
    config: { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET },
    tokenPath: options.tokenPath,
  }

  const token = await validToken(auth, timeoutMs)
  if (token.error || !token.token?.access_token) {
    return { filePath, provider, ok: false, error: token.error ?? 'Google Drive is not connected' }
  }

  const driveFolder = await ensureDriveFolder(auth, token.token.access_token, folder, timeoutMs)
  if (driveFolder.error || !driveFolder.id) {
    return {
      filePath,
      provider,
      ok: false,
      error: driveFolder.error ?? 'Could not resolve Drive folder',
    }
  }

  const uploaded = await uploadFile(
    auth,
    token.token.access_token,
    filePath,
    driveFolder.id,
    timeoutMs,
  )
  if (uploaded.error || !uploaded.link) {
    return {
      filePath,
      provider,
      ok: false,
      error: uploaded.error ?? 'Upload finished but no link was returned',
    }
  }
  return { filePath, provider, ok: true, link: uploaded.link }
}
