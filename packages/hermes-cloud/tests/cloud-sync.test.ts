import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CloudConfig } from '../src/types'

const uploadMock = vi.fn()

vi.mock('../src/upload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/upload')>()
  return {
    ...actual,
    uploadFileToCloud: (...args: unknown[]) => uploadMock(...args),
  }
})

import { CloudSyncManager } from '../src/cloud-sync'

let dir: string
let filePath: string
let config: CloudConfig
let manager: CloudSyncManager

function makeManager() {
  manager = new CloudSyncManager({
    bin: '/usr/bin/hermes',
    tokenPath: '/tmp/ho-cloud-test-token.json',
    config: () => config,
  })
  return manager
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ho-cloud-sync-'))
  filePath = join(dir, 'doc.docx')
  writeFileSync(filePath, 'v1')
  config = { provider: 'google-drive', folder: 'HermesOffice', autoSync: true }
  uploadMock.mockReset()
  uploadMock.mockResolvedValue({
    ok: true,
    provider: 'google-drive',
    filePath,
    link: 'https://drive.google.com/file/d/SYNC1/view',
  })
})

afterEach(() => {
  manager?.dispose()
  rmSync(dir, { recursive: true, force: true })
})

// macOS fs.watch under parallel test load occasionally emits late; retry keeps
// the integration test deterministic without weakening the assertions
describe('CloudSyncManager', { retry: 2 }, () => {
  it('uploads a changed file after the debounce when autoSync is on', async () => {
    makeManager()
    manager.syncWith([filePath])
    // macOS fs.watch can lag under parallel test load; write (not append)
    // so the directory watcher sees an unambiguous change event
    writeFileSync(filePath, 'v2')
    await waitFor(() => uploadMock.mock.calls.length > 0)
    expect(uploadMock).toHaveBeenCalledWith(
      '/usr/bin/hermes',
      'google-drive',
      filePath,
      expect.objectContaining({ folder: 'HermesOffice' }),
    )
    await waitFor(() =>
      manager.getFileStates().some((s) => s.link === 'https://drive.google.com/file/d/SYNC1/view'),
    )
    const state = manager.getFileStates().find((s) => s.filePath === filePath)
    expect(state?.link).toBe('https://drive.google.com/file/d/SYNC1/view')
  }, 15_000)

  it('does nothing on file changes when autoSync is off', async () => {
    config = { ...config, autoSync: false }
    makeManager()
    manager.syncWith([filePath])
    appendFileSync(filePath, 'v3')
    await new Promise((resolve) => setTimeout(resolve, 2_600))
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('stops watching files that leave the open set', async () => {
    makeManager()
    manager.syncWith([filePath])
    manager.syncWith([])
    appendFileSync(filePath, 'v4')
    await new Promise((resolve) => setTimeout(resolve, 2_600))
    expect(uploadMock).not.toHaveBeenCalled()
    expect(manager.getFileStates()).toHaveLength(0)
  })

  it('uploadNow bypasses the debounce and reports failure state', async () => {
    uploadMock.mockResolvedValue({
      ok: false,
      provider: 'dropbox',
      filePath,
      error: 'token revoked',
    })
    config = { ...config, provider: 'dropbox' }
    makeManager()
    const state = await manager.uploadNow(filePath)
    expect(state.error).toBe('token revoked')
    expect(uploadMock).toHaveBeenCalledTimes(1)
  })
})
