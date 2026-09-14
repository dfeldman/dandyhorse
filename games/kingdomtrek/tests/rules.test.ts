import { describe, expect, it } from 'vitest'
import { CONFIG, typical } from '../src/config.ts'
import { STATS } from '../src/content/types.ts'
import { createBattle, enemyStats } from '../src/engine/battle.ts'
import type { BattleHero } from '../src/engine/battle.ts'
import { Rng } from '../src/engine/rng.ts'
import type { BattleMode } from '../src/engine/modes/battle.ts'
import type { FarewellMode } from '../src/engine/modes/menu.ts'
import type { TravelMode } from '../src/engine/modes/travel.ts'
import * as R from '../src/engine/rules.ts'
import { newSave, parseSave, resetAdventure } from '../src/engine/save.ts'
import type { TravelWhere } from '../src/engine/save.ts'
import { Bot } from './bot.ts'
import { games, newEngine } from './helpers.ts'

const game = games.get('game-0000')!

/** An engine standing in Oakvale, past the title and the throne room. */
function inOakvale(seed = 1) {
  const e = newEngine(seed)
  const bot = new Bot(e)
  bot.start('knight')
  return { e, bot }
}

describe('new hero', () => {
  it('rolls each stat 3–7 with a total of 18–22', () => {
    for (let seed = 1; seed < 200; seed++) {
      const s = newSave('game-0000', seed).stats
      const vals = Object.values(s)
      expect(Math.min(...vals)).toBeGreaterThanOrEqual(3)
      expect(Math.max(...vals)).toBeLessThanOrEqual(7)
      const total = vals.reduce((a, b) => a + b, 0)
      expect(total).toBeGreaterThanOrEqual(18)
      expect(total).toBeLessThanOrEqual(22)
    }
  })

  it('stats grow with use', () => {
    const s = newSave('game-0000', 3)
    s.stats.strength = 5
    expect(R.addXp(s, 'strength', 7)).toBe(0)
    expect(R.addXp(s, 'strength', 1)).toBe(1)
    expect(s.stats.strength).toBe(6)
    expect(s.statXp.strength).toBe(0)
  })

  it('a save survives a JSON round trip', () => {
    const { e } = inOakvale()
    const blob = JSON.stringify(e.snapshot())
    const back = parseSave(blob)
    expect(back.where).toEqual({ kind: 'town', town: 'oakvale' })
    expect(back.inventory).toEqual(e.save.inventory)
    expect(() => parseSave('{"hello":1}')).toThrow()
  })
})

describe('crafting', () => {
  it('pedaling makes a Healing Draught a minute, sooner when you push, and banks no Energy meanwhile', () => {
    const { e, bot } = inOakvale()
    const have = R.count(e.save, 'healing_draught')
    const energy = e.save.energy
    bot.pick('craft')
    bot.pick('make:healing_draught')
    e.step(60, 1)
    expect(R.count(e.save, 'healing_draught')).toBe(have + 1)
    e.step(30, 2)
    expect(R.count(e.save, 'healing_draught')).toBe(have + 2)
    e.step(60, 0)
    expect(R.count(e.save, 'healing_draught')).toBe(have + 2)
    expect(e.save.energy).toBe(energy)
    expect(e.save.totals.itemsCrafted).toBe(2)
    bot.pick('stop')
    bot.pick('leave')
    expect(e.top.kind).toBe('town')
  })

  it('a recipe with ingredients uses them up, and stops when there are not enough for another', () => {
    const { e, bot } = inOakvale()
    e.give('healing_draught', 3, true)
    const draughts = R.count(e.save, 'healing_draught')
    const greater = R.count(e.save, 'greater_healing')
    bot.pick('craft')
    expect(bot.has('make:fur_cloak')).toBe(false)
    bot.pick('make:greater_healing')
    e.step(45 * 5, 1)
    expect(R.count(e.save, 'greater_healing')).toBe(greater + Math.floor(draughts / 2))
    expect(R.count(e.save, 'healing_draught')).toBe(draughts % 2)
    expect(bot.has('stop')).toBe(false)
  })
})

