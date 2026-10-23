import { chartRange, intervalFor, missingShots } from './chartShots'
import { fetchKlines, listImageMeta, listTrades, uploadImage } from './db'

let running = false

/**
 * 替缺圖的交易畫 K 線截圖並上傳（同步完成後在背景跑）。回傳新增的張數。
 * 單筆失敗就跳過，下次再試；K 線沒資料不上傳空圖。畫圖套件只在有缺圖時才載入。
 */
export async function generateMissingShots(): Promise<number> {
  if (running) return 0
  running = true
  try {
    const [trades, images] = await Promise.all([listTrades(), listImageMeta()])
    const todo = missingShots(trades, images)
    if (!todo.length) return 0
    const { renderShot } = await import('../components/chartDraw')
    let made = 0
    for (const { trade, kind } of todo) {
      try {
        const now = Date.now()
        const interval = intervalFor(trade, now)
        const { start, end } = chartRange(trade, kind === 'entry' ? 'entry' : 'full', interval, now)
        const candles = (await fetchKlines(trade.symbol, interval, start, end)).filter((k) => k.time <= end)
        if (!candles.length) continue
        await uploadImage(trade.id, kind, await renderShot(trade, kind, interval, candles), { auto: true })
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
