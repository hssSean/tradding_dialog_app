import { VIOLATION_LABELS } from '../game/rules'
import type { ClosedTrade, Direction, EntryInput, ExitInput, ExitReason, OpenTrade, Trade } from './types'

export const TZ = 'Asia/Taipei'

/**
 * 平倉表單可手動勾選的標籤。逆向移動止損、無作戰卡、超風險、上頭、報復等
 * 由遊戲化引擎（src/game）自動判斷，不在這裡。
 */
export const MANUAL_TAG_LABELS: Record<string, string> = {
  early_exit: '提前出場',
  chasing: '追價',
  unplanned: '計畫外交易',
}
export const MANUAL_TAG_KEYS = Object.keys(MANUAL_TAG_LABELS)

export const EXIT_REASON_LABELS: Record<ExitReason, string> = {
  target: '打到目標',
  stop: '打到止損',
  manual_plan: '照計畫手動',
  manual_early: '提前手動',
  other: '其他',
}

export const DIRECTION_LABELS: Record<Direction, string> = { long: '多', short: '空' }

const sign = (d: Direction) => (d === 'long' ? 1 : -1)
const round2 = (x: number) => Math.round(x * 100) / 100
const validNum = (x: number) => Number.isFinite(x) && x > 0

export function isClosed(t: Trade): t is ClosedTrade {
  return t.opened_at !== null && t.closed_at !== null && t.exit_price !== null && t.exit_reason !== null
}

/** 已進場（含已平倉） */
export function isOpened(t: Trade): t is OpenTrade {
  return t.opened_at !== null
}

/** 持倉中 */
export function isOpen(t: Trade): t is OpenTrade {
  return t.opened_at !== null && t.closed_at === null
}

/** 還沒進場、也沒放棄的作戰卡 */
export function isPendingCard(t: Trade): boolean {
  return t.opened_at === null && t.abandoned_at === null
}

/** 風險 % = 風險金額 ÷ 進場時權益；沒有權益資料時為 null。不四捨五入，避免門檻邊界被進位推過去 */
export function riskPct(t: Pick<Trade, 'risk_usdt' | 'equity_at_entry'>): number | null {
  if (t.equity_at_entry === null || t.equity_at_entry <= 0) return null
  return (t.risk_usdt / t.equity_at_entry) * 100
}

/** 這次止損移動是不是往不利方向（做多往下、做空往上）；移到保本或有利方向不算 */
export function isAgainstMove(direction: Direction, from: number, to: number): boolean {
  return (to - from) * sign(direction) < 0
}

/** 目前的止損：最後一次移動後的價位，沒移動過就是初始止損 */
export function currentStop(t: Pick<Trade, 'planned_stop' | 'final_stop' | 'stop_edits'>): number {
  const last = t.stop_edits[t.stop_edits.length - 1]
  return last ? last.to : (t.final_stop ?? t.planned_stop)
}

/**
 * 有沒有逆向移動過止損。有 stop_edits 時逐筆判斷；
 * 舊資料沒有紀錄，就比較最後止損是否比初始止損離進場價更遠。
 */
export function movedStopAgainst(t: Pick<Trade, 'direction' | 'planned_stop' | 'final_stop' | 'stop_edits'>): boolean {
  if (t.stop_edits.length) return t.stop_edits.some((e) => isAgainstMove(t.direction, e.from, e.to))
  return t.final_stop !== null && isAgainstMove(t.direction, t.planned_stop, t.final_stop)
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
  if (e.opened_at !== null && Number.isNaN(Date.parse(e.opened_at))) errors.push('進場時間無效')
  if (e.emotion !== null && ![1, 2, 3, 4, 5].includes(e.emotion)) errors.push('情緒要是 1 到 5')
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
  else if (t.opened_at === null) errors.push('還沒進場，不能平倉')
  else if (closed < Date.parse(t.opened_at)) errors.push('出場時間不能早於進場時間')
  return errors
}

export function tagLabel(key: string): string {
  return MANUAL_TAG_LABELS[key] ?? (VIOLATION_LABELS as Record<string, string>)[key] ?? key
}

export function normalizeSymbol(s: string): string {
  return s.trim().toUpperCase()
}

/** 最近用過的幣種（依進場時間由新到舊、去重） */
export function recentSymbols(trades: Pick<Trade, 'symbol' | 'opened_at' | 'created_at'>[], limit = 10): string[] {
  const at = (t: Pick<Trade, 'opened_at' | 'created_at'>) => Date.parse(t.opened_at ?? t.created_at)
  const sorted = [...trades].sort((a, b) => at(b) - at(a))
  return [...new Set(sorted.map((t) => t.symbol))].slice(0, limit)
}
