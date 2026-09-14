import { describe, expect, test } from 'vitest'
import { extractUid } from '../session'

describe('extractUid', () => {
  test('search string', () => {
    expect(extractUid({ pathname: '/consoles/web/', search: '?uid=7', hash: '#/sessions' })).toEqual({ uid: 7, search: '', hash: '#/sessions' })
  })
  test('hash query', () => {
    expect(extractUid({ pathname: '/', search: '', hash: '#/?uid=3&x=1' })).toEqual({ uid: 3, search: '', hash: '#/?x=1' })
  })
  test('none', () => {
    expect(extractUid({ pathname: '/', search: '?a=b', hash: '#/games' })).toEqual({ uid: null, search: '?a=b', hash: '#/games' })
  })
  test('invalid uid ignored but stripped', () => {
    expect(extractUid({ pathname: '/', search: '?uid=abc', hash: '' })).toEqual({ uid: null, search: '', hash: '' })
  })
})
