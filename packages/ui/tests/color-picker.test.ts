/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ColorPicker, type ColorPickerStrings } from '../src/color-picker'

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const defaultStrings: ColorPickerStrings = {
  themeColors: 'Theme Colors',
  standardColors: 'Standard Colors',
  auto: 'Automatic',
  recentColors: 'Recent Colors',
  moreColors: 'More Colors...',
}

it('renders color swatches with proper aria-labels and title attributes', () => {
  const onPick = vi.fn()
  act(() =>
    root.render(
      createElement(ColorPicker, {
        value: '#FF0000',
        strings: defaultStrings,
        recentColors: ['#123456'],
        onPick,
      }),
    ),
  )

  const swatches = host.querySelectorAll<HTMLButtonElement>('.gcp-swatch')
  expect(swatches.length).toBeGreaterThan(0)

  for (const swatch of Array.from(swatches)) {
    const title = swatch.getAttribute('title')
    const ariaLabel = swatch.getAttribute('aria-label')
    expect(title).toBeTruthy()
    expect(ariaLabel).toBe(title)
  }

  // Find standard red swatch
  const redSwatch = Array.from(swatches).find((s) => s.getAttribute('aria-label') === 'Red')
  expect(redSwatch).toBeDefined()

  act(() => {
    redSwatch?.click()
  })
  expect(onPick).toHaveBeenCalledWith('#FF0000')
})
