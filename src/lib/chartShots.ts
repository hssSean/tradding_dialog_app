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
 * 自動圖的指紋：畫圖會用到的欄位（含週期）。資料變了指紋就變，自動圖要重畫。
 * 進場圖不含出場資訊，所以只改出場的東西不會重畫進場圖。
 */
export function shotKey(t: RawTrade, kind: ImageKind, interval: Interval): string {
  const base = [t.symbol, t.direction, t.opened_at, t.entry_price, t.planned_stop, t.planned_target, interval]
  const exit = kind === 'exit' ? [t.closed_at, t.final_stop, t.stop_edits.map((e) => [e.at, e.to])] : []
  return fnv1a(JSON.stringify([...base, ...exit]))
}

/** 從檔名 `{kind}-auto-{指紋}-{時間}.jpg` 取出指紋；不是自動圖回傳 undefined，舊版沒指紋的自動圖回傳 null */
export function autoKeyOf(path: string): string | null | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1)
  if (!name.includes('-auto-')) return undefined
  return /-auto-([0-9a-f]{8})-\d+\.jpg$/.exec(name)?.[1] ?? null
}

export interface ShotJob {
  trade: Trade
  kind: ImageKind
  interval: Interval
  key: string
}

/**
 * 要畫哪些自動截圖：已進場、沒放棄、止損已知，而且那一格是空的，或是指紋過期的自動圖。
 * 使用者上傳的圖絕不覆蓋。出場圖只給已平倉的交易。
 */
export function shotsToDraw(trades: RawTrade[], images: { trade_id: string; kind: ImageKind; path: string }[], now: number): ShotJob[] {
  const byslot = new Map(images.map((i) => [`${i.trade_id}:${i.kind}`, i.path]))
  const out: ShotJob[] = []
  for (const t of trades) {
    if (!t.opened_at || t.abandoned_at || t.planned_stop === null) continue
    const trade = t as Trade
    const interval = intervalFor(t, now)
    const kinds: ImageKind[] = t.closed_at ? ['entry', 'exit'] : ['entry']
    for (const kind of kinds) {
      const key = shotKey(t, kind, interval)
      const path = byslot.get(`${t.id}:${kind}`)
      if (path === undefined || (autoKeyOf(path) !== undefined && autoKeyOf(path) !== key)) out.push({ trade, kind, interval, key })
    }
  }
  return out
}

/** 32 位元 FNV-1a，8 位十六進位 */
function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** 截圖上方的標題，例：ICPUSDT 做多 · 進場 · 15 分 · 10/12 21:30（台北時間） */
export function shotTitle(t: RawTrade, kind: ImageKind, interval: Interval): string {
  const at = kind === 'entry' ? t.opened_at! : t.closed_at!
  return `${t.symbol} 做${t.direction === 'long' ? '多' : '空'} · ${kind === 'entry' ? '進場' : '出場'} · ${INTERVAL_LABELS[interval]} · ${fmtDateTime(at)}`
}