describe('energy and travel', () => {
  it('travel gear wears out, so the roads never get cheaper for good', () => {
    const { e, bot } = inOakvale()
    const cloak = e.world.item('travelers_cloak')
    e.give(cloak.id, 1, true)
    bot.travelTo('millbrook')
    expect(R.tripsLeft(e.save, cloak)).toBe(cloak.lasts! - 1)
    for (let i = 1; i < cloak.lasts!; i++) e.wearTravelGear()
    expect(R.count(e.save, cloak.id)).toBe(0)
    expect(e.save.wear[cloak.id]).toBeUndefined()
  })

  it('banks one Energy per second at steady pace in town', () => {
    const { e } = inOakvale()
    const before = e.save.energy
    e.step(60, 1)
    expect(e.save.energy).toBeCloseTo(before + 60, 5)
  })

  it('walks at the pace you pedal once the bank is empty, faster while it lasts', () => {
    const time = (bank: number): number => {
      const { e, bot } = inOakvale()
      e.save.energy = bank
      bot.pick('gate')
      bot.pick('travel:r_oak_mill')
      const trip = e.save.where as TravelWhere
      trip.plan = []
      const t0 = e.save.totals.playSeconds
      bot.run(() => bot.town === 'millbrook')
      return { seconds: e.save.totals.playSeconds - t0, cost: trip.cost }.seconds
    }
    const cost = Math.round(200 * CONFIG.energyPerUnit)
    expect(time(0)).toBeCloseTo(cost, -1)
    expect(time(300)).toBeLessThan(cost - 150)
  })

  it('banked Energy is a boost on top of pedaling, at any pace', () => {
    for (const effort of [1, 3, 10]) {
      const { e, bot } = inOakvale()
      e.save.energy = 100
      bot.pick('gate')
      bot.pick('travel:r_oak_mill')
      ;(e.save.where as TravelWhere).plan = []
      const m = e.base as TravelMode
      e.step(1, effort)
      expect(m.boosting).toBe(true)
      expect(e.save.energy).toBeCloseTo(100 - CONFIG.boostExtra, 5)
      expect(m.rate).toBeCloseTo(effort + CONFIG.boostExtra, 5)
    }
  })

  it('eta matches the boost-then-walk rule', () => {
    expect(R.etaSeconds(440, 0, 1)).toBeCloseTo(440)
    expect(R.etaSeconds(300, 1000, 1)).toBeCloseTo(100)
    expect(R.etaSeconds(440, 100, 1)).toBeCloseTo(50 + (440 - 150))
  })

  it('a reload mid-road resumes the trip', () => {
    const { e, bot } = inOakvale()
    bot.pick('gate')
    bot.pick('travel:r_oak_mill')
    ;(e.save.where as TravelWhere).plan = []
    e.step(120, 1)
    const blob = JSON.parse(JSON.stringify(e.snapshot()))
    const e2 = newEngine(1, parseSave(blob))
    expect(e2.base.kind).toBe('travel')
    expect((e2.save.where as TravelWhere).pos).toBeCloseTo((e.save.where as TravelWhere).pos)
  })
})

