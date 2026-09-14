/**
 * Flight Cycle playability: can anyone on a smart trainer fly through the rings? (PLAYABILITY.md)
 *
 * Simulates the whole loop at 10 Hz:
 *   the rider sees the plane and the next ring after a reaction delay, and picks an effort;
 *   their legs and the flywheel get there with a lag, and wander around it;
 *   the trainer averages its power and reports it once a second;
 *   the bridge forwards the newest report once a second, on its own clock;
 *   the server and the game's long-poll pass it on;
 *   gamekit and the game smooth it; the plane climbs or dives.
 * For each design a grid search finds the rider gains that hit the most rings (a rider who has learnt the
 * lag), then those gains fly fresh ring sequences and the hit rate is reported, with how hard it was.
 *
 * Effort e is power over the rider's steady power, minus 1: e = 0 is level flight, +0.3 is 130% of steady.
 *
 *   node tools/playability.ts          the tables in PLAYABILITY.md
 */

const DT = 0.1
const BASE_SPEED = 12 // m/s, Config.SPEED
const RING_LO = 45
const RING_HI = 160
const PLANE_LO = 40
const PLANE_HI = 175
const RINGS_PER_RUN = 40

/** Where the power reading goes between the pedals and the plane. */
export interface Chain {
  name: string
  /** the trainer's own averaging of the power it reports (s) */
  trainerWindow: number
  /** how often the trainer reports (s): FTMS and ANT+ send about once a second */
  reportEvery: number
  /** how often the bridge forwards the newest reading to the server (s), on its own clock */
  bridgeEvery: number
  /** server and the game's getstate long-poll (s) */
  transport: number
  /** gamekit EffortMeter's exponential smoothing of power (s); 3 today */
  gamekitTau: number
  /** the game's own low-pass on the pedal value (s); Config.INPUT_TAU */
  inputTau: number
}

/** The person on the bike. */
export interface Rider {
  name: string
  /** seeing the plane to deciding (s) */
  reaction: number
  /** legs and flywheel reaching a new power (s, first order) */
  legTau: number
  /** slow wander of power around what they mean to ride (fraction of steady, s.d.) */
  drift: number
  driftTau: number
  /** second-to-second unevenness (fraction of steady, s.d., a new value each second) */
  jitter: number
  /** the efforts they will ride: easy spinning to their hardest surge */
  effortMin: number
  effortMax: number
}

/** How effort moves the plane. */
export interface Flight {
  name: string
  /** pitch: effort sets the nose angle, and climb = speed x tan(pitch), so boosts climb faster (today).
   *  climb: effort sets the climb rate, whatever the speed. altitude: effort sets the height itself. */
  mech: 'pitch' | 'climb' | 'altitude'
  /** pitch: nose angle at full effort (deg) */
  maxPitchDeg: number
  /** climb: m/s of climb per unit effort */
  climbPerEffort: number
  /** how fast the plane follows (s); Config.PITCH_TAU */
  tau: number
  /** climb: within assistWindow metres of the next ring's height, also pull toward it at this rate (1/s) */
  assist: number
  assistWindow: number
  /** altitude: metres of height per unit effort, around the middle of the ring band */
  altPerEffort: number
}

/** The rings. */
export interface Course {
  /** metres between rings */
  spacing: number
  /** how far off the ring's height still counts (m); Config.RING_HIT_TOL */
  tolerance: number
  /** the most the height changes from one ring to the next (m); Config.RING_STEP_MAX */
  stepMax: number
  /** speed over the base: 1, or 1.59 with Turbo and full ring pulses */
  speedMult: number
}

/** How the rider turns what they see into effort: proportional to the height off (kp, per metre), easing off
 *  as the plane climbs (kd, per m/s); or, with `cue`, just following the HUD's arrows. */
export interface Gains {
  kp: number
  kd: number
  /** follow the cue: push `push` above steady on "▲ pedal faster", as much below on "▼ ease off", steady on
   *  "● hold it". The cue looks at the height `lead` seconds ahead (0: where the plane is now, as today),
   *  and says hold within `deadband` metres. */
  cue?: { lead: number; push: number; deadband: number }
}
export interface Result {
  hit: number
  gains: Gains
  /** share of the time above +40% of steady (hard), and above +20% (working) */
  hard: number
  working: number
  meanEffort: number
}

/** mulberry32: small, seeded, good enough for noise */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function gauss(r: () => number): number {
  return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r())
}
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
const follow = (tau: number): number => (tau > 0 ? 1 - Math.exp(-DT / tau) : 1)

