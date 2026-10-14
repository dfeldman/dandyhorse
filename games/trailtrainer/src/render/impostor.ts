/**
 * Octahedral impostors: a distant tree drawn as one square, showing a picture of itself from the angle you
 * happen to be looking from.
 *
 * A billboard — one picture, turned to face the camera — has been the cheap far-LOD since forever, and it
 * fails the moment you look down on it from a hillside, because a tree photographed from the side does not
 * look like a tree from above. An octahedral impostor fixes that by photographing the tree from a whole grid
 * of directions over the hemisphere and picking the nearest one at draw time. The mapping from direction to
 * grid cell is the octahedral one: fold the hemisphere flat onto a square, so the centre of the square is
 * straight above the tree and its edges are the horizon, with no seams and no poles.
 *
 * The baking happens once, at load, into a render target — and the reason that works here rather than needing
 * an offline pipeline is that **the sun never moves in this game**. A baked picture carries its lighting with
 * it, which is normally the awkward part of impostors; with a fixed sun the lighting in the picture is
 * exactly the lighting the real tree would have had.
 *
 * What it buys: a tree at two hundred metres costs two triangles instead of several hundred, which is most of
 * the vegetation budget back. What it costs: the picture is flat, so it is only used far enough away that
 * nobody can tell — and the changeover is dithered (see render/materials/lod.ts) so there is no pop.
 */
import {
  Color4,
  Constants,
  type Material,
  MaterialDefines,
  MaterialPluginBase,
  Mesh,
  type AbstractEngine,
  type Scene,
  RenderTargetTexture,
  ShaderLanguage,
  type SubMesh,
  type UniformBuffer,
  TargetCamera,
  Vector3,
  VertexData,
  Viewport,
} from '@babylonjs/core'

export interface ImpostorBake {
  atlas: RenderTargetTexture
  /** half the size of the square the tree was photographed inside, in the mesh's own units */
  radius: number
  /** how far up the mesh its middle is, in the same units */
  centreY: number
  cells: number
}

/**
 * A direction on the upper hemisphere, from a point on the unit square.
 *
 * The centre of the square looks straight down on the tree; the four corners are the horizon. This is the
 * inverse of `encode` in the shader below, and the two have to agree exactly or the impostor shows the wrong
 * face of the tree.
 */
function hemiOctDecode(u: number, v: number): Vector3 {
  const px = u * 2 - 1
  const py = v * 2 - 1
  const x = (px - py) * 0.5
  const z = (px + py) * 0.5
  const y = 1 - Math.abs(x) - Math.abs(z)
  return new Vector3(x, y, z).normalize()
}

/**
 * Photograph `sources` from a grid of directions into one atlas.
 *
 * The meshes handed in are the real ones, which carry thin instances of every tree in the world — so they are
 * cloned to be photographed, once, alone, at the origin. Their materials come with them, which is the point:
 * the impostor is lit by the same sun, through the same air, as the tree it stands in for.
 */
export function prepareImpostor(scene: Scene, sources: Mesh[], cells = 8, tile = 192): ImpostorBake {
  let min = new Vector3(Infinity, Infinity, Infinity)
  let max = new Vector3(-Infinity, -Infinity, -Infinity)
  for (const src of sources) {
    src.refreshBoundingInfo()
    const b = src.getBoundingInfo().boundingBox
    min = Vector3.Minimize(min, b.minimum)
    max = Vector3.Maximize(max, b.maximum)
  }
  const centre = max.add(min).scale(0.5)
  // the square has to hold the tree from every angle, so it is sized by the longest half-extent
  const radius = Math.max(max.x - centre.x, max.y - centre.y, max.z - centre.z) * 1.08

  const size = cells * tile
  const atlas = new RenderTargetTexture(`${sources[0].name}_impostor`, { width: size, height: size }, scene, {
    /**
     * No mipmaps. They were tried, to cure what looked like aliasing in distant crowns, and they were not the
     * cure (that turned out to be the width of the dissolve band) — and they cost a tree: a target rendered once
     * by hand is not guaranteed its lower mip levels, and an impostor far enough away to sample them came out
     * solid black against the sky.
     */
    generateMipMaps: false,
    samplingMode: RenderTargetTexture.BILINEAR_SAMPLINGMODE,
    type: Constants.TEXTURETYPE_UNSIGNED_BYTE,
    format: Constants.TEXTUREFORMAT_RGBA,
  })
  // transparent, so everything the tree does not cover is a hole rather than a square of background
  atlas.clearColor = new Color4(0, 0, 0, 0)
  atlas.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE
  return { atlas, radius, centreY: centre.y, cells }
}

