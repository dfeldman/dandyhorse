import { describe, expect, test } from 'vitest'
import { pickNext, type Rect } from '../focus'
import { keyToPress, nextSince } from '../remote'

const r = (x: number, y: number, w = 100, h = 40): Rect => ({ x, y, w, h })

describe('pickNext (spatial navigation)', () => {
  const from = r(100, 100)
  test('down picks the nearer of two below and ignores anything above', () => {
    const cands = [r(100, 20), r(100, 300), r(100, 160)]
    expect(pickNext(from, cands, 'down')).toBe(2)
    expect(pickNext(from, cands, 'up')).toBe(0)
  })
  test('down prefers the same column over a nearer element far to the side', () => {
    const cands = [r(600, 150), r(100, 220)]
    expect(pickNext(from, cands, 'down')).toBe(1)
  })
  test('right picks the nearest to the right, ties broken by vertical offset', () => {
    const cands = [r(220, 100), r(220, 130), r(20, 100)]
    expect(pickNext(from, cands, 'right')).toBe(0)
    expect(pickNext(from, cands, 'left')).toBe(2)
  })
  test('nothing in that direction gives -1', () => {
    expect(pickNext(from, [r(100, 20)], 'down')).toBe(-1)
    expect(pickNext(from, [], 'left')).toBe(-1)
  })
})

describe('keyToPress', () => {
  const el = (tag: string, type?: string) => ({ tagName: tag.toUpperCase(), type } as unknown as Element)
  test('arrows, enter and escape map on plain elements', () => {
    expect(keyToPress('ArrowDown', el('button'))).toBe('down')
    expect(keyToPress('Enter', el('a'))).toBe('select')
    expect(keyToPress('Escape', null)).toBe('back')
    expect(keyToPress('a', el('button'))).toBeNull()
  })
  test('keys with a native meaning on the focused control are left alone', () => {
    expect(keyToPress('ArrowLeft', el('input', 'text'))).toBeNull()
    expect(keyToPress('ArrowUp', el('input', 'text'))).toBe('up')
    expect(keyToPress('ArrowUp', el('input', 'number'))).toBeNull()
    expect(keyToPress('ArrowDown', el('select'))).toBeNull()
    expect(keyToPress('ArrowLeft', el('select'))).toBe('left')
    expect(keyToPress('Enter', el('input', 'text'))).toBeNull()
    expect(keyToPress('Enter', el('input', 'checkbox'))).toBe('select')
    expect(keyToPress('Escape', el('input', 'text'))).toBe('back')
  })
})

describe('nextSince', () => {
  test('advances with the server counter and resets when it goes backwards (server restart)', () => {
    expect(nextSince(5, 7)).toBe(7)
    expect(nextSince(7, 7)).toBe(7)
    expect(nextSince(7, 2)).toBe(2)
  })
})
