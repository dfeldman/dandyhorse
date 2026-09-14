/**
 * Checks a game file against the item catalog: every reference resolves, the map is connected, and every
 * item the challenge requires can actually be obtained (bought, found, won or made). Returns problems; empty means valid.
 * Hand-written files use it through the tests; the generator will use it later.
 */
import { STATS } from './types.ts'
import type { GameFile, ItemCatalog, Quest } from './types.ts'

export function validateCatalog(catalog: ItemCatalog): string[] {
  const errs: string[] = []
  const seen = new Set<string>()
  for (const i of catalog.items) {
    if (seen.has(i.id)) errs.push(`items: duplicate id "${i.id}"`)
    seen.add(i.id)
    if (i.type === 'weapon' && !i.weapon) errs.push(`items: weapon "${i.id}" has no weapon spec`)
    if (i.type === 'potion' && !i.potion) errs.push(`items: potion "${i.id}" has no potion spec`)
    if (i.type === 'clothing' && !i.clothing) errs.push(`items: clothing "${i.id}" has no clothing spec`)
    if (i.potion?.effect === 'stat' && !i.potion.stat) errs.push(`items: stat potion "${i.id}" names no stat`)
    if (i.clothing?.travel && !i.lasts) errs.push(`items: "${i.id}" saves travel Energy, so it must wear out ("lasts")`)
  }
  return errs
}

