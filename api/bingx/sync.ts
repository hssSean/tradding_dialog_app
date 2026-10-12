// POST /api/bingx/sync — 由 App 分三步呼叫，避免單次超過函數時間上限：
//   { action: 'plan' }                                → { start, symbols }
//   { action: 'symbol', symbol, start, dryRun? }      → 這個幣種新增／合併／更新了幾筆
//   { action: 'finish', at }                          → 記下同步時間
// 寫入一律用使用者的 JWT（RLS 照常生效），不用 service role。
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  assignMatches,
  convertPosition,
  mergePatch,
  toBingxSymbol,
  toJournalSymbol,
  type BxOrder,
  type BxPosition,
  type MatchCandidate,
} from '../../src/sync/bingx.js'
import type { ExitReason, StopEdit } from '../../src/lib/types.js'
import { json, requireOwner } from '../_lib/auth.js'
import { BingxError, bingxSigned, sleep } from '../_lib/bingx.js'

const DAY = 86_400_000
/** BingX 歷史資料只保留約 3 個月 */
const MAX_LOOKBACK = 89 * DAY
/** 訂單查詢一次最多 7 天 */
const ORDER_WINDOW = 7 * DAY - 1
/** allOrders 限速 1/s per UID */
const ORDER_GAP_MS = 1100

type Existing = MatchCandidate & {
  planned_stop: number | null
  planned_target: number | null
  exit_reason: ExitReason | null
  stop_edits: StopEdit[]
}

export async function POST(req: Request): Promise<Response> {
  const auth = await requireOwner(req)
  if (auth instanceof Response) return auth
  const body = (await req.json().catch(() => ({}))) as {
    action?: string
    symbol?: string
    start?: number
    at?: string
    dryRun?: boolean
  }
  try {
    if (body.action === 'plan') return json(await plan(auth.supa))
    if (body.action === 'symbol' && body.symbol && body.start) return json(await syncSymbol(auth.supa, body.symbol, body.start, Boolean(body.dryRun)))
    if (body.action === 'finish' && body.at) {
      const { error } = await auth.supa.from('journal_settings').update({ bingx_synced_at: body.at }).eq('user_id', auth.userId)
      if (error) throw new Error(error.message)
      return json({ ok: true })
    }
    return json({ error: '參數錯誤' }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, e instanceof BingxError ? 502 : 500)
  }
}

/** 同步起點與要處理的幣種 */
async function plan(supa: SupabaseClient): Promise<{ start: number; symbols: string[] }> {
  const now = Date.now()
  const { data: settings } = await supa.from('journal_settings').select('bingx_synced_at').maybeSingle()
  let start: number
  if (settings?.bingx_synced_at) {
    // 和上次重疊一天，防止邊界漏單
    start = Date.parse(settings.bingx_synced_at) - DAY
  } else {
    // 第一次同步：從日誌第一筆交易那天開始，沒有紀錄就抓 30 天
    const { data: first } = await supa.from('journal_trades').select('opened_at, created_at').order('created_at').limit(1).maybeSingle()
    start = first ? Date.parse(first.opened_at ?? first.created_at) - DAY : now - 30 * DAY
  }
  start = Math.max(start, now - MAX_LOOKBACK)

  // 有手續費紀錄的幣種＝這段時間交易過的幣種（income 不必指定幣種）
  const symbols = new Set<string>()
  let end = now
  for (let i = 0; i < 20; i++) {
    const rows = await bingxSigned<{ symbol: string; time: number }[]>('/openApi/swap/v2/user/income', {
      incomeType: 'TRADING_FEE',
      startTime: start,
      endTime: end,
      limit: 1000,
    })
    for (const r of rows ?? []) if (r.symbol) symbols.add(r.symbol)
    if (!rows || rows.length < 1000) break
    end = Math.min(...rows.map((r) => r.time)) - 1
  }
  // 手續費為 0 的倉位（抵扣券、體驗金）沒有收益流水；日誌記過的幣種也一併查（2026-10-12 LTC 實例）
  const { data: journalSymbols } = await supa.from('journal_trades').select('symbol').gte('created_at', new Date(start).toISOString())
  for (const r of journalSymbols ?? []) symbols.add(toBingxSymbol(r.symbol))
  return { start, symbols: [...symbols].sort() }
}

