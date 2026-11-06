import { contextBridge, ipcRenderer } from 'electron'
import type { QuickSwitcherApi, QuickSwitcherState } from '../shared/quick-switcher-api'
import { QS_CHANNELS } from '../shared/quick-switcher-api'
import type { RecentPage, RecentQuery } from '../shared/home-api'
import type { TabSummary } from '../shared/tabs-api'

// Channel names are inlined as literals on purpose: sandboxed preload bundles
// must stay a single self-contained file — importing HOME_CHANNELS /
// TABS_CHANNELS here would make Rollup emit a shared chunk that the sandbox
// require() cannot load, killing the whole preload. Keep in sync with
// HOME_CHANNELS/TABS_CHANNELS (pinned by tests/quick-switcher-preload.test.ts).
const HOME_RECENTS = 'home:recents'
const HOME_STARRED = 'home:starred'
const HOME_OPEN_PATH = 'home:open-path'
const HOME_BROWSE = 'home:browse'
const TABS_LIST = 'tabs:list'
const TABS_ACTIVATE = 'tabs:activate'

/**
 * Quick-switcher window bridge: window lifecycle goes through QS_CHANNELS,
 * file/tab data reuses the existing home/tabs channels (they carry no
 * sender checks — the switcher is first-party chrome like the home screen).
 */
const api: QuickSwitcherApi & {
  recents(query?: RecentQuery): Promise<RecentPage>
  starred(query?: RecentQuery): Promise<RecentPage>
  listTabs(): Promise<TabSummary[]>
  activateTab(id: string): Promise<void>
  openPath(path: string): Promise<void>
  browse(): Promise<void>
} = {
  async getState() {
    const result: unknown = await ipcRenderer.invoke(QS_CHANNELS.getState)
    return (result ?? null) as QuickSwitcherState | null
  },
  close() {
    void ipcRenderer.invoke(QS_CHANNELS.close)
  },
  async recents(query) {
    const result: unknown = await ipcRenderer.invoke(HOME_RECENTS, query)
    return result as RecentPage
  },
  async starred(query) {
    const result: unknown = await ipcRenderer.invoke(HOME_STARRED, query)
    return result as RecentPage
  },
  async listTabs() {
    const result: unknown = await ipcRenderer.invoke(TABS_LIST)
    return Array.isArray(result) ? (result as TabSummary[]) : []
  },
  async activateTab(id) {
    await ipcRenderer.invoke(TABS_ACTIVATE, id)
  },
  async openPath(path) {
    await ipcRenderer.invoke(HOME_OPEN_PATH, path)
  },
  async browse() {
    await ipcRenderer.invoke(HOME_BROWSE)
  },
}

contextBridge.exposeInMainWorld('aiOfficeQuickSwitcher', api)
