/**
 * The one wheel every vehicle shares: radius 1, width 1, axle along x, outer face at +x.
 *
 * A fleet draws all its wheels as thin instances of this, each scaled to its vehicle's tyre and turned by its
 * own matrix — which is how the front wheels steer and every wheel spins without a mesh per car. The spokes
 * alternate light and dark so the spin is visible; a plain disc turning looks exactly like one standing still.
 */
import type { Rgb } from '../spec.ts'
import { Builder, Role, type V3 } from './builder.ts'

const TYRE: Rgb = [0.11, 0.11, 0.12]
const SIDEWALL: Rgb = [0.16, 0.16, 0.17]
const RIM: Rgb = [0.86, 0.87, 0.88]
const RIM_DARK: Rgb = [0.22, 0.23, 0.25]
const HUB: Rgb = [0.62, 0.63, 0.65]

export const WHEEL_SIDES = 14

/** The cross-section from the inner hub, round the tyre, to the outer hub: (x along the axle, radius). */
const PROFILE: [number, number][] = [
  [-0.5, 0], [-0.5, 0.6], [-0.5, 0.86], [-0.42, 0.97], [-0.3, 1], [0.3, 1], [0.42, 0.97], [0.5, 0.86], [0.5, 0.7],
  [0.42, 0.66], [0.45, 0.22], [0.5, 0.18], [0.5, 0],
]

export function buildWheel(): Builder {
  const out = new Builder()
  out.alpha = 0
  const n = WHEEL_SIDES
  for (let i = 0; i < PROFILE.length - 1; i++) {
    const [x0, r0] = PROFILE[i]
    const [x1, r1] = PROFILE[i + 1]
    // the outward normal of this profile segment: to the left of travel round the section
    const dx = x1 - x0, dr = r1 - r0
    for (let j = 0; j < n; j++) {
      const a0 = (j / n) * Math.PI * 2, a1 = ((j + 1) / n) * Math.PI * 2
      const am = (a0 + a1) / 2
      const p = (x: number, r: number, a: number): V3 => [x, Math.cos(a) * r, Math.sin(a) * r]
      const hint: V3 = [-dr, dx * Math.cos(am), dx * Math.sin(am)]
      // 0–2 inner face, 3–5 tread, 6–7 outer sidewall, 8 rim lip, 9 the spoked dish, 10+ hub
      let colour = TYRE
      if (i <= 1 || i === 7) colour = SIDEWALL
      if (i === 8) colour = RIM
      if (i === 9) colour = j % 2 === 0 ? RIM : RIM_DARK
      if (i >= 10) colour = HUB
      out.quadToward(p(x0, r0, a0), p(x1, r1, a0), p(x1, r1, a1), p(x0, r0, a1), hint, Role.FIXED, colour)
    }
  }
  return out
}
