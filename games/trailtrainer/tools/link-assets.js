// Puts the avatar kit's assets and the baked routes next to a build. public/mh and public/env are
// symlinks into the avatarkit repo's public/ (300 MB of MakeHuman data); copying them per build is not worth
// it, so vite skips publicDir entirely and this relinks. On Dandyhorse the platform serves the kit's
// assets itself at /avatars/mh/ and this script is not used.
import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const out = resolve(root, process.argv[2] ?? 'dist')
mkdirSync(out, { recursive: true })

for (const name of ['mh', 'env']) {
  const src = resolve(root, 'public', name)
  const dst = resolve(out, name)
  if (!existsSync(src)) { console.warn(`link-assets: public/${name} is missing — run tools/link-assets.js after creating it`); continue }
  rmSync(dst, { force: true, recursive: true })
  symlinkSync(src, dst)
}
// the baked routes and the ground textures: not in git, restored from the asset bucket (`make assets` at the
// dandyhorse root, or `npx assetmgr restore`)
for (const name of ['routes', 'textures']) {
  const src = resolve(root, 'public', name)
  if (!existsSync(src)) { console.warn(`link-assets: public/${name} is missing — run \`make assets\` in the dandyhorse root`); continue }
  cpSync(src, resolve(out, name), { recursive: true })
}
console.log(`link-assets: ${out} ready`)
