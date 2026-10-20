// Country flags from the two-letter code on a profile (PLAN.md §18.1). A flag emoji is the two letters as
// Unicode regional indicators, so there is nothing to ship and no list to maintain; where a platform has no
// flag glyphs the two capitals appear instead, which is why the UI uses `flagOrCode`.
// (libs/gamekit/src/flags.ts is the same thing for games; the console does not depend on gamekit.)

const A = 0x1f1e6 // REGIONAL INDICATOR SYMBOL LETTER A
const CODE = /^[A-Za-z]{2}$/

export function flag(country: string | null | undefined): string {
  const c = (country || '').trim()
  if (!CODE.test(c)) return ''
  const up = c.toUpperCase()
  return String.fromCodePoint(A + up.charCodeAt(0) - 65, A + up.charCodeAt(1) - 65)
}

/** The flag, or the code in capitals where a flag would not render. */
export function flagOrCode(country: string | null | undefined): string {
  const c = (country || '').trim()
  return CODE.test(c) ? flag(c) || c.toUpperCase() : ''
}

/** 'ES' → 'Spain', in the viewer's language. */
export function countryName(country: string | null | undefined): string {
  const c = (country || '').trim().toUpperCase()
  if (!CODE.test(c)) return ''
  try {
    return new Intl.DisplayNames(undefined, { type: 'region' }).of(c) ?? c
  } catch {
    return c
  }
}

/** Every country a player can pick, named in the viewer's language and sorted that way. */
export function countryOptions(): { code: string; name: string; flag: string }[] {
  const codes: string[] = []
  for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) codes.push(String.fromCharCode(a, b))
  let dn: Intl.DisplayNames | null = null
  try {
    dn = new Intl.DisplayNames(undefined, { type: 'region', fallback: 'none' })
  } catch {
    dn = null
  }
  const out: { code: string; name: string; flag: string }[] = []
  for (const code of codes) {
    const name = dn?.of(code)
    // `fallback: 'none'` returns undefined for the combinations that are not countries, which is the filter.
    if (name && name !== code) out.push({ code, name, flag: flag(code) })
  }
  return out.sort((x, y) => x.name.localeCompare(y.name))
}
