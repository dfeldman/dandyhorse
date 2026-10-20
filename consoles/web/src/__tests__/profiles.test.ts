import { describe, expect, test } from 'vitest'
import { countryName, countryOptions, flag, flagOrCode } from '../flags'
import { groupBoards, ordinal, playerName, rankBadge, streakIcon, streakText, updateIcon } from '../profiles'
import type { Board } from '../types'

const board = (id: string, period: Board['period']): Board => ({
  id, title: id, subtitle: '', period, unit: 'count', device: null, lowerIsBetter: false,
  periodKey: 'all', players: 0, me: null,
})

describe('flags', () => {
  test('a code becomes a flag', () => {
    expect(flag('es')).toBe('🇪🇸')
    expect(flag('')).toBe('')
    expect(flag('ESP')).toBe('')
    expect(flagOrCode('gb')).toBe('🇬🇧')
    expect(flagOrCode('nope')).toBe('')
    expect(countryName('PT')).toBe('Portugal')
  })

  test('the picker lists real countries only', () => {
    const list = countryOptions()
    expect(list.length).toBeGreaterThan(180)
    expect(list.length).toBeLessThan(400)
    expect(list.find((c) => c.code === 'ES')?.name).toBe('Spain')
    // 'QQ' is not a country, so it is not offered
    expect(list.find((c) => c.code === 'QQ')).toBeUndefined()
    // sorted by the name people read
    expect([...list].sort((a, b) => a.name.localeCompare(b.name))[0].name).toBe(list[0].name)
  })
})

describe('playerName', () => {
  test('prefers a real name, then a display name, then the handle', () => {
    expect(playerName({ firstName: 'Ana', lastName: 'Ruiz', displayName: 'nope', username: 'ar' })).toBe('Ana Ruiz')
    expect(playerName({ firstName: 'Ana', lastName: '', displayName: 'nope', username: 'ar' })).toBe('Ana')
    expect(playerName({ firstName: '', lastName: '', displayName: 'Dash', username: 'ar' })).toBe('Dash')
    expect(playerName({ firstName: '', lastName: '', displayName: '', username: 'ar' })).toBe('ar')
  })
})

describe('streaks', () => {
  test('a goal with no streak yet is an unlit candle', () => {
    expect(streakIcon({ goal: 2, length: 0 })).toBe('🕯️')
    expect(streakIcon({ goal: 2, length: 3 })).toBe('🔥')
    expect(streakIcon({ goal: 0, length: 0 })).toBe('')
    expect(streakIcon(undefined)).toBe('')
  })

  test('words for each state', () => {
    expect(streakText({ goal: 0, length: 0 })).toBe('')
    expect(streakText({ goal: 3, length: 0 })).toBe('aiming for 3 a week')
    expect(streakText({ goal: 1, length: 1 })).toBe('1 week at 1 a week')
    expect(streakText({ goal: 2, length: 7 })).toBe('7 weeks at 2 a week')
  })
})

describe('ranks', () => {
  test('ordinals, including the teens', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 101, 111].map(ordinal))
      .toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '101st', '111th'])
  })

  test('the podium gets medals', () => {
    expect([1, 2, 3, 4].map(rankBadge)).toEqual(['🥇', '🥈', '🥉', '4'])
    expect(rankBadge(null)).toBe('—')
  })
})

describe('groupBoards', () => {
  test('this week first, and empty groups left out', () => {
    const groups = groupBoards([board('a', 'all'), board('w', 'week'), board('m', 'month')])
    expect(groups.map((g) => g.title)).toEqual(['This week', 'This month', 'All time'])
    expect(groupBoards([board('a', 'all')]).map((g) => g.title)).toEqual(['All time'])
    expect(groupBoards([])).toEqual([])
  })
})

describe('updateIcon', () => {
  test('one glyph per kind', () => {
    expect(updateIcon('session')).toBe('🚴')
    expect(updateIcon('streak')).toBe('🔥')
    expect(updateIcon('manual')).toBe('💬')
  })
})
