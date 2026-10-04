import { createClient } from '@supabase/supabase-js'
import { currentStop, normalizeSymbol } from './trade'
import type { DailyNote, EntryInput, ExitInput, ImageKind, Settings, Setup, Trade, TradeImage, WeeklyReview } from './types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const configured = Boolean(url && anonKey)

/** 版本資訊：部署版本 + 金鑰末四碼（publishable key 本來就公開），用來確認手機載入的是哪一版 */
export const buildInfo = `${__BUILD_ID__} · key …${anonKey ? anonKey.slice(-4) : '無'}`

const supabase = createClient(url || 'http://localhost', anonKey || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true },
})

const BUCKET = 'journal-screenshots'
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
  const existing = maybe(await supabase.from('journal_settings').select('*').maybeSingle<Settings>())
  if (existing) return existing
  // 第一次登入時可能有兩個請求同時走到這裡（StrictMode、多個頁面同時載入），用 do nothing 避免撞主鍵
  check(await supabase.from('journal_settings').upsert({}, { onConflict: 'user_id', ignoreDuplicates: true }))
  return must(await supabase.from('journal_settings').select('*').single<Settings>())
}

export async function updateSettings(patch: Partial<Pick<Settings, 'starting_equity' | 'display_title'>>): Promise<void> {
  check(await supabase.from('journal_settings').update(patch).eq('user_id', await userId()))
}

export async function listSetups(): Promise<Setup[]> {
  return must(await supabase.from('journal_setups').select('*').order('sort_order').order('name').returns<Setup[]>())
}

export async function createSetup(name: string, sortOrder: number): Promise<Setup> {
  return must(await supabase.from('journal_setups').insert({ name: name.trim(), sort_order: sortOrder }).select('*').single<Setup>())
}

export async function updateSetup(id: string, patch: Partial<Pick<Setup, 'name' | 'archived' | 'sort_order'>>): Promise<void> {
  check(await supabase.from('journal_setups').update(patch).eq('id', id))
}

/** 圖鑑卡的每月檢查：保留或淘汰（淘汰＝封存） */
export async function reviewSetup(id: string, keep: boolean): Promise<void> {
  check(await supabase.from('journal_setups').update({ reviewed_at: nowIso(), archived: !keep }).eq('id', id))
}

// ── 交易 ────────────────────────────────────────────────

export async function listTrades(): Promise<Trade[]> {
  return must(await supabase.from('journal_trades').select('*').order('created_at', { ascending: false }).returns<Trade[]>())
}

export async function getTrade(id: string): Promise<Trade> {
  return must(await supabase.from('journal_trades').select('*').eq('id', id).single<Trade>())
}

const nowIso = () => new Date().toISOString()

/**
 * 立作戰卡（e.opened_at 為 null）或補記交易（e.opened_at 有值、沒有作戰卡）。
 * equity 是存檔當下的帳戶權益，用來算風險 %。
 */
export async function createTrade(e: EntryInput, equity: number | null): Promise<Trade> {
  const row = {
    ...e,
    symbol: normalizeSymbol(e.symbol),
    card_at: e.opened_at === null ? nowIso() : null,
    equity_at_entry: equity,
    gamified: true,
  }
  return must(await supabase.from('journal_trades').insert(row).select('*').single<Trade>())
}

/**
 * 作戰卡 → 已進場。成交價和計畫不同時，風險金額按止損距離等比調整（數量不變）。
 */
export async function markEntered(t: Trade, openedAt: string, fillPrice: number): Promise<Trade> {
  const planDist = Math.abs(t.entry_price - t.planned_stop)
  const fillDist = Math.abs(fillPrice - t.planned_stop)
  const risk = planDist > 0 ? Math.round(((t.risk_usdt * fillDist) / planDist) * 100) / 100 : t.risk_usdt
  return must(
    await supabase
      .from('journal_trades')
      .update({ opened_at: openedAt, entry_price: fillPrice, risk_usdt: risk })
      .eq('id', t.id)
      .select('*')
      .single<Trade>(),
  )
}

export async function abandonCard(id: string): Promise<void> {
  check(await supabase.from('journal_trades').update({ abandoned_at: nowIso() }).eq('id', id))
}

/** 進場後才補作戰卡：card_at 晚於 opened_at，只拿一半經驗值，評分仍視為沒有作戰卡 */
export async function fillCardLate(id: string, patch: { entry_reason: string | null; emotion: Trade['emotion'] }): Promise<Trade> {
  return must(
    await supabase
      .from('journal_trades')
      .update({ ...patch, card_at: nowIso() })
      .eq('id', id)
      .select('*')
      .single<Trade>(),
  )
}

/** 持倉中移動止損：每次都記下時間與前後價位，用來判斷是否逆向移動 */
export async function moveStop(t: Trade, to: number): Promise<Trade> {
  const edits = [...t.stop_edits, { at: nowIso(), from: currentStop(t), to }]
  return must(
    await supabase
      .from('journal_trades')
      .update({ stop_edits: edits, final_stop: to })
      .eq('id', t.id)
      .select('*')
      .single<Trade>(),
  )
}

