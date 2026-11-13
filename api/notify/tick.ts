// GET|POST /api/notify/tick — 外部 cron 每 5 分鐘打一次（header Authorization: Bearer <NOTIFY_CRON_SECRET>）。
//   ?dryRun=1 → 只回傳會推什麼，不送、不寫紀錄。
// 找 BingX 新開倉／平倉與每日 22:00 待標記提醒，推播到擁有者的裝置。
// 用 service role（見 api/_lib/admin.ts 的限制）：不寫任何交易，交易由 App 用使用者 JWT 寫。
import type { SupabaseClient } from '@supabase/supabase-js'
import { needsTag, untaggedOpen } from '../../src/lib/quickTag.js'
import type { RawTrade } from '../../src/lib/types.js'
import { closeEvents, dailyEvent, openEvents, payloadOf, DAILY_HOUR, type BxOpenPosition, type PushEvent } from '../../src/notify/events.js'
import type { BxPosition } from '../../src/sync/bingx.js'
import { adminClient, cronAuthorized } from '../_lib/admin.js'
import { json } from '../_lib/auth.js'
import { bingxSigned } from '../_lib/bingx.js'
import { sendAll, vapidDiagnosis, type Sub } from '../_lib/push.js'

const DAY = 86_400_000
const HOUR = 3_600_000

export const GET = handle
export const POST = handle

async function handle(req: Request): Promise<Response> {
  if (!cronAuthorized(req)) return json({ error: 'unauthorized' }, 401)
  const admin = adminClient()
  if (admin instanceof Response) return admin
  const { supa, ownerId } = admin
  const dryRun = new URL(req.url).searchParams.get('dryRun') === '1'
  const now = Date.now()

  try {
    const [subsRes, logRes] = await Promise.all([
      supa.from('journal_push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', ownerId),
      supa.from('journal_push_log').select('event_key').eq('user_id', ownerId),
    ])
    if (subsRes.error) throw new Error(subsRes.error.message)
    if (logRes.error) throw new Error(logRes.error.message)
    const subs = (subsRes.data ?? []) as Sub[]
    const sent = new Set((logRes.data ?? []).map((r: { event_key: string }) => r.event_key))

    // ?test=1：送一則測試推播並回傳結果與 VAPID 診斷（只回是否相符，不回金鑰）
    if (new URL(req.url).searchParams.get('test') === '1') {
      const r = await sendAll(subs, { title: '測試推播', body: '排程端送出', url: '/', tag: 'test' })
      return json({ subs: subs.length, ...r, vapid: vapidDiagnosis() })
    }

    if (!subs.length && !dryRun) {
      await markTick(supa, ownerId, now)
      return json({ subs: 0, events: [] })
    }

    const positions = ((await bingxSigned<BxOpenPosition[]>('/openApi/swap/v2/user/positions', {})) ?? []).filter((p) => Number(p.positionAmt ?? 1) !== 0)
    const history = await recentClosed(now)

    // 已經在 App 裡標過的（先開 App、或從收件匣標的）就不推
    const done = await taggedKeys(supa, ownerId, [...positions.map((p) => p.positionId), ...history.map((p) => p.positionId)])
    const skip = new Set([...sent, ...done])
    const events: PushEvent[] = [...openEvents(positions, skip, now), ...closeEvents(history, skip, now)]
    // 每日提醒只在台北 22 點那一小時才需要計數，其他時間省掉查詢
    const tpeHour = new Date(now + 8 * HOUR).getUTCHours()
    if (tpeHour === DAILY_HOUR) {
      const daily = dailyEvent(await pendingCount(supa, ownerId, positions, now), sent, now)
      if (daily) events.push(daily)
    }

    if (dryRun) return json({ subs: subs.length, events: events.map((e) => ({ ...e, payload: payloadOf(e) })) })

    const results: { key: string; ok: boolean; errors: string[] }[] = []
    const gone = new Set<string>()
    for (const e of events) {
      const live = subs.filter((s) => !gone.has(s.id))
      if (!live.length) break
      const r = await sendAll(live, payloadOf(e))
      r.gone.forEach((id) => gone.add(id))
      results.push({ key: e.key, ok: r.ok, errors: r.errors })
      // 送達才記；失敗下一輪再推
      if (r.ok) {
        const { error } = await supa.from('journal_push_log').upsert({ user_id: ownerId, event_key: e.key }, { onConflict: 'user_id,event_key', ignoreDuplicates: true })
        if (error) throw new Error(error.message)
      }
    }
    if (gone.size) await supa.from('journal_push_subscriptions').delete().in('id', [...gone]).eq('user_id', ownerId)
    await markTick(supa, ownerId, now)
    return json({ subs: subs.length - gone.size, results })
  } catch (e) {
    // BingX 或 DB 失敗：不寫 tick 以外的紀錄，下一輪補推
    if (!dryRun) await markTick(supa, ownerId, now).catch(() => {})
    return json({ error: e instanceof Error ? e.message : String(e) }, 502)
  }
}

