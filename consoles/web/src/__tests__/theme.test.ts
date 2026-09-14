import { describe, expect, test } from 'vitest'
import { applyTheme, parseTheme, resolveTheme, themeAttribute } from '../theme'

describe('theme', () => {
  test('parseTheme accepts light/dark, anything else is system', () => {
    expect(parseTheme('light')).toBe('light')
    expect(parseTheme('dark')).toBe('dark')
    expect(parseTheme(null)).toBe('system')
    expect(parseTheme('blue')).toBe('system')
  })
  test('resolveTheme honors prefers-color-scheme only when unset', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
  test('themeAttribute is absent for system', () => {
    expect(themeAttribute('system')).toBeNull()
    expect(themeAttribute('dark')).toBe('dark')
  })
  test('applyTheme sets and removes data-theme on the given element', () => {
    const attrs = new Map<string, string>()
    const el = {
      setAttribute: (k: string, v: string) => attrs.set(k, v),
      removeAttribute: (k: string) => attrs.delete(k),
    } as unknown as Element
    applyTheme('dark', el)
    expect(attrs.get('data-theme')).toBe('dark')
    applyTheme('system', el)
    expect(attrs.has('data-theme')).toBe(false)
  })
})
