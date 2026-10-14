/**
 * Fetches the ground textures, once, offline — the same rule the routes follow.
 *
 * The game asks nothing of the network while it runs, so the four surfaces the terrain is painted from are
 * downloaded here and checked in under `public/textures/`. They are Poly Haven's, CC0, which is the only
 * reason they can be redistributed with the game at all; anything added here has to be CC0 or CC-BY with the
 * attribution written into CREDITS.md, exactly as the elevation models are.
 *
 *   npm run textures            fetch anything missing
 *   npm run textures -- --force fetch everything again
 *
 * One kilometre-square page per map, which is enough: the ground is seen at a metre or two and at two
 * kilometres, and the detail that matters at a metre comes from tiling at two different scales rather than
 * from a bigger page. The normal maps are the OpenGL convention (`nor_gl`), which is what Babylon expects.
 */
import { mkdir, writeFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

/** The four things ground is made of, in the order the shader blends them. */
export const LAYERS = [
  { key: 'grass', asset: 'aerial_grass_rock', what: 'the ground where it is flat and low' },
  { key: 'dry', asset: 'brown_mud_leaves_01', what: 'worn, dry and dusty ground, and the strip beside the trail' },
  { key: 'rock', asset: 'rocky_terrain_02', what: 'too steep to hold anything' },
  { key: 'snow', asset: 'snow_02', what: 'above the snow line' },
] as const

/**
 * What the trail itself is made of. The names match `SurfaceName` in the route package, because that is what
 * OpenStreetMap said the route is surfaced with and the renderer looks it up by that name.
 */
export const SURFACES = [
  { key: 'paved', asset: 'asphalt_02', what: 'asphalt, as on a mountain road' },
  { key: 'gravel', asset: 'gravel_floor', what: 'packed limestone, as on a rail trail' },
  { key: 'dirt', asset: 'dirt_floor', what: 'bare earth' },
] as const

/**
 * The leaves themselves — pages of foliage photographed against nothing, which is what a card canopy is made
 * of. These come out of Poly Haven's tree MODELS rather than its texture library: the models are CC0 too, and
 * their leaf pages are exactly the atlas wanted, without the twenty megabytes of trunk maps that come with
 * downloading the whole tree. Each is a colour page and a separate mask.
 */
export const FOLIAGE = [
  { key: 'conifer', asset: 'pine_tree_01', colour: 'twig_diff', mask: 'twig_alpha', what: 'pine needles and twigs' },
  { key: 'broadleaf', asset: 'island_tree_01', colour: 'leaves_diff', mask: 'leaves_alpha', what: 'broadleaf foliage' },
  { key: 'bark', asset: 'pine_tree_01', colour: 'bark_diff', mask: null, what: 'tree bark' },
] as const

const MAPS = [
  { api: 'Diffuse', suffix: 'diff' },
  { api: 'nor_gl', suffix: 'nor_gl' },
] as const

const OUT = resolve(import.meta.dirname, '..', 'public', 'textures')

const exists = async (path: string): Promise<boolean> => {
  try { await stat(path); return true } catch { return false }
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force')
  await mkdir(OUT, { recursive: true })
  const credits: string[] = []

  for (const layer of [...LAYERS, ...SURFACES]) {
    const files = (await (await fetch(`https://api.polyhaven.com/files/${layer.asset}`)).json()) as Record<
      string,
      Record<string, Record<string, { url: string; size: number }>>
    >
    for (const map of MAPS) {
      const entry = files[map.api]?.['1k']?.jpg
      if (!entry) throw new Error(`textures: ${layer.asset} has no 1k jpg for ${map.api}`)
      const name = `${layer.key}_${map.suffix}.jpg`
      const path = resolve(OUT, name)
      if (!force && (await exists(path))) {
        process.stdout.write(`  ${name} — already here\n`)
        continue
      }
      const body = Buffer.from(await (await fetch(entry.url)).arrayBuffer())
      await writeFile(path, body)
      process.stdout.write(`  ${name} — ${(body.length / 1024).toFixed(0)} kB from ${layer.asset}\n`)
    }
    credits.push(`| ${layer.key} — ${layer.what} | [${layer.asset}](https://polyhaven.com/a/${layer.asset}) | CC0 |`)
  }

  // the foliage pages, which live under a different set of keys because they belong to models
  for (const f of FOLIAGE) {
    const files = (await (await fetch(`https://api.polyhaven.com/files/${f.asset}`)).json()) as Record<
      string,
      Record<string, Record<string, { url: string }>>
    >
    for (const [which, suffix] of [[f.colour, 'diff'], [f.mask, 'alpha']] as const) {
      if (!which) continue
      const entry = files[which]?.['1k']?.jpg
      if (!entry) throw new Error(`textures: ${f.asset} has no 1k jpg for ${which}`)
      const name = `${f.key}_${suffix}.jpg`
      const path = resolve(OUT, name)
      if (!force && (await exists(path))) { process.stdout.write(`  ${name} — already here\n`); continue }
      const body = Buffer.from(await (await fetch(entry.url)).arrayBuffer())
      await writeFile(path, body)
      process.stdout.write(`  ${name} — ${(body.length / 1024).toFixed(0)} kB from ${f.asset}\n`)
    }
    credits.push(`| ${f.key} — ${f.what} | [${f.asset}](https://polyhaven.com/a/${f.asset}) | CC0 |`)
  }

  console.log('\nFor CREDITS.md:\n')
  console.log('| Layer | Poly Haven asset | Licence |')
  console.log('|---|---|---|')
  for (const line of credits) console.log(line)
}

void main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
})
