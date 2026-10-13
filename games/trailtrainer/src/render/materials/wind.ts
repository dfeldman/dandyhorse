/**
 * Wind in the leaves.
 *
 * The only thing in this world allowed to depend on the clock. Everything else — where a tree grows, how tall
 * it is, which way it leans — is a function of position, so that the same stretch of trail is the same place
 * every session. Sway is different: a wood that is perfectly still reads as a photograph of a wood, and the
 * movement carries no information a rider could come to rely on.
 *
 * It is done on world position rather than per instance, so neighbouring trees lean together in gusts that
 * cross the hillside, and scaled by height up the tree, so a trunk's foot stays put while its crown moves.
 * Applied to the world position after the instance's own matrix, which is the only place a thin instance's
 * vertex can be moved without touching the matrices themselves.
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
} from '@babylonjs/core'

export class WindPlugin extends MaterialPluginBase {
  /** seconds, ever increasing */
  time = 0
  /** metres of sway at the top of a one-metre tree — small; leaves move, trees do not walk */
  strength = 0.035
  /**
   * How much neighbouring vertices break step with each other. A tree sways as a tree, so it is zero there;
   * blades of grass in one clump must not, or the clump ripples as a single solid object.
   */
  jitter = 0

  constructor(material: Material) {
    super(material, 'Wind', 180, { WIND: true })
    this._enable(true)
  }

  override getClassName(): string { return 'WindPlugin' }
  override isCompatible(): boolean { return true }
  override prepareDefines(defines: MaterialDefines): void { defines.WIND = true }

  override getUniforms(shaderLanguage?: ShaderLanguage): {
    ubo: Array<{ name: string; size: number; type: string }>
    vertex?: string
  } {
    const ubo = [
      { name: 'windTime', size: 1, type: 'float' },
      { name: 'windStrength', size: 1, type: 'float' },
      { name: 'windJitter', size: 1, type: 'float' },
    ]
    if (shaderLanguage === ShaderLanguage.WGSL) return { ubo }
    return { ubo, vertex: `#ifdef WIND\nuniform float windTime;\nuniform float windStrength;\nuniform float windJitter;\n#endif` }
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): void {
    uniformBuffer.updateFloat('windTime', this.time)
    uniformBuffer.updateFloat('windStrength', this.strength)
    uniformBuffer.updateFloat('windJitter', this.jitter)
  }

  override getCustomCode(shaderType: string, shaderLanguage?: ShaderLanguage): { [point: string]: string } | null {
    if (shaderType !== 'vertex') return null
    const wgsl = shaderLanguage === ShaderLanguage.WGSL
    const u = (n: string): string => (wgsl ? `uniforms.${n}` : n)
    const pos = wgsl ? 'positionUpdated' : 'positionUpdated'
    // `worldPos` is the vertex after its instance matrix and before the view — the one place a thin
    // instance can be nudged without rewriting every matrix on the CPU.
    const body = `
  {
    ${wgsl ? 'let' : 'float'} wHeight = max(0.0, ${pos}.y);
    ${wgsl ? 'let' : 'float'} wPhase = worldPos.x * 0.13 + worldPos.z * 0.11 + ${u('windTime')}
      + sin(worldPos.x * 6.3 + worldPos.z * 4.7) * ${u('windJitter')};
    ${wgsl ? 'let' : 'float'} wGust = 0.65 + 0.35 * sin(worldPos.x * 0.012 + worldPos.z * 0.009 + ${u('windTime')} * 0.21);
    worldPos = ${wgsl ? 'vec4f' : 'vec4'}(
      worldPos.x + sin(wPhase) * ${u('windStrength')} * wHeight * wGust,
      worldPos.y,
      worldPos.z + cos(wPhase * 0.83) * ${u('windStrength')} * wHeight * wGust * 0.7,
      worldPos.w);
  }
`
    return { CUSTOM_VERTEX_UPDATE_WORLDPOS: `#ifdef WIND\n${body}\n#endif\n` }
  }
}