/** The next ring's height: the game's bounded random walk (rings.js walkFrom) with a given step. */
function nextRingAlt(prev: number, stepMax: number, r: () => number): number {
  let step = (r() * 2 - 1) * stepMax
  if (prev > 140) step -= r() * 12
  if (prev < 60) step += r() * 12
  return clamp(prev + step, RING_LO, RING_HI)
}

interface Flown { hits: number; rings: number; seconds: number; hard: number; working: number; effortSum: number }

/** Fly RINGS_PER_RUN rings. */
export function fly(chain: Chain, rider: Rider, flight: Flight, course: Course, g: Gains, seed: number): Flown {
  const r = rng(seed)
  const v = BASE_SPEED * course.speedMult
  const mid = (RING_LO + RING_HI) / 2
  let ringAlt = nextRingAlt(90, course.stepMax, r)
  let h = ringAlt
  let climb = 0
  let pitch = 0
  let s = 0
  let nextRing = course.spacing
  const out: Flown = { hits: 0, rings: 0, seconds: 0, hard: 0, working: 0, effortSum: 0 }

  // the rider
  const reactSteps = Math.max(1, Math.round(rider.reaction / DT))
  const seenH: number[] = new Array(reactSteps).fill(h)
  const seenClimb: number[] = new Array(reactSteps).fill(0)
  let seenAt = 0
  let leg = 0
  let drift = 0
  let jitter = 0
  let jitterAt = 0

  // the trainer, the bridge, the server
  const winSteps = Math.max(1, Math.round(chain.trainerWindow / DT))
  const pedalHist: number[] = new Array(winSteps).fill(0)
  let histSum = 0
  let histAt = 0
  let reportAt = r() * chain.reportEvery // the trainer's and the bridge's clocks are not in step
  let bridgeAt = r() * chain.bridgeEvery
  let atBridge = 0
  const inFlight: { at: number; v: number }[] = []
  let smoothed = 0
  let lastArrival = -1
  let input = 0

  const kLeg = follow(rider.legTau)
  const kIn = follow(chain.inputTau)
  const kFly = follow(flight.tau)
  const maxPitch = (flight.maxPitchDeg * Math.PI) / 180
  const maxClimb = BASE_SPEED * Math.tan((25 * Math.PI) / 180)
  let t = 0

  while (out.rings < RINGS_PER_RUN) {
    // --- the rider: the plane as it was `reaction` ago; the ring ahead does not move
    const hSeen = seenH[seenAt]
    const climbSeen = seenClimb[seenAt]
    let want: number
    if (g.cue) {
      const off = ringAlt - (hSeen + g.cue.lead * climbSeen)
      want = off > g.cue.deadband ? g.cue.push : off < -g.cue.deadband ? -g.cue.push : 0
    } else if (flight.mech === 'altitude') {
      want = (ringAlt - mid) / flight.altPerEffort + g.kp * (ringAlt - hSeen)
    } else {
      want = g.kp * (ringAlt - hSeen) - g.kd * climbSeen
    }
    want = clamp(want, rider.effortMin, rider.effortMax)
    leg += (want - leg) * kLeg
    drift += (-drift / rider.driftTau) * DT + rider.drift * Math.sqrt((2 * DT) / rider.driftTau) * gauss(r)
    if (t >= jitterAt) { jitter = rider.jitter * gauss(r); jitterAt += 1 }
    const effort = Math.max(-1, leg + drift + jitter)
    if (effort > 0.4) out.hard += DT
    if (effort > 0.2) out.working += DT
    out.effortSum += effort * DT

    // --- the trainer averages and reports; the bridge forwards the newest report; it reaches the game
    histSum += effort - pedalHist[histAt]
    pedalHist[histAt] = effort
    histAt = (histAt + 1) % winSteps
    if (t >= reportAt) { atBridge = histSum / winSteps; reportAt += chain.reportEvery }
    if (t >= bridgeAt) { inFlight.push({ at: t + chain.transport, v: atBridge }); bridgeAt += chain.bridgeEvery }
    while (inFlight.length && inFlight[0].at <= t) {
      const rep = inFlight.shift()!
      const gap = lastArrival < 0 ? Infinity : rep.at - lastArrival
      smoothed = chain.gamekitTau > 0 && Number.isFinite(gap)
        ? smoothed + (rep.v - smoothed) * (1 - Math.exp(-gap / chain.gamekitTau))
        : rep.v
      lastArrival = rep.at
    }
    input += (smoothed - input) * kIn
    const e = clamp(input, -1, 1)

    // --- the plane
    if (flight.mech === 'pitch') {
      pitch += (maxPitch * e - pitch) * kFly
      climb = v * Math.tan(pitch)
    } else if (flight.mech === 'climb') {
      let target = flight.climbPerEffort * e
      const off = ringAlt - h
      if (flight.assist > 0 && Math.abs(off) < flight.assistWindow) target += flight.assist * off
      climb += (target - climb) * kFly
    } else {
      const target = clamp(mid + flight.altPerEffort * e, PLANE_LO, PLANE_HI)
      climb = clamp((target - h) / flight.tau, -maxClimb, maxClimb)
    }
    h += climb * DT
    if (h < PLANE_LO) { h = PLANE_LO; climb = Math.max(0, climb) }
    if (h > PLANE_HI) { h = PLANE_HI; climb = Math.min(0, climb) }
    seenH[seenAt] = h
    seenClimb[seenAt] = climb
    seenAt = (seenAt + 1) % reactSteps

    // --- the rings
    s += v * DT
    if (s >= nextRing) {
      out.rings++
      if (Math.abs(h - ringAlt) < course.tolerance) out.hits++
      ringAlt = nextRingAlt(ringAlt, course.stepMax, r)
      nextRing += course.spacing
    }
    t += DT
  }
  out.seconds = t
  return out
}

