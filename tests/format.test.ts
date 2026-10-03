import { describe, expect, test } from 'vitest'
import { fmtDateTime, fmtPct, fmtR, fmtUsdt, fromLocalInput, parseNum, toLocalInput, weekTitle } from '../src/lib/format'

describe('format', () => {
  test('fmtR', () => {
    expect(fmtR(1.25)).toBe('+1.25R')
    expect(fmtR(-0.5)).toBe('−0.50R')
    expect(fmtR(0)).toBe('0.00R')
  })
  test('fmtUsdt', () => {
    expect(fmtUsdt(12.3)).toBe('+12.30')
    expect(fmtUsdt(-4)).toBe('−4.00')
  })
  test('fmtPct', () => expect(fmtPct(0.456)).toBe('46%'))
  test('fmtDateTime 台北', () => expect(fmtDateTime('2026-10-04T16:05:00Z')).toBe('10/05 00:05'))
  test('datetime-local 以台北解讀', () => {
    expect(fromLocalInput('2026-10-05T00:00')).toBe('2026-10-04T16:00:00.000Z')
    expect(toLocalInput('2026-10-04T16:00:00.000Z')).toBe('2026-10-05T00:00')
  })
  test('weekTitle', () => expect(weekTitle('2026-10-05')).toBe('10/05–10/11'))
  test('parseNum', () => {
    expect(parseNum('1,5')).toBe(1.5)
    expect(parseNum(' 2.5 ')).toBe(2.5)
    expect(parseNum('')).toBeNull()
    expect(parseNum('abc')).toBeNaN()
  })
})
