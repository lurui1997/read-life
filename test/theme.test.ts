import { describe, expect, it } from 'vitest'
import { resolveTheme } from '../src/web/theme'

describe('显示模式', () => {
  it('白天和夜间固定，跟随系统时采用系统的明暗', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
})
