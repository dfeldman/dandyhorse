/** The journal's pages, drawn as parchment beside the choice list. Left/Right scroll a page taller than the screen. */
import { STATS, ITEM_TYPES } from '../content/types.ts'
import type { EffortSource } from '../effort.ts'
import { clock } from '../effort.ts'
import type { Engine } from '../engine/engine.ts'
import type { JournalMode, JournalPage } from '../engine/modes/journal.ts'
import * as R from '../engine/rules.ts'
import { ELEMENT_ICON, STAT_INFO, TYPE_INFO } from '../engine/text.ts'
import { drawRegionMap } from '../render/map.ts'
import { escapeHtml as esc, itemCard } from './itemcard.ts'

/** 90 → "about 1½ hours"; 40 → "about 40 minutes". */
function aboutTime(minutes: number): string {
  if (minutes < 50) return `about ${Math.round(minutes / 5) * 5} minutes`
  const halves = Math.round(minutes / 30) / 2
  return `about ${Math.floor(halves) || ''}${halves % 1 ? '½' : ''} hour${halves > 1 ? 's' : ''}`
}

export class JournalView {
  private root: HTMLElement
  private body: HTMLElement
  private more: HTMLElement
  private key = ''
  private lastPage = ''
  private lastFocus: string | null = null

  constructor(root: HTMLElement) {
    this.root = root
    root.innerHTML = '<div class="jr-body"></div><div class="jr-more">▼ More below · press → or pick the page again</div>'
    this.body = root.querySelector('.jr-body')!
    this.more = root.querySelector('.jr-more')!
  }

  hide(): void {
    this.root.hidden = true
    this.key = ''
    this.lastPage = ''
    this.lastFocus = null
    this.seenPage = ''
    this.seenHl = null
    this.seenTurns = 0
  }

  /** Scroll by most of a screen (Left/Right). */
  scroll(dir: 1 | -1): void {
    this.body.scrollBy({ top: dir * this.body.clientHeight * 0.8, behavior: 'smooth' })
  }

  private shown: JournalPage = 'royal'
  private seenPage = ''
  private seenHl: string | null = null
  private seenTurns = 0

  render(e: Engine, mode: JournalMode, highlighted: string | null, workout: EffortSource): void {
    this.root.hidden = false
    // The page picked last (a phone picks without highlighting), until the highlight moves to another.
    if (mode.page !== this.seenPage) {
      this.seenPage = mode.page
      this.shown = mode.page
    } else if (highlighted !== this.seenHl && highlighted?.startsWith('page:')) this.shown = highlighted.slice(5) as JournalPage
    this.seenHl = highlighted
    const page: JournalPage = mode.view === 'pages' ? this.shown : 'bag'
    const focus = mode.view === 'item' ? mode.item : highlighted?.startsWith('item:') ? highlighted.slice(5) : null
    const s = e.save
    const live = page === 'workout' ? Math.floor(s.totals.playSeconds) : page === 'royal' ? Math.floor(s.adventureSeconds / 60) : 0
    const key = [page, focus, live, s.gold, s.hints.length, JSON.stringify(s.inventory), JSON.stringify(s.quests), s.weapon, JSON.stringify(s.stats)].join('|')
    if (key !== this.key) {
      this.key = key
      switch (page) {
        case 'royal': this.royal(e); break
        case 'quests': this.quests(e); break
        case 'bag': this.bag(e, focus); break
        case 'hero': this.hero(e); break
        case 'workout': this.workout(e, workout); break
        case 'map': this.map(e); break
        case 'hints': this.hints(e); break
      }
      if (page !== this.lastPage) this.body.scrollTop = 0
      if (page !== this.lastPage || focus !== this.lastFocus) this.body.querySelector('.cell.hl')?.scrollIntoView({ block: 'nearest' })
      this.lastPage = page
      this.lastFocus = focus
    }
    // Picking the shown page again turns to its next screen, and from the last one back to the top.
    if (mode.turns !== this.seenTurns) {
      this.seenTurns = mode.turns
      const atEnd = this.body.scrollTop + this.body.clientHeight >= this.body.scrollHeight - 8
      if (mode.turns > 0 && atEnd) this.body.scrollTo({ top: 0, behavior: 'smooth' })
      else if (mode.turns > 0) this.scroll(1)
    }
    this.more.hidden = this.body.scrollHeight - this.body.scrollTop - this.body.clientHeight < 8
  }

