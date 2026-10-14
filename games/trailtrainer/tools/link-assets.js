// Puts what a build needs next to it: the baked routes and the ground textures (not in git; restored from the
// asset bucket by `make assets` in the dandyhorse root). Trees, plants, rocks and avatars come from the bucket
// at run time, so nothing else is copied, and nothing is symlinked.
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const out = resolve(root, process.argv[2] ?? 'dist')
mkdirSync(out, { recursive: true })
for (const name of ['routes', 'textures']) {
  const src = resolve(root, 'public', name)
  if (!existsSync(src)) { console.warn(`link-assets: public/${name} is missing — run \`make assets\` in the dandyhorse root`); continue }
  cpSync(src, resolve(out, name), { recursive: true })
}
console.log(`link-assets: ${out} ready`)
