import {
  CandlestickSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type UTCTimestamp,
} from 'lightweight-charts'
import { INTERVAL_MS, shotTitle, type ChartMode, type Interval } from '../lib/chartShots'
import type { Candle } from '../lib/db'
import { JPEG_QUALITY, fitSize } from '../lib/image'
import type { ImageKind, RawTrade, Trade } from '../lib/types'

/* 交易 K 線圖的畫法：詳情頁 K 線卡與自動截圖共用，規則只留一份。
   顏色是寫死的十六進位值，和 src/index.css 的 token 一致；盈虧不用紅綠。 */
const C = { ink: '#0b0f1c', line: 'rgba(196,206,232,0.14)', dim: '#a9b0c4', paper: '#ece4d0', moon: '#e9d49e', jade: '#8acfba', ochre: '#e89c64', mist: '#9fb0dc' }
const FONT = 'IBM Plex Mono, ui-monospace, monospace'
/** 圖上顯示台北時間：lightweight-charts 只認 UTC，把時間平移 +8 小時 */
const TPE_SHIFT_S = 8 * 3600

export interface TradeChart {
  chart: IChartApi
  series: ISeriesApi<'Candlestick'>
}

/** 沒給 size 就跟著容器大小 */
export function createTradeChart(el: HTMLElement, trade: RawTrade, size?: { width: number; height: number }): TradeChart {
  const chart = createChart(el, {
    ...(size ? { width: size.width, height: size.height } : { autoSize: true }),
    layout: { background: { color: C.ink }, textColor: C.dim, fontFamily: FONT, attributionLogo: false },
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
    // 不畫最後一根的價格線：那是出場後的價格，容易看成另一條止損
    lastValueVisible: false,
    priceLineVisible: false,
    priceFormat: { type: 'price', precision: decimals(trade.entry_price), minMove: 10 ** -decimals(trade.entry_price) },
  })
  return { chart, series }
}

/** 畫 K 線、價格線與標記。entry 只畫進場、初始止損、目標與「進」，不露出進場後的資訊 */
export function drawTrade({ chart, series }: TradeChart, trade: RawTrade, candles: Candle[], interval: Interval, mode: ChartMode): void {
  const step = INTERVAL_MS[interval]
  const toBar = (ms: number) => ((Math.floor(ms / step) * step) / 1000 + TPE_SHIFT_S) as UTCTimestamp
  series.setData(candles.map((k) => ({ time: (k.time / 1000 + TPE_SHIFT_S) as UTCTimestamp, open: k.open, high: k.high, low: k.low, close: k.close })))

  const line = (price: number | null, color: string, title: string, style = LineStyle.Dashed) =>
    price !== null && series.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title })
  line(trade.entry_price, C.moon, '進場', LineStyle.Solid)
  line(trade.planned_stop, C.ochre, '止損')
  if (mode === 'full' && trade.final_stop !== null && trade.final_stop !== trade.planned_stop) line(trade.final_stop, C.ochre, '最後止損', LineStyle.Dotted)
  line(trade.planned_target, C.jade, '目標')

  const long = trade.direction === 'long'
  const markers: SeriesMarker<UTCTimestamp>[] = [
    { time: toBar(Date.parse(trade.opened_at!)), position: long ? 'belowBar' : 'aboveBar', shape: long ? 'arrowUp' : 'arrowDown', color: C.moon, text: '進' },
  ]
  if (mode === 'full') {
    markers.push(...trade.stop_edits.map((e) => ({ time: toBar(Date.parse(e.at)), position: 'inBar' as const, shape: 'circle' as const, color: C.mist, text: '移' })))
    if (trade.closed_at) markers.push({ time: toBar(Date.parse(trade.closed_at)), position: long ? 'aboveBar' : 'belowBar', shape: 'circle', color: C.paper, text: '出' })
  }
  createSeriesMarkers(series, markers.sort((a, b) => a.time - b.time))
  chart.timeScale().fitContent()
}

const SHOT_SIZE = { width: 1000, height: 640 }
const TITLE_H = 48

/** 在畫面外畫一張交易 K 線圖，加上標題列，輸出 JPEG（進場圖用 entry 模式，出場圖用 full） */
export async function renderShot(trade: Trade, kind: ImageKind, interval: Interval, candles: Candle[]): Promise<Blob> {
  const host = document.createElement('div')
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${SHOT_SIZE.width}px;height:${SHOT_SIZE.height}px;pointer-events:none`
  document.body.appendChild(host)
  const tc = createTradeChart(host, trade, SHOT_SIZE)
  try {
    drawTrade(tc, trade, candles, interval, kind === 'entry' ? 'entry' : 'full')
    // 等圖表完成繪製。不用 requestAnimationFrame：App 切到背景時它不會觸發，整批截圖會卡住
    await new Promise((r) => setTimeout(r, 50))
    const shot = tc.chart.takeScreenshot()
    const ratio = shot.width / SHOT_SIZE.width
    const titleH = Math.round(TITLE_H * ratio)
    const { width, height } = fitSize(shot.width, shot.height + titleH)
    const scale = width / shot.width

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('無法建立畫布')
    ctx.fillStyle = C.ink
    ctx.fillRect(0, 0, width, height)
    ctx.fillStyle = C.paper
    ctx.font = `${Math.round(20 * ratio * scale)}px ${FONT}`
    ctx.textBaseline = 'middle'
    ctx.fillText(shotTitle(trade, kind, interval), Math.round(16 * ratio * scale), (titleH * scale) / 2)
    ctx.drawImage(shot, 0, titleH * scale, width, shot.height * scale)

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    if (!blob || blob.type !== 'image/jpeg') throw new Error('瀏覽器無法輸出 JPEG')
    return blob
  } finally {
    tc.chart.remove()
    host.remove()
  }
}

/** 價格的小數位數（K 線刻度用） */
function decimals(p: number): number {
  const s = String(p)
  const i = s.indexOf('.')
  return i === -1 ? 2 : Math.min(8, Math.max(2, s.length - i - 1))
}
