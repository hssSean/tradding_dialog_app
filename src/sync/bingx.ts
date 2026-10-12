/**
 * BingX → 日誌的純函數。前端測試與 Vercel 函數（api/bingx）共用，不碰網路與資料庫。
 * 欄位以 2026-10-12 用真實 key 驗證的回應為準，見 docs/superpowers/plans/2026-10-12-bingx-sync.md。
 */
import type { Direction, ExitReason, StopEdit } from '../lib/types'

export interface BxPosition {
  positionId: string
  symbol: string // 'ADA-USDT'
  positionSide: string // 'LONG' | 'SHORT' | 'BOTH'
  openTime: number
  updateTime: number
  avgPrice: string
  avgClosePrice: string
  netProfit: string
  closeAllPositions: boolean
}

export interface BxOrder {
  orderId: string
  symbol: string
  type: string // MARKET | LIMIT | STOP_MARKET | STOP | TAKE_PROFIT_MARKET | TAKE_PROFIT
  status: string // FILLED | CANCELLED | ...
  side: string // BUY | SELL
  positionSide: string
  stopPrice: string
  avgPrice: string
  time: number
  updateTime: number
  reduceOnly: boolean
  positionID: string
}

/** 匯入一個倉位要寫進 journal_trades 的欄位 */
export interface ImportedTrade {
  external_id: string
  symbol: string
  direction: Direction
  opened_at: string
  closed_at: string
  entry_price: number
  exit_price: number
  pnl_usdt: number
  /**
   * BingX 的止損價。⚠ 在 BingX 直接改倉位的止盈止損時，是修改同一張條件單、不留修改紀錄，
   * 所以這通常是「最後的止損」，不一定是初始止損（2026-10-12 SUI 實例：初始 1.1834，BingX 只有 1.17）。
   * 沒有止損單、或止損在獲利那一側 → null，待使用者補。
   */
  planned_stop: number | null
  final_stop: number | null
  stop_edits: StopEdit[]
  planned_target: number | null
  exit_reason: ExitReason
}

// ── 簽章 ────────────────────────────────────────────────

/** 依 key 的 ASCII 排序組成 k=v&k=v（不 URL 編碼），這是要拿去 HMAC-SHA256 的字串 */
export function canonicalQuery(params: Record<string, string | number | boolean>): string {
  return Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&')
}

// ── 解析 ────────────────────────────────────────────────

/**
 * BingX 訂單的 positionID 是超過 2^53 的 JSON 數字，直接 JSON.parse 會失準
 * （2107726997673431042 → 2107726997673431000），先轉成字串再解析。
 */
export function parseBingxJson<T>(text: string): T {
  return JSON.parse(text.replace(/"(positionID|positionId|orderId|mainOrderId|triggerOrderId)":(\d{15,})/g, '"$1":"$2"')) as T
}

/** 'ADA-USDT' → 'ADAUSDT' */
export const toJournalSymbol = (s: string) => s.replace('-', '')
/** 'ADAUSDT' → 'ADA-USDT' */
export const toBingxSymbol = (s: string) => (s.includes('-') ? s : s.replace(/USDT$/, '-USDT'))

// ── 倉位 → 交易 ─────────────────────────────────────────

const STOP_TYPES = new Set(['STOP_MARKET', 'STOP'])
const TP_TYPES = new Set(['TAKE_PROFIT_MARKET', 'TAKE_PROFIT'])
const iso = (ms: number) => new Date(ms).toISOString()

/** 這張訂單屬於這個倉位嗎：優先用 positionID；沒有時用幣種、方向與時間區間 */
function belongsTo(o: BxOrder, p: BxPosition): boolean {
  if (o.positionID && o.positionID !== '0') return o.positionID === p.positionId
  return o.symbol === p.symbol && o.positionSide === p.positionSide && o.time >= p.openTime - 60_000 && o.time <= p.updateTime + 60_000
}

function directionOf(p: BxPosition, orders: BxOrder[]): Direction {
  if (p.positionSide === 'LONG') return 'long'
  if (p.positionSide === 'SHORT') return 'short'
  // 單向持倉（BOTH）：看第一張開倉單的買賣方向
  const opening = orders.filter((o) => !o.reduceOnly && o.status === 'FILLED').sort((a, b) => a.time - b.time)[0]
  return opening?.side === 'SELL' ? 'short' : 'long'
}

