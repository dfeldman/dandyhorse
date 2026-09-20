/**
 * The picture History keeps for a session (INTEGRATION.md §7): the final standings drawn over the last frame.
 * 640×360. The engine runs with preserveDrawingBuffer, so the canvas can still be read after the frame.
 */
import { SESSION_IMAGE_MAX_BYTES, dataUrlBytes } from '@dandyhorse/gamekit'
import { PLAYER_ID } from '../sim/race.ts'
import type { Series } from '../sim/series.ts'

export const CARD_W = 640
export const CARD_H = 360
const FONT = '"Baloo 2", system-ui, sans-serif'

const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th']

export function drawSessionCard(canvas: HTMLCanvasElement, series: Series): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = CARD_W
  out.height = CARD_H
  const c = out.getContext('2d')!
  c.fillStyle = '#07041a'
  c.fillRect(0, 0, CARD_W, CARD_H)

  // the last frame, cropped to the card's shape rather than squashed
  if (canvas.width > 0 && canvas.height > 0) {
    const scale = Math.max(CARD_W / canvas.width, CARD_H / canvas.height)
    const w = canvas.width * scale
    const h = canvas.height * scale
    try {
      c.drawImage(canvas, (CARD_W - w) / 2, (CARD_H - h) / 2, w, h)
    } catch {
      // a tainted or lost context: the standings alone still make a picture
    }
  }

  const shade = c.createLinearGradient(0, 0, CARD_W, 0)
  shade.addColorStop(0, 'rgba(7, 4, 26, 0.92)')
  shade.addColorStop(0.62, 'rgba(7, 4, 26, 0.8)')
  shade.addColorStop(1, 'rgba(7, 4, 26, 0.1)')
  c.fillStyle = shade
  c.fillRect(0, 0, CARD_W, CARD_H)

  c.textAlign = 'left'
  c.textBaseline = 'alphabetic'
  c.fillStyle = '#ffd42a'
  c.font = `900 34px ${FONT}`
  c.fillText('Championship', 34, 58)
  c.fillStyle = 'rgba(255,255,255,.72)'
  c.font = `700 17px ${FONT}`
  const races = series.raceNumber
  c.fillText(`${races} race${races === 1 ? '' : 's'} · ${series.trackName}`, 34, 82)

  const table = series.table()
  let y = 126
  for (let i = 0; i < table.length; i++) {
    const s = table[i]!
    const me = s.id === PLAYER_ID
    if (me) {
      c.fillStyle = 'rgba(255, 45, 45, .38)'
      c.fillRect(24, y - 25, 372, 36)
    }
    c.fillStyle = 'rgba(255,255,255,.62)'
    c.font = `800 20px ${FONT}`
    c.fillText(ORDINAL[i] ?? `${i + 1}th`, 34, y)
    c.fillStyle = s.color
    c.fillRect(84, y - 16, 18, 18)
    c.fillStyle = me ? '#fff8e6' : 'rgba(255,255,255,.88)'
    c.font = `${me ? 900 : 700} 23px ${FONT}`
    c.fillText(s.name, 114, y)
    c.fillStyle = '#ffd42a'
    c.font = `900 23px ${FONT}`
    c.textAlign = 'right'
    c.fillText(String(s.points), 388, y)
    c.textAlign = 'left'
    y += 46
  }
  return out
}

/** The card as a data URL under the platform's 1 MB limit: PNG, or JPEG if the PNG is too big. */
export function sessionCardUrl(canvas: HTMLCanvasElement, series: Series): string | null {
  try {
    const card = drawSessionCard(canvas, series)
    const png = card.toDataURL('image/png')
    return dataUrlBytes(png) <= SESSION_IMAGE_MAX_BYTES ? png : card.toDataURL('image/jpeg', 0.85)
  } catch {
    return null
  }
}