/** 平倉。最後止損和目前止損不同時也記一筆移動；有寫復盤就記下復盤時間 */
export async function closeTrade(t: Trade, x: ExitInput): Promise<Trade> {
  const from = currentStop(t)
  const stop_edits = x.final_stop !== from ? [...t.stop_edits, { at: x.closed_at, from, to: x.final_stop }] : t.stop_edits
  const reviewed_at = t.reviewed_at ?? (x.note ? nowIso() : null)
  return must(
    await supabase
      .from('journal_trades')
      .update({ ...x, stop_edits, reviewed_at })
      .eq('id', t.id)
      .select('*')
      .single<Trade>(),
  )
}

/** 寫或改復盤；第一次寫的時間才算復盤時間 */
export async function saveReview(t: Trade, note: string): Promise<Trade> {
  const text = note.trim() || null
  const reviewed_at = t.reviewed_at ?? (text ? nowIso() : null)
  return must(
    await supabase
      .from('journal_trades')
      .update({ note: text, reviewed_at })
      .eq('id', t.id)
      .select('*')
      .single<Trade>(),
  )
}

export async function updateTrade(id: string, patch: Partial<EntryInput & ExitInput>): Promise<Trade> {
  const p = patch.symbol === undefined ? patch : { ...patch, symbol: normalizeSymbol(patch.symbol) }
  return must(await supabase.from('journal_trades').update(p).eq('id', id).select('*').single<Trade>())
}

/** 先刪 Storage 檔案再刪交易列（trade_images 隨 cascade 刪除） */
export async function deleteTrade(id: string): Promise<void> {
  const images = await listImages(id)
  if (images.length) check(await supabase.storage.from(BUCKET).remove(images.map((i) => i.path)))
  check(await supabase.from('journal_trades').delete().eq('id', id))
}

// ── 截圖 ────────────────────────────────────────────────

/** 所有截圖的標註資訊（不含檔案），給遊戲化引擎算功課與經驗值 */
export async function listImageMeta(): Promise<Pick<TradeImage, 'trade_id' | 'kind' | 'caption' | 'captioned_at'>[]> {
  return must(
    await supabase
      .from('journal_trade_images')
      .select('trade_id, kind, caption, captioned_at')
      .returns<Pick<TradeImage, 'trade_id' | 'kind' | 'caption' | 'captioned_at'>[]>(),
  )
}

/** 截圖標註；有文字才算標註，記下第一次標註的時間 */
export async function saveCaption(img: TradeImage, caption: string): Promise<void> {
  const text = caption.trim() || null
  const captioned_at = text ? (img.captioned_at ?? nowIso()) : null
  check(await supabase.from('journal_trade_images').update({ caption: text, captioned_at }).eq('id', img.id))
}

export async function listImages(tradeId: string): Promise<TradeImage[]> {
  return must(await supabase.from('journal_trade_images').select('*').eq('trade_id', tradeId).returns<TradeImage[]>())
}

/** 每次上傳用新檔名，避免簽名網址拿到 CDN 快取的舊圖；舊檔在新檔寫入後刪除 */
export async function uploadImage(tradeId: string, kind: ImageKind, blob: Blob): Promise<void> {
  const uid = await userId()
  const path = `${uid}/${tradeId}/${kind}-${Date.now()}.jpg`
  const old = (await listImages(tradeId)).find((i) => i.kind === kind)
  check(await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' }))
  check(
    await supabase
      .from('journal_trade_images')
      .upsert({ trade_id: tradeId, kind, path, size_bytes: blob.size }, { onConflict: 'trade_id,kind' }),
  )
  if (old) await supabase.storage.from(BUCKET).remove([old.path])
}

export async function imageUrl(path: string): Promise<string> {
  return must(await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL)).signedUrl
}

export async function storageUsageBytes(): Promise<number> {
  const rows = must(await supabase.from('journal_trade_images').select('size_bytes').returns<{ size_bytes: number }[]>())
  return rows.reduce((s, r) => s + r.size_bytes, 0)
}

// ── 每日筆記 ────────────────────────────────────────────

export async function listNotes(): Promise<DailyNote[]> {
  return must(await supabase.from('journal_daily_notes').select('*').order('date', { ascending: false }).returns<DailyNote[]>())
}

export async function saveNote(date: string, patch: Partial<Pick<DailyNote, 'market_view' | 'weekly_mistake'>>): Promise<void> {
  check(await supabase.from('journal_daily_notes').upsert({ date, ...patch }, { onConflict: 'user_id,date' }))
}

// ── 每週檢討 ────────────────────────────────────────────

export async function getWeeklyReview(weekStart: string): Promise<WeeklyReview | null> {
  return maybe(await supabase.from('journal_weekly_reviews').select('*').eq('week_start', weekStart).maybeSingle<WeeklyReview>())
}

export async function saveWeeklyReview(weekStart: string, note: string, nextWeekFocus: string): Promise<void> {
  check(
    await supabase
      .from('journal_weekly_reviews')
      .upsert({ week_start: weekStart, note, next_week_focus: nextWeekFocus }, { onConflict: 'user_id,week_start' }),
  )
}