/**
 * Take the photographs.
 *
 * Kept separate from `prepareImpostor` because it cannot run when the trees are first built: their leaf
 * pages arrive from the network a moment later, and a tree photographed before its textures have loaded is
 * photographed bald. The caller waits until the materials report themselves ready and then calls this once.
 *
 * The meshes handed in carry thin instances of every tree in the world, so a plain copy of each is made to be
 * photographed alone at the origin. It has to be a fresh mesh built from their vertex data rather than a
 * clone: a clone of a thin-instance mesh is still a thin-instance mesh, and turning its instance count down
 * to one tree turns it down to none.
 */
export function renderImpostor(scene: Scene, bake: ImpostorBake, sources: Mesh[]): boolean {
  const { atlas, radius, centreY, cells } = bake
  const centre = new Vector3(0, centreY, 0)
  const copies: Mesh[] = []
  for (const src of sources) {
    const data = VertexData.ExtractFromMesh(src)
    const copy = new Mesh(`${src.name}_bake`, scene)
    data.applyToMesh(copy, false)
    copy.material = src.material
    copy.alwaysSelectAsActiveMesh = true
    copy.isPickable = false
    copies.push(copy)
  }
  /**
   * **The copies' shaders have to be compiled before the photograph is taken, and nobody was checking.**
   *
   * A material is compiled per mesh, because the defines depend on what the mesh carries — and the real trees
   * carry thin instances while these copies do not, so a copy needs an effect that has never been compiled.
   * Babylon does not draw a mesh whose effect is not ready; it skips it silently and carries on. The leaf
   * material is the bigger shader of the two (transmission, card edges, wind, air) and therefore the one that
   * is still compiling when the bake runs, so what got photographed was the bark and nothing else.
   *
   * What that looks like from the road is a middle distance full of pale bare trunks standing among the leafy
   * near trees — reported as "further trunks drawing over closer ones", because a bald tree among leafy ones
   * reads as something drawn in the wrong order. Asking `isReady` both starts the compilation and reports
   * when it has finished, so the bake simply defers to a later frame and the caller tries again.
   */
  const ready = copies.every((c) => !c.material || c.material.isReady(c))
  if (!ready) {
    for (const c of copies) c.dispose()
    return false
  }

  atlas.renderList = copies

  const cam = new TargetCamera(`${sources[0].name}_bakeCam`, Vector3.Zero(), scene)
  cam.mode = TargetCamera.ORTHOGRAPHIC_CAMERA
  cam.orthoLeft = -radius
  cam.orthoRight = radius
  cam.orthoTop = radius
  cam.orthoBottom = -radius
  cam.minZ = 0.01
  cam.maxZ = radius * 8
  atlas.activeCamera = cam

  // The atlas is filled a cell at a time into the same render target, so it must be cleared exactly once,
  // before the first cell. An observer on `onClearObservable` takes the clearing over from Babylon entirely.
  let first = true
  const clear = atlas.onClearObservable.add((engine) => {
    if (first) engine.clear(atlas.clearColor, true, true, true)
    first = false
  })

  const engine = scene.getEngine()
  const wasCamera = scene.activeCamera

  /**
   * A throwaway pass first, whose only job is to make the engine compile what the real pass needs.
   *
   * `isReady` on the copies is necessary and not sufficient: a render target draws through its own code path,
   * and the first time a material is used there it can still have work to do — and a mesh whose effect is not
   * ready is SKIPPED, silently, with the rest of the frame drawn around it. What that leaves in the atlas is
   * the bark and no leaves, and what that looks like from the road is a middle distance full of bare pale
   * trunks among the leafy near trees. The second pass overwrites the first completely, so the only cost is
   * one more render of a small target, once per species, at load.
   */
  cam.viewport = new Viewport(0, 0, 1 / cells, 1 / cells)
  cam.position.copyFrom(centre).addInPlace(new Vector3(0, 0, radius * 4))
  cam.setTarget(centre)
  cam.getViewMatrix(true)
  atlas.render(false, false)
  first = true

  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const dir = hemiOctDecode((i + 0.5) / cells, (j + 0.5) / cells)
      cam.position.copyFrom(centre).addInPlace(dir.scale(radius * 4))
      // looking straight down, the usual up vector is the direction itself and the frame collapses; the
      // shader that reads this atlas makes the same substitution, or the picture would come out turned
      cam.upVector = Math.abs(dir.y) > 0.995 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0)
      cam.setTarget(centre)
      cam.viewport = new Viewport(i / cells, j / cells, 1 / cells, 1 / cells)
      cam.getViewMatrix(true)
      atlas.render(false, false)
    }
  }
  scene.activeCamera = wasCamera
  engine.setViewport(wasCamera ? wasCamera.viewport : new Viewport(0, 0, 1, 1))

  atlas.onClearObservable.remove(clear)
  for (const c of copies) c.dispose()
  cam.dispose()
  atlas.renderList = []
  return true
}