function score(chain: Chain, rider: Rider, flight: Flight, course: Course, g: Gains, seeds: number[]): number {
  let hits = 0
  for (const seed of seeds) hits += fly(chain, rider, flight, course, g, seed).hits
  return hits
}

/** The gains a rider settles on once they have learnt the lag: the ones that hit most, on training seeds. */
export function learn(chain: Chain, rider: Rider, flight: Flight, course: Course): Gains {
  const train = [1, 2, 3, 4, 5, 6]
  let grid: Gains[] = flight.mech === 'altitude'
    ? [0, 0.002, 0.005, 0.01, 0.02].map((kp) => ({ kp, kd: 0 }))
    : [0.005, 0.01, 0.02, 0.04, 0.08].flatMap((kp) => [0, 0.1, 0.3, 0.6].map((kd) => ({ kp, kd })))
  let top = grid[0]
  let topHits = -1
  for (let round = 0; round < 2; round++) {
    for (const g of grid) {
      const hits = score(chain, rider, flight, course, g, train)
      if (hits > topHits) { topHits = hits; top = g }
    }
    // then look closer around the best
    grid = [0.7, 1, 1.4].flatMap((a) => [0.6, 1, 1.6].map((b) => ({ kp: top.kp * a, kd: top.kd * b })))
  }
  return top
}

/** Fly fresh ring sequences with given gains. */
export function evaluate(chain: Chain, rider: Rider, flight: Flight, course: Course, gains: Gains): Result {
  const o: Flown = { hits: 0, rings: 0, seconds: 0, hard: 0, working: 0, effortSum: 0 }
  for (let i = 0; i < 24; i++) {
    const f = fly(chain, rider, flight, course, gains, 5000 + i)
    o.hits += f.hits; o.rings += f.rings; o.seconds += f.seconds; o.hard += f.hard; o.working += f.working; o.effortSum += f.effortSum
  }
  return { hit: o.hits / o.rings, gains, hard: o.hard / o.seconds, working: o.working / o.seconds, meanEffort: o.effortSum / o.seconds }
}

/** The best a rider does who has learnt the lag of this very setup. */
export function best(chain: Chain, rider: Rider, flight: Flight, course: Course): Result {
  return evaluate(chain, rider, flight, course, learn(chain, rider, flight, course))
}

/** The loop's length, as track.js builds it: a circle of 420 m whose radius swells and dips. */
export function loopLength(): number {
  const R = 420
  const radiusAt = (th: number): number => R + 20 * (Math.cos(3 * th) - 1) + 11 * (Math.cos(5 * th) - 1)
  let len = 0
  let px = radiusAt(0), pz = 0
  for (let i = 1; i <= 8192; i++) {
    const th = (i / 8192) * Math.PI * 2
    const x = Math.cos(th) * radiusAt(th), z = Math.sin(th) * radiusAt(th)
    len += Math.hypot(x - px, z - pz)
    px = x; pz = z
  }
  return len
}

// --- the cases in PLAYABILITY.md ------------------------------------------------------------------------

export const CHAINS = {
  today: { name: 'today', trainerWindow: 2, reportEvery: 1, bridgeEvery: 1, transport: 0.3, gamekitTau: 3, inputTau: 0.25 },
  quick: { name: 'without gamekit smoothing', trainerWindow: 2, reportEvery: 1, bridgeEvery: 1, transport: 0.3, gamekitTau: 0, inputTau: 0.25 },
  sluggish: { name: 'sluggish trainer (4 s)', trainerWindow: 4, reportEvery: 1, bridgeEvery: 1, transport: 0.3, gamekitTau: 0, inputTau: 0.25 },
} satisfies Record<string, Chain>

