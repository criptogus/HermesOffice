import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HOME_CHANNELS } from '../src/shared/home-api'
import { TABS_CHANNELS } from '../src/shared/tabs-api'
import { QS_CHANNELS } from '../src/shared/quick-switcher-api'

const electronMocks = vi.hoisted(() => ({
  exposed: new Map<string, unknown>(),
  invoke: vi.fn(),
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, api: unknown) => electronMocks.exposed.set(name, api),
  },
  ipcRenderer: { invoke: electronMocks.invoke },
}))

import '../src/preload/quick-switcher'

// The quick-switcher preload must stay a single self-contained bundle (the
// window runs sandboxed), so it inlines channel names as literals instead of
// importing HOME_CHANNELS/TABS_CHANNELS. These tests pin the literals to the
// shared constants so a rename can't silently break the switcher.
interface QsApi {
  getState(): Promise<unknown>
  close(): void
  recents(query?: unknown): Promise<unknown>
  starred(query?: unknown): Promise<unknown>
  listTabs(): Promise<unknown>
  activateTab(id: string): Promise<void>
  openPath(path: string): Promise<void>
  browse(): Promise<void>
}

const api = electronMocks.exposed.get('aiOfficeQuickSwitcher') as QsApi

beforeEach(() => {
  electronMocks.invoke.mockReset()
  electronMocks.invoke.mockResolvedValue(null)
})

describe('quick-switcher preload channel literals', () => {
  it('getState/close use QS_CHANNELS', async () => {
    await api.getState()
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(QS_CHANNELS.getState)
    api.close()
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(QS_CHANNELS.close)
  })

  it('file/tab calls reuse the home/tabs channels', async () => {
    await api.recents({ limit: 5 })
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(HOME_CHANNELS.recents, { limit: 5 })
    await api.starred()
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(HOME_CHANNELS.starred, undefined)
    await api.listTabs()
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(TABS_CHANNELS.list)
    await api.activateTab('tab-1')
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(TABS_CHANNELS.activate, 'tab-1')
    await api.openPath('/tmp/a.docx')
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(HOME_CHANNELS.openPath, '/tmp/a.docx')
    await api.browse()
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(HOME_CHANNELS.browse)
  })

  it('listTabs tolerates non-array replies', async () => {
    electronMocks.invoke.mockResolvedValue({ nope: true })
    await expect(api.listTabs()).resolves.toEqual([])
  })
})
