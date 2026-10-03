import { describe, expect, test } from 'vitest'
import {
  addWeeks,
  biggestProblem,
  cleanVsFlagged,
  enrich,
  groupBy,
  hourBucket,
  inScope,
  revengeIds,
  summarize,
  weekBounds,
  weekdayLabel,
  weekStartOf,
  weekSummary,
} from '../src/lib/stats'
import { mk } from './helpers'

const noSetups = new Map<string, string>()

describe('週次（台北時間）', () => {
  test('週日 23:59 屬於前一週', () => expect(weekStartOf('2026-10-04T15:59:00Z')).toBe('2026-09-28'))
  test('週一 00:00 屬於新的一週', () => expect(weekStartOf('2026-10-04T16:00:00Z')).toBe('2026-10-05'))
  test('跨年', () => expect(weekStartOf('2027-01-01T04:00:00Z')).toBe('2026-12-28'))
  test('addWeeks 跨年', () => expect(addWeeks('2026-12-28', 1)).toBe('2027-01-04'))
  test('addWeeks 往前', () => expect(addWeeks('2026-10-05', -2)).toBe('2026-09-21'))
  test('weekBounds', () => {
    const b = weekBounds('2026-10-05')
    expect(b.start.toISOString()).toBe('2026-10-04T16:00:00.000Z')
    expect(b.end.toISOString()).toBe('2026-10-11T16:00:00.000Z')
  })
})

describe('時段與星期', () => {
  test('台北 03:59 → 00–04', () => expect(hourBucket('2026-10-04T19:59:00Z')).toBe('00–04'))
  test('台北 04:00 → 04–08', () => expect(hourBucket('2026-10-04T20:00:00Z')).toBe('04–08'))
  test('台北 23:00 → 20–24', () => expect(hourBucket('2026-10-04T15:00:00Z')).toBe('20–24'))
  test('台北週一', () => expect(weekdayLabel('2026-10-04T16:00:00Z')).toBe('週一'))
  test('台北週日', () => expect(weekdayLabel('2026-10-04T15:59:00Z')).toBe('週日'))
})

describe('revengeIds', () => {
  const loser = mk({ r: -1, closed_at: '2026-10-06T02:00:00Z' })
  test('虧損平倉後 30 分鐘內開倉', () => {
    const b = mk({ opened_at: '2026-10-06T02:30:00Z', closed_at: '2026-10-06T03:00:00Z' })
    expect(revengeIds([loser, b]).has(b.id)).toBe(true)
  })
  test('31 分鐘不算', () => {
    const b = mk({ opened_at: '2026-10-06T02:31:00Z', closed_at: '2026-10-06T03:00:00Z' })
    expect(revengeIds([loser, b]).has(b.id)).toBe(false)
  })
  test('前一筆獲利不算', () => {
    const winner = mk({ r: 1, closed_at: '2026-10-06T02:00:00Z' })
    const b = mk({ opened_at: '2026-10-06T02:10:00Z', closed_at: '2026-10-06T03:00:00Z' })
    expect(revengeIds([winner, b]).has(b.id)).toBe(false)
  })
  test('未平倉的新單也算', () => {
    const b = mk({ opened_at: '2026-10-06T02:00:00Z', closed_at: null, exit_price: null, exit_reason: null })
    expect(revengeIds([loser, b]).has(b.id)).toBe(true)
  })
  test('在虧損單平倉前開的不算', () => {
    const b = mk({ opened_at: '2026-10-06T01:59:00Z', closed_at: '2026-10-06T03:00:00Z' })
    expect(revengeIds([loser, b]).has(b.id)).toBe(false)
  })
})

describe('enrich', () => {
  test('排除未平倉', () => {
    const open = mk({ closed_at: null, exit_price: null, exit_reason: null })
    expect(enrich([open, mk()], 10)).toHaveLength(1)
  })
  test('手動與自動警示合併去重', () => {
    const t = mk({ final_stop: 94, mistake_tags: ['stop_widened', 'chasing'] })
    expect(enrich([t], 10)[0].keys.sort()).toEqual(['chasing', 'stop_widened'])
  })
  test('報復單進 keys', () => {
    const a = mk({ r: -1, closed_at: '2026-10-06T02:00:00Z' })
    const b = mk({ opened_at: '2026-10-06T02:05:00Z', closed_at: '2026-10-06T03:00:00Z' })
    expect(enrich([a, b], 10).find((e) => e.trade.id === b.id)!.keys).toEqual(['revenge'])
  })
  test('r 與估算損益', () => {
    const e = enrich([mk({ r: 2 })], 10)[0]
    expect(e.r).toBe(2)
    expect(e.pnl).toBe(20)
    expect(e.pnlEstimated).toBe(true)
  })
})

describe('summarize', () => {
  test('基本指標', () => {
    const s = summarize(enrich([mk({ r: 2 }), mk({ r: -1 }), mk({ r: 0 })], 10))
    expect(s).toEqual({ n: 3, wins: 1, winRate: 1 / 3, totalR: 1, avgR: 0.33, pnl: 10 })
  })
  test('空清單', () => expect(summarize([])).toEqual({ n: 0, wins: 0, winRate: 0, totalR: 0, avgR: 0, pnl: 0 }))
})

