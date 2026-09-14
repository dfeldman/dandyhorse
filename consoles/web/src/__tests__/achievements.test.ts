import { describe, expect, test } from 'vitest'
import { PLATFORM, groups, humanize, label } from '../achievements'
import type { Game } from '../types'

const game = (id: string, name: string, achievements?: Game['achievements']): Game => ({
  id, name, version: '1.0.0', author: null, description: null, capabilities: {}, screenshotUrl: null,
  entryUrl: `/games/${id}/index.html`, preferencesSchema: null, options: {}, variants: [], achievements,
})
const at = (t: string, sessionId = 's1') => ({ t, sessionId })

const plane = game('bikeplane', 'Flight Cycle', { turbo: { name: 'Turbo!', description: 'Filled the Turbo meter.' }, 'race-win': { name: 'Race winner' } })
const trek = game('kingdomtrek', 'Kingdom Trek')
const hills = game('rollinghills', 'Rolling Hills')

describe('names', () => {
  test('ids a game did not name are spelled out', () => {
    expect(humanize('level-5')).toBe('Level 5')
    expect(humanize('first_lap')).toBe('First lap')
  })
  test('a stored key gets the platform name, the game name, or its id spelled out', () => {
    expect(label('platform:first_session', [])).toBe('First ride')
    expect(label('bikeplane:turbo', [plane])).toBe('Turbo!')
    expect(label('bikeplane:streak-lap', [plane])).toBe('Streak lap')
    expect(label('gone:full-ride', [plane])).toBe('Full ride')
  })
})

describe('the page', () => {
  test('the platform first, every one of its; each game with what it names, then what else it gave', () => {
    const earned = {
      'platform:first_session': at('2026-09-14T10:00:00Z', 'a'),
      'bikeplane:turbo': at('2026-09-14T11:00:00Z', 'b'),
      'kingdomtrek:level-5': at('2026-09-13T09:00:00Z', 'c'),
    }
    const out = groups(earned, [plane, trek, hills])
    expect(out.map((g) => g.id)).toEqual(['platform', 'bikeplane', 'kingdomtrek'])
    expect(out[0]!.items).toHaveLength(Object.keys(PLATFORM).length)
    expect(out[0]!.earned).toBe(1)
    expect(out[1]!.items.map((i) => [i.name, !!i.earned])).toEqual([['Turbo!', true], ['Race winner', false]])
    expect(out[1]!.items[0]!.description).toBe('Filled the Turbo meter.')
    expect(out[2]!.items).toEqual([{ key: 'kingdomtrek:level-5', name: 'Level 5', description: null, earned: earned['kingdomtrek:level-5'] }])
  })
  test('achievements of a game no longer installed still show, after the rest', () => {
    const out = groups({ 'oldgame:won': at('2026-09-01T00:00:00Z') }, [plane])
    expect(out.map((g) => g.title)).toEqual(['Dandyhorse', 'Flight Cycle', 'Oldgame'])
    expect(out[2]!.items[0]!.name).toBe('Won')
  })
})