export const RIDERS = {
  practised: { name: 'practised', reaction: 0.5, legTau: 1, drift: 0.06, driftTau: 6, jitter: 0.04, effortMin: -0.5, effortMax: 0.6 },
  first: { name: 'first ride', reaction: 0.8, legTau: 1.5, drift: 0.09, driftTau: 6, jitter: 0.06, effortMin: -0.5, effortMax: 0.4 },
} satisfies Record<string, Rider>

export const FLIGHTS = {
  pitch: { name: 'pitch (today)', mech: 'pitch', maxPitchDeg: 25, climbPerEffort: 0, tau: 1.2, assist: 0, assistWindow: 0, altPerEffort: 0 },
  climb: { name: 'climb rate', mech: 'climb', maxPitchDeg: 0, climbPerEffort: 4, tau: 0.8, assist: 0, assistWindow: 0, altPerEffort: 0 },
  capture: { name: 'climb rate + capture', mech: 'climb', maxPitchDeg: 0, climbPerEffort: 4, tau: 0.8, assist: 0.35, assistWindow: 12, altPerEffort: 0 },
  altitude: { name: 'effort = height', mech: 'altitude', maxPitchDeg: 0, climbPerEffort: 0, tau: 2, assist: 0, assistWindow: 0, altPerEffort: 120 },
} satisfies Record<string, Flight>

export const TODAY: Course = { spacing: 98, tolerance: 6, stepMax: 35, speedMult: 1 }
export const TURBO = 1.59

const pct = (x: number): string => `${Math.round(x * 100)}%`.padStart(4)

function line(label: string, res: Result): void {
  console.log(`  ${label.padEnd(52)} hit ${pct(res.hit)}   >+20% ${pct(res.working)}  >+40% ${pct(res.hard)}  (kp ${+res.gains.kp.toFixed(4)}, kd ${+res.gains.kd.toFixed(3)})`)
}

