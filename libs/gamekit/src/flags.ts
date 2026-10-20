/**
 * Country flags, from the two-letter code on a player's profile (`country`, PLAN.md §18.1).
 *
 * A flag emoji is just the two letters as Unicode regional indicators, so there is no image to ship and no
 * list to keep up to date. Platforms without flag glyphs (Windows) show the two letters instead, which is
 * why `flagOrCode()` is what the UI uses: something sensible appears either way.
 */

const A = 0x1f1e6 // REGIONAL INDICATOR SYMBOL LETTER A
const CODE = /^[A-Za-z]{2}$/

/** 'es' → '🇪🇸'. Empty string for anything that is not a two-letter code. */
export function flag(country: string | null | undefined): string {
  const c = (country || '').trim()
  if (!CODE.test(c)) return ''
  const up = c.toUpperCase()
  return String.fromCodePoint(A + up.charCodeAt(0) - 65, A + up.charCodeAt(1) - 65)
}

/** The flag, or the code in capitals where a flag would not render. Never empty for a valid code. */
export function flagOrCode(country: string | null | undefined): string {
  const c = (country || '').trim()
  return CODE.test(c) ? flag(c) || c.toUpperCase() : ''
}

/** 'ES' → 'Spain', in the viewer's own language. The code itself if the browser cannot name it. */
export function countryName(country: string | null | undefined, locale?: string): string {
  const c = (country || '').trim().toUpperCase()
  if (!CODE.test(c)) return ''
  try {
    const dn = new Intl.DisplayNames([locale ?? 'en'], { type: 'region' })
    return dn.of(c) ?? c
  } catch {
    return c
  }
}
