import { describe, expect, it } from 'vitest'
import { bestStyleMatch, styleScore, type FaceRef } from '../src/sfnt'

const faces: FaceRef[] = [
  'Regular',
  'Bold',
  'BoldItalic',
  'Italic',
  'Semibold',
  'ExtraBold',
  'Book',
].map((style, offset) => ({ path: `${style}.ttf`, offset, style }))

describe('bestStyleMatch', () => {
  it('returns no face for an empty family', () => {
    expect(bestStyleMatch([], [])).toBeUndefined()
  })

  it.each([[], ['bold'], ['italic'], ['bold', 'italic'], ['semibold']])(
    'preserves stable-sort selection and input order for %j',
    (...want) => {
      for (let rotation = 0; rotation < faces.length; rotation++) {
        const candidates = [...faces.slice(rotation), ...faces.slice(0, rotation)]
        const original = [...candidates]
        const expected = [...candidates].sort(
          (a, b) => styleScore(b, want) - styleScore(a, want),
        )[0]
        expect(bestStyleMatch(candidates, want)).toBe(expected)
        expect(candidates).toEqual(original)
      }
    },
  )

  it('keeps the first candidate when scores tie', () => {
    const a = { path: 'first.ttf', offset: 0, style: 'Regular' }
    const b = { path: 'second.ttf', offset: 0, style: 'Regular' }
    expect(bestStyleMatch([a, b], [])).toBe(a)
  })
})
