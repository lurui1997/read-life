import { describe, expect, it } from 'vitest'
import { normalizeThemePreference, resolveTheme, themeMark } from '../src/web/theme'

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

  it('主题用名字和颜色标出', () => {
    expect(themeMark('paper', false)).toEqual({ label: '纸本', color: '#2d5a47' })
    expect(themeMark('bamboo', false).label).toBe('青简')
    expect(themeMark('system', true)).toEqual({ label: '跟随系统', color: '#9dccb6' })
  })
})
