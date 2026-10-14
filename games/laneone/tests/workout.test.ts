import { describe, expect, it } from 'vitest'
import { WHEN } from '../src/achievements.ts'
import { Config } from '../src/config.ts'
import { SimMachine } from '../src/sim/machine.ts'
import { lapLength } from '../src/track.ts'
import { TREND_SECONDS, Workout, type WorkoutOptions } from '../src/workout.ts'

const STEP = 0.2

function run(w: Workout, seconds: number, step = STEP): void {
  for (let i = Math.round(seconds / step); i > 0; i--) {
    w.machine.update(step)
    w.tick(step)
  }
}

function make(over: Partial<WorkoutOptions> = {}): Workout {
  const machine = new SimMachine({ device: 'treadmill', auto: false, ...(over.machine ? {} : {}) })
  return new Workout({ machine, program: 'steady', duration: 1800, ...over })
}

describe('the clock', () => {
  it('does not start until it is started', () => {
    const w = make()
    run(w, 30)
    expect(w.state().elapsed).toBe(0)
    expect(w.state().phase).toBe('setup')
  })

  it('stops for a pause and picks up again, and paused time is never exercise', () => {
    const w = make()
    w.start()
    run(w, 10)
    const atPause = w.state()
    expect(atPause.elapsed).toBeCloseTo(10, 1)
    w.pause()
    run(w, 30)
    const paused = w.state()
    expect(paused.phase).toBe('paused')
    expect(paused.elapsed).toBeCloseTo(atPause.elapsed, 5)
    expect(paused.distance).toBeCloseTo(atPause.distance, 5)
    expect(paused.energy).toBeCloseTo(atPause.energy, 5)
    w.resume()
    run(w, 10)
    expect(w.state().elapsed).toBeCloseTo(20, 1)
  })

  it('follows a pause the machine reports, and picks up again when it lifts', () => {
    // This is the platform's automatic pause: no device data for five seconds, then the data comes back.
    const w = make()
    w.start()
    run(w, 5)
    w.machine.setPaused(true)
    run(w, 5)
    expect(w.state().phase).toBe('paused')
    const frozen = w.state().elapsed
    w.machine.setPaused(false)
    run(w, 5)
    expect(w.state().phase).toBe('running')
    expect(w.state().elapsed).toBeGreaterThan(frozen)
  })

  it('treats a Resume pressed anywhere else as the player choosing to carry on', () => {
    // A bridge's ▶ lifts the game's own pause too (GAME_AUTHORING.md, "Your own Pause").
    const w = make()
    w.start()
    run(w, 5)
    w.pause()
    expect(w.state().phase).toBe('paused')
    run(w, 2) // the pause is confirmed (on the platform this is the server agreeing)
    w.machine.setPaused(false) // then somebody presses Play on the machine
    run(w, 3)
    expect(w.state().phase).toBe('running')
  })

  it('ends itself when the requested time is up', () => {
    const w = make({ duration: 120 })
    w.start()
    run(w, 130, 1)
    expect(w.state().phase).toBe('done')
    expect(w.summary().duration).toBeGreaterThanOrEqual(120)
  })
})

