/**
 * Building a tree out of cards.
 *
 * A crown is not geometry you can afford to model. The Katy Trail's forest is twenty-two trees a hectare over
 * a kilometre of ground, which is thousands of them on screen, and a few thousand triangles each would be
 * tens of millions. What every game has done about this since the 1990s is draw the foliage as flat pages of
 * leaves — photographs with the background cut away — arranged so that from any angle you are looking through
 * several of them. A dozen cards is twenty-four triangles and reads as a crown; the lollipop it replaces was
 * a hundred triangles and read as a lollipop.
 *
 * The pages come from `npm run canopies`, which cuts leaves and needles out of Poly Haven's CC0 tree models
 * and composites them into clusters (see tools/canopies.ts). Two species: needles arranged up a spire, and
 * broadleaves arranged round a ball.
 *
 * The cards are placed so the tree never looks like cardboard from a bad angle. A crown of parallel pages
 * disappears when you view it edge-on, so each one is turned to face a different direction around the trunk
 * and tilted by a different amount, and the whole set is dense enough that at least three are near-facing
 * from anywhere on the ground.
 *
 * Trunks are separate meshes because they are opaque and the canopy is not, and a single material cannot be
 * both without alpha-testing the bark as well.
 */
import { Mesh, type Scene, VertexData } from '@babylonjs/core'

export type TreeKind = 'conifer' | 'broadleaf' | 'bush'

/** A deterministic generator, so a species is the same shape in every session. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

interface Card {
  /** where the card's centre sits, in metres, relative to the foot of the tree */
  x: number; y: number; z: number
  /** how wide and tall the page is drawn, in metres */
  w: number; h: number
  /**
   * Which way the card faces — and, because a card IS the surface of the crown as far as light is concerned,
   * the normal every one of its corners is given. Carrying the direction rather than a yaw and a tilt is what
   * lets a broadleaf's pages sit tangent to a ball and a conifer's droop outward and down like boughs.
   */
  nx: number; ny: number; nz: number
  /** turned within its own plane, so two cards facing the same way do not look like the same card */
  roll: number
}

/**
 * Where the cards go.
 *
 * Two things had to be fixed here after looking at the first version on a hillside, and both are the kind of
 * thing only a picture tells you.
 *
 * **You could count the sides.** Fourteen cards at evenly spaced angles is not a crown, it is a lantern: the
 * eye finds the repeat immediately and the tree reads as a few flat boards. The cure is more of them, at
 * angles spread by the golden angle rather than divided evenly, each rolled within its own plane and varied
 * in size, so no two are the same card and there is no spacing to find.
 *
 * **The conifer was upside down.** Its pages narrowed to nothing at the top while its trunk ran the full
 * height, so what you saw was a bare pole standing out of a dark bush. A fir is the other way round: bare
 * trunk for the first fifth and foliage all the way to a point. The crown now reaches the top, the topmost
 * pages keep a minimum size, and the trunk stops inside the crown rather than above it.
 */
/** A limb: a tapered length of wood from somewhere on the trunk out to where the foliage hangs. */
interface Limb {
  x0: number; y0: number; z0: number
  x1: number; y1: number; z1: number
  r0: number; r1: number
}

