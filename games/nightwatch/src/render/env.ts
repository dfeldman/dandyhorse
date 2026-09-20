/** Per-frame values every custom shader shares: fog, the lamp and its beams, the time. */
import { Color3, Vector3, type ShaderMaterial } from '@babylonjs/core'
import type { Look } from './palette.ts'

export interface Env {
  time: number
  look: Look
  cameraPos: Vector3
  fogColor: Color3
  fogDensity: number
  lampPos: Vector3
  lampColor: Color3
  lampBright: number
  beamAngle: number
  beamReach: number
  moonDir: Vector3
  sunDir: Vector3
  flash: number
  harborGlow: number
  waveAmp: number
  /** 0–1 how thick the fog is (the beams show up more in it). */
  fogAmt: number
}

export function newEnv(): Env {
  return {
    time: 0,
    look: null as unknown as Look,
    cameraPos: new Vector3(),
    fogColor: new Color3(),
    fogDensity: 0.0005,
    lampPos: new Vector3(),
    lampColor: new Color3(1, 0.86, 0.55),
    lampBright: 0,
    beamAngle: 0,
    beamReach: 400,
    moonDir: new Vector3(0, 0.1, 1),
    sunDir: new Vector3(1, 0, 0),
    flash: 0,
    harborGlow: 0.5,
    waveAmp: 0.6,
    fogAmt: 0,
  }
}

export function applyFog(m: ShaderMaterial, env: Env): void {
  m.setColor3('fogColor', env.fogColor)
  m.setFloat('fogDensity', env.fogDensity)
  m.setVector3('cameraPos', env.cameraPos)
  m.setFloat('time', env.time)
}

export function applyLamp(m: ShaderMaterial, env: Env): void {
  m.setVector3('lampPos', env.lampPos)
  m.setColor3('lampColor', env.lampColor)
  m.setFloat('lampBright', env.lampBright)
  m.setFloat('beamAngle', env.beamAngle)
  m.setFloat('beamReach', env.beamReach)
}

export const col3 = (c: [number, number, number]): Color3 => new Color3(c[0], c[1], c[2])
