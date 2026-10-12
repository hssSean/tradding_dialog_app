import { describe, expect, test } from 'vitest'
import { canonicalQuery, convertPosition, findMatch, mergePatch, parseBingxJson, toBingxSymbol, type BxOrder, type BxPosition } from '../src/sync/bingx'

// 2026-10-12 真實資料：ADA-USDT 10/11 14:07（台北）做空，掛止損 0.2486、止盈 0.2422，止損被觸發
const T = (s: string) => Date.parse(s)
const pos: BxPosition = {
  positionId: '2109163858748985346',
  symbol: 'ADA-USDT',
  positionSide: 'SHORT',
  openTime: T('2026-10-11T06:07:00Z'),
  updateTime: T('2026-10-11T07:03:00Z'),
  avgPrice: '0.2465',
  avgClosePrice: '0.2484',
  netProfit: '-6.2748',
  closeAllPositions: true,
}
const order = (o: Partial<BxOrder>): BxOrder => ({
  orderId: '1',
  symbol: 'ADA-USDT',
  type: 'MARKET',
  status: 'FILLED',
  side: 'SELL',
  positionSide: 'SHORT',
  stopPrice: '',
  avgPrice: '0',
  time: pos.openTime,
  updateTime: pos.openTime,
  reduceOnly: false,
  positionID: pos.positionId,
  ...o,
})
const orders: BxOrder[] = [
  order({ type: 'LIMIT' }),
  order({ type: 'TAKE_PROFIT_MARKET', status: 'CANCELLED', side: 'BUY', stopPrice: '0.2422', time: T('2026-10-11T06:21:00Z'), reduceOnly: true }),
  order({ type: 'STOP_MARKET', side: 'BUY', stopPrice: '0.2486', time: T('2026-10-11T07:03:00Z'), updateTime: T('2026-10-11T07:03:00Z'), reduceOnly: true }),
]

describe('簽章字串', () => {
  test('依 key 的 ASCII 排序、不編碼（官方文件範例）', () => {
    expect(canonicalQuery({ type: 'MARKET', symbol: 'BTC-USDT', timestamp: 170273150000, limit: 100, recvWindow: 5000 })).toBe(
      'limit=100&recvWindow=5000&symbol=BTC-USDT&timestamp=170273150000&type=MARKET',
    )
  })
})

describe('parseBingxJson', () => {
  test('大數 positionID 不失準', () => {
    const r = parseBingxJson<{ orders: { positionID: string; orderId: string; price: number }[] }>(
      '{"orders":[{"positionID":2107726997673431042,"orderId":1975393217425637376,"price":1.5}]}',
    )
    expect(r.orders[0].positionID).toBe('2107726997673431042')
    expect(r.orders[0].orderId).toBe('1975393217425637376')
    expect(r.orders[0].price).toBe(1.5)
  })
})

describe('convertPosition', () => {
  test('ADA 實例：方向、價格、損益、止損、目標、出場原因', () => {
    expect(convertPosition(pos, orders)).toEqual({
      external_id: '2109163858748985346',
      symbol: 'ADAUSDT',
      direction: 'short',
      opened_at: '2026-10-11T06:07:00.000Z',
      closed_at: '2026-10-11T07:03:00.000Z',
      entry_price: 0.2465,
      exit_price: 0.2484,
      pnl_usdt: -6.2748,
      planned_stop: 0.2486,
      final_stop: 0.2486,
      stop_edits: [],
      planned_target: 0.2422,
      exit_reason: 'stop',
    })
  })
  test('改止損單記成移動止損', () => {
    const moved = [
      order({ type: 'STOP_MARKET', status: 'CANCELLED', stopPrice: '0.2486', time: T('2026-10-11T06:10:00Z'), reduceOnly: true }),
      order({ type: 'STOP_MARKET', status: 'CANCELLED', stopPrice: '0.2500', time: T('2026-10-11T06:30:00Z'), reduceOnly: true }),
      order({ type: 'STOP_MARKET', stopPrice: '0.2500', time: T('2026-10-11T06:40:00Z'), reduceOnly: true }),
    ]
    const r = convertPosition(pos, moved)
    expect(r.planned_stop).toBe(0.2486)
    expect(r.stop_edits).toEqual([{ at: '2026-10-11T06:30:00.000Z', from: 0.2486, to: 0.25 }])
    expect(r.final_stop).toBe(0.25)
  })
  test('沒有止損單 → 待補止損', () => {
    const r = convertPosition(pos, [order({ type: 'LIMIT' })])
    expect(r.planned_stop).toBeNull()
    expect(r.exit_reason).toBe('other')
  })
  test('第一張止損單在獲利那一側（直接設保本以上）→ 不能當初始止損', () => {
    const r = convertPosition(pos, [order({ type: 'STOP_MARKET', stopPrice: '0.2400', reduceOnly: true })])
    expect(r.planned_stop).toBeNull()
  })
  test('別的倉位的訂單不算', () => {
    const r = convertPosition(pos, [order({ type: 'STOP_MARKET', stopPrice: '0.2486', reduceOnly: true, positionID: '999' })])
    expect(r.planned_stop).toBeNull()
  })
  test('單向持倉（BOTH）看開倉單方向', () => {
    const r = convertPosition({ ...pos, positionSide: 'BOTH' }, [order({ positionSide: 'BOTH', side: 'BUY' })])
    expect(r.direction).toBe('long')
  })
  test('toBingxSymbol', () => expect(toBingxSymbol('ADAUSDT')).toBe('ADA-USDT'))
})