describe('groupBy', () => {
  test('紀律：沒有鍵的不出現、一筆兩鍵出現兩組', () => {
    const list = enrich([mk({ mistake_tags: ['chasing', 'unplanned'] }), mk()], 10)
    const rows = groupBy(list, 'discipline', noSetups)
    expect(rows.map((r) => r.label).sort()).toEqual(['計畫外交易', '追價'])
    expect(rows.every((r) => r.stats.n === 1)).toBe(true)
  })
  test('n < 5 標樣本太少', () => {
    const list = enrich([mk(), mk(), mk(), mk(), mk({ symbol: 'ETHUSDT' })], 10)
    const rows = groupBy(list, 'symbol', noSetups)
    expect(rows.find((r) => r.key === 'BTCUSDT')!.lowSample).toBe(true)
    const five = enrich([mk(), mk(), mk(), mk(), mk()], 10)
    expect(groupBy(five, 'symbol', noSetups)[0].lowSample).toBe(false)
  })
  test('setup 為 null 顯示未分類', () => {
    const rows = groupBy(enrich([mk(), mk({ setup_id: 's1' })], 10), 'setup', new Map([['s1', '突破回踩']]))
    expect(rows.map((r) => r.label).sort()).toEqual(['未分類', '突破回踩'])
  })
  test('依總 R 由小到大', () => {
    const rows = groupBy(enrich([mk({ symbol: 'A', r: 2 }), mk({ symbol: 'B', r: -1 })], 10), 'symbol', noSetups)
    expect(rows.map((r) => r.key)).toEqual(['B', 'A'])
  })
  test('方向標籤', () => {
    const rows = groupBy(enrich([mk()], 10), 'direction', noSetups)
    expect(rows[0].label).toBe('做多')
  })
})

describe('inScope', () => {
  const week = '2026-10-05'
  const list = enrich(
    [
      mk({ closed_at: '2026-10-06T02:00:00Z' }), // 本週
      mk({ opened_at: '2026-09-20T00:00:00Z', closed_at: '2026-09-21T02:00:00Z' }), // 前 2 週
      mk({ opened_at: '2026-08-01T00:00:00Z', closed_at: '2026-08-01T02:00:00Z' }), // 很久以前
    ],
    10,
  )
  test('本週', () => expect(inScope(list, 'week', week)).toHaveLength(1))
  test('近 4 週', () => expect(inScope(list, '4w', week)).toHaveLength(2))
  test('全部', () => expect(inScope(list, 'all', week)).toHaveLength(3))
})

describe('biggestProblem', () => {
  test('同分時紀律優先', () => {
    const week = enrich(
      [
        mk({ r: -1, mistake_tags: ['revenge'], setup_id: 's1', symbol: 'A' }),
        mk({ r: -1, mistake_tags: ['revenge'], setup_id: 's1', symbol: 'B' }),
      ],
      10,
    )
    const p = biggestProblem(week, new Map([['s1', '突破']]))!
    expect(p.dimension).toBe('discipline')
    expect(p.label).toBe('報復單')
    expect(p.totalR).toBe(-2)
    expect(p.n).toBe(2)
    expect(p.share).toBe(1)
  })
  test('選總 R 最負的組', () => {
    // setup s1 = −2；方向、時段也是 −2，但 setup 優先；幣種最多 −1
    const week = enrich(
      [
        mk({ r: -1, symbol: 'A', setup_id: 's2' }),
        mk({ r: -1, symbol: 'B', setup_id: 's1' }),
        mk({ r: -1, symbol: 'C', setup_id: 's1' }),
        mk({ r: 1, symbol: 'B', setup_id: 's3' }),
      ],
      10,
    )
    const p = biggestProblem(week, new Map([['s1', '突破'], ['s2', '回踩'], ['s3', '假突破']]))!
    expect(p.dimension).toBe('setup')
    expect(p.label).toBe('突破')
    expect(p.totalR).toBe(-2)
    expect(p.share).toBeCloseTo(2 / 3)
  })
  test('佔比上限 1', () => {
    const week = enrich([mk({ r: -2 }), mk({ r: -0.5 })], 10)
    expect(biggestProblem(week, noSetups)!.share).toBeLessThanOrEqual(1)
  })
  test('沒有虧損回 null', () => expect(biggestProblem(enrich([mk({ r: 1 })], 10), noSetups)).toBeNull())
  test('空週回 null', () => expect(biggestProblem([], noSetups)).toBeNull())
})

describe('cleanVsFlagged', () => {
  test('依有無紀律鍵分流', () => {
    const r = cleanVsFlagged(enrich([mk({ r: 2 }), mk({ r: -1, mistake_tags: ['chasing'] }), mk({ r: -1, mistake_tags: ['unplanned'] })], 10))
    expect(r.clean.n).toBe(1)
    expect(r.clean.totalR).toBe(2)
    expect(r.flagged.n).toBe(2)
    expect(r.flagged.totalR).toBe(-2)
  })
})

describe('weekSummary', () => {
  test('上週與前 4 週平均', () => {
    const at = (week: string, r: number) => {
      const { start } = weekBounds(week)
      const iso = new Date(start.getTime() + 3600_000).toISOString()
      return mk({ r, opened_at: iso, closed_at: iso })
    }
    const all = enrich(
      [at('2026-10-05', 1), at('2026-09-28', 1), at('2026-09-14', -2), at('2026-09-07', 3), at('2026-08-31', 100)],
      10,
    )
    const s = weekSummary(all, '2026-10-05')
    expect(s.current.totalR).toBe(1)
    expect(s.prevTotalR).toBe(1)
    expect(s.avg4TotalR).toBe(0.5) // [1, 0, −2, 3]
  })
})