export function convertPosition(p: BxPosition, allOrders: BxOrder[]): ImportedTrade {
  const orders = allOrders.filter((o) => belongsTo(o, p)).sort((a, b) => a.time - b.time)
  const direction = directionOf(p, orders)
  const sign = direction === 'long' ? 1 : -1
  const entry = Number(p.avgPrice)
  /** 止損在虧損那一側才算止損 */
  const onLossSide = (price: number) => (entry - price) * sign > 0

  const stops = orders
    .filter((o) => STOP_TYPES.has(o.type) && Number(o.stopPrice) > 0 && o.time <= p.updateTime)
    .map((o) => ({ at: o.time, price: Number(o.stopPrice) }))
  const first = stops[0]
  const planned_stop = first && onLossSide(first.price) ? first.price : null

  const stop_edits: StopEdit[] = []
  if (planned_stop !== null) {
    let prev = planned_stop
    for (const s of stops.slice(1)) {
      if (s.price === prev) continue
      stop_edits.push({ at: iso(s.at), from: prev, to: s.price })
      prev = s.price
    }
  }

  const tp = orders.find((o) => TP_TYPES.has(o.type) && Number(o.stopPrice) > 0 && (Number(o.stopPrice) - entry) * sign > 0)

  const lastFill = orders.filter((o) => o.status === 'FILLED' && o.reduceOnly).sort((a, b) => a.updateTime - b.updateTime).pop()
  const exit_reason: ExitReason = lastFill && STOP_TYPES.has(lastFill.type) ? 'stop' : lastFill && TP_TYPES.has(lastFill.type) ? 'target' : 'other'

  return {
    external_id: p.positionId,
    symbol: toJournalSymbol(p.symbol),
    direction,
    opened_at: iso(p.openTime),
    closed_at: iso(p.updateTime),
    entry_price: entry,
    exit_price: Number(p.avgClosePrice),
    pnl_usdt: Math.round(Number(p.netProfit) * 10000) / 10000,
    planned_stop,
    final_stop: planned_stop === null ? null : (stops[stops.length - 1]?.price ?? planned_stop),
    stop_edits,
    planned_target: tp ? Number(tp.stopPrice) : null,
    exit_reason,
  }
}

// ── 對帳 ────────────────────────────────────────────────

export interface MatchCandidate {
  id: string
  symbol: string
  direction: Direction
  opened_at: string | null
  entry_price: number
  card_at: string | null
  abandoned_at: string | null
  external_id: string | null
}

export const CARD_MATCH_MS = 12 * 3600_000
export const OPEN_MATCH_MS = 30 * 60_000
/** 手動記的時間常常是事後補的、差很多（2026-10-12：UNI 差 79 分鐘），進場價幾乎一樣就算同一筆 */
export const SAME_DAY_MS = 12 * 3600_000
export const PRICE_MATCH_PCT = 0.3

/**
 * 找出這個 BingX 倉位對應的手動紀錄：同幣種、同方向、還沒對過帳，且
 * - 待進場的作戰卡，在開倉前 12 小時內立的；或
 * - 手動記的交易，進場時間差 30 分鐘內；或同一天內（±12 小時）且進場價差 0.3% 以內。
 * 有多筆時取進場價最接近的，同價再取時間最接近的；used 裡的不再重複配對。
 */
export function findMatch(imp: ImportedTrade, candidates: MatchCandidate[], used: Set<string>): string | null {
  let best: { id: string; price: number; time: number } | null = null
  for (const c of candidates) {
    if (used.has(c.id)) continue
    const s = matchScore(imp, c)
    if (s && (!best || better(s, best))) best = { id: c.id, ...s }
  }
  return best?.id ?? null
}

/** 符合對帳條件時回傳價差 %（越小越好）與時間差，不符合回傳 null */
function matchScore(imp: ImportedTrade, c: MatchCandidate): { price: number; time: number } | null {
  if (c.external_id || c.abandoned_at || c.symbol !== imp.symbol || c.direction !== imp.direction) return null
  const open = Date.parse(imp.opened_at)
  const price = (Math.abs(c.entry_price - imp.entry_price) / imp.entry_price) * 100
  if (c.opened_at === null && c.card_at) {
    const d = open - Date.parse(c.card_at)
    return d >= 0 && d <= CARD_MATCH_MS ? { price, time: d } : null
  }
  if (c.opened_at) {
    const d = Math.abs(Date.parse(c.opened_at) - open)
    return d <= OPEN_MATCH_MS || (d <= SAME_DAY_MS && price <= PRICE_MATCH_PCT) ? { price, time: d } : null
  }
  return null
}

