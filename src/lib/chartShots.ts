import { fmtDateTime } from './format'
import type { ImageKind, RawTrade, Trade } from './types'

/* K 線圖的範圍與自動截圖的規則（純函數）。詳情頁 K 線卡與自動截圖共用。 */

export type Interval = '5m' | '15m' | '1h'
export const INTERVAL_MS: Record<Interval, number> = { '5m': 5 * 60_000, '15m': 15 * 60_000, '1h': 3_600_000 }
export const INTERVAL_LABELS: Record<Interval, string> = { '5m': '5 分', '15m': '15 分', '1h': '1 小時' }
export const BEFORE_BARS = 60
export const AFTER_BARS = 30

/** entry：只畫到進場那根，看不到之後的走勢；full：整段交易 */
export type ChartMode = 'entry' | 'full'

export function defaultInterval(holdMs: number): Interval {
  if (holdMs < 2 * 3_600_000) return '5m'
  if (holdMs < 12 * 3_600_000) return '15m'
  return '1h'
}

const holdEnd = (t: RawTrade, now: number) => (t.closed_at ? Date.parse(t.closed_at) : now)

export function intervalFor(t: RawTrade, now: number): Interval {
  return defaultInterval(holdEnd(t, now) - Date.parse(t.opened_at!))
}

/** 要抓的 K 線起訖（毫秒）。entry 結束在進場那根的最後一毫秒：BingX 的 endTime 不含邊界，給開盤時間會漏掉進場那根 */
export function chartRange(t: RawTrade, mode: ChartMode, interval: Interval, now: number): { start: number; end: number } {
  const step = INTERVAL_MS[interval]
  const open = Date.parse(t.opened_at!)
  const start = open - BEFORE_BARS * step
  if (mode === 'entry') return { start, end: Math.floor(open / step) * step + step - 1 }
  return { start, end: Math.min(now, holdEnd(t, now) + AFTER_BARS * step) }
}

/**
 * 還缺哪些自動截圖：已進場、沒放棄、止損已知，而且那一格還空著（絕不覆蓋已有的圖）。
 * 出場圖只給已平倉的交易。
 */
export function missingShots(trades: RawTrade[], images: { trade_id: string; kind: ImageKind }[]): { trade: Trade; kind: ImageKind }[] {
  const has = new Set(images.map((i) => `${i.trade_id}:${i.kind}`))
  const out: { trade: Trade; kind: ImageKind }[] = []
  for (const t of trades) {
    if (!t.opened_at || t.abandoned_at || t.planned_stop === null) continue
    const trade = t as Trade
    if (!has.has(`${t.id}:entry`)) out.push({ trade, kind: 'entry' })
    if (t.closed_at && !has.has(`${t.id}:exit`)) out.push({ trade, kind: 'exit' })
  }
  return out
}

/** 截圖上方的標題，例：ICPUSDT 做多 · 進場 · 15 分 · 10/12 21:30（台北時間） */
export function shotTitle(t: RawTrade, kind: ImageKind, interval: Interval): string {
  const at = kind === 'entry' ? t.opened_at! : t.closed_at!
  return `${t.symbol} 做${t.direction === 'long' ? '多' : '空'} · ${kind === 'entry' ? '進場' : '出場'} · ${INTERVAL_LABELS[interval]} · ${fmtDateTime(at)}`
}
