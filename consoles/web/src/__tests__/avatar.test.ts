import { describe, expect, test } from 'vitest'
import { initialAvatar, withAvatar } from '../avatar'

const spec = { v: 2, macros: { Gender: 0.7 } }

describe('withAvatar', () => {
  test('sets the avatar and keeps the rest of the profile', () => {
    expect(withAvatar({ bio: 'hi', avatar: { v: 1 } }, spec)).toEqual({ bio: 'hi', avatar: spec })
  })
  test('works on an empty or missing profile', () => {
    expect(withAvatar(undefined, spec)).toEqual({ avatar: spec })
    expect(withAvatar(null, spec)).toEqual({ avatar: spec })
  })
})

describe('initialAvatar', () => {
  test('the profile wins', () => {
    expect(initialAvatar({ avatar: spec }, JSON.stringify({ v: 2, macros: {} }))).toEqual(spec)
  })
  test('falls back to one left in this browser', () => {
    expect(initialAvatar({}, JSON.stringify(spec))).toEqual(spec)
    expect(initialAvatar(undefined, JSON.stringify(spec))).toEqual(spec)
  })
  test('nothing stored anywhere means the kit default', () => {
    expect(initialAvatar({}, null)).toBeUndefined()
  })
  test('junk is ignored rather than thrown', () => {
    expect(initialAvatar({}, '{oops')).toBeUndefined()
    expect(initialAvatar({}, '"a string"')).toBeUndefined()
    expect(initialAvatar({ avatar: 'not an object' }, null)).toBeUndefined()
  })
})