  private royal(e: Engine): void {
    const w = e.world
    const s = e.save
    const c = w.game.challenge
    const boss = w.enemy(c.boss)
    const items = c.requires.map((id) => {
      const item = w.item(id)
      const have = R.count(s, id) > 0
      const clues = s.hints.map((h) => w.hints.get(h)).filter((h) => h?.about === id).map((h) => h!.text)
      const note = have ? 'In your bag!' : clues.length ? clues[clues.length - 1] : 'Nobody has told you where it is yet. Ask around.'
      return `<li class="${have ? 'done' : ''}"><span class="big">${item.emoji}</span><div><b>${esc(item.name)}</b><br><span>${esc(note)}</span></div><span class="tick">${have ? '✅' : '⬜'}</span></li>`
    }).join('')
    // Progress: each relic is a step, and the final battle is the last one.
    const found = c.requires.length - R.missing(s, w).length
    const played = Math.round(s.adventureSeconds / 60)
    const usual = e.host.index.games.find((g) => g.id === s.gameId)?.minutes
    const timeNote = `${played ? `${played} minute${played === 1 ? '' : 's'} into this adventure.` : 'Your adventure has just begun.'}${usual ? ` A steady hero usually needs ${aboutTime(usual)}.` : ''}`
    this.body.innerHTML = `
      <h2>👑 ${esc(c.title)}</h2>
      <p class="lead">${esc(w.game.region.blurb)}</p>
      <h3>What you need</h3><ul class="checklist">${items}</ul>
      <h3>Progress</h3>
      <div class="row"><div class="meter"><i style="width:${(100 * found) / (c.requires.length + 1)}%"></i></div>
        <span>${found === c.requires.length ? 'Only the final battle is left!' : `${found} of ${c.requires.length} found`}</span></div>
      <p class="muted">${timeNote}</p>
      <h3>Then</h3>
      <p>Carry them to <b>${esc(w.town(c.crisisTown).name)}</b> and face <b>${esc(boss.name)}</b> ${boss.emoji} in ${esc(c.lair.name)}.</p>
      <h3>The Queen's words</h3><blockquote>${c.summons.map(esc).join(' ')}</blockquote>`
  }

  private quests(e: Engine): void {
    const w = e.world
    const s = e.save
    const all = [...w.quests.values()].filter(({ quest }) => s.quests[quest.id])
    const open = all.filter(({ quest }) => s.quests[quest.id] === 'active')
    const done = all.filter(({ quest }) => s.quests[quest.id] === 'done')
    const card = ({ quest, town }: (typeof all)[number], isDone: boolean): string =>
      `<div class="quest ${isDone ? 'done' : ''}"><b>${isDone ? '✅' : '📜'} ${esc(quest.title)}</b> <span class="from">for ${esc(town.mayor.name)} of ${esc(town.name)}</span>${isDone ? '' : `<p>${esc(quest.reminder)}${R.questReady(s, quest) ? ' <b>Ready to hand in!</b>' : ''}</p>`}</div>`
    this.body.innerHTML = `
      <h2>📋 Town quests</h2>
      ${open.length ? open.map((q) => card(q, false)).join('') : '<p class="muted">No open quests. Mayors often have work for a hero: visit their halls.</p>'}
      ${done.length ? `<h3>Done</h3>${done.map((q) => card(q, true)).join('')}` : ''}`
  }

  private bag(e: Engine, focus: string | null): void {
    const w = e.world
    const s = e.save
    const weight = R.weight(s, w)
    const cap = R.capacity(s)
    const heavy = weight > cap
    const g = R.gear(s, w)
    const gearBits = [
      g.armor ? `armor ${Math.round(Math.min(0.6, g.armor) * 100)}%` : '',
      g.hp ? `HP +${Math.round(g.hp * 100)}%` : '',
      ...[...g.resist].map((el) => `resist ${ELEMENT_ICON[el]} ${el}`),
      g.travel ? `travel −${Math.round(R.travelSaving(s, w) * 100)}%` : '',
      g.gold ? `gold +${Math.round(g.gold * 100)}%` : '',
      g.damage ? `damage +${Math.round(g.damage * 100)}%` : '',
      g.potency ? `potions +${Math.round(g.potency * 100)}%` : '',
    ].filter(Boolean)
    const owned = R.owned(s, w)
    const groups = ITEM_TYPES.map((type) => {
      const list = owned.filter((o) => o.item.type === type)
      if (!list.length) return ''
      const cells = list.map(({ item, qty }) =>
        `<div class="cell ${item.id === s.weapon ? 'eq' : ''} ${item.id === focus ? 'hl' : ''}"><span class="e">${item.emoji}</span><span>${esc(item.name)}</span>${qty > 1 ? `<small>×${qty}</small>` : ''}</div>`).join('')
      return `<h3>${TYPE_INFO[type].plural}</h3><div class="grid">${cells}</div>`
    }).join('')
    const weapon = s.weapon ? w.item(s.weapon) : null
    this.body.innerHTML = `
      <h2>🎒 Bag</h2>
      <div class="row"><b>Load</b><div class="meter ${heavy ? 'warn' : ''}"><i style="width:${Math.min(100, (100 * weight) / cap)}%"></i></div><span>${weight.toFixed(1)} / ${cap}</span></div>
      ${heavy ? '<p><b>Too heavy!</b> Travel costs 40% more Energy until you sell something.</p>' : ''}
      <p>Wielding: <b>${weapon ? `${weapon.emoji} ${esc(weapon.name)}` : 'bare hands'}</b>${gearBits.length ? ` · Clothing: ${gearBits.map(esc).join(', ')}` : ''}</p>
      <div data-card></div>
      ${groups || '<p class="muted">Your bag is empty.</p>'}`
    const slot = this.body.querySelector('[data-card]')!
    if (focus && R.count(s, focus)) slot.replaceChildren(itemCard(w.item(focus), R.haveLines(s, w.item(focus))))
  }

