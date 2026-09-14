/** The adapter's arithmetic, kept pure so it can be tested (drive.test.ts). */

/** The game's pedal (0–100, 50 holds level flight) from effort: power ÷ steady power, 1 = steady. */
export function pedalFromEffort(effort: number): number {
  return Math.max(0, Math.min(100, 50 * effort))
}

/**
 * The trainer's grade (%) for the game's resistance (0–100). 45, the cruising base, is a gentle 1%; each
 * Tailwind eases it by a tenth (to 0.8%, then 0.6%); the runway (25) is flat. Sim mode, never ERG: in ERG
 * the trainer holds the power, and the rider could not climb or dive at all.
 */
export function gradeFromResistance(resistance: number): number {
  const grade = Math.max(0, Math.min(4, (resistance - 25) * 0.05))
  return Math.round(grade * 10) / 10
}
