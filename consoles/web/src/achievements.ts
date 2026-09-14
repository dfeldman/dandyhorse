// Achievements: what they are called, and how the Achievements page lays them out (pure, unit-tested).
// Stored keys are "platform:<id>", the server's own (sessions/lifecycle.py _platform_achievements), and
// "<gameId>:<id>", ids a game sends with setstate. A game names its ids in metadata.json "achievements"; any
// other id is spelled out from itself ("level-5" → "Level 5").
import type { Achievement, Game } from './types'

export interface AchievementInfo {
  name: string
  description?: string
}

/** The platform's own, in the order people reach them. */
export const PLATFORM: Record<string, AchievementInfo> = {
  first_session: { name: 'First ride', description: 'Finished a session.' },
  sessions_10: { name: 'Ten rides', description: 'Finished 10 sessions.' },
  sessions_100: { name: 'A hundred rides', description: 'Finished 100 sessions.' },
  longest_session_1h: { name: 'The hour', description: 'A session of an hour or more.' },
  total_distance_100km: { name: '100 km', description: '100 km over all your sessions.' },
  total_distance_1000km: { name: '1,000 km', description: '1,000 km over all your sessions.' },
  every_device_type: { name: 'Both machines', description: 'Sessions on a treadmill and on a bike.' },
}

export interface Item {
  key: string
  name: string
  description: string | null
  earned: Achievement | null
}

export interface Group {
  id: string
  title: string
  items: Item[]
  earned: number
}

/** "level-5" → "Level 5", "first_lap" → "First lap": for ids a game did not name. */
export function humanize(id: string): string {
  const words = id.replace(/[_-]+/g, ' ').trim()
  return words ? words[0]!.toUpperCase() + words.slice(1) : id
}

function split(key: string): [string, string] {
  const i = key.indexOf(':')
  return i < 0 ? ['', key] : [key.slice(0, i), key.slice(i + 1)]
}

/** The name of a stored key: "bikeplane:turbo" → "Turbo!". */
export function label(key: string, games: Game[]): string {
  const [owner, id] = split(key)
  if (owner === 'platform') return PLATFORM[id]?.name ?? humanize(id)
  return games.find((g) => g.id === owner)?.achievements?.[id]?.name ?? humanize(id)
}

/**
 * The page. First the platform's, every one, earned or not; then each game, in the catalog's order, with the
 * ones it names (earned or not) and any others it has given; last, keys of games no longer installed. A game
 * with nothing named and nothing earned has no group.
 */
export function groups(earned: Record<string, Achievement>, games: Game[]): Group[] {
  const out: Group[] = []
  const used = new Set<string>()
  const item = (key: string, info?: AchievementInfo): Item => {
    used.add(key)
    return { key, name: info?.name ?? humanize(split(key)[1]), description: info?.description ?? null, earned: earned[key] ?? null }
  }
  const unnamed = (owner: string): Item[] => Object.keys(earned)
    .filter((k) => !used.has(k) && split(k)[0] === owner)
    .sort((a, b) => earned[a]!.t.localeCompare(earned[b]!.t))
    .map((k) => item(k))
  const add = (id: string, title: string, items: Item[]): void => {
    if (items.length) out.push({ id, title, items, earned: items.filter((i) => i.earned).length })
  }

  add('platform', 'Dandyhorse', [...Object.entries(PLATFORM).map(([id, info]) => item(`platform:${id}`, info)), ...unnamed('platform')])
  for (const g of games) {
    add(g.id, g.name, [...Object.entries(g.achievements ?? {}).map(([id, info]) => item(`${g.id}:${id}`, info)), ...unnamed(g.id)])
  }
  const gone = [...new Set(Object.keys(earned).filter((k) => !used.has(k)).map((k) => split(k)[0]))]
  for (const owner of gone) add(owner, humanize(owner), unnamed(owner))
  return out
}
