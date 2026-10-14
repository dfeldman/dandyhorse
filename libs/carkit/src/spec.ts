/**
 * What a vehicle IS: a handful of numbers in metres, a tail style, two paints and a livery.
 *
 * Every vehicle in the kit is one of a few archetypes (hatchback, sedan, SUV, van, box truck, bus…) and an
 * archetype is only a set of RANGES for those numbers. `randomSpec(archetype, seed)` picks inside the ranges,
 * so a city gets thousands of different-looking cars that still read instantly as "a hatchback" or "a bus".
 *
 * The frame every number is measured in: +z forward, +y up, +x to the driver's right, origin on the road
 * midway between the axles. A vehicle's world matrix is therefore its ground point, heading and tilt and
 * nothing else — the wheels sit at z = ±wheelbase/2 whatever the overhangs are, which is what makes tilting
 * it onto a hill (pose.ts) a matter of two heights.
 */

export type Rgb = [number, number, number]

export const ARCHETYPES = [
  'hatchback', 'sedan', 'coupe', 'suv', 'pickup', 'minivan', 'van', 'boxtruck', 'bus', 'schoolbus',
] as const
export type Archetype = (typeof ARCHETYPES)[number]

/**
 * How the body ends behind the cabin.
 * - `notch`: a sedan's separate boot below the rear window
 * - `hatch`: a steep rear window that runs nearly to the tail
 * - `fast`: a long sloping rear window down to a short deck (coupés)
 * - `box`: the roof carries straight back to a near-vertical tail (SUVs, vans, buses)
 * - `bed`: a cab, then an open load bed at waist height (pickups)
 * - `cargo`: a cab, then a separate box body on the chassis (box trucks)
 */
export type Tail = 'notch' | 'hatch' | 'fast' | 'box' | 'bed' | 'cargo'

export const LIVERIES = ['none', 'taxi', 'police', 'ambulance', 'delivery', 'transit'] as const
export type Livery = (typeof LIVERIES)[number]

/** How much of the side behind the front doors is glass: cars `full`, panel vans `front`, a few `none`. */
export type SideGlass = 'full' | 'front' | 'none'

export interface CarSpec {
  archetype: Archetype
  /** bumper to bumper, metres */
  length: number
  /** body width without mirrors */
  width: number
  /** ground to roof (to the box top on a box truck; signs and light bars are extra) */
  height: number
  wheelbase: number
  /** nose to front axle */
  frontOverhang: number
  wheelRadius: number
  wheelWidth: number
  /** underside of the body above the road */
  clearance: number
  /** top of the front of the bonnet */
  noseHeight: number
  /** the beltline: where the side glass starts */
  beltHeight: number
  /** nose to the foot of the windscreen, along z */
  hoodLength: number
  /** the windscreen's run along z: 0 is vertical, a sports car is over a metre */
  windscreenRake: number
  /** foot of the windscreen to the end of the flat roof */
  cabinLength: number
  /** the rear window's run along z (for `box`, the small chamfer at the top of the tail) */
  rearRake: number
  tail: Tail
  /** the boot lid's height (notch/fast), the bed rail (bed), or the cargo box floor (cargo) */
  deckHeight: number
  /** how much narrower the roof is than the body, each side */
  tumblehome: number
  /** side windows along the greenhouse; the pillars between them are paint2 */
  sideWindows: number
  sideGlass: SideGlass
  paint: Rgb
  /** roof, pillars and mirrors; the cargo box on a box truck. Same as paint for a single-colour car. */
  paint2: Rgb
  livery: Livery
  /** recorded so a spec can be rebuilt; the geometry itself does not use it */
  seed: number
}

type Range = [number, number]
interface ArchetypeDef {
  tail: Tail
  sideGlass: SideGlass
  length: Range; width: Range; height: Range
  /** fractions of length, so the proportions survive a long or short pick */
  wheelbaseF: Range; frontOverhangF: Range; hoodF: Range; cabinF: Range
  wheelRadius: Range; wheelWidth: Range; clearance: Range
  /** fractions of height */
  noseF: Range; beltF: Range; deckF: Range
  windscreenRake: Range; rearRake: Range; tumblehome: Range
  sideWindows: [number, number]
  /** probability the roof/pillars get a dark second colour */
  twoTone: number
}

