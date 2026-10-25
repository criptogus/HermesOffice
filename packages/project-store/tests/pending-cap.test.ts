import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ProjectStore } from '../src/store.js'

describe('opening history durability', () => {
  let tmpDir: string
  let store: ProjectStore

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'project-store-pending-cap-'))
    store = new ProjectStore(tmpDir)
    store.ensureDefaultProject()
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('keeps a long unanswered opening history on disk across restart', () => {
    for (let i = 0; i < 250; i++) {
      store.appendChatMessage('default', 'chat1', { role: 'user', text: `msg${i}` })
    }
    const msgs = new ProjectStore(tmpDir).loadChat('default', 'chat1', 250)
    expect(msgs).toHaveLength(250)
    expect(msgs[0]!.text).toBe('msg0')
  })
})