describe('what it counts', () => {
  it('moves the world by the belt, not by what it asked for', () => {
    const machine = new SimMachine({ device: 'treadmill', auto: false, fixed: 2 })
    const w = new Workout({ machine, program: 'manual', duration: 1800 })
    w.start()
    run(w, 60, 1)
    const s = w.state()
    // The belt takes a few seconds to reach 2 m/s, so the distance is a little under 120 m.
    expect(s.distance).toBeGreaterThan(100)
    expect(s.distance).toBeLessThan(120)
    expect(s.speed).toBeCloseTo(2, 2)
  })

  it('counts a lap every 400 m and records a split', () => {
    const machine = new SimMachine({ device: 'treadmill', auto: false, fixed: 5 })
    const w = new Workout({ machine, program: 'manual', duration: 1800 })
    w.start()
    run(w, 200, 0.5)
    const s = w.state()
    expect(s.laps).toBe(Math.floor(s.distance / lapLength(1)))
    expect(s.laps).toBeGreaterThanOrEqual(2)
    expect(s.splits).toHaveLength(s.laps)
    expect(s.splits[0]!.seconds).toBeGreaterThan(60) // 400 m at ~5 m/s, plus the ramp up
    expect(s.lapDistance).toBeLessThan(lapLength(1))
  })

  it('burns calories on a treadmill and on a bike, and says where the number came from', () => {
    const tread = new Workout({ machine: new SimMachine({ device: 'treadmill', auto: false, fixed: 2 }), program: 'manual', duration: 1800 })
    tread.start()
    run(tread, 60, 1)
    expect(tread.state().energySource).toBe('acsm')
    expect(tread.state().energy / 4184).toBeGreaterThan(4) // a few kcal a minute

    const bike = new Workout({ machine: new SimMachine({ device: 'bike', auto: false, fixed: 150 }), program: 'manual', duration: 1800 })
    bike.start()
    run(bike, 60, 1)
    expect(bike.state().energySource).toBe('power')
    expect(bike.state().speed!).toBeGreaterThan(5) // 150 W carries you along at some speed
  })

  it('counts mechanical work on a bike and nothing on a treadmill', () => {
    const bike = new Workout({ machine: new SimMachine({ device: 'bike', auto: false, fixed: 200 }), program: 'manual', duration: 1800 })
    bike.start()
    run(bike, 60, 1)
    // 200 W for about a minute, less the couple of seconds spent getting there.
    expect(bike.state().work!).toBeGreaterThan(10000)
    expect(bike.state().work!).toBeLessThan(12000)
    const tread = new Workout({ machine: new SimMachine({ device: 'treadmill', auto: false, fixed: 2 }), program: 'manual', duration: 1800 })
    tread.start()
    run(tread, 60, 1)
    expect(tread.state().work).toBeNull() // a belt measures no force, and the platform sends null too
  })

  it('climbs only on the hill it is actually running', () => {
    const machine = new SimMachine({ device: 'treadmill', auto: false, fixed: 2 })
    const flat = new Workout({ machine, program: 'manual', duration: 1800 })
    flat.start()
    run(flat, 60, 1)
    expect(flat.state().elevation).toBe(0)

    const hilly = new Workout({ machine: new SimMachine({ device: 'treadmill', auto: false, fixed: 2 }), program: 'hills', duration: 1800, who: 'machine' })
    hilly.start()
    run(hilly, 900, 1)
    expect(hilly.state().elevation).toBeGreaterThan(5)
  })
})

describe('the base and the buttons', () => {
  it('moves the number on screen by exactly one step, whatever the segment is doing', () => {
    // Mid-interval the belt is asked for 1.35 × the base; a 0.1 press must still read as 0.1 on screen.
    const w = make({ program: 'intervals', who: 'machine', level: 10 })
    w.start()
    run(w, 400, 1) // well into the intervals, where effort is not 1
    expect(w.state().segment.effort).not.toBeCloseTo(1, 3)
    const before = w.state().targets.want.speed!
    w.adjustTarget('speed', 0.1)
    expect(w.state().targets.want.speed!).toBeCloseTo(before + 0.1, 6)
    w.adjustTarget('speed', -0.1)
    expect(w.state().targets.want.speed!).toBeCloseTo(before, 6)
  })

  it('a one-touch key puts the asked-for number exactly there', () => {
    const w = make({ program: 'hills', who: 'machine' })
    w.start()
    run(w, 400, 1)
    w.setTarget('incline', 2)
    expect(w.state().targets.want.incline!).toBeCloseTo(2, 6)
    w.setTarget('speed', 2.5)
    expect(w.state().targets.want.speed!).toBeCloseTo(2.5, 6)
  })

  it('a hill trim may go below zero, but nothing below zero is ever sent to a treadmill', () => {
    const w = make({ program: 'hills', who: 'machine' })
    w.start()
    run(w, 400, 1)
    w.adjust('incline', -99)
    expect(w.state().base.incline).toBe(Config.BASE_RANGE.incline[0])
    expect(w.state().targets.command.incline).toBe(0)
  })

  it('stops at the console’s limits', () => {
    const w = make()
    w.adjust('speed', 0.5)
    expect(w.state().base.speed).toBeCloseTo(Config.BASE_SPEED + 0.5, 6)
    w.adjust('speed', 99)
    expect(w.state().base.speed).toBe(Config.BASE_RANGE.speed[1])
  })

  it('shifts the whole programme, not just the segment you are in', () => {
    const w = make({ program: 'intervals', who: 'machine' })
    w.start()
    const seg = w.state().segment
    const before = w.state().base.speed
    w.adjustTarget('speed', 0.5)
    expect(w.state().base.speed).toBeCloseTo(before + 0.5 / seg.effort, 6)
  })
})