function main(): void {
  const { today, quick, sluggish } = CHAINS
  const { practised, first } = RIDERS
  const section = (process.argv[2] ?? 'all')

  if (section === 'all' || section === '1') {
    console.log('\n1. The game as it is: rings 98 m (8 s) apart, ±6 m, height steps up to 35 m')
    line('practised, today', best(today, practised, FLIGHTS.pitch, TODAY))
    line('practised, without gamekit smoothing', best(quick, practised, FLIGHTS.pitch, TODAY))
    line('practised, without gamekit smoothing, Turbo', best(quick, practised, FLIGHTS.pitch, { ...TODAY, speedMult: TURBO }))
    line('first ride, today', best(today, first, FLIGHTS.pitch, TODAY))
  }

  if (section === 'all' || section === '2') {
    for (const flight of [FLIGHTS.pitch, FLIGHTS.climb, FLIGHTS.capture, FLIGHTS.altitude]) {
      console.log(`\n2. ${flight.name}: first ride, without gamekit smoothing, height steps up to 20 m`)
      for (const tol of [6, 9, 12]) {
        for (const spacing of [98, 150, 200, 250, 300]) {
          line(`${spacing} m (${(spacing / BASE_SPEED).toFixed(0)} s), ±${tol} m`, best(quick, first, flight, { spacing, tolerance: tol, stepMax: 20, speedMult: 1 }))
        }
      }
    }
  }

  if (section === 'all' || section === '3') {
    const loop = loopLength()
    console.log(`\n3. Candidates on the ${loop.toFixed(0)} m loop. A first-time rider learns their gains at cruise, with the chain`)
    console.log('   as it would ship (no gamekit smoothing); then the same gains fly the harder cases.')
    const candidates: [string, Flight, Course][] = []
    for (const n of [16, 14, 12]) {
      const spacing = loop / n
      candidates.push([`today's flight, ${n} rings a lap (${spacing.toFixed(0)} m), ±9 m, steps up to 20 m`, FLIGHTS.pitch, { spacing, tolerance: 9, stepMax: 20, speedMult: 1 }])
      candidates.push([`climb rate + capture, ${n} rings a lap (${spacing.toFixed(0)} m), ±9 m, steps up to 20 m`, FLIGHTS.capture, { spacing, tolerance: 9, stepMax: 20, speedMult: 1 }])
    }
    for (const [label, flight, course] of candidates) {
      console.log(`\n  ${label}`)
      const g = learn(quick, first, flight, course)
      const gp = learn(quick, practised, flight, course)
      line('first ride', evaluate(quick, first, flight, course, g))
      line('first ride, Turbo (+59% speed)', evaluate(quick, first, flight, { ...course, speedMult: TURBO }, g))
      line('first ride, with gamekit smoothing as today', evaluate(today, first, flight, course, g))
      line('first ride, sluggish trainer', evaluate(sluggish, first, flight, course, g))
      line('first ride, timid (gains x0.5)', evaluate(quick, first, flight, course, { kp: g.kp * 0.5, kd: g.kd * 0.5 }))
      line('first ride, eager (gains x2)', evaluate(quick, first, flight, course, { kp: g.kp * 2, kd: g.kd * 2 }))
      line('first ride, no anticipation (kd 0)', evaluate(quick, first, flight, course, { kp: g.kp, kd: 0 }))
      line('practised', evaluate(quick, practised, flight, course, gp))
      line('practised, Turbo', evaluate(quick, practised, flight, { ...course, speedMult: TURBO }, gp))
    }
  }

  if (section === 'all' || section === '4') {
    const course = CHOSEN
    const flight = FLIGHTS.pitch
    const capped = { ...course, speedMult: BOOST_CAP }
    const turbo = { ...course, speedMult: TURBO }
    const cue = (lead: number, push: number, deadband: number): Gains => ({ kp: 0, kd: 0, cue: { lead, push, deadband } })
    const todayCue = cue(0, CUE_PUSH, course.tolerance)
    const predictive = cue(CUE_LEAD, CUE_PUSH, course.tolerance / 2)

    console.log('\n4a. A first-time rider who follows the arrows, boosts capped at +25%: the cue looks `lead` s ahead')
    for (const push of [0.2, 0.3, 0.4]) {
      const cells = [0, 1.5, 2.5, 3.5, 5].map((lead) => `lead ${lead} s ${pct(evaluate(quick, first, flight, capped, cue(lead, push, course.tolerance / 2)).hit)}`)
      console.log(`  +/-${Math.round(push * 100)}% on the arrows: ${cells.join('   ')}`)
    }

    console.log(`\n4b. As built: today's flight, 14 rings a lap (${course.spacing.toFixed(0)} m), gold ±${course.tolerance} m, red ±${RED_TOLERANCE} m, steps up to ${course.stepMax} m`)
    const g = learn(quick, first, flight, course)
    line('first ride, gains learnt', evaluate(quick, first, flight, course, g))
    line('first ride, gains learnt, red rings', evaluate(quick, first, flight, { ...course, tolerance: RED_TOLERANCE }, g))
    line("arrows, today's cue, today's rings and boosts", evaluate(quick, first, flight, { ...TODAY, speedMult: TURBO }, cue(0, CUE_PUSH, TODAY.tolerance)))
    line("arrows, today's cue, today's boosts", evaluate(quick, first, flight, turbo, todayCue))
    line("arrows, today's cue", evaluate(quick, first, flight, course, todayCue))
    line('arrows, predictive cue', evaluate(quick, first, flight, course, predictive))
    line('arrows, predictive cue, red rings', evaluate(quick, first, flight, { ...course, tolerance: RED_TOLERANCE }, cue(CUE_LEAD, CUE_PUSH, RED_TOLERANCE / 2)))
    line('arrows, predictive cue, boosts capped', evaluate(quick, first, flight, capped, predictive))
    line("arrows, predictive cue, today's boosts", evaluate(quick, first, flight, turbo, predictive))
    line('arrows, predictive cue, capped boosts, sluggish trainer', evaluate(sluggish, first, flight, capped, predictive))
    line('arrows, predictive cue, capped boosts, gamekit smoothing', evaluate(today, first, flight, capped, predictive))
    line('practised, gains learnt, capped boosts', evaluate(quick, practised, flight, capped, learn(quick, practised, flight, course)))
    console.log('\n   Holding steady power with no plane to fly (the rider\'s own unevenness, RMS of effort):')
    for (const rider of [practised, first]) console.log(`  ${rider.name.padEnd(52)} ${pct(Math.hypot(rider.drift, rider.jitter))}`)
  }
}

/** The course as built (js/config.js): what section 4 checks. */
export const CHOSEN: Course = { spacing: loopLength() / 14, tolerance: 9, stepMax: 20, speedMult: 1 }
export const RED_TOLERANCE = 6
/** Turbo and ring pulses together, as built: +25% at most (was +59%) */
export const BOOST_CAP = 1.25
/** The HUD cue judges the height this far ahead (s), and a rider following it pushes this much */
export const CUE_LEAD = 3
export const CUE_PUSH = 0.3

if (import.meta.url === `file://${process.argv[1]}`) main()
