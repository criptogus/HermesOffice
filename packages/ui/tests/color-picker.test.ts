import { describe, expect, it } from 'vitest'
import { ColorPicker, THEME_COLORS, STANDARD_COLORS } from '../src/color-picker'

describe('ColorPicker exports and basic functionality', () => {
  it('exports theme colors and standard colors arrays', () => {
    expect(THEME_COLORS.length).toBe(10)
    expect(STANDARD_COLORS.length).toBe(10)
    expect(ColorPicker).toBeInstanceOf(Function)
  })
})
