/**
 * The picture History keeps for a session (INTEGRATION.md §7): the kingdom's map with the hero on it, and a strip with
 * the hero, where they are and the day's deeds. 640×360.
 */
import { SESSION_IMAGE_MAX_BYTES, dataUrlBytes } from '@dandyhorse/gamekit'
import type { Engine } from '../engine/engine.ts'
import { sessionDeeds } from '../engine/modes/menu.ts'
import { listNames } from '../engine/modes/throne.ts'
import * as R from '../engine/rules.ts'
import { drawHero, styleOf } from '../render/hero.ts'
import { drawRegionMap } from '../render/map.ts'
import { FONT_TITLE, FONT_UI } from '../render/stage.ts'

export const CARD_W = 640
export const CARD_H = 360
const STRIP = 104

/** Shrink the font until the text fits `max` pixels. */
function fit(c: CanvasRenderingContext2D, text: string, max: number, size: number, font: string, weight = 700): void {
  let s = size
  do {
    c.font = `${weight} ${s}px ${font}`
  } while (c.measureText(text).width > max && --s > 10)
}

export function drawSessionCard(e: Engine): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = CARD_W
  canvas.height = CARD_H
  const c = canvas.getContext('2d')!
  c.fillStyle = '#0f0e1a'
  c.fillRect(0, 0, CARD_W, CARD_H)
  // The region keeps its proportions, centred.
  const g = e.world.game.region
  const mapW = Math.min(CARD_W, (CARD_H * g.width) / g.height)
  drawRegionMap(c, { x: (CARD_W - mapW) / 2, y: 0, w: mapW, h: CARD_H }, e, { compact: true, t: 0 })

  const shade = c.createLinearGradient(0, CARD_H - STRIP - 30, 0, CARD_H)
  shade.addColorStop(0, 'rgba(15, 14, 26, 0)')
  shade.addColorStop(0.3, 'rgba(15, 14, 26, 0.88)')
  shade.addColorStop(1, 'rgba(15, 14, 26, 0.96)')
  c.fillStyle = shade
  c.fillRect(0, CARD_H - STRIP - 30, CARD_W, STRIP + 30)

  const s = e.save
  drawHero(c, 64, CARD_H - 14, 84, 0, { style: styleOf(s) })
  const { minutes, energy, deeds } = sessionDeeds(e)
  const x = 124
  const max = CARD_W - x - 18
  c.textAlign = 'left'
  c.textBaseline = 'alphabetic'
  c.fillStyle = '#ffd42a'
  fit(c, `${s.heroName} · Level ${s.level}`, max, 24, FONT_TITLE, 900)
  c.fillText(`${s.heroName} · Level ${s.level}`, x, CARD_H - 70)
  c.fillStyle = '#fff8e6'
  const line = `${R.whereText(s, e.world)} · ⚡ ${energy.toLocaleString()} Energy in ${minutes}`
  fit(c, line, max, 17, FONT_UI)
  c.fillText(line, x, CARD_H - 44)
  c.fillStyle = '#cfc6ad'
  const today = deeds.length ? `Today: ${listNames(deeds)}.` : e.world.game.title
  fit(c, today, max, 16, FONT_UI, 600)
  c.fillText(today, x, CARD_H - 20)
  return canvas
}

/** The card as a data URL under the platform's 1 MB limit: PNG, or JPEG if the PNG is too big. */
export function sessionCardUrl(e: Engine): string {
  const canvas = drawSessionCard(e)
  const png = canvas.toDataURL('image/png')
  return dataUrlBytes(png) <= SESSION_IMAGE_MAX_BYTES ? png : canvas.toDataURL('image/jpeg', 0.85)
}
