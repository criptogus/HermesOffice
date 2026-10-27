/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ColorPicker } from '../src/color-picker'

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

it('renders color swatches and auto button with proper aria-label and aria-pressed attributes', () => {
  const onPick = vi.fn()
  const strings = {
    themeColors: 'Theme Colors',
    standardColors: 'Standard Colors',
    auto: 'Automatic',
  }

  act(() => {
    root.render(createElement(ColorPicker, { value: '#FF0000', strings, onPick }))
  })

  const autoBtn = host.querySelector('button.gcp-auto')!
  expect(autoBtn).not.toBeNull()
  expect(autoBtn.getAttribute('aria-pressed')).toBe('false')

  const redSwatch = host.querySelector('button[title="Red"]')!
  expect(redSwatch).not.toBeNull()
  expect(redSwatch.getAttribute('aria-label')).toBe('Red')
  expect(redSwatch.getAttribute('aria-pressed')).toBe('true')

  const whiteSwatch = host.querySelector('button[title="White"]')!
  expect(whiteSwatch).not.toBeNull()
  expect(whiteSwatch.getAttribute('aria-label')).toBe('White')
  expect(whiteSwatch.getAttribute('aria-pressed')).toBe('false')

  act(() => {
    ;(redSwatch as HTMLButtonElement).click()
  })
  expect(onPick).toHaveBeenCalledWith('#FF0000')
  act(() => {
    ;(autoBtn as HTMLButtonElement).click()
  })
  expect(onPick).toHaveBeenLastCalledWith(null)
})

it('sets aria-pressed on auto button when no color value is selected', () => {
  const onPick = vi.fn()
  const strings = {
    themeColors: 'Theme Colors',
    standardColors: 'Standard Colors',
    auto: 'Automatic',
  }

  act(() => {
    root.render(createElement(ColorPicker, { value: null, strings, onPick }))
  })

  const autoBtn = host.querySelector('button.gcp-auto')!
  expect(autoBtn.getAttribute('aria-pressed')).toBe('true')
})
