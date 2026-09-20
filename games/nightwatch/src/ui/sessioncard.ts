/**
 * The picture History keeps for a session (INTEGRATION.md §7): the logbook's totals over the dawn harbour.
 * 640×360. The engine runs with preserveDrawingBuffer, so the canvas can still be read after the frame.
 */
import { SESSION_IMAGE_MAX_BYTES, dataUrlBytes } from '@dandyhorse/gamekit'
import type { Night } from '../sim/night.ts'

export const CARD_W = 640
export const CARD_H = 360
const STRIP = 120
const FONT = '"Baloo 2", system-ui, sans-serif'

export function drawSessionCard(canvas: HTMLCanvasElement, night: Night): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = CARD_W
  out.height = CARD_H
  const c = out.getContext('2d')!
  c.fillStyle = '#050a1e'
  c.fillRect(0, 0, CARD_W, CARD_H)

  // the last frame, cropped to the card's shape rather than squashed
  if (canvas.width > 0 && canvas.height > 0) {
    const scale = Math.max(CARD_W / canvas.width, CARD_H / canvas.height)
    const w = canvas.width * scale
    const h = canvas.height * scale
    try {
      c.drawImage(canvas, (CARD_W - w) / 2, (CARD_H - h) / 2, w, h)
    } catch {
      // a tainted or lost context: the totals alone still make a picture
    }
  }

  const shade = c.createLinearGradient(0, CARD_H - STRIP - 40, 0, CARD_H)
  shade.addColorStop(0, 'rgba(5, 10, 30, 0)')
  shade.addColorStop(0.35, 'rgba(5, 10, 30, 0.88)')
  shade.addColorStop(1, 'rgba(5, 10, 30, 0.97)')
  c.fillStyle = shade
  c.fillRect(0, CARD_H - STRIP - 40, CARD_W, STRIP + 40)

  c.textAlign = 'left'
  c.textBaseline = 'alphabetic'
  c.fillStyle = '#ffd98a'
  c.font = `900 30px ${FONT}`
  c.fillText('🌅 Dawn', 30, CARD_H - 86)
  c.fillStyle = 'rgba(255,255,255,.72)'
  c.font = `700 17px ${FONT}`
  c.fillText(`${Math.round(night.duration / 60)} min · ${night.difficulty}`, 152, CARD_H - 88)

  const totals: [string, string][] = [
    [`${night.shipsHome}/${night.ships.length}`, 'ships home'],
    [`${night.starsEarned}/${night.starsMax}`, 'stars'],
    [night.points.toLocaleString(), 'points'],
    [`${night.hailsAnswered}/${night.hailsSeen}`, 'hails'],
  ]
  const cell = (CARD_W - 60) / totals.length
  totals.forEach(([big, small], i) => {
    const x = 30 + cell * i
    c.fillStyle = '#fff8e6'
    c.font = `900 34px ${FONT}`
    c.fillText(big, x, CARD_H - 42)
    c.fillStyle = 'rgba(255,255,255,.66)'
    c.font = `700 15px ${FONT}`
    c.fillText(small, x, CARD_H - 20)
  })
  return out
}

/** The card as a data URL under the platform's 1 MB limit: PNG, or JPEG if the PNG is too big. */
export function sessionCardUrl(canvas: HTMLCanvasElement, night: Night): string | null {
  try {
    const card = drawSessionCard(canvas, night)
    const png = card.toDataURL('image/png')
    return dataUrlBytes(png) <= SESSION_IMAGE_MAX_BYTES ? png : card.toDataURL('image/jpeg', 0.85)
  } catch {
    return null
  }
}
