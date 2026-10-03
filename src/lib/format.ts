import { DAY_MS, TPE_OFFSET_MS, hhmm, mmdd, tpe, tpeMidnight, ymd } from './tz'

function signed(x: number, digits: number): string {
  const v = Math.abs(x) < 10 ** -digits / 2 ? 0 : x
  const prefix = v > 0 ? '+' : v < 0 ? '−' : ''
  return prefix + Math.abs(v).toFixed(digits)
}

export const fmtR = (r: number) => `${signed(r, 2)}R`
export const fmtUsdt = (v: number) => signed(v, 2)
export const fmtPct = (x: number) => `${Math.round(x * 100)}%`

/** 台北 'MM/DD HH:mm' */
export function fmtDateTime(iso: string): string {
  const t = tpe(iso)
  return `${mmdd(t)} ${hhmm(t)}`
}

/** ISO → `<input type="datetime-local">` 的值（台北時間） */
export function toLocalInput(iso: string): string {
  const t = tpe(iso)
  return `${ymd(t)}T${hhmm(t)}`
}

/** `<input type="datetime-local">` 的值（視為台北時間）→ ISO */
export function fromLocalInput(value: string): string {
  const [date, time = '00:00'] = value.split('T')
  const [h, m] = time.split(':').map(Number)
  return new Date(tpeMidnight(date).getTime() + (h * 60 + m) * 60_000).toISOString()
}

/** '2026-10-05' → '10/05–10/11' */
export function weekTitle(weekStart: string): string {
  const start = new Date(tpeMidnight(weekStart).getTime() + TPE_OFFSET_MS)
  const end = new Date(start.getTime() + 6 * DAY_MS)
  return `${mmdd(start)}–${mmdd(end)}`
}

/** 表單數字欄：空白 → null；接受逗號小數點；無效 → NaN */
export function parseNum(s: string): number | null {
  const v = s.trim().replace(',', '.')
  if (v === '') return null
  return Number(v)
}
