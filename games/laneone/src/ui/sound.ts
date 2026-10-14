/**
 * The console's beeps. Short, quiet, and few: a treadmill that chirps at you every ten seconds is a
 * treadmill people turn the sound off on.
 *
 * Nothing is loaded — they are made with two oscillators, so there are no files to ship and no delay the
 * first time one plays. The context is created on the first cue, which is always after a button press, so
 * the browser's autoplay rules are satisfied without asking.
 */

type Cue = 'ready' | 'work' | 'recover' | 'lap' | 'done'

/** Frequencies (Hz) and lengths (s) per cue; a two-note phrase says more than one beep. */
const CUES: Record<Cue, { notes: [number, number][]; gain: number }> = {
  ready: { notes: [[660, 0.07], [660, 0.07]], gain: 0.16 },
  work: { notes: [[523, 0.09], [784, 0.14]], gain: 0.22 },
  recover: { notes: [[659, 0.09], [440, 0.16]], gain: 0.18 },
  lap: { notes: [[880, 0.05]], gain: 0.12 },
  done: { notes: [[523, 0.12], [659, 0.12], [784, 0.26]], gain: 0.22 },
}

export class Sound {
  private ctx: AudioContext | null = null
  on: boolean

  constructor(on = true) {
    this.on = on
  }

  toggle(): boolean {
    this.on = !this.on
    return this.on
  }

  play(cue: Cue): void {
    if (!this.on) return
    const ctx = this.context()
    if (!ctx) return
    let at = ctx.currentTime
    const { notes, gain } = CUES[cue]
    for (const [freq, length] of notes) {
      const osc = ctx.createOscillator()
      const amp = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.value = freq
      // A short attack and a smooth tail: a square-edged beep sounds cheap and clips.
      amp.gain.setValueAtTime(0, at)
      amp.gain.linearRampToValueAtTime(gain, at + 0.012)
      amp.gain.exponentialRampToValueAtTime(0.0001, at + length)
      osc.connect(amp).connect(ctx.destination)
      osc.start(at)
      osc.stop(at + length + 0.02)
      at += length * 0.85
    }
  }

  private context(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return this.ctx
    }
    try {
      this.ctx = new AudioContext()
      return this.ctx
    } catch {
      this.on = false // no audio here; the console works the same without it
      return null
    }
  }
}