const better = (a: { price: number; time: number }, b: { price: number; time: number }) =>
  a.price < b.price - 1e-9 || (Math.abs(a.price - b.price) <= 1e-9 && a.time < b.time)

/**
 * 一次對整批倉位配對：先列出所有符合條件的組合，價差最小（同價取時間最近）的先配，
 * 每筆手動紀錄、每個倉位都只配一次。逐筆依時間配會讓較早的倉位搶走紀錄
 * （2026-10-12 ICP 實例：日誌 3.01，16:30@3.008 先處理就搶走了本該配 16:51@3.01 的紀錄）。
 * 回傳 external_id → 手動紀錄 id。
 */
export function assignMatches(imps: ImportedTrade[], candidates: MatchCandidate[]): Map<string, string> {
  const pairs: { imp: string; cand: string; price: number; time: number }[] = []
  for (const imp of imps) {
    for (const c of candidates) {
      const s = matchScore(imp, c)
      if (s) pairs.push({ imp: imp.external_id, cand: c.id, ...s })
    }
  }
  pairs.sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0))
  const out = new Map<string, string>()
  const usedCand = new Set<string>()
  for (const p of pairs) {
    if (out.has(p.imp) || usedCand.has(p.cand)) continue
    out.set(p.imp, p.cand)
    usedCand.add(p.cand)
  }
  return out
}

/**
 * 已存在的紀錄（使用者可能補過資料）要更新哪些欄位：BingX 的事實覆蓋，使用者的判斷保留。
 * 使用者填的初始止損優先；BingX 的止損只當作最後止損，兩者不同就記一筆移動，逆向移動照樣抓得到。
 */
export function mergePatch(
  existing: {
    planned_stop: number | null
    planned_target: number | null
    exit_reason: ExitReason | null
    stop_edits: StopEdit[]
  },
  imp: ImportedTrade,
): Partial<ImportedTrade> {
  const patch: Partial<ImportedTrade> = {
    external_id: imp.external_id,
    opened_at: imp.opened_at,
    closed_at: imp.closed_at,
    entry_price: imp.entry_price,
    exit_price: imp.exit_price,
    pnl_usdt: imp.pnl_usdt,
    planned_stop: existing.planned_stop ?? imp.planned_stop,
    planned_target: existing.planned_target ?? imp.planned_target,
    exit_reason: existing.exit_reason ?? imp.exit_reason,
  }
  if (imp.final_stop === null) return patch
  if (existing.planned_stop === null) {
    patch.stop_edits = imp.stop_edits
    patch.final_stop = imp.final_stop
    return patch
  }
  // 使用者有初始止損：保留 App 裡記的移動；最後止損和 App 記錄的不同，就補一筆到出場時間
  const edits = [...existing.stop_edits]
  const last = edits.length ? edits[edits.length - 1].to : existing.planned_stop
  if (imp.final_stop !== last) edits.push({ at: imp.closed_at, from: last, to: imp.final_stop })
  patch.stop_edits = edits
  patch.final_stop = imp.final_stop
  return patch
}

/**
 * 晚上補資料時使用者確認的初始止損。BingX 抓到的止損其實是「最後止損」，
 * 使用者填的初始止損不同時記一筆移動（時間記在出場），逆向移動才抓得到。
 * App 裡已經有移動紀錄的就不動它。
 */
export function fillStopPatch(
  t: { planned_stop: number | null; final_stop: number | null; stop_edits: StopEdit[]; closed_at: string | null },
  initialStop: number,
  nowIso: string,
): { planned_stop: number; final_stop: number; stop_edits: StopEdit[] } {
  if (t.stop_edits.length) return { planned_stop: initialStop, final_stop: t.final_stop ?? initialStop, stop_edits: t.stop_edits }
  const last = t.final_stop ?? t.planned_stop
  if (last === null || last === initialStop) return { planned_stop: initialStop, final_stop: initialStop, stop_edits: [] }
  return { planned_stop: initialStop, final_stop: last, stop_edits: [{ at: t.closed_at ?? nowIso, from: initialStop, to: last }] }
}