describe('a heart-rate programme', () => {
  it('moves the base toward the target, and never further than its authority allows', () => {
    const machine = new SimMachine({ device: 'treadmill', auto: false, fixed: 0.6 }) // dawdling: heart rate will sit low
    const w = new Workout({ machine, program: 'heartrate', duration: 3600, level: 8, who: 'machine' })
    w.start()
    const anchor = w.state().base.speed
    run(w, 1200, 1)
    const s = w.state()
    expect(s.heartRateTarget).toBeGreaterThan(machine.heartRateRange().resting)
    expect(s.base.speed).toBeGreaterThan(anchor) // it asked for more, because the heart rate was under target
    expect(s.base.speed).toBeLessThanOrEqual(anchor * Config.HR.AUTHORITY[1] + 1e-9)
  })

  it('leaves the base alone when there is no strap to read', () => {
    const machine = new SimMachine({ device: 'treadmill', auto: false, fixed: 0.6, noHeartRate: true })
    const w = new Workout({ machine, program: 'heartrate', duration: 3600, level: 8, who: 'machine' })
    w.start()
    const anchor = w.state().base.speed
    run(w, 600, 1)
    expect(w.state().base.speed).toBe(anchor)
    expect(w.state().readings.heartRate).toBeNull()
  })
})

describe('goals', () => {
  it('a distance goal ends the workout when the distance is done, whatever the clock says', () => {
    const machine = new SimMachine({ device: 'treadmill', auto: false, fixed: 4 })
    const w = new Workout({ machine, program: 'manual', duration: 3600, goal: { kind: 'distance', value: 500 } })
    w.start()
    run(w, 400, 1)
    expect(w.state().phase).toBe('done')
    expect(w.state().distance).toBeGreaterThanOrEqual(500)
    expect(w.state().elapsed).toBeLessThan(200) // 500 m at 4 m/s, nowhere near the hour
  })

  it('a calorie goal ends on the calories', () => {
    const machine = new SimMachine({ device: 'bike', auto: false, fixed: 200 })
    const w = new Workout({ machine, program: 'manual', duration: 3600, goal: { kind: 'calories', value: 20 } })
    w.start()
    run(w, 600, 1)
    expect(w.state().phase).toBe('done')
    expect(w.state().energy / 4184).toBeGreaterThanOrEqual(20)
  })

  it('reports how far through the goal you are, and guesses what is left', () => {
    const machine = new SimMachine({ device: 'treadmill', auto: false, fixed: 2 })
    const w = new Workout({ machine, program: 'manual', duration: 3600, goal: { kind: 'distance', value: 1000 } })
    w.start()
    run(w, 120, 1)
    const p = w.state().progress
    expect(p.kind).toBe('distance')
    expect(p.done).toBeGreaterThan(0.1)
    expect(p.done).toBeLessThan(1)
    expect(p.left).toBeCloseTo(1000 - w.state().distance, 5)
    expect(p.eta).not.toBeNull()
    expect(p.eta!).toBeGreaterThan(100) // ~240 m of the 1000 gone at 2 m/s
  })

  it('a time goal is the default and matches the requested length', () => {
    const w = make({ duration: 900 })
    expect(w.goal).toEqual({ kind: 'time', value: 900 })
  })
})

describe('laps and zones', () => {
  it('marks the unfinished lap at the end as partial, so it is never a lap time', () => {
    const machine = new SimMachine({ device: 'treadmill', auto: false, fixed: 5 })
    const w = new Workout({ machine, program: 'manual', duration: 1800 })
    w.start()
    run(w, 130, 0.5) // a bit over one lap
    w.stop()
    const splits = w.summary().splits
    expect(splits.length).toBeGreaterThanOrEqual(2)
    expect(splits.filter((x) => !x.partial)).toHaveLength(w.state().laps)
    expect(splits[splits.length - 1]!.partial).toBe(true)
  })

  it('adds up the time in each heart-rate zone, and only while running', () => {
    const machine = new SimMachine({ device: 'treadmill', auto: false, fixed: 3.5 })
    const w = new Workout({ machine, program: 'manual', duration: 3600 })
    w.start()
    run(w, 600, 1)
    const total = w.state().timeInZone.reduce((a, b) => a + b, 0)
    expect(total).toBeGreaterThan(60)
    expect(total).toBeLessThanOrEqual(601)
    expect(w.state().zone).toBeGreaterThan(0) // a good clip for ten minutes gets you out of the basement
    const before = [...w.state().timeInZone]
    w.pause()
    run(w, 60, 1)
    expect(w.state().timeInZone).toEqual(before)
  })

  it('keeps the last few minutes for the chart, and drops what is older', () => {
    const machine = new SimMachine({ device: 'treadmill', auto: false, fixed: 2 })
    const w = new Workout({ machine, program: 'manual', duration: 3600 })
    w.start()
    run(w, 900, 1)
    const trend = w.trend()
    expect(trend.length).toBeGreaterThan(300)
    expect(trend.length).toBeLessThanOrEqual(TREND_SECONDS + 2)
    expect(trend[0]!.t).toBeGreaterThan(900 - TREND_SECONDS - 2)
    expect(trend[trend.length - 1]!.t).toBeCloseTo(w.state().elapsed, 0)
  })
})

