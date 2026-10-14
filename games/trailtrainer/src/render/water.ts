/**
 * Rivers, lakes and streams: where they are, and the surface drawn over them.
 *
 * The shapes come from OpenStreetMap, baked into `<route>.water.json` by tools/water.ts and loaded here if it
 * exists. The Missouri's banks and the Romanche's are mapped as polygons; a creek or an alpine torrent is only
 * a line, with a width, and is treated as a corridor about that line.
 *
 * **The map says where water is allowed to be. The ground says where it actually is.**
 *
 * That distinction is the whole design. A polygon straight off the map, laid down as a flat sheet at its own
 * level, gives a hard geometric edge that cuts across the hillside wherever the two disagree — and they always
 * disagree, because the bank was drawn by somebody tracing an aerial photograph and the ground comes from a
 * thirty-metre elevation model. So the surface is not the polygon. It is a grid, and at every point of it the
 * question asked is how far the DRAWN ground lies below the water's level. Where that is positive there is
 * water, deeper toward the middle; where it goes to zero the surface fades out (see materials/water.ts) and
 * the shoreline lands exactly where the bed rises through it, following every gully and spit in the terrain.
 * Nothing about the edge depends on how fine this grid is.
 *
 * It is built in chunks around the rider, a couple per frame, and thrown away behind — the same shape of thing
 * the terrain does, for the same reason: the Katy Trail has two hundred kilometres of river along it and the
 * rider can see one of them.
 */
import { Color3, Material, Mesh, type Scene, StandardMaterial, VertexData } from '@babylonjs/core'
import { Config } from '../config.ts'
import type { Route } from '../route/route.ts'
import type { Frame } from './frame.ts'
import { groundHeight } from './ground.ts'
import { Layer } from './layers.ts'
import type { Atmosphere } from './materials/aerial.ts'
import { WaterPlugin } from './materials/water.ts'
import type { BiomePalette } from './palette.ts'

interface WaterArea { y: number; points: number[]; kind: 'lake' | 'river' }
interface WaterLine { width: number; kind: 'river' | 'stream'; points: number[]; heights: number[] }

export interface WaterPackage {
  schemaVersion: number
  id: string
  areas: WaterArea[]
  lines: WaterLine[]
  attribution: string
}

/**
 * A body's bounding box, so the chunk builder can ignore everything that is nowhere near it — and, for an
 * area, an index of its edges by horizontal band.
 *
 * The Missouri arrives from the map as a single ring of eleven and a half thousand points. A crossing-count
 * test walks every edge of it, and the test is asked once per vertex of every water chunk and once per clump
 * of grass in the bottomland: tens of thousands of times, each walking eleven thousand edges. Banding the
 * edges by z — an edge is only in the bands its two ends span — turns that into the forty or so edges that
 * cross this particular line, which is the difference between a river and a stall.
 */
interface Boxed<T> { minX: number; minZ: number; maxX: number; maxZ: number; body: T; bands?: number[][]; bandZ?: number }

function boxOf<T extends { points: number[] }>(body: T, pad: number, index = false): Boxed<T> {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
  for (let i = 0; i < body.points.length; i += 2) {
    minX = Math.min(minX, body.points[i]); maxX = Math.max(maxX, body.points[i])
    minZ = Math.min(minZ, body.points[i + 1]); maxZ = Math.max(maxZ, body.points[i + 1])
  }
  const boxed: Boxed<T> = { minX: minX - pad, minZ: minZ - pad, maxX: maxX + pad, maxZ: maxZ + pad, body }
  if (index && body.points.length > 400) {
    const bandZ = 120
    const count = Math.max(1, Math.ceil((maxZ - minZ) / bandZ) + 1)
    const bands: number[][] = Array.from({ length: count }, () => [])
    const points = body.points
    for (let i = 0, j = points.length - 2; i < points.length; j = i, i += 2) {
      const lo = Math.min(points[i + 1], points[j + 1])
      const hi = Math.max(points[i + 1], points[j + 1])
      const a = Math.max(0, Math.floor((lo - minZ) / bandZ))
      const b = Math.min(count - 1, Math.floor((hi - minZ) / bandZ))
      for (let k = a; k <= b; k++) bands[k].push(i, j)
    }
    boxed.bands = bands
    boxed.bandZ = bandZ
  }
  return boxed
}

