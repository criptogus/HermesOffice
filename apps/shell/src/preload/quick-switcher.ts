import { contextBridge, ipcRenderer } from 'electron'
import type { QuickSwitcherApi, QuickSwitcherState } from '../shared/quick-switcher-api'
import { QS_CHANNELS } from '../shared/quick-switcher-api'
import { HOME_CHANNELS, type RecentPage, type RecentQuery } from '../shared/home-api'
import { TABS_CHANNELS, type TabSummary } from '../shared/tabs-api'

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
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.recents, query)
    return result as RecentPage
  },
  async starred(query) {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.starred, query)
    return result as RecentPage
  },
  async listTabs() {
    const result: unknown = await ipcRenderer.invoke(TABS_CHANNELS.list)
    return Array.isArray(result) ? (result as TabSummary[]) : []
  },
  async activateTab(id) {
    await ipcRenderer.invoke(TABS_CHANNELS.activate, id)
  },
  async openPath(path) {
    await ipcRenderer.invoke(HOME_CHANNELS.openPath, path)
  },
  async browse() {
    await ipcRenderer.invoke(HOME_CHANNELS.browse)
  },
}

contextBridge.exposeInMainWorld('aiOfficeQuickSwitcher', api)