describe('after the finish', () => {
  it('asks a belt it drives to stand still, so it is not running during the recovery minute', () => {
    const machine = new SimMachine({ device: 'treadmill', auto: false, fixed: 3 })
    const w = new Workout({ machine, program: 'manual', duration: 1800, who: 'machine' })
    w.start()
    run(w, 60, 1)
    expect(machine.read().speed!).toBeGreaterThan(1)
    w.stop()
    run(w, 40, 1) // the frame loop keeps ticking a finished workout; that is what stops the belt
    expect(machine.read().speed!).toBeLessThan(0.05)
  })

  it('leaves a belt it does not drive alone: it was never ours to stop', () => {
    const machine = new SimMachine({ device: 'treadmill', auto: false, fixed: 3 })
    const w = new Workout({ machine, program: 'manual', duration: 1800, who: 'you' })
    w.start()
    run(w, 60, 1)
    w.stop()
    run(w, 40, 1)
    expect(machine.read().speed!).toBeCloseTo(3, 1)
  })

  it('flattens a trainer when the workout ends', () => {
    const machine = new SimMachine({ device: 'bike', auto: false, fixed: 150 })
    const w = new Workout({ machine, program: 'hills', duration: 1800, who: 'you' })
    w.start()
    run(w, 700, 1)
    w.stop()
    run(w, 20, 1)
    expect(machine.read().grade!).toBeCloseTo(0, 2)
  })
})

describe('achievements', () => {
  it('earns a lap, ten kilometres and the even-splits one, each exactly once', () => {
    const machine = new SimMachine({ device: 'treadmill', auto: false, fixed: 5 })
    const w = new Workout({ machine, program: 'manual', duration: 7200 })
    w.start()
    run(w, 120, 1)
    expect(w.takeAchievements()).toContain('first-lap')
    expect(w.takeAchievements()).not.toContain('first-lap') // handed over once and once only
    run(w, 400, 1)
    expect(w.achievements()).toContain('even-splits') // five steady laps at a fixed belt speed
    run(w, 1700, 1)
    expect(w.state().distance).toBeGreaterThan(WHEN.TEN_K)
    expect(w.achievements()).toContain('ten-k')
    expect(w.achievements()).not.toContain('the-hour')
  })

  it('only says you saw the programme through if you did', () => {
    const machine = new SimMachine({ device: 'treadmill', auto: false, fixed: 2 })
    const short = new Workout({ machine, program: 'manual', duration: 120 })
    short.start()
    short.stop()
    short.earnAtEnd({ early: true, recoveryDrop: null })
    expect(short.achievements()).not.toContain('programme-done')

    const done = new Workout({ machine: new SimMachine({ device: 'treadmill', auto: false, fixed: 2 }), program: 'manual', duration: 120 })
    done.start()
    run(done, 130, 1)
    done.earnAtEnd({ early: false, recoveryDrop: 45 })
    expect(done.achievements()).toContain('programme-done')
    expect(done.achievements()).toContain('good-recovery')
  })

  it('needs ten minutes at zone 4 or above, not one', () => {
    const machine = new SimMachine({ device: 'treadmill', auto: false, fixed: 6.2, maxHr: 180 })
    const w = new Workout({ machine, program: 'manual', duration: 3600 })
    w.start()
    run(w, 300, 1)
    expect(w.achievements()).not.toContain('zone-four')
    run(w, 900, 1)
    const hard = (w.state().timeInZone[3] ?? 0) + (w.state().timeInZone[4] ?? 0)
    expect(hard).toBeGreaterThan(WHEN.HARD_SECONDS)
    expect(w.achievements()).toContain('zone-four')
  })
})