async function syncSymbol(supa: SupabaseClient, bxSymbol: string, start: number, dryRun: boolean) {
  const now = Date.now()
  const symbol = toBingxSymbol(bxSymbol)

  // 已平倉的倉位（分頁）。⚠ pageIndex 從 0 開始：文件寫「預設 1」，實測 1 是第二頁（2026-10-12）
  const positions: BxPosition[] = []
  for (let page = 0; page < 20; page++) {
    const data = await bingxSigned<{ positionHistory?: BxPosition[] }>('/openApi/swap/v1/trade/positionHistory', {
      symbol,
      startTs: start,
      endTs: now,
      pageIndex: page,
      pageSize: 100,
    })
    const list = data?.positionHistory ?? []
    positions.push(...list)
    if (list.length < 100) break
  }
  const closed = positions.filter((p) => p.closeAllPositions && p.openTime >= start)
  if (!closed.length) return { symbol, created: 0, merged: 0, updated: 0, pendingStop: 0, actions: [] }

  // 只查有倉位的時間段的訂單，每段最多 7 天
  const from = Math.min(...closed.map((p) => p.openTime)) - 3_600_000
  const to = Math.min(now, Math.max(...closed.map((p) => p.updateTime)) + 60_000)
  const orders: BxOrder[] = []
  for (let a = from; a < to; a += ORDER_WINDOW + 1) {
    await sleep(ORDER_GAP_MS)
    const data = await bingxSigned<{ orders?: BxOrder[] }>('/openApi/swap/v2/trade/allOrders', {
      symbol,
      startTime: a,
      endTime: Math.min(a + ORDER_WINDOW, to),
      limit: 1000,
    })
    orders.push(...(data?.orders ?? []))
  }

  const journalSymbol = toJournalSymbol(symbol)
  const { data: rows, error } = await supa
    .from('journal_trades')
    .select('id, symbol, direction, opened_at, entry_price, card_at, abandoned_at, external_id, planned_stop, planned_target, exit_reason, stop_edits')
    .eq('symbol', journalSymbol)
  if (error) throw new Error(error.message)
  const existing = (rows ?? []) as Existing[]
  const byExternal = new Map(existing.filter((r) => r.external_id).map((r) => [r.external_id!, r]))
  const imps = closed.sort((a, b) => a.openTime - b.openTime).map((p) => convertPosition(p, orders))
  const matches = assignMatches(
    imps.filter((i) => !byExternal.has(i.external_id)),
    existing,
  )

  let created = 0
  let merged = 0
  let updated = 0
  let pendingStop = 0
  const actions: { kind: 'create' | 'merge' | 'update'; opened_at: string; id?: string }[] = []

  for (const imp of imps) {
    const known = byExternal.get(imp.external_id)
    const matchId = known ? null : matches.get(imp.external_id)
    const target = known ?? (matchId ? existing.find((r) => r.id === matchId)! : null)

    if (target) {
      const patch = mergePatch(target, imp)
      if (!dryRun) {
        const { error: e } = await supa.from('journal_trades').update(patch).eq('id', target.id)
        if (e) throw new Error(e.message)
      }
      if (known) updated++
      else merged++
      if (patch.planned_stop == null) pendingStop++
      actions.push({ kind: known ? 'update' : 'merge', opened_at: imp.opened_at, id: target.id })
    } else {
      if (!dryRun) {
        const { error: e } = await supa.from('journal_trades').insert({ ...imp, source: 'bingx', gamified: true, mistake_tags: [] })
        if (e) throw new Error(e.message)
      }
      created++
      if (imp.planned_stop === null) pendingStop++
      actions.push({ kind: 'create', opened_at: imp.opened_at })
    }
  }
  return { symbol: journalSymbol, created, merged, updated, pendingStop, actions }
}
