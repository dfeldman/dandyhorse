/**
 * The platform seam, without a server: the save state survives a round trip, and the tick asks the machine for
 * the right thing — a bike's grade, a treadmill's incline, and never a speed.
 */
import { describe, expect, it } from 'vitest'
import type { GameState, Json, SessionClient, SessionClientOptions, StartPayload } from '@dandyhorse/gamekit'
import { PlatformControls, PlatformProgress, parseSaveState, tickBody, type RideReport } from '../src/platform.ts'
import { ProgressTracker } from '../src/sim/progress.ts'

const report = (s: number, finished = false): RideReport => ({ s, speed: 5.25, grade: 0.081, elevation: 1234.4, x: 10.04, y: 1234.4, z: -20.06, finished })

function startPayload(over: Partial<StartPayload> = {}): StartPayload {
  return {
    sessionId: 'sess-1', gameId: 'trailtrainer', variant: 'bike', gameVersion: '0.1.0', seed: 1, requestedDuration: 1800,
    username: 'u', uid: 1, debug: false, deviceType: 'bike', unitSystem: 'metric', timeZone: 'UTC', bodyData: {},
    achievements: {}, options: {}, preferences: { global: {}, device: {}, game: {} }, saveState: null, serverTime: 0,
    ...over,
  }
}

/** A SessionClient that never talks to anybody. */
const fakeClient = (): ((o: unknown) => SessionClient) => () => ({
  paused: false, start() {}, requestTick: async () => {}, end: async () => {},
  // what the ride counted, which buildTick gathers every tick (dandyhorse PLAN.md §18.2)
  countStats() {}, latest: null,
}) as unknown as SessionClient

describe('PlatformProgress', () => {
  it('reads the save state and writes it back in the same shape', () => {
    const saved: Json = { routes: { 'katy-trail': { s: 214380, elapsed: 39120, sessions: 11, updated: '2026-10-01T00:00:00.000Z', completed: false } } }
    const writes: Json[] = []
    const store = new PlatformProgress(saved, (s) => writes.push(s))
    expect(store.get('katy-trail')?.s).toBe(214380)
    expect(store.get('alpe-dhuez')).toBeNull()

    store.put('alpe-dhuez', { s: 5000, elapsed: 900, sessions: 1, updated: '2026-10-02T00:00:00.000Z', completed: false })
    expect(writes).toHaveLength(1)
    const again = parseSaveState(writes[0])
    expect(again['katy-trail'].s).toBe(214380)
    expect(again['katy-trail'].sessions).toBe(11)
    expect(again['alpe-dhuez']).toEqual({ s: 5000, elapsed: 900, sessions: 1, updated: '2026-10-02T00:00:00.000Z', completed: false })
  })

  it('treats anything unreadable as no progress', () => {
    expect(parseSaveState(null)).toEqual({})
    expect(parseSaveState({ routes: 'nope' } as Json)).toEqual({})
    expect(parseSaveState({ routes: { a: { s: 'x' }, b: null, c: { s: 12 } } } as Json)).toEqual({
      c: { s: 12, elapsed: 0, sessions: 0, updated: new Date(0).toISOString(), completed: false },
    })
  })

  it('a debug session (no writer) keeps progress in memory and writes nothing', () => {
    const store = new PlatformProgress(null, null)
    const tracker = new ProgressTracker(store, 'alpe-dhuez', 14700)
    tracker.save(1200, 300)
    expect(store.get('alpe-dhuez')?.s).toBe(1200)
    expect(store.get('alpe-dhuez')?.sessions).toBe(1)
  })

  it('works with ProgressTracker: a session counts, and crossing the end marks the route complete', () => {
    const writes: Json[] = []
    const store = new PlatformProgress({ routes: { r: { s: 100, elapsed: 60, sessions: 2, updated: '', completed: false } } }, (s) => writes.push(s))
    const tracker = new ProgressTracker(store, 'r', 1000)
    tracker.save(1000, 30)
    const last = parseSaveState(writes.at(-1))
    expect(last.r).toMatchObject({ s: 1000, elapsed: 90, sessions: 3, completed: true })
  })
})

describe('the tick', () => {
  it('a bike sends grade and its virtual speed (for the server\'s distance), no incline', () => {
    const body = tickBody({ deviceType: 'bike', routeId: 'alpe-dhuez', request: 8.5, report: report(4321.6), routeLength: 14700 })
    expect(body.grade).toBe(8.5)
    expect('incline' in body).toBe(false)
    expect(body.speed).toBe(5.25)
    expect(body.score).toBe(4322)
    expect(body.route).toBe('alpe-dhuez')
    expect(body.custom).toMatchObject({ s: 4322, grade: 8.1, elevation: 1234 })
  })

  it('a treadmill sends incline and no speed or grade', () => {
    const body = tickBody({ deviceType: 'treadmill', routeId: 'katy-trail', request: -2, report: report(10), routeLength: 385600 })
    expect(body.incline).toBe(-2)
    expect('grade' in body).toBe(false)
    expect('speed' in body).toBe(false)
  })

  it('PlatformControls follows the session device type and sends each achievement once', () => {
    const p = new PlatformControls(startPayload({ deviceType: 'treadmill', variant: 'treadmill', achievements: { 'trailtrainer:ten-k': { t: '', sessionId: 'x' } } }), {
      routeId: 'alpe-dhuez', routeLength: 14700, startAt: 9000, client: fakeClient(),
    })
    p.attach()
    p.request(6)
    p.report(report(10_200), 0.1, true)
    const first = p.buildTick()!
    expect(first.incline).toBe(6)
    expect(first.grade).toBeUndefined()
    expect(first.speed).toBeUndefined()
    // resumed (started 9 km in) and first-session (more than 100 m ridden); ten-k was already earned
    expect(first.achievements?.sort()).toEqual(['first-session', 'resumed'])
    p.report(report(14_700, true), 0.1, true)
    expect(p.buildTick()!.achievements?.sort()).toEqual(['end-to-end', 'summit'])
    expect(p.buildTick()!.achievements).toBeUndefined()
  })

  it('measured() is null until the server has said anything, and passes nulls through', () => {
    const p = new PlatformControls(startPayload(), { routeId: 'r', routeLength: 1000, startAt: 0, client: fakeClient() })
    expect(p.measured()).toEqual({ power: null, speed: null, cadence: null, heartRate: null })
    expect(p.elapsedSeconds()).toBe(0)
    p.report(report(0), 2, true)
    expect(p.elapsedSeconds()).toBe(2)
    expect(p.timeUp()).toBe(false)
  })

  it('measured() passes the actual readings through, nulls included, and follows activeSeconds', () => {
    let opts: SessionClientOptions | null = null
    const p = new PlatformControls(startPayload({ requestedDuration: 60 }), {
      routeId: 'r', routeLength: 1000, startAt: 0,
      client: (o) => { opts = o; return fakeClient()(o) },
    })
    const m = (actual: number | null) => ({ requested: null, commanded: null, actual })
    opts!.onState!({ power: m(212), speed: m(null), cadence: m(0), heartRate: m(null), activeSeconds: 61 } as unknown as GameState)
    expect(p.measured()).toEqual({ power: 212, speed: null, cadence: 0, heartRate: null })
    expect(p.elapsedSeconds()).toBe(61)
    expect(p.timeUp()).toBe(true)
  })
})
