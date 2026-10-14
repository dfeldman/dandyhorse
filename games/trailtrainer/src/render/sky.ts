/**
 * Light and air. One sun, one bounce off the ground, and fog tuned to the biome so the far hills sit back
 * where they belong instead of standing out like cardboard.
 *
 * The sun is fixed rather than cycling. A route is ridden in pieces across days and the light being the same
 * every time is what makes two sessions comparable — the point of this game is the road, not the hour.
 */
import {
  type AbstractMesh,
  Color3,
  Color4,
  DirectionalLight,
  HemisphericLight,
  ImageProcessingConfiguration,
  Mesh,
  MeshBuilder,
  type Scene,
  ShadowGenerator,
  StandardMaterial,
  Vector3,
  VertexBuffer,
} from '@babylonjs/core'
import { Config } from '../config.ts'
import type { BiomeName } from '../route/package.ts'
import { Layer } from './layers.ts'
import { Atmosphere } from './materials/aerial.ts'
import { SkyPlugin } from './materials/sky.ts'
import { BIOMES } from './palette.ts'

/** how far back along its own ray the sun sits; well inside the shadow frustum's far plane */
const SUN_DISTANCE = 70
/**
 * Half-width of the shadow box, in metres, around the rider.
 *
 * Sixteen was right when the only casters were bodies on a road. A tree is fifteen metres tall and the sun is
 * forty degrees up, so its shadow is as long again as it is high — a box that holds the tree but not its
 * shadow cuts the shadow off in a straight line across the verge, which is worse than no shadow. Thirty still
 * leaves four centimetres a texel on a 1536 map, which is finer than the shadow of a leaf.
 */
const SHADOW_EXTENT = 45
const SHADOW_MAP = 1536

export class Sky {
  readonly sun: DirectionalLight
  /**
   * The air everything in the world is seen through. It lives here because the two things it depends on —
   * which biome the rider is in and where the sun is — are the two things this class already owns.
   */
  readonly atmosphere = new Atmosphere()
  private readonly ambient: HemisphericLight
  private readonly shadows: ShadowGenerator | null
  private biome: BiomeName | null = null
  private readonly dome: Mesh
  private readonly domeMaterial: StandardMaterial
  private readonly shade: SkyPlugin
  private readonly domeColours: Float32Array
  private readonly domeHeights: Float32Array

  private readonly scene: Scene

