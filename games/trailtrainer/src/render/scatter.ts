/**
 * What grows beside the trail. Trees, and rocks where it is too high or too steep for trees.
 *
 * Everything is thin instances of a handful of small meshes, placed deterministically from the cell they fall
 * in, so the same stretch of the Katy Trail has the same trees on it every session and two riders at km 210
 * see the same wood. Nothing is stored: the position of a tree is a function of where it is.
 *
 * A tree is two instances of the same transform — a trunk and a crown of leaf cards (see render/trees.ts) —
 * because one is opaque and the other is a photograph with holes in it, and a single material cannot be both.
 * That is four meshes for two species rather than two, which is four draw calls rather than two, and worth it
 * for foliage that reads as foliage.
 *
 * The buffers are rebuilt whenever the visible cells change or the floating origin moves. That sounds
 * expensive and is not — a few thousand matrices, a few times a minute.
 */
import { Color3, ImageProcessingConfiguration, Material, Matrix, Mesh, MeshBuilder, Quaternion, type Scene, StandardMaterial, Texture, Vector3, VertexBuffer } from '@babylonjs/core'
import { Config } from '../config.ts'
import type { BiomeName } from '../route/package.ts'
import type { Route } from '../route/route.ts'
import type { Frame } from './frame.ts'
import { groundHeight, holdLattice, meshHeight } from './ground.ts'
import { Layer } from './layers.ts'
import type { Atmosphere } from './materials/aerial.ts'
import { FadePlugin } from './materials/fade.ts'
import { CardEdgePlugin } from './materials/card.ts'
import { LeafTransmissionPlugin } from './materials/leaf.ts'
import { LodFadePlugin } from './materials/lod.ts'
import { prepareImpostor, renderImpostor, buildImpostorQuad, ImpostorPlugin } from './impostor.ts'
import { WindPlugin } from './materials/wind.ts'
import { type BiomePalette, BIOMES, groundColour } from './palette.ts'
import { buildBladeTuft, buildCanopy, buildTrunk } from './trees.ts'
import type { PlantedBand, TreeVariant } from './treelib.ts'

const CELL = 100

/**
 * One matrix, reused for every instance composed. `Matrix.Compose` allocates a new one — an object and a
 * sixteen-float array — and the scatter composes tens of thousands of them every time it re-sows: measured as
 * about two garbage collections a second while riding, each one a hitch. Composing into this and copying the
 * sixteen numbers out allocates nothing.
 */
const SCRATCH = new Matrix()

/**
 * Scratch space for sorting instances into levels, reused by every split rather than built afresh.
 *
 * A split used to push each instance's sixteen floats into new JavaScript arrays — one per level and one for
 * the impostors — and it runs every few metres of riding. Those arrays were the other half of the garbage that
 * made the ride hitch. These grow when they have to and are otherwise written over; `put` copies out of them.
 */
class Scratch {
  data = new Float32Array(16 * 256)
  length = 0
  reset(): void { this.length = 0 }
  push16(src: ArrayLike<number>, at: number): void {
    if (this.length + 16 > this.data.length) {
      const grown = new Float32Array(this.data.length * 2)
      grown.set(this.data)
      this.data = grown
    }
    for (let k = 0; k < 16; k++) this.data[this.length + k] = src[at + k]
    this.length += 16
  }
  view(): Float32Array { return this.data.subarray(0, this.length) }
}
const LEVEL_SCRATCH = [new Scratch(), new Scratch(), new Scratch()]
const FAR_SCRATCH = new Scratch()

