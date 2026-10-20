/**
 * Faces and the small pictures of them (PLAN.md §18.6).
 *
 * An avatar is a Babylon scene and a few hundred megabytes of MakeHuman assets, which is far too much for a
 * page of a hundred players. So every player gets one small PNG, rendered once and stored, and that is what
 * lists, leaderboards and session pages show.
 *
 * A person renders their own when they save a look in the designer. A bot has nobody at a keyboard, so an
 * admin's console does it for them — which is also where a bot's `avatarSeed` becomes an actual face, since
 * this is the only place avatarkit is loaded.
 *
 * The picture is a **headshot**: a face is what reads at forty pixels, where a whole figure is a smudge.
 * Several at once go through one `HeadshotStudio`, which keeps the scene open between people.
 *
 * Everything here loads on demand; none of it reaches the console's main bundle.
 */
import { api } from './api'
import { mountAvatar, type Stage } from './avatarStage'

/** Colours an exercise wardrobe actually comes in. */
const KIT_COLORS = [
  '#1f6bff', '#ff5a3c', '#19c37d', '#ffd166', '#b14aed', '#0ea5e9',
  '#f43f5e', '#22d3ee', '#fb923c', '#2dd4bf', '#eab308', '#e2e8f0',
]

/**
 * A whole person from one number, dressed for exercise. avatarkit's own generator makes the body, face,
 * skin and hair; this only changes what they are wearing, because `randomSpec` dresses them for anything.
 * The same seed always gives the same person.
 */
export async function specFromSeed(seed: number): Promise<Record<string, unknown>> {
  const { EXERCISE_KIT, makeRng, randomSpec } = await import('avatarkit')
  const spec = randomSpec(seed)
  const rng = makeRng(seed ^ 0x9e3779b9)
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]
  const of = (re: RegExp): string[] => EXERCISE_KIT.filter((id) => re.test(id))
  const tops = of(/bra|tank|top|shirt/)
  const bottoms = of(/briefs|shorts|jeans/)
  const suits = of(/suit/)
  const shoes = of(/shoes/)
  const socks = of(/socks/)

  const worn = suits.length > 0 && rng() < 0.3
    ? [pick(suits)]
    : [pick(tops.length ? tops : EXERCISE_KIT), pick(bottoms.length ? bottoms : EXERCISE_KIT)]
  if (shoes.length) worn.push(pick(shoes))
  if (socks.length && rng() < 0.6) worn.push(pick(socks))
  return { ...spec, clothes: worn.map((id) => ({ id, color: pick(KIT_COLORS) })) } as unknown as Record<string, unknown>
}

/**
 * A scene kept open to render many people through, one after another.
 *
 * Building a Babylon engine, its lighting and its environment takes far longer than drawing a person into
 * one, so a page of pictures builds the scene once and swaps the person. Close it when done.
 */
export class HeadshotStudio {
  private readonly canvas: HTMLCanvasElement
  private readonly mine: boolean
  private stage: Stage | null = null
  private readonly size: number

  /**
   * `canvas` is one the page is showing. Give it one.
   *
   * A canvas the page is not showing does not work: parked off the side of the page, or sitting at an
   * opacity of a hundredth, WebGPU refuses it a drawing context outright and WebGL draws nothing into it —
   * every capture came back a transparent square, with no error to say why. So the page that wants
   * pictures shows the avatar while it makes them, which is honest anyway: you can watch it work.
   */
  constructor(size = 256, canvas?: HTMLCanvasElement) {
    this.size = size
    this.mine = !canvas
    const c = canvas ?? document.createElement('canvas')
    if (!canvas) {
      c.width = c.height = size
      c.style.cssText = 'position:fixed;right:8px;bottom:8px;width:96px;height:96px;border-radius:12px'
      c.setAttribute('aria-hidden', 'true')
      document.body.appendChild(c)
    }
    this.canvas = c
  }

  /** One person as a PNG data URL. The first call builds the scene; the rest reuse it. */
  async shoot(avatar: unknown): Promise<string> {
    if (!this.stage) {
      this.stage = await mountAvatar(this.canvas, {
        // Everything exactly as a profile page does it, which is the one combination known to draw a
        // person: avatarkit shades skin through a pre-pass that wants WebGPU, and forcing plain WebGL
        // here produced a transparent square every time.
        avatar, framing: 'headshot', transparent: true, turntable: false, quality: 'medium',
      })
    } else {
      await this.stage.replace(avatar)
    }
    return this.stage.snapshot(this.size)
  }

  close(): void {
    this.stage?.dispose()
    this.stage = null
    if (this.mine) this.canvas.remove()
  }
}

/**
 * One avatar as a headshot PNG. For several, use a `HeadshotStudio` instead: this builds a whole scene and
 * throws it away again, which is the slow part.
 */
export async function renderThumbnail(avatar: unknown, size = 256,
                                      canvas?: HTMLCanvasElement): Promise<string> {
  const studio = new HeadshotStudio(size, canvas)
  try {
    return await studio.shoot(avatar)
  } finally {
    studio.close()
  }
}

/** Render the player's own avatar and store it as their picture. */
export async function uploadOwnThumbnail(avatar: unknown, size = 256,
                                         canvas?: HTMLCanvasElement): Promise<boolean> {
  try {
    await api('/api/profile/thumbnail', 'PUT', { image: await renderThumbnail(avatar, size, canvas) })
    return true
  } catch (e) {
    // A picture is decoration: a player who cannot render one still has a profile, and a list shows initials.
    console.warn('could not render an avatar picture', e)
    return false
  }
}

export interface NeedsPicture {
  uid: number
  username: string
  avatar?: Record<string, unknown> | null
  avatarSeed?: number | null
  thumbnailUrl?: string | null
}

export interface PictureResult {
  made: number
  failed: { username: string; why: string }[]
}

/**
 * For an admin: give everybody who has not got one a face and a picture. A player with an avatar gets a
 * picture of it; a bot with only a seed gets the face generated first and saved to their profile, so the
 * same person turns up on their profile page afterwards.
 *
 * One at a time on purpose: each render is a Babylon scene, and five at once on a laptop is a bad time.
 */
export async function makeMissingPictures(
  players: NeedsPicture[],
  onProgress?: (done: number, total: number, who: string) => void,
  canvas?: HTMLCanvasElement,
): Promise<PictureResult> {
  const todo = players.filter((p) => !p.thumbnailUrl && (p.avatar || typeof p.avatarSeed === 'number'))
  const out: PictureResult = { made: 0, failed: [] }
  if (todo.length === 0) return out
  // One scene for all of them: building it is the slow part, drawing a face into it is not.
  const studio = new HeadshotStudio(256, canvas)
  try {
    for (const [i, p] of todo.entries()) {
      onProgress?.(i, todo.length, p.username)
      try {
        let avatar = p.avatar
        if (!avatar && typeof p.avatarSeed === 'number') {
          avatar = await specFromSeed(p.avatarSeed)
          await api(`/api/admin/users/${p.uid}`, 'PUT', { avatar })
        }
        const image = await studio.shoot(avatar)
        await api(`/api/admin/users/${p.uid}/thumbnail`, 'PUT', { image })
        out.made += 1
      } catch (e) {
        out.failed.push({ username: p.username, why: (e as Error).message })
      }
    }
  } finally {
    studio.close()
  }
  onProgress?.(todo.length, todo.length, '')
  return out
}
