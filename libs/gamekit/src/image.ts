/** Session images (PLAN.md §6.7): the picture History shows for a session. */
import { putSessionImage } from './api.ts'

export const SESSION_IMAGE_MAX_BYTES = 1_000_000

/** Approximate decoded size of a data URL in bytes. */
export function dataUrlBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(',')
  return i < 0 ? 0 : Math.floor(((dataUrl.length - i - 1) * 3) / 4)
}

/**
 * Upload a canvas as the session image. Tries PNG first; if that is over the limit, falls back to JPEG at
 * decreasing quality. Resolves to the stored image URL, or null if nothing fit (never throws).
 */
export async function uploadCanvasAsSessionImage(sessionId: string, canvas: HTMLCanvasElement): Promise<string | null> {
  const candidates = [() => canvas.toDataURL('image/png'), () => canvas.toDataURL('image/jpeg', 0.85), () => canvas.toDataURL('image/jpeg', 0.6)]
  for (const make of candidates) {
    const url = make()
    if (dataUrlBytes(url) > SESSION_IMAGE_MAX_BYTES) continue
    try {
      const r = await putSessionImage(sessionId, url)
      return r.imageUrl
    } catch {
      return null
    }
  }
  return null
}