/** The standard crossing-count test, walking only the edges that can cross this line. */
function inside<T extends { points: number[] }>(boxed: Boxed<T>, x: number, z: number): boolean {
  const points = boxed.body.points
  let hit = false
  if (boxed.bands && boxed.bandZ) {
    const band = boxed.bands[Math.max(0, Math.min(boxed.bands.length - 1, Math.floor((z - (boxed.minZ + 4)) / boxed.bandZ)))]
    for (let e = 0; e < band.length; e += 2) {
      const i = band[e], j = band[e + 1]
      const xi = points[i], zi = points[i + 1]
      const xj = points[j], zj = points[j + 1]
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit
    }
    return hit
  }
  for (let i = 0, j = points.length - 2; i < points.length; j = i, i += 2) {
    const xi = points[i], zi = points[i + 1]
    const xj = points[j], zj = points[j + 1]
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit
  }
  return hit
}

const key = (cx: number, cz: number): string => `${cx},${cz}`

export class Water {
  private readonly scene: Scene
  private readonly route: Route
  private readonly frame: Frame
  readonly material: StandardMaterial
  private readonly shade: WaterPlugin
  private readonly areas: Array<Boxed<WaterArea>> = []
  private readonly lines: Array<Boxed<WaterLine>> = []
  private readonly chunks = new Map<string, { wx: number; wz: number; mesh: Mesh }>()
  /** one mesh per watercourse in range, keyed by its index in the package */
  private readonly ribbons = new Map<number, { wx: number; wz: number; mesh: Mesh }>()
  private readonly wanted: Array<{ cx: number; cz: number }> = []
  /** true once every chunk in range has been built: the screenshot harness waits on this */
  settled = false

  constructor(scene: Scene, route: Route, frame: Frame, atmosphere?: Atmosphere) {
    this.scene = scene
    this.route = route
    this.frame = frame

    const material = new StandardMaterial('water', scene)
    material.specularColor = Color3.Black()
    material.diffuseColor = Color3.Black()
    // the whole colour is the plugin's; nothing here should be lit as an ordinary surface
    material.emissiveColor = Color3.White()
    material.disableLighting = true
    material.backFaceCulling = true
    /**
     * Blended, and therefore drawn after the opaque world — which is what lets the shallows show the bed
     * through them and the shoreline dissolve instead of ending. It does not write depth, so nothing is ever
     * hidden BY water; a tree standing in a river is drawn whole and the water goes over it, which for a few
     * centimetres of alpha is the right answer and is cheap.
     */
    material.alpha = 0.999
    material.transparencyMode = Material.MATERIAL_ALPHABLEND
    material.useAlphaFromDiffuseTexture = false
    this.material = material
    this.shade = new WaterPlugin(material)
    atmosphere?.attach(material)

    frame.onShift(() => {
      for (const c of this.chunks.values()) c.mesh.position.set(c.wx - frame.x, 0, c.wz - frame.z)
      for (const c of this.ribbons.values()) c.mesh.position.set(c.wx - frame.x, 0, c.wz - frame.z)
      /**
       * And the wet-cell cache is emptied, because it is unbounded and the Katy Trail is 386 km long.
       *
       * It answers "is this three-metre square under water" for every clump of grass and every tree the
       * scatter places, so over a whole route it would accumulate one entry per cell of a corridor a kilometre
       * wide and hundreds long — tens of millions of them. The floating origin moves about once a kilometre,
       * which is exactly the point at which everything it remembers is behind the rider anyway.
       */
      this.wet.clear()
    })
  }

