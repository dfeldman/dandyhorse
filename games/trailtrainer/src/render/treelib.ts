/**
 * The pre-generated tree library: real trees, loaded from glTF, instead of ones folded out of cards here.
 *
 * Five hundred of them live under `public/trees/`, grown offline by the project's own generator — ten species
 * with fifty-odd seeds apiece, each carrying three levels of detail and an index giving its height and crown
 * radius. They are far better than anything assembled at run time out of quads: proper forking trunks, leaves
 * clustered the way that species clusters them, and bark that is bark rather than a tiled photograph.
 *
 * Only a handful are loaded. A wood does not need five hundred distinct trees to stop looking stamped out —
 * it needs a few, at different sizes and rotations, and the eye stops counting. Loading them all would be a
 * hundred and seventy megabytes for a difference nobody could see from a bicycle.
 *
 * **Their materials are converted to StandardMaterial on the way in.** The glTF carries physically based
 * materials, and everything this renderer does to vegetation — the air it is seen through, the wind in it,
 * the handover to its impostor — is written against the standard material's shader, whose injection points
 * and variable names are not the same. Converting once at load is a great deal less work than keeping two
 * versions of every one of those, and nothing in these trees needs what the physically based shader offers:
 * they are lit by one sun, and they are leaves.
 */
import '@babylonjs/loaders/glTF'
import { type Band, type Ecology, type Library, pickFiles } from './ecology.ts'
import { libraryIndex } from './assetsource.ts'
import {
  type AbstractMesh,
  Color3,
  loadAssetContainerAsync,
  Material,
  Mesh,
  type PBRMaterial,
  type Scene,
  StandardMaterial,
  Texture,
} from '@babylonjs/core'

export interface TreeVariant {
  name: string
  /** what the library called it: oak, spruce, fern, scree */
  species: string
  /** the bark and the leaves of the FULL model, in that order: one solid, one cut out */
  parts: Mesh[]
  /**
   * The same model at each level of detail the file actually offers, closest first — `levels[0]` is `parts`.
   *
   * Levels that are not a real saving are not here. The generators write three for everything, but only trees
   * are decimated: a rock's LOD1 and LOD2 are byte-for-byte its LOD0, so loading them would be three copies of
   * one mesh, three draw calls and three sets of instance buffers for no triangles saved. A species with one
   * entry here is simply drawn as itself at every distance.
   */
  levels: Mesh[][]
  /** metres, from the index, so the scatter can scale a tree to the size it wants one */
  height: number
  crownRadius: number
}

/**
 * The library ships an index of what it grew. It is used when it is there — it knows each tree's intended
 * height, which is better than a bounding box, because a box includes whatever the longest branch happens to
 * reach. But the library is regenerated from time to time and the index comes and goes with it, so nothing
 * here depends on it: without one, every tree is measured as it loads.
 */
interface IndexEntry {
  species: string
  seed: number
  height: number
  crown_radius: number
  file: string
}

/** Which level of detail to instance. 0 is the full tree; 2 is a stump of one. */
export type TreeDetail = 0 | 1 | 2

/**
 * Rebuild a glTF material as a standard one.
 *
 * Only the parts that matter here are carried over: the colour map, the bumps, and — the one that decides
 * whether a tree reads at all — whether the material is cut out. The leaves arrive as an alpha MASK material,
 * which is a cut-out by another name.
 */
