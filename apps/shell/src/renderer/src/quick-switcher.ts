import type { QuickSwitcherState } from '../../shared/quick-switcher-api'
import type { RecentEntry, RecentPage, RecentQuery } from '../../shared/home-api'
import type { TabSummary } from '../../shared/tabs-api'

// exposed by src/preload/quick-switcher.ts
interface QsApi {
  getState(): Promise<QuickSwitcherState | null>
  close(): void
  recents(query?: RecentQuery): Promise<RecentPage>
  starred(query?: RecentQuery): Promise<RecentPage>
  listTabs(): Promise<TabSummary[]>
  activateTab(id: string): Promise<void>
  openPath(path: string): Promise<void>
  browse(): Promise<void>
}
const api = (window as unknown as { aiOfficeQuickSwitcher: QsApi }).aiOfficeQuickSwitcher

const el = (id: string): HTMLElement => document.getElementById(id) as HTMLElement
const queryInput = el('query') as HTMLInputElement
const listEl = el('list')
const browseBtn = el('browse-btn') as HTMLButtonElement

interface Item {
  kind: 'tab' | 'file'
  tabId?: string
  path?: string
  name: string
  detail: string
  starred: boolean
  /** group rank: tabs first, then starred, then recents */
  group: number
  mtimeMs: number
}

let strings = {
  placeholder: 'Type to search…',
  empty: 'No matches',
  browse: 'Browse for a file…',
  sectionTabs: 'Tabs',
  sectionFiles: 'Files',
}

const items: Item[] = []
let filtered: Item[] = []
let selected = 0

/** subsequence fuzzy score: higher is better; -1 = no match */
function fuzzyScore(text: string, q: string): number {
  const t = text.toLowerCase()
  const query = q.toLowerCase()
  if (!query) return 0
  let score = 0
  let ti = 0
  let streak = 0
  for (const ch of query) {
    const found = t.indexOf(ch, ti)
    if (found === -1) return -1
    if (found === ti) streak++
    else streak = 0
    score += 10 - Math.min(found - ti, 9) + streak * 4
    ti = found + 1
  }
  return score
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i === -1 ? p : p.slice(i + 1)
}
function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i <= 0 ? p : p.slice(0, i)
}

async function load(): Promise<void> {
  const [tabs, recents, starred] = await Promise.all([
    api.listTabs().catch(() => [] as TabSummary[]),
    api.recents({ limit: 200 }).catch(() => ({ entries: [], total: 0, totalAll: 0 }) as RecentPage),
    api.starred({ limit: 100 }).catch(() => ({ entries: [], total: 0, totalAll: 0 }) as RecentPage),
  ])

  items.length = 0
  const seenPaths = new Set<string>()

  for (const tab of tabs) {
    if (tab.kind === 'home') continue
    items.push({
      kind: 'tab',
      tabId: tab.id,
      name: tab.title || basename(tab.filePath ?? '') || tab.kind,
      detail: tab.filePath ? dirname(tab.filePath) : tab.kind,
      starred: false,
      group: 0,
      mtimeMs: 0,
    })
    if (tab.filePath) seenPaths.add(tab.filePath)
  }

  const pushFile = (entry: RecentEntry, group: number) => {
    if (seenPaths.has(entry.path)) return
    seenPaths.add(entry.path)
    items.push({
      kind: 'file',
      path: entry.path,
      name: entry.name,
      detail: dirname(entry.path),
      starred: entry.starred,
      group,
      mtimeMs: entry.mtimeMs,
    })
  }
  for (const entry of starred.entries) pushFile(entry, 1)
  for (const entry of recents.entries) pushFile(entry, 2)

  render()
}

function refilter(): void {
  const q = queryInput.value.trim()
  if (!q) {
    filtered = items.slice()
  } else {
    filtered = items
      .map((item) => ({
        item,
        score: Math.max(
          fuzzyScore(item.name, q),
          fuzzyScore(item.detail, q),
          item.path ? fuzzyScore(item.path, q) : -1,
        ),
      }))
      .filter((r) => r.score >= 0)
      .sort(
        (a, b) =>
          b.score - a.score || a.item.group - b.item.group || b.item.mtimeMs - a.item.mtimeMs,
      )
      .map((r) => r.item)
  }
  // stable group ordering when scores tie: tabs, starred, recents
  if (q) {
    filtered.sort((a, b) => {
      const sa = fuzzyScore(a.name, q)
      const sb = fuzzyScore(b.name, q)
      return sb - sa || a.group - b.group || b.mtimeMs - a.mtimeMs
    })
  } else {
    filtered.sort((a, b) => a.group - b.group || b.mtimeMs - a.mtimeMs)
  }
  selected = 0
  render()
}

function badgeLabel(item: Item): string {
  if (item.kind === 'tab') return 'TAB'
  return item.detail.split('.').pop()?.toUpperCase() ?? 'FILE'
}

function render(): void {
  listEl.textContent = ''
  if (filtered.length === 0) {
    const empty = document.createElement('div')
    empty.id = 'empty'
    empty.textContent = strings.empty
    listEl.appendChild(empty)
    return
  }

  let lastGroup = -1
  filtered.forEach((item, index) => {
    if (item.group !== lastGroup) {
      lastGroup = item.group
      const section = document.createElement('div')
      section.className = 'qs-section'
      section.textContent =
        item.group === 0 ? strings.sectionTabs : item.starred ? '★' : strings.sectionFiles
      listEl.appendChild(section)
    }
    const row = document.createElement('div')
    row.className = 'qs-item' + (index === selected ? ' selected' : '')
    row.setAttribute('role', 'option')
    row.setAttribute('aria-selected', String(index === selected))

    const badge = document.createElement('span')
    badge.className = 'qs-badge'
    badge.textContent = badgeLabel(item)
    row.appendChild(badge)

    const text = document.createElement('span')
    text.className = 'qs-text'
    const name = document.createElement('span')
    name.className = 'qs-name'
    name.textContent = item.name
    name.title = item.name
    const detail = document.createElement('span')
    detail.className = 'qs-path'
    detail.textContent = item.detail
    detail.title = item.detail
    text.appendChild(name)
    text.appendChild(detail)
    row.appendChild(text)

    if (item.starred) {
      const star = document.createElement('span')
      star.className = 'qs-star'
      star.textContent = '★'
      star.title = 'starred'
      row.appendChild(star)
    }

    row.addEventListener('click', () => void activate(index))
    listEl.appendChild(row)
  })

  const sel = listEl.querySelector('.qs-item.selected')
  sel?.scrollIntoView({ block: 'nearest' })
}

async function activate(index: number): Promise<void> {
  const item = filtered[index]
  if (!item) return
  if (item.kind === 'tab' && item.tabId) {
    await api.activateTab(item.tabId).catch(() => {})
    api.close()
    return
  }
  if (item.path) {
    await api.openPath(item.path).catch(() => {})
    api.close()
  }
}

function move(delta: number): void {
  if (filtered.length === 0) return
  selected = (selected + delta + filtered.length) % filtered.length
  render()
}

queryInput.addEventListener('input', refilter)
queryInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    move(1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    move(-1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    void activate(selected)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    api.close()
  }
})
browseBtn.addEventListener('click', () => {
  void api.browse().finally(() => api.close())
})

async function boot(): Promise<void> {
  const state = await api.getState()
  if (state?.strings) strings = state.strings
  if (state?.lang) document.documentElement.lang = state.lang
  queryInput.placeholder = strings.placeholder
  browseBtn.textContent = strings.browse
  await load()
  queryInput.focus()
}

void boot()
