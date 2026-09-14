/** The item catalog and every game file, read from public/data, for tests and command-line tools (Node only). */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { GameFile, GameIndex, ItemCatalog } from '../src/content/types.ts'
import { Engine } from '../src/engine/engine.ts'
import type { EngineHost } from '../src/engine/engine.ts'
import { HERO_CLASSES, newSave } from '../src/engine/save.ts'
import type { HeroClass, SaveState } from '../src/engine/save.ts'
import { solve } from '../src/sim/solver.ts'
import type { SolveResult } from '../src/sim/solver.ts'

export const dataPath = (path: string): string => fileURLToPath(new URL(`../public/data/${path}`, import.meta.url))
const data = <T>(path: string): T => JSON.parse(readFileSync(dataPath(path), 'utf8')) as T

export const catalog = data<ItemCatalog>('items.json')
export const index = data<GameIndex>('games/index.json')
export const games = new Map<string, GameFile>(index.games.map((g) => [g.id, data<GameFile>(`games/${g.id}.json`)]))
export const host: EngineHost = { catalog, index, game: (id) => games.get(id) }

/** A level should take a steady player this long, in minutes: long enough to matter, short enough for a week. */
export const BAND = [60, 150]

/** An engine on the title screen of `gameId` (the first game by default) with a hero rolled from `seed`. */
export function newEngine(seed = 42, save?: SaveState, gameId = index.games[0].id): Engine {
  return new Engine(host, save ?? newSave(gameId, seed), { seedSource: () => seed })
}

/** An engine on the title screen of any game file, even one not in the index yet (fresh from the generator). */
export function engineFor(game: GameFile, seed: number): Engine {
  const alone: EngineHost = {
    catalog,
    index: { games: [{ id: game.id, title: game.title, threat: game.challenge.threat }] },
    game: (id) => (id === game.id ? game : undefined),
  }
  return new Engine(alone, newSave(game.id, seed), { seedSource: () => seed })
}

export interface Playtest {
  runs: { seed: number; cls: HeroClass; r: SolveResult }[]
  won: number
  /** Minutes of each winning run, shortest first. */
  minutes: number[]
  median: number
  lost: number
  fights: number
}

/** The solver bot plays a game with every class on three seeds, pedaling steadily. */
export function playtest(game: GameFile): Playtest {
  const runs = [11, 22, 33].flatMap((seed) => HERO_CLASSES.map((cls) => ({ seed, cls, r: solve(engineFor(game, seed), { cls }) })))
  const minutes = runs.filter((x) => x.r.ok).map((x) => x.r.minutes).sort((a, b) => a - b)
  return {
    runs,
    won: minutes.length,
    minutes,
    median: minutes.length ? minutes[Math.floor(minutes.length / 2)] : NaN,
    lost: runs.reduce((n, x) => n + x.r.battlesLost, 0),
    fights: runs.reduce((n, x) => n + x.r.battlesWon + x.r.battlesLost, 0),
  }
}

/** Write the game index back, one game per line. */
export function writeIndex(i: GameIndex): void {
  const line = (g: object): string => JSON.stringify(g).replace(/^\{/, '{ ').replace(/\}$/, ' }').replace(/":/g, '": ').replace(/,"/g, ', "')
  writeFileSync(dataPath('games/index.json'), `{\n  "games": [\n    ${i.games.map(line).join(',\n    ')}\n  ]\n}\n`)
}