export const ARCHETYPE_DEFS: Record<Archetype, ArchetypeDef> = {
  hatchback: {
    tail: 'hatch', sideGlass: 'full', length: [3.7, 4.3], width: [1.68, 1.8], height: [1.42, 1.52],
    wheelbaseF: [0.63, 0.67], frontOverhangF: [0.16, 0.18], hoodF: [0.23, 0.26], cabinF: [0.42, 0.47],
    wheelRadius: [0.32, 0.35], wheelWidth: [0.19, 0.22], clearance: [0.14, 0.17],
    noseF: [0.48, 0.53], beltF: [0.63, 0.67], deckF: [0.68, 0.72],
    windscreenRake: [0.6, 0.72], rearRake: [0.22, 0.32], tumblehome: [0.1, 0.14], sideWindows: [2, 2], twoTone: 0.6,
  },
  sedan: {
    tail: 'notch', sideGlass: 'full', length: [4.5, 4.95], width: [1.78, 1.86], height: [1.4, 1.48],
    wheelbaseF: [0.6, 0.63], frontOverhangF: [0.18, 0.2], hoodF: [0.25, 0.29], cabinF: [0.24, 0.28],
    wheelRadius: [0.34, 0.36], wheelWidth: [0.21, 0.24], clearance: [0.13, 0.16],
    noseF: [0.53, 0.57], beltF: [0.62, 0.66], deckF: [0.66, 0.7],
    windscreenRake: [0.8, 0.95], rearRake: [0.5, 0.7], tumblehome: [0.12, 0.16], sideWindows: [2, 2], twoTone: 0.4,
  },
  coupe: {
    tail: 'fast', sideGlass: 'full', length: [4.3, 4.7], width: [1.88, 1.98], height: [1.12, 1.25],
    wheelbaseF: [0.6, 0.63], frontOverhangF: [0.19, 0.21], hoodF: [0.3, 0.34], cabinF: [0.1, 0.14],
    wheelRadius: [0.35, 0.37], wheelWidth: [0.26, 0.3], clearance: [0.1, 0.12],
    noseF: [0.42, 0.48], beltF: [0.62, 0.66], deckF: [0.68, 0.74],
    windscreenRake: [0.8, 0.95], rearRake: [0.9, 1.15], tumblehome: [0.16, 0.2], sideWindows: [1, 1], twoTone: 0.7,
  },
  suv: {
    tail: 'box', sideGlass: 'full', length: [4.4, 4.95], width: [1.86, 1.98], height: [1.68, 1.85],
    wheelbaseF: [0.6, 0.63], frontOverhangF: [0.17, 0.19], hoodF: [0.24, 0.27], cabinF: [0.42, 0.48],
    wheelRadius: [0.39, 0.43], wheelWidth: [0.24, 0.27], clearance: [0.2, 0.24],
    noseF: [0.55, 0.6], beltF: [0.6, 0.64], deckF: [0.6, 0.64],
    windscreenRake: [0.55, 0.7], rearRake: [0.08, 0.14], tumblehome: [0.08, 0.12], sideWindows: [2, 3], twoTone: 0.6,
  },
  pickup: {
    tail: 'bed', sideGlass: 'full', length: [5.2, 5.8], width: [1.95, 2.05], height: [1.8, 1.95],
    wheelbaseF: [0.6, 0.63], frontOverhangF: [0.16, 0.18], hoodF: [0.27, 0.3], cabinF: [0.2, 0.26],
    wheelRadius: [0.39, 0.43], wheelWidth: [0.26, 0.29], clearance: [0.25, 0.3],
    noseF: [0.57, 0.62], beltF: [0.58, 0.62], deckF: [0.56, 0.6],
    windscreenRake: [0.5, 0.6], rearRake: [0.02, 0.04], tumblehome: [0.08, 0.1], sideWindows: [1, 2], twoTone: 0.2,
  },
  minivan: {
    tail: 'box', sideGlass: 'full', length: [4.8, 5.15], width: [1.9, 2.0], height: [1.72, 1.82],
    wheelbaseF: [0.58, 0.6], frontOverhangF: [0.18, 0.2], hoodF: [0.14, 0.17], cabinF: [0.55, 0.6],
    wheelRadius: [0.35, 0.37], wheelWidth: [0.22, 0.24], clearance: [0.15, 0.18],
    noseF: [0.48, 0.52], beltF: [0.54, 0.58], deckF: [0.54, 0.58],
    windscreenRake: [0.85, 1.0], rearRake: [0.15, 0.22], tumblehome: [0.1, 0.13], sideWindows: [3, 3], twoTone: 0.2,
  },
  van: {
    tail: 'box', sideGlass: 'front', length: [5.0, 6.0], width: [1.95, 2.05], height: [2.25, 2.6],
    wheelbaseF: [0.56, 0.6], frontOverhangF: [0.16, 0.18], hoodF: [0.1, 0.13], cabinF: [0.62, 0.7],
    wheelRadius: [0.35, 0.38], wheelWidth: [0.22, 0.24], clearance: [0.18, 0.21],
    noseF: [0.38, 0.42], beltF: [0.45, 0.48], deckF: [0.45, 0.48],
    windscreenRake: [0.55, 0.7], rearRake: [0.04, 0.06], tumblehome: [0.04, 0.07], sideWindows: [3, 4], twoTone: 0,
  },
  boxtruck: {
    tail: 'cargo', sideGlass: 'front', length: [6.5, 8.2], width: [2.25, 2.45], height: [3.1, 3.5],
    wheelbaseF: [0.55, 0.58], frontOverhangF: [0.15, 0.17], hoodF: [0.1, 0.13], cabinF: [0.08, 0.1],
    wheelRadius: [0.44, 0.48], wheelWidth: [0.26, 0.28], clearance: [0.28, 0.32],
    // (the beltline a box truck's: 1.5–1.7 m, a tall flat front under a windscreen that stops at the cab's roof)
    noseF: [0.33, 0.36], beltF: [0.47, 0.5], deckF: [0.3, 0.32],
    windscreenRake: [0.25, 0.35], rearRake: [0.03, 0.04], tumblehome: [0.05, 0.07], sideWindows: [1, 1], twoTone: 1,
  },
  bus: {
    tail: 'box', sideGlass: 'full', length: [10.5, 12.2], width: [2.5, 2.55], height: [3.0, 3.2],
    wheelbaseF: [0.5, 0.54], frontOverhangF: [0.23, 0.25], hoodF: [0.005, 0.01], cabinF: [0.9, 0.93],
    wheelRadius: [0.49, 0.51], wheelWidth: [0.28, 0.3], clearance: [0.28, 0.32],
    noseF: [0.26, 0.29], beltF: [0.34, 0.37], deckF: [0.34, 0.37],
    windscreenRake: [0.18, 0.28], rearRake: [0.08, 0.12], tumblehome: [0.04, 0.06], sideWindows: [5, 7], twoTone: 0,
  },
  // the North American "conventional" school bus: a truck bonnet ahead of a long box with rows of small windows
  schoolbus: {
    tail: 'box', sideGlass: 'full', length: [9.8, 11.5], width: [2.38, 2.44], height: [3.0, 3.2],
    wheelbaseF: [0.52, 0.56], frontOverhangF: [0.1, 0.12], hoodF: [0.15, 0.17], cabinF: [0.78, 0.8],
    wheelRadius: [0.48, 0.5], wheelWidth: [0.27, 0.29], clearance: [0.3, 0.34],
    noseF: [0.4, 0.43], beltF: [0.5, 0.53], deckF: [0.5, 0.53],
    windscreenRake: [0.25, 0.35], rearRake: [0.12, 0.16], tumblehome: [0.08, 0.1], sideWindows: [9, 11], twoTone: 0,
  },
}