describe('battle', () => {
  it('enemies are calibrated so a typical hero needs the tier time at any level', () => {
    for (const level of [1, 5, 20]) {
      const { maxHp } = enemyStats(game.enemies.find((x) => x.tier === 2)!, level)
      expect(maxHp / typical.dps(level)).toBeCloseTo(CONFIG.battle.tierSeconds[2], 0)
    }
  })

  const fightWolf = (effort: number): { outcome: string | null; seconds: number } => {
    const { e } = inOakvale()
    e.startEncounter({ at: 0.5, enemy: 'wolf' })
    const m = e.top as BattleMode
    let t = 0
    while (!m.battle.outcome && t < 600) {
      e.step(0.5, effort)
      t += 0.5
    }
    return { outcome: m.battle.outcome, seconds: t }
  }

  it('pedaling wins; stopping loses', () => {
    expect(fightWolf(1).outcome).toBe('won')
    expect(fightWolf(0).outcome).toBe('lost')
  })

  it('pedaling harder wins faster', () => {
    expect(fightWolf(2).seconds).toBeLessThan(fightWolf(1).seconds * 0.7)
  })

  it('losing costs a little gold, banked Energy and one spare potion or treasure; fleeing a small toll', () => {
    const { e } = inOakvale()
    e.save.gold = 100
    e.save.energy = 50
    e.give('pearl', 1, true)
    e.give('frostbrand', 1, true)
    const spare = (): number => R.count(e.save, 'pearl') + R.count(e.save, 'healing_draught')
    const before = spare()
    e.startEncounter({ at: 0.5, enemy: 'wolf' })
    const lost = e.top as BattleMode
    for (let t = 0; !lost.battle.outcome && t < 600; t += 0.5) e.step(0.5, 0)
    expect(lost.battle.outcome).toBe('lost')
    expect(e.save.gold).toBe(80)
    expect(e.save.energy).toBe(40)
    expect(spare()).toBe(before - 1)
    expect(R.count(e.save, 'frostbrand')).toBe(1)
    e.endBattle(lost)

    e.save.gold = 100
    e.startEncounter({ at: 0.5, enemy: 'wolf' })
    e.step(CONFIG.battle.introSeconds + 0.1, 1)
    expect(e.choose('flee')).toBe(true)
    expect(e.save.gold).toBe(95)
  })

  it('a lost fight never takes anything the game still needs', () => {
    const { e } = inOakvale()
    // Only a Frost Flask, which Mirewater's mayor will ask for, and honey, which a hermit trades for.
    for (const id of Object.keys(e.save.inventory)) if (e.world.item(id).type !== 'weapon') delete e.save.inventory[id]
    e.give('frost_flask', 1, true)
    e.give('jar_of_honey', 1, true)
    e.startEncounter({ at: 0.5, enemy: 'wolf' })
    const m = e.top as BattleMode
    for (let t = 0; !m.battle.outcome && t < 600; t += 0.5) e.step(0.5, 0)
    expect(m.battle.outcome).toBe('lost')
    expect(R.count(e.save, 'frost_flask')).toBe(1)
    expect(R.count(e.save, 'jar_of_honey')).toBe(1)
  })

  it('winning sometimes turns up a prize, even from an enemy with no drops of its own', () => {
    const { e } = inOakvale()
    const prizes = CONFIG.battle.prizes.map((p) => p.item)
    const held = (): number => prizes.reduce((n, id) => n + R.count(e.save, id), 0)
    let won = 0
    let got = 0
    for (let i = 0; i < 20; i++) {
      const before = held()
      e.startEncounter({ at: 0.5, enemy: 'boar' })
      const m = e.top as BattleMode
      for (let t = 0; !m.battle.outcome && t < 600; t += 0.5) e.step(0.5, 1.5)
      if (m.battle.outcome === 'won') won++
      if (held() > before) got++
      e.endBattle(m)
    }
    expect(won).toBe(20)
    expect(got).toBeGreaterThan(0)
    expect(got).toBeLessThan(20)
  })

  it('a hero with only what the game guarantees wins at steady pace, at any level', () => {
    // No shopping and no growth from play: typical stats plus the level-up bonuses, and the Queen's gifts.
    for (let level = 1; level <= 15; level++) {
      const e = newEngine(level)
      const bot = new Bot(e)
      e.save.level = level
      bot.pick(bot.has('begin') ? 'begin' : 'continue')
      if (e.top.kind === 'creator') bot.create('knight')
      for (const k of STATS) e.save.stats[k] = 5 + (level - 1)
      bot.settle()
      bot.pick('setout')
      e.startEncounter({ at: 0.5, enemy: 'wolf' })
      const m = e.top as BattleMode
      let t = 0
      while (!m.battle.outcome && t < 600) {
        e.step(0.5, 1)
        t += 0.5
      }
      expect(m.battle.outcome, `level ${level}`).toBe('won')
      expect(t, `level ${level}`).toBeLessThan(CONFIG.battle.tierSeconds[1] * 2)
    }
  })
})