function convert(scene: Scene, source: PBRMaterial, name: string): StandardMaterial {
  const m = new StandardMaterial(name, scene)
  const albedo = source.albedoTexture as Texture | null
  if (albedo) {
    /**
     * **Reloaded, rather than handed over — and this is what was making every tree dark.**
     *
     * The glTF loader uploads a base-colour texture as sRGB, because the physically based shader wants a
     * linear value and lets the hardware do the conversion on every sample. The standard material wants the
     * opposite: it expects a texture that is already display-ready and, with image processing switched on,
     * linearises it itself at the end of the frame. Give it the loader's texture and the curve is applied
     * twice — a mid-tone bark at 0.35 comes out near 0.09, and a whole wood is nearly black while every other
     * surface in the scene, whose textures this renderer loaded itself, is correctly lit.
     *
     * Setting `gammaSpace` afterwards does not help: the format was decided when the image was uploaded. The
     * fix is to load the same file again as an ordinary texture, which is cheap — the browser has it cached,
     * and there are only a handful of bark and leaf pages shared across the whole library.
     *
     * Worth knowing how long this hid. Several passes were spent raising diffuse multipliers, emissive terms
     * and the ambient light against it; each helped a little and none fixed it, because a squaring is a curve
     * and no amount of scaling undoes a curve.
     */
    // The loader records the image's path with a `data:` prefix even though it is an ordinary file beside
    // the model, and a texture asked for by that name never loads — which shows up as trees with no bark and
    // no leaves at all rather than as an error.
    const url = (albedo.url ?? albedo.name).replace(/^data:/, '')
    const own = new Texture(url, scene, { invertY: false, samplingMode: Texture.TRILINEAR_SAMPLINGMODE })
    own.wrapU = albedo.wrapU
    own.wrapV = albedo.wrapV
    own.anisotropicFilteringLevel = 8
    own.hasAlpha = source.transparencyMode === Material.MATERIAL_ALPHATEST
    m.diffuseTexture = own
  }
  if (source.bumpTexture) m.bumpTexture = source.bumpTexture
  m.diffuseColor = Color3.White()
  // the sun is the only specular in this world and leaves are not shiny
  m.specularColor = Color3.Black()
  if (source.transparencyMode === Material.MATERIAL_ALPHATEST) {
    m.useAlphaFromDiffuseTexture = true
    m.transparencyMode = Material.MATERIAL_ALPHATEST
    /**
     * Low, because the real cut-out happens in the card plugin (render/materials/card.ts) and this one runs
     * first. Babylon's own alpha test is a fixed threshold applied straight after the texture is sampled,
     * which is exactly the test that has to vary with distance if a canopy is not to dissolve into specks at
     * a hundred metres — so it is set below anything the plugin would keep, and left to catch only the
     * genuinely empty parts of the page.
     */
    m.alphaCutOff = 0.05
    // a leaf has two faces and both of them are the outside of the tree
    m.backFaceCulling = false
    m.twoSidedLighting = true
  } else {
    /**
     * Bark is opaque, and has to be told so. Every tree part carries a four-component colour per thin
     * instance (render/scatter.ts), and with no transparency mode set Babylon reads that alpha channel as a
     * reason to BLEND the mesh — so every trunk went into the sorted transparent queue alongside the water,
     * sorted by a centre that for a thin-instanced mesh is the world origin. Whichever came out later won,
     * and on the Katy that was the river, drawn straight across trunks standing in front of it.
     */
    m.transparencyMode = Material.MATERIAL_OPAQUE
  }
  return m
}

/**
 * Load the named trees and hand back one variant each, ready to be given thin instances.
 *
 * The container is loaded rather than appended, so nothing is added to the scene except the two meshes that
 * are wanted; the other two levels of detail and the glTF's own nodes are dropped on the floor.
 */
