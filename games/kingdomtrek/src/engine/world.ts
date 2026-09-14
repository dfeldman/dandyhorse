import type {
  EnemyDef, FixedFoe, GameFile, Hint, ItemCatalog, ItemDef, Npc, Quest, Route, Town,
} from '../content/types.ts'

/** A game file plus the item catalog, indexed by id. Read-only. */
export class World {
  readonly game: GameFile
  readonly items = new Map<string, ItemDef>()
  readonly towns = new Map<string, Town>()
  readonly routes = new Map<string, Route>()
  readonly enemies = new Map<string, EnemyDef>()
  readonly hints = new Map<string, Hint>()
  readonly quests = new Map<string, { quest: Quest; town: Town }>()
  readonly foes = new Map<string, { foe: FixedFoe; route: Route }>()

  constructor(game: GameFile, catalog: ItemCatalog) {
    this.game = game
    for (const i of catalog.items) this.items.set(i.id, i)
    for (const t of game.towns) {
      this.towns.set(t.id, t)
      if (t.mayor.quest) this.quests.set(t.mayor.quest.id, { quest: t.mayor.quest, town: t })
    }
    for (const r of game.routes) {
      this.routes.set(r.id, r)
      for (const f of r.fixed ?? []) this.foes.set(f.id, { foe: f, route: r })
    }
    for (const e of game.enemies) this.enemies.set(e.id, e)
    for (const h of game.hints) this.hints.set(h.id, h)
  }

  item(id: string): ItemDef {
    const i = this.items.get(id)
    if (!i) throw new Error(`Unknown item "${id}"`)
    return i
  }

  town(id: string): Town {
    const t = this.towns.get(id)
    if (!t) throw new Error(`Unknown town "${id}"`)
    return t
  }

  route(id: string): Route {
    const r = this.routes.get(id)
    if (!r) throw new Error(`Unknown route "${id}"`)
    return r
  }

  enemy(id: string): EnemyDef {
    const e = this.enemies.get(id)
    if (!e) throw new Error(`Unknown enemy "${id}"`)
    return e
  }

  npc(townId: string, npcId: string): Npc {
    const n = this.town(townId).npcs.find((x) => x.id === npcId)
    if (!n) throw new Error(`Unknown npc "${npcId}" in ${townId}`)
    return n
  }

  /** Roads out of a town, nearest first. */
  routesFrom(townId: string): { route: Route; to: Town }[] {
    return this.game.routes
      .filter((r) => r.a === townId || r.b === townId)
      .map((route) => ({ route, to: this.town(route.a === townId ? route.b : route.a) }))
      .sort((p, q) => p.route.distance - q.route.distance)
  }
}
