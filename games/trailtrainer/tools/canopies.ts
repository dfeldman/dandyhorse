/**
 * Builds the canopy cards the trees are made of.
 *
 * A card-built tree needs pages of foliage — a handful of leaves or a sprig of needles, photographed against
 * nothing — and what Poly Haven's CC0 tree models actually ship is a page of loose parts: eight separate
 * leaves on black, or a sheet with two twigs, five cones and a lot of bark on it. Eight leaves is the wrong
 * unit. A card showing one leaf at crown size is a banana; a canopy built from forty single-leaf cards is
 * forty times the triangles for the same picture.
 *
 * So the loose parts are cut out here, once, offline, and composited into a cluster: the sprites are found by
 * flood-filling the mask, filtered down to the ones that are actually foliage rather than bark or a cone, and
 * scattered over an ellipse with a fixed seed. The result is one page per species that a dozen cards can build
 * a whole crown from.
 *
 *   npm run canopies
 *
 * Deterministic, like everything else placed in this world: the same seed gives the same canopy, so a tree
 * does not reshuffle its leaves between builds.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PNG } from 'pngjs'

const CACHE = resolve(import.meta.dirname, 'cache', 'foliage')
const OUT = resolve(import.meta.dirname, '..', 'public', 'textures')

interface Sprite {
  x0: number; y0: number; x1: number; y1: number
  pixels: number
  green: number
}

/** A small deterministic generator, so a canopy is the same page every time it is built. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** Every separate blob in the mask, with how green it is, found by flood fill. */
function findSprites(mask: PNG, colour: PNG, cutoff: number): Sprite[] {
  const { width: w, height: h } = mask
  const seen = new Uint8Array(w * h)
  const sprites: Sprite[] = []
  const stack: number[] = []
  const solid = (i: number): boolean => mask.data[i * 4] > cutoff
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || !solid(start)) continue
    let x0 = w, y0 = h, x1 = 0, y1 = 0, pixels = 0, green = 0
    stack.length = 0
    stack.push(start)
    seen[start] = 1
    while (stack.length) {
      const i = stack.pop() as number
      const x = i % w
      const y = (i / w) | 0
      pixels++
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
      const r = colour.data[i * 4]
      const g = colour.data[i * 4 + 1]
      const b = colour.data[i * 4 + 2]
      // how much this pixel leans green, which is what separates a leaf from bark or a cone
      green += g - (r + b) / 2
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const j = ny * w + nx
        if (seen[j] || !solid(j)) continue
        seen[j] = 1
        stack.push(j)
      }
    }
    sprites.push({ x0, y0, x1, y1, pixels, green: green / pixels })
  }
  return sprites
}

interface Recipe {
  key: string
  /** how many sprites to scatter */
  count: number
  /** the page to draw onto, square */
  size: number
  /** the ellipse the cluster fills, as a fraction of the page */
  spread: [number, number]
  /** each sprite drawn this big, as a fraction of the page */
  scale: [number, number]
  /** how far a sprite may turn from upright, in radians */
  turn: number
  /** a sprite must be at least this green, and this many pixels, to be foliage rather than bark */
  minGreen: number
  minPixels: number
  maxPixels: number
  seed: number
  /**
   * Darken the foot of the page. Grass sits in shade at its own base — the blades shadow each other and the
   * ground between them — and without it a tuft looks stuck onto the surface rather than growing out of it.
   * Every stylised-grass shader worth the name does this; doing it in the page costs nothing at run time.
   */
  rootShade?: number
  /**
   * Stand each sprite on end before turning it. Grass blades are cut out of the page lying at whatever angle
   * they were photographed, and a tuft of blades lying down is a pile of clippings; this turns any sprite
   * wider than it is tall through a right angle first, so the tuft grows upward.
   */
  upright?: boolean
}

const RECIPES: Recipe[] = [
  {
    // Small and many. The first version drew sixty-four leaves at a fifth of the page each, and on a four-metre
    // card that is a leaf the size of a dinner plate — the crowns read as a bunch of giant leaves, not as
    // foliage. Four hundred at a twentieth of the page puts a leaf at about fifteen centimetres, which is what
    // a leaf is, and the card reads as a mass of them.
    key: 'broadleaf', count: 900, size: 512, spread: [0.42, 0.36], scale: [0.045, 0.095],
    turn: Math.PI, minGreen: 6, minPixels: 2000, maxPixels: 400000, seed: 12345,
  },
  {
    // the fir sheet carries cones and bare bark as well as needles, so this leans hard on the green test
    key: 'conifer', count: 160, size: 512, spread: [0.42, 0.34], scale: [0.12, 0.22],
    turn: 0.6, minGreen: 14, minPixels: 1500, maxPixels: 400000, seed: 999,
  },
  {
    // A tuft, not a cluster: blades want to stand up and fan out from a point, so they are barely turned and
    // the spread is wide and shallow. This is what the ground is covered in, which is most of what makes a
    // hillside read as alive rather than as a painted surface.
    // the vertical spread is what keeps the top ragged: blades all rooted at one height make a clipped hedge
    // and kept well inside the page: a blade that runs to the edge of the card gives the tuft a straight side,
    // and a field of straight-sided tufts is a field of boxes
    key: 'grass', count: 170, size: 512, spread: [0.24, 0.22], scale: [0.24, 0.56],
    // the page carries as much dead straw as green blade; this keeps the living ones, or a summer meadow
    // comes out the colour of a thatched roof
    turn: 0.28, minGreen: 3, minPixels: 400, maxPixels: 400000, seed: 4242, upright: true, rootShade: 0.3,
  },
]