  constructor(scene: Scene) {
    this.scene = scene
    // mid-morning, from behind and to the left, so climbing into it lights the rider's face
    this.sun = new DirectionalLight('sun', new Vector3(-0.45, -0.72, 0.53), scene)
    /**
     * The sun does the modelling; the ambient only fills the shadows.
     *
     * This was 1.25 against an ambient of 0.95 — forty-odd per cent of the light arriving from everywhere at
     * once — and that ratio is why the world read as flat no matter what else was done to it. Nothing had a
     * lit side and a shaded side worth the name: a hillside turning away from the sun came out very nearly as
     * bright as one facing it, and without cast shadows that even lighting is the only form the eye gets. Real
     * daylight is nothing like it. Pushing the sun up and the fill down gives every slope, trunk and boulder a
     * direction again, and the leaf transmission term (render/materials/leaf.ts) is what makes it safe to do:
     * the canopies that used to need all that ambient to keep them out of the dark now light themselves.
     *
     * There is a limit, and it was found by going past it. At 1.55 against 0.66 the shaded side of an alpine
     * spur went to near black and every tree on it with it — which is what a photograph does and not what an
     * eye does, because there is no sky light in this scene beyond that one fill term and no bounce at all.
     * These numbers are the most contrast the lighting model will carry.
     */
    this.sun.intensity = 1.38
    this.sun.diffuse = Color3.FromHexString('#fff3dd')
    this.sun.specular = Color3.FromHexString('#fffaf0')

    this.atmosphere.setSun(this.sun.direction)

    this.ambient = new HemisphericLight('ambient', new Vector3(0, 1, 0), scene)
    // Bright, and with a ground bounce that is not nearly black. Everything in this world that reads badly
    // reads badly by being too dark: a leaf in shade, the inside of a crown, the underside of a tree. There
    // is no bounced light here beyond this one number, so it has to do the work of all of it.
    this.ambient.intensity = 0.80
    this.ambient.diffuse = Color3.FromHexString('#dcebff')
    this.ambient.groundColor = Color3.FromHexString('#93a074')

    /**
     * Exposure and tone mapping, which this scene had none of.
     *
     * Everything drawn here was coming out dark, and the reason was structural rather than a want of light:
     * with no tone mapping the shader's output is whatever the lighting arithmetic produced, clipped at one.
     * A leaf turned away from the sun gets the ambient term and nothing else, lands near the bottom of the
     * range, and stays there. The answer is not more lamps — that blows out everything already lit — it is a
     * curve that lifts the middle of the range and rolls the top off gently, which is what a camera does and
     * what every renderer does at the end of a frame.
     *
     * It is set on the scene rather than through a post-process pipeline so that it costs nothing: the
     * standard material applies it in its own fragment shader, at the end, where the colour already is.
     */
    scene.imageProcessingConfiguration.toneMappingEnabled = true
    scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES
    scene.imageProcessingConfiguration.exposure = Config.exposure
    scene.imageProcessingConfiguration.contrast = Config.contrast

    scene.fogMode = 2 // exponential
    scene.fogDensity = 0.0011

    // A dome rather than a flat clear colour. Half the impression of height on a mountain road comes from the
    // sky getting paler toward the horizon, and a single background colour throws that away. It rides with the
    // camera and is drawn before everything else, so it costs one big triangle fan and never occludes anything.
    this.dome = MeshBuilder.CreateSphere('sky', { diameter: 6000, segments: 20, sideOrientation: Mesh.BACKSIDE }, scene)
    const count = this.dome.getTotalVertices()
    const positions = this.dome.getVerticesData(VertexBuffer.PositionKind)!
    this.domeHeights = new Float32Array(count)
    for (let i = 0; i < count; i++) this.domeHeights[i] = Math.max(-0.25, Math.min(1, positions[i * 3 + 1] / 3000))
    this.domeColours = new Float32Array(count * 4)
    this.domeMaterial = new StandardMaterial('skyMat', scene)
    this.domeMaterial.disableLighting = true
    this.domeMaterial.emissiveColor = Color3.White()
    this.domeMaterial.diffuseColor = Color3.Black()
    this.domeMaterial.specularColor = Color3.Black()
    this.domeMaterial.backFaceCulling = false
    this.domeMaterial.fogEnabled = false
    // the gradient, the sun and the clouds are all worked out per pixel now; the dome is only the surface
    // they are drawn on (see render/materials/sky.ts)
    this.shade = new SkyPlugin(this.domeMaterial)
    this.shade.sun.copyFrom(this.sun.direction)
    this.dome.material = this.domeMaterial
    this.dome.infiniteDistance = true
    this.dome.isPickable = false
    this.dome.applyFog = false
    this.dome.renderingGroupId = Layer.sky

    this.shadows = Config.shadows ? new ShadowGenerator(SHADOW_MAP, this.sun) : null
    if (this.shadows) {
      // percentage-closer filtering rather than the exponential map: the only shadows here are a handful of
      // bodies on a road, and what that wants is a crisp shadow at the wheels. The exponential map washes a
      // contact shadow out to nothing over a frustum this size, which leaves the rider looking pasted on.
      this.shadows.usePercentageCloserFiltering = true
      // Low: every pixel of ground, trail and grass takes this filter now that the trees cast, which makes it
      // one of the most-run pieces of code in the frame. Dapple under a canopy does not want soft edges; it
      // wants to be there at all.
      this.shadows.filteringQuality = ShadowGenerator.QUALITY_LOW
      /**
       * A cast shadow blocks the sun outright; what fills it is the ambient term, which is what the ambient
       * term is FOR. Leaving a third of the sun in it — which is what this was set to when the only shadow in
       * the game was a rider's on tarmac — makes tree dapple so faint that it reads as a smudge on the road.
       */
      this.shadows.darkness = 0.04
      /**
       * Shadows fade out toward the edge of the box rather than stopping at it.
       *
       * The box follows the rider, so its far edge is a line that moves along the road with them, and a
       * shadow crossing it switched on or off in a single frame — a whole tree's dapple appearing on the verge
       * forty metres ahead. Fading over the outer third of the box turns that into shade that deepens as the
       * rider comes on, which is what the eye expects of anything at that distance anyway.
       */
      this.shadows.frustumEdgeFalloff = 0.35
      this.shadows.bias = 0.002
      this.shadows.normalBias = 0.02
      this.sun.shadowMinZ = 1
      this.sun.shadowMaxZ = 190
      // A fixed box, not auto-fitted. autoUpdateExtends resizes the frustum every frame to whatever is
      // casting, so a companion riding into range changes the shadow map's scale and the rider's own shadow
      // crawls and flickers under it. A constant box means a constant texel size, and `follow` then snaps the
      // box to that texel grid so the shadow stops shimmering as the rider moves.
      this.sun.autoUpdateExtends = false
      this.sun.orthoLeft = -SHADOW_EXTENT
      this.sun.orthoRight = SHADOW_EXTENT
      this.sun.orthoTop = SHADOW_EXTENT
      this.sun.orthoBottom = -SHADOW_EXTENT
    }
  }

