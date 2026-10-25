import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { ProjectStore } from '../src/store'

it('keeps unanswered opening messages isolated by document across a process restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'office-document-restart-'))
  try {
    const store = new ProjectStore(dir)
    store.ensureDefaultProject()
    const a = store.resolveChatForFile('/documents/a.docx')
    const b = store.resolveChatForFile('/documents/b.docx')
    store.appendChatMessage(a.projectId, a.chatId, { role: 'user', text: 'marker ALPHA' })
    store.appendChatMessage(b.projectId, b.chatId, { role: 'user', text: 'marker BETA' })
    const reopened = new ProjectStore(dir)
    expect(reopened.resolveChatForFile('/documents/a.docx')).toEqual(a)
    expect(reopened.resolveChatForFile('/documents/b.docx')).toEqual(b)
    expect(a.chatId).not.toBe(b.chatId)
    expect(reopened.loadChat(a.projectId, a.chatId).map((m) => m.text)).toEqual(['marker ALPHA'])
    expect(reopened.loadChat(b.projectId, b.chatId).map((m) => m.text)).toEqual(['marker BETA'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
