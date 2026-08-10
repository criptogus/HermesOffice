import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { chmodSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * OAuth 2.0 for Google Drive, embedded in the app (RFC 8252 native-app flow):
 *
 *   connect → open the Google consent page in a window → user clicks
 *   "Allow" → Google redirects to http://localhost:<port>/?code=… →
 *   the app exchanges the code for tokens and stores them under userData.
 *
 * The client belongs to HermesOffice (public desktop client by design), the
 * scope is the minimal `drive.file` (files created by the app only), and the
 * token never leaves the machine. No developer console, no JSON files — the
 * end user only ever sees the Google consent page.
 */

export interface GoogleToken {
  access_token: string
  refresh_token: string
  expires_at: number // epoch ms
  scope?: string
}

export interface GoogleOAuthConfig {
  clientId: string
  clientSecret: string
}

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GOOGLE_DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

// OAuth client credentials for the HermesOffice Google project live in the
// gitignored packages/hermes-cloud/src/oauth-credentials.ts; the shell build
// inlines them here via electron-vite `define` (see apps/shell/electron.vite.config.ts),
// so the public repo never carries them. On CI/fresh clones the values are
// empty strings and buildAuthUrl surfaces a clear configuration error.
declare global {
  var __HERMESOFFICE_OAUTH_CLIENT_ID__: string | undefined
  var __HERMESOFFICE_OAUTH_CLIENT_SECRET__: string | undefined
}

export const GOOGLE_CLIENT_ID = globalThis.__HERMESOFFICE_OAUTH_CLIENT_ID__ ?? ''
export const GOOGLE_CLIENT_SECRET = globalThis.__HERMESOFFICE_OAUTH_CLIENT_SECRET__ ?? ''

export class TokenStore {
  constructor(private readonly filePath: string) {}

  load(): GoogleToken | null {
    try {
      const raw = readFileSync(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as GoogleToken
      if (!parsed.access_token) return null
      return parsed
    } catch {
      return null
    }
  }

  save(token: GoogleToken): void {
    writeFileSync(this.filePath, JSON.stringify(token, null, 2), { mode: 0o600 })
    try {
      chmodSync(this.filePath, 0o600)
    } catch {
      // best effort
    }
  }

  clear(): void {
    try {
      unlinkSync(this.filePath)
    } catch {
      // nothing to clear
    }
  }

  static defaultPath(userData: string): string {
    return dirname(userData).length > 0
      ? `${userData}${userData.endsWith('/') ? '' : '/'}google-token.json`
      : `${userData}/google-token.json`
  }
}

/** authorization URL for the native-app (loopback) flow */
export function buildAuthUrl(config: GoogleOAuthConfig, port: number, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: `http://localhost:${port}/`,
    response_type: 'code',
    scope: GOOGLE_DRIVE_FILE_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
    include_granted_scopes: 'true',
  })
  return `${GOOGLE_AUTH_URL}?${params.toString()}`
}

export interface TokenExchangeResult {
  ok: boolean
  token?: GoogleToken
  error?: string
}

/** exchange the authorization code (or refresh a token) via the token endpoint */
export async function exchangeCode(
  config: GoogleOAuthConfig,
  code: string,
  port: number,
  timeoutMs = 15_000,
): Promise<TokenExchangeResult> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: `http://localhost:${port}/`,
    grant_type: 'authorization_code',
  })
  return postTokenRequest(body, timeoutMs)
}

export async function refreshAccessToken(
  config: GoogleOAuthConfig,
  refreshToken: string,
  timeoutMs = 15_000,
): Promise<TokenExchangeResult> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })
  return postTokenRequest(body, timeoutMs)
}

async function postTokenRequest(
  body: URLSearchParams,
  timeoutMs: number,
): Promise<TokenExchangeResult> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    })
    clearTimeout(timer)
    const json = (await response.json()) as Record<string, string>
    if (!response.ok || !json.access_token) {
      return { ok: false, error: json.error_description ?? json.error ?? `HTTP ${response.status}` }
    }
    const expiresIn = Number(json.expires_in ?? 3600)
    return {
      ok: true,
      token: {
        access_token: json.access_token,
        refresh_token: json.refresh_token ?? '',
        expires_at: Date.now() + expiresIn * 1000,
        scope: json.scope,
      },
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