  /**
   * The sun follows the rider so its shadow map covers where they are, not where the route started.
   *
   * It is placed back along its own direction rather than at an arbitrary offset, at a distance comfortably
   * inside `shadowMaxZ`. Get that wrong and the rider sits past the shadow frustum's far plane and casts
   * nothing at all, which is a hard thing to spot because everything else looks right.
   */
  follow(x: number, y: number, z: number): void {
    // snapped to whole shadow-map texels, so the shadow does not crawl between frames
    const texel = (2 * SHADOW_EXTENT) / SHADOW_MAP
    const sx = Math.round(x / texel) * texel
    const sz = Math.round(z / texel) * texel
    const d = this.sun.direction
    this.sun.position.set(sx - d.x * SUN_DISTANCE, y - d.y * SUN_DISTANCE, sz - d.z * SUN_DISTANCE)
  }

  /** The clouds drift; nothing else in the sky moves, because the sun in this game does not. */
  tick(dt: number): void {
    this.shade.time += dt * Config.cloudDrift
  }

  /** Compile the shadow pass's shaders for every caster now, for the same reason as Scatter.prewarm. */
  async prewarmShadows(): Promise<void> {
    if (this.shadows) await this.shadows.forceCompilationAsync().catch(() => undefined)
  }

  cast(meshes: AbstractMesh[]): void {
    if (!this.shadows) return
    for (const m of meshes) this.shadows.addShadowCaster(m, true)
  }

  /**
   * Colour the air for wherever the rider is now. Biome bands are hundreds of metres apart and the fog does the
   * blending between them, so this can change outright without anything appearing to snap.
   */
  setBiome(biome: BiomeName): void {
    if (this.biome === biome) return
    this.biome = biome
    const p = BIOMES[biome]
    // the horizon is the haze the distant ground fades into, so they meet without a seam
    const zenith = p.sky.scale(0.82)
    const horizon = Color3.Lerp(p.haze, p.sky, 0.25)
    for (let i = 0; i < this.domeHeights.length; i++) {
      // up from the horizon the sky deepens quickly and then settles
      const t = Math.max(0, this.domeHeights[i])
      const k = Math.pow(t, 0.55)
      this.domeColours[i * 4] = horizon.r + (zenith.r - horizon.r) * k
      this.domeColours[i * 4 + 1] = horizon.g + (zenith.g - horizon.g) * k
      this.domeColours[i * 4 + 2] = horizon.b + (zenith.b - horizon.b) * k
      this.domeColours[i * 4 + 3] = 1
    }
    this.dome.setVerticesData(VertexBuffer.ColorKind, this.domeColours, true)
    this.shade.horizon.copyFrom(horizon)
    this.shade.zenith.copyFrom(zenith)
    this.shade.sunColour.copyFrom(this.sun.diffuse)
    this.shade.cover = Config.cloudCover[biome] ?? 0.45
    this.scene.clearColor = Color4.FromColor3(horizon)
    // the scene's own fog is still set, for anything that has not joined the atmosphere (it turns the scene
    // fog off for the materials it is on, so the two never both apply to the same pixel)
    this.scene.fogColor = p.haze
    this.scene.fogDensity = p.fog
    this.atmosphere.setBiome(p)
  }

  dispose(): void {
    this.dome.dispose()
    this.domeMaterial.dispose()
    this.shadows?.dispose()
    this.sun.dispose()
    this.ambient.dispose()
  }
}
