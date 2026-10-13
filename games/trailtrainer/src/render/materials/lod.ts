/**
 * Handing a tree over to its impostor without anyone seeing the join.
 *
 * Two versions of the same tree exist at once — the real geometry and the flat picture of it — and each is
 * told where it is wanted. The geometry holds out to the changeover distance; the picture takes over beyond
 * it. Switching one for the other outright pops, because however good the impostor is it is not pixel-for-
 * pixel the tree.
 *
 * So they dissolve through each other: over the changeover band both are drawn, and each discards a fraction
 * of its pixels chosen by a fixed screen pattern. A tree that is 30% handed over keeps 70% of its geometry
 * pixels and 30% of its impostor pixels, in complementary sets, so the sum is always a whole tree. This is the
 * standard trick — a screen-door dissolve — and it is cheap because the pattern comes from the pixel's own
 * coordinates and costs no texture and no sorting.
 */
import {
  type AbstractEngine,
  type Material,
  MaterialDefines,
  MaterialPluginBase,
  type Scene,
  ShaderLanguage,
  type SubMesh,
  type UniformBuffer,
  Vector3,
} from '@babylonjs/core'

export class LodFadePlugin extends MaterialPluginBase {
  /** where the rider is, in scene metres */
  readonly centre = new Vector3()
  near = 90
  far = 130
  /** 0 for the geometry, which is wanted near; 1 for the impostor, which is wanted far */
  far_side = 0

  constructor(material: Material, farSide: boolean) {
    super(material, 'LodFade', 160, { LODFADE: true })
    this.far_side = farSide ? 1 : 0
    this._enable(true)
  }

  override getClassName(): string { return 'LodFadePlugin' }
  override isCompatible(): boolean { return true }
  override prepareDefines(defines: MaterialDefines): void { defines.LODFADE = true }

  override getUniforms(shaderLanguage?: ShaderLanguage): {
    ubo: Array<{ name: string; size: number; type: string }>
    fragment?: string
  } {
    const ubo = [
      { name: 'lodCentre', size: 3, type: 'vec3' },
      { name: 'lodNear', size: 1, type: 'float' },
      { name: 'lodFar', size: 1, type: 'float' },
      { name: 'lodFarSide', size: 1, type: 'float' },
    ]
    if (shaderLanguage === ShaderLanguage.WGSL) return { ubo }
    return {
      ubo,
      fragment: `#ifdef LODFADE
uniform vec3 lodCentre;
uniform float lodNear;
uniform float lodFar;
uniform float lodFarSide;
#endif`,
    }
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): void {
    uniformBuffer.updateVector3('lodCentre', this.centre)
    uniformBuffer.updateFloat('lodNear', this.near)
    uniformBuffer.updateFloat('lodFar', this.far)
    uniformBuffer.updateFloat('lodFarSide', this.far_side)
  }

  override getCustomCode(shaderType: string, shaderLanguage?: ShaderLanguage): { [point: string]: string } | null {
    if (shaderType !== 'fragment') return null
    const wgsl = shaderLanguage === ShaderLanguage.WGSL
    const u = (n: string): string => (wgsl ? `uniforms.${n}` : n)
    const posW = wgsl ? 'fragmentInputs.vPositionW' : 'vPositionW'
    const frag = wgsl ? 'fragmentInputs.position.xy' : 'gl_FragCoord.xy'
    /**
     * ONE threshold, and the two sides take opposite halves of it.
     *
     * Giving each side its own keep fraction and testing lodN > keep does not partition the pixels: the
     * geometry kept lodN <= 1 - t and the picture kept lodN <= t, which are the SAME set at t = 0.5 and
     * overlap everywhere else. Half the tree was drawn by neither side in the middle of the band, so a tree
     * crossing the changeover went half transparent and the wood behind it — and the white sky — showed
     * straight through. Testing both against 1 - t and splitting on which side we are makes the two sets
     * exact complements: every pixel is drawn by exactly one of them, at every t.
     */
    const body = `
  {
    ${wgsl ? 'let' : 'float'} lodD = length(${posW}.xz - ${u('lodCentre')}.xz);
    ${wgsl ? 'let' : 'float'} lodT = smoothstep(${u('lodNear')}, ${u('lodFar')}, lodD);
    // a fixed pattern in screen space: the same pixel always decides the same way, so the dissolve is a
    // steady stipple rather than a boil
    ${wgsl ? 'let' : 'vec2'} lodP = floor(${frag});
    ${wgsl ? 'let' : 'float'} lodN = fract(sin(dot(lodP, ${wgsl ? 'vec2f' : 'vec2'}(12.9898, 78.233))) * 43758.5453);
    ${wgsl ? 'let' : 'bool'} lodGeo = lodN < 1.0 - lodT;
    if (lodGeo == (${u('lodFarSide')} > 0.5)) { discard; }
  }
`
    return { CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `#ifdef LODFADE\n${body}\n#endif\n` }
  }
}
