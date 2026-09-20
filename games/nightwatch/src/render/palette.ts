/**
 * The colour of the night: keyframes from dusk through deep night to dawn, blended by the night's progress,
 * then tinted by the weather.
 */
import { clamp, lerp } from '../rng.ts'
import type { WeatherMix } from '../sim/weather.ts'
import { hex, mix, type Rgb } from './kit.ts'

export interface Look {
  skyTop: Rgb
  skyHorizon: Rgb
  /** Warm glow low in the east (dusk's last light, then dawn). */
  glow: Rgb
  glowAmt: number
  seaDeep: Rgb
  hemiSky: Rgb
  hemiGround: Rgb
  hemi: number
  moon: number
  stars: number
  /** The sun's height for the dawn: −1 well below, 1 up. */
  sun: number
  fogColor: Rgb
  fogDensity: number
  clouds: number
  cloudColor: Rgb
  waves: number
}

interface Key { p: number; top: string; hor: string; glow: string; glowAmt: number; sea: string; hemiSky: string; hemi: number; moon: number; stars: number; sun: number }

const KEYS: Key[] = [
  { p: 0.0, top: '#2a2a6e', hor: '#e8845c', glow: '#ff9a52', glowAmt: 0.9, sea: '#1d2f6b', hemiSky: '#8e86c8', hemi: 0.75, moon: 0.5, stars: 0.2, sun: -0.3 },
  { p: 0.06, top: '#1d1f5c', hor: '#8a4f8c', glow: '#ff7a6a', glowAmt: 0.45, sea: '#172761', hemiSky: '#6e72c0', hemi: 0.62, moon: 0.8, stars: 0.6, sun: -0.6 },
  { p: 0.16, top: '#0d1240', hor: '#2c3478', glow: '#6a5ab8', glowAmt: 0.12, sea: '#0f1d52', hemiSky: '#5864b4', hemi: 0.52, moon: 1, stars: 1, sun: -1 },
  { p: 0.5, top: '#080c34', hor: '#1f2a6a', glow: '#4a58b0', glowAmt: 0.06, sea: '#0c1a4a', hemiSky: '#5060b0', hemi: 0.5, moon: 1, stars: 1, sun: -1 },
  { p: 0.84, top: '#0d1240', hor: '#2c3478', glow: '#7a5ab8', glowAmt: 0.12, sea: '#0f1d52', hemiSky: '#5864b4', hemi: 0.52, moon: 0.9, stars: 1, sun: -1 },
  { p: 0.93, top: '#243070', hor: '#9a5a8e', glow: '#ff8a70', glowAmt: 0.5, sea: '#1a2c68', hemiSky: '#7a78c4', hemi: 0.62, moon: 0.6, stars: 0.5, sun: -0.5 },
  { p: 1.0, top: '#4f7cc8', hor: '#ffc27a', glow: '#ffd07a', glowAmt: 1, sea: '#2f5a9a', hemiSky: '#c8c0e8', hemi: 1.0, moon: 0.2, stars: 0, sun: 0.4 },
]

export function lookAt(progress: number, w: WeatherMix, lightning: number): Look {
  const p = clamp(progress, 0, 1)
  let i = 0
  while (i < KEYS.length - 2 && p > KEYS[i + 1]!.p) i++
  const a = KEYS[i]!, b = KEYS[i + 1]!
  const t = clamp((p - a.p) / (b.p - a.p), 0, 1)
  const c = (x: string, y: string): Rgb => mix(hex(x), hex(y), t)
  const n = (x: number, y: number): number => lerp(x, y, t)

  let skyTop = c(a.top, b.top)
  let skyHorizon = c(a.hor, b.hor)
  const seaDeep = c(a.sea, b.sea)
  const overcast = Math.max(w.fog, w.storm, w.rain * 0.7, w.mist * 0.4)
  // weather greys the sky out and hides the stars and moon
  const grey: Rgb = mix([0.13, 0.15, 0.24], skyHorizon, 0.35)
  skyTop = mix(skyTop, mix(grey, skyTop, 0.4), overcast * 0.8)
  skyHorizon = mix(skyHorizon, grey, Math.max(w.fog, w.storm) * 0.75 + w.mist * 0.3)
  const fogColor = mix(skyHorizon, [0.3, 0.34, 0.46], w.fog * 0.35)
  const flash = lightning
  return {
    skyTop: mix(skyTop, [0.75, 0.8, 1], flash * 0.6),
    skyHorizon: mix(skyHorizon, [0.8, 0.85, 1], flash * 0.5),
    glow: c(a.glow, b.glow),
    glowAmt: n(a.glowAmt, b.glowAmt) * (1 - overcast * 0.6),
    seaDeep,
    hemiSky: mix(c(a.hemiSky, b.hemiSky), [0.9, 0.92, 1], flash),
    hemiGround: [0.12, 0.1, 0.22],
    hemi: n(a.hemi, b.hemi) * (1 - overcast * 0.25) + flash * 1.6,
    moon: n(a.moon, b.moon) * (1 - overcast * 0.85),
    stars: n(a.stars, b.stars) * (1 - overcast),
    sun: n(a.sun, b.sun),
    fogColor: mix(fogColor, [0.7, 0.75, 0.95], flash * 0.5),
    fogDensity: 0.00042 + w.mist * 0.0009 + w.rain * 0.0007 + w.fog * 0.0026 + w.storm * 0.0006,
    clouds: Math.min(1, 0.22 + w.rain * 0.5 + w.storm * 0.75 + w.fog * 0.3 + w.mist * 0.15),
    cloudColor: mix([0.22, 0.24, 0.36], skyHorizon, 0.3),
    waves: 0.55 + w.rain * 0.35 + w.storm * 1.35,
  }
}

/** The moon's direction over the night: low in the north-east, arcing to the north-west, always in view. */
export function moonDirection(progress: number): [number, number, number] {
  const az = lerp(0.62, -0.62, progress) // radians from north, + = east
  const el = 0.06 + 0.07 * Math.sin(progress * Math.PI)
  return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)]
}

/** The sun comes up in the east-north-east at dawn. */
export function sunDirection(sun: number): [number, number, number] {
  const az = 0.95
  const el = sun * 0.08
  return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)]
}
