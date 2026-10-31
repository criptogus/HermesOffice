import { beforeEach, expect, it, vi } from 'vitest'

const getFontIndex = vi.hoisted(() =>
  vi.fn(() => ({ byPs: new Map(), byFamily: new Map(), allFaces: [] })),
)
vi.mock('../src/sfnt', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/sfnt')>()),
  getFontIndex,
}))

beforeEach(() => {
  vi.resetModules()
  getFontIndex.mockClear()
})

it('caches misses without conflating distinct text', async () => {
  const { findFontCovering } = await import('../src/font-locate')
  expect(findFontCovering('missing 🦄')).toBeNull()
  expect(findFontCovering('missing 🦄')).toBeNull()
  expect(getFontIndex).toHaveBeenCalledTimes(1)
  expect(findFontCovering('other text')).toBeNull()
  expect(getFontIndex).toHaveBeenCalledTimes(2)
})

it('bounds retained queries and rescans an evicted query', async () => {
  const { findFontCovering } = await import('../src/font-locate')
  for (let i = 0; i < 129; i++) findFontCovering(`query-${i}`)
  expect(getFontIndex).toHaveBeenCalledTimes(129)
  findFontCovering('query-128')
  expect(getFontIndex).toHaveBeenCalledTimes(129)
  findFontCovering('query-0')
  expect(getFontIndex).toHaveBeenCalledTimes(130)
})
