import { describe, expect, it } from 'vitest'
import type { InputAnswer } from '@dandyhorse/gamekit'
import { MenuMirror, PROMPT_ID, phoneAction } from '../src/mirror.ts'
import { MAX_GRADE, METRES_PER_UNIT, TERRAIN_HEIGHT, gradeAlong, heightAlong, mapPosition, roadGrade } from '../src/road.ts'
import { Bot } from './bot.ts'
import { newEngine } from './helpers.ts'

function inOakvale(seed = 1) {
  const e = newEngine(seed)
  const bot = new Bot(e)
  bot.start('knight')
  return { e, bot }
}

const tap = (choice: string, rev?: number, source = 'bridge:phone'): InputAnswer =>
  ({ promptId: PROMPT_ID, choice, t: 1, source, ...(rev != null ? { rev } : {}) })

describe('the phone mirror', () => {
  it('turns the choice list into a menu prompt, and taps back into picks and presses', () => {
    const { e } = inOakvale()
    const m = new MenuMirror()
    const list = e.choices()
    const p = m.prompt(list, list.options[1].id)
    expect(p).toMatchObject({ promptId: PROMPT_ID, layout: 'menu', prompt: list.title, rev: 1, back: 'menu', highlight: list.options[1].id })
    expect(p.items!.map((i) => i.id)).toEqual(list.options.map((o) => o.id))
    expect(p.items!.map((i) => i.label)).toEqual(list.options.map((o) => o.label))
    expect(phoneAction(tap('journal', 1), m, list)).toEqual({ pick: 'journal' })
    expect(phoneAction(tap('down', 1), m, list)).toEqual({ press: 'down' })
    expect(phoneAction(tap('select', 1), m, list)).toEqual({ press: 'select' })
  })

  it('bumps rev when the list changes, not when only a label does', () => {
    const { e } = inOakvale()
    const m = new MenuMirror()
    m.sync(e.choices())
    e.choose('gate')
    const gate = e.choices()
    expect(m.sync(gate)).toBe(2)
    e.step(0.2, 3) // pedal harder: the gate's minutes change
    const faster = e.choices()
    expect(faster.key).not.toBe(gate.key)
    expect(m.sync(faster)).toBe(2)
  })

  it('drops a Select, Back or item tap aimed at a list that has gone; directions always pass', () => {
    const { e } = inOakvale()
    const m = new MenuMirror()
    m.prompt(e.choices(), null) // rev 1: the phone shows the town
    e.choose('gate') // the list changes before the next tick
    const gate = e.choices()
    expect(phoneAction(tap('select', 1), m, gate)).toBeNull()
    expect(phoneAction(tap('back', 1), m, gate)).toBeNull()
    expect(phoneAction(tap('journal', 1), m, gate)).toBeNull()
    expect(phoneAction(tap('up', 1), m, gate)).toEqual({ press: 'up' })
    expect(phoneAction(tap('select', 2), m, gate)).toEqual({ press: 'select' })
    // the gate's own "back" option travels escaped, so it can't be mistaken for the Back button
    expect(m.prompt(gate, 'back').back).toBe('item:back')
    expect(phoneAction(tap('item:back', 2), m, gate)).toEqual({ pick: 'back' })
    expect(phoneAction(tap('select'), m, gate)).toEqual({ press: 'select' }) // no rev (an older bridge): passes
  })

  it('ignores other prompts, our own answers, disabled options and options that are not there', () => {
    const { e } = inOakvale()
    const m = new MenuMirror()
    const list = e.choices()
    m.sync(list)
    expect(phoneAction({ ...tap('journal', 1), promptId: 'other' }, m, list)).toBeNull()
    expect(phoneAction(tap('journal', 1, 'game'), m, list)).toBeNull()
    expect(phoneAction(tap('nowhere', 1), m, list)).toBeNull()
    const disabled = { ...list, options: list.options.map((o, i) => (i === 0 ? { ...o, disabled: true } : o)) }
    expect(phoneAction(tap(list.options[0].id, m.sync(disabled)), m, disabled)).toBeNull()
  })
})

describe('the road', () => {
  it('Hills: a gentle roll around the terrain, flat at the gates, 0–8%, the same every trip', () => {
    for (const terrain of ['plains', 'hills', 'mountain', 'coast'] as const) {
      const g = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].map((pos) => gradeAlong('r1', terrain, 220, pos))
      expect(g[0]).toBe(0)
      expect(g[g.length - 1]).toBe(0)
      for (const x of g) expect(x).toBeGreaterThanOrEqual(0)
      for (const x of g) expect(x).toBeLessThanOrEqual(MAX_GRADE)
    }
    const mean = (terrain: 'plains' | 'mountain') => Array.from({ length: 99 }, (_, i) => gradeAlong('r1', terrain, 220, (i + 1) / 100)).reduce((a, b) => a + b) / 99
    expect(mean('mountain')).toBeGreaterThan(3 * mean('plains'))
    expect(gradeAlong('r7', 'hills', 200, 0.4)).toBe(gradeAlong('r7', 'hills', 200, 0.4))
  })

  it('flat in town, the road grade on the road; the hero on the map in metres, at the height of the ground', () => {
    const { e, bot } = inOakvale()
    const w = e.save.where
    expect(w.kind).toBe('town')
    const town = e.world.town((w as { town: string }).town)
    const here = { x: town.x * METRES_PER_UNIT, y: TERRAIN_HEIGHT[town.biome], z: town.y * METRES_PER_UNIT }
    expect(roadGrade(e)).toBe(0)
    expect(mapPosition(e)).toEqual(here)
    bot.pick('gate')
    bot.pick(bot.ids().find((id) => id.startsWith('travel:'))!)
    expect(e.save.where.kind).toBe('travel')
    expect(mapPosition(e)).toEqual(here)
    e.step(30, 1)
    if (e.save.where.kind === 'travel') {
      const p = mapPosition(e)!
      expect(p.x !== here.x || p.z !== here.z).toBe(true)
    }
  })

  it('the profile: the towns at their heights, the road rolling between them', () => {
    const { e } = inOakvale()
    for (const r of e.world.game.routes) {
      const a = e.world.town(r.a)
      const b = e.world.town(r.b)
      expect(heightAlong(r, a, b, 0)).toBe(TERRAIN_HEIGHT[a.biome])
      expect(heightAlong(r, a, b, 1)).toBe(TERRAIN_HEIGHT[b.biome])
      const lo = Math.min(TERRAIN_HEIGHT[a.biome], TERRAIN_HEIGHT[b.biome]) - 60
      const hi = Math.max(TERRAIN_HEIGHT[a.biome], TERRAIN_HEIGHT[b.biome]) + 60
      for (let pos = 0; pos <= 1; pos += 0.05) {
        const h = heightAlong(r, a, b, pos)
        expect(h).toBeGreaterThanOrEqual(lo)
        expect(h).toBeLessThanOrEqual(hi)
      }
    }
  })
})
