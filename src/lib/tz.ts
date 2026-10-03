/** 台北時間（UTC+8，無日光節約）。用位移後的 UTC 欄位讀「台北的牆上時間」，不依賴裝置時區。 */
export const TPE_OFFSET_MS = 8 * 3600_000
export const DAY_MS = 24 * 3600_000

const pad = (n: number) => String(n).padStart(2, '0')

/** 回傳一個 Date，其 getUTC* 欄位等於台北當地時間 */
export function tpe(d: Date | string): Date {
  return new Date(new Date(d).getTime() + TPE_OFFSET_MS)
}

/** 'YYYY-MM-DD'，以 getUTC* 欄位格式化 */
export function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export function mmdd(d: Date): string {
  return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`
}

export function hhmm(d: Date): string {
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/** 台北日期 'YYYY-MM-DD' 的 00:00 對應的真實時刻 */
export function tpeMidnight(date: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) - TPE_OFFSET_MS)
}

export { pad }
