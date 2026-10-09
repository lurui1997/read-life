import { describe, expect, it } from 'vitest'
import { normalizeThemePreference, resolveTheme } from '../src/web/theme'

describe('页面风格', () => {
  it('旧的白天和夜间偏好仍能对上新风格', () => {
    expect(normalizeThemePreference('light')).toBe('paper')
    expect(normalizeThemePreference('dark')).toBe('night')
    expect(normalizeThemePreference('bamboo')).toBe('bamboo')
    expect(normalizeThemePreference('nope')).toBe('system')
    expect(normalizeThemePreference(null)).toBe('system')
  })

  it('跟随系统只在纸本和夜间之间切换', () => {
    expect(resolveTheme('system', false)).toBe('paper')
    expect(resolveTheme('system', true)).toBe('night')
    expect(resolveTheme('frost', true)).toBe('frost')
  })
})