/** National School Bus Glossy Yellow, near enough */
export const SCHOOL_YELLOW: Rgb = [0.98, 0.66, 0.06]

/** Ordinary car colours, weighted the way a real street is (lots of grey, white and black), plus toy brights. */
export const PALETTE: { colour: Rgb; weight: number; name: string }[] = [
  { name: 'white', colour: [0.9, 0.9, 0.88], weight: 18 },
  { name: 'black', colour: [0.1, 0.1, 0.11], weight: 14 },
  { name: 'silver', colour: [0.7, 0.72, 0.74], weight: 14 },
  { name: 'grey', colour: [0.42, 0.44, 0.46], weight: 12 },
  { name: 'red', colour: [0.8, 0.1, 0.09], weight: 8 },
  { name: 'blue', colour: [0.12, 0.35, 0.85], weight: 8 },
  { name: 'navy', colour: [0.1, 0.15, 0.35], weight: 4 },
  { name: 'green', colour: [0.45, 0.8, 0.12], weight: 3 },
  { name: 'forest', colour: [0.12, 0.33, 0.2], weight: 2 },
  { name: 'yellow', colour: [0.95, 0.78, 0.14], weight: 3 },
  { name: 'orange', colour: [0.95, 0.5, 0.1], weight: 3 },
  { name: 'beige', colour: [0.78, 0.7, 0.55], weight: 3 },
  { name: 'brown', colour: [0.38, 0.24, 0.16], weight: 2 },
  { name: 'teal', colour: [0.1, 0.55, 0.6], weight: 2 },
  { name: 'purple', colour: [0.4, 0.2, 0.55], weight: 1 },
]

