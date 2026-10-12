// BingX OpenAPI 呼叫（伺服器端專用：API key 只存在 Vercel 環境變數）
import crypto from 'node:crypto'
import { canonicalQuery, parseBingxJson } from '../../src/sync/bingx.js'

const BASES = ['https://open-api.bingx.com', 'https://open-api.bingx.pro']

export class BingxError extends Error {}

/** 網路層失敗才換 .pro 備援；BingX 回 code != 0 是業務錯誤，直接丟出 */
async function get<T>(path: string, params: Record<string, string | number>, signed: boolean): Promise<T> {
  const p: Record<string, string | number> = { ...params }
  if (signed) p.timestamp = Date.now()
  const qs = canonicalQuery(p)
  const sig = signed ? crypto.createHmac('sha256', process.env.BINGX_SECRET_KEY ?? '').update(qs).digest('hex') : null
  const headers: Record<string, string> = signed ? { 'X-BX-APIKEY': process.env.BINGX_API_KEY ?? '' } : {}
  let lastErr: unknown
  for (const base of BASES) {
    let text: string
    try {
      const res = await fetch(`${base}${path}?${qs}${sig ? `&signature=${sig}` : ''}`, { headers, signal: AbortSignal.timeout(10_000) })
      text = await res.text()
    } catch (e) {
      lastErr = e
      continue
    }
    const body = parseBingxJson<{ code: number; msg?: string; data: T }>(text)
    if (body.code !== 0) throw new BingxError(`BingX ${path}：${body.code} ${body.msg ?? ''}`.trim())
    return body.data
  }
  throw new BingxError(`連不上 BingX：${lastErr instanceof Error ? lastErr.message : String(lastErr)}`)
}

export const bingxSigned = <T>(path: string, params: Record<string, string | number>) => get<T>(path, params, true)
export const bingxPublic = <T>(path: string, params: Record<string, string | number>) => get<T>(path, params, false)

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
