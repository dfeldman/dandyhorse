/**
 * How many pixels the frame is drawn with, adjusted to hold the frame rate.
 *
 * **This is the largest single lever on frame rate in the game, and it was not being pulled at all.** The
 * engine is created with `adaptToDeviceRatio`, so on a Retina display it draws at twice the page's resolution
 * in each direction: a 1280×800 window is 2560×1600, four million pixels, each multisampled. The scene is
 * fill-bound (see GRAPHICS.md), so that is four times the fragment work of the same window on an ordinary
 * screen — and four times what the screenshot harness, which runs at a pixel ratio of one, had ever measured.
 *
 * The difference between drawing a landscape at 2× and at 1.5× on a Retina panel is hard to see; the
 * difference between 60 frames a second and 40 is not. So this starts at 1.5× and treats the device's full
 * ratio as a ceiling to climb toward when there is room, not a floor to start from.
 *
 * **Why it probes rather than measures headroom.** With vsync on, a frame that takes 6 ms and a frame that
 * takes 16 ms both come back sixteen and two-thirds milliseconds apart; the display hides exactly the number
 * that would say "there is room to draw more". Missed frames are visible, so the controller steps down quickly
 * when it sees them. Headroom is not, so every so often it steps up a little and watches: if the frame rate
 * holds it keeps the step, and if it does not it steps back and waits twice as long before trying again.
 */
import type { AbstractEngine } from '@babylonjs/core'
import { Config } from '../config.ts'

export class Resolution {
  private readonly engine: AbstractEngine
  /** render pixels per CSS pixel */
  ratio: number
  private readonly max: number
  private readonly min: number
  private frames: number[] = []
  private sinceChange = 0
  private probeEvery = Config.resolutionProbeEvery
  private probing = false
  /** the frame rate measured just before the last step down, to judge whether the step did anything */
  private before = 0
  private steppedDown = false
  /** no stepping down at all until this much time has passed, in ms — see `hold` */
  private quiet = Config.resolutionGrace
  /** off for the screenshot harness and the benchmark, which want a fixed, comparable frame */
  enabled = true

  constructor(engine: AbstractEngine) {
    this.engine = engine
    const device = Math.max(1, window.devicePixelRatio || 1)
    this.max = Math.min(device, Config.resolutionMax)
    this.min = Math.min(this.max, Config.resolutionMin)
    this.ratio = Math.min(this.max, Config.resolutionStart)
    this.apply()
  }

  private apply(): void {
    this.engine.setHardwareScalingLevel(1 / this.ratio)
  }

  /**
   * Stop judging for a while: after loading, after a seek, after anything that rebuilds the world.
   *
   * The first seconds of a ride run at a handful of frames a second while the ground streams in, the shaders
   * compile and the impostors are photographed, and none of that has anything to do with how many pixels are
   * drawn. Read as a verdict on resolution it drove the first version of this straight to its floor in nine
   * seconds, where it stayed — a blurry picture bought for nothing.
   */
  hold(ms = Config.resolutionGrace): void {
    this.quiet = Math.max(this.quiet, ms)
    this.frames = []
  }

  /**
   * Called once a frame with the real time since the last one, in milliseconds.
   *
   * **The target is no missed frames, not a good average.** The first version stepped down only when more
   * than one frame in eight was late, and that was the jitter that was reported: a frame a millisecond over
   * its vsync deadline is shown a whole frame late, so a scene hovering around 16.7 ms alternates between one
   * frame-step and two, and the motion of the road judders however good the average is. So it steps down at
   * three late frames in a hundred, and steps up only after half a minute with none at all.
   *
   * It also stopped oscillating. Every change reallocates the multisampled render targets — itself a hitch,
   * and a visible change of sharpness — and the old one tried a step up every ten seconds and fell back half
   * the time. A step up that fails now blocks the next attempt for five minutes.
   */
  tick(ms: number): void {
    if (!this.enabled || !Number.isFinite(ms) || ms <= 0) return
    if (this.quiet > 0) { this.quiet -= ms; return }
    if (ms > 100) return
    this.frames.push(ms)
    this.sinceChange += ms
    let span = 0
    for (const f of this.frames) span += f
    if (span < 2000) return
    const fps = (1000 * this.frames.length) / span
    // late: past the next vsync at 60 Hz, with a little tolerance for timer noise
    const missed = this.frames.filter((f) => f > 20).length / this.frames.length
    this.frames = []

    if (this.steppedDown) {
      this.steppedDown = false
      // a step down that bought nothing: pixels were not the problem (see the note on the Katy above)
      if (fps < this.before * 1.03 && missed > 0.03) {
        this.ratio = Math.min(this.max, this.ratio / 0.9)
        this.apply()
        this.quiet = 60_000
        this.sinceChange = 0
        return
      }
    }

    if (missed > 0.03 && this.ratio > this.min) {
      if (this.probing) this.probeEvery = 300_000
      this.probing = false
      this.before = fps
      this.steppedDown = true
      this.ratio = Math.max(this.min, this.ratio * 0.9)
      this.apply()
      this.sinceChange = 0
      this.quiet = 1500
      return
    }
    if (this.probing && missed <= 0.01) {
      this.probing = false
      this.probeEvery = Config.resolutionProbeEvery
    }
    if (!this.probing && this.ratio < this.max && this.sinceChange > this.probeEvery && missed === 0) {
      this.ratio = Math.min(this.max, this.ratio / 0.9)
      this.apply()
      this.probing = true
      this.sinceChange = 0
      this.quiet = 1500
    }
  }

  /** Pin the resolution, for anything that needs frames comparable with each other. */
  fix(ratio: number): void {
    this.enabled = false
    this.ratio = ratio
    this.apply()
  }
}