/** A small deterministic hash: the same cell always grows the same things. */
function hash(x: number, y: number, n: number): number {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + n * 1274126177
  h = (h ^ (h >>> 13)) * 1274126177
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

interface Species {
  /** every mesh this species is drawn with, at any distance: all its levels and its impostor */
  parts: Mesh[]
  /** the same model at each level of detail, closest first; one entry for anything not worth decimating */
  levels?: Mesh[][]
  /** the flat square that stands in for it far away, if it has one */
  impostor?: Mesh
  /** and where that handover happens, which is not the same distance for a tree and for a boulder */
  impostorFrom?: number
  impostorTo?: number
  /** every instance placed, whether it will be drawn as geometry or as a picture */
  matrices: number[]
  /** the world x and z of each instance, in the same order, for sorting them by distance */
  positions?: number[]
  /** for each instance: how far it stands from the trail, and where along the route it is nearest (see split) */
  toTrail?: number[]
  /** for ground cover: which level each instance is drawn at, decided per grass cell (see sowGrass) */
  coverLevel?: number[]
  /** for a library tree, the height the mesh was grown at, so it can be scaled to a wanted one */
  scaleTo?: number
  /** and the crown radius it was grown with, in the same units */
  crownRadius?: number
}

/**
 * The fixed cast. Broadleaf trees are not among them: they come from the pre-generated library and there are
 * several, keyed `tree0`, `tree1` and so on, so that a wood is not one tree repeated.
 */
type SpeciesName = string

/** How tall the model of each species is built, in metres, before it is scaled per tree. */
const HEIGHT: Record<'conifer' | 'broadleaf' | 'bush', number> = { conifer: 11, broadleaf: 9, bush: 1.5 }

export class Scatter {
  private readonly species: Record<SpeciesName, Species>
  private cells = ''
  private grassCells = ''
  /** how long the last re-sow took, in milliseconds — the one cost here that is the CPU's, not the GPU's */
  lastSowMs = 0
  /**
   * And the same for the standing scenery, which is the other half of it.
   *
   * Worth measuring separately and worth measuring at all: this pass asks the ground its height once per
   * candidate, and each of those questions became four when the placement moved onto the drawn surface, or
   * seventeen for a rock, which is standing on the lowest of five. A scree slope is thousands of rocks.
   */
  lastStandMs = 0
  /** where the instances were last split between geometry and picture */
  private splitAt = { x: Number.NaN, z: Number.NaN }
  private readonly materials: StandardMaterial[] = []
  private readonly winds: WindPlugin[] = []
  private grassMat: StandardMaterial | null = null
  private readonly lods: LodFadePlugin[] = []
  /** trees waiting to be photographed, once their leaves have loaded */
  private readonly pending: Array<{
    picture: ReturnType<typeof prepareImpostor>
    sources: Mesh[]
    mats: StandardMaterial[]
    lods: LodFadePlugin[]
    /** set on the second photograph of the same tree; see `tick` */
    retake?: boolean
    /** seconds to wait before this one is taken */
    wait?: number
  }> = []
  private fade: FadePlugin | null = null
  /**
   * The same collapse, on the ground cover.
   *
   * Only the grass had it, so the ferns and the meadow tussocks and the reeds simply appeared, in whole
   * fourteen-metre cells, wherever the sowing happened to reach — which on flat ground, where a rider can see
   * the edge of the sowing, is a visible jump every few seconds. They are the same kind of thing as the grass
   * and they get the same treatment: sunk into the ground beyond the fade and grown out of it as the rider
   * comes on, every frame rather than every re-sow.
   */
  private readonly coverFades: FadePlugin[] = []
  /** one colour per tuft, so each takes after the ground it grows from */
  private readonly grassTints: number[] = []
  /**
   * What each grass cell grew, kept between sowings.
   *
   * The ring is re-sown every time the rider crosses a fourteen-metre cell, and it used to work out all of its
   * hundred-odd cells from scratch each time — twenty milliseconds, every second and a half at a riding pace,
   * which is a frame missed on the same beat and was most of the jitter that was left. A cell's contents depend
   * only on the cell, so each is computed once and afterwards copied; a re-sow computes the ten or so cells
   * that have just come into the ring. Positions are in scene space, so the cache is emptied when the floating
   * origin moves.
   */
  private readonly grassCache = new Map<string, { grass: number[]; tints: number[]; plants: Array<[Species, number[], number[]]> }>()
  private bushMat: StandardMaterial | null = null

  private readonly scene: Scene
  private readonly route: Route
  private readonly frame: Frame

  /** the route's ecology, with its models loaded */
  private readonly planted: PlantedBand[]
  /**
   * Whether a point is under water, if anything has told us. Nothing grows in a river, and the ground does not
   * know it is a river bed — it is the one thing the scatter cannot work out for itself.
   */
  wet: ((x: number, z: number) => boolean) | null = null
  /** metres along the route the rider has reached, for choosing levels of detail by the road (see split) */
  riderS = 0
  /** and which way they are facing, in world terms */
  riderHx = 0
  riderHz = 1
  /**
   * The full-detail meshes of everything tall enough to throw a shadow worth having.
   *
   * Only the closest level of detail, because the shadow box is a few dozen metres across and everything in it
   * is drawn at full detail anyway — and only trees and bushes, because a shadow map is a depth pass and a
   * hundred thousand blades of grass in one is a hundred thousand triangles for a smudge.
   */
  private readonly casters: Mesh[] = []
  shadowCasters(): Mesh[] { return this.casters }

  /**
   * Compile every level's shaders before the ride starts, so that no level is ever drawn for the first time
   * in the middle of one.
   *
   * Babylon compiles a material per mesh, and until it has, it does not draw that mesh — it skips it without a
   * word. So the first time a species' full-detail level was needed, say as the rider came up to the first oak
   * of the day, the tree was taken out of its coarse level and put into a level that could not yet be drawn,
   * and it vanished until the compile finished. Trees disappearing and reappearing as levels of detail changed
   * was exactly what was reported. Each mesh is given a single invisible instance (scaled to nothing, so the
   * defines are the thin-instanced ones it will actually be drawn with) and compiled here, at load.
   */
  async prewarm(): Promise<void> {
    const nothing = Matrix.Scaling(0, 0, 0).m
    const jobs: Array<Promise<void>> = []
    for (const sp of Object.values(this.species)) {
      for (const m of sp.parts) {
        if (!m.material) continue
        const had = m.thinInstanceCount > 0
        if (!had) this.put(m, 'matrix', nothing, 16)
        jobs.push(m.material.forceCompilationAsync(m).catch(() => undefined))
      }
    }
    await Promise.all(jobs)
  }
  /** every impostor photographed: after this nothing about the scenery's materials changes again */
  get baked(): boolean { return this.pending.length === 0 }
  /** the materials of everything this places, for freezing once they are settled (see main.ts) */
  settledMaterials(): Material[] {
    const out = new Set<Material>()
    for (const sp of Object.values(this.species)) for (const m of sp.parts) if (m.material) out.add(m.material)
    return [...out]
  }
  /** one species entry per model, whatever bands it belongs to */
  private keyOf(v: TreeVariant): string { return `${v.species}/${v.name}` }
  /**
   * Everything solid near the rider, five numbers each: world x, world z, radius, and the world heights it
   * spans. What the camera has to keep out of.
   */
  private readonly obstacles: number[] = []

  constructor(scene: Scene, route: Route, frame: Frame, atmosphere?: Atmosphere, planted: PlantedBand[] = []) {
    this.scene = scene
    this.route = route
    this.frame = frame
    this.planted = planted

    const url = (name: string): string => new URL(`textures/${name}`, document.baseURI).href

    // Real blades, and therefore a plain opaque material: no texture, no alpha, nothing to cut out. That is
    // the whole point of the change (see render/trees.ts) — the shape is geometry, the shading is the fanned
    // normals and the baked root shade, and the clump's colour arrives per instance. Nothing here is thrown
    // away by a discard, so a field of grass costs its triangles and not its pixels.
    const tuft = buildBladeTuft(scene, 'grassTuft', Config.grassHeight, Config.bladesPerTuft)
    const blade = new StandardMaterial('grass', scene)
    blade.diffuseColor = Color3.White()
    blade.specularColor = Color3.Black()
    // a blade is seen from behind as often as from in front, and both sides are the outside of it
    blade.backFaceCulling = false
    blade.twoSidedLighting = true
    this.grassMat = blade
    atmosphere?.attach(blade)
    this.materials.push(blade)
    const bladeWind = new WindPlugin(blade)
    // Blades within a clump have to break step with each other. Wind phase comes from world position, and
    // two blades ten centimetres apart share it almost exactly, so the clump ripples as one solid object.
    // A high-frequency term scatters the phase across a clump without needing anything stored per blade.
    bladeWind.jitter = 1
    bladeWind.strength = 0.09
    this.winds.push(bladeWind)
    tuft.material = blade
    /**
     * And a sparser tuft for the grass further out, drawn with the same material.
     *
     * Past twenty-odd metres a clump is a handful of pixels and its blade count cannot be seen — only its
     * colour and the fact that the ground is covered. Half the blades there is nearly half the grass, which was
     * the largest single item in the frame once the ground cover had levels of detail of its own. Sharing the
     * material means sharing the wind and the fade, so the two tufts sway and sink identically and the
     * boundary between them is invisible.
     */
    const tuftFar = buildBladeTuft(scene, 'grassTuftFar', Config.grassHeight, Math.max(3, Math.round(Config.bladesPerTuft / 2)))
    tuftFar.material = blade
    // the edge of the grass follows the camera every frame; the sowing only has to keep tufts standing by
    this.fade = new FadePlugin(this.grassMat)
    this.fade.near = Config.grassNear
    this.fade.far = Config.grassFar
    const guaranteed = Config.grassRadius - Config.grassCell * 1.45
    if (Config.grassFar > guaranteed) {
      throw new Error(`scatter: grassFar ${Config.grassFar} reaches past the ${guaranteed.toFixed(1)} m the sowing guarantees`)
    }

    this.species = {
      // The conifers and bushes this file used to fold out of cards are gone: the libraries now have real
      // ones, chosen per route by the ecology. What is left here is the grass, which is still cheaper and
      // better as generated blades than as a model, and which nothing in the libraries replaces.
      grass: { parts: [tuft, tuftFar], matrices: [] },
    }

    /**
     * Everything the route's ecology named, one species entry per distinct model.
     *
     * Bands share models — the same oak is in the Katy's forest band and its prairie band — so the entry is
     * keyed by the model, not by the band, and several bands add instances to the same one. That also keeps
     * the draw call count down to the number of models loaded rather than the number of bands.
     */
    /**
     * The air, on everything that stands in it.
     *
     * This was missed when the library trees replaced the built ones: their materials are made in treelib and
     * never came past the atmosphere, so the only vegetation that hazed with distance was the impostors, whose
     * flat material is made here. Trees therefore faded correctly past the changeover and rocks — which are
     * too small to be given an impostor at all — never faded at any distance, and read as hard dark specks
     * scattered across a hillside that had otherwise gone pale. Attached once per material, because bands
     * share models and a material given the plugin twice hazes twice.
     */
    const nearBands = new Set<Material>()
    for (const { band, variants } of planted) {
      if (band.reach !== 'near') continue
      for (const variant of variants) for (const m of variant.levels.flat()) if (m.material) nearBands.add(m.material)
    }

    const aired = new Set<Material>()
    for (const { variants } of planted) {
      for (const variant of variants) {
        for (const m of variant.levels.flat()) {
          const mat = m.material as StandardMaterial | null
          if (!mat || aired.has(mat)) continue
          aired.add(mat)
          atmosphere?.attach(mat)
          if (nearBands.has(mat)) {
            const fade = new FadePlugin(mat)
            // a shade tighter than the grass, so the cover is gone before the ring it was sown on can be seen
            fade.near = Config.grassNear * 0.9
            fade.far = Config.grassFar * 0.92
            this.coverFades.push(fade)
          }
        }
      }
    }

    for (const { band, variants } of planted) {
      for (const variant of variants) {
        const key = this.keyOf(variant)
        // The two nearer levels cast, not just the full model. With only LOD0 casting, a tree's shadow
        // appeared out of nothing when the tree crossed thirty metres — well inside the shadow box, and in the
        // middle of the verge the rider is looking at. LOD1 covers the rest of the box's reach.
        if (band.from === 'trees' && !this.casters.includes(variant.levels[0][0])) {
          for (const level of variant.levels.slice(0, 2)) this.casters.push(...level)
        }
        if (this.species[key]) continue
        this.species[key] = {
          parts: variant.levels.flat(),
          levels: variant.levels,
          matrices: [],
          scaleTo: variant.height,
          crownRadius: variant.crownRadius,
        }

        /**
         * A photograph of the tree, for when it is far enough away that nobody can tell.
         *
         * Only for tall things: a fern at two hundred metres is not costing anything worth reclaiming, and a
         * flat square is a poor likeness of something you might ride past. The changeover band is only ten
         * metres wide and sits at two hundred, where a tree is a few pixels tall — narrow on purpose,
         * because the dissolve across it is a screen-door stipple, and a stipple seen through the gaps in a
         * nearer tree's foliage reads as the near tree being stippled. Ten metres at that distance is over
         * before it can be noticed.
         */
        /**
         * Which things get a picture of themselves, and how far away.
         *
         * It used to be tall trees and nothing else, on the reasoning that a fern at two hundred metres is not
         * costing anything worth reclaiming. That was true of ferns and wrong about rocks. The generator does
         * not decimate a boulder — its three levels are the same 1160 triangles — so a scree slope was the most
         * expensive thing in the game: the alpine spots, with barely a tree in them, measured three and a half
         * million triangles of rock. What decides is the cost of the model, not its height.
         *
         * A rock hands over much nearer than a tree does, and can: it is a metre or two across rather than
         * twelve tall, so it is already a handful of pixels at fifty metres, and it is an opaque lump, which is
         * the shape an impostor is best at. A tree keeps its distant changeover because its canopy against the
         * sky is what gives a flat picture away.
         */
        const tris = variant.parts.reduce((n, m) => n + m.getTotalIndices() / 3, 0)
        const tall = variant.height >= 5
        /**
         * **Measured, and the answer was the opposite of what it looks like.**
         *
         * Rocks were given pictures on the reasoning above — a boulder is 1160 triangles the generator never
         * decimates, and a scree slope measured three and a half million of them. It worked exactly as intended
         * and made the game half as fast: with rock impostors on, the alpine spots drew 2.4 M triangles at 33
         * fps; with every impostor off they drew 5 M at a solid 60. The frame is not triangle-bound at all. It
         * is fill-bound, and an impostor is the worst possible trade against that — a quad covering the whole
         * of a tree's silhouette, mostly empty, alpha-DISCARDED (which costs the depth test its early-out), and
         * thousands of them overlapping in no particular order. The triangles it saves are nearly free and the
         * pixels it adds are not.
         *
         * So the rule stays what it was: a picture is for a big thing at a great distance, where its quad is a
         * few pixels and there are not many of them on screen. Trees, and nothing else. The saving that mattered
         * turned out to be the levels of detail, which cost no extra fill at all.
         */
        if (!tall || tris < Config.impostorWorthIt) continue
        // only tall trees reach here, so there is one band and one atlas size
        const from = Config.impostorFrom
        const to = Config.impostorTo
        const picture = prepareImpostor(scene, variant.parts, Config.impostorCells, Config.impostorTile)
        const quad = buildImpostorQuad(scene, `${key}Impostor`)
        const flat = new StandardMaterial(`${key}Flat`, scene)
        flat.diffuseTexture = picture.atlas
        picture.atlas.hasAlpha = false
        flat.transparencyMode = Material.MATERIAL_OPAQUE
        flat.specularColor = Color3.Black()
        flat.backFaceCulling = false
        /**
         * The impostor's own, neutral tone curve.
         *
         * The atlas holds what the screen showed, which has already been through the scene's exposure and
         * ACES curve. Sampling it into a material that applies them again darkens every impostor — the same
         * shape of mistake as gamma-correcting the tree textures twice, and it showed the same way: a wood
         * of correctly lit trees with a band of dark ones behind it. A configuration of its own, with the
         * curve off and exposure at one, lets the picture through as it was taken.
         */
        const neutral = new ImageProcessingConfiguration()
        neutral.toneMappingEnabled = false
        neutral.exposure = 1
        neutral.contrast = 1
        flat.imageProcessingConfiguration = neutral
        new ImpostorPlugin(flat, picture)
        atmosphere?.attach(flat)
        this.materials.push(flat)
        quad.material = flat
        this.species[key].impostor = quad
        this.species[key].impostorFrom = from
        this.species[key].impostorTo = to
        this.species[key].parts = [...variant.levels.flat(), quad]

        // Only the outermost level dissolves into the picture, because it is the only one drawn out there.
        // Giving the dissolve to a level that has already handed over at eighty metres would stipple nothing.
        const outer = variant.levels[variant.levels.length - 1]
        const own: LodFadePlugin[] = []
        for (const m of outer) {
          const lod = new LodFadePlugin(m.material as StandardMaterial, false)
          lod.near = from
          lod.far = to
          this.lods.push(lod)
          own.push(lod)
        }
        const farLod = new LodFadePlugin(flat, true)
        farLod.near = from
        farLod.far = to
        this.lods.push(farLod)
        this.pending.push({
          picture,
          sources: variant.parts,
          mats: variant.levels.flat().map((m) => m.material as StandardMaterial),
          lods: own,
        })
      }
    }

    for (const [name, sp] of Object.entries(this.species)) {
      for (const m of sp.parts) {
        m.renderingGroupId = Layer.near
        m.isPickable = false
        m.alwaysSelectAsActiveMesh = true
        /**
         * Nothing here ever moves as a mesh — every position lives in the instance matrices, and the floating
         * origin is applied by rewriting those. So the world matrix is frozen and the bounding box is never
         * resynchronised: two things Babylon otherwise does for all two hundred-odd of these every frame, and
         * the frame on the Katy is bound by exactly that kind of per-mesh bookkeeping (see GRAPHICS.md).
         */
        m.freezeWorldMatrix()
        m.doNotSyncBoundingInfo = true
        /**
         * The grass takes the shadow of the trees; nothing else does.
         *
         * Dapple that stops at the edge of the trail is worse than no dapple — it says the shadow is painted
         * on the road rather than cast by the wood — and the verge is grass, so the grass has to receive. The
         * trees themselves do not: a canopy of alpha-tested cards shadow-mapped against itself is a mess of
         * acne at any bias, and what it would buy is a darker underside, which the leaf transmission term
         * (render/materials/leaf.ts) already provides and better.
         */
        m.receiveShadows = name === 'grass'
      }
    }
    frame.onShift(() => { this.cells = ''; this.grassCells = ''; this.grassCache.clear() })
  }

  /**
   * What grows here takes its colour from the biome, the same way the ground does. A tuft of the Missouri
   * prairie and a tuft of an alpine meadow are the same photograph of blades; what makes one read as one
   * place and one as the other is the colour of everything around it agreeing.
   */
  setBiome(palette: BiomePalette): void {
    // grass is lit almost flat-on from above, so it can take the palette's colour at full strength without
    // going dark the way a crown does
    // the tint now rides on each tuft, from the ground it grows out of, so the material only sets how bright
    // the page is drawn and refuses to let a blade go black
    if (this.grassMat) {
      this.grassMat.diffuseColor = Color3.White().scale(2.0)
      this.grassMat.emissiveColor = palette.grass.scale(0.20)
    }
    if (this.bushMat) this.bushMat.emissiveColor = palette.foliage[0].scale(0.3)
  }

  /**
   * How far along a line from `ax,az` to `bx,bz` you can go before running into a trunk, as a fraction. One
   * means the whole way is clear. World metres in, so the caller does the floating origin.
   *
   * A straight loop over every trunk near the rider. There are one or two thousand and this runs once a
   * frame, which is nothing — and it is a great deal simpler than asking the renderer to pick against a mesh
   * carrying thin instances, which is the other way to answer the same question.
   */
  clearAlong(ax: number, ay: number, az: number, bx: number, by: number, bz: number, margin: number): number {
    const dx = bx - ax
    const dy = by - ay
    const dz = bz - az
    const len2 = dx * dx + dz * dz
    if (len2 < 1e-6) return 1
    const len = Math.sqrt(len2)
    let nearest = 1
    const o = this.obstacles
    // The camera asks this every frame, and the list holds every tree and boulder the scenery placed —
    // tens of thousands of them over a kilometre of wood, nearly all nowhere near an eight-metre boom. A
    // box around the segment, as wide as the biggest crown, turns them away for two comparisons each.
    const pad = margin + 12
    const minX = Math.min(ax, bx) - pad, maxX = Math.max(ax, bx) + pad
    const minZ = Math.min(az, bz) - pad, maxZ = Math.max(az, bz) + pad
    for (let i = 0; i < o.length; i += 5) {
      const tx = o[i]
      const tz = o[i + 1]
      if (tx < minX || tx > maxX || tz < minZ || tz > maxZ) continue
      const r = o[i + 2] + margin
      // where along the line this obstacle is closest, and how close that is, on the ground plane
      const t = Math.max(0, Math.min(1, ((tx - ax) * dx + (tz - az) * dz) / len2))
      const px = ax + dx * t - tx
      const pz = az + dz * t - tz
      if (px * px + pz * pz > r * r) continue
      // and whether the line is at that height where it passes: a crown overhead is not in the way
      const y = ay + dy * t
      if (y < o[i + 3] - margin || y > o[i + 4] + margin) continue
      const half = Math.sqrt(Math.max(0, r * r - (px * px + pz * pz)))
      const enter = t - half / len
      if (enter < nearest) nearest = Math.max(0, enter)
    }
    return nearest
  }

  /** How many obstacles are being kept track of, and the raw list, for diagnostics. */
  get obstacleList(): readonly number[] { return this.obstacles }

  /** The clock, and the only thing in this world that keeps one. */
  tick(dt: number): void {
    for (const w of this.winds) w.time += dt
    // A tree cannot be photographed for its impostor until its leaves have arrived off the network, so the
    // bake waits here for the materials to report themselves ready and then happens once, on one frame.
    if (this.pending.length) {
      const next = this.pending[0]
      // Whether the LEAVES have arrived, not whether the material is ready: `isReady(mesh)` asks about a
      // mesh that carries thin instances and answers no for reasons that have nothing to do with the bake,
      // which left the trees waiting for a photograph that never happened.
      const loaded = next.mats.every((m) => !m.diffuseTexture || m.diffuseTexture.isReady())
      // (the wait is checked before anything is suspended, or a waiting retake would leave the tree's
      // handover to its impostor switched off for its whole length)
      if ((next.wait ?? 0) > 0) { next.wait = (next.wait ?? 0) - dt; return }
      if (loaded) {
        // The tree's own handover to its impostor would discard it during its own photograph: the bake puts
        // the tree at the origin, which is a long way from wherever the rider is, and at that distance the
        // geometry has already dissolved away. So the handover is suspended for the length of the bake.
        const bands = next.lods.map((l) => ({ near: l.near, far: l.far }))
        for (const l of next.lods) { l.near = 1e8; l.far = 1e8 + 1 }
        // and it only leaves the queue once the photograph was actually taken: the bake refuses, and asks to
        // be tried again, while the shaders it needs are still compiling
        /**
         * Every tree is photographed twice, the second time a couple of seconds after the first.
         *
         * The readiness checks above catch what they can and not everything: an impostor could still come out
         * of its bake nearly black, and a black tree standing on the skyline among green ones is exactly the
         * kind of fault that looks like a rendering bug and is a race. By the second photograph the lights,
         * shadows and every plugin have long since settled, and it overwrites the first completely — at the
         * cost of one more small render per species, once.
         */
        if (renderImpostor(this.scene, next.picture, next.sources)) {
          this.pending.shift()
          if (!next.retake) this.pending.push({ ...next, retake: true, wait: 2 })
        }
        next.lods.forEach((l, i) => { l.near = bands[i].near; l.far = bands[i].far })
      }
    }
  }

  get meshes(): Mesh[] { return Object.values(this.species).flatMap((s) => s.parts) }

  /**
   * The standing scenery and the grass are rebuilt on different clocks, because they cover very different
   * ground. Trees reach six hundred metres and only need redoing when the rider crosses a hundred-metre
   * cell; grass reaches eighty, so it has to follow much more closely or its ring visibly trails behind the
   * rider. Rebuilding everything at the grass's rate would mean thousands of trees re-placed every few
   * seconds for no change at all.
   */
  update(worldX: number, worldZ: number): void {
    this.fade?.centre.set(worldX - this.frame.x, 0, worldZ - this.frame.z)
    for (const fade of this.coverFades) fade.centre.set(worldX - this.frame.x, 0, worldZ - this.frame.z)
    for (const l of this.lods) l.centre.set(worldX - this.frame.x, 0, worldZ - this.frame.z)
    const scaling = new Vector3()
    const position = new Vector3()
    const rotation = new Quaternion()

    // only over the detailed ring: the coarse ring beyond it is a different surface and things would float
    const reach = Math.ceil((Config.viewRadius - CELL) / CELL)
    const cx0 = Math.floor(worldX / CELL)
    const cz0 = Math.floor(worldZ / CELL)
    const signature = `${cx0},${cz0},${reach}`
    const grassSignature = `${Math.floor(worldX / Config.grassCell)},${Math.floor(worldZ / Config.grassCell)}`
    const standing = signature !== this.cells
    const sowing = grassSignature !== this.grassCells
    // The split between geometry and picture runs on a clock of its own: much more often than the scenery
    // is re-placed, because it only re-buckets numbers that already exist, and far less often than every
    // frame, because it still walks every instance.
    if (!standing && Number.isFinite(this.splitAt.x)
      && Math.hypot(worldX - this.splitAt.x, worldZ - this.splitAt.z) > Config.lodResplit) {
      for (const [name, sp] of Object.entries(this.species)) {
        if (sp.impostor) this.split(sp, worldX, worldZ)
        else if (name === 'grass') continue
      }
      this.splitAt = { x: worldX, z: worldZ }
    }
    if (!standing && !sowing) return
    this.cells = signature
    this.grassCells = grassSignature

    if (sowing) {
      const t0 = performance.now()
      this.species.grass.matrices.length = 0
      // the ground-cover bands live on the grass's clock, so they are cleared and rebuilt with it
      for (const { band, variants } of this.planted) {
        if (band.reach !== 'near') continue
        for (const v of variants) {
          const sp = this.species[this.keyOf(v)]
          if (sp) { sp.matrices.length = 0; if (sp.coverLevel) sp.coverLevel.length = 0 }
        }
      }
      holdLattice(() => { this.sowGrass(worldX, worldZ, scaling, position, rotation) })
      this.lastSowMs = performance.now() - t0
      this.uploadGrass(worldX - this.frame.x, worldZ - this.frame.z)
      for (const { band, variants } of this.planted) {
        if (band.reach !== 'near') continue
        for (const v of variants) {
          const sp = this.species[this.keyOf(v)]
          if (sp) this.uploadByLevel(sp)
        }
      }
    }
    if (!standing) return

    this.obstacles.length = 0
    const nearKeys = new Set<string>()
    for (const { band, variants } of this.planted) {
      if (band.reach === 'near') for (const v of variants) nearKeys.add(this.keyOf(v))
    }
    for (const [name, sp] of Object.entries(this.species)) {
      if (name !== 'grass' && !nearKeys.has(name)) {
        sp.matrices.length = 0
        if (sp.positions) sp.positions.length = 0
        if (sp.toTrail) sp.toTrail.length = 0
      }
    }

    /**
     * The standing scenery, band by band.
     *
     * Every band of the route's ecology gets its own pass over the same cells: how many it wants here from
     * its density, then each one tested against the band's own limits — which biome, between which heights,
     * on what steepness. A cell high on Alpe d'Huez will fail the broadleaf band's elevation test outright
     * and grow spruce and scree instead, and the belt where both bands accept is the mixed edge of the tree
     * line, which is what one actually looks like.
     */
    const standingFrom = performance.now()
    holdLattice(() => {
    for (let dz = -reach; dz <= reach; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const cx = cx0 + dx
        const cz = cz0 + dz
        const centre = this.route.nearestCoarse(cx * CELL + CELL / 2, cz * CELL + CELL / 2, 1200)
        if (!centre) continue
        const biome: BiomeName = this.route.biomeAt(centre.s)

        for (let b = 0; b < this.planted.length; b++) {
          const { band, variants } = this.planted[b]
          if (band.reach !== 'far') continue
          if (band.biomes && !band.biomes.includes(biome)) continue
          const count = Math.round(band.density * (CELL * CELL) / 10000)
          for (let n = 0; n < count; n++) {
            const seed = n + b * 7919
            const wx = cx * CELL + hash(cx, cz, seed * 3 + 1) * CELL
            const wz = cz * CELL + hash(cx, cz, seed * 3 + 2) * CELL
            /**
             * Rocks stop well short of the trees.
             *
             * The generator does not decimate a boulder, so every one is 1160 triangles at any distance, and
             * placed out to the full reach of the scenery they were a quarter of the Alpe's triangle budget —
             * mostly as two-pixel specks on hillsides half a kilometre off, where the terrain's own rock
             * texture already says "scree". A tree is worth drawing at five hundred metres; a stone is not.
             */
            if (band.from === 'rocks' && Math.hypot(wx - worldX, wz - worldZ) > Config.rockReach) continue
            const near = this.route.nearest(wx, wz, 60)
            // nothing grows on the trail, or in the cleared strip beside it
            if (near && near.distance < Config.trailWidth / 2 + 2.5) continue
            // nor in the river
            if (this.wet?.(wx, wz)) continue
            /**
             * The height the terrain mesh is actually BUILT at, not the exact surface — but only where the two
             * differ.
             *
             * The mesh chords across the relief between its five-metre samples, and a trunk set on the exact
             * surface stands above the triangle by the difference, which is what had rocks hanging in the air
             * on the steep ground. Asking the question the mesh's way costs four ground samples instead of one,
             * and measured over the standing pass on Alpe d'Huez that was 41 ms becoming 67 — an audible hitch
             * every hundred metres of road.
             *
             * The relief the mesh cannot follow is only invented on slopes in the first place (see
             * render/ground.ts), so on anything gentle the two answers are the same to a centimetre and the
             * cheap one will do. The threshold is under where the relief begins to fade in, so nothing that
             * could float is ever placed by the cheap path.
             */
            const steep = this.slopeAt(wx, wz)
            if (band.slope && (steep < band.slope[0] || steep > band.slope[1])) continue
            const ground = steep > 0.05
              ? meshHeight(this.route, wx, wz)
              : groundHeight(this.route, wx, wz)
            if (!Number.isFinite(ground)) continue
            if (band.elevation && (ground < band.elevation[0] || ground > band.elevation[1])) continue
            const roll = hash(cx, cz, seed * 3 + 3)

            const variant = variants[Math.floor(hash(cx + 6007, cz + 4801, seed) * variants.length) % variants.length]
            const key = this.keyOf(variant)
            const sp = this.species[key]
            if (!sp) continue

            // A model already has a height of its own, in metres, so a band that names one scales to it
            // rather than by a factor — otherwise a twelve-metre oak and a seven-metre birch given the same
            // factor stay as far apart as the library left them. A band with no height keeps its own size.
            const size = band.height
              ? (band.height[0] + roll * (band.height[1] - band.height[0])) / Math.max(0.2, variant.height)
              : 0.8 + roll * 0.55

            /**
             * Rocks lie down, and they lie IN the ground.
             *
             * Every one was being stood upright on the surface at the size the band asked for, and a boulder
             * generated as a roughly round lump, scaled evenly and set on top of the ground, reads as a
             * standing stone — which does exist and is not what most rocks do. A rock on a hillside is mostly
             * buried and wider than it is tall, because the tall ones fell over and the loose ones rolled.
             *
             * So a rock is squashed vertically, spread a little in one horizontal direction so it is not a
             * dome, tipped a few degrees off level, and sunk until a good part of it is under the surface.
             * `footingHeight` finds the lowest drawn ground beneath its footprint, which on a slope is its
             * downhill edge — set there, the uphill side buries itself in the hill, exactly as one does.
             */
            const rocky = band.from === 'rocks'
            const flat = rocky ? 0.42 + hash(cx + 7717, cz + 3313, seed) * 0.34 : 1
            const wide = rocky ? 1.06 + hash(cx + 6101, cz + 9109, seed) * 0.4 : 1
            scaling.set(size * wide, size * flat, size)
            /**
             * How far the ground falls across the rock, from the slope this band already measured.
             *
             * The honest way to find where a wide thing rests is to sample the drawn ground all round its
             * footprint and take the lowest — which is what `footingHeight` does, and it cost five times what
             * one sample costs. Measured, the standing pass went to seventy milliseconds on Alpe d'Huez, which
             * is four dropped frames every hundred metres of road. The slope is already in hand from the band's
             * own steepness test, and the drop across a footprint on a plane is the slope times its radius, so
             * the same answer is available for nothing.
             */
            const footprint = rocky ? Math.max(0.3, variant.crownRadius * size * wide) : 0
            const stand = rocky ? ground - steep * footprint : ground
            if (!Number.isFinite(stand)) continue
            // how far into the ground: a third of what is left of its height once it has been squashed
            const sink = rocky ? variant.height * size * flat * (0.22 + hash(cx + 4409, cz + 8803, seed) * 0.2) : 0.05
            position.set(wx - this.frame.x, stand - sink, wz - this.frame.z)
            const tip = rocky ? 0.12 + hash(cx + 5501, cz + 2203, seed) * 0.16 : 0
            Quaternion.RotationYawPitchRollToRef(
              roll * Math.PI * 2,
              tip * (hash(cx + 1201, cz + 1301, seed) - 0.5) * 2,
              tip * (hash(cx + 3407, cz + 6607, seed) - 0.5) * 2,
              rotation,
            )
            const m = Matrix.ComposeToRef(scaling, rotation, position, SCRATCH)
            const out = sp.matrices
            for (let i = 0; i < 16; i++) out.push(m.m[i])
            sp.positions ??= []
            sp.positions.push(wx, wz)
            sp.toTrail ??= []
            sp.toTrail.push(near ? near.distance : 999, near ? near.s : Number.NaN)

            // What the camera has to keep out of, with the height each thing occupies. The height band is
            // what stops the camera lurching: a crown three metres over its head is not in its way.
            const base = rocky ? stand - sink : ground
            const tall = variant.height * size * flat
            if (band.from === 'trees' && tall > 3) {
              this.obstacles.push(wx, wz, Config.trunkRadius * tall, base, base + tall)
              this.obstacles.push(wx, wz, variant.crownRadius * size * 0.72, base + tall * Config.crownFrom, base + tall)
            } else if (tall > 0.9) {
              this.obstacles.push(wx, wz, Math.max(variant.crownRadius * size * wide * 0.7, 0.4), base, base + tall)
            }
          }
        }
      }
    }
    })
    this.lastStandMs = performance.now() - standingFrom

    for (const [name, sp] of Object.entries(this.species)) {
      if (name !== 'grass' && !nearKeys.has(name)) this.split(sp, worldX, worldZ)
    }
    this.splitAt = { x: worldX, z: worldZ }
  }


  /**
   * Hand a mesh its instance data without allocating, wherever it can be avoided.
   *
   * Setting a thin-instance buffer from a fresh array does two expensive things: it makes garbage, and it
   * throws the GPU buffer away and creates another. The scatter did both for every mesh on every re-sow and
   * every re-split — the grass alone is a couple of megabytes — and the frame it happened on was the one where
   * the rider appeared to jump back as a tree changed its level of detail. So each mesh keeps one array per
   * kind of data with room to grow; new data is copied into it, the draw count set to what is actually there,
   * and the GPU buffer updated in place. Only outgrowing the array allocates, and it grows by half again so
   * that happens a handful of times in a ride rather than every few seconds.
   */
  private readonly pools = new WeakMap<Mesh, Map<string, Float32Array>>()
  private put(mesh: Mesh, kind: 'matrix' | 'color', data: ArrayLike<number>, stride: number): void {
    const count = Math.floor(data.length / stride)
    let byKind = this.pools.get(mesh)
    if (!byKind) { byKind = new Map(); this.pools.set(mesh, byKind) }
    let pool = byKind.get(kind)
    if (!pool || pool.length < data.length) {
      pool = new Float32Array(Math.max(stride * 16, Math.ceil(count * 1.5) * stride))
      pool.set(data as ArrayLike<number>)
      byKind.set(kind, pool)
      mesh.thinInstanceSetBuffer(kind, pool, stride, false)
    } else {
      pool.set(data as ArrayLike<number>)
      mesh.thinInstanceBufferUpdated(kind)
    }
    mesh.thinInstanceCount = count
  }

  /** The grass, split between its full tuft and its sparse one by distance, with each clump's colour kept. */
  private uploadGrass(cx: number, cz: number): void {
    const [near, far] = this.species.grass.parts
    const m = this.species.grass.matrices
    const tints = this.grassTints
    const nm: number[] = [], nc: number[] = [], fm: number[] = [], fc: number[] = []
    for (let i = 0, j = 0; i < m.length; i += 16, j += 4) {
      const to = Math.hypot(m[i + 12] - cx, m[i + 14] - cz) < Config.grassLodAt ? [nm, nc] : [fm, fc]
      for (let k = 0; k < 16; k++) to[0].push(m[i + k])
      for (let k = 0; k < 4; k++) to[1].push(tints[j + k] ?? 1)
    }
    for (const [mesh, mats, cols] of [[near, nm, nc], [far, fm, fc]] as Array<[Mesh, number[], number[]]>) {
      if (!mats.length) { mesh.setEnabled(false); continue }
      this.put(mesh, 'matrix', mats, 16)
      this.put(mesh, 'color', cols, 4)
      mesh.setEnabled(true)
    }
  }

  /**
   * Ground cover by level of detail — which it did not have, and which made it the single largest cost.
   *
   * Ferns, brambles, reeds and tussocks are sown on the grass's clock over the grass's ring and were drawn at
   * full detail across the whole of it: measured on the Katy's river bottom that was 1.7 million triangles,
   * two fifths of the frame and more than every tree put together, for plants that are a few pixels tall at
   * fifty metres. The library grows them with levels of detail like the trees; they just were not being used.
   *
   * No positions are kept for these (they are resown too often for it to be worth the memory), so the
   * distance is read straight off each instance's own matrix, which carries its position in scene space.
   * The boundaries move with the sowing rather than every frame, which for a fern is a level swapping a
   * few metres early or late at a distance where the two look the same.
   */
  /**
   * Ground cover, by the level each plant was given when its cell was sown.
   *
   * It used to be split by distance from the rider at twelve and thirty metres, which put a change of model
   * right beside the wheel every few seconds — ferns and brambles visibly reshaping, and for the moment the
   * new level's buffer was being filled, gone. The trees were cured the same way: the level is decided by how
   * far the plant's cell is from the TRAIL, which does not change as the rider goes by, so a plant is drawn at
   * one level for its whole pass.
   */
  private uploadByLevel(sp: Species): void {
    const levels = sp.levels ?? [sp.parts]
    const lv = sp.coverLevel ?? []
    const buckets = levels.map((_, b) => { LEVEL_SCRATCH[b].reset(); return LEVEL_SCRATCH[b] })
    for (let i = 0, k = 0; i < sp.matrices.length; i += 16, k++) {
      buckets[Math.min(levels.length - 1, lv[k] ?? 0)].push16(sp.matrices, i)
    }
    levels.forEach((meshes, b) => {
      for (const m of meshes) {
        if (buckets[b].length) { this.put(m, 'matrix', buckets[b].view(), 16); m.setEnabled(true) } else m.setEnabled(false)
      }
    })
    for (const m of sp.parts) if (!levels.some((L) => L.includes(m))) m.setEnabled(false)
  }

  private uploadByDistance(sp: Species, cx: number, cz: number, cutsAll: number[]): void {
    const levels = sp.levels ?? [sp.parts]
    if (levels.length < 2) { this.upload(sp); return }
    const cuts = cutsAll.slice(Math.max(0, cutsAll.length - (levels.length - 1)))
    const buckets: number[][] = levels.map(() => [])
    const m = sp.matrices
    for (let i = 0; i < m.length; i += 16) {
      const d = Math.hypot(m[i + 12] - cx, m[i + 14] - cz)
      let b = 0
      while (b < cuts.length && d >= cuts[b]) b++
      for (let k = 0; k < 16; k++) buckets[b].push(m[i + k])
    }
    levels.forEach((meshes, b) => {
      for (const mesh of meshes) {
        if (buckets[b].length) { this.put(mesh, 'matrix', buckets[b], 16); mesh.setEnabled(true) } else mesh.setEnabled(false)
      }
    })
  }

  /**
   * The trunk and the crown of a tree are the same tree, so they share one set of transforms.
   *
   * Everything goes to the nearest level. This is the path for the things that are only ever near — the ground
   * cover, the ferns — and for anything with only one level to be drawn at; whatever is drawn at a distance is
   * split between its levels instead (see `split`). The other levels are turned off explicitly, or a species
   * that came through here after being split would go on drawing its coarse copies over its fine ones.
   */
  private upload(sp: Species): void {
    const near = sp.levels?.[0] ?? sp.parts
    for (const m of sp.parts) if (!near.includes(m)) m.setEnabled(false)
    for (const m of near) {
      if (sp.matrices.length) {
        this.put(m, 'matrix', sp.matrices, 16)
        m.setEnabled(true)
      } else {
        m.setEnabled(false)
      }
    }
  }

  /**
   * Split a species' instances between its levels of detail and its picture, by distance.
   *
   * This is the part that actually saves anything, and the dissolve alone does not: a discard still transforms
   * and submits every triangle, and the frame's triangle count with impostors on measured **exactly the same**
   * as with them off. To reclaim geometry the distant trees have to stop being SENT — which means a buffer per
   * level and a rule for which instance goes in which.
   *
   * Every level was the same one until now, chosen once by `Config.treeDetail`, so a wood six hundred metres
   * deep was drawn at the detail its nearest tree needed: measured at six to eight million triangles against a
   * budget of one and a half. An ash is 1122 triangles at LOD0, 389 at LOD1 and 173 at LOD2, and the great
   * majority of the trees on screen are far enough away to be the cheapest of those.
   *
   * The rule is generous at every edge, because this runs on its own clock rather than every frame: an instance
   * goes in each bucket it could plausibly be wanted in before the next re-split. Overlapping costs a tree drawn
   * twice for a moment; a gap would show as a tree that is not there at all.
   */
  private split(sp: Species, worldX: number, worldZ: number): void {
    const pos = sp.positions
    const levels = sp.levels ?? [sp.parts.filter((m) => m !== sp.impostor)]
    if (!pos || (!sp.impostor && levels.length < 2)) {
      this.upload(sp)
      return
    }
    const slack = Config.lodResplit * 1.5
    // without a picture to hand over to, the last level carries on to the edge of the world
    const keepGeometry = sp.impostor ? (sp.impostorTo ?? Config.impostorTo) + slack : Infinity
    const keepPicture = sp.impostor ? (sp.impostorFrom ?? Config.impostorFrom) - slack : Infinity

    /**
     * Where each level of detail gives way to the next.
     *
     * The thresholds are taken from the END of the configured list, so a model with fewer levels keeps the
     * coarsest ones: a species with two levels switches at the outer distance and never draws the full model
     * near, rather than drawing the full model to the outer distance. The last band always runs out to the
     * impostor, so there is no distance at which a tree has no level to be drawn at.
     */
    const buckets = levels.map((_, b) => { LEVEL_SCRATCH[b].reset(); return LEVEL_SCRATCH[b] })
    const far = FAR_SCRATCH
    far.reset()

    const tt = sp.toTrail
    for (let i = 0, j = 0; i < sp.matrices.length; i += 16, j += 2) {
      const d = Math.hypot(pos[j] - worldX, pos[j + 1] - worldZ)
      if (d < keepGeometry) {
        /**
         * Exactly one level each, with no slack at the boundaries.
         *
         * The overlap that the geometry/picture split leaves is there because those two DISSOLVE through each
         * other — each discards a complementary half of its pixels, so both being drawn is one whole tree. Two
         * levels of geometry do not: they are both opaque, both at full coverage, and in the same place. Given
         * the same slack they z-fight along every trunk and draw two canopies, which is a shimmer on every tree
         * in the middle distance and twice the triangles for it. A hard switch is right here, and nothing can
         * fall through a gap because every distance belongs to some band; the re-split clock only means the
         * boundary itself wanders a few metres, which is a level swapping a moment early or late at a distance
         * where the two look the same.
         */
        /**
         * The level is chosen by the ROAD, not by the rider.
         *
         * This is a ride along a known line, so which trees will be passed closely is known long before they
         * are reached. A tree's distance from the trail does not change as the rider goes by it, so a level
         * chosen by that distance is the same for the whole of the pass — whereas one chosen by distance from
         * the rider changes, visibly, at whatever radius the cut sits, which put a swap right beside the rider
         * every few metres. Now a tree beside the trail is at full detail from the moment it becomes geometry
         * (a hundred and forty metres out, where the change from its impostor already happens and cannot be
         * seen), and keeps it all the way past.
         *
         * Radial distance still matters for trees nowhere near the route: past `treeLodFar` everything is at the
         * coarsest level whatever its lateral distance, because a tree a hundred metres off a hairpin's far leg
         * is still a hundred metres away.
         */
        const lateral = tt ? tt[j] : 999
        const bands = Config.treeLodLateral
        let b = 0
        while (b < bands.length && lateral >= bands[b]) b++
        // Nothing is demoted once passed. It was, at first, and on Alpe d'Huez's switchbacks the road doubles
        // back and brings a passed tree in front of the rider again — where it was promoted back, in plain view.
        // Keeping passed trees at their level costs about a tenth more triangles, all of them behind the camera.
        if (d > Config.treeLodFar) b = levels.length - 1
        b = Math.min(levels.length - 1, b)
        buckets[b].push16(sp.matrices, i)
      }
      if (d > keepPicture) far.push16(sp.matrices, i)
    }

    levels.forEach((meshes, b) => {
      for (const m of meshes) {
        if (buckets[b].length) { this.put(m, 'matrix', buckets[b].view(), 16); m.setEnabled(true) } else m.setEnabled(false)
      }
    })
    if (sp.impostor) {
      if (far.length) {
        this.put(sp.impostor, 'matrix', far.view(), 16)
        sp.impostor.setEnabled(true)
      } else {
        sp.impostor.setEnabled(false)
      }
    }
  }

  /**
   * Grass, which is its own pass because there is so much more of it than of everything else put together.
   *
   * Thousands of tufts on a grid of its own, over a ring of eighty metres rather than the six hundred the
   * trees cover: past that a tuft is under a pixel and there is no picture in it, only cost. The density is
   * the biome's, per square metre rather than per hectare, and it thins out toward the edge of the ring so
   * that grass fades into the textured ground instead of stopping along a circle.
   */
  private sowGrass(worldX: number, worldZ: number, scaling: Vector3, position: Vector3, rotation: Quaternion): void {
    const cell = Config.grassCell
    const radius = Config.grassRadius
    const reach = Math.ceil(radius / cell)
    const cx0 = Math.floor(worldX / cell)
    const cz0 = Math.floor(worldZ / cell)
    const out = this.species.grass.matrices
    const tints = this.grassTints
    tints.length = 0
    const ground = new Color3()
    const tint = new Color3()
    const live = new Set<string>()
    const nearSpecies: Species[] = []
    for (const { band, variants } of this.planted) {
      if (band.reach !== 'near') continue
      for (const v of variants) {
        const sp = this.species[this.keyOf(v)]
        if (sp && !nearSpecies.includes(sp)) nearSpecies.push(sp)
      }
    }

    // How high the ground is, sampled on a lattice and interpolated between, rather than asked once per
    // clump. This is the whole cost of sowing: `groundHeight` projects onto the trail twice and reads the
    // elevation model, and doing it tens of thousands of times took fifty milliseconds — a visible stutter
    // every time the rider crossed a cell. The terrain mesh itself is only built every five metres, so a
    // lattice at this spacing describes the same surface a clump would have stood on anyway, and the same
    // samples give the slope for free.
    /**
     * On the terrain's OWN lattice, so a blade stands on the ground that is drawn.
     *
     * The lattice used to have a spacing of its own and to start at each grass cell's corner, which meant its
     * samples were not the mesh's samples and the surface it described was not the surface on screen. Between
     * them a clump could stand a little clear of the ground or sink into it, which on a hillside is the
     * difference between grass growing and grass floating. Sampling at the terrain step, on the global grid the
     * terrain chunks are built on, makes the two the same surface by construction.
     */
    const step = Config.terrainStep
    const heights = new Float64Array(64 * 64)

    for (let dz = -reach; dz <= reach; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const cx = cx0 + dx
        const cz = cz0 + dz
        const ox = cx * cell
        const oz = cz * cell
        // which cells are in the ring depends on where the rider is; what is IN a cell does not (see the cache)
        const dCentre = Math.hypot(ox + cell / 2 - worldX, oz + cell / 2 - worldZ)
        if (dCentre - cell > radius) continue
        const ck = `${cx},${cz}`
        live.add(ck)
        const hit = this.grassCache.get(ck)
        if (hit) {
          for (let i = 0; i < hit.grass.length; i++) out.push(hit.grass[i])
          for (let i = 0; i < hit.tints.length; i++) tints.push(hit.tints[i])
          for (const [sp, m, lv] of hit.plants) {
            for (let i = 0; i < m.length; i++) sp.matrices.push(m[i])
            const into = (sp.coverLevel ??= [])
            for (let i = 0; i < lv.length; i++) into.push(lv[i])
          }
          continue
        }
        const g0 = out.length
        const t0 = tints.length
        const p0 = nearSpecies.map((sp) => sp.matrices.length)
        const l0 = nearSpecies.map((sp) => (sp.coverLevel ??= []).length)
        try {
        // the lattice covering this cell, snapped outward onto the terrain's grid
        const lx = Math.floor(ox / step) * step
        const lz = Math.floor(oz / step) * step
        const lat = Math.ceil((ox + cell - lx) / step) + 1
        // nothing outside the baked corridor, and nothing whose nearest corner is beyond the ring
        const centre = this.route.nearestCoarse(ox + cell / 2, oz + cell / 2, 1200)
        if (!centre) continue

        const biome: BiomeName = this.route.biomeAt(centre.s)
        const palette = BIOMES[biome]
        /**
         * One density, everywhere in the ring.
         *
         * There was a thicker ring close to the rider, on the reasoning that the near ground is the only part
         * anybody looks at closely. It worked and it popped: the switch was decided per fourteen-metre cell, so
         * crossing a cell boundary brought a whole cell's worth of extra clumps into being at once, at thirty
         * metres, well inside the distance at which they are drawn full height. On open ground that is a patch
         * of meadow appearing out of nothing every few seconds. The density is uniform now and simply higher;
         * what the near ground gets instead is the fade, which is per frame and cannot pop.
         */
        const count = Math.round(Config.grassDensity[biome] * cell * cell)
        if (!count) continue

        let anyGround = false
        for (let j = 0; j < lat; j++) {
          for (let i = 0; i < lat; i++) {
            const h = groundHeight(this.route, lx + i * step, lz + j * step)
            heights[j * lat + i] = h
            if (Number.isFinite(h)) anyGround = true
          }
        }
        if (!anyGround) continue

        // Whether anything in this cell could be near enough to the trail to matter, asked once. The thinned
        // index is good to about a hundred metres, so the margin is generous; it still rejects most cells.
        const keepOff = Config.trailWidth / 2 + Config.grassMargin
        const nearTrail = this.route.nearestCoarse(ox + cell / 2, oz + cell / 2, keepOff + cell + 240) !== null
        // which level this cell's plants are drawn at: full detail if it is beside the trail, else the middle
        const beside = this.route.nearest(ox + cell / 2, oz + cell / 2, Config.coverFullWithin + cell)
        const cellLevel = beside && beside.distance < Config.coverFullWithin ? 0 : 1

        for (let n = 0; n < count; n++) {
          // The three draws have to be properly independent of each other. A tree cell asks this hash for a
          // couple of dozen numbers and any weakness in it is invisible; a grass cell asks for a thousand,
          // and taking them from neighbouring counter values made the clumps land on a faint lattice that
          // read as a planted field. Separating the streams by large offsets breaks it.
          const fx = hash(cx, cz, n)
          const fz = hash(cx + 9973, cz + 7717, n)
          const wx = ox + fx * cell
          const wz = oz + fz * cell
          const roll = hash(cx + 20011, cz + 15013, n)

          if (nearTrail) {
            const near = this.route.nearest(wx, wz, keepOff + 2)
            // A clump is placed by its middle and is most of a metre across, so keeping its CENTRE off the
            // road leaves half of it lying on the tarmac. The margin has to cover the clump's own reach.
            if (near && near.distance < keepOff) continue
          }
          if (this.wet?.(wx, wz)) continue

          // bilinear, off the lattice
          const gx = (wx - lx) / step
          const gz = (wz - lz) / step
          const i0 = Math.min(lat - 2, Math.floor(gx))
          const j0 = Math.min(lat - 2, Math.floor(gz))
          const tx = gx - i0
          const tz = gz - j0
          const h00 = heights[j0 * lat + i0]
          const h10 = heights[j0 * lat + i0 + 1]
          const h01 = heights[(j0 + 1) * lat + i0]
          const h11 = heights[(j0 + 1) * lat + i0 + 1]
          if (!Number.isFinite(h00) || !Number.isFinite(h10) || !Number.isFinite(h01) || !Number.isFinite(h11)) continue
          const y = (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz

          const size = Config.grassClumpSize * (0.72 + roll * 0.62)
          scaling.set(size, size * (0.78 + roll * 0.5), size)
          position.set(wx - this.frame.x, y - 0.04, wz - this.frame.z)
          // leaning a little, each its own way: a field of clumps all standing to attention is a field of boxes
          const lean = hash(cx + 40009, cz + 35023, n)
          Quaternion.RotationYawPitchRollToRef(roll * Math.PI * 2, (lean - 0.5) * 0.34, (hash(cx + 50021, cz + 45007, n) - 0.5) * 0.34, rotation)
          const m = Matrix.ComposeToRef(scaling, rotation, position, SCRATCH)
          for (let i = 0; i < 16; i++) out.push(m.m[i])

          // The colour of the ground this clump is growing out of, mixed into the colour of the clump. This
          // is the one trick that stops grass reading as objects scattered on a surface: a stylised-grass
          // shader does it by rendering the terrain to a colour map and sampling it, and the same answer is
          // available here for nothing, because the terrain's own colour is a function the renderer already
          // has — and the slope it needs comes out of the same lattice.
          const slope = Math.hypot(h10 - h00, h01 - h00) / step
          groundColour(palette, y, slope, 0, ground)
          Color3.LerpToRef(palette.grass, ground, Config.grassGroundBlend, tint)
          tint.scaleInPlace(Config.grassLift)
          // and no two clumps quite the same, or a meadow is one flat colour
          const vary = 0.84 + hash(cx + 31013, cz + 27011, n) * 0.32
          tints.push(tint.r * vary, tint.g * vary, tint.b * vary, 1)
        }

        /**
         * And the route's own ground cover over the top of the blades: ferns, heather, prairie grass, the
         * flowers of the place. The blades are a mat and these are what is growing out of it, which is why
         * both are sown rather than one replacing the other.
         */
        for (let b = 0; b < this.planted.length; b++) {
          const { band, variants } = this.planted[b]
          if (band.reach !== 'near') continue
          if (band.biomes && !band.biomes.includes(biome)) continue
          const many = Math.round(band.density * cell * cell)
          for (let n = 0; n < many; n++) {
            const seed = n + b * 6661
            const fx = hash(cx + 101, cz + 211, seed)
            const fz = hash(cx + 9973, cz + 7717, seed)
            const wx = ox + fx * cell
            const wz = oz + fz * cell
            if (nearTrail) {
              const near = this.route.nearest(wx, wz, keepOff + 2)
              if (near && near.distance < keepOff) continue
            }
            if (this.wet?.(wx, wz)) continue
            const gx = (wx - lx) / step
            const gz = (wz - lz) / step
            const i0 = Math.min(lat - 2, Math.floor(gx))
            const j0 = Math.min(lat - 2, Math.floor(gz))
            const h00 = heights[j0 * lat + i0]
            const h10 = heights[j0 * lat + i0 + 1]
            const h01 = heights[(j0 + 1) * lat + i0]
            const h11 = heights[(j0 + 1) * lat + i0 + 1]
            if (!Number.isFinite(h00) || !Number.isFinite(h11)) continue
            const tx = gx - i0
            const tz = gz - j0
            const y = (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz
            if (band.elevation && (y < band.elevation[0] || y > band.elevation[1])) continue
            const slope = Math.hypot(h10 - h00, h01 - h00) / step
            if (band.slope && (slope < band.slope[0] || slope > band.slope[1])) continue

            const roll = hash(cx + 20011, cz + 15013, seed)
            const variant = variants[Math.floor(hash(cx + 3301, cz + 5501, seed) * variants.length) % variants.length]
            const sp = this.species[this.keyOf(variant)]
            if (!sp) continue
            const size = band.height
              ? (band.height[0] + roll * (band.height[1] - band.height[0])) / Math.max(0.15, variant.height)
              : 0.75 + roll * 0.6
            scaling.set(size, size, size)
            position.set(wx - this.frame.x, y - 0.03, wz - this.frame.z)
            Quaternion.RotationYawPitchRollToRef(roll * Math.PI * 2, 0, 0, rotation)
            const m = Matrix.ComposeToRef(scaling, rotation, position, SCRATCH)
            for (let i = 0; i < 16; i++) sp.matrices.push(m.m[i])
            ;(sp.coverLevel ??= []).push(cellLevel)
          }
        }
        } finally {
          // whatever this cell produced — possibly nothing — is kept, and it is never worked out again
          this.grassCache.set(ck, {
            grass: out.slice(g0),
            tints: tints.slice(t0),
            plants: nearSpecies.map((sp, i) => [sp, sp.matrices.slice(p0[i]), (sp.coverLevel ?? []).slice(l0[i])] as [Species, number[], number[]]),
          })
        }
      }
    }
    // and the cache forgets cells well outside the ring, so it holds a ring's worth and no more
    for (const k of this.grassCache.keys()) if (!live.has(k)) this.grassCache.delete(k)
  }

  /** Rise over run of the ground itself, from the elevation model. */
  private slopeAt(x: number, z: number): number {
    const d = 20
    const a = this.route.heightAt(x - d, z)
    const b = this.route.heightAt(x + d, z)
    const c = this.route.heightAt(x, z - d)
    const e = this.route.heightAt(x, z + d)
    if (![a, b, c, e].every(Number.isFinite)) return 0
    return Math.hypot(b - a, e - c) / (2 * d)
  }

  dispose(): void {
    for (const s of Object.values(this.species)) for (const m of s.parts) m.dispose()
    for (const m of this.materials) m.dispose()
  }
}