export function validateGame(game: GameFile, catalog: ItemCatalog): string[] {
  const errs: string[] = []
  const items = new Map(catalog.items.map((i) => [i.id, i]))
  const towns = new Map(game.towns.map((t) => [t.id, t]))
  const enemies = new Map(game.enemies.map((e) => [e.id, e]))
  const hints = new Set(game.hints.map((h) => h.id))
  const routes = new Map(game.routes.map((r) => [r.id, r]))
  const foes = new Map(game.routes.flatMap((r) => (r.fixed ?? []).map((f) => [f.id, { foe: f, route: r }] as const)))
  const quests = new Map<string, Quest>()

  const item = (id: string | undefined, where: string): void => {
    if (!id || !items.has(id)) errs.push(`${where}: unknown item "${id}"`)
  }
  const hint = (id: string | undefined, where: string): void => {
    if (id && !hints.has(id)) errs.push(`${where}: unknown hint "${id}"`)
  }
  const unique = (kind: string, ids: string[]): void => {
    const seen = new Set<string>()
    for (const id of ids) {
      if (seen.has(id)) errs.push(`duplicate ${kind} id "${id}"`)
      seen.add(id)
    }
  }
  unique('town', game.towns.map((t) => t.id))
  unique('route', game.routes.map((r) => r.id))
  unique('enemy', game.enemies.map((e) => e.id))
  unique('hint', game.hints.map((h) => h.id))
  unique('fixed foe', [...game.routes.flatMap((r) => (r.fixed ?? []).map((f) => f.id))])

  for (const t of game.towns) {
    const at = `town ${t.id}`
    hint(t.mayor.hint, `${at} mayor`)
    if (t.mayor.quest) {
      if (quests.has(t.mayor.quest.id)) errs.push(`duplicate quest id "${t.mayor.quest.id}"`)
      quests.set(t.mayor.quest.id, t.mayor.quest)
    }
    for (const s of t.shop.stock) item(s.item, `${at} shop`)
    unique(`npc in ${t.id}`, t.npcs.map((n) => n.id))
    for (const n of t.npcs) {
      hint(n.hint, `${at} npc ${n.id}`)
      if (n.gives) item(n.gives.item, `${at} npc ${n.id} gift`)
      if (n.trade) {
        item(n.trade.wants, `${at} npc ${n.id} trade`)
        item(n.trade.gives, `${at} npc ${n.id} trade`)
      }
      if (n.trains && !STATS.includes(n.trains.stat)) errs.push(`${at} npc ${n.id}: unknown stat "${n.trains.stat}"`)
    }
    unique(`spot in ${t.id}`, t.spots.map((s) => s.id))
    for (const s of t.spots) {
      if (s.item) item(s.item, `${at} spot ${s.id}`)
      if (s.requiresKey) item(s.requiresKey, `${at} spot ${s.id} key`)
      if (!s.item && !s.gold) errs.push(`${at} spot ${s.id}: holds nothing`)
    }
  }

  for (const r of game.routes) {
    const at = `route ${r.id}`
    const a = towns.get(r.a)
    const b = towns.get(r.b)
    if (!a || !b) {
      errs.push(`${at}: unknown town`)
      continue
    }
    if (a === b) errs.push(`${at}: goes nowhere`)
    const d = Math.hypot(a.x - b.x, a.y - b.y)
    if (Math.abs(d - r.distance) > d * 0.03) errs.push(`${at}: distance ${r.distance} but the towns are ${Math.round(d)} apart`)
    for (const e of r.enemies) {
      if (!enemies.has(e)) errs.push(`${at}: unknown enemy "${e}"`)
      else if (enemies.get(e)!.boss) errs.push(`${at}: the boss "${e}" wanders the road`)
    }
    for (const f of r.fixed ?? []) {
      if (!enemies.has(f.enemy)) errs.push(`${at}: unknown foe enemy "${f.enemy}"`)
      if (f.at <= 0 || f.at >= 1) errs.push(`${at}: foe ${f.id} is not on the road`)
    }
    for (const f of r.finds ?? []) item(f.item, `${at} find ${f.id}`)
  }

  for (const q of quests.values()) {
    const at = `quest ${q.id}`
    for (const id of q.reward.items ?? []) item(id, `${at} reward`)
    if (q.type === 'fetch' || q.type === 'deliver') item(q.item, at)
    if (q.type === 'deliver') {
      const to = q.to && towns.get(q.to.town)
      if (!to) errs.push(`${at}: unknown recipient town`)
      else if (q.to?.npc && !to.npcs.some((n) => n.id === q.to!.npc)) errs.push(`${at}: unknown recipient "${q.to.npc}"`)
    }
    if (q.type === 'slay') {
      const f = q.foe && foes.get(q.foe)
      if (!f) errs.push(`${at}: unknown foe "${q.foe}"`)
      else if (f.foe.quest !== q.id) errs.push(`${at}: foe ${q.foe} is not tied to this quest`)
    }
  }
  for (const { foe } of foes.values()) {
    if (foe.quest && quests.get(foe.quest)?.foe !== foe.id) errs.push(`foe ${foe.id}: quest "${foe.quest}" does not send you after it`)
  }

  const recipes = game.recipes ?? []
  unique('recipe', recipes.map((r) => r.item))
  if (recipes.length && !game.towns.some((t) => t.workshop)) errs.push('recipes, but no town has a workshop to make them in')
  for (const r of recipes) {
    const at = `recipe ${r.item}`
    item(r.item, at)
    if (!(r.seconds > 0 && r.seconds <= 1800)) errs.push(`${at}: takes ${r.seconds} seconds`)
    for (const n of r.needs ?? []) {
      item(n.item, `${at} ingredient`)
      if (!Number.isInteger(n.qty) || n.qty < 1) errs.push(`${at}: needs ${n.qty} of "${n.item}"`)
      if (n.item === r.item) errs.push(`${at}: is made from itself`)
    }
  }

  for (const e of game.enemies) {
    for (const d of e.drops ?? []) item(d.item, `enemy ${e.id} drop`)
    if (e.tier < 1 || e.tier > 5) errs.push(`enemy ${e.id}: tier ${e.tier}`)
  }

  const c = game.challenge
  if (!towns.has(game.startTown)) errs.push(`unknown start town "${game.startTown}"`)
  const crisis = towns.get(c.crisisTown)
  if (!crisis) errs.push(`unknown crisis town "${c.crisisTown}"`)
  else if (!crisis.crisis) errs.push(`crisis town ${c.crisisTown} is not marked crisis`)
  const boss = enemies.get(c.boss)
  if (!boss?.boss) errs.push(`challenge boss "${c.boss}" is missing or not a boss`)
  for (const id of c.requires) item(id, 'challenge requires')
  // The boss is balanced around its kit (DESIGN.md §7): its HP assumes the one required weapon, and it hits
  // twice as hard unless required armor resists its attack.
  const kit = c.requires.map((id) => items.get(id)).filter((i) => i !== undefined)
  const weapons = kit.filter((i) => i.weapon)
  if (weapons.length !== 1) errs.push(`challenge: needs exactly one required weapon, has ${weapons.length}`)
  if (boss?.boss) {
    if (!boss.attack) errs.push(`boss ${boss.id}: has no attack element, so no armor can resist it`)
    else if (!kit.some((i) => i.clothing?.resist?.includes(boss.attack!))) errs.push(`challenge: no required armor resists ${boss.id}'s ${boss.attack}`)
    const w = weapons[0]?.weapon
    if (w && w.element !== boss.weakness && !w.bane?.includes(boss.family)) errs.push(`challenge: the required weapon neither hits ${boss.id}'s weakness nor is its bane`)
  }
  for (const s of c.sources) {
    if (!c.requires.includes(s.item)) errs.push(`challenge source for "${s.item}", which is not required`)
    if (!towns.has(s.town)) errs.push(`challenge source ${s.item}: unknown town "${s.town}"`)
    if (s.how === 'craft' && !recipes.some((r) => r.item === s.item)) errs.push(`challenge source ${s.item}: no recipe makes it`)
  }
  for (const h of game.hints) hint(h.id, 'hints')

  // Every town reachable from the start.
  const reach = new Set([game.startTown])
  for (let grew = true; grew;) {
    grew = false
    for (const r of routes.values()) {
      if (reach.has(r.a) !== reach.has(r.b)) {
        reach.add(r.a)
        reach.add(r.b)
        grew = true
      }
    }
  }
  for (const t of towns.keys()) if (!reach.has(t)) errs.push(`town ${t} cannot be reached`)

  // What can be had, following keys, trades, quests and recipes (random drops don't count), and how many of each
  // at most: a shop that never runs out, or pedaling alone, makes any number.
  const have = new Set<string>()
  const copies = new Map<string, number>()
  const add = (id: string, n = 1): void => void copies.set(id, (copies.get(id) ?? 0) + n)
  for (const t of game.towns) {
    for (const s of t.shop.stock) {
      have.add(s.item)
      add(s.item, s.qty ?? Infinity)
    }
    for (const n of t.npcs) {
      if (n.gives) have.add(n.gives.item)
      for (const id of [n.gives?.item, n.trade?.gives]) if (id) add(id)
    }
    for (const s of t.spots) if (s.item) add(s.item)
  }
  for (const r of game.routes) {
    for (const f of r.finds ?? []) {
      have.add(f.item)
      add(f.item)
    }
  }
  for (const q of quests.values()) for (const id of q.reward.items ?? []) add(id)
  const enough = (n: { item: string; qty: number }): boolean => have.has(n.item) && (copies.get(n.item) ?? 0) >= n.qty
  for (let grew = true; grew;) {
    const before = have.size
    for (const t of game.towns) {
      for (const s of t.spots) if (s.item && (!s.requiresKey || have.has(s.requiresKey))) have.add(s.item)
      for (const n of t.npcs) if (n.trade && have.has(n.trade.wants)) have.add(n.trade.gives)
    }
    for (const q of quests.values()) {
      if (q.type !== 'fetch' || have.has(q.item!)) for (const id of q.reward.items ?? []) have.add(id)
    }
    for (const r of recipes) {
      const needs = r.needs ?? []
      if (!needs.every(enough)) continue
      have.add(r.item)
      if (needs.every((n) => copies.get(n.item) === Infinity)) copies.set(r.item, Infinity)
      else if (!copies.has(r.item)) copies.set(r.item, 1)
    }
    grew = have.size > before
  }
  for (const id of c.requires) if (!have.has(id)) errs.push(`required item "${id}" cannot be obtained`)

  return errs
}
