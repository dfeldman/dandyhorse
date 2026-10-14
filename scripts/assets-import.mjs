/**
 * Record the dandyhorse repo's own assets in its assetmgr indexes, so they live in the shared asset bucket and
 * not in git. Each file keeps a `localPath`, and `make assets` (assetmgr restore) puts it back there on a fresh
 * clone.
 *
 *   indexes/asset-index-dandyhorse-games.json            each game's screenshot (games/<id>/screenshot.*)
 *   games/trailtrainer/indexes/asset-index-trailtrainer.json
 *                                                        Trail Trainer's ground textures and baked routes
 *
 * Re-runnable: a file whose bytes changed replaces the old one (kept in the index as isDeleted); unchanged files
 * are skipped. Then upload: `make assets-upload` (needs the bucket's credentials, see ../assetmgr/README.md).
 *
 *   node scripts/assets-import.mjs
 */
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = join(import.meta.dirname, '..')
const ASSETMGR = process.env.ASSETMGR ?? join(ROOT, '..', 'assetmgr')
const { addFile, emptyIndex, indexFileName, loadRepo, saveIndex, serializeIndex, sha256Bytes, slugify } = await import(
  pathToFileURL(join(ASSETMGR, 'dist', 'node', 'index.js')).href
)

const DEFAULTS = { project: 'dandyhorse', projectName: 'Dandyhorse', repo: 'https://github.com/dfeldman/dandyhorse', license: 'CC0-1.0' }

async function ensureIndex(dir, name, description, defaults) {
  const path = join(ROOT, dir, indexFileName(name))
  if (existsSync(path)) return
  await mkdir(join(ROOT, dir), { recursive: true })
  await writeFile(path, serializeIndex({ ...emptyIndex(name, { ...DEFAULTS, ...defaults }), description }))
}

await ensureIndex('indexes', 'dandyhorse-games', "Each Dandyhorse game's screenshot (shown by the console)", { type: '2d', subtype: 'screenshot', folder: 'dandyhorse/games' })
await ensureIndex('games/trailtrainer/indexes', 'trailtrainer', "Trail Trainer's ground textures (Poly Haven, CC0) and baked route packages", { project: 'trailtrainer', projectName: 'Trail Trainer' })
const repo = await loadRepo(ROOT)
const idx = (name) => repo.indexes.find((l) => l.name === name)

/** Add `src` as asset `id`, or replace its file when the bytes changed (old one kept as isDeleted). */
async function upsert(index, id, src, asset, file = {}) {
  const bytes = await readFile(src)
  const a = idx(index).index.assets.find((x) => x.id === id)
  if (a?.assetFiles.some((f) => !f.isDeleted && f.hash === sha256Bytes(bytes))) return false
  if (a) for (const f of a.assetFiles) f.isDeleted = true
  await addFile(repo, { index, src, assetId: id, asset: { id, ...asset }, file: { isProd: true, localPath: relative(ROOT, src).split('\\').join('/'), ...file }, allowDuplicate: true })
  return true
}

let n = 0
// ---- game screenshots
for (const game of (await readdir(join(ROOT, 'games'))).sort()) {
  for (const ext of ['jpg', 'png', 'webp']) {
    const src = join(ROOT, 'games', game, `screenshot.${ext}`)
    if (existsSync(src) && await upsert('dandyhorse-games', slugify(`${game}-screenshot`), src, { name: `${game} screenshot`, assetKeywords: [game, 'screenshot'] })) n++
  }
}

// ---- Trail Trainer: ground textures (tools/textures.ts says which Poly Haven asset each came from)
const TT = join(ROOT, 'games', 'trailtrainer')
const texSrc = await readFile(join(TT, 'tools', 'textures.ts'), 'utf8')
const polyHaven = new Map([...texSrc.matchAll(/key:\s*'([^']+)',\s*asset:\s*'([^']+)'/g)].map((m) => [m[1], m[2]]))
for (const name of (await readdir(join(TT, 'public', 'textures'))).sort()) {
  const stem = name.replace(/\.[a-z]+$/, '')
  const key = stem.replace(/^canopy_/, '').replace(/_(diff|nor_gl|alpha)$/, '')
  const ph = polyHaven.get(key)
  const canopy = stem.startsWith('canopy_')
  if (await upsert('trailtrainer', slugify(`texture-${stem}`), join(TT, 'public', 'textures', name), {
    name: stem.replace(/_/g, ' '), type: '2d', subtype: 'texture', folder: 'trailtrainer/textures', assetKeywords: ['ground', key],
    ...(ph && !canopy ? { attribution: 'Poly Haven (polyhaven.com), CC0', sourceUrl: `https://polyhaven.com/a/${ph}`, clickUrl: `https://polyhaven.com/a/${ph}` } : {}),
    generator: { script: canopy ? 'trailtrainer/tools/canopies.ts' : 'trailtrainer/tools/textures.ts' },
    notes: canopy ? 'Leaf-card page composited by tools/canopies.ts from Poly Haven CC0 tree models.' : 'Fetched from Poly Haven by tools/textures.ts (npm run textures).',
  })) n++
}

// ---- Trail Trainer: baked routes (npm run bake: OpenStreetMap geometry and open elevation data, see CREDITS.md)
for (const name of (await readdir(join(TT, 'public', 'routes'))).sort()) {
  const route = name.split('.')[0]
  if (await upsert('trailtrainer', slugify(`route-${name.replace(/\./g, '-')}`), join(TT, 'public', 'routes', name), {
    name: `${route} ${name.slice(route.length + 1)}`, type: '3d', subtype: 'route', folder: 'trailtrainer/routes', assetKeywords: ['route', route],
    license: 'ODbL-1.0',
    attribution: '© OpenStreetMap contributors (ODbL); elevation from IGN RGE ALTI, USGS 3DEP and AWS Terrain Tiles (see Trail Trainer CREDITS.md)',
    generator: { script: 'trailtrainer/tools/bake.ts' },
    notes: 'A derived database under the ODbL: rebuilt from its open sources by `npm run bake` (tools/bake.ts).',
  })) n++
}

for (const l of repo.indexes) await saveIndex(l)
console.log(`${n} file(s) added or replaced`)
