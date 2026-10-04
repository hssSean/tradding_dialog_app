export type Direction = 'long' | 'short'
export type ExitReason = 'target' | 'stop' | 'manual_plan' | 'manual_early' | 'other'

export type Emotion = 1 | 2 | 3 | 4 | 5

export interface StopEdit {
  at: string
  from: number
  to: number
}

/**
 * 一筆交易的生命週期：作戰卡（opened_at = null）→ 持倉（opened_at 有值）→ 平倉（closed_at 有值）。
 * 作戰卡放棄時記 abandoned_at。
 */
export interface Trade {
  id: string
  user_id: string
  symbol: string
  direction: Direction
  setup_id: string | null
  timeframe: string | null
  opened_at: string | null
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
  /** 復盤文字（平倉表單或詳情頁） */
  note: string | null
  card_at: string | null
  emotion: Emotion | null
  equity_at_entry: number | null
  stop_edits: StopEdit[]
  reviewed_at: string | null
  abandoned_at: string | null
  /** false = v2 之前的舊資料，不評分 */
  gamified: boolean
  created_at: string
  updated_at: string
}

export type OpenTrade = Trade & { opened_at: string }
export type ClosedTrade = OpenTrade & { closed_at: string; exit_price: number; exit_reason: ExitReason }

export interface EntryInput {
  symbol: string
  direction: Direction
  setup_id: string | null
  timeframe: string | null
  /** 作戰卡（尚未進場）時為 null */
  opened_at: string | null
  entry_price: number
  planned_stop: number
  planned_target: number | null
  risk_usdt: number
  entry_reason: string | null
  emotion: Emotion | null
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
  reviewed_at: string | null
}

export interface Settings {
  user_id: string
  /** v1 欄位，v2 起改用倉位階級上限 × 權益 */
  standard_risk_usdt: number
  starting_equity: number | null
  display_title: string | null
}

export type ImageKind = 'entry' | 'exit'

export interface TradeImage {
  id: string
  trade_id: string
  user_id: string
  kind: ImageKind
  path: string
  size_bytes: number
  caption: string | null
  captioned_at: string | null
}

export interface DailyNote {
  user_id: string
  /** 台北日期 YYYY-MM-DD */
  date: string
  market_view: string | null
  weekly_mistake: string | null
}

export interface WeeklyReview {
  user_id: string
  week_start: string
  note: string | null
  next_week_focus: string | null
}
