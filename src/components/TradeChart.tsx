import { CandlestickSeries, LineStyle, createChart, createSeriesMarkers, type SeriesMarker, type UTCTimestamp } from 'lightweight-charts'
import { useEffect, useRef, useState } from 'react'
import { fetchKlines } from '../lib/db'
import type { RawTrade } from '../lib/types'
import { Segmented } from './ui'

/* 交易的 K 線圖：取代手動截圖。進場前、出場後各留一段行情，標出進出場、止損、目標、止損移動。
   顏色是寫死的十六進位值，和 src/index.css 的 token 一致；盈虧不用紅綠。 */
const C = { ink: '#0b0f1c', line: 'rgba(196,206,232,0.14)', dim: '#a9b0c4', paper: '#ece4d0', moon: '#e9d49e', jade: '#8acfba', ochre: '#e89c64', mist: '#9fb0dc' }

type Interval = '5m' | '15m' | '1h'
const INTERVAL_MS: Record<Interval, number> = { '5m': 5 * 60_000, '15m': 15 * 60_000, '1h': 3_600_000 }
const BEFORE_BARS = 60
const AFTER_BARS = 30
/** 圖上顯示台北時間：lightweight-charts 只認 UTC，把時間平移 +8 小時 */
const TPE_SHIFT_S = 8 * 3600

function defaultInterval(holdMs: number): Interval {
  if (holdMs < 2 * 3_600_000) return '5m'
  if (holdMs < 12 * 3_600_000) return '15m'
  return '1h'
}

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
    const step = INTERVAL_MS[interval]
    const start = open - BEFORE_BARS * step
    const end = Math.min(Date.now(), close + AFTER_BARS * step)
    const toBar = (ms: number) => (Math.floor(ms / step) * step) / 1000 + TPE_SHIFT_S
    let disposed = false
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { color: C.ink }, textColor: C.dim, fontFamily: 'IBM Plex Mono, ui-monospace, monospace', attributionLogo: false },
      grid: { vertLines: { color: C.line }, horzLines: { color: C.line } },
      rightPriceScale: { borderColor: C.line },
      timeScale: { borderColor: C.line, timeVisible: true, secondsVisible: false },
      crosshair: { horzLine: { color: C.dim }, vertLine: { color: C.dim } },
    })
    const series = chart.addSeries(CandlestickSeries, {
      upColor: C.jade,
      downColor: C.ochre,
      borderVisible: false,
      wickUpColor: C.jade,
      wickDownColor: C.ochre,
      priceFormat: { type: 'price', precision: decimals(trade.entry_price), minMove: 10 ** -decimals(trade.entry_price) },
    })

    setLoading(true)
    setError(undefined)
    fetchKlines(trade.symbol, interval, start, end)
      .then((candles) => {
        if (disposed) return
        series.setData(candles.map((k) => ({ time: (k.time / 1000 + TPE_SHIFT_S) as UTCTimestamp, open: k.open, high: k.high, low: k.low, close: k.close })))

        const line = (price: number | null, color: string, title: string, style = LineStyle.Dashed) =>
          price !== null && series.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title })
        line(trade.entry_price, C.moon, '進場', LineStyle.Solid)
        line(trade.planned_stop, C.ochre, '止損')
        if (trade.final_stop !== null && trade.final_stop !== trade.planned_stop) line(trade.final_stop, C.ochre, '最後止損', LineStyle.Dotted)
        line(trade.planned_target, C.jade, '目標')

        const long = trade.direction === 'long'
        const markers: SeriesMarker<UTCTimestamp>[] = [
          { time: toBar(open) as UTCTimestamp, position: long ? 'belowBar' : 'aboveBar', shape: long ? 'arrowUp' : 'arrowDown', color: C.moon, text: '進' },
          ...trade.stop_edits.map((e) => ({ time: toBar(Date.parse(e.at)) as UTCTimestamp, position: 'inBar' as const, shape: 'circle' as const, color: C.mist, text: '移' })),
        ]
        if (trade.closed_at) markers.push({ time: toBar(close) as UTCTimestamp, position: long ? 'aboveBar' : 'belowBar', shape: 'circle', color: C.paper, text: '出' })
        createSeriesMarkers(series, markers.sort((a, b) => a.time - b.time))
        chart.timeScale().fitContent()
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (disposed) return
        setError(e instanceof Error ? e.message : String(e))
        setLoading(false)
      })
    return () => {
      disposed = true
      chart.remove()
    }
  }, [trade, interval, open, close])

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

/** 價格的小數位數（K 線刻度用） */
function decimals(p: number): number {
  const s = String(p)
  const i = s.indexOf('.')
  return i === -1 ? 2 : Math.min(8, Math.max(2, s.length - i - 1))
}
