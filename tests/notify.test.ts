import { describe, expect, it } from 'vitest'
import { CLOSE_WINDOW_MS, closeEvents, dailyEvent, openDirection, openEvents, payloadOf, type BxOpenPosition } from '../src/notify/events'
import type { BxPosition } from '../src/sync/bingx'

const NOW = Date.parse('2026-11-13T14:30:00Z') // 台北 22:30

const pos = (over: Partial<BxOpenPosition> = {}): BxOpenPosition => ({
  positionId: '2107726997673431042',
  symbol: 'SOL-USDT',
  positionSide: 'LONG',
  positionAmt: '3',
  avgPrice: '150.5',
  createTime: NOW - 60_000,
  ...over,
})

const hist = (over: Partial<BxPosition> = {}): BxPosition => ({
  positionId: '900000000000000001',
  symbol: 'ETH-USDT',
  positionSide: 'SHORT',
  openTime: NOW - 5 * 3600_000,
  updateTime: NOW - 10 * 60_000,
  avgPrice: '3000',
  avgClosePrice: '2950',
  netProfit: '12.5',
  closeAllPositions: true,
  ...over,
})

describe('openDirection', () => {
  it('LONG／SHORT 照 positionSide', () => {
    expect(openDirection(pos())).toBe('long')
    expect(openDirection(pos({ positionSide: 'SHORT' }))).toBe('short')
  })
  it('單向持倉 BOTH 看 positionAmt 正負', () => {
    expect(openDirection(pos({ positionSide: 'BOTH', positionAmt: '-2' }))).toBe('short')
    expect(openDirection(pos({ positionSide: 'BOTH', positionAmt: '2' }))).toBe('long')
  })
})

describe('openEvents', () => {
  it('沒推過的持倉產生事件，日誌幣種去掉連字號', () => {
    const [e] = openEvents([pos()], new Set(), NOW)
    expect(e).toMatchObject({ kind: 'open', key: 'open:2107726997673431042', symbol: 'SOLUSDT', direction: 'long', entry: 150.5, openedAt: NOW - 60_000 })
  })
  it('推過的不再推', () => {
    expect(openEvents([pos()], new Set(['open:2107726997673431042']), NOW)).toEqual([])
  })
  it('開倉時間依序 createTime → openTime → updateTime → 現在', () => {
    expect(openEvents([pos({ createTime: undefined, openTime: 5 })], new Set(), NOW)[0]).toMatchObject({ openedAt: 5 })
    expect(openEvents([pos({ createTime: undefined, updateTime: 7 })], new Set(), NOW)[0]).toMatchObject({ openedAt: 7 })
    expect(openEvents([pos({ createTime: undefined })], new Set(), NOW)[0]).toMatchObject({ openedAt: NOW })
  })
})

describe('closeEvents', () => {
  it('2 小時內完全平倉的才推，win 看 netProfit', () => {
    const [e] = closeEvents([hist()], new Set(), NOW)
    expect(e).toMatchObject({ kind: 'close', key: 'close:900000000000000001', symbol: 'ETHUSDT', direction: 'short', win: true })
  })
  it('超過 2 小時、部分平倉、推過的都不推', () => {
    expect(closeEvents([hist({ updateTime: NOW - CLOSE_WINDOW_MS - 1 })], new Set(), NOW)).toEqual([])
    expect(closeEvents([hist({ closeAllPositions: false })], new Set(), NOW)).toEqual([])
    expect(closeEvents([hist()], new Set(['close:900000000000000001']), NOW)).toEqual([])
  })
  it('剛好 2 小時邊界算在內', () => {
    expect(closeEvents([hist({ updateTime: NOW - CLOSE_WINDOW_MS })], new Set(), NOW)).toHaveLength(1)
  })
  it('同一倉位在清單裡重複只推一次', () => {
    expect(closeEvents([hist(), hist()], new Set(), NOW)).toHaveLength(1)
  })
})

describe('dailyEvent', () => {
  it('台北 22 點那一小時、有待標記、今天沒推過才推', () => {
    expect(dailyEvent(3, new Set(), NOW)).toMatchObject({ kind: 'daily', key: 'daily:2026-11-13', count: 3 })
    expect(dailyEvent(0, new Set(), NOW)).toBeNull()
    expect(dailyEvent(3, new Set(['daily:2026-11-13']), NOW)).toBeNull()
    expect(dailyEvent(3, new Set(), Date.parse('2026-11-13T15:00:00Z'))).toBeNull() // 台北 23:00
    expect(dailyEvent(3, new Set(), Date.parse('2026-11-13T13:59:59Z'))).toBeNull() // 台北 21:59
  })
})

describe('payloadOf', () => {
  it('開倉網址帶齊合成交易需要的參數', () => {
    const p = payloadOf(openEvents([pos()], new Set(), NOW)[0])
    expect(p.url).toBe(`/tag/open/2107726997673431042?s=SOLUSDT&d=long&p=150.5&t=${NOW - 60_000}`)
    expect(p.title).toContain('SOLUSDT')
    expect(p.tag).toBe('open:2107726997673431042')
  })
  it('平倉與每日', () => {
    expect(payloadOf(closeEvents([hist()], new Set(), NOW)[0]).url).toBe('/tag/close/900000000000000001')
    expect(payloadOf({ kind: 'daily', key: 'daily:2026-11-13', count: 2 }).url).toBe('/inbox')
  })
})