export const ROOF_BLACK: Rgb = [0.09, 0.09, 0.1]

/** A small, fast, seedable PRNG (mulberry32). The same seed always gives the same vehicle. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function pickPaint(r: () => number): Rgb {
  const total = PALETTE.reduce((s, p) => s + p.weight, 0)
  let x = r() * total
  for (const p of PALETTE) {
    x -= p.weight
    if (x <= 0) return [...p.colour]
  }
  return [...PALETTE[0].colour]
}

/**
 * A vehicle of the given archetype, varied inside its ranges by `seed`. `livery` dresses it as a taxi, police
 * car and so on, and overrides the paint where the livery has one.
 */
export function randomSpec(archetype: Archetype, seed = 1, livery: Livery = 'none'): CarSpec {
  const d = ARCHETYPE_DEFS[archetype]
  const r = rng(seed * 7919 + ARCHETYPES.indexOf(archetype) * 104729 + 17)
  const pick = ([a, b]: Range): number => a + (b - a) * r()
  const length = pick(d.length)
  const height = pick(d.height)
  const paint = pickPaint(r)
  const twoTone = r() < d.twoTone
  const spec: CarSpec = {
    archetype,
    length,
    width: pick(d.width),
    height,
    wheelbase: length * pick(d.wheelbaseF),
    frontOverhang: length * pick(d.frontOverhangF),
    wheelRadius: pick(d.wheelRadius),
    wheelWidth: pick(d.wheelWidth),
    clearance: pick(d.clearance),
    noseHeight: height * pick(d.noseF),
    beltHeight: height * pick(d.beltF),
    hoodLength: length * pick(d.hoodF),
    windscreenRake: pick(d.windscreenRake),
    cabinLength: length * pick(d.cabinF),
    rearRake: pick(d.rearRake),
    tail: d.tail,
    deckHeight: height * pick(d.deckF),
    tumblehome: pick(d.tumblehome),
    sideWindows: Math.round(pick([d.sideWindows[0] - 0.49, d.sideWindows[1] + 0.49])),
    sideGlass: d.sideGlass,
    paint,
    paint2: twoTone ? [...ROOF_BLACK] : [...paint],
    livery: 'none',
    seed,
  }
  if (archetype === 'boxtruck') spec.paint2 = r() < 0.7 ? [0.93, 0.93, 0.92] : pickPaint(r)
  if (archetype === 'bus') spec.paint = r() < 0.5 ? [0.88, 0.2, 0.15] : pickPaint(r)
  if (archetype === 'schoolbus') { spec.paint = [...SCHOOL_YELLOW]; spec.paint2 = [...SCHOOL_YELLOW] }
  return applyLivery(spec, livery)
}

/** Dress a vehicle in a livery: paint, plus the roof furniture and lamps the geometry adds for it. */
export function applyLivery(spec: CarSpec, livery: Livery): CarSpec {
  const s: CarSpec = { ...spec, paint: [...spec.paint], paint2: [...spec.paint2], livery }
  switch (livery) {
    case 'taxi':
      s.paint = [0.97, 0.76, 0.1]
      s.paint2 = [0.97, 0.76, 0.1]
      break
    case 'police':
      s.paint = [0.08, 0.08, 0.1]
      s.paint2 = [0.92, 0.92, 0.92]
      break
    case 'ambulance':
      s.paint = [0.95, 0.95, 0.93]
      s.paint2 = [0.95, 0.95, 0.93]
      break
    case 'delivery':
      s.paint2 = [0.95, 0.6, 0.1]
      break
    case 'transit':
      // San Francisco Muni (owner, 2026-10-05: "always silver-gray with a red stripe at the top of the chassis and another
      // at the bottom"): the body silver-grey, the two red bands in the geometry (body.ts)
      s.paint = [0.7, 0.71, 0.72]
      s.paint2 = [0.7, 0.71, 0.72]
      break
    default:
      break
  }
  return s
}

