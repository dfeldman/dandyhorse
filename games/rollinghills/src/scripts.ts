/** Load classic (non-module) scripts in order, after the session is known. */
export function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.async = false // keep insertion order even if several are appended at once
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(`failed to load ${src}`))
    document.head.append(s)
  })
}

export async function loadScripts(srcs: string[]): Promise<void> {
  for (const src of srcs) await loadScript(src)
}

/** The game scripts, in dependency order (was the <script> list in the original index.html). */
export const GAME_SCRIPTS = [
  'config', 'rng', 'util', 'loop', 'biome', 'terrain', 'track', 'fields', 'decor',
  'decor/trees', 'decor/rocks', 'decor/flowers', 'decor/buildings', 'decor/bridges', 'decor/signs', 'decor/windmills',
  'decor/clouds', 'decor/birds', 'decor/balloons', 'decor/vehicles', 'decor/park', 'decor/props', 'decor/butterflies', 'decor/volcano',
  'bike', 'weather', 'ambient', 'daylight', 'segments', 'ride', 'camera', 'hud', 'main',
].map((n) => `js/${n}.js`)
