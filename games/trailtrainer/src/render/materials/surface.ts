/**
 * What the trail is made of, and what riding on it has done to it.
 *
 * The ribbon already knows more about itself than a texture could: eight columns across, carrying the worn
 * shoulder, the surface, and the painted line where OpenStreetMap says there is asphalt to paint it on. All
 * of that is in the vertex colour and none of it should be thrown away. So the photograph is used the way the
 * ground's is — for grain, and for the light and dark of a real surface — while the colour of the road stays
 * the ribbon's own.
 *
 * Which surface is a per-vertex answer, not a per-material one: the Katy Trail crosses four short paved
 * stretches in three hundred kilometres, and the join between limestone and tarmac happens in the middle of a
 * drawn ribbon. The ribbon writes the surface into its vertex alpha and the three are blended here.
 *
 * Coordinates come from the mesh rather than from world position, and that is the point of them. `u` is
 * metres across the road and `v` is metres along the route from its start, so the surface is pinned to the
 * road: it does not crawl when the ribbon is rebuilt behind the rider, it does not slide when the floating
 * origin moves, and the wear can be written in terms of where a wheel actually goes.
 *
 * The wear is the part that makes it read as ridden on. A rail trail has two pale lines where tyres have
 * pressed the limestone flat and a looser, darker middle; a mountain road is worn smooth and pale where the
 * cars run and dirtier at its edges, and it is crowned, so the middle catches the light.
 */
import {
  type AbstractEngine,
  type Material,
  MaterialDefines,
  MaterialPluginBase,
  type Scene,
  ShaderLanguage,
  type StandardMaterial,
  type SubMesh,
  type Texture,
  type UniformBuffer,
} from '@babylonjs/core'
import { Config } from '../../config.ts'

export interface SurfaceTextures {
  pavedDiff: Texture
  pavedNorm: Texture
  gravelDiff: Texture
  gravelNorm: Texture
  dirtDiff: Texture
  dirtNorm: Texture
}

const NAMES = ['pavedDiff', 'pavedNorm', 'gravelDiff', 'gravelNorm', 'dirtDiff', 'dirtNorm'] as const

export class SurfacePlugin extends MaterialPluginBase {
  private readonly textures: SurfaceTextures

  constructor(material: Material, textures: SurfaceTextures) {
    super(material, 'Surface', 190, { SURFACEMAP: true })
    this.textures = textures
    // The standard material only carries texture coordinates through to the fragment shader if something is
    // using them, and everything this plugin draws is its own. Giving the material a diffuse texture is what
    // turns `vMainUV1` on; the sample Babylon takes from it is overwritten below and costs one read.
    ;(material as StandardMaterial).diffuseTexture = textures.pavedDiff
    this._enable(true)
  }

  override getClassName(): string { return 'SurfacePlugin' }
  override isCompatible(): boolean { return true }
  override prepareDefines(defines: MaterialDefines): void { defines.SURFACEMAP = true }
  override getSamplers(samplers: string[]): void { for (const n of NAMES) samplers.push(n) }

  override getUniforms(shaderLanguage?: ShaderLanguage): {
    ubo: Array<{ name: string; size: number; type: string }>
    fragment?: string
  } {
    const ubo = [
      { name: 'surfTile', size: 1, type: 'float' },
      { name: 'surfHalfWidth', size: 1, type: 'float' },
      { name: 'surfWear', size: 1, type: 'float' },
      { name: 'surfNormalStrength', size: 1, type: 'float' },
    ]
    if (shaderLanguage === ShaderLanguage.WGSL) return { ubo }
    return {
      ubo,
      fragment: `#ifdef SURFACEMAP
uniform float surfTile;
uniform float surfHalfWidth;
uniform float surfWear;
uniform float surfNormalStrength;
#endif`,
    }
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): void {
    uniformBuffer.updateFloat('surfTile', Config.surfaceTile)
    uniformBuffer.updateFloat('surfHalfWidth', Config.trailWidth / 2)
    uniformBuffer.updateFloat('surfWear', Config.surfaceWear)
    uniformBuffer.updateFloat('surfNormalStrength', Config.surfaceNormalStrength)
    for (const n of NAMES) uniformBuffer.setTexture(n, this.textures[n])
  }