function layout(kind: TreeKind, height: number): {
  cards: Card[]
  limbs: Limb[]
  trunkHeight: number
  trunkRadius: number
} {
  const rand = rng(kind === 'conifer' ? 7771 : kind === 'bush' ? 3313 : 5519)
  const cards: Card[] = []
  /** the angle that spreads points round a circle without ever repeating a spacing */
  const GOLDEN = 2.39996323

  if (kind === 'conifer') {
    const from = height * 0.16
    const top = height * 0.99
    const count = 30
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count
      const y = from + (top - from) * t
      // a cone: widest at the skirt, narrowing to a point, with a floor so the tip is not a bare spike
      const radius = height * 0.30 * (1 - t) ** 0.75 + height * 0.035
      const a = i * GOLDEN + rand() * 0.25
      // boughs reach outward and hang: the normal leans down as well as out
      const droop = 0.30 + t * 0.25
      const len = Math.hypot(1, droop)
      cards.push({
        x: Math.cos(a) * radius * 0.5,
        y,
        z: Math.sin(a) * radius * 0.5,
        w: radius * (1.5 + rand() * 0.5),
        h: radius * (1.0 + rand() * 0.45),
        nx: Math.cos(a) / len,
        ny: -droop / len,
        nz: Math.sin(a) / len,
        roll: (rand() - 0.5) * 0.5,
      })
    }
    // stops inside the crown, not above it
    return { cards, limbs: [], trunkHeight: height * 0.72, trunkRadius: height * 0.020 }
  }

  // a bush is a crown with no trunk under it, sitting on the ground
  const bush = kind === 'bush'
  const centre = bush ? height * 0.42 : height * 0.66
  const radius = bush ? height * 0.52 : height * 0.34
  // A bush is nothing but a shell of pages. A tree has limbs to hang its leaves on, and a shell laid over
  // them belongs to nothing — those were the pages that appeared to float, because there was no limb under
  // them and nothing beside them.
  const count = bush ? 22 : 0

  // The limbs, and the foliage hung on their ends.
  //
  // A tree is not a pole with a ball on top, and that is what this was. What reads as a tree — look at any
  // photograph of an orchard or a wood edge — is the fork: a trunk that divides into a few limbs reaching up
  // and out, with the leaves gathered at their ends and sky visible between them. Without the limbs the crown
  // is a solid lump that could as easily be a bush on a stick, and no amount of work on the leaf page fixes
  // that, because what is wrong is the silhouette.
  const limbs: Limb[] = []
  if (!bush) {
    const forkFrom = height * 0.22
    const trunkTop = height * 0.48
    const trunkR = height * 0.028
    const arms = 8
    for (let i = 0; i < arms; i++) {
      const yaw = (i / arms) * Math.PI * 2 + rand() * 0.8
      const y0 = forkFrom + (trunkTop - forkFrom) * ((i + rand()) / arms) * 0.9
      // Kept inside where the leaves will be. A limb that reaches past its own foliage is a bare pole
      // sticking out of a tree, which is the one thing worse than no limbs at all.
      // Lengths spread widely on purpose. Limbs of one length put every cluster of leaves on one sphere,
      // which is the ball this was trying to stop being; uneven ones give the lumpy, gappy outline a tree
      // actually has.
      // Reaching out more than up. Limbs that mostly climb give a tall narrow crown standing on a long bare
      // pole; a broadleaf in the open spreads, and the spread is what puts the leaves where they are seen.
      const out = radius * (0.48 + rand() * 0.44)
      const up = height * (0.04 + rand() * 0.16)
      const x1 = Math.cos(yaw) * out
      const z1 = Math.sin(yaw) * out
      const y1 = y0 + up
      limbs.push({ x0: 0, y0, z0: 0, x1, y1, z1, r0: trunkR * 0.34, r1: trunkR * 0.05 })
      // and the leaves gathered around where each limb ends
      // Many small pages rather than a few big ones. A card a third the width of the whole crown is a slab,
      // and three slabs is what the crown was: at any angle you saw two or three flat faces, which is why it
      // read as a lump however the limbs were arranged. At a quarter the size and eight times the number the
      // same triangles buy a surface with a broken edge, and the gaps between the pages are what let the sky
      // through — which is most of what says "tree" from a distance.
      for (let c = 0; c < 30; c++) {
        // Strung along the limb, and kept CLOSE to it. Scattering them half a crown-radius off the limb was
        // what left cards hanging in mid-air with nothing behind them: a page on its own, away from the mass,
        // has no other pages to read as part of, so it reads as a leaf the size of a door floating beside the
        // tree. Tight to the limb they overlap each other and become foliage.
        // reaching just past the tip, so no bare wood is left on the end of a limb
        const along = 0.30 + rand() * 0.74
        // Widening toward the tip, the way a branch ramifies. A constant spread is the trap at both ends:
        // wide all the way and the pages nearest the trunk hang in mid-air, tight all the way and each limb
        // becomes a green sausage that never merges with the next. A cone of leaves round each limb, broad
        // where it ends, is what joins up into a crown.
        const spread = radius * (0.08 + 0.52 * along)
        const px = x1 * along + (rand() - 0.5) * spread
        const py = y0 + (y1 - y0) * along + (rand() - 0.5) * spread * 0.8
        const pz = z1 * along + (rand() - 0.5) * spread
        const nl = Math.hypot(px, py - centre, pz) || 1
        cards.push({
          x: px, y: py, z: pz,
          w: radius * (0.27 + rand() * 0.22),
          h: radius * (0.23 + rand() * 0.19),
          nx: px / nl, ny: (py - centre) / nl, nz: pz / nl,
          roll: rand() * Math.PI * 2,
        })
      }
    }
  }

  for (let i = 0; i < count; i++) {
    // points spread over a sphere: even in height, golden-angle around, which is as close to evenly
    // scattered as anything this cheap gets
    const u = (i + 0.5) / count
    // A crown is a ball with its lowest leaves well clear of the ground; a bush is a DOME sitting on it. Run
    // as a ball, a bush's dozen cards left a hollow underneath and the thing appeared to hover — which is
    // exactly what it looked like from the road.
    const cy = bush ? 1 - u * 1.25 : 1 - 2 * u * 0.92
    const ring = Math.sqrt(Math.max(0.05, 1 - cy * cy))
    const a = i * GOLDEN + rand() * 0.3
    const dx = Math.cos(a) * ring
    const dz = Math.sin(a) * ring
    const out = 0.44 + rand() * 0.30
    cards.push({
      x: dx * radius * out,
      y: centre + cy * radius * out * 0.92,
      z: dz * radius * out,
      w: radius * (0.24 + rand() * 0.20),
      h: radius * (0.21 + rand() * 0.17),
      nx: dx,
      ny: cy,
      nz: dz,
      roll: rand() * Math.PI * 2,
    })
  }
  return { cards, limbs, trunkHeight: bush ? 0 : height * 0.60, trunkRadius: height * 0.028 }
}

