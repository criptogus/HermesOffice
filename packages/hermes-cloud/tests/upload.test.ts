import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { uploadFileToCloud } from '../src/upload'

const fetchMock = vi.fn()

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

function validTokenFile(dir: string): string {
  const path = join(dir, 'google-token.json')
  writeFileSync(
    path,
    JSON.stringify({
      access_token: 'ya29.test-token',
      refresh_token: '1//refresh',
      expires_at: Date.now() + 3_600_000,
    }),
  )
  return path
}

/** a real small file to upload (the transport reads it from disk) */
function sampleFile(dir: string, name = 'report.docx'): string {
  const path = join(dir, name)
  writeFileSync(path, 'fake docx bytes')
  return path
}

let tmp: string

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  tmp = mkdtempSync(join(tmpdir(), 'ho-cloud-test-'))
})

afterEach(() => {
  vi.unstubAllGlobals()
  rmSync(tmp, { recursive: true, force: true })
})

describe('uploadFileToCloud (embedded OAuth transport)', () => {
  it('uploads via the Drive API and returns the link', async () => {
    const tokenPath = validTokenFile(tmp)
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ files: [{ id: 'folder-123', name: 'HermesOffice' }] })) // folder search
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'file-456',
          name: 'report.docx',
          webViewLink: 'https://drive.google.com/file/d/file-456/view',
        }),
      ) // multipart upload

    const result = await uploadFileToCloud('/usr/bin/hermes', 'google-drive', sampleFile(tmp), {
      tokenPath,
    })

    expect(result.ok).toBe(true)
    expect(result.link).toBe('https://drive.google.com/file/d/file-456/view')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [listUrl, uploadCall] = fetchMock.mock.calls
    expect(String(listUrl[0])).toContain('files?q=')
    expect(String(listUrl[0])).toContain('HermesOffice')
    expect(String(uploadCall[0])).toContain('uploadType=multipart')
    const uploadInit = uploadCall[1] as RequestInit
    const headers = uploadInit.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer ya29.test-token')
  })

  it('creates the folder when the search finds nothing', async () => {
    const tokenPath = validTokenFile(tmp)
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ files: [] })) // search: empty
      .mockResolvedValueOnce(jsonResponse({ id: 'folder-new', name: 'MyFolder' })) // create folder
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'file-1',
          name: 'a.docx',
          webViewLink: 'https://drive.google.com/file/d/file-1/view',
        }),
      )

    const result = await uploadFileToCloud(
      '/usr/bin/hermes',
      'google-drive',
      sampleFile(tmp, 'a.docx'),
      {
        tokenPath,
        folder: 'MyFolder',
      },
    )

    expect(result.ok).toBe(true)
    const [, createCall, uploadCall] = fetchMock.mock.calls
    expect(String(createCall[0])).toContain('/files')
    expect((createCall[1] as RequestInit).method).toBe('POST')
    expect(JSON.parse(String((createCall[1] as RequestInit).body))).toMatchObject({
      name: 'MyFolder',
      mimeType: 'application/vnd.google-apps.folder',
    })
    expect(String(uploadCall[0])).toContain('uploadType=multipart')
    const uploadBody = String((uploadCall[1] as RequestInit).body)
    expect(uploadBody).toContain('folder-new')
    expect(uploadBody).toContain('a.docx')
  })

  it('fails fast when no token is stored', async () => {
    const result = await uploadFileToCloud(
      '/usr/bin/hermes',
      'google-drive',
      sampleFile(tmp, 'a.docx'),
      {
        tokenPath: join(tmp, 'missing.json'),
      },
    )

    expect(result.ok).toBe(false)
    expect(result.error).toContain('not connected')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects providers that are not wired up yet', async () => {
    const result = await uploadFileToCloud(
      '/usr/bin/hermes',
      'dropbox',
      sampleFile(tmp, 'a.docx'),
      {
        tokenPath: validTokenFile(tmp),
      },
    )

    expect(result.ok).toBe(false)
    expect(result.error).toContain('only Google Drive is available')
  })
})