async function markTick(supa: SupabaseClient, ownerId: string, now: number): Promise<void> {
  const { error } = await supa.from('journal_push_log').upsert({ user_id: ownerId, event_key: 'tick', sent_at: new Date(now).toISOString() }, { onConflict: 'user_id,event_key' })
  if (error) throw new Error(error.message)
}

/** 最近 2 小時有平倉手續費的幣種 → 這些幣的歷史倉位（closeEvents 再篩 2 小時內完全平倉的） */
async function recentClosed(now: number): Promise<BxPosition[]> {
  const fees = (await bingxSigned<{ symbol: string }[]>('/openApi/swap/v2/user/income', {
    incomeType: 'TRADING_FEE',
    startTime: now - 2 * HOUR,
    endTime: now,
    limit: 1000,
  })) ?? []
  const symbols = [...new Set(fees.map((f) => f.symbol).filter(Boolean))]
  const out: BxPosition[] = []
  for (const symbol of symbols) {
    // ⚠ pageIndex 從 0 開始（2026-10-12 實測）
    const data = await bingxSigned<{ positionHistory?: BxPosition[] }>('/openApi/swap/v1/trade/positionHistory', {
      symbol,
      startTs: now - 7 * DAY,
      endTs: now,
      pageIndex: 0,
      pageSize: 100,
    })
    out.push(...(data?.positionHistory ?? []))
  }
  return out
}

/** 待標記數：日誌裡的（同收件匣 needsTag）＋ BingX 持倉中但日誌沒有紀錄的。只讀。 */
async function pendingCount(supa: SupabaseClient, ownerId: string, positions: BxOpenPosition[], now: number): Promise<number> {
  const { data, error } = await supa
    .from('journal_trades')
    .select('opened_at, closed_at, card_at, reviewed_at, abandoned_at, gamified, source, external_id')
    .eq('user_id', ownerId)
    .eq('source', 'bingx')
    .or(`closed_at.is.null,closed_at.gte.${new Date(now - 7 * DAY).toISOString()}`)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as RawTrade[]
  const ids = positions.map((p) => p.positionId)
  let known: { external_id: string | null }[] = []
  if (ids.length) {
    const r = await supa.from('journal_trades').select('external_id').eq('user_id', ownerId).in('external_id', ids)
    if (r.error) throw new Error(r.error.message)
    known = r.data ?? []
  }
  return rows.filter((t) => needsTag(t, now)).length + untaggedOpen(positions, known).length
}

/** 日誌裡已標過的倉位 → 視同已推：有作戰卡的不推開倉，已檢討的不推平倉 */
async function taggedKeys(supa: SupabaseClient, ownerId: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return []
  const { data, error } = await supa
    .from('journal_trades')
    .select('external_id, card_at, reviewed_at')
    .eq('user_id', ownerId)
    .in('external_id', [...new Set(ids)])
  if (error) throw new Error(error.message)
  return (data ?? []).flatMap((r: { external_id: string; card_at: string | null; reviewed_at: string | null }) => [
    ...(r.card_at ? [`open:${r.external_id}`] : []),
    ...(r.reviewed_at ? [`close:${r.external_id}`] : []),
  ])
}