  /** Load a route's water, if it has any. A route with no file simply has none. */
  async load(id: string, base = './routes/'): Promise<void> {
    let pkg: WaterPackage
    try {
      const res = await fetch(`${base}${id}.water.json`)
      if (!res.ok) return
      pkg = (await res.json()) as WaterPackage
    } catch {
      return
    }
    for (const a of pkg.areas) if (a.points.length >= 8) this.areas.push(boxOf(a, 4, true))
    for (const l of pkg.lines) if (l.points.length >= 4) this.lines.push(boxOf(l, l.width))
  }

  get empty(): boolean { return !this.areas.length && !this.lines.length }

  setBiome(palette: BiomePalette): void {
    this.shade.horizon.copyFrom(palette.haze)
    Color3.LerpToRef(palette.haze, palette.sky, 0.25, this.shade.horizon)
    this.shade.horizon.scaleInPlace(Config.skyBrightness)
    this.shade.zenith.copyFrom(palette.sky).scaleInPlace(0.82 * Config.skyBrightness)
    /**
     * The water takes after the country it is in.
     *
     * A Missouri river bottom is warm, silted and opaque — it reflects the sky and gives nothing back from
     * below. Alpine water is the opposite: cold, clear and blue-green, and you can see the stones in it. Both
     * are the same shader with two colours changed.
     */
    const alpine = palette.grass.b > palette.grass.r
    this.shade.deep.copyFromFloats(0.035, 0.085, 0.105)
    // The shallows are where the colour of the WATER shows, and on a silted river that colour is mud: the
    // first few metres off a Missouri bank are tan, not green, and getting that wrong leaves a hard line
    // between the grass and the river instead of a bank that wades into it.
    if (alpine) this.shade.shallow.copyFromFloats(0.20, 0.38, 0.39)
    else this.shade.shallow.copyFromFloats(0.35, 0.31, 0.21)
  }

  setSun(directionX: number, directionY: number, directionZ: number, colour: Color3): void {
    this.shade.sun.set(directionX, directionY, directionZ)
    this.shade.sunColour.copyFrom(colour)
  }

  tick(dt: number): void { this.shade.time += dt }