/** One quad per card, all merged into a single mesh so a whole crown is one thin instance. */
export function buildCanopy(scene: Scene, name: string, kind: TreeKind, height: number): Mesh {
  const { cards } = layout(kind, height)
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  for (const c of cards) {
    const base = positions.length / 3
    const nl = Math.hypot(c.nx, c.ny, c.nz) || 1
    const nx = c.nx / nl
    const ny = c.ny / nl
    const nz = c.nz / nl
    // a pair of axes in the card's plane; the reference is swapped near the poles so the cross product
    // never collapses
    const rx = Math.abs(ny) > 0.9 ? 1 : 0
    const ry = Math.abs(ny) > 0.9 ? 0 : 1
    let ax = ry * nz - 0 * ny
    let ay = 0 * nx - rx * nz
    let az = rx * ny - ry * nx
    const al = Math.hypot(ax, ay, az) || 1
    ax /= al; ay /= al; az /= al
    const ux = ny * az - nz * ay
    const uy = nz * ax - nx * az
    const uz = nx * ay - ny * ax
    // turned within its own plane
    const cr = Math.cos(c.roll)
    const sr = Math.sin(c.roll)
    const px = ax * cr + ux * sr
    const py = ay * cr + uy * sr
    const pz = az * cr + uz * sr
    const qx = -ax * sr + ux * cr
    const qy = -ay * sr + uy * cr
    const qz = -az * sr + uz * cr

    for (const [sx, sv] of [[-1, 0], [1, 0], [1, 1], [-1, 1]] as const) {
      const hh = (sv - 0.5) * c.h
      const ww = sx * c.w * 0.5
      positions.push(c.x + px * ww + qx * hh, c.y + py * ww + qy * hh, c.z + pz * ww + qz * hh)
      // The card is lit as the surface of the crown, not as a flat plane. A true plane normal makes a tree
      // read as a stack of boards, one face bright and the next black.
      normals.push(nx, ny, nz)
      uvs.push((sx + 1) / 2, sv)
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  const mesh = new Mesh(name, scene)
  const data = new VertexData()
  data.positions = positions
  data.normals = normals
  data.uvs = uvs
  data.indices = indices
  data.applyToMesh(mesh, false)
  return mesh
}

/** A tapered trunk. Five sides is plenty: it is mostly hidden and mostly in shadow. */
export function buildTrunk(scene: Scene, name: string, kind: TreeKind, height: number): Mesh {
  const { trunkHeight, trunkRadius, limbs } = layout(kind, height)
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  /** A tapered length of wood as a five-sided tube. Five is plenty: it is mostly hidden, and mostly shaded. */
  const wood = (
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    r0: number, r1: number,
  ): void => {
    const dx = x1 - x0
    const dy = y1 - y0
    const dz = z1 - z0
    const len = Math.hypot(dx, dy, dz) || 1
    const ux = dx / len
    const uy = dy / len
    const uz = dz / len
    // any two axes square to the limb
    const refY = Math.abs(uy) > 0.9 ? 0 : 1
    const refX = Math.abs(uy) > 0.9 ? 1 : 0
    let ax = refY * uz - 0 * uy
    let ay = 0 * ux - refX * uz
    let az = refX * uy - refY * ux
    const al = Math.hypot(ax, ay, az) || 1
    ax /= al; ay /= al; az /= al
    const bx = uy * az - uz * ay
    const by = uz * ax - ux * az
    const bz = ux * ay - uy * ax

    const sides = 5
    const base = positions.length / 3
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      const nx = ax * ca + bx * sa
      const ny = ay * ca + by * sa
      const nz = az * ca + bz * sa
      for (const [t, r] of [[0, r0], [1, r1]] as const) {
        positions.push(x0 + dx * t + nx * r, y0 + dy * t + ny * r, z0 + dz * t + nz * r)
        normals.push(nx, ny, nz)
        uvs.push((i / sides) * 2, t * len * 0.4)
      }
    }
    for (let i = 0; i < sides; i++) {
      const a = base + i * 2
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }

  // the trunk, flaring a little where it meets the ground
  wood(0, 0, 0, 0, trunkHeight, 0, trunkRadius * 1.35, trunkRadius * 0.5)
  for (const l of limbs) wood(l.x0, l.y0, l.z0, l.x1, l.y1, l.z1, l.r0, l.r1)

  const mesh = new Mesh(name, scene)
  const data = new VertexData()
  data.positions = positions
  data.normals = normals
  data.uvs = uvs
  data.indices = indices
  data.applyToMesh(mesh, false)
  return mesh
}

/**
 * A clump of real grass blades — geometry, not a picture of grass.
 *
 * This replaces a card with a photograph of a tuft printed on it, and the reason is worth setting down,
 * because the card was cheaper by every measure that is easy to count. A card tuft was six triangles; this is
 * forty-odd. But a card is alpha-tested, and alpha-tested foliage is the most expensive thing a renderer
 * does per pixel rather than per triangle: every blade-shaped hole is a shaded fragment thrown away, the
 * cards overlap so the same pixels are shaded several times over, and the cut-out edges alias. Triangles are
 * nearly free on a modern part and overdraw is not. Every studio that has published on stylized grass — Ghost
 * of Tsushima above all — draws individual blades as solid geometry for exactly this reason.
 *
 * It also fixes the thing no amount of tuning fixed: a photograph of grass on a flat card is a photograph of
 * grass on a flat card. It has no silhouette of its own, it cannot catch light along its length, and from the
 * side it is a sheet. A blade is a blade from any angle.
 *
 * The shape is a quadratic Bezier — root, a control point above it, a tip bent over — which is what gives a
 * blade its droop, and the tangent along that curve is what the lighting uses. The normals are fanned across
 * the width rather than left flat, so a blade reads as a rounded strap catching a highlight down one side
 * instead of as a flat ribbon that flips from lit to unlit as it turns.
 *
 * Variation is baked in per blade — height, bend, facing, brightness — because within one clump the blades
 * should differ from each other, while the clump as a whole takes its colour from the ground it stands in
 * (that arrives per instance). Clumping itself is the point: grass grows in tussocks, and scattering single
 * blades evenly gives a lawn nobody has ever seen outdoors.
 */
export function buildBladeTuft(scene: Scene, name: string, height: number, blades = 6): Mesh {
  const rand = rng(90210)
  const positions: number[] = []
  const normals: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  /**
   * Rows up the blade; the last is the tip and is a single vertex.
   *
   * Four rather than five, which is five triangles a blade rather than seven. A blade is a strap a couple of
   * centimetres wide and thirty long that is never seen from closer than a metre and a half — the bend in it
   * needs three segments to read as a bend and does not need four. Grass was measured as the largest single
   * item in the frame by a wide margin, and this is a fifth of it for a difference that cannot be seen.
   */
  const ROWS = [0, 0.4, 0.74, 1]
  const GOLDEN = 2.39996323

  for (let b = 0; b < blades; b++) {
    const yaw = b * GOLDEN + rand() * 0.9
    const fx = Math.cos(yaw)
    const fz = Math.sin(yaw)
    // across the blade, horizontal and square to the way it faces
    const sx = -fz
    const sz = fx
    /**
     * A blade of grass ARCHES. It does not stand up.
     *
     * Every number here used to describe a spike: a blade of nearly constant height, leaning a tenth of its
     * own length, with its tip almost as high as it could be. A clump of those reads as a sprout or a small
     * spiky succulent, and a field of them reads as a lawn of sprouts on a painted surface — which is exactly
     * what the verges looked like from the saddle.
     *
     * Real grass, uncut, is mostly bent over. A blade grows up for a third of its length and then the weight
     * of it takes over, so the tip ends up well out from the root and well below where it would have reached
     * standing — and it is the mass of those arcs crossing each other, not the blades themselves, that makes a
     * meadow look soft. So: the tips reach out around half a blade's length, they land two thirds of the way
     * up rather than nine tenths, and the heights vary far more, because a sward of one length is a lawn.
     */
    const h = height * (0.45 + rand() * 0.85)
    // thin. Fat blades read as aloe or spring onion; grass is a strap a few millimetres across, and what
    // makes a clump look full is the number of them, not the width of each
    const halfWidth = height * (0.022 + rand() * 0.02)
    const reach = h * (0.28 + rand() * 0.55)
    const tipY = h * (0.52 + rand() * 0.32)
    // blades stand a little apart from each other rather than all from one point
    const spread = height * (0.12 + rand() * 0.5)
    const ox = fx * spread
    const oz = fz * spread
    // no two blades quite the same shade, before the clump's own colour is applied over the top
    const shade = 0.82 + rand() * 0.30

    const base = positions.length / 3
    for (let r = 0; r < ROWS.length; r++) {
      const t = ROWS[r]
      const u = 1 - t
      // quadratic Bezier: root at the ground, control point straight up, tip bent over
      const cy = 2 * u * t * (h * 0.72) + t * t * tipY
      const cf = t * t * reach
      // and its tangent, which is the direction the blade is running at this height
      const dy = 2 * u * (h * 0.72) + 2 * t * (tipY - h * 0.72)
      const df = 2 * t * reach
      const dl = Math.hypot(dy, df) || 1
      // the face of the blade points square to both its length and its width
      const nfx = (dy / dl) * fx
      const nfy = -(df / dl)
      const nfz = (dy / dl) * fz

      // tapering to a point, fastest near the tip
      const w = halfWidth * (1 - t) ** 0.55
      // Ambient occlusion down at the root. Grass sits in its own shade and a blade that is as bright at the
      // ground as it is at the tip looks like it is hovering over the terrain rather than growing out of it.
      const ao = (0.34 + 0.66 * t ** 0.7) * shade

      const cols = r === ROWS.length - 1 ? [0] : [-1, 1]
      for (const side of cols) {
        positions.push(ox + fx * cf + sx * side * w, cy, oz + fz * cf + sz * side * w)
        // Fanned across the width, so the blade lights like a rounded strap rather than a flat ribbon. This
        // is the one lighting detail that most makes procedural blades stop looking like paper.
        const cn = 0.55 * side
        const nx = nfx + sx * cn
        const ny = nfy
        const nz = nfz + sz * cn
        const nl = Math.hypot(nx, ny, nz) || 1
        normals.push(nx / nl, ny / nl, nz / nl)
        colors.push(ao, ao, ao, 1)
      }
    }

    // rows of two, closed off by a triangle at the tip
    for (let r = 0; r < ROWS.length - 2; r++) {
      const a = base + r * 2
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
    const last = base + (ROWS.length - 2) * 2
    indices.push(last, last + 2, last + 1)
  }

  const mesh = new Mesh(name, scene)
  const data = new VertexData()
  data.positions = positions
  data.normals = normals
  data.colors = colors
  data.indices = indices
  data.applyToMesh(mesh, false)
  return mesh
}
