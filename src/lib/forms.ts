import { fromLocalInput, parseNum, toLocalInput } from './format'
import { normalizeSymbol, validateEntry, validateExit } from './trade'
import type { Direction, EntryInput, ExitInput, ExitReason, Trade } from './types'

/** 表單狀態一律用字串，送出時才轉型（iOS 數字鍵盤輸入過程中常是不完整的字串） */
export interface EntryForm {
  symbol: string
  direction: Direction
  setup_id: string
  timeframe: string
  opened_at: string // datetime-local（台北）
  entry_price: string
  planned_stop: string
  planned_target: string
  risk_usdt: string
  entry_reason: string
}

export interface ExitForm {
  closed_at: string
  exit_price: string
  final_stop: string
  exit_reason: ExitReason | ''
  pnl_usdt: string
  mistake_tags: string[]
  note: string
}

const required = (s: string) => parseNum(s) ?? NaN
const optional = (s: string) => parseNum(s)
const text = (s: string) => (s.trim() ? s.trim() : null)
const str = (n: number | null) => (n === null ? '' : String(n))

export function emptyEntryForm(standardRisk: number, nowLocal: string): EntryForm {
  return {
    symbol: '',
    direction: 'long',
    setup_id: '',
    timeframe: '',
    opened_at: nowLocal,
    entry_price: '',
    planned_stop: '',
    planned_target: '',
    risk_usdt: String(standardRisk),
    entry_reason: '',
  }
}

export function entryToForm(t: Trade): EntryForm {
  return {
    symbol: t.symbol,
    direction: t.direction,
    setup_id: t.setup_id ?? '',
    timeframe: t.timeframe ?? '',
    opened_at: toLocalInput(t.opened_at),
    entry_price: str(t.entry_price),
    planned_stop: str(t.planned_stop),
    planned_target: str(t.planned_target),
    risk_usdt: str(t.risk_usdt),
    entry_reason: t.entry_reason ?? '',
  }
}

export function parseEntry(f: EntryForm): { value: EntryInput; errors: string[] } {
  const value: EntryInput = {
    symbol: normalizeSymbol(f.symbol),
    direction: f.direction,
    setup_id: f.setup_id || null,
    timeframe: text(f.timeframe),
    opened_at: f.opened_at ? fromLocalInput(f.opened_at) : '',
    entry_price: required(f.entry_price),
    planned_stop: required(f.planned_stop),
    planned_target: optional(f.planned_target),
    risk_usdt: required(f.risk_usdt),
    entry_reason: text(f.entry_reason),
  }
  return { value, errors: validateEntry(value) }
}

export function emptyExitForm(t: Trade, nowLocal: string): ExitForm {
  return {
    closed_at: nowLocal,
    exit_price: '',
    final_stop: str(t.planned_stop),
    exit_reason: '',
    pnl_usdt: '',
    mistake_tags: [],
    note: '',
  }
}

export function exitToForm(t: Trade): ExitForm {
  return {
    closed_at: t.closed_at ? toLocalInput(t.closed_at) : '',
    exit_price: str(t.exit_price),
    final_stop: str(t.final_stop ?? t.planned_stop),
    exit_reason: t.exit_reason ?? '',
    pnl_usdt: str(t.pnl_usdt),
    mistake_tags: t.mistake_tags,
    note: t.note ?? '',
  }
}

export function parseExit(f: ExitForm, t: Pick<Trade, 'opened_at'>): { value: ExitInput; errors: string[] } {
  const value: ExitInput = {
    closed_at: f.closed_at ? fromLocalInput(f.closed_at) : '',
    exit_price: required(f.exit_price),
    final_stop: required(f.final_stop),
    exit_reason: f.exit_reason || 'other',
    pnl_usdt: optional(f.pnl_usdt),
    mistake_tags: f.mistake_tags,
    note: text(f.note),
  }
  const errors = validateExit(t, value)
  if (!f.exit_reason) errors.unshift('請選出場原因')
  return { value, errors }
}