  private hero(e: Engine): void {
    const s = e.save
    const w = e.world
    const t = s.totals
    const stats = STATS.map((k) => {
      const info = STAT_INFO[k]
      const next = R.xpToNext(s, k)
      return `<div class="stat"><div class="top"><span>${info.icon}</span><span>${info.name}</span><span class="val">${s.stats[k]}</span></div>
        <div class="meter"><i style="width:${(100 * s.statXp[k]) / next}%"></i></div><small>${esc(info.blurb)}</small></div>`
    }).join('')
    this.body.innerHTML = `
      <h2>🧍 ${esc(s.heroName)}, Level ${s.level}</h2>
      <p class="lead">Battle HP <b>${R.maxHp(s, w)}</b> · potions at <b>${Math.round(R.potency(s, w) * 100)}%</b> · carries <b>${R.capacity(s)}</b></p>
      <div class="stats">${stats}</div>
      <p class="muted">Stats grow as you use them: fight to grow Strength, drink potions for Magic, survive close fights for Vigor, finish quests and find things for Luck.</p>
      <h3>Deeds</h3>
      <ul class="deeds">
        <li>Kingdoms saved: <b>${t.kingdomsSaved}</b></li>
        <li>Battles won: <b>${t.battlesWon}</b></li>
        <li>Battles lost: <b>${t.battlesLost}</b></li>
        <li>Leagues walked: <b>${Math.round(t.distance / 10)}</b></li>
      </ul>`
  }

  /** Exercise totals. Distance, calories and the rest arrive with device data; until then they show a dash. */
  private workout(e: Engine, workout: EffortSource): void {
    const t = e.save.totals
    const tile = (label: string, value: string | number, soon = false): string =>
      `<div class="tile ${soon ? 'soon' : ''}"><b>${esc(String(value))}</b><span>${esc(label)}</span></div>`
    const soon = ['distance', 'calories', 'average speed', 'average power', 'average heart rate'].map((l) => tile(l, '—', true)).join('')
    this.body.innerHTML = `
      <h2>🚴 Workout</h2>
      <p class="lead">Every turn of the pedals goes toward saving the kingdom.</p>
      <h3>This session</h3>
      <div class="tiles">
        ${tile('time', clock(t.playSeconds - e.session.totals.playSeconds))}
        ${tile('Energy earned', Math.round(Math.max(0, t.energyEarned - workout.energyAtStart)).toLocaleString())}
      </div>
      <h3>All adventures</h3>
      <div class="tiles">
        ${tile('time pedaling', clock(t.playSeconds))}
        ${tile('Energy earned', Math.round(t.energyEarned).toLocaleString())}
        ${tile('kingdoms saved', t.kingdomsSaved)}
        ${tile('battles won', t.battlesWon)}
        ${soon}
      </div>
      <p class="muted">Distance, calories, speed, power and heart rate will fill in once the game can read your bike.</p>`
  }

  private map(e: Engine): void {
    this.body.innerHTML = `<h2>🗺️ ${esc(e.world.game.region.name)}</h2><canvas class="map"></canvas>
      <p class="muted">🏰 towns you have visited · ❔ not yet · 🔥 the crisis · the gold line is where you are headed.</p>`
    const canvas = this.body.querySelector('canvas')!
    const width = canvas.clientWidth || 600
    const g = e.world.game.region
    const height = Math.round((width * g.height) / g.width)
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.height = `${height}px`
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    drawRegionMap(ctx, { x: 0, y: 0, w: width, h: height }, e, { labels: true })
  }

  private hints(e: Engine): void {
    const w = e.world
    const list = [...e.save.hints].reverse().map((id) => w.hints.get(id)).filter(Boolean)
    this.body.innerHTML = `<h2>💡 Hints</h2>${list.length
      ? `<ul class="hints">${list.map((h) => `<li>${esc(h!.text)}</li>`).join('')}</ul>`
      : '<p class="muted">Talk to people in the towns. Anything useful they tell you is written here.</p>'}`
  }
}
