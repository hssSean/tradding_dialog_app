// service role：只給 /api/notify/tick 用（cron 執行時沒有使用者 JWT）。
// 規則：只寫 journal_push_subscriptions／journal_push_log，只「讀」journal_trades 計數，且一律限 JOURNAL_OWNER_USER_ID。
// 交易寫入一律走使用者 JWT（api/_lib/auth.ts），不要在這裡加。
import crypto from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { json } from './auth.js'

export function cronAuthorized(req: Request): boolean {
  const secret = process.env.NOTIFY_CRON_SECRET
  const got = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!secret || got.length !== secret.length) return false
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(secret))
}

export function adminClient(): { supa: SupabaseClient; ownerId: string } | Response {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const ownerId = process.env.JOURNAL_OWNER_USER_ID
  if (!url || !key || !ownerId) return json({ error: '伺服器還沒設定 SUPABASE_SERVICE_ROLE_KEY 或 JOURNAL_OWNER_USER_ID' }, 500)
  return { supa: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }), ownerId }
}