  /**
   * Keep the chunks around the rider, building a couple a frame.
   *
   * Water is sparse — most of a route has none — so the list of chunks worth building is worked out from the
   * bodies' bounding boxes rather than from a disc around the rider. On the prairie there is nothing to do at
   * all, and on the Missouri there are a handful.
   */
  private lastAt = { x: Number.NaN, z: Number.NaN }
  update(worldX: number, worldZ: number): void {
    if (this.empty) return
    // What is in range only changes when the rider has moved; walking every body's box every frame to find
    // that out was a measurable slice of a CPU-bound frame. Unless there is still building to do.
    if (this.settled && Math.hypot(worldX - this.lastAt.x, worldZ - this.lastAt.z) < 15) return
    this.lastAt = { x: worldX, z: worldZ }
    const size = Config.waterChunk
    const reach = Config.waterReach
    const cx0 = Math.floor((worldX - reach) / size)
    const cx1 = Math.floor((worldX + reach) / size)
    const cz0 = Math.floor((worldZ - reach) / size)
    const cz1 = Math.floor((worldZ + reach) / size)

    this.wanted.length = 0
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const wx = cx * size
        const wz = cz * size
        // the corner nearest the rider, so a chunk is not dropped just because its middle is out of range
        const dx = Math.max(0, Math.max(wx - worldX, worldX - (wx + size)))
        const dz = Math.max(0, Math.max(wz - worldZ, worldZ - (wz + size)))
        if (Math.hypot(dx, dz) > reach) continue
        if (!this.anyWater(wx, wz, size)) continue
        this.wanted.push({ cx, cz })
      }
    }

    // anything no longer wanted goes
    const live = new Set(this.wanted.map((c) => key(c.cx, c.cz)))
    for (const [k, c] of this.chunks) {
      if (!live.has(k)) { c.mesh.dispose(); this.chunks.delete(k) }
    }

    let built = 0
    this.settled = true
    for (const { cx, cz } of this.wanted) {
      if (this.chunks.has(key(cx, cz))) continue
      if (built >= Config.chunksPerFrame) { this.settled = false; break }
      this.build(cx, cz)
      built++
    }
    if (!this.ribbonsFor(worldX, worldZ, built)) this.settled = false
  }

  /**
   * The watercourses, drawn as ribbons along their own line rather than sampled onto the grid.
   *
   * A creek is four metres across and the surface grid has a vertex every ten, so a grid can miss one
   * completely — and did: a fourteen-metre river crossing the trail at km 309 produced not one triangle,
   * because a triangle needs all three of its corners to be in the water and none of them were. Anything
   * narrow has to be built from its own centreline, where the geometry is exact at any width.
   *
   * Four vertices to a cross-section, not two: the outer pair sit on the bank with the surface faded to
   * nothing and the inner pair carry the depth, so a stream has soft edges for the same reason a lake does.
   */
  private ribbonsFor(worldX: number, worldZ: number, alreadyBuilt: number): boolean {
    const reach = Config.waterReach
    let built = alreadyBuilt
    let done = true
    const live = new Set<number>()
    for (let i = 0; i < this.lines.length; i++) {
      const b = this.lines[i]
      const dx = Math.max(0, Math.max(b.minX - worldX, worldX - b.maxX))
      const dz = Math.max(0, Math.max(b.minZ - worldZ, worldZ - b.maxZ))
      /**
       * Not built past the distance at which it has already faded out.
       *
       * The shader gives narrow water a range in proportion to its width — a five-metre stream is gone by
       * about three hundred metres (see materials/water.ts) — and building it out to the full reach beyond
       * that draws a long, thin, alpha-blended ribbon that contributes not one visible pixel. On Alpe d'Huez,
       * where fifty-odd torrents come off the mountain, that measured as twenty frames a second.
       */
      const useful = Math.min(reach, (80 + 900 * Math.min(1, b.body.width / 40)) * 1.7 + 60)
      if (Math.hypot(dx, dz) > useful) continue
      live.add(i)
      if (this.ribbons.has(i)) continue
      if (built >= Config.chunksPerFrame) { done = false; continue }
      this.buildRibbon(i)
      built++
    }
    for (const [i, r] of this.ribbons) if (!live.has(i)) { r.mesh.dispose(); this.ribbons.delete(i) }
    return done
  }

  private buildRibbon(index: number): void {
    const { points, heights, width } = this.lines[index].body
    const n = points.length / 2
    const ox = points[0]
    const oz = points[1]
    const half = width / 2
    const inner = half * 0.55
    const deep = Math.min(Config.waterDeepest, half * Config.waterShelve * 2)
    const positions: number[] = []
    const colours: number[] = []
    const indices: number[] = []
    const across = [-half, -inner, inner, half]
    const fade = [0, 1, 1, 0]

    let rows = 0
    for (let i = 0; i < n; i++) {
      // the direction the water is running here, from the neighbours
      const ax = points[Math.max(0, i - 1) * 2]
      const az = points[Math.max(0, i - 1) * 2 + 1]
      const bx = points[Math.min(n - 1, i + 1) * 2]
      const bz = points[Math.min(n - 1, i + 1) * 2 + 1]
      const len = Math.hypot(bx - ax, bz - az) || 1
      const nx = -(bz - az) / len
      const nz = (bx - ax) / len
      const x = points[i * 2]
      const z = points[i * 2 + 1]
      /**
       * A stream lies ON the ground it runs over, not at the height the model says its water is.
       *
       * The elevation model has a post every sixty metres on the Katy: it cannot see a ditch four metres wide,
       * so a creek given its own surveyed level ends up a metre under the hillside and invisible. Taking the
       * drawn ground and sinking the water a little into it is both robust and right — what a small stream
       * looks like from a bicycle is a bright line lying in the fold of the land.
       */
      /**
       * ON the ground, and on the ground under each edge rather than under the centre. It used to take the
       * higher of the stream's own level and the ground, and where the surveyed level stood above the drawn
       * ground the stream became a pane of glass hanging metres in the air beside the trail, drawn over the
       * bushes behind it. The surveyed level is only a fallback now, for where there is no ground at all.
       */
      for (let k = 0; k < 4; k++) {
        const px = x + nx * across[k]
        const pz = z + nz * across[k]
        const ground = groundHeight(this.route, px, pz)
        const y = Number.isFinite(ground) ? ground + 0.06 : heights[i] + Config.waterLift
        positions.push(px - ox, y, pz - oz)
        // green carries how WIDE this water is, which is how the shader knows when it is too narrow to draw
        colours.push(deep * fade[k], Math.min(1, width / 40), 0, fade[k])
      }
      rows++
    }
    if (rows < 2) {
      const empty = new Mesh(`stream${index}`, this.scene)
      empty.setEnabled(false)
      this.ribbons.set(index, { wx: ox, wz: oz, mesh: empty })
      return
    }
    for (let i = 0; i + 1 < rows; i++) {
      for (let k = 0; k < 3; k++) {
        const a = i * 4 + k
        const b = a + 1
        const c = a + 4
        const d = c + 1
        indices.push(a, b, c, b, d, c)
      }
    }

    const mesh = new Mesh(`stream${index}`, this.scene)
    const data = new VertexData()
    data.positions = positions
    data.indices = indices
    data.colors = colours
    const normals: number[] = []
    for (let i = 0; i < positions.length / 3; i++) normals.push(0, 1, 0)
    data.normals = normals
    data.applyToMesh(mesh, false)
    mesh.material = this.material
    mesh.renderingGroupId = Layer.near
    mesh.isPickable = false
    mesh.receiveShadows = false
    mesh.hasVertexAlpha = true
    mesh.position.set(ox - this.frame.x, 0, oz - this.frame.z)
    this.ribbons.set(index, { wx: ox, wz: oz, mesh })
  }

  /** Build every outstanding chunk at once, for the screenshot harness and the first frame. */
  fill(worldX: number, worldZ: number): void {
    this.lastAt = { x: Number.NaN, z: Number.NaN }
    for (const { cx, cz } of this.wanted) if (!this.chunks.has(key(cx, cz))) this.build(cx, cz)
    this.ribbonsFor(worldX, worldZ, -1e9)
    this.settled = true
  }

  private anyWater(wx: number, wz: number, size: number): boolean {
    for (const b of this.areas) if (b.minX < wx + size && b.maxX > wx && b.minZ < wz + size && b.maxZ > wz) return true
    for (const b of this.lines) if (b.minX < wx + size && b.maxX > wx && b.minZ < wz + size && b.maxZ > wz) return true
    return false
  }

  /**
   * The level of the water surface at a point, or NaN where there is none.
   *
   * A point can be in more than one body — a creek running into a lake, two overlapping bank polygons from
   * different mappers — and the answer is the highest of them, because that is the one whose surface would be
   * seen. Lines carry a height per point and are interpolated along, since a stream is the one water surface
   * that is not level: it runs down the hill it is in.
   */
  private levelAt(x: number, z: number, out: { level: number; shore: number }): void {
    out.level = Number.NaN
    out.shore = 0
    for (const b of this.areas) {
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue
      if (!inside(b, x, z)) continue
      /**
       * How far in from the bank this point is, which decides both the depth and the fade — and it is looked
       * for in the same bands the crossing test uses.
       *
       * Only the bands within a hundred metres or so of this line are worth walking. The depth has saturated
       * long before that (a bank falls to its full depth in twenty-odd metres) and so has the shore fade, so an
       * edge further away than the index reaches cannot change either answer; what it would change is how long
       * this takes, by a factor of a hundred, on every clump of grass in the Missouri bottom.
       */
      const points = b.body.points
      let near = Infinity
      const walk = (i: number, j: number): void => {
        const ax = points[j], az = points[j + 1]
        const ex = points[i] - ax, ez = points[i + 1] - az
        const len2 = ex * ex + ez * ez
        const t = len2 > 1e-6 ? Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / len2)) : 0
        const d = Math.hypot(x - (ax + ex * t), z - (az + ez * t))
        if (d < near) near = d
      }
      if (b.bands && b.bandZ) {
        const at = Math.floor((z - (b.minZ + 4)) / b.bandZ)
        for (let k = at - 1; k <= at + 1; k++) {
          const band = b.bands[k]
          if (!band) continue
          for (let e = 0; e < band.length; e += 2) walk(band[e], band[e + 1])
        }
      } else {
        for (let i = 0, j = points.length - 2; i < points.length; j = i, i += 2) walk(i, j)
      }

      const local = this.route.heightAt(x, z)
      const y = Number.isFinite(local) ? Math.max(local, b.body.y) : b.body.y
      if (!(y <= out.level)) { out.level = y; out.shore = near }
      else if (near > out.shore) out.shore = near
    }

    // watercourses are not sampled here: they are built from their own centrelines (see `buildRibbon`), which
    // is the only way anything narrower than the grid survives. `isWater` still asks about them, below.
  }

  /**
   * **Depth is modelled from the bank, not read from the elevation model — and it has to be.**
   *
   * The obvious thing is to take the depth as the water's level minus the ground under it, and it does not
   * work for the very rivers that matter. An elevation model built from radar or photogrammetry does not see
   * the bed: over the Missouri it records the WATER SURFACE, so level minus ground is zero everywhere and the
   * river came out as an invisible sheet lying exactly on the ground it was supposed to cover. Measured at
   * km 309, where the river runs nine metres from the trail, there was nothing on screen at all.
   *
   * So the depth here is a shape rather than a measurement: shallow at the bank and deepening inward at a
   * gentle slope to a limit, which is what a river cross-section actually looks like and what the eye is
   * reading when it judges water. The map's bank gives the distance, the model gives the level, and the
   * elevation model is left to do the one thing it is good for — saying where the ground rises ABOVE the
   * surface, which is how the trail's own embankment and the far bank cut the water off.
   */
  private build(cx: number, cz: number): void {
    const size = Config.waterChunk
    const step = Config.waterStep
    const n = Math.round(size / step)
    const wx = cx * size
    const wz = cz * size
    const verts = (n + 1) * (n + 1)
    const positions = new Float32Array(verts * 3)
    const colours = new Float32Array(verts * 4)
    const depths = new Float64Array(verts)

    let any = false
    const found = { level: Number.NaN, shore: 0 }
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const v = j * (n + 1) + i
        const x = wx + i * step
        const z = wz + j * step
        this.levelAt(x, z, found)
        positions[v * 3] = i * step
        positions[v * 3 + 2] = j * step
        if (!Number.isFinite(found.level)) { depths[v] = Number.NaN; continue }
        const level = found.level + Config.waterLift
        const bed = groundHeight(this.route, x, z)
        // where the ground stands above the surface there is no water, whatever the map says: this is what
        // cuts the river off at the trail's embankment and at the far bank, and it costs one comparison
        /**
         * Where the ground stands above the surface there is no water, whatever the map says — which is what
         * cuts the river off at the trail's own embankment and at the far bank.
         *
         * The tolerance is not tight, and cannot be: the surface is taken from the elevation model and the
         * ground is drawn from the same model with the trail carved into it and relief added over it, so the
         * two agree to within a few tens of centimetres at best. Tighter than the disagreement and the river
         * dissolves into a lace of holes; looser and it climbs its own bank.
         */
        if (Number.isFinite(bed) && bed > level + Config.waterBankTolerance) { depths[v] = Number.NaN; continue }
        const depth = Math.min(Config.waterDeepest, found.shore * Config.waterShelve)
        depths[v] = depth
        /**
         * The surface never stands above the ground under it: where the elevation model is lower than the
         * body's level, the model wins.
         *
         * Each body carries ONE level, and a river is not level: the Missouri falls a few tens of centimetres
         * a kilometre, and a polygon hundreds of kilometres long given one height from somewhere along it
         * stands metres too high elsewhere. Measured at km 147 it floated six metres over the ground, and from
         * the saddle that is a sheet of water hanging in the air, drawn across every trunk and bush behind it.
         * Over a big river the elevation model IS the water surface (see above), so it is the better level
         * wherever it is the lower one; the level still decides where the bank rises out of the water.
         */
        positions[v * 3 + 1] = Number.isFinite(bed) ? Math.min(level, bed + Config.waterLift) : level
        colours[v * 4] = depth
        // open water: wide enough to be drawn at any distance it is built at
        colours[v * 4 + 1] = 1
        colours[v * 4 + 2] = 0
        // and the fade at the edge: the first few metres in from the bank, so the surface never ends on a line
        colours[v * 4 + 3] = Math.min(1, found.shore / Config.waterShoreFade)
        any = true
      }
    }

    if (!any) {
      const empty = new Mesh(`water${cx}_${cz}`, this.scene)
      empty.setEnabled(false)
      this.chunks.set(key(cx, cz), { wx, wz, mesh: empty })
      return
    }

    /**
     * A ring of dry vertices around the water, so the fade has somewhere to happen.
     *
     * Without it the mesh stops at the last vertex that was inside the bank, and since those sit on a ten-metre
     * grid the shoreline comes out as a flight of ten-metre steps — which is exactly how it looked: a river
     * with a staircase for a bank. Carrying the surface one vertex past the edge, at the same level but with
     * its fade run out to nothing, puts the waterline inside a triangle instead of along its edge. Where it
     * falls in that triangle is then decided per pixel, by the shore distance and the noise on it, and the grid
     * that carried it there cannot be seen at all.
     */
    const fringeLevel = new Float64Array(verts)
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const v = j * (n + 1) + i
        if (Number.isFinite(depths[v])) continue
        let level = Number.NaN
        if (i > 0 && Number.isFinite(depths[v - 1])) level = positions[(v - 1) * 3 + 1]
        else if (i < n && Number.isFinite(depths[v + 1])) level = positions[(v + 1) * 3 + 1]
        else if (j > 0 && Number.isFinite(depths[v - (n + 1)])) level = positions[(v - (n + 1)) * 3 + 1]
        else if (j < n && Number.isFinite(depths[v + (n + 1)])) level = positions[(v + (n + 1)) * 3 + 1]
        fringeLevel[v] = level
      }
    }
    for (let v = 0; v < verts; v++) {
      if (Number.isFinite(depths[v]) || !Number.isFinite(fringeLevel[v])) continue
      depths[v] = 0
      // the fringe is past the bank by definition, so it may not stand above the ground there either
      const under = groundHeight(this.route, wx + (v % (n + 1)) * step, wz + Math.floor(v / (n + 1)) * step)
      positions[v * 3 + 1] = Number.isFinite(under) ? Math.min(fringeLevel[v], under + Config.waterLift) : fringeLevel[v]
      colours[v * 4] = 0
      colours[v * 4 + 1] = 1
      colours[v * 4 + 3] = 0
    }

    const indices: number[] = []
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i
        const b = a + 1
        const c = a + n + 1
        const d = c + 1
        if (Number.isFinite(depths[a]) && Number.isFinite(depths[b]) && Number.isFinite(depths[c])) indices.push(a, b, c)
        if (Number.isFinite(depths[b]) && Number.isFinite(depths[c]) && Number.isFinite(depths[d])) indices.push(b, d, c)
      }
    }
    // a vertex kept only to be faded toward still needs a height, or the triangle it is in falls to zero
    for (let v = 0; v < verts; v++) if (!Number.isFinite(depths[v])) positions[v * 3 + 1] = 0

    if (!indices.length) {
      const empty = new Mesh(`water${cx}_${cz}`, this.scene)
      empty.setEnabled(false)
      this.chunks.set(key(cx, cz), { wx, wz, mesh: empty })
      return
    }

    const mesh = new Mesh(`water${cx}_${cz}`, this.scene)
    const data = new VertexData()
    data.positions = positions as unknown as number[]
    data.indices = indices
    data.colors = colours as unknown as number[]
    // flat up: the surface IS flat, and every ripple in it is the shader's
    const normals = new Float32Array(verts * 3)
    for (let v = 0; v < verts; v++) normals[v * 3 + 1] = 1
    data.normals = normals as unknown as number[]
    data.applyToMesh(mesh, false)
    mesh.material = this.material
    mesh.renderingGroupId = Layer.near
    mesh.isPickable = false
    mesh.receiveShadows = false
    mesh.hasVertexAlpha = true
    mesh.position.set(wx - this.frame.x, 0, wz - this.frame.z)
    this.split(mesh)
    this.chunks.set(key(cx, cz), { wx, wz, mesh })
  }

  /**
   * Draw a stretch of open water once in each depth layer (render/layers.ts), each copy cut at the seam.
   *
   * Water reaches eleven hundred metres and the detailed ground only five hundred and sixty. Drawn wholly in
   * the near layer, a lake past the detailed ground was drawn after — and so over — the coarse ground in
   * front of it: the depth buffer is cleared between layers, so the hill that should hide it could not. It
   * showed as a pane of water hanging over the fields beside the trail. So the near copy stops where the
   * detailed ground stops, and a copy in the far layer, which the coarse ground CAN hide, carries on from the
   * edge of the hole cut in the coarse ground. Where the two overlap the detailed ground covers the far one.
   */
  private split(mesh: Mesh): void {
    mesh.metadata = { waterCut: Config.viewRadius - 30 }
    const far = mesh.clone(`${mesh.name}-far`, null, true)
    if (!far) return
    far.parent = mesh
    far.position.set(0, 0, 0)
    far.renderingGroupId = Layer.far
    far.metadata = { waterCut: -Config.farHole }
  }

  /**
   * Is this point wet? — asked tens of thousands of times a re-sow, so it is a cached lookup.
   *
   * Nothing should grow in a river, and the scatter has no other way to know: it places from the ground and
   * the ground under a river is just ground. Asking `levelAt` directly would mean walking a bank polygon of
   * several hundred edges for every blade of grass in a Missouri bottom, so the answer is remembered per
   * three-metre cell — which is finer than anything being placed and turns the question into a hash lookup
   * for every clump after the first. The cache is only ever added to; water does not move.
   */
  private readonly wet = new Map<number, boolean>()
  isWater(x: number, z: number): boolean {
    if (this.empty) return false
    const cx = Math.round(x / 3)
    const cz = Math.round(z / 3)
    const k = (cx + 4194304) * 8388608 + (cz + 4194304)
    const had = this.wet.get(k)
    if (had !== undefined) return had
    const x3 = cx * 3
    const z3 = cz * 3
    this.levelAt(x3, z3, this.probe)
    let answer = Number.isFinite(this.probe.level)
    for (let i = 0; !answer && i < this.lines.length; i++) {
      const b = this.lines[i]
      if (x3 < b.minX || x3 > b.maxX || z3 < b.minZ || z3 > b.maxZ) continue
      const { points, width } = b.body
      const half = width / 2 + 1
      for (let k = 0; k + 3 < points.length; k += 2) {
        const ax = points[k], az = points[k + 1]
        const ex = points[k + 2] - ax, ez = points[k + 3] - az
        const len2 = ex * ex + ez * ez
        if (len2 < 1e-6) continue
        const t = Math.max(0, Math.min(1, ((x3 - ax) * ex + (z3 - az) * ez) / len2))
        if (Math.hypot(x3 - (ax + ex * t), z3 - (az + ez * t)) < half) { answer = true; break }
      }
    }
    this.wet.set(k, answer)
    return answer
  }

  /**
   * The surface level at a point and how far in from the bank it is, or NaN for dry land. What the bridges
   * ask (render/bridges.ts), and anything else that has to know where the water is.
   */
  readonly probe = { level: Number.NaN, shore: 0 }
  surfaceAt(x: number, z: number): { level: number; shore: number } {
    this.levelAt(x, z, this.probe)
    if (Number.isFinite(this.probe.level)) this.probe.level += Config.waterLift
    return this.probe
  }

  dispose(): void {
    for (const c of this.chunks.values()) c.mesh.dispose()
    this.chunks.clear()
    for (const r of this.ribbons.values()) r.mesh.dispose()
    this.ribbons.clear()
    this.material.dispose()
  }
}
