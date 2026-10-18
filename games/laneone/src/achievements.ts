/**
 * The eight things worth telling somebody they did. The ids and words are the same as
 * `metadata.json`, so the console's Achievements page and this screen agree; on Dandyhorse the
 * game sends the ids in a tick's `achievements` and the server keeps the first time each was earned.
 *
 * They are deliberately about doing the work, not about beating anybody: a console has no score.
 */
export const ACHIEVEMENTS = {
  'first-lap': { name: 'Round the track', description: 'Ran a full 400 m lap.' },
  'programme-done': { name: 'Saw it through', description: 'Finished a whole programme without stopping early.' },
  'ten-k': { name: 'Ten kilometres', description: '10 km in one workout.' },
  'the-hour': { name: 'The hour', description: 'A whole hour of exercise in one session.' },
  'hill-climber': { name: 'Hill climber', description: 'Climbed 100 m in one workout.' },
  'zone-four': { name: 'Up in zone four', description: 'Ten minutes at zone 4 or above.' },
  'even-splits': { name: 'Metronome', description: 'Five laps in a row within five seconds of each other.' },
  'good-recovery': { name: 'Settles fast', description: 'Heart rate fell 40 bpm in the recovery minute.' },
} as const

export type AchievementId = keyof typeof ACHIEVEMENTS

/** The thresholds, in one place so a test can read them rather than repeat them. */
export const WHEN = {
  TEN_K: 10000,
  THE_HOUR: 3600,
  CLIMB: 100,
  HARD_SECONDS: 600,
  EVEN_LAPS: 5,
  EVEN_SPREAD: 5,
  RECOVERY_DROP: 40,
}

export function nameOf(id: string): string {
  return (ACHIEVEMENTS as Record<string, { name: string } | undefined>)[id]?.name ?? id
}
