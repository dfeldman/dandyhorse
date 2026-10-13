/**
 * What the ground is made of: four surfaces, chosen per pixel, projected from the world rather than from any
 * texture coordinate the mesh carries.
 *
 * The terrain has no UVs and cannot have useful ones. It is built as chunks of a grid that is rebuilt as the
 * rider moves, so any coordinate baked into it would have to be regenerated too, and it would still stretch
 * on a slope. So the textures are projected straight from world position — flat ground takes its coordinate
 * from x and z, and where the ground turns up on edge the rock takes its coordinate from the two axes it
 * still faces, which is what stops a cliff looking like smeared toffee.
 *
 * **The floating origin is the trap here.** `vPositionW` is SCENE space, which slides a kilometre sideways
 * every time the origin moves (see render/frame.ts). Texturing from it directly would shift every blade of
 * grass on the Katy Trail a kilometre at a time, about six times an hour, which reads as the whole world
 * flinching. `setOrigin` hands the shader the world offset to add back, so the projection is in true world
 * metres and stands still.
 *
 * Which of the four is showing is decided here rather than per vertex, because a five-metre mesh cannot
 * resolve where a cliff starts. Slope comes from the shaded normal, snow and bare ground from real elevation,
 * and the worn strip beside the trail is the one thing the mesh does know, handed over in the vertex colour's
 * alpha. The rest of that colour is the biome's own, applied as a tint that keeps the texture's brightness and
 * takes only its hue — so the same four photographs read as Missouri bottomland and as the Alpe's upper slopes
 * without four more downloads.
 *
 * Ten texture reads a pixel: three surfaces projected one way and rock projected two, albedo and normal each.
 * Tiling is at two scales at once, a close one and a far one multiplied over it, because a single two-metre
 * tile repeats visibly by the time the ground is a hundred metres away.
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
  Vector2,
} from '@babylonjs/core'
import { Config } from '../../config.ts'

export interface SplatTextures {
  grassDiff: Texture
  grassNorm: Texture
  dryDiff: Texture
  dryNorm: Texture
  rockDiff: Texture
  rockNorm: Texture
  snowDiff: Texture
  snowNorm: Texture
}

const NAMES = ['grassDiff', 'grassNorm', 'dryDiff', 'dryNorm', 'rockDiff', 'rockNorm', 'snowDiff', 'snowNorm'] as const

export class SplatPlugin extends MaterialPluginBase {
  private readonly textures: SplatTextures
  /** the world point the scene's zero is at, added back so the projection does not slide with the origin */
  readonly origin = new Vector2(0, 0)
  /** metres per tile, close up and at the macro scale laid over it */
  tile: number
  macroTile: number
  /** how much of the biome's colour is taken; 0 leaves the photographs as they are */
  tint = Config.splatTint
  /** metres the texture coordinates are bent by before tiling, to break up the repeat */
  warp = Config.splatWarp
  /**
   * Where snow starts and where it has covered everything, in metres. From the biome, not from here: the
   * Missouri prairie's snow line is above anything in the state, and the Alpe's is most of the way up it.
   */
  snowFrom = 9000
  snowTo = 9200

  constructor(material: Material, textures: SplatTextures, tile: number, macroTile: number) {
    super(material, 'Splat', 190, { SPLAT: true })
    this.textures = textures
    this.tile = tile
    this.macroTile = macroTile
    this._enable(true)
  }

  override getClassName(): string { return 'SplatPlugin' }
  override isCompatible(): boolean { return true }
  override prepareDefines(defines: MaterialDefines): void { defines.SPLAT = true }

  override getSamplers(samplers: string[]): void {
    for (const n of NAMES) samplers.push(n)
  }

  override getUniforms(shaderLanguage?: ShaderLanguage): {
    ubo: Array<{ name: string; size: number; type: string }>
    fragment?: string
  } {
    const ubo = [
      { name: 'splatOrigin', size: 2, type: 'vec2' },
      { name: 'splatTile', size: 1, type: 'float' },
      { name: 'splatMacro', size: 1, type: 'float' },
      { name: 'splatBands', size: 4, type: 'vec4' },
      { name: 'splatTint', size: 1, type: 'float' },
      { name: 'splatNormalStrength', size: 1, type: 'float' },
      { name: 'splatWarp', size: 1, type: 'float' },
      { name: 'splatStrata', size: 1, type: 'float' },
    ]
    if (shaderLanguage === ShaderLanguage.WGSL) return { ubo }
    return {
      ubo,
      fragment: `#ifdef SPLAT
uniform vec2 splatOrigin;
uniform float splatTile;
uniform float splatMacro;
uniform vec4 splatBands;
uniform float splatTint;
uniform float splatNormalStrength;
uniform float splatWarp;
uniform float splatStrata;
#endif`,
    }
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): void {
    uniformBuffer.updateFloat2('splatOrigin', this.origin.x, this.origin.y)
    uniformBuffer.updateFloat('splatTile', this.tile)
    uniformBuffer.updateFloat('splatMacro', this.macroTile)
    // where rock takes over from soil, and where snow lies: slope from, slope to, snow from, snow to
    uniformBuffer.updateFloat4('splatBands', Config.rockFromSlope, Config.rockToSlope, this.snowFrom, this.snowTo)
    uniformBuffer.updateFloat('splatTint', this.tint)
    uniformBuffer.updateFloat('splatNormalStrength', Config.splatNormalStrength)
    uniformBuffer.updateFloat('splatWarp', this.warp)
    uniformBuffer.updateFloat('splatStrata', Config.splatStrata)
    for (const n of NAMES) uniformBuffer.setTexture(n, this.textures[n])
  }

  override getCustomCode(shaderType: string, shaderLanguage?: ShaderLanguage): { [point: string]: string } | null {
    if (shaderType !== 'fragment') return null
    const wgsl = shaderLanguage === ShaderLanguage.WGSL
    // One hook does all of it. `CUSTOM_FRAGMENT_UPDATE_DIFFUSE` sits after the standard material has built
    // `baseColor` and `normalW` and before anything has read them, so the ground's colour and the direction
    // it faces can both be replaced in one place. Note that Babylon has already multiplied `baseColor` by the
    // vertex colour by this point; overwriting it outright is deliberate, because the tint below is the same
    // colour applied in a way that does not also darken the photograph.
    const body = (t: {
      world: string; posY: string; normal: string; colour: string; toEye: string
      tex: (name: string, uv: string) => string
      u: (name: string) => string
      v3: (x: string) => string
      let_: string
    }): string => `
  ${t.let_} spWorld = ${t.world};
  ${t.let_} spY = ${t.posY};
  // how far this pixel is from the eye, for the detail that is only worth drawing close up
  ${t.let_} spEye = length(${t.toEye});
  ${t.let_} spN = normalize(${t.normal});
  ${t.let_} spSlope = 1.0 - clamp(spN.y, 0.0, 1.0);
  // A tile repeats, and the eye finds the repeat as straight lines running along the texture's own axes —
  // more obvious on flat open ground than anywhere else, because there is nothing else to look at. Two things
  // break it, neither of them another texture read. The coordinates are bent by a long, slow wave before they
  // are tiled, so the grid the repeat sits on is no longer straight; and the macro tile laid over it is
  // turned forty degrees, so its structure never lines up with the close one to reinforce it.
  ${t.let_} spWarp = ${wgsl ? 'vec2f' : 'vec2'}(
      sin(spWorld.y * 0.0131) + sin(spWorld.x * 0.0068) * 0.7,
      cos(spWorld.x * 0.0117) + sin(spWorld.y * 0.0052) * 0.7) * ${t.u('splatWarp')};
  ${t.let_} spUV = (spWorld + spWarp) / ${t.u('splatTile')};
  ${t.let_} spUVm = ${wgsl ? 'vec2f' : 'vec2'}(
      spWorld.x * 0.766 - spWorld.y * 0.643,
      spWorld.x * 0.643 + spWorld.y * 0.766) / ${t.u('splatMacro')};
  ${t.let_} spSide = ${wgsl
      ? `select(vec2f(spWorld.y, spY), vec2f(spWorld.x, spY), abs(spN.x) > abs(spN.z)) / ${t.u('splatTile')}`
      : `(abs(spN.x) > abs(spN.z) ? vec2(spWorld.y, spY) : vec2(spWorld.x, spY)) / ${t.u('splatTile')}`};
  // How far the ground has to tip before it is projected from the side rather than from above.
  //
  // Worth knowing why this is a compromise rather than a setting. Beside a mountain road the corridor carve
  // drops fifteen metres over the fifty it is released across, on a mesh with a vertex every five: that is a
  // staircase, not a slope. Seen nearly edge-on, a staircase smears whichever way it is projected — from
  // above the risers streak vertically, from the side the treads streak horizontally — and no value here
  // fixes both, because the geometry, not the projection, is what is wrong. Texturing the ground is what made
  // it visible; in flat green it read as a slope. The fix belongs in the carve (see GRAPHICS.md).
  ${t.let_} spOnEdge = clamp(spSlope * 2.5, 0.0, 1.0);

  ${t.let_} spRock = smoothstep(${t.u('splatBands')}.x, ${t.u('splatBands')}.y, spSlope);
  ${t.let_} spSnow = smoothstep(${t.u('splatBands')}.z, ${t.u('splatBands')}.w, spY) * (1.0 - spRock * 0.65);
  ${t.let_} spDry = clamp(${t.colour}.a, 0.0, 1.0) * (1.0 - spRock) * (1.0 - spSnow);
  ${t.let_} spGrass = max(0.0, 1.0 - spRock - spSnow - spDry);

  // Every layer is projected both ways and mixed, not just the rock. Projecting only from above is free on
  // flat ground and catastrophic on a road cut: the texture is smeared down the face in vertical streaks a
  // hundred metres long, and a grassy bank is exactly where that shows, because grass has visible grain.
  var_ spAlbedo = mix(
    splatBlend4(spUV, spGrass, spDry, spSnow, spRock),
    splatBlend4(spSide, spGrass, spDry, spSnow, spRock), spOnEdge);
  ${t.let_} spNorm = mix(
    splatBlendN(spUV, spGrass, spDry, spSnow, spRock),
    splatBlendN(spSide, spGrass, spDry, spSnow, spRock), spOnEdge);

  // a much larger tile of the same page laid over the close one, so the close one stops reading as a repeat
  ${t.let_} spMacro = 0.82 + 0.36 * ${t.tex('grassDiff', 'spUVm')}.g;
  spAlbedo = spAlbedo * spMacro;
  // The photograph supplies the grain; the biome supplies the colour. Dividing out the texture's own
  // brightness first is the whole trick: multiplying a palette colour straight into a dark photograph gives
  // dark mud, and the Missouri prairie came out looking like ploughed field rather than grass. What is left
  // after the division averages one, so it carries the variation and nothing else, and the biome's colour
  // then lands at exactly the brightness the palette asked for.
  // Rock is bedded, and bedding is horizontal: thin bands of lighter and darker running level across a face,
  // which is most of what tells the eye that a cliff is stone rather than a brown slope. Two frequencies so
  // the banding does not read as corduroy, and only where there is rock to band.
  // ...and only where it can be seen for what it is. Bedding has a period of about seven metres of height, so
  // on a hillside half a kilometre off it lands a dozen pixels apart and reads as corduroy rather than stone —
  // which is exactly how a spur above Alpe d'Huez came out once the sun was strong enough to show it. It fades
  // with distance, like any other detail that is finer than the eye at that range.
  ${t.let_} spBed = ${t.u('splatStrata')} * spRock / (1.0 + spEye * 0.008);
  spAlbedo = spAlbedo * (1.0 + spBed
    * (sin(spY * 0.85) * 0.6 + sin(spY * 0.23 + 1.7) * 0.4));
  /**
   * The photograph's own grain gives up with distance, because past a certain point it can only alias.
   *
   * The close tile is 2.6 m across. At three hundred metres that is a couple of pixels, and a couple of pixels
   * of a detailed photograph is not detail — it is a moiré, and on the open prairie it showed as fine stripes
   * fanning toward the horizon that no amount of mip-mapping or anisotropy removed, because the coordinates
   * are warped before they are sampled. Letting the albedo settle toward its own average as it goes away
   * leaves the far ground to the two things that can still be resolved out there: the biome's colour and the
   * broad patchiness in the vertex colour.
   *
   * The forty-four-metre macro tile has to go with it, which was a surprise — it is far too coarse to alias.
   * It is not aliasing; it is REPEATING, and a photograph's green channel laid down every forty-four metres
   * across a flat field is a pattern the eye picks out as banding at exactly the distance where the field
   * still fills the screen. Flat is the honest answer out there, and the vertex colour's own noise is what
   * keeps it from being featureless.
   */
  ${t.let_} spFar = clamp((spEye - 60.0) / 240.0, 0.0, 1.0);
  spAlbedo = mix(spAlbedo, ${t.v3('0.34')}, spFar * 0.95);
  ${t.let_} spLum = splatLuma(spAlbedo);
  // Light and dark is taken in full; colour is taken only a little. Dividing the colour out channel by
  // channel and putting it back whole was the first attempt and it turned the prairie into orange and
  // acid green — a photograph's darkest pixels are near black in one channel, and that ratio explodes.
  ${t.let_} spShade = clamp(spLum / 0.34, 0.45, 1.8);
  ${t.let_} spHue = mix(${t.v3('1.0')}, spAlbedo / max(0.08, spLum), 0.4);
  spAlbedo = mix(spAlbedo, ${t.colour}.rgb * spHue * spShade, ${t.u('splatTint')});

  baseColor = ${wgsl ? 'vec4f(spAlbedo, baseColor.a)' : 'vec4(spAlbedo, baseColor.a)'};
  /**
   * And the bumps fade with the grain, for the same reason and more urgently.
   *
   * A normal map aliases far worse than an albedo does, because the lighting amplifies it: a half-pixel of
   * tilt becomes a whole shade of difference, and a tiling normal map minified across a flat field is a fine
   * crosshatch that reads as woven fabric. It survived flattening the colour entirely — which is how it was
   * finally identified, by removing everything else and finding the weave still there.
   */
  ${t.let_} spBump = ${t.u('splatNormalStrength')} * (1.0 - spFar);
  normalW = normalize(${t.v3('0.0')} + ${wgsl ? 'vec3f' : 'vec3'}(
      normalW.x + spNorm.x * spBump,
      normalW.y,
      normalW.z + spNorm.y * spBump));
`
    if (wgsl) {
      const code = body({
        world: 'fragmentInputs.vPositionW.xz + uniforms.splatOrigin',
        posY: 'fragmentInputs.vPositionW.y',
        toEye: 'fragmentInputs.vPositionW - scene.vEyePosition.xyz',
        normal: 'fragmentInputs.vNormalW',
        colour: 'fragmentInputs.vColor',
        tex: (n, uv) => `textureSample(${n}, ${n}Sampler, ${uv})`,
        u: (n) => `uniforms.${n}`,
        v3: (x) => `vec3f(${x})`,
        let_: 'let',
      }).replace(/var_ /g, 'var ')
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: `
${NAMES.map((n) => `var ${n}Sampler: sampler;\nvar ${n}: texture_2d<f32>;`).join('\n')}
fn splatLuma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
fn splatBlend4(uv: vec2f, g: f32, d: f32, sn: f32, r: f32) -> vec3f {
  return textureSample(grassDiff, grassDiffSampler, uv).rgb * g
       + textureSample(dryDiff, dryDiffSampler, uv).rgb * d
       + textureSample(snowDiff, snowDiffSampler, uv).rgb * sn
       + textureSample(rockDiff, rockDiffSampler, uv).rgb * r;
}
fn splatBlendN(uv: vec2f, g: f32, d: f32, sn: f32, r: f32) -> vec3f {
  return (textureSample(grassNorm, grassNormSampler, uv).xyz * 2.0 - 1.0) * g
       + (textureSample(dryNorm, dryNormSampler, uv).xyz * 2.0 - 1.0) * d
       + (textureSample(snowNorm, snowNormSampler, uv).xyz * 2.0 - 1.0) * sn
       + (textureSample(rockNorm, rockNormSampler, uv).xyz * 2.0 - 1.0) * r;
}
`,
        CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `#ifdef SPLAT
${code}
#endif
`,
      }
    }
    const code = body({
      world: 'vPositionW.xz + splatOrigin',
      posY: 'vPositionW.y',
      toEye: 'vPositionW - vEyePosition.xyz',
      normal: 'vNormalW',
      colour: 'vColor',
      tex: (n, uv) => `texture2D(${n}, ${uv})`,
      u: (n) => n,
      v3: (x) => `vec3(${x})`,
      let_: 'float',
    })
      // GLSL has no `let`: every one of these is a different type, so they are written out
      .replace(/float spWorld/, 'vec2 spWorld')
      .replace(/float spN /, 'vec3 spN ')
      .replace(/float spUV /, 'vec2 spUV ')
      .replace(/float spUVm /, 'vec2 spUVm ')
      .replace(/float spSide /, 'vec2 spSide ')
      .replace(/float spNorm /, 'vec3 spNorm ')
      .replace(/float spWarp /, 'vec2 spWarp ')
      .replace(/float spHue /, 'vec3 spHue ')
      .replace(/var_ spAlbedo/, 'vec3 spAlbedo')
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `
${NAMES.map((n) => `uniform sampler2D ${n};`).join('\n')}
float splatLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 splatBlend4(vec2 uv, float g, float d, float s, float r) {
  return texture2D(grassDiff, uv).rgb * g + texture2D(dryDiff, uv).rgb * d
       + texture2D(snowDiff, uv).rgb * s + texture2D(rockDiff, uv).rgb * r;
}
vec3 splatBlendN(vec2 uv, float g, float d, float s, float r) {
  return (texture2D(grassNorm, uv).xyz * 2.0 - 1.0) * g + (texture2D(dryNorm, uv).xyz * 2.0 - 1.0) * d
       + (texture2D(snowNorm, uv).xyz * 2.0 - 1.0) * s + (texture2D(rockNorm, uv).xyz * 2.0 - 1.0) * r;
}
`,
      CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `#ifdef SPLAT
${code}
#endif
`,
    }
  }
}

/** Put the ground textures on a material. */
export function addSplat(material: StandardMaterial, textures: SplatTextures, tile: number, macroTile: number): SplatPlugin {
  return new SplatPlugin(material, textures, tile, macroTile)
}
