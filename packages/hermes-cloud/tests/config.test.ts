import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadCloudConfig, saveCloudConfig } from '../src/config'
import { DEFAULT_CLOUD_CONFIG } from '../src/types'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ho-cloud-config-'))
  file = join(dir, 'cloud-config.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('loadCloudConfig / saveCloudConfig', () => {
  it('returns the defaults when the file is missing', () => {
    expect(loadCloudConfig(file)).toEqual(DEFAULT_CLOUD_CONFIG)
  })

  it('round-trips a custom config', () => {
    saveCloudConfig(file, {
      provider: 'google-drive',
      folder: 'Relatórios',
      autoSync: true,
    })
    expect(loadCloudConfig(file)).toEqual({
      provider: 'google-drive',
      folder: 'Relatórios',
      autoSync: true,
    })
  })

  it('tolerates a corrupt file', () => {
    saveCloudConfig(file, { provider: 'dropbox', folder: 'X', autoSync: true })
    // corrupt it
    const raw = readFileSync(file, 'utf8')
    writeFileSync(file, raw.slice(0, 10))
    expect(loadCloudConfig(file)).toEqual(DEFAULT_CLOUD_CONFIG)
  })

  it('rejects unknown providers and non-boolean autoSync', () => {
    saveCloudConfig(file, { provider: 'gdrive', folder: '', autoSync: 'yes' } as never)
    const loaded = loadCloudConfig(file)
    expect(loaded.provider).toBeNull()
    expect(loaded.folder).toBe('HermesOffice')
    expect(loaded.autoSync).toBe(false)
  })
})
