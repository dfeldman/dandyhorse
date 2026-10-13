/**
 * Grass that grows up out of the ground as the rider approaches, instead of appearing along a line.
 *
 * The first version faded the tufts by shrinking them when they were sown. The trouble is that they are only
 * re-sown when the rider crosses a grid cell, so for the twenty-odd metres in between the edge of the grass
 * stood still while the rider rode toward it, then jumped — a hard front across the middle distance that
 * filled in with a lurch every few seconds. The fix is that the edge must move with the camera every frame,
 * and only the vertex shader can do that.
 *
 * The clump is collapsed onto its own origin — ALL of it, not just its height. Taking only the height out
 * was the first attempt and it was worse than the problem: a blade leans sideways as well as standing up, so
 * flattening it left a small dark flake of geometry lying on the ground, and several thousand of those turned
 * the ground black out to the edge of the ring. Collapsing the whole offset leaves a blade of no size at all. The ring the tufts are sown
 * over is deliberately wider than the fade, by more than a grid cell, so there is always geometry standing
 * ready beyond the edge — the fade never runs out of tufts before the sowing catches up.
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

export class FadePlugin extends MaterialPluginBase {
  /** where the rider is, in scene metres */
  readonly centre = new Vector3()
  /** full height up to here, gone by `far`, in metres from the rider */
  near = 40
  far = 70

  constructor(material: Material) {
    // after the wind (180), so the collapse is the last thing done to the blade
    super(material, 'Fade', 190, { GRASSFADE: true })
    this._enable(true)
  }

  override getClassName(): string { return 'FadePlugin' }
  override isCompatible(): boolean { return true }
  override prepareDefines(defines: MaterialDefines): void { defines.GRASSFADE = true }

  override getUniforms(shaderLanguage?: ShaderLanguage): {
    ubo: Array<{ name: string; size: number; type: string }>
    vertex?: string
  } {
    const ubo = [
      { name: 'fadeCentre', size: 3, type: 'vec3' },
      { name: 'fadeNear', size: 1, type: 'float' },
      { name: 'fadeFar', size: 1, type: 'float' },
    ]
    if (shaderLanguage === ShaderLanguage.WGSL) return { ubo }
    return { ubo, vertex: `#ifdef GRASSFADE\nuniform vec3 fadeCentre;\nuniform float fadeNear;\nuniform float fadeFar;\n#endif` }
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): void {
    uniformBuffer.updateVector3('fadeCentre', this.centre)
    uniformBuffer.updateFloat('fadeNear', this.near)
    uniformBuffer.updateFloat('fadeFar', this.far)
  }

  override getCustomCode(shaderType: string, shaderLanguage?: ShaderLanguage): { [point: string]: string } | null {
    if (shaderType !== 'vertex') return null
    const wgsl = shaderLanguage === ShaderLanguage.WGSL
    const u = (n: string): string => (wgsl ? `uniforms.${n}` : n)
    const body = wgsl
      ? `
  {
    let fD: f32 = length(worldPos.xz - uniforms.fadeCentre.xz);
    let fKeep: f32 = 1.0 - smoothstep(${u('fadeNear')}, ${u('fadeFar')}, fD);
    let fOff: vec4f = finalWorld * vec4f(positionUpdated, 0.0);
    worldPos = worldPos - fOff * (1.0 - fKeep);
  }
`
      : `
  {
    float fD = length(worldPos.xz - fadeCentre.xz);
    float fKeep = 1.0 - smoothstep(fadeNear, fadeFar, fD);
    vec4 fOff = finalWorld * vec4(positionUpdated, 0.0);
    worldPos -= fOff * (1.0 - fKeep);
  }
`
    return { CUSTOM_VERTEX_UPDATE_WORLDPOS: `#ifdef GRASSFADE\n${body}\n#endif\n` }
  }
}
