/**
 * 推播事件的純函數：BingX 持倉／歷史倉位 → 要推的事件、文案、點擊後的網址。
 * 前端測試與 Vercel 函數（api/notify）共用，不碰網路與資料庫。
 */
// ⚠ 只能有 type import：Vercel 函數不打包，執行期的相對 import 會依副檔名解析失敗
import type { BxPosition } from '../sync/bingx'
import type { Direction } from '../lib/types'

const toJournalSymbol = (s: string) => s.replace('-', '')
const DIR = { long: '多', short: '空' } as const
/** 台北日期與小時（UTC+8，無日光節約；同 src/lib/tz.ts） */
function tpeParts(ms: number): { date: string; hour: number } {
  const d = new Date(ms + 8 * 3600_000)
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours() }
}

/**
 * GET /openApi/swap/v2/user/positions 的一筆。
 * ⚠ 2026-11-13 實測時沒有持倉，欄位未經驗證：開倉時間依序取 createTime → openTime → updateTime → 偵測時間，
 * 平倉後同步會用 positionHistory 的 openTime 覆蓋，所以這裡不準只影響推播文案。
 */
export interface BxOpenPosition {
  positionId: string
  symbol: string // 'SOL-USDT'
  positionSide: string // 'LONG' | 'SHORT' | 'BOTH'
  positionAmt?: string
  avgPrice: string
  createTime?: number
  openTime?: number
  updateTime?: number
}

export type PushEvent =
  | { kind: 'open'; key: string; positionId: string; symbol: string; direction: Direction; entry: number; openedAt: number }
  | { kind: 'close'; key: string; positionId: string; symbol: string; direction: Direction; closedAt: number; win: boolean }
  | { kind: 'daily'; key: string; count: number }

/** 只推最近這麼久內平倉的，避免第一次啟用時把歷史倉位全推一遍 */
export const CLOSE_WINDOW_MS = 2 * 3600_000
/** 每日提醒的台北時間（小時） */
export const DAILY_HOUR = 22

export function openDirection(p: BxOpenPosition): Direction {
  if (p.positionSide === 'LONG') return 'long'
  if (p.positionSide === 'SHORT') return 'short'
  return Number(p.positionAmt ?? 0) < 0 ? 'short' : 'long'
}

const histDirection = (p: BxPosition): Direction => (p.positionSide === 'SHORT' ? 'short' : 'long')

export function openEvents(positions: BxOpenPosition[], sent: Set<string>, nowMs: number): PushEvent[] {
  const out: PushEvent[] = []
  const seen = new Set<string>()
  for (const p of positions) {
    const key = `open:${p.positionId}`
    if (sent.has(key) || seen.has(key)) continue
    seen.add(key)
    out.push({
      kind: 'open',
      key,
      positionId: p.positionId,
      symbol: toJournalSymbol(p.symbol),
      direction: openDirection(p),
      entry: Number(p.avgPrice),
      openedAt: p.createTime ?? p.openTime ?? p.updateTime ?? nowMs,
    })
  }
  return out
}

export function closeEvents(history: BxPosition[], sent: Set<string>, nowMs: number): PushEvent[] {
  const out: PushEvent[] = []
  const seen = new Set<string>()
  for (const p of history) {
    const key = `close:${p.positionId}`
    if (!p.closeAllPositions || p.updateTime < nowMs - CLOSE_WINDOW_MS || sent.has(key) || seen.has(key)) continue
    seen.add(key)
    out.push({
      kind: 'close',
      key,
      positionId: p.positionId,
      symbol: toJournalSymbol(p.symbol),
      direction: histDirection(p),
      closedAt: p.updateTime,
      win: Number(p.netProfit) > 0,
    })
  }
  return out
}

export function dailyEvent(pending: number, sent: Set<string>, nowMs: number): PushEvent | null {
  const t = tpeParts(nowMs)
  const key = `daily:${t.date}`
  if (t.hour !== DAILY_HOUR || pending <= 0 || sent.has(key)) return null
  return { kind: 'daily', key, count: pending }
}

export function payloadOf(e: PushEvent): { title: string; body: string; url: string; tag: string } {
  if (e.kind === 'open') {
    const q = new URLSearchParams({ s: e.symbol, d: e.direction, p: String(e.entry), t: String(e.openedAt) })
    return {
      title: `${e.symbol} 做${DIR[e.direction]} 已開倉`,
      body: '什麼 setup？照計畫嗎？點一下記起來',
      url: `/tag/open/${e.positionId}?${q.toString()}`,
      tag: e.key,
    }
  }
  if (e.kind === 'close') {
    return {
      title: `${e.symbol} 做${DIR[e.direction]} 平倉（${e.win ? '賺' : '賠'}）`,
      body: '照計畫出場嗎？',
      url: `/tag/close/${e.positionId}`,
      tag: e.key,
    }
  }
  return { title: `今天 ${e.count} 筆待標記`, body: '每筆點兩下就好', url: '/inbox', tag: e.key }
}
