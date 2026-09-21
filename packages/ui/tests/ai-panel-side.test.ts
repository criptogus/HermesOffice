/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyAiPanelPrefs, aiPanelWidthAtPointer } from '../src/ai-panel-prefs-store'

afterEach(() => {
  applyAiPanelPrefs({})
  vi.unstubAllGlobals()
})

describe('AI panel side in the renderer', () => {
  it('moves the layout on a side-only update and restores the default', () => {
    applyAiPanelPrefs({ side: 'right' })
    expect(document.documentElement.dataset.aiPanelSide).toBe('right')
    applyAiPanelPrefs({ side: 'left' })
    expect(document.documentElement.dataset.aiPanelSide).not.toBe('right')
  })

  it('measures width inward from the selected window edge', () => {
    vi.stubGlobal('innerWidth', 1200)
    applyAiPanelPrefs({ side: 'left' })
    expect(aiPanelWidthAtPointer(350)).toBe(350)
    applyAiPanelPrefs({ side: 'right' })
    expect(aiPanelWidthAtPointer(850)).toBe(350)
    expect(aiPanelWidthAtPointer(750)).toBe(450)
  })
})
