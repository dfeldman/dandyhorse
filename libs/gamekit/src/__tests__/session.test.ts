import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { setFetch } from '../api'
import { SessionClient } from '../session'
import type { GameState } from '../types'

/** A tiny fake server: a state the test mutates, a setstate log, an endsession stub. */
function fakeServer(state: GameState) {
  const sets: unknown[] = []
  const calls: string[] = []
  setFetch(async (input, init) => {
    const url = String(input)
    calls.push(`${init?.method ?? 'GET'} ${url.split('?')[0]}`)
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
    if (url.startsWith('/gameapi/getstate')) return json(state)
    if (url === '/gameapi/setstate') { sets.push(JSON.parse(String(init?.body))); return json({ seq: state.seq, sessionStatus: state.sessionStatus }) }
    if (url === '/gameapi/endsession') { state.sessionStatus = 'complete'; return json({ status: 'complete', endReason: 'completed', pausedSeconds: 0 }) }
    if (url.includes('/image')) return json({ ok: true, imageUrl: '/api/sessions/s1/image', bytes: 10 })
    return json({ error: { code: 'nope', message: 'no' } }, 404)
  })
  return { sets, calls }
}

const base = (): GameState => ({
  sessionId: 's1', sessionStatus: 'active', endReason: null, seq: 1, serverTime: 1000, elapsed: 0, requestedDuration: 600,
  pause: null, pausedSeconds: 0, position: null, distance: 0, energy: 0, work: null, input: null, inputs: [], requestedInput: null,
  bridges: [], owner: { fitness: null, hrm: null }, devicePreferences: {}, custom: null,
  speed: { requested: null, commanded: null, actual: 2 }, incline: { requested: null, commanded: null, actual: 0 },
  cadence: { requested: null, commanded: null, actual: null }, power: { requested: null, commanded: null, actual: null },
  grade: { requested: null, commanded: null, actual: null }, wind: { requested: null, commanded: null, actual: null },
  crr: { requested: null, commanded: null, actual: null }, cw: { requested: null, commanded: null, actual: null },
  heartRate: { requested: null, commanded: null, actual: null },
})

describe('SessionClient', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('pause and resume callbacks fire once per transition; inputs delivered in order; end uploads the image', async () => {
    const state = base()
    const srv = fakeServer(state)
    const events: string[] = []
    const c = new SessionClient({
      sessionId: 's1',
      buildTick: () => ({ incline: 2 }),
      onPause: (p) => events.push(`pause:${p.reason}`),
      onResume: (s) => events.push(`resume:${s}`),
      onInput: (i) => events.push(`input:${i.choice}`),
      onEnded: (e) => events.push(`ended:${e.status}`),
      sessionImage: () => 'data:image/png;base64,AAAA',
    })
    // first state: an old answer is skipped, not replayed
    state.inputs = [{ promptId: 'd', choice: 'old', t: 1, source: 'bridge:a', n: 5 }]
    c.handleState(state)
    // two new taps
    state.inputs = [...state.inputs, { promptId: 'd', choice: 'left', t: 2, source: 'bridge:a', n: 6 }, { promptId: 'd', choice: 'up', t: 3, source: 'bridge:a', n: 7 }]
    c.handleState({ ...state, seq: 2 })
    // pause, same pause again (no duplicate), resume
    c.handleState({ ...state, seq: 3, sessionStatus: 'paused', serverTime: 1010, pause: { reason: 'bridge_silent', message: 'x', since: 1005, seconds: 5, bridgeId: null, bridgeLabel: null, deviceName: null, deviceStatus: null } })
    c.handleState({ ...state, seq: 4, sessionStatus: 'paused', serverTime: 1011, pause: { reason: 'bridge_silent', message: 'x', since: 1005, seconds: 6, bridgeId: null, bridgeLabel: null, deviceName: null, deviceStatus: null } })
    c.handleState({ ...state, seq: 5, sessionStatus: 'active', serverTime: 1012 })
    expect(c.paused).toBe(false)
    await c.end('complete')
    expect(events).toEqual(['input:left', 'input:up', 'pause:bridge_silent', 'resume:7', 'ended:complete'])
    expect(srv.calls.filter((x) => x.includes('/image')).length).toBe(1)
    expect(srv.calls.indexOf('PUT /gameapi/sessions/s1/image')).toBeLessThan(srv.calls.indexOf('POST /gameapi/endsession'))
    expect(c.isEnded).toBe(true)
  })

  test('a session completed from elsewhere still uploads the session image, once', async () => {
    const state = base()
    const srv = fakeServer(state)
    const events: string[] = []
    const c = new SessionClient({ sessionId: 's1', buildTick: () => ({ incline: 0 }), onEnded: (e) => events.push(`ended:${e.status}`), sessionImage: () => 'data:image/png;base64,AAAA' })
    c.handleState(state)
    c.handleState({ ...state, seq: 2, sessionStatus: 'complete', endReason: 'bridge:tabA' })
    await vi.advanceTimersByTimeAsync(10)
    await c.end('complete') // a late end() from the game must not upload twice or call endsession
    expect(events).toEqual(['ended:complete'])
    expect(srv.calls.filter((x) => x === 'PUT /gameapi/sessions/s1/image').length).toBe(1)
    expect(srv.calls.includes('POST /gameapi/endsession')).toBe(false)
  })

  test('ticks carry the open prompt until it is closed, and setstate never runs twice at once', async () => {
    const state = base()
    const srv = fakeServer(state)
    const c = new SessionClient({ sessionId: 's1', buildTick: () => ({ incline: 1 }), wait: 0 })
    c.start()
    c.openPrompt({ promptId: 'p1', prompt: 'Which way?', choices: ['L', 'R'] })
    await vi.advanceTimersByTimeAsync(2500)
    c.closePrompt()
    await vi.advanceTimersByTimeAsync(1100)
    c.stop()
    const prompts = (srv.sets as { requestedInput: unknown }[]).map((b) => (b.requestedInput as { promptId?: string } | null)?.promptId ?? null)
    expect(prompts.some((p) => p === 'p1')).toBe(true)
    expect(prompts[prompts.length - 1]).toBeNull()
    expect((srv.sets[0] as { sessionId: string; incline: number }).incline).toBe(1)
  })
})
