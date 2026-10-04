import type { Trade } from '../src/lib/types'

let seq = 0

/** 已平倉的做多交易：進場 100、止損 95，exit_price 由 r 推算（1R = 5）。預設為舊資料（不評分）。 */
export function mk(over: Partial<Trade> & { r?: number } = {}): Trade {
  const { r, ...rest } = over
  seq += 1
  return {
    id: `t${seq}`,
    user_id: 'u1',
    symbol: 'BTCUSDT',
    direction: 'long',
    setup_id: null,
    timeframe: '1h',
    opened_at: '2026-10-06T01:00:00Z',
    entry_price: 100,
    planned_stop: 95,
    planned_target: null,
    risk_usdt: 10,
    entry_reason: null,
    closed_at: '2026-10-06T02:00:00Z',
    exit_price: 100 + (r ?? 1) * 5,
    final_stop: 95,
    exit_reason: 'manual_plan',
    pnl_usdt: null,
    mistake_tags: [],
    note: null,
    card_at: null,
    emotion: null,
    equity_at_entry: null,
    stop_edits: [],
    reviewed_at: null,
    abandoned_at: null,
    gamified: false,
    created_at: '2026-10-06T01:00:00Z',
    updated_at: '2026-10-06T01:00:00Z',
    ...rest,
  }
}

const add = (iso: string, minutes: number) => new Date(Date.parse(iso) + minutes * 60_000).toISOString()

/**
 * 守紀律的遊戲化交易：進場前 10 分鐘立卡、權益 10000、風險 50（0.5%）、平倉後 1 小時復盤。
 * 給 opened 與 holdMin 就能排時間。
 */
export function g(over: Partial<Trade> & { r?: number; opened?: string; holdMin?: number } = {}): Trade {
  const { opened = '2026-10-06T01:00:00Z', holdMin = 60, ...rest } = over
  const closed = add(opened, holdMin)
  return mk({
    gamified: true,
    opened_at: opened,
    card_at: add(opened, -10),
    closed_at: closed,
    reviewed_at: add(closed, 60),
    equity_at_entry: 10000,
    risk_usdt: 50,
    emotion: 2,
    created_at: add(opened, -10),
    ...rest,
  })
}

export { add }
