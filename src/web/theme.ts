export type ThemePreference = 'light' | 'dark' | 'system'

const storageKey = 'read-life.theme'

export const themeOptions: Array<{ id: ThemePreference; label: string }> = [
  { id: 'light', label: '白天' },
  { id: 'dark', label: '夜间' },
  { id: 'system', label: '跟随系统' },
]

export function readThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(storageKey)
    if (value === 'light' || value === 'dark' || value === 'system') return value
  } catch {
    // 隐私模式里读不到偏好时，按系统显示。
  }
  return 'system'
}

export function systemIsDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): 'light' | 'dark' {
  if (preference === 'system') return systemDark ? 'dark' : 'light'
  return preference
}

export function applyTheme(preference: ThemePreference): void {
  const resolved = resolveTheme(preference, systemIsDark())
  document.documentElement.dataset.theme = resolved
  document.documentElement.style.colorScheme = resolved
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#12100e' : '#f3ecdf')
}

export function writeThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(storageKey, preference)
  } catch {
    // 写不进时仍按这次选择显示。
  }
  applyTheme(preference)
}
