import { describe, expect, test } from 'vitest'
import type { ClosedTrade, EntryInput, ExitInput } from '../src/lib/types'
import {
  normalizeSymbol,
  plannedRR,
  recentSymbols,
  riskPct,
  rMultiple,
  tagLabel,
  tradePnl,
  validateEntry,
  validateExit,
} from '../src/lib/trade'

function closed(over: Partial<ClosedTrade> = {}): ClosedTrade {
  return {
    id: 't1',
    user_id: 'u1',
    symbol: 'BTCUSDT',
    direction: 'long',
    setup_id: null,
    timeframe: '1h',
    opened_at: '2026-10-01T00:00:00Z',
    entry_price: 100,
    planned_stop: 95,
    planned_target: null,
    risk_usdt: 10,
    entry_reason: null,
    closed_at: '2026-10-01T05:00:00Z',
    exit_price: 110,
    final_stop: 95,
    exit_reason: 'target',
    pnl_usdt: null,
    mistake_tags: [],
    note: null,
    card_at: null,
    emotion: null,
    equity_at_entry: null,
    stop_edits: [],
    reviewed_at: null,
    abandoned_at: null,
    gamified: true,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    ...over,
  }
}

function entry(over: Partial<EntryInput> = {}): EntryInput {
  return {
    symbol: 'BTCUSDT',
    direction: 'long',
    setup_id: null,
    timeframe: null,
    opened_at: '2026-10-01T00:00:00Z',
    entry_price: 100,
    planned_stop: 95,
    planned_target: null,
    risk_usdt: 10,
    entry_reason: null,
    emotion: null,
    ...over,
  }
}

function exit(over: Partial<ExitInput> = {}): ExitInput {
  return {
    closed_at: '2026-10-01T05:00:00Z',
    exit_price: 110,
    final_stop: 95,
    exit_reason: 'target',
    pnl_usdt: null,
    mistake_tags: [],
    note: null,
    ...over,
  }
}

describe('rMultiple', () => {
  test('做多獲利', () => expect(rMultiple(closed())).toBe(2))
  test('做空獲利', () =>
    expect(rMultiple(closed({ direction: 'short', planned_stop: 105, exit_price: 90 }))).toBe(2))
  test('做多打到止損', () => expect(rMultiple(closed({ exit_price: 95 }))).toBe(-1))
  test('四捨五入到 0.01', () => expect(rMultiple(closed({ exit_price: 101 / 3 + 100 }))).toBe(6.73))
})

describe('plannedRR', () => {
  test('有目標', () => expect(plannedRR({ direction: 'long', entry_price: 100, planned_stop: 95, planned_target: 115 })).toBe(3))
  test('無目標', () => expect(plannedRR({ direction: 'long', entry_price: 100, planned_stop: 95, planned_target: null })).toBeNull())
})

describe('tradePnl', () => {
  test('有實際損益', () => expect(tradePnl(closed({ pnl_usdt: 12.5 }))).toEqual({ value: 12.5, estimated: false }))
  test('沒填就用 R × 風險估算', () => expect(tradePnl(closed())).toEqual({ value: 20, estimated: true }))
})

describe('validateEntry', () => {
  test('合法', () => expect(validateEntry(entry())).toEqual([]))
  test('做多止損不能高於進場', () => expect(validateEntry(entry({ planned_stop: 100 }))).toHaveLength(1))
  test('做空止損不能低於進場', () =>
    expect(validateEntry(entry({ direction: 'short', planned_stop: 95 }))).toHaveLength(1))
  test('做多目標要高於進場', () => expect(validateEntry(entry({ planned_target: 99 }))).toHaveLength(1))
  test('做空目標要低於進場', () =>
    expect(validateEntry(entry({ direction: 'short', planned_stop: 105, planned_target: 101 }))).toHaveLength(1))
  test('風險金額要 > 0', () => expect(validateEntry(entry({ risk_usdt: 0 }))).toHaveLength(1))
  test('幣種不能空白', () => expect(validateEntry(entry({ symbol: '  ' }))).toHaveLength(1))
  test('價格要是有效數字', () => expect(validateEntry(entry({ entry_price: NaN }))).not.toHaveLength(0))
})

describe('validateExit', () => {
  const t = { opened_at: '2026-10-01T00:00:00Z' }
  test('合法', () => expect(validateExit(t, exit())).toEqual([]))
  test('出場不能早於進場', () => expect(validateExit(t, exit({ closed_at: '2026-09-30T23:59:00Z' }))).toHaveLength(1))
  test('出場價要 > 0', () => expect(validateExit(t, exit({ exit_price: 0 }))).toHaveLength(1))
  test('最後止損要 > 0', () => expect(validateExit(t, exit({ final_stop: 0 }))).toHaveLength(1))
})

describe('riskPct', () => {
  test('風險金額 ÷ 權益', () => expect(riskPct({ risk_usdt: 50, equity_at_entry: 10000 })).toBe(0.5))
  test('沒有權益為 null', () => expect(riskPct({ risk_usdt: 50, equity_at_entry: null })).toBeNull())
})

describe('validateExit 作戰卡', () => {
  test('還沒進場不能平倉', () => expect(validateExit({ opened_at: null }, exit())).toContain('還沒進場，不能平倉'))
})

describe('標籤與格式', () => {
  test('手動標籤', () => expect(tagLabel('chasing')).toBe('追價'))
  test('引擎違規', () => expect(tagLabel('tilt')).toBe('上頭'))
  test('自訂鍵原樣', () => expect(tagLabel('自訂X')).toBe('自訂X'))
  test('幣種正規化', () => expect(normalizeSymbol(' btcusdt ')).toBe('BTCUSDT'))
  test('最近幣種：新到舊、去重、限量', () => {
    const t = (symbol: string, opened_at: string) => ({ symbol, opened_at, created_at: opened_at })
    const list = [t('A', '2026-10-01T00:00:00Z'), t('B', '2026-10-03T00:00:00Z'), t('A', '2026-10-02T00:00:00Z'), t('C', '2026-09-01T00:00:00Z')]
    expect(recentSymbols(list, 2)).toEqual(['B', 'A'])
  })
})