/** The square an impostor is drawn on: one quad, rebuilt to face the camera in the vertex shader. */
export function buildImpostorQuad(scene: Scene, name: string): Mesh {
  const mesh = new Mesh(name, scene)
  const data = new VertexData()
  data.positions = [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]
  data.normals = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]
  data.uvs = [0, 0, 1, 0, 1, 1, 0, 1]
  data.indices = [0, 1, 2, 0, 2, 3]
  data.applyToMesh(mesh, false)
  return mesh
}

export class ImpostorPlugin extends MaterialPluginBase {
  private readonly bake: ImpostorBake

  constructor(material: Material, bake: ImpostorBake) {
    super(material, 'Impostor', 170, { IMPOSTOR: true })
    this.bake = bake
    this._enable(true)
  }

  override getClassName(): string { return 'ImpostorPlugin' }
  override isCompatible(): boolean { return true }
  override prepareDefines(defines: MaterialDefines): void { defines.IMPOSTOR = true }
  override getSamplers(samplers: string[]): void { samplers.push('impAtlas') }

  override getUniforms(shaderLanguage?: ShaderLanguage): {
    ubo: Array<{ name: string; size: number; type: string }>
    vertex?: string
    fragment?: string
  } {
    const ubo = [
      { name: 'impRadius', size: 1, type: 'float' },
      { name: 'impCentreY', size: 1, type: 'float' },
      { name: 'impCells', size: 1, type: 'float' },
      // the standard material only publishes the eye position to the FRAGMENT shader, and a billboard has to
      // be turned to face the camera in the vertex shader, so it is passed again here
      { name: 'impEye', size: 3, type: 'vec3' },
    ]
    if (shaderLanguage === ShaderLanguage.WGSL) return { ubo }
    const decl = `#ifdef IMPOSTOR
uniform float impRadius;
uniform float impCentreY;
uniform float impCells;
uniform vec3 impEye;
#endif`
    return { ubo, vertex: decl, fragment: decl }
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): void {
    uniformBuffer.updateFloat('impRadius', this.bake.radius)
    uniformBuffer.updateFloat('impCentreY', this.bake.centreY)
    uniformBuffer.updateFloat('impCells', this.bake.cells)
    uniformBuffer.setTexture('impAtlas', this.bake.atlas)
    const eye = _scene.activeCamera?.globalPosition
    if (eye) uniformBuffer.updateVector3('impEye', eye)
  }

