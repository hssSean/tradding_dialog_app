/**
 * 快速標記卡（推播落地頁與收件匣共用）的純函數：卡片輸入 → 資料庫 patch，以及「要不要標」的判斷。
 * 標籤 key 與平倉表單共用 src/lib/trade.ts 的 MANUAL_TAG_LABELS。
 */
import type { BxOpenPosition } from '../notify/events'
import type { RawTrade } from './types'

export interface OpenTagInput {
  setup_id: string | null
  /** false = 臨時起意 → unplanned */
  planned: boolean
  reason: string
}

export interface CloseTagInput {
  exit: 'plan' | 'early' | 'late'
  chased: boolean
  note: string
}

/** 收件匣只收最近幾天，更早的在交易紀錄頁「待補」 */
export const INBOX_DAYS = 7

const toggle = (tags: string[], tag: string, on: boolean) => (on ? (tags.includes(tag) ? tags : [...tags, tag]) : tags.filter((t) => t !== tag))
const text = (s: string) => s.trim() || null

export function openTagPatch(i: OpenTagInput, base: string[], nowIso: string, cardAt: string | null) {
  return {
    setup_id: i.setup_id,
    entry_reason: text(i.reason),
    mistake_tags: toggle(base, 'unplanned', !i.planned),
    card_at: cardAt ?? nowIso,
  }
}

export function closeTagPatch(t: RawTrade, c: CloseTagInput, o: OpenTagInput | null, nowIso: string): Partial<RawTrade> {
  let tags = t.mistake_tags
  const patch: Partial<RawTrade> = {}
  if (o) {
    const op = openTagPatch(o, tags, nowIso, t.card_at)
    tags = op.mistake_tags
    Object.assign(patch, { setup_id: op.setup_id, entry_reason: op.entry_reason, card_at: op.card_at })
  }
  tags = toggle(tags, 'early_exit', c.exit === 'early')
  tags = toggle(tags, 'late_exit', c.exit === 'late')
  tags = toggle(tags, 'chasing', c.chased)
  patch.mistake_tags = tags
  const note = text(c.note)
  if (note) patch.note = note
  patch.reviewed_at = t.reviewed_at ?? nowIso
  return patch
}

/** 收件匣：BingX 匯入、評分中、沒放棄，且（最近平倉還沒檢討或沒作戰卡）或（持倉中沒作戰卡） */
export function needsTag(t: RawTrade, nowMs: number): boolean {
  if (!t.gamified || t.source !== 'bingx' || t.opened_at === null || t.abandoned_at !== null) return false
  if (t.closed_at === null) return t.card_at === null
  if (Date.parse(t.closed_at) < nowMs - INBOX_DAYS * 86_400_000) return false
  return t.reviewed_at === null || t.card_at === null
}

/** BingX 持倉中、日誌裡還沒有紀錄的（開倉卡按完成才會建立紀錄） */
export function untaggedOpen(positions: BxOpenPosition[], trades: Pick<RawTrade, 'external_id'>[]): BxOpenPosition[] {
  const known = new Set(trades.map((t) => t.external_id).filter(Boolean))
  return positions.filter((p) => !known.has(p.positionId))
}

export interface OpenPos {
  positionId: string
  symbol: string
  direction: RawTrade['direction']
  entry: number
  openedAt: number
}

/** 還沒有日誌紀錄的持倉 → 給卡片與 K 線圖用的暫時交易物件（不寫入資料庫） */
export function openPositionTrade(p: OpenPos): RawTrade {
  const opened = new Date(p.openedAt).toISOString()
  return {
    id: `open:${p.positionId}`,
    user_id: '',
    symbol: p.symbol,
    direction: p.direction,
    setup_id: null,
    timeframe: null,
    opened_at: opened,
    entry_price: p.entry,
    planned_stop: null,
    planned_target: null,
    risk_usdt: null,
    entry_reason: null,
    closed_at: null,
    exit_price: null,
    final_stop: null,
    exit_reason: null,
    pnl_usdt: null,
    mistake_tags: [],
    note: null,
    card_at: null,
    emotion: null,
    equity_at_entry: null,
    stop_edits: [],
    reviewed_at: null,
    abandoned_at: null,
    gamified: true,
    source: 'bingx',
    external_id: p.positionId,
    created_at: opened,
    updated_at: opened,
  }
}

/** 推播網址的參數 → 持倉；缺參數或格式不對回傳 null */
export function openPosFromQuery(positionId: string, q: URLSearchParams): OpenPos | null {
  const symbol = q.get('s')
  const d = q.get('d')
  const entry = Number(q.get('p'))
  const openedAt = Number(q.get('t'))
  if (!symbol || (d !== 'long' && d !== 'short') || !(entry > 0) || !(openedAt > 0)) return null
  return { positionId, symbol, direction: d, entry, openedAt }
}
