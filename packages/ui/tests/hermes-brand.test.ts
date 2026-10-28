import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PNG } from 'pngjs'
import { expect, it } from 'vitest'
import { HermesMark } from '../src/hermes-mark'

const asset = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url))

it('renders the same monochrome Home monogram at any requested size', () => {
  const markup = renderToStaticMarkup(createElement(HermesMark, { size: 18 }))
  expect(markup).toContain('width="18"')
  expect(markup).toContain('height="18"')
  expect(markup).toContain('viewBox="0 0 240 240"')
  expect(markup).toContain('M72 72v96M168 72v96M72 120h96')
  expect(markup.match(/<circle/g)).toHaveLength(2)
  expect(markup).not.toContain('Gradient')
})

it('ships identical app PNGs to the shell, standalone Docs, and renderer modules', () => {
  const master = asset('apps/shell/build/icon.png')
  for (const path of [
    'apps/docs/build/icon.png',
    'apps/shell/src/renderer/src/assets/app-icon.png',
    ...['docs', 'sheets', 'slides'].map((name) => `apps/${name}/src/renderer/assets/app-icon.png`),
  ])
    expect(asset(path).equals(master)).toBe(true)
})

it('keeps packaged macOS and Linux icon pixels neutral, including antialiased edges', () => {
  for (const path of [
    'apps/shell/build/icon-mac.png',
    'apps/shell/build/icon.png',
    ...[16, 32, 48, 64, 128, 256, 512, 1024].map(
      (size) => `apps/shell/build/icons/${size}x${size}.png`,
    ),
  ]) {
    const { data } = PNG.sync.read(asset(path))
    for (let at = 0; at < data.length; at += 4) {
      if (!data[at + 3]) continue
      if (data[at] !== data[at + 1] || data[at] !== data[at + 2])
        throw new Error(`Colored pixel in ${path}`)
    }
  }
})
