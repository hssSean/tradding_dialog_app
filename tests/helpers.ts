import type { Trade } from '../src/lib/types'

let seq = 0

/** 已平倉的做多交易：進場 100、止損 95，exit_price 由 r 推算（1R = 5） */
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
    created_at: '2026-10-06T01:00:00Z',
    updated_at: '2026-10-06T01:00:00Z',
    ...rest,
  }
}