  override getCustomCode(shaderType: string, shaderLanguage?: ShaderLanguage): { [point: string]: string } | null {
    if (shaderType !== 'fragment') return null
    const wgsl = shaderLanguage === ShaderLanguage.WGSL
    const T = {
      uv: wgsl ? 'fragmentInputs.vMainUV1' : 'vMainUV1',
      col: wgsl ? 'fragmentInputs.vColor' : 'vColor',
      u: (n: string) => (wgsl ? `uniforms.${n}` : n),
      f2: wgsl ? 'vec2f' : 'vec2',
      f3: wgsl ? 'vec3f' : 'vec3',
      let_: wgsl ? 'let' : 'float',
      tex: (n: string, uv: string) => (wgsl ? `textureSample(${n}, ${n}Sampler, ${uv})` : `texture2D(${n}, ${uv})`),
    }
    const code = `
  ${T.let_} sfAcross = ${T.uv}.x;
  ${T.let_} sfAlong = ${T.uv}.y;
  ${T.let_} sfCode = clamp(${T.col}.a, 0.0, 1.0);
  ${T.let_} sfUV = ${T.f2}(sfAcross, sfAlong) / ${T.u('surfTile')};

  // which surface: 0 asphalt, a half limestone, 1 bare earth
  ${T.let_} sfGravel = 1.0 - min(1.0, abs(sfCode - 0.5) * 4.0);
  ${T.let_} sfDirt = smoothstep(0.5, 1.0, sfCode);
  ${T.let_} sfPaved = max(0.0, 1.0 - sfGravel - sfDirt);

  SFV3 sfAlbedo = ${T.tex('pavedDiff', 'sfUV')}.rgb * sfPaved
    + ${T.tex('gravelDiff', 'sfUV')}.rgb * sfGravel
    + ${T.tex('dirtDiff', 'sfUV')}.rgb * sfDirt;
  SFV3 sfNorm = (${T.tex('pavedNorm', 'sfUV')}.xyz * 2.0 - 1.0) * sfPaved
    + (${T.tex('gravelNorm', 'sfUV')}.xyz * 2.0 - 1.0) * sfGravel
    + (${T.tex('dirtNorm', 'sfUV')}.xyz * 2.0 - 1.0) * sfDirt;

  // Where the wheels go. A tyre track sits about halfway out from the centre line on each side; on anything
  // loose it is pressed pale and flat, and the strip between the tracks is looser and darker. Tarmac is worn
  // the other way round — polished where the cars run, dirty at the edges — and crowned, so the middle of it
  // catches the light while the gutters do not.
  ${T.let_} sfOut = clamp(abs(sfAcross) / max(0.5, ${T.u('surfHalfWidth')}), 0.0, 1.0);
  ${T.let_} sfTrack = exp(-((sfOut - 0.5) * (sfOut - 0.5)) / 0.02);
  ${T.let_} sfLoose = 1.0 - sfTrack;
  ${T.let_} sfUnpaved = sfGravel + sfDirt;
  ${T.let_} sfCrown = 1.0 - sfOut * sfOut;
  ${T.let_} sfWorn = 1.0
    + ${T.u('surfWear')} * sfUnpaved * (sfTrack * 0.20 - sfLoose * 0.12)
    + ${T.u('surfWear')} * sfPaved * (sfCrown * 0.10 - sfOut * sfOut * 0.16);

  // the ribbon's own colour is the road's colour, including the painted line; the photograph is its grain
  ${T.let_} sfLum = dot(sfAlbedo, ${T.f3}(0.2126, 0.7152, 0.0722));
  // Normalised against roughly what these photographs actually average, so the ribbon's own grey survives.
  // Divide by much less and tarmac comes out the colour of new concrete, which is what the first attempt did.
  ${T.let_} sfShade = clamp(sfLum / 0.46, 0.62, 1.32) * sfWorn;
  baseColor = ${wgsl ? 'vec4f' : 'vec4'}(${T.col}.rgb * sfShade, baseColor.a);
  normalW = normalize(${T.f3}(
    normalW.x + sfNorm.x * ${T.u('surfNormalStrength')},
    normalW.y,
    normalW.z + sfNorm.y * ${T.u('surfNormalStrength')}));
`
    // GLSL has no `let`: each of these is written with its own type
    const typed = wgsl
      ? code.replace(/SFV3/g, 'var')
      : code.replace(/SFV3/g, 'vec3').replace(/float sfUV /, 'vec2 sfUV ')
    if (wgsl) {
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: `
${NAMES.map((n) => `var ${n}Sampler: sampler;\nvar ${n}: texture_2d<f32>;`).join('\n')}
`,
        CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `#ifdef SURFACEMAP\n${typed}\n#endif\n`,
      }
    }
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `
${NAMES.map((n) => `uniform sampler2D ${n};`).join('\n')}
`,
      CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `#ifdef SURFACEMAP\n${typed}\n#endif\n`,
    }
  }
}
