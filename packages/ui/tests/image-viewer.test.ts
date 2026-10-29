/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ImageViewer, type ImageViewerLabels } from '../src/image-viewer'
import { AiComposer } from '../src/AiComposer'

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

const labels: ImageViewerLabels = {
  zoomIn: 'Zoom In',
  zoomOut: 'Zoom Out',
  actualSize: 'Actual Size',
  fitToWindow: 'Fit to Window',
  save: 'Save',
  close: 'Close',
}

it('renders ImageViewer buttons with type="button" and proper aria-pressed attributes', () => {
  const onClose = vi.fn()
  act(() => {
    root.render(createElement(ImageViewer, { src: 'data:image/png;base64,', labels, onClose }))
  })

  const buttons = Array.from(host.querySelectorAll('button'))
  expect(buttons.length).toBeGreaterThan(0)
  buttons.forEach((btn) => {
    expect(btn.getAttribute('type')).toBe('button')
  })

  const fitBtn = host.querySelector('button[aria-label="Fit to Window"]')!
  expect(fitBtn).not.toBeNull()
  expect(fitBtn.getAttribute('aria-pressed')).toBe('true')

  const actualSizeBtn = host.querySelector('button[aria-label="Actual Size"]')!
  expect(actualSizeBtn).not.toBeNull()
  expect(actualSizeBtn.getAttribute('aria-pressed')).toBe('false')
})

it('renders AiComposer send and stop buttons with type="button"', () => {
  const onChange = vi.fn()
  const onSend = vi.fn()
  const onStop = vi.fn()

  act(() => {
    root.render(
      createElement(AiComposer, {
        value: 'Hello AI',
        busy: false,
        placeholder: 'Ask AI...',
        hintIdle: 'Enter to send',
        hintBusy: 'Generating...',
        sendLabel: 'Send',
        stopLabel: 'Stop',
        onChange,
        onSend,
        onStop,
      }),
    )
  })

  const sendBtn = host.querySelector('button.ai-send-btn')!
  expect(sendBtn).not.toBeNull()
  expect(sendBtn.getAttribute('type')).toBe('button')

  act(() => {
    root.render(
      createElement(AiComposer, {
        value: 'Hello AI',
        busy: true,
        placeholder: 'Ask AI...',
        hintIdle: 'Enter to send',
        hintBusy: 'Generating...',
        sendLabel: 'Send',
        stopLabel: 'Stop',
        onChange,
        onSend,
        onStop,
      }),
    )
  })

  const stopBtn = host.querySelector('button.ai-stop-btn')!
  expect(stopBtn).not.toBeNull()
  expect(stopBtn.getAttribute('type')).toBe('button')
})
