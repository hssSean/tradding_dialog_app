export type Direction = 'long' | 'short'
export type ExitReason = 'target' | 'stop' | 'manual_plan' | 'manual_early' | 'other'

export interface Trade {
  id: string
  user_id: string
  symbol: string
  direction: Direction
  setup_id: string | null
  timeframe: string | null
  opened_at: string
  entry_price: number
  planned_stop: number
  planned_target: number | null
  risk_usdt: number
  entry_reason: string | null
  closed_at: string | null
  exit_price: number | null
  final_stop: number | null
  exit_reason: ExitReason | null
  pnl_usdt: number | null
  mistake_tags: string[]
  note: string | null
  created_at: string
  updated_at: string
}

export type ClosedTrade = Trade & { closed_at: string; exit_price: number; exit_reason: ExitReason }

export interface EntryInput {
  symbol: string
  direction: Direction
  setup_id: string | null
  timeframe: string | null
  opened_at: string
  entry_price: number
  planned_stop: number
  planned_target: number | null
  risk_usdt: number
  entry_reason: string | null
}

export interface ExitInput {
  closed_at: string
  exit_price: number
  final_stop: number
  exit_reason: ExitReason
  pnl_usdt: number | null
  mistake_tags: string[]
  note: string | null
}

export interface Setup {
  id: string
  user_id: string
  name: string
  archived: boolean
  sort_order: number
}

export interface Settings {
  user_id: string
  standard_risk_usdt: number
}

export type ImageKind = 'entry' | 'exit'

export interface TradeImage {
  id: string
  trade_id: string
  user_id: string
  kind: ImageKind
  path: string
  size_bytes: number
}

export interface WeeklyReview {
  user_id: string
  week_start: string
  note: string | null
  next_week_focus: string | null
}
