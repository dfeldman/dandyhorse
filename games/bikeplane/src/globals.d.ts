/**
 * The contract between the TypeScript adapter (src/) and the classic game scripts (public/js/).
 * main.ts loads the scripts once the session has started; they define window.FlightCycle.boot(platform).
 * boot(null) is practice: the page on its own, flown with the keyboard or the slider.
 */

export interface Formatted { value: string; unit: string }

export interface EndedInfo {
  status: string
  reason: string | null
}

/** What the game reads from the platform, every frame. */
export interface FcPlatform {
  /** The workout's length (s): the session's requested duration. */
  duration: number
  fmt: {
    speed: (ms: number | null) => Formatted
    length: (m: number | null) => Formatted
    distance: (m: number | null) => Formatted
  }
  /** 0–100, 50 holds level flight: 50 × power ÷ steady power. Null until the trainer has said anything. */
  pedal: () => number | null
  paused: () => boolean
  pauseMessage: () => string | null
  /** Seconds the session has been active: the workout counts down on these. */
  activeSeconds: () => number
  /** Set once the session has ended from outside (the bridge's End, the console, the reaper). */
  ended: () => EndedInfo | null
  achievement: (id: string) => void
  /** The workout is over: send the last tick, then end the session as complete, with the picture. */
  finish: () => void
  /** Keep the rider's best score; returns the best and whether this score is it. */
  saveScore: (score: number) => { best: number; isNew: boolean }
}

/** What the adapter reads back from the game once a second. */
export interface FcTick {
  /** 0–100, the game's trainer resistance: 45 cruising, eased by Tailwinds, 25 on the runway. */
  resistance: number
  /** The plane: x and z on the island, y its height (m). */
  pos: { x: number; y: number; z: number }
  /** The plane's speed (m/s); 0 on the runway before takeoff. */
  speed: number
  flying: boolean
  score: number
  ringsHit: number
  ringsPassed: number
  streak: number
  lap: number
  turbo: boolean
  race: boolean
  over: boolean
}

export interface FcHandle {
  tick: () => FcTick
  sessionImage: () => string | null
}

declare global {
  interface Window {
    FlightCycle?: { boot: (platform: FcPlatform | null) => FcHandle }
    /** public/js/input.js: sets the practice pedal (0–100) */
    setPedalInput?: (v: number) => void
    BABYLON?: unknown
  }
}
