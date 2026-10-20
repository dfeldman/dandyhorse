import { describe, expect, it } from 'vitest'
import { CompetitorTracker, competitorName, fmtDistance, fmtSpeed, fromPayload } from '../competitor.ts'
import type { CompetitorPayload } from '../types.ts'

const player = {
  uid: 8, username: 'ana', displayName: 'Ana', firstName: 'Ana', lastName: 'Ruiz', country: 'ES',
  fitness: 165, thumbnailUrl: '/api/profiles/ana/thumbnail',
}

const payload: CompetitorPayload = {
  competitor: player,
  sessionId: 's1',
  startedAt: '2026-10-01T07:00:00Z',
  duration: 30,
  distance: 300,
  route: null,
  stats: { deliveries: 4 },
  progressKeys: ['deliveries'],
  timeline: [
    { elapsed: 0, distance: 0, speed: 0, progress: { deliveries: 0 } },
    { elapsed: 10, distance: 100, speed: 10, progress: { deliveries: 1 } },
    { elapsed: 30, distance: 300, speed: 10, progress: { deliveries: 4 } },
  ],
}

const track = () => new CompetitorTracker(fromPayload(payload)!)

describe('fromPayload', () => {
  it('is null when there is nobody, or nobody with a timeline', () => {
    expect(fromPayload({ competitor: null })).toBeNull()
    expect(fromPayload({ ...payload, timeline: [] })).toBeNull()
    expect(fromPayload(payload)!.player.username).toBe('ana')
  })
})

describe('CompetitorTracker.at', () => {
  it('interpolates the totals between the rows either side', () => {
    const t = track()
    expect(t.at(0).distance).toBe(0)
    expect(t.at(5).distance).toBe(50)
    expect(t.at(10).distance).toBe(100)
    expect(t.at(20).distance).toBe(200)
    expect(t.at(30).distance).toBe(300)
  })

  it('steps the progress counters instead of sliding them', () => {
    const t = track()
    // half way between one delivery and four, they had made one — never 2.5
    expect(t.at(20).progress.deliveries).toBe(1)
    expect(t.at(30).progress.deliveries).toBe(4)
  })

  it('holds the last row after their session ended, and says so', () => {
    const t = track()
    expect(t.at(99).distance).toBe(300)
    expect(t.at(99).finished).toBe(true)
    expect(t.at(10).finished).toBe(false)
  })

  it('works asked forwards, backwards and repeatedly', () => {
    const t = track()
    expect(t.at(25).distance).toBe(250)
    expect(t.at(5).distance).toBe(50)
    expect(t.at(25).distance).toBe(250)
    expect(t.at(25).distance).toBe(250)
  })

  it('reads speed from whichever row has it', () => {
    const t = track()
    expect(t.at(10).speed).toBe(10)
    expect(t.at(0).speed).toBe(0)
  })
})

describe('standing', () => {
  it('is ahead, behind or level on distance', () => {
    const t = track()
    expect(t.standing(10, { distance: 150 })).toBe('ahead')
    expect(t.standing(10, { distance: 50 })).toBe('behind')
    expect(t.standing(10, { distance: 100.5 })).toBe('level')
    // a game that tracks no distance makes no claim either way
    expect(t.standing(10, {})).toBe('level')
    expect(t.gap(10, { distance: 150 })).toBe(50)
    expect(t.gap(10, {})).toBe(0)
  })
})

describe('names and units', () => {
  it('prefers a first name, then a display name, then the username', () => {
    expect(competitorName(player)).toBe('Ana')
    expect(competitorName({ ...player, firstName: '' })).toBe('Ana')
    expect(competitorName({ ...player, firstName: '', displayName: '' })).toBe('ana')
  })

  it('formats both unit systems', () => {
    expect(fmtDistance(1400)).toBe('1.4 km')
    expect(fmtDistance(1609.344, true)).toBe('1.0 mi')
    expect(fmtSpeed(10)).toBe('36.0 km/h')
    expect(fmtSpeed(10, true)).toBe('22.4 mph')
  })
})