/** A spec in a named palette colour (and, optionally, a second colour for the roof). */
export function painted(spec: CarSpec, paint: string, roof?: string): CarSpec {
  const find = (n: string): Rgb => [...(PALETTE.find((p) => p.name === n)?.colour ?? spec.paint)] as Rgb
  return { ...spec, paint: find(paint), paint2: roof === 'black' ? [...ROOF_BLACK] : roof ? find(roof) : find(paint) }
}

/** The common combinations a busy city wants, by name, for menus and quick tests. */
export const PRESETS: Record<string, () => CarSpec> = {
  hatchback: () => painted(randomSpec('hatchback', 3), 'yellow', 'black'),
  sedan: () => painted(randomSpec('sedan', 2), 'blue'),
  coupe: () => painted(randomSpec('coupe', 4), 'red', 'black'),
  suv: () => painted(randomSpec('suv', 1), 'orange', 'black'),
  pickup: () => painted(randomSpec('pickup', 2), 'red'),
  minivan: () => painted(randomSpec('minivan', 1), 'silver'),
  van: () => painted(randomSpec('van', 1), 'white'),
  boxtruck: () => randomSpec('boxtruck', 1),
  bus: () => randomSpec('bus', 1),
  taxi: () => randomSpec('sedan', 11, 'taxi'),
  'taxi-minivan': () => randomSpec('minivan', 12, 'taxi'),
  police: () => randomSpec('sedan', 13, 'police'),
  'police-suv': () => randomSpec('suv', 14, 'police'),
  ambulance: () => randomSpec('van', 15, 'ambulance'),
  delivery: () => randomSpec('boxtruck', 16, 'delivery'),
  'city-bus': () => randomSpec('bus', 17, 'transit'),
  'school-bus': () => randomSpec('schoolbus', 1),
}

/**
 * Everything that changes the SHAPE, and nothing that only changes the colour: vehicles with the same key
 * share one mesh, so a fleet of a thousand in forty shapes costs forty draw calls.
 */
export function shapeKey(s: CarSpec): string {
  const n = (x: number): string => x.toFixed(3)
  return [s.archetype, s.tail, s.sideGlass, s.livery === 'none' || s.livery === 'delivery' || s.livery === 'transit' ? 'plain' : s.livery,
    n(s.length), n(s.width), n(s.height), n(s.wheelbase), n(s.frontOverhang), n(s.wheelRadius), n(s.wheelWidth),
    n(s.clearance), n(s.noseHeight), n(s.beltHeight), n(s.hoodLength), n(s.windscreenRake), n(s.cabinLength),
    n(s.rearRake), n(s.deckHeight), n(s.tumblehome), s.sideWindows].join('|')
}

/** Sane bounds on a hand-edited spec: keeps the designer's sliders from tying the body in a knot. */
export function sanitize(spec: CarSpec): CarSpec {
  const s = { ...spec }
  const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x))
  s.length = clamp(s.length, 2.5, 14)
  s.width = clamp(s.width, 1.3, 2.6)
  s.height = clamp(s.height, 1.0, 3.8)
  s.wheelRadius = clamp(s.wheelRadius, 0.22, 0.6)
  s.wheelWidth = clamp(s.wheelWidth, 0.12, 0.4)
  s.wheelbase = clamp(s.wheelbase, s.wheelRadius * 4.2, s.length - s.wheelRadius * 2.6)
  s.frontOverhang = clamp(s.frontOverhang, s.wheelRadius * 1.25, s.length - s.wheelbase - s.wheelRadius * 1.25)
  s.clearance = clamp(s.clearance, 0.08, s.wheelRadius * 0.95)
  s.beltHeight = clamp(s.beltHeight, s.clearance + 0.35, s.height - 0.3)
  s.noseHeight = clamp(s.noseHeight, s.clearance + 0.25, s.beltHeight)
  s.deckHeight = clamp(s.deckHeight, s.clearance + 0.25, s.height - 0.2)
  s.hoodLength = clamp(s.hoodLength, 0.02, s.length * 0.5)
  s.windscreenRake = clamp(s.windscreenRake, 0.05, s.length * 0.3)
  s.cabinLength = clamp(s.cabinLength, 0.1, s.length - s.hoodLength - s.windscreenRake - 0.1)
  s.rearRake = clamp(s.rearRake, 0.02, Math.max(0.03, s.length - s.hoodLength - s.windscreenRake - s.cabinLength - 0.05))
  s.tumblehome = clamp(s.tumblehome, 0, s.width * 0.15)
  s.sideWindows = Math.round(clamp(s.sideWindows, 1, 12))
  return s
}
