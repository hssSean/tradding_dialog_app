import { createClient } from '@supabase/supabase-js'
import { normalizeSymbol } from './trade'
import type { EntryInput, ExitInput, ImageKind, Settings, Setup, Trade, TradeImage, WeeklyReview } from './types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const configured = Boolean(url && anonKey)

const supabase = createClient(url || 'http://localhost', anonKey || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true },
})

const BUCKET = 'screenshots'
const SIGNED_URL_TTL = 3600

type Res<T> = { data: T | null; error: { message: string } | null }

/** 有錯就丟；沒資料也算錯 */
function must<T>(res: Res<T>): T {
  if (res.error) throw new Error(res.error.message)
  if (res.data === null) throw new Error('查無資料')
  return res.data
}

function maybe<T>(res: Res<T>): T | null {
  if (res.error) throw new Error(res.error.message)
  return res.data
}

function check(res: { error: { message: string } | null }): void {
  if (res.error) throw new Error(res.error.message)
}

async function userId(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const id = data.session?.user.id
  if (!id) throw new Error('登入已過期，請重新登入')
  return id
}

// ── 登入 ────────────────────────────────────────────────

export function onAuthChange(cb: (signedIn: boolean) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(Boolean(session)))
  return () => data.subscription.unsubscribe()
}

export async function isSignedIn(): Promise<boolean> {
  const { data } = await supabase.auth.getSession()
  return Boolean(data.session)
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(error.message === 'Invalid login credentials' ? '帳號或密碼錯誤' : error.message)
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}

// ── 設定與 setup ────────────────────────────────────────

export async function getSettings(): Promise<Settings> {
  const existing = maybe(await supabase.from('settings').select('*').maybeSingle<Settings>())
  if (existing) return existing
  // 第一次登入時可能有兩個請求同時走到這裡（StrictMode、多個頁面同時載入），用 do nothing 避免撞主鍵
  check(await supabase.from('settings').upsert({}, { onConflict: 'user_id', ignoreDuplicates: true }))
  return must(await supabase.from('settings').select('*').single<Settings>())
}

export async function updateSettings(standardRisk: number): Promise<void> {
  check(await supabase.from('settings').update({ standard_risk_usdt: standardRisk }).eq('user_id', await userId()))
}

export async function listSetups(): Promise<Setup[]> {
  return must(await supabase.from('setups').select('*').order('sort_order').order('name').returns<Setup[]>())
}

export async function createSetup(name: string, sortOrder: number): Promise<Setup> {
  return must(await supabase.from('setups').insert({ name: name.trim(), sort_order: sortOrder }).select('*').single<Setup>())
}

export async function updateSetup(id: string, patch: Partial<Pick<Setup, 'name' | 'archived' | 'sort_order'>>): Promise<void> {
  check(await supabase.from('setups').update(patch).eq('id', id))
}

// ── 交易 ────────────────────────────────────────────────

export async function listTrades(): Promise<Trade[]> {
  return must(await supabase.from('trades').select('*').order('opened_at', { ascending: false }).returns<Trade[]>())
}

export async function getTrade(id: string): Promise<Trade> {
  return must(await supabase.from('trades').select('*').eq('id', id).single<Trade>())
}

export async function createTrade(e: EntryInput): Promise<Trade> {
  return must(await supabase.from('trades').insert({ ...e, symbol: normalizeSymbol(e.symbol) }).select('*').single<Trade>())
}

export async function closeTrade(id: string, x: ExitInput): Promise<Trade> {
  return must(await supabase.from('trades').update(x).eq('id', id).select('*').single<Trade>())
}

export async function updateTrade(id: string, patch: Partial<EntryInput & ExitInput>): Promise<Trade> {
  const p = patch.symbol === undefined ? patch : { ...patch, symbol: normalizeSymbol(patch.symbol) }
  return must(await supabase.from('trades').update(p).eq('id', id).select('*').single<Trade>())
}

/** 先刪 Storage 檔案再刪交易列（trade_images 隨 cascade 刪除） */
export async function deleteTrade(id: string): Promise<void> {
  const images = await listImages(id)
  if (images.length) check(await supabase.storage.from(BUCKET).remove(images.map((i) => i.path)))
  check(await supabase.from('trades').delete().eq('id', id))
}

// ── 截圖 ────────────────────────────────────────────────

export async function listImages(tradeId: string): Promise<TradeImage[]> {
  return must(await supabase.from('trade_images').select('*').eq('trade_id', tradeId).returns<TradeImage[]>())
}

/** 每次上傳用新檔名，避免簽名網址拿到 CDN 快取的舊圖；舊檔在新檔寫入後刪除 */
export async function uploadImage(tradeId: string, kind: ImageKind, blob: Blob): Promise<void> {
  const uid = await userId()
  const path = `${uid}/${tradeId}/${kind}-${Date.now()}.jpg`
  const old = (await listImages(tradeId)).find((i) => i.kind === kind)
  check(await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' }))
  check(
    await supabase
      .from('trade_images')
      .upsert({ trade_id: tradeId, kind, path, size_bytes: blob.size }, { onConflict: 'trade_id,kind' }),
  )
  if (old) await supabase.storage.from(BUCKET).remove([old.path])
}

export async function imageUrl(path: string): Promise<string> {
  return must(await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL)).signedUrl
}

export async function storageUsageBytes(): Promise<number> {
  const rows = must(await supabase.from('trade_images').select('size_bytes').returns<{ size_bytes: number }[]>())
  return rows.reduce((s, r) => s + r.size_bytes, 0)
}

// ── 每週檢討 ────────────────────────────────────────────

export async function getWeeklyReview(weekStart: string): Promise<WeeklyReview | null> {
  return maybe(await supabase.from('weekly_reviews').select('*').eq('week_start', weekStart).maybeSingle<WeeklyReview>())
}

export async function saveWeeklyReview(weekStart: string, note: string, nextWeekFocus: string): Promise<void> {
  check(
    await supabase
      .from('weekly_reviews')
      .upsert({ week_start: weekStart, note, next_week_focus: nextWeekFocus }, { onConflict: 'user_id,week_start' }),
  )
}