describe('findMatch', () => {
  const imp = convertPosition(pos, orders)
  const c = (o: Partial<Parameters<typeof findMatch>[1][number]>) => ({
    id: 'x',
    symbol: 'ADAUSDT',
    direction: 'short' as const,
    opened_at: null,
    card_at: null,
    abandoned_at: null,
    external_id: null,
    ...o,
  })
  test('手動記的交易，進場時間差 30 分鐘內', () => {
    expect(findMatch(imp, [c({ id: 'a', opened_at: '2026-10-11T06:24:00Z' })], new Set())).toBe('a') // 日誌記 14:24，實際 14:07
    expect(findMatch(imp, [c({ id: 'a', opened_at: '2026-10-11T06:38:00Z' })], new Set())).toBeNull()
  })
  test('作戰卡在開倉前 12 小時內', () => {
    expect(findMatch(imp, [c({ id: 'k', card_at: '2026-10-10T18:07:00Z' })], new Set())).toBe('k')
    expect(findMatch(imp, [c({ id: 'k', card_at: '2026-10-10T18:06:00Z' })], new Set())).toBeNull()
    expect(findMatch(imp, [c({ id: 'k', card_at: '2026-10-11T06:08:00Z' })], new Set())).toBeNull() // 開倉後才立的卡
  })
  test('方向、幣種不同或已對過帳不算；取最接近的', () => {
    const cands = [
      c({ id: 'long', direction: 'long', opened_at: '2026-10-11T06:07:00Z' }),
      c({ id: 'done', opened_at: '2026-10-11T06:07:00Z', external_id: '1' }),
      c({ id: 'far', opened_at: '2026-10-11T06:30:00Z' }),
      c({ id: 'near', opened_at: '2026-10-11T06:10:00Z' }),
    ]
    expect(findMatch(imp, cands, new Set())).toBe('near')
    expect(findMatch(imp, cands, new Set(['near']))).toBe('far')
  })
})

describe('mergePatch', () => {
  const imp = convertPosition(pos, orders)
  const none = { planned_stop: null, planned_target: null, exit_reason: null, stop_edits: [] }
  test('BingX 的事實覆蓋，使用者填的止損、目標、出場原因保留', () => {
    const p = mergePatch({ planned_stop: 0.2486, planned_target: 0.24, exit_reason: 'manual_early', stop_edits: [] }, imp)
    expect(p).toMatchObject({ entry_price: 0.2465, pnl_usdt: -6.2748, planned_stop: 0.2486, planned_target: 0.24, exit_reason: 'manual_early' })
    expect(p.stop_edits).toEqual([])
  })
  test('使用者沒填的用 BingX 的', () => {
    expect(mergePatch(none, imp)).toMatchObject({ planned_stop: 0.2486, planned_target: 0.2422, exit_reason: 'stop', final_stop: 0.2486 })
  })
  test('作戰卡的初始止損和 BingX 最後止損不同 → 記一筆移動（SUI 實例：卡 1.1834、BingX 1.17）', () => {
    const sui = { ...imp, direction: 'long' as const, entry_price: 1.1931, planned_stop: 1.17, final_stop: 1.17, closed_at: '2026-10-07T00:23:00.000Z' }
    const p = mergePatch({ ...none, planned_stop: 1.1834 }, sui)
    expect(p.planned_stop).toBe(1.1834)
    expect(p.stop_edits).toEqual([{ at: '2026-10-07T00:23:00.000Z', from: 1.1834, to: 1.17 }])
  })
  test('App 裡已記過的移動保留，最後一筆已經是 BingX 的價位就不重複', () => {
    const edits = [{ at: '2026-10-11T06:30:00Z', from: 0.249, to: 0.2486 }]
    const p = mergePatch({ ...none, planned_stop: 0.249, stop_edits: edits }, imp)
    expect(p.stop_edits).toEqual(edits)
  })
})
