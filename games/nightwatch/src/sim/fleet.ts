/** The kinds of ship that come in, and their names. Shared by the schedule, the HUD and the ship models. */
import type { Rng } from '../rng.ts'

export type HullKind = 'packet' | 'skiff' | 'trawler' | 'schooner' | 'steamer' | 'freighter' | 'liner'

export interface ShipKind {
  kind: HullKind
  label: string
  emoji: string
  /** Hull length (m), for the model and the camera. */
  length: number
  /** Watch lengths (s) this kind is picked for. */
  watch: [number, number]
  names: string[]
}

export const FLEET: Record<HullKind, ShipKind> = {
  packet: {
    kind: 'packet', label: 'Mail packet', emoji: '🚤', length: 16, watch: [0, 62],
    names: ['Swift Letter', 'Postie', 'Quicksilver', 'Dispatch', 'Speedy Stamp'],
  },
  skiff: {
    kind: 'skiff', label: 'Fishing skiff', emoji: '🛶', length: 9, watch: [0, 80],
    names: ['Little Tern', 'Dabchick', 'Pickle', 'Minnow', 'Cockle', 'Sprat'],
  },
  trawler: {
    kind: 'trawler', label: 'Trawler', emoji: '🛥️', length: 20, watch: [55, 105],
    names: ['Salty Sally', 'Herring Queen', 'Brave Cod', 'Old Barnacle', 'Plucky Puffin', 'Mackerel Sky'],
  },
  schooner: {
    kind: 'schooner', label: 'Schooner', emoji: '⛵', length: 28, watch: [75, 125],
    names: ['Marigold', 'Kittiwake', 'Wandering Albatross', 'Bluebell', 'Sea Lark', 'Honeysuckle'],
  },
  steamer: {
    kind: 'steamer', label: 'Paddle steamer', emoji: '⛴️', length: 32, watch: [85, 135],
    names: ['Aurora', 'Morning Glory', 'Stormy Petrel', 'Puffing Billy', 'Belle of the Bay'],
  },
  freighter: {
    kind: 'freighter', label: 'Freighter', emoji: '🚢', length: 46, watch: [95, 150],
    names: ['Iron Walrus', 'Northern Star', 'Heavy Heron', 'Big Biscuit', 'Stout Otter'],
  },
  liner: {
    kind: 'liner', label: 'Ocean liner', emoji: '🛳️', length: 64, watch: [120, 999],
    names: ['Grand Duchess', 'RMS Celestia', 'Queen of the Tides', 'SS Magnificent'],
  },
}

const ORDER: HullKind[] = ['packet', 'skiff', 'trawler', 'schooner', 'steamer', 'freighter']

/** A kind that suits a watch this long (the liner is kept for the big one), unlike the last kind if possible. */
export function kindForWatch(watch: number, rng: Rng, last: HullKind | null): HullKind {
  const fits = ORDER.filter((k) => watch >= FLEET[k].watch[0] && watch <= FLEET[k].watch[1])
  const fresh = fits.filter((k) => k !== last)
  const pool = fresh.length ? fresh : fits.length ? fits : ['freighter' as HullKind]
  return rng.pick(pool)
}

/** Names that aren't used yet tonight. */
export function nameFor(kind: HullKind, rng: Rng, used: Set<string>): string {
  const free = FLEET[kind].names.filter((n) => !used.has(n))
  let name = free.length ? rng.pick(free) : `${rng.pick(FLEET[kind].names)} II`
  while (used.has(name)) name += ' II'
  used.add(name)
  return name
}
