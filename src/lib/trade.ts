import type { ClosedTrade, Direction, EntryInput, ExitInput, ExitReason, Trade } from './types'

export const TZ = 'Asia/Taipei'

export const DISCIPLINE_LABELS: Record<string, string> = {
  stop_widened: '移遠止損',
  early_exit: '提前出場',
  stop_not_honored: '沒守止損',
  oversized: '超額倉位',
  revenge: '報復單',
  no_stop: '沒設止損',
  chasing: '追價',
  unplanned: '計畫外交易',
}

/** 平倉表單可手動勾選的標籤（stop_not_honored 只由系統判斷） */
export const MANUAL_TAG_KEYS = ['stop_widened', 'early_exit', 'no_stop', 'revenge', 'oversized', 'chasing', 'unplanned']

export const EXIT_REASON_LABELS: Record<ExitReason, string> = {
  target: '打到目標',
  stop: '打到止損',
  manual_plan: '照計畫手動',
  manual_early: '提前手動',
  other: '其他',
}

export const DIRECTION_LABELS: Record<Direction, string> = { long: '多', short: '空' }

const STOP_WIDENED_TOLERANCE = 1.0001
const STOP_NOT_HONORED_R = -1.1
const OVERSIZED_RATIO = 1.5

const sign = (d: Direction) => (d === 'long' ? 1 : -1)
const round2 = (x: number) => Math.round(x * 100) / 100
const validNum = (x: number) => Number.isFinite(x) && x > 0

export function isClosed(t: Trade): t is ClosedTrade {
  return t.closed_at !== null && t.exit_price !== null && t.exit_reason !== null
}

export function riskDistance(t: Pick<Trade, 'direction' | 'entry_price' | 'planned_stop'>): number {
  return (t.entry_price - t.planned_stop) * sign(t.direction)
}

export function rMultiple(t: ClosedTrade): number {
  return round2(((t.exit_price - t.entry_price) * sign(t.direction)) / riskDistance(t))
}

export function plannedRR(
  t: Pick<Trade, 'direction' | 'entry_price' | 'planned_stop' | 'planned_target'>,
): number | null {
  if (t.planned_target === null) return null
  return round2(((t.planned_target - t.entry_price) * sign(t.direction)) / riskDistance(t))
}

export function tradePnl(t: ClosedTrade): { value: number; estimated: boolean } {
  if (t.pnl_usdt !== null) return { value: t.pnl_usdt, estimated: false }
  return { value: round2(rMultiple(t) * t.risk_usdt), estimated: true }
}

export function validateEntry(e: EntryInput): string[] {
  const errors: string[] = []
  if (!e.symbol.trim()) errors.push('請填幣種')
  if (!validNum(e.entry_price)) errors.push('進場價要是大於 0 的數字')
  if (!validNum(e.planned_stop)) errors.push('止損價要是大於 0 的數字')
  if (!validNum(e.risk_usdt)) errors.push('風險金額要大於 0')
  if (e.planned_target !== null && !validNum(e.planned_target)) errors.push('目標價要是大於 0 的數字')
  if (Number.isNaN(Date.parse(e.opened_at))) errors.push('進場時間無效')
  if (errors.length) return errors

  const s = sign(e.direction)
  const side = e.direction === 'long' ? '低於' : '高於'
  const targetSide = e.direction === 'long' ? '高於' : '低於'
  if ((e.entry_price - e.planned_stop) * s <= 0) errors.push(`做${DIRECTION_LABELS[e.direction]}的止損要${side}進場價`)
  if (e.planned_target !== null && (e.planned_target - e.entry_price) * s <= 0)
    errors.push(`做${DIRECTION_LABELS[e.direction]}的目標要${targetSide}進場價`)
  return errors
}

export function validateExit(t: Pick<Trade, 'opened_at'>, x: ExitInput): string[] {
  const errors: string[] = []
  if (!validNum(x.exit_price)) errors.push('出場價要是大於 0 的數字')
  if (!validNum(x.final_stop)) errors.push('最後止損要是大於 0 的數字')
  if (x.pnl_usdt !== null && !Number.isFinite(x.pnl_usdt)) errors.push('實際損益要是數字')
  const closed = Date.parse(x.closed_at)
  if (Number.isNaN(closed)) errors.push('出場時間無效')
  else if (closed < Date.parse(t.opened_at)) errors.push('出場時間不能早於進場時間')
  return errors
}

/** 單筆可判斷的紀律警示（revenge 需要整份清單，在 stats.ts 判斷） */
export function autoFlags(t: ClosedTrade, standardRisk: number): string[] {
  const flags: string[] = []
  if (t.final_stop !== null && (t.entry_price - t.final_stop) * sign(t.direction) > riskDistance(t) * STOP_WIDENED_TOLERANCE)
    flags.push('stop_widened')
  if (t.exit_reason === 'manual_early') flags.push('early_exit')
  if (rMultiple(t) < STOP_NOT_HONORED_R) flags.push('stop_not_honored')
  if (t.risk_usdt > standardRisk * OVERSIZED_RATIO) flags.push('oversized')
  return flags
}

export function tagLabel(key: string): string {
  return DISCIPLINE_LABELS[key] ?? key
}

export function normalizeSymbol(s: string): string {
  return s.trim().toUpperCase()
}

/** 最近用過的幣種（依進場時間由新到舊、去重） */
export function recentSymbols(trades: Pick<Trade, 'symbol' | 'opened_at'>[], limit = 10): string[] {
  const sorted = [...trades].sort((a, b) => Date.parse(b.opened_at) - Date.parse(a.opened_at))
  return [...new Set(sorted.map((t) => t.symbol))].slice(0, limit)
}
