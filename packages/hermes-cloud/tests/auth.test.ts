import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GOOGLE_DRIVE_FILE_SCOPE,
  TokenStore,
  buildAuthUrl,
  exchangeCode,
  refreshAccessToken,
} from '../src/auth'

const fetchMock = vi.fn()

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

const CONFIG = { clientId: 'client.apps.googleusercontent.com', clientSecret: 'secret' }

let tmp: string

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  tmp = mkdtempSync(join(tmpdir(), 'ho-auth-test-'))
})

afterEach(() => {
  vi.unstubAllGlobals()
  rmSync(tmp, { recursive: true, force: true })
})

describe('buildAuthUrl', () => {
  it('targets the consent page with the minimal drive.file scope and loopback redirect', () => {
    const url = new URL(buildAuthUrl(CONFIG, 5371, 'state-abc'))
    expect(url.origin).toBe('https://accounts.google.com')
    expect(url.pathname).toBe('/o/oauth2/v2/auth')
    expect(url.searchParams.get('client_id')).toBe(CONFIG.clientId)
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:5371/')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('scope')).toBe(GOOGLE_DRIVE_FILE_SCOPE)
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('state')).toBe('state-abc')
  })
})

describe('exchangeCode', () => {
  it('exchanges the code for tokens', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        access_token: 'ya29.new',
        refresh_token: '1//refresh',
        expires_in: 3599,
        scope: GOOGLE_DRIVE_FILE_SCOPE,
      }),
    )
    const result = await exchangeCode(CONFIG, 'auth-code', 5371)
    expect(result.ok).toBe(true)
    expect(result.token?.access_token).toBe('ya29.new')
    expect(result.token?.refresh_token).toBe('1//refresh')
    expect(result.token && result.token.expires_at > Date.now()).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://oauth2.googleapis.com/token')
    expect(String((init as RequestInit).body)).toContain('grant_type=authorization_code')
    expect(String((init as RequestInit).body)).toContain('code=auth-code')
  })

  it('surfaces API errors', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'invalid_grant', error_description: 'Bad code' }, 400),
    )
    const result = await exchangeCode(CONFIG, 'bad', 5371)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Bad code')
  })
})

describe('refreshAccessToken', () => {
  it('refreshes and keeps the existing refresh token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'ya29.fresh', expires_in: 3600 }))
    const result = await refreshAccessToken(CONFIG, '1//keep')
    expect(result.ok).toBe(true)
    expect(result.token?.access_token).toBe('ya29.fresh')
    expect(String((fetchMock.mock.calls[0][1] as RequestInit).body)).toContain(
      'grant_type=refresh_token',
    )
  })
})

describe('TokenStore', () => {
  it('round-trips a token and clears it', () => {
    const path = join(tmp, 'google-token.json')
    const store = new TokenStore(path)
    expect(store.load()).toBeNull()
    store.save({ access_token: 'a', refresh_token: 'r', expires_at: Date.now() + 1000 })
    expect(store.load()?.access_token).toBe('a')
    store.clear()
    expect(store.load()).toBeNull()
  })

  it('treats corrupt files as missing', () => {
    const path = join(tmp, 'corrupt.json')
    writeFileSync(path, 'not json')
    expect(new TokenStore(path).load()).toBeNull()
  })
})