async function build(r: Recipe): Promise<void> {
  const colour = PNG.sync.read(await readFile(resolve(CACHE, `${r.key}_diff.png`)))
  const mask = PNG.sync.read(await readFile(resolve(CACHE, `${r.key}_alpha.png`)))
  const all = findSprites(mask, colour, 100)
  const sprites = all
    .filter((s) => s.pixels >= r.minPixels && s.pixels <= r.maxPixels && s.green >= r.minGreen)
    .sort((a, b) => b.pixels - a.pixels)
  if (!sprites.length) throw new Error(`canopies: nothing in ${r.key} looked like foliage (${all.length} blobs)`)
  process.stdout.write(`  ${r.key}: ${sprites.length} of ${all.length} blobs are foliage\n`)

  const out = new PNG({ width: r.size, height: r.size })
  out.data.fill(0)
  const rand = rng(r.seed)

  for (let n = 0; n < r.count; n++) {
    const sp = sprites[Math.floor(rand() * sprites.length)]
    const sw = sp.x1 - sp.x0 + 1
    const sh = sp.y1 - sp.y0 + 1
    // drawn at a size set by its longest side, so a small leaf is not blown up to match a big one
    const target = (r.scale[0] + rand() * (r.scale[1] - r.scale[0])) * r.size
    const k = target / Math.max(sw, sh)
    const stand = r.upright && sw > sh ? Math.PI / 2 : 0
    const angle = stand + (rand() - 0.5) * 2 * r.turn
    const ca = Math.cos(angle)
    const sa = Math.sin(angle)
    // inside an ellipse, biased toward the middle so the cluster has a dense heart and a ragged edge
    const t = rand() * Math.PI * 2
    const rad = Math.sqrt(rand())
    const cx = r.size / 2 + Math.cos(t) * rad * r.spread[0] * r.size
    const cy = (r.upright ? r.size * 0.62 : r.size / 2) + Math.sin(t) * rad * r.spread[1] * r.size
    // the drawn footprint, generously bounded, then sampled back into the sprite
    const reach = Math.ceil((Math.max(sw, sh) * k) / 2) + 2
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const px = Math.round(cx + dx)
        const py = Math.round(cy + dy)
        if (px < 0 || py < 0 || px >= r.size || py >= r.size) continue
        // rotate back into the sprite's own frame
        const ux = (dx * ca + dy * sa) / k + sw / 2
        const uy = (-dx * sa + dy * ca) / k + sh / 2
        if (ux < 0 || uy < 0 || ux >= sw || uy >= sh) continue
        const si = ((sp.y0 + (uy | 0)) * mask.width + (sp.x0 + (ux | 0))) * 4
        const a = mask.data[si] / 255
        if (a < 0.45) continue
        const di = (py * r.size + px) * 4
        out.data[di] = colour.data[si]
        out.data[di + 1] = colour.data[si + 1]
        out.data[di + 2] = colour.data[si + 2]
        out.data[di + 3] = 255
      }
    }
  }

  if (r.rootShade) {
    // over the bottom third, easing to full darkness at the very foot
    for (let y = 0; y < r.size; y++) {
      const t = y / (r.size - 1)
      if (t < 0.62) continue
      const k = Math.min(1, (t - 0.62) / 0.38)
      const f = 1 - r.rootShade * k * k
      for (let x = 0; x < r.size; x++) {
        const i = (y * r.size + x) * 4
        out.data[i] *= f
        out.data[i + 1] *= f
        out.data[i + 2] *= f
      }
    }
  }

  // A hard alpha edge shimmers when a tree is a hundred metres away and covers four pixels. Bleeding the
  // colour outward one step means the filtered edge fades to leaf colour rather than to black.
  const copy = Buffer.from(out.data)
  for (let y = 1; y < r.size - 1; y++) {
    for (let x = 1; x < r.size - 1; x++) {
      const i = (y * r.size + x) * 4
      if (copy[i + 3] > 0) continue
      let rr = 0, gg = 0, bb = 0, n = 0
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const j = ((y + dy) * r.size + (x + dx)) * 4
        if (copy[j + 3] === 0) continue
        rr += copy[j]; gg += copy[j + 1]; bb += copy[j + 2]; n++
      }
      if (!n) continue
      out.data[i] = rr / n
      out.data[i + 1] = gg / n
      out.data[i + 2] = bb / n
    }
  }

  const path = resolve(OUT, `canopy_${r.key}.png`)
  await writeFile(path, PNG.sync.write(out))
  const covered = (() => { let c = 0; for (let i = 3; i < out.data.length; i += 4) if (out.data[i] > 0) c++; return c })()
  process.stdout.write(`  canopy_${r.key}.png — ${(PNG.sync.write(out).length / 1024).toFixed(0)} kB, ${((covered / (r.size * r.size)) * 100).toFixed(0)}% covered\n`)
}

async function main(): Promise<void> {
  for (const r of RECIPES) await build(r)
}

void main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
})