describe('contests', () => {
  const contest = (style: 'tug' | 'race', effort: number, seed = 1): { outcome: string | null; seconds: number } => {
    const e = newEngine(seed)
    const enemy = { ...e.world.enemy('wolf'), battle: style }
    const weapon = { ...e.world.item('iron_sword'), weapon: { power: typical.power(1) } }
    const hero: BattleHero = { hp: 60, maxHp: 60, strength: typical.strength(1), luck: 0, potency: 1, weapon, gear: R.gear(e.save, e.world) }
    const b = createBattle(enemy, 1, hero, new Rng(seed), () => {})
    let t = 0
    while (!b.outcome && t < 600) {
      b.step(0.1, effort)
      t += 0.1
    }
    return { outcome: b.outcome, seconds: t }
  }

  for (const style of ['tug', 'race'] as const) {
    it(`${style}: a typical hero at a steady pace wins in about the tier's time; stopping loses; harder is faster`, () => {
      const T = CONFIG.battle.tierSeconds[1]
      for (const seed of [1, 2, 3]) {
        const r = contest(style, 1, seed)
        expect(r.outcome, `seed ${seed}`).toBe('won')
        expect(r.seconds, `seed ${seed}`).toBeGreaterThan(T * 0.7)
        expect(r.seconds, `seed ${seed}`).toBeLessThan(T * 1.4)
      }
      expect(contest(style, 0).outcome).toBe('lost')
      expect(contest(style, 2).seconds).toBeLessThan(contest(style, 1).seconds * 0.7)
    })
  }

  it('bosses always fight for hit points', () => {
    const e = newEngine(1)
    const hero: BattleHero = { hp: 60, maxHp: 60, strength: 5, luck: 0, potency: 1, weapon: null, gear: R.gear(e.save, e.world) }
    expect(createBattle({ ...e.world.enemy('cindermaw'), battle: 'tug' }, 1, hero, new Rng(1), () => {}).style).toBe('hp')
  })
})

describe('quests', () => {
  it('a delivery to a mayor pays when handed over', () => {
    const { e, bot } = inOakvale()
    const gold = e.save.gold
    bot.mayor('accept')
    expect(R.count(e.save, 'sealed_letter')).toBe(1)
    e.arrive('saltmere')
    bot.enter('mayor')
    bot.pick('deliver')
    bot.settle()
    expect(e.save.quests.q_oakvale).toBe('done')
    expect(R.count(e.save, 'sealed_letter')).toBe(0)
    expect(e.save.gold).toBe(gold + 60)
  })

  it('a fetch quest takes the item back and gives the reward', () => {
    const { e, bot } = inOakvale()
    e.arrive('thornwood')
    bot.search('hollow_oak')
    e.arrive('millbrook')
    bot.enter('mayor')
    bot.pick('accept')
    bot.settle()
    bot.pick('handin')
    bot.settle()
    expect(e.save.quests.q_millbrook).toBe('done')
    expect(R.count(e.save, 'silver_bell')).toBe(0)
    expect(R.count(e.save, 'boots_of_striding')).toBe(1)
  })

  it('a delivery to a townsperson pays when handed over', () => {
    const { e, bot } = inOakvale()
    e.arrive('frostford')
    e.acceptQuest(e.world.quests.get('q_highcrag')!.quest)
    bot.enter('npc:greta')
    bot.pick('deliver')
    bot.settle()
    expect(e.save.quests.q_highcrag).toBe('done')
    expect(R.count(e.save, 'ore_sample')).toBe(0)
    expect(R.count(e.save, 'potion_of_might')).toBe(2)
  })
})

describe('session', () => {
  it('Back in a town or on the road opens the menu; Resume closes it', () => {
    const { e, bot } = inOakvale()
    expect(e.back()).toBe(true)
    expect(e.top.kind).toBe('menu')
    expect(e.back()).toBe(true)
    expect(e.top.kind).toBe('town')
    bot.pick('gate')
    bot.pick('travel:r_oak_mill')
    expect(e.back()).toBe(true)
    expect(e.top.kind).toBe('menu')
  })

  it('the pause menu offers Resume and End session, and stops the clock and the Energy', () => {
    const { e, bot } = inOakvale()
    bot.pick('menu')
    expect(bot.ids()).toEqual(['resume', 'end'])
    const played = e.save.totals.playSeconds
    const energy = e.save.energy
    e.step(60, 1)
    expect(e.save.totals.playSeconds).toBe(played)
    expect(e.save.energy).toBe(energy)
    bot.pick('resume')
    expect(e.top.kind).toBe('town')
  })

  it('counts play time per adventure, for the journal', () => {
    const { e } = inOakvale()
    e.step(90, 1)
    expect(e.save.adventureSeconds).toBeCloseTo(90, 5)
    resetAdventure(e.save, 'game-0000')
    expect(e.save.adventureSeconds).toBe(0)
  })

  it('ending a session sums it up, saves, and tells the host; no time passes on the farewell', () => {
    const { e, bot } = inOakvale()
    e.step(600, 1)
    bot.pick('menu')
    bot.pick('end')
    expect(e.top.kind).toBe('farewell')
    expect((e.top as FarewellMode).lines.map((l) => l.text).join(' ')).toContain('10 minutes and earned 600 Energy')
    const played = e.save.totals.playSeconds
    bot.settle()
    e.drain()
    bot.pick('exit')
    const events = e.drain().map((ev) => ev.type)
    expect(events).toContain('checkpoint')
    expect(events).toContain('exit')
    e.step(60, 1)
    expect(e.save.totals.playSeconds).toBe(played)
    bot.pick('resume')
    expect(e.top.kind).toBe('town')
  })
})

