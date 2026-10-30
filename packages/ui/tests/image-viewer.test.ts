/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ImageViewer, type ImageViewerLabels } from '../src/image-viewer'

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

const defaultLabels: ImageViewerLabels = {
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  actualSize: 'Actual size',
  fitToWindow: 'Fit to window',
  save: 'Save',
  close: 'Close',
}

it('renders dialog with aria-label and toggle buttons with aria-pressed', () => {
  const onClose = vi.fn()
  const altText = 'Sample Preview Diagram'

  act(() => {
    root.render(
      createElement(ImageViewer, {
        src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        alt: altText,
        labels: defaultLabels,
        onClose,
      }),
    )
  })

  const dialog = host.querySelector('[role="dialog"]')!
  expect(dialog).not.toBeNull()
  expect(dialog.getAttribute('aria-label')).toBe(altText)

  const fitBtn = host.querySelector('button[aria-label="Fit to window"]')!
  expect(fitBtn).not.toBeNull()
  expect(fitBtn.getAttribute('aria-pressed')).toBe('true')

  const actualSizeBtn = host.querySelector('button[aria-label="Actual size"]')!
  expect(actualSizeBtn).not.toBeNull()
  expect(actualSizeBtn.getAttribute('aria-pressed')).toBe('false')

  const zoomInBtn = host.querySelector('button[aria-label="Zoom in"]')!
  expect(zoomInBtn).not.toBeNull()
  expect(zoomInBtn.getAttribute('aria-pressed')).toBeNull()
})

it('falls back to fitToWindow label when alt text is empty or missing', () => {
  const onClose = vi.fn()

  act(() => {
    root.render(
      createElement(ImageViewer, {
        src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        alt: '   ',
        labels: defaultLabels,
        onClose,
      }),
    )
  })

  const dialog = host.querySelector('[role="dialog"]')!
  expect(dialog.getAttribute('aria-label')).toBe(defaultLabels.fitToWindow)
})
