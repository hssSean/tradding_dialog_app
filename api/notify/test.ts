// POST /api/notify/test — 訂閱後送一則測試推播。用使用者 JWT 讀自己的訂閱（RLS），不用 service role。
import { json, requireOwner } from '../_lib/auth.js'
import { sendAll, vapidDiagnosis, type Sub } from '../_lib/push.js'

export async function POST(req: Request): Promise<Response> {
  const auth = await requireOwner(req)
  if (auth instanceof Response) return auth
  const { data, error } = await auth.supa.from('journal_push_subscriptions').select('id, endpoint, p256dh, auth')
  if (error) return json({ error: error.message }, 500)
  const subs = (data ?? []) as Sub[]
  if (!subs.length) return json({ error: '沒有訂閱' }, 400)
  try {
    const r = await sendAll(subs, { title: '推播已開啟', body: '開倉、平倉後會在這裡提醒你標記', url: '/', tag: 'test' })
    if (r.gone.length) await auth.supa.from('journal_push_subscriptions').delete().in('id', r.gone)
    if (r.ok) return json({ ok: true })
    const d = vapidDiagnosis()
    return json({ error: `${r.errors[0] ?? '訂閱已失效，請重新開啟'}｜診斷 ${Object.entries(d).map(([k, v]) => `${k}=${v}`).join(' ')}` }, 502)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
}
