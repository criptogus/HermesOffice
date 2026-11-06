// Contract between the quick-switcher window (quick-switcher.html) and the
// shell main process. The window is a lightweight always-on-top child used
// for Cmd/Ctrl+O fuzzy file/tab switching (issue #25).

export const QS_CHANNELS = {
  /** one-shot state pushed on open: UI language tag + localized strings */
  getState: 'qs:get-state',
  close: 'qs:close',
} as const

/** window copy, localized in the main process (owner of UI language) */
export interface QuickSwitcherStrings {
  placeholder: string
  empty: string
  browse: string
  sectionTabs: string
  sectionFiles: string
}

export interface QuickSwitcherState {
  /** BCP-47 tag for documentElement.lang */
  lang: string
  strings: QuickSwitcherStrings
}

export interface QuickSwitcherApi {
  getState(): Promise<QuickSwitcherState | null>
  close(): void
}
