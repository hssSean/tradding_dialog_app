// 驗證呼叫者：必須是日誌擁有者。Supabase 與 tradding_app 共用、公開註冊開著，
// 任何註冊者都拿得到 JWT；不限定 owner 的話，別人能把擁有者的 BingX 成交寫進自己的帳號。
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** 成功回傳以使用者 JWT 建立的 Supabase client（RLS 照常生效）；失敗回傳要直接回給前端的 Response */
export async function requireOwner(req: Request): Promise<{ supa: SupabaseClient; userId: string } | Response> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: '未登入' }, 401)
  const url = process.env.VITE_SUPABASE_URL
  const anon = process.env.VITE_SUPABASE_ANON_KEY
  const owner = process.env.JOURNAL_OWNER_USER_ID
  if (!url || !anon || !owner || !process.env.BINGX_API_KEY || !process.env.BINGX_SECRET_KEY) {
    return json({ error: '伺服器還沒設定 BingX 或 Supabase 環境變數' }, 500)
  }
  const supa = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supa.auth.getUser(token)
  if (error || !data.user) return json({ error: '登入已過期，請重新登入' }, 401)
  if (data.user.id !== owner) return json({ error: '這個帳號沒有連接 BingX' }, 403)
  return { supa, userId: data.user.id }
}