describe('the hero', () => {
  it('a new hero is made in the character creator: the class nudges stats and gives a kit', () => {
    const e = newEngine(5)
    const before = { ...e.save.stats }
    const bot = new Bot(e)
    bot.pick('begin')
    expect(e.top.kind).toBe('creator')
    e.step(60, 1)
    expect(e.save.totals.playSeconds).toBe(0)
    bot.create('mage')
    expect(e.top.kind).toBe('intro')
    expect(e.save.heroClass).toBe('mage')
    expect(e.save.heroName).toBe(CONFIG.classes.mage.names[0])
    for (const k of STATS) expect(e.save.stats[k], k).toBe(Math.max(1, before[k] + CONFIG.classes.mage.stats[k]))
    for (const id of CONFIG.classes.mage.items) expect(R.count(e.save, id), id).toBeGreaterThan(0)
  })

  it('hair length comes after the colour, and is skipped for a bald hero', () => {
    const e = newEngine(7)
    const bot = new Bot(e)
    bot.pick('begin')
    for (const id of ['class:knight', `name:${CONFIG.classes.knight.names[0]}`, 'body:slim', 'skin:medium', 'outfit:red', 'hair:none']) bot.pick(id)
    expect(bot.has('done')).toBe(true)
    bot.pick('back')
    bot.pick('hair:black')
    bot.pick('hairLength:long')
    bot.pick('done')
    expect(e.save.look).toMatchObject({ hair: 'black', hairLength: 'long' })
  })

  it('a ranger starts with a bow in hand', () => {
    const e = newEngine(6)
    new Bot(e).start('ranger')
    expect(e.save.weapon).toBe('hunting_bow')
  })

  it('the wizard changes your look for gold, but not who you are', () => {
    const { e, bot } = inOakvale()
    e.arrive('thornwood')
    e.save.gold = 100
    const stats = { ...e.save.stats }
    bot.enter('npc:zephyr')
    bot.pick('restyle')
    expect(e.top.kind).toBe('creator')
    bot.pick('body:tall')
    bot.pick('skin:dark')
    bot.pick('outfit:purple')
    bot.pick('hair:white')
    bot.pick('hairLength:long')
    bot.pick('done')
    expect(e.save.look).toEqual({ body: 'tall', skin: 'dark', outfit: 'purple', hair: 'white', hairLength: 'long' })
    expect(e.save.gold).toBe(40)
    expect(e.save.stats).toEqual(stats)
    expect(e.save.heroClass).toBe('knight')
    expect(e.top.kind).toBe('npc')
  })
})

describe('shops', () => {
  it('buys at value and sells back at about half', () => {
    const { e, bot } = inOakvale()
    const gold = e.save.gold
    bot.buy('healing_draught')
    expect(e.save.gold).toBe(gold - 15)
    e.give('pearl', 1, true)
    bot.sellTreasure()
    expect(e.save.gold).toBe(gold - 15 + R.sellPrice(e.world.item('pearl'), e.save))
  })

  it('never buys plot items', () => {
    const { e } = inOakvale()
    e.give('tidestone', 1, true)
    expect(R.canSell(e.world.item('tidestone'), e.save, e.world)).toBe(false)
    expect(e.sell('tidestone')).toBe(false)
  })
})
