export type PageStyle = 'paper' | 'bamboo' | 'frost' | 'night'
export type ThemePreference = PageStyle | 'system'

const storageKey = 'read-life.theme'

export const themeOptions: Array<{ id: ThemePreference; label: string }> = [
  { id: 'paper', label: '纸本' },
  { id: 'bamboo', label: '青简' },
  { id: 'frost', label: '霜白' },
  { id: 'night', label: '夜间' },
  { id: 'system', label: '跟随系统' },
]

const styleMeta: Record<PageStyle, { scheme: 'light' | 'dark'; color: string }> = {
  paper: { scheme: 'light', color: '#f3ecdf' },
  bamboo: { scheme: 'light', color: '#d5e3d4' },
  frost: { scheme: 'light', color: '#e6eef1' },
  night: { scheme: 'dark', color: '#12100e' },
}

const aliases: Record<string, ThemePreference> = {
  light: 'paper',
  dark: 'night',
  paper: 'paper',
  bamboo: 'bamboo',
  frost: 'frost',
  night: 'night',
  system: 'system',
}

export function normalizeThemePreference(value: string | null): ThemePreference {
  if (!value) return 'system'
  return aliases[value] ?? 'system'
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): PageStyle {
  if (preference === 'system') return systemDark ? 'night' : 'paper'
  return preference
}

export function readThemePreference(): ThemePreference {
  try {
    return normalizeThemePreference(localStorage.getItem(storageKey))
  } catch {
    return 'system'
  }
}

export function systemIsDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function applyTheme(preference: ThemePreference): void {
  const style = resolveTheme(preference, systemIsDark())
  const meta = styleMeta[style]
  document.documentElement.dataset.theme = style
  document.documentElement.dataset.scheme = meta.scheme
  document.documentElement.style.colorScheme = meta.scheme
  const themeColor = document.querySelector('meta[name="theme-color"]')
  if (themeColor) themeColor.setAttribute('content', meta.color)
}

export function writeThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(storageKey, preference)
  } catch {
    // 写不进时仍按这次选择显示。
  }
  applyTheme(preference)
}
