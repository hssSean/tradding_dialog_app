import { useEffect, useRef, useState } from 'react'
import { chartRange, defaultInterval, type Interval } from '../lib/chartShots'
import { fetchKlines } from '../lib/db'
import type { RawTrade } from '../lib/types'
import { createTradeChart, drawTrade } from './chartDraw'
import { Segmented } from './ui'

/* 交易的 K 線圖：進場前、出場後各留一段行情，標出進出場、止損、目標、止損移動。畫法在 chartDraw.ts。 */
export default function TradeChart({ trade }: { trade: RawTrade }) {
  const open = Date.parse(trade.opened_at!)
  const close = trade.closed_at ? Date.parse(trade.closed_at) : Date.now()
  const [interval, setIv] = useState<Interval>(() => defaultInterval(close - open))
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const { start, end } = chartRange(trade, 'full', interval, Date.now())
    let disposed = false
    const tc = createTradeChart(el, trade)

    setLoading(true)
    setError(undefined)
    fetchKlines(trade.symbol, interval, start, end)
      .then((candles) => {
        if (disposed) return
        drawTrade(tc, trade, candles, interval, 'full')
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (disposed) return
        setError(e instanceof Error ? e.message : String(e))
        setLoading(false)
      })
    return () => {
      disposed = true
      tc.chart.remove()
    }
  }, [trade, interval])

  return (
    <div className="space-y-2">
      <Segmented
        value={interval}
        onChange={setIv}
        options={[
          { value: '5m', label: '5 分' },
          { value: '15m', label: '15 分' },
          { value: '1h', label: '1 小時' },
        ]}
      />
      <div className="relative h-72 w-full overflow-hidden rounded-lg border border-ink-line">
        <div ref={box} className="absolute inset-0" />
        {loading && <p className="absolute inset-0 grid place-items-center text-sm text-paper-dim">載入 K 線…</p>}
        {error && <p className="absolute inset-0 grid place-items-center px-4 text-center text-sm text-ochre">{error}</p>}
      </div>
    </div>
  )
}
