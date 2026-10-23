import { describe, expect, test } from 'vitest'
import { chartRange, defaultInterval, missingShots, shotTitle } from '../src/lib/chartShots'
import type { RawTrade } from '../src/lib/types'
import { mk } from './helpers'

const M15 = 15 * 60_000

describe('missingShots', () => {
  const img = (trade_id: string, kind: 'entry' | 'exit') => ({ trade_id, kind })

  test('已平倉、沒有圖：補進場與出場', () => {
    const t = mk()
    expect(missingShots([t], []).map((s) => s.kind)).toEqual(['entry', 'exit'])
  })

  test('已有的格子不補（不覆蓋使用者上傳的圖）', () => {
    const t = mk()
    expect(missingShots([t], [img(t.id, 'entry')]).map((s) => s.kind)).toEqual(['exit'])
    expect(missingShots([t], [img(t.id, 'entry'), img(t.id, 'exit')])).toEqual([])
  })

  test('持倉中只補進場圖', () => {
    const t = mk({ closed_at: null, exit_price: null, exit_reason: null })
    expect(missingShots([t], []).map((s) => s.kind)).toEqual(['entry'])
  })

  test('止損未知、作戰卡、放棄的卡都不補', () => {
    const stopless: RawTrade = { ...mk(), planned_stop: null }
    const card = mk({ opened_at: null, closed_at: null })
    const abandoned = mk({ abandoned_at: '2026-10-06T03:00:00Z' })
    expect(missingShots([stopless, card, abandoned], [])).toEqual([])
  })
})

describe('chartRange', () => {
  // 進場 01:07，15 分 K 的那根從 01:00 開始
  const t = mk({ opened_at: '2026-10-06T01:07:00Z', closed_at: '2026-10-06T03:00:00Z' })
  const open = Date.parse('2026-10-06T01:00:00Z')

  test('進場圖結束在進場那根，看不到進場後的 K 線', () => {
    expect(chartRange(t, 'entry', '15m', Date.now())).toEqual({ start: Date.parse(t.opened_at!) - 60 * M15, end: open + M15 - 1 })
  })

  test('完整圖到出場後 30 根', () => {
    expect(chartRange(t, 'full', '15m', Date.now()).end).toBe(Date.parse(t.closed_at!) + 30 * M15)
  })

  test('完整圖不超過現在；未平倉以現在當出場', () => {
    const now = Date.parse('2026-10-06T03:30:00Z')
    expect(chartRange(t, 'full', '15m', now).end).toBe(now)
    const holding = mk({ opened_at: t.opened_at, closed_at: null })
    expect(chartRange(holding, 'full', '15m', now).end).toBe(now)
  })
})

describe('defaultInterval', () => {
  test('依持倉時間', () => {
    expect(defaultInterval(60 * 60_000)).toBe('5m')
    expect(defaultInterval(5 * 3_600_000)).toBe('15m')
    expect(defaultInterval(24 * 3_600_000)).toBe('1h')
  })
})

describe('shotTitle', () => {
  const t = mk({ symbol: 'ICPUSDT', direction: 'long', opened_at: '2026-10-12T13:30:00Z', closed_at: '2026-10-12T15:05:00Z' })
  test('進場圖寫進場時間（台北）', () => expect(shotTitle(t, 'entry', '15m')).toBe('ICPUSDT 做多 · 進場 · 15 分 · 10/12 21:30'))
  test('出場圖寫出場時間', () => expect(shotTitle({ ...t, direction: 'short' }, 'exit', '1h')).toBe('ICPUSDT 做空 · 出場 · 1 小時 · 10/12 23:05'))
})
