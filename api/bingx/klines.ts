// GET /api/bingx/klines?symbol=ADAUSDT&interval=15m&startTime=..&endTime=..
// BingX K 線是公開資料，但仍要求登入的擁有者，避免變成開放的代理。
import { toBingxSymbol } from '../../src/sync/bingx.js'
import { json, requireOwner } from '../_lib/auth.js'
import { BingxError, bingxPublic } from '../_lib/bingx.js'

const INTERVALS = new Set(['1m', '5m', '15m', '30m', '1h', '4h', '1d'])

export async function GET(req: Request): Promise<Response> {
  const auth = await requireOwner(req)
  if (auth instanceof Response) return auth
  const q = new URL(req.url).searchParams
  const symbol = q.get('symbol')
  const interval = q.get('interval') ?? '15m'
  const startTime = Number(q.get('startTime'))
  const endTime = Number(q.get('endTime'))
  if (!symbol || !INTERVALS.has(interval) || !startTime || !endTime) return json({ error: '參數錯誤' }, 400)
  try {
    const data = await bingxPublic<{ open: string; high: string; low: string; close: string; time: number }[]>('/openApi/swap/v3/quote/klines', {
      symbol: toBingxSymbol(symbol),
      interval,
      startTime,
      endTime,
      limit: 1000,
    })
    const candles = (data ?? [])
      .map((k) => ({ time: k.time, open: +k.open, high: +k.high, low: +k.low, close: +k.close }))
      .sort((a, b) => a.time - b.time)
    return new Response(JSON.stringify(candles), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=300' },
    })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, e instanceof BingxError ? 502 : 500)
  }
}
