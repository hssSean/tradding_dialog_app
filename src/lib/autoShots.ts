import { chartRange, shotsToDraw } from './chartShots'
import { fetchKlines, listImageMeta, listTrades, uploadImage } from './db'

let running = false

/**
 * 替缺圖或指紋過期的交易畫 K 線截圖並上傳（同步後、打開詳情頁時在背景跑）。回傳新畫的張數。
 * 給 tradeId 只處理那一筆。單筆失敗就跳過，下次再試；K 線沒資料不上傳空圖。畫圖套件只在有事要做時才載入。
 */
export async function generateMissingShots(tradeId?: string): Promise<number> {
  if (running) return 0
  running = true
  try {
    const [trades, images] = await Promise.all([listTrades(), listImageMeta()])
    const now = Date.now()
    const todo = shotsToDraw(tradeId ? trades.filter((t) => t.id === tradeId) : trades, images, now)
    if (!todo.length) return 0
    const { renderShot } = await import('../components/chartDraw')
    let made = 0
    for (const { trade, kind, interval, key } of todo) {
      try {
        const { start, end } = chartRange(trade, kind === 'entry' ? 'entry' : 'full', interval, now)
        const candles = (await fetchKlines(trade.symbol, interval, start, end)).filter((k) => k.time <= end)
        if (!candles.length) continue
        await uploadImage(trade.id, kind, await renderShot(trade, kind, interval, candles), { autoKey: key })
        made += 1
      } catch (e) {
        console.warn(`自動截圖失敗 ${trade.symbol} ${kind}`, e)
      }
    }
    return made
  } finally {
    running = false
  }
}
