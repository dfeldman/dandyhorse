// Light/dark theme like the bridge: persisted in localStorage as dh.theme, applied as data-theme on <html>;
// 'system' leaves the attribute off so the CSS falls back to prefers-color-scheme.
export type Theme = 'system' | 'light' | 'dark'
export const THEME_KEY = 'dh.theme'
export const THEMES: Theme[] = ['system', 'light', 'dark']

export function parseTheme(v: string | null | undefined): Theme {
  return v === 'light' || v === 'dark' ? v : 'system'
}

/** The theme that is actually painted for a stored choice and the OS preference. */
export function resolveTheme(theme: Theme, prefersDark: boolean): 'light' | 'dark' {
  if (theme === 'system') return prefersDark ? 'dark' : 'light'
  return theme
}

/** The data-theme attribute value for a choice, or null when the attribute should be absent. */
export function themeAttribute(theme: Theme): string | null {
  return theme === 'system' ? null : theme
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function readTheme(): Theme {
  return parseTheme(storage()?.getItem(THEME_KEY))
}

export function applyTheme(theme: Theme, el: Element | null = typeof document === 'undefined' ? null : document.documentElement): void {
  if (!el) return
  const v = themeAttribute(theme)
  if (v === null) el.removeAttribute('data-theme')
  else el.setAttribute('data-theme', v)
}

export function setTheme(theme: Theme): void {
  try {
    storage()?.setItem(THEME_KEY, theme)
  } catch {
    // private mode: the choice lasts for this page only
  }
  applyTheme(theme)
}
