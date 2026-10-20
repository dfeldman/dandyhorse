/**
 * When a bot exercised (PLAN.md §18.8).
 *
 * A bot plays its session now and the session is then moved into the past, so the platform looks lived-in.
 * This decides where in the past: a day of the week this bot trains, near the hour it usually starts, with
 * enough variation that the history does not look stamped out. Slots already used are skipped, so a bot
 * never has two sessions at once.
 */

export interface Schedule {
  /** How many days a week this bot exercises (1–7). */
  daysPerWeek: number
  /** Their usual start, "07:15", local to the bot's own time zone. */
  timeOfDay: string
  /** Minutes either side of it that a real start might fall. */
  jitterMinutes: number
  /** Typical session length in minutes. */
  sessionMinutes: number
  /** Minutes either side of that. */
  sessionJitter: number
}

const DAY = 86_400_000

/** "07:15" → minutes after midnight. Anything unparseable is 07:00. */
export function minutesOfDay(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return 7 * 60
  return Math.min(23 * 60 + 59, Number(m[1]) * 60 + Number(m[2]))
}

/**
 * Which weekdays this bot trains on, for `daysPerWeek`. Spread through the week rather than bunched, and
 * stable for a given bot (the seed), so their history has a rhythm: the same person, week after week.
 */
export function trainingDays(daysPerWeek: number, rng: () => number): number[] {
  const n = Math.max(1, Math.min(7, Math.round(daysPerWeek)))
  // Start from an even spread over the week, then nudge each day by one at random.
  const days = new Set<number>()
  const stride = 7 / n
  const offset = Math.floor(rng() * 7)
  for (let i = 0; i < n; i++) {
    let d = Math.round(offset + i * stride) % 7
    if (rng() < 0.25) d = (d + (rng() < 0.5 ? 1 : 6)) % 7
    while (days.has(d)) d = (d + 1) % 7
    days.add(d)
  }
  return [...days].sort((a, b) => a - b)
}

export interface Slot {
  /** Epoch milliseconds the session started. */
  start: number
  /** How long it ran, in seconds. */
  seconds: number
  /** Whole months between the slot and now, for the fitness model. */
  monthsAgo: number
}

/**
 * Every slot this bot would plausibly have exercised in, from `weeksBack` weeks ago up to now, newest
 * first. The caller plays as many as it wants, skipping any it has already filled.
 */
export function slots(schedule: Schedule, weeksBack: number, rng: () => number, now = Date.now()): Slot[] {
  const days = trainingDays(schedule.daysPerWeek, rng)
  const base = minutesOfDay(schedule.timeOfDay)
  const out: Slot[] = []
  // Walk back day by day from yesterday: today is left alone, so a backfill never lands in the future.
  for (let back = 1; back <= weeksBack * 7; back++) {
    const d = new Date(now - back * DAY)
    if (!days.includes(d.getDay())) continue
    // Somebody who trains four days a week still misses one now and then.
    if (rng() < 0.12) continue
    const jitter = Math.round((rng() * 2 - 1) * schedule.jitterMinutes)
    d.setHours(0, Math.max(0, base + jitter), Math.floor(rng() * 60), 0)
    const minutes = Math.max(8, schedule.sessionMinutes + (rng() * 2 - 1) * schedule.sessionJitter)
    out.push({
      start: d.getTime(),
      seconds: Math.round(minutes * 60),
      monthsAgo: (now - d.getTime()) / (30.44 * DAY),
    })
  }
  return out.sort((a, b) => b.start - a.start)
}
