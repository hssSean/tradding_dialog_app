// GET /api/bingx/open — BingX 目前持倉（收件匣與開倉卡用）。
// ⚠ 回應欄位 2026-11-13 未實測（當時沒有持倉），前端只用 positionId／symbol／positionSide／positionAmt／avgPrice／時間。
import type { BxOpenPosition } from '../../src/notify/events.js'
import { json, requireOwner } from '../_lib/auth.js'
import { BingxError, bingxSigned } from '../_lib/bingx.js'

export async function GET(req: Request): Promise<Response> {
  const auth = await requireOwner(req)
  if (auth instanceof Response) return auth
  try {
    const data = await bingxSigned<BxOpenPosition[]>('/openApi/swap/v2/user/positions', {})
    return json({ positions: (data ?? []).filter((p) => Number(p.positionAmt ?? 1) !== 0) })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, e instanceof BingxError ? 502 : 500)
  }
}