export async function loadTrees(
  scene: Scene,
  folder: Library,
  files: string[],
  detail: TreeDetail,
  dress?: (material: StandardMaterial, kind: 'bark' | 'leaves') => void,
): Promise<TreeVariant[]> {
  // The library's index and its file URLs come from the asset source (the shared bucket, or public/ with
  // ?assets=local): see assetsource.ts.
  const lib = await libraryIndex(folder)
  const byFile = new Map<string, IndexEntry>()
  for (const t of lib?.entries ?? []) byFile.set(t.file, t as unknown as IndexEntry)
  const out: TreeVariant[] = []

  for (const file of files) {
    const entry = byFile.get(file)
    // The library is regenerated from time to time, and a tree that is missing, half-written or renamed is
    // not a reason for the ride not to start — it is a reason for that tree not to be in the wood.
    let container
    try {
      if (!lib) throw new Error('library unavailable')
      container = await loadAssetContainerAsync(lib.url(file), scene)
    } catch (e) {
      console.warn(`treelib: skipping ${folder}/${file}`, e)
      continue
    }

    // A glTF node holding a mesh of several primitives comes through as a parent with one child per
    // primitive, named after the node with a suffix — so the bark and the leaves of `LOD0` arrive as
    // `LOD0_primitive0` and `LOD0_primitive1`. Matching on the prefix catches both shapes, and anything
    // without vertices is the empty parent.
    /**
     * Every level the file has, not one of them.
     *
     * This used to take a single level named by `Config.treeDetail` and instance it at every distance, which is
     * the whole of why the triangle budget was gone: a wood six hundred metres deep was drawn at the detail the
     * nearest tree needed. The levels are all loaded now and the scatter hands each instance the one that suits
     * how far away it is (see render/scatter.ts). `detail` survives as a floor on quality — a slow machine can
     * start at LOD1 and never draw the full model at all.
     */
    const byLevel: Mesh[][] = []
    for (let level = detail; level <= 2; level++) {
    const want = `LOD${level}`
    const parts: Mesh[] = []
    for (const m of container.meshes) {
      if (!(m instanceof Mesh)) continue
      if (m.name !== want && !m.name.startsWith(`${want}_`)) continue
      if (!m.getTotalVertices()) continue
      m.parent = null
      m.position.setAll(0)
      m.rotationQuaternion = null
      m.rotation.setAll(0)
      m.scaling.setAll(1)
      m.isPickable = false
      m.receiveShadows = false
      m.alwaysSelectAsActiveMesh = true
      const pbr = m.material as PBRMaterial | null
      if (pbr) {
        const leafy = pbr.transparencyMode === Material.MATERIAL_ALPHATEST || pbr.needAlphaTesting()
        const converted = convert(scene, pbr, `${entry?.species ?? file.replace('.glb', '')}_${leafy ? 'leaves' : 'bark'}`)
        dress?.(converted, leafy ? 'leaves' : 'bark')
        m.material = converted
      }
      scene.addMesh(m)
      parts.push(m)
    }

    // the leaves last, so the solid wood is drawn before the cut-out over it
    parts.sort((a, b) => Number(a.material?.transparencyMode === Material.MATERIAL_ALPHATEST) - Number(b.material?.transparencyMode === Material.MATERIAL_ALPHATEST))

    /**
     * Only if it is actually cheaper than the level before it.
     *
     * A rock's three levels are the same mesh, and a level that saves nothing costs a draw call, an instance
     * buffer and a set of shader plugins to keep in step with the others. A fifth off is the threshold: below
     * that the switch is not worth the second copy.
     */
    const tris = parts.reduce((n, m) => n + m.getTotalIndices() / 3, 0)
    const before = byLevel[byLevel.length - 1]
    const beforeTris = before ? before.reduce((n, m) => n + m.getTotalIndices() / 3, 0) : Infinity
    if (tris < beforeTris * 0.8) byLevel.push(parts)
    else for (const m of parts) { m.material?.dispose(); m.dispose() }
    }

    // The generator writes what it grew into the glTF's own extras, so the file knows its own height and
    // there is nothing to look up. Babylon hands those through as mesh metadata.
    const grown = container.meshes
      .concat(container.transformNodes as unknown as AbstractMesh[])
      .map((n) => (n.metadata as { gltf?: { extras?: { height?: number; crown_radius?: number } } } | null)?.gltf?.extras)
      .find((e) => e && typeof e.height === 'number')

    const parts = byLevel[0] ?? []
    if (!parts.length) {
      console.warn(`treelib: ${file} has no LOD${detail}`)
      continue
    }
    // measured off the geometry when the index is not there to say
    let top = 0
    let reach = 0
    for (const m of parts) {
      m.refreshBoundingInfo()
      const b = m.getBoundingInfo().boundingBox
      top = Math.max(top, b.maximum.y)
      reach = Math.max(reach, Math.abs(b.maximum.x), Math.abs(b.minimum.x), Math.abs(b.maximum.z), Math.abs(b.minimum.z))
    }
    out.push({
      name: file,
      species: entry?.species ?? file.replace(/_\d+\.glb$/, ''),
      parts,
      levels: byLevel,
      height: grown?.height ?? entry?.height ?? top,
      crownRadius: grown?.crown_radius ?? entry?.crown_radius ?? reach,
    })
  }
  if (!out.length) throw new Error('treelib: none of the configured trees could be loaded')
  return out
}

/** A band of the ecology, with the models it draws from loaded and ready to be given instances. */
export interface PlantedBand {
  band: Band
  variants: TreeVariant[]
}

/**
 * Load everything an ecology asks for.
 *
 * Bands share models: the same oak belongs to the Katy's forest band and its prairie band, and the same
 * spruce to two overlapping belts on the Alpe. Each file is loaded once and handed to every band that wants
 * it, which is the difference between six downloads and twenty.
 */
export async function loadEcology(
  scene: Scene,
  eco: Ecology,
  detail: TreeDetail,
  dress?: (material: StandardMaterial, kind: 'bark' | 'leaves') => void,
  onProgress?: (done: number, total: number) => void,
): Promise<PlantedBand[]> {
  const indexes = new Map<Library, Array<{ species: string; file: string; season?: string }>>()
  for (const folder of ['trees', 'plants', 'rocks'] as Library[]) {
    // a library that can't be read simply has nothing in it
    const lib = await libraryIndex(folder)
    if (lib) indexes.set(folder, lib.entries)
  }

  const wanted = new Map<string, { folder: Library; file: string }>()
  const perBand = eco.bands.map((band) => {
    const index = indexes.get(band.from) ?? []
    const files = pickFiles(index, band.species, eco.variants, band.season ?? eco.season)
    for (const file of files) wanted.set(`${band.from}/${file}`, { folder: band.from, file })
    return { band, files }
  })

  const loaded = new Map<string, TreeVariant>()
  let done = 0
  for (const [key, { folder, file }] of wanted) {
    const got = await loadTrees(scene, folder, [file], detail, dress)
    if (got[0]) loaded.set(key, got[0])
    onProgress?.(++done, wanted.size)
  }

  return perBand
    .map(({ band, files }) => ({
      band,
      variants: files.map((f) => loaded.get(`${band.from}/${f}`)).filter((v): v is TreeVariant => !!v),
    }))
    .filter((b) => b.variants.length)
}