  override getCustomCode(shaderType: string, shaderLanguage?: ShaderLanguage): { [point: string]: string } | null {
    const wgsl = shaderLanguage === ShaderLanguage.WGSL
    const u = (n: string): string => (wgsl ? `uniforms.${n}` : n)
    if (shaderType === 'vertex') {
      const uv = wgsl ? 'vertexInputs.uv' : 'uv'
      const outUV = wgsl ? 'vertexOutputs.vImpUV' : 'vImpUV'
      const f3 = wgsl ? 'vec3f' : 'vec3'
      const f2 = wgsl ? 'vec2f' : 'vec2'
      const f4 = wgsl ? 'vec4f' : 'vec4'
      const eye = u('impEye')
      const body = `
  {
    /**
     * The instance's scale, taken axis by axis rather than once.
     *
     * A tree is scaled evenly, so one number did for the whole square. A rock is not: it is squashed flat and
     * spread sideways per instance (see render/scatter.ts), and reading the X scale for the height as well drew
     * its picture twice as tall as the rock it stood in for — a field of flat boulders with standing stones
     * behind it. The quad is square in the atlas, so the width takes the horizontal scale and the height takes
     * the vertical one, and a flattened rock's picture is flattened with it.
     */
    ${wgsl ? 'let' : 'float'} impSx = length(finalWorld[0].xyz);
    ${wgsl ? 'let' : 'float'} impSy = length(finalWorld[1].xyz);
    ${wgsl ? 'let' : 'float'} impSz = length(finalWorld[2].xyz);
    ${wgsl ? 'let' : 'float'} impS = max(impSx, impSz);
    ${wgsl ? 'let' : 'vec3'} impC = finalWorld[3].xyz + ${f3}(0.0, ${u('impCentreY')} * impSy, 0.0);
    ${wgsl ? 'let' : 'vec3'} impV = normalize(${eye} - impC);
    ${wgsl ? 'let' : 'vec3'} impUp0 = ${wgsl
        ? `select(vec3f(0.0, 1.0, 0.0), vec3f(0.0, 0.0, 1.0), abs(impV.y) > 0.995)`
        : `(abs(impV.y) > 0.995 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0))`};
    ${wgsl ? 'let' : 'vec3'} impR = normalize(cross(impUp0, impV));
    ${wgsl ? 'let' : 'vec3'} impU = cross(impV, impR);
    // how much of the square's height is vertical, so a flattened instance keeps its proportions when the
    // camera is looking level at it and loses them gracefully when it is looking down from above
    ${wgsl ? 'let' : 'float'} impLevel = abs(impU.y);
    ${wgsl ? 'let' : 'float'} impUpScale = mix(impS, impSy, impLevel);
    ${wgsl ? 'let' : 'float'} impRad = ${u('impRadius')} * impS;
    ${wgsl ? 'let' : 'float'} impRadUp = ${u('impRadius')} * impUpScale;
    worldPos = ${f4}(impC + impR * (${uv}.x - 0.5) * 2.0 * impRad + impU * (${uv}.y - 0.5) * 2.0 * impRadUp, 1.0);

    // the way we are looking at the tree, in the tree's own frame: the instances are turned about the
    // vertical, and the picture has to turn with them
    ${wgsl ? 'var' : 'mat3'} impRot = ${wgsl ? 'mat3x3f' : 'mat3'}(finalWorld[0].xyz / impSx, finalWorld[1].xyz / impSy, finalWorld[2].xyz / impSz);
    ${wgsl ? 'let' : 'vec3'} impL = normalize(${wgsl ? 'impV * impRot' : 'impV * impRot'});
    ${wgsl ? 'let' : 'vec3'} impA = impL / (abs(impL.x) + abs(impL.y) + abs(impL.z));
    ${wgsl ? 'let' : 'vec2'} impO = clamp(${f2}(impA.x + impA.z, impA.z - impA.x) * 0.5 + 0.5, ${f2}(0.0), ${f2}(1.0));
    ${wgsl ? 'let' : 'vec2'} impCell = min(floor(impO * ${u('impCells')}), ${f2}(${u('impCells')} - 1.0));
    // kept well inside the cell, or the filter — which now has a mip chain to walk — drags in the tree next
    // door. Five per cent of a cell is several pixels at every level anybody sees.
    ${wgsl ? 'let' : 'vec2'} impIn = clamp(${uv}, ${f2}(0.05), ${f2}(0.95));
    ${outUV} = (impCell + impIn) / ${u('impCells')};
  }
`
      return {
        CUSTOM_VERTEX_DEFINITIONS: wgsl ? 'varying vImpUV: vec2f;' : 'varying vec2 vImpUV;',
        CUSTOM_VERTEX_UPDATE_WORLDPOS: `#ifdef IMPOSTOR\n${body}\n#endif\n`,
      }
    }
    if (shaderType !== 'fragment') return null
    const sample = wgsl
      ? 'textureSample(impAtlas, impAtlasSampler, fragmentInputs.vImpUV)'
      : 'texture2D(impAtlas, vImpUV)'
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: wgsl
        ? 'varying vImpUV: vec2f;\nvar impAtlasSampler: sampler;\nvar impAtlas: texture_2d<f32>;\nvar<private> impLit: vec3f = vec3f(0.0);'
        : 'varying vec2 vImpUV;\nuniform sampler2D impAtlas;\nvec3 impLit = vec3(0.0);',
      CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `#ifdef IMPOSTOR
  {
    ${wgsl ? 'let' : 'vec4'} impPix = ${sample};
    // and a low threshold, because a filtered cut-out's alpha is an average and averages are timid
    if (impPix.a < 0.22) { discard; }
    /**
     * Back to linear, because there IS an encode on the way out to undo — and this is what was making every
     * distant tree a white ghost.
     *
     * The atlas holds what the standard material wrote to the SCREEN, which is gamma-encoded: Babylon's image
     * processing ends with toGammaSpace whether or not the tone curve is on, and this material's own neutral
     * configuration (tone curve off, exposure one) still ends the same way. So a pixel of bark at 0.35 came out
     * of the atlas already encoded at 0.61 and was encoded again to 0.80 on its way to the screen. Every
     * impostor was drawn far too bright and far too flat — a pale cut-out of a tree against a hillside that was
     * correctly lit — and it looked for all the world like the haze had been applied to it twice.
     *
     * (An earlier attempt at this is commented in the history as having turned every impostor black. It was
     * made when this material still had the scene's own exposure and ACES curve on it, where linearising the
     * atlas and then applying the whole curve to it a second time is a squaring, not a correction.)
     */
    impLit = pow(impPix.rgb, ${wgsl ? 'vec3f' : 'vec3'}(2.2));
  }
#endif
`,
      // The picture was taken under this same sun and carries its own light and shade already. Shading it a
      // second time would darken every impostor by whatever the lighting happened to give a flat square
      // facing the camera, which is why naive impostors read as dark cardboard cut-outs among real trees.
      // It is written straight over the shaded result — but before the air is applied, so a distant tree
      // still hazes with everything else around it.
      CUSTOM_FRAGMENT_BEFORE_FOG: `#ifdef IMPOSTOR
  color = ${wgsl ? 'vec4f' : 'vec4'}(impLit, color.a);
#endif
`,
    }
  }
}
