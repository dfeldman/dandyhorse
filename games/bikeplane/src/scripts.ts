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
export const GAME_SCRIPTS = ['config', 'levels', 'input', 'track', 'sfx', 'plane', 'world', 'rings', 'rivals', 'hud', 'main']
  .map((n) => `js/${n}.js`)
