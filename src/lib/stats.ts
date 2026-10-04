import { isClosed, rMultiple, tagLabel, tradePnl } from './trade'
import type { ClosedTrade, Trade } from './types'
import { DAY_MS, tpe, tpeMidnight, ymd } from './tz'

export interface Enriched {
  trade: ClosedTrade
  r: number
  pnl: number
  pnlEstimated: boolean
  keys: string[]
}

export interface GroupStats {
  n: number
  wins: number
  winRate: number
  totalR: number
  avgR: number
  pnl: number
}

export type Dimension = 'discipline' | 'setup' | 'symbol' | 'direction' | 'hour' | 'weekday'

export interface GroupRow {
  key: string
  label: string
  stats: GroupStats
  lowSample: boolean
}

export type Scope = 'week' | '4w' | 'all'

export interface Problem {
  dimension: Dimension
  label: string
  n: number
  totalR: number
  share: number
}

export const LOW_SAMPLE = 5
const WEEKDAYS = ['週日', '週一', '週二', '週三', '週四', '週五', '週六']
const NO_SETUP = '__none'
/** 本週最大問題的候選維度，順序即同分時的優先序 */
const PROBLEM_DIMENSIONS: Dimension[] = ['discipline', 'setup', 'symbol', 'hour', 'direction']

const round2 = (x: number) => Math.round(x * 100) / 100

// ── 週次與時段（台北時間） ──────────────────────────────

export function weekStartOf(d: Date | string): string {
  const t = tpe(d)
  const sinceMonday = (t.getUTCDay() + 6) % 7
  return ymd(new Date(t.getTime() - sinceMonday * DAY_MS))
}

export function addWeeks(weekStart: string, n: number): string {
  const [y, m, d] = weekStart.split('-').map(Number)
  return ymd(new Date(Date.UTC(y, m - 1, d) + n * 7 * DAY_MS))
}

/** [start, end) */
export function weekBounds(weekStart: string): { start: Date; end: Date } {
  const start = tpeMidnight(weekStart)
  return { start, end: new Date(start.getTime() + 7 * DAY_MS) }
}

export function hourBucket(iso: string): string {
  const b = Math.floor(tpe(iso).getUTCHours() / 4) * 4
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(b)}–${p(b + 4)}`
}

export function weekdayLabel(iso: string): string {
  return WEEKDAYS[tpe(iso).getUTCDay()]
}

// ── 逐筆加工 ────────────────────────────────────────────

/**
 * 只回已平倉交易，附上 R、損益與紀律鍵（手動標籤 ∪ 遊戲化引擎判斷的違規）。
 * 違規規則只有一份，在 src/game；這裡由呼叫端傳進來。
 */
export function enrich(trades: Trade[], violationsOf: (id: string) => string[] = () => []): Enriched[] {
  return trades.filter(isClosed).map((trade) => {
    const pnl = tradePnl(trade)
    const keys = new Set([...trade.mistake_tags, ...violationsOf(trade.id)])
    return { trade, r: rMultiple(trade), pnl: pnl.value, pnlEstimated: pnl.estimated, keys: [...keys] }
  })
}

export function inScope(list: Enriched[], scope: Scope, weekStart: string): Enriched[] {
  if (scope === 'all') return list
  const end = weekBounds(weekStart).end.getTime()
  const start = weekBounds(scope === 'week' ? weekStart : addWeeks(weekStart, -3)).start.getTime()
  return list.filter((e) => {
    const t = Date.parse(e.trade.closed_at)
    return t >= start && t < end
  })
}

// ── 統計 ────────────────────────────────────────────────

export function summarize(list: Enriched[]): GroupStats {
  const n = list.length
  const wins = list.filter((e) => e.r > 0).length
  const totalR = round2(list.reduce((s, e) => s + e.r, 0))
  return {
    n,
    wins,
    winRate: n ? wins / n : 0,
    totalR,
    avgR: n ? round2(totalR / n) : 0,
    pnl: round2(list.reduce((s, e) => s + e.pnl, 0)),
  }
}

function keysOf(e: Enriched, dim: Dimension): string[] {
  switch (dim) {
    case 'discipline':
      return e.keys
    case 'setup':
      return [e.trade.setup_id ?? NO_SETUP]
    case 'symbol':
      return [e.trade.symbol]
    case 'direction':
      return [e.trade.direction]
    case 'hour':
      return [hourBucket(e.trade.opened_at)]
    case 'weekday':
      return [weekdayLabel(e.trade.opened_at)]
  }
}

function labelOf(key: string, dim: Dimension, setupNames: Map<string, string>): string {
  switch (dim) {
    case 'discipline':
      return tagLabel(key)
    case 'setup':
      return key === NO_SETUP ? '未分類' : (setupNames.get(key) ?? '未分類')
    case 'direction':
      return key === 'long' ? '做多' : '做空'
    default:
      return key
  }
}

/** 依總 R 由小到大（最差的在前） */
export function groupBy(list: Enriched[], dim: Dimension, setupNames: Map<string, string>): GroupRow[] {
  const groups = new Map<string, Enriched[]>()
  for (const e of list) {
    for (const k of keysOf(e, dim)) {
      const g = groups.get(k)
      if (g) g.push(e)
      else groups.set(k, [e])
    }
  }
  return [...groups.entries()]
    .map(([key, items]) => {
      const stats = summarize(items)
      return { key, label: labelOf(key, dim, setupNames), stats, lowSample: stats.n < LOW_SAMPLE }
    })
    .sort((a, b) => a.stats.totalR - b.stats.totalR || b.stats.n - a.stats.n)
}

export function biggestProblem(week: Enriched[], setupNames: Map<string, string>): Problem | null {
  let best: Problem | null = null
  for (const dim of PROBLEM_DIMENSIONS) {
    const worst = groupBy(week, dim, setupNames)[0]
    if (worst && worst.stats.totalR < 0 && (!best || worst.stats.totalR < best.totalR)) {
      best = { dimension: dim, label: worst.label, n: worst.stats.n, totalR: worst.stats.totalR, share: 0 }
    }
  }
  if (!best) return null
  const lossSum = week.reduce((s, e) => (e.r < 0 ? s + e.r : s), 0)
  best.share = Math.min(1, Math.abs(best.totalR) / Math.abs(lossSum))
  return best
}

export function cleanVsFlagged(list: Enriched[]): { clean: GroupStats; flagged: GroupStats } {
  return {
    clean: summarize(list.filter((e) => e.keys.length === 0)),
    flagged: summarize(list.filter((e) => e.keys.length > 0)),
  }
}

export function weekSummary(
  all: Enriched[],
  weekStart: string,
): { current: GroupStats; prevTotalR: number; avg4TotalR: number } {
  const totalOf = (offset: number) => summarize(inScope(all, 'week', addWeeks(weekStart, offset))).totalR
  const prior = [-1, -2, -3, -4].map(totalOf)
  return {
    current: summarize(inScope(all, 'week', weekStart)),
    prevTotalR: prior[0],
    avg4TotalR: round2(prior.reduce((s, x) => s + x, 0) / prior.length),
  }
}
