import { useEffect, useRef, useState } from 'react'
import { smoothCumR } from '../../game/equityLine'
import Moon from './Moon'

/* 移植自 trade-journal-handoff/reference/src/App.tsx 的 Scene。
   canvas 顏色是寫死的十六進位值，和 src/index.css 的 token 一致；改 token 要一起改。 */

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export const fmtR1 = (r: number) => `${r >= 0 ? '+' : '−'}${Math.abs(r).toFixed(1)}R`

/** 一條遠山稜線：脊狀噪聲（1-|sin|）疊加，山頭會尖、山谷會圓 */
function ridgeLine(W: number, baseY: number, amp: number, seed: number) {
  const rnd = mulberry32(seed)
  const comps = Array.from({ length: 5 }, (_, i) => ({
    f: (0.006 + rnd() * 0.006) * (1 + i * 1.3),
    p: rnd() * Math.PI * 2,
    a: amp / Math.pow(i + 1, 1.15),
    ridged: i < 2,
  }))
  const pts: [number, number][] = []
  for (let x = -4; x <= W + 4; x += 3) {
    let y = baseY
    for (const c of comps) {
      const s = Math.sin(c.f * x + c.p)
      y -= c.ridged ? c.a * (1 - Math.abs(s)) : c.a * 0.5 * s
    }
    pts.push([x, y])
  }
  return pts
}

/** 前山：本季累積 R 平滑後當成稜線；少於 2 筆時畫平緩的固定稜線 */
function equityLine(W: number, H: number, rs: number[]) {
  if (rs.length < 2) {
    const pts = ridgeLine(W, H * 0.8, 10, 151)
    return { pts, end: null, total: rs.reduce((a, b) => a + b, 0) }
  }
  const { cum, smooth: sm } = smoothCumR(rs)
  const min = Math.min(...sm)
  const max = Math.max(...sm)
  const top = H * 0.66
  const bottom = H * 0.86
  const x0 = -6
  const x1 = W - 34
  const raw: [number, number][] = sm.map((c, i) => [x0 + ((x1 - x0) * i) / (sm.length - 1), bottom - ((c - min) / (max - min || 1)) * (bottom - top)])
  // Catmull-Rom 取樣，讓折線變成山的起伏
  const pts: [number, number][] = []
  for (let i = 0; i < raw.length - 1; i++) {
    const p0 = raw[Math.max(0, i - 1)]
    const p1 = raw[i]
    const p2 = raw[i + 1]
    const p3 = raw[Math.min(raw.length - 1, i + 2)]
    for (let t = 0; t < 1; t += 0.125) {
      const t2 = t * t
      const t3 = t2 * t
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
      pts.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])])
    }
  }
  const end = raw[raw.length - 1]
  pts.push(end)
  pts.push([W + 6, end[1] + 18]) // 終點後緩降出畫面
  return { pts, end, total: cum[cum.length - 1] }
}

interface Props {
  rs: number[]
  hp: number
  hpHint: string
  eyebrow: string
  title: string
  sub: string
  xp: number
  xpToNext: number
  maxDrawdownPct: number | null
}

export default function Scene({ rs, hp, hpHint, eyebrow, title, sub, xp, xpToNext, maxDrawdownPct }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [peak, setPeak] = useState<{ x: number; y: number; total: number } | null>(null)
  const [revealed, setRevealed] = useState(false)
  const key = rs.join(',')

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let raf = 0
    let start = 0

    const draw = (progress: number) => {
      const W = wrap.clientWidth
      const H = wrap.clientHeight
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr)
        canvas.height = Math.round(H * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)

      // 夜空：上方帶一點靛，月亮周圍有光暈
      const sky = ctx.createLinearGradient(0, 0, 0, H)
      sky.addColorStop(0, '#19213f')
      sky.addColorStop(0.7, '#10152a')
      sky.addColorStop(1, '#0b0f1c')
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, W, H)
      const mx = W - 64
      const my = 70
      const glow = ctx.createRadialGradient(mx, my, 10, mx, my, W * 0.75)
      glow.addColorStop(0, 'rgba(233,212,158,0.16)')
      glow.addColorStop(0.35, 'rgba(233,212,158,0.05)')
      glow.addColorStop(1, 'rgba(233,212,158,0)')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, W, H)

      const pathFrom = (pts: [number, number][]) => {
        ctx.beginPath()
        ctx.moveTo(pts[0][0], pts[0][1])
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
      }
      // 月光照在稜線上的亮邊：越靠月亮越亮，再偏移描一筆做出乾筆感
      const rim = (pts: [number, number][], strength: number) => {
        const g = ctx.createLinearGradient(0, 0, W, 0)
        g.addColorStop(0, `rgba(236,228,208,${0.03 * strength})`)
        g.addColorStop(1, `rgba(233,212,158,${0.32 * strength})`)
        ctx.strokeStyle = g
        ctx.lineWidth = 1
        pathFrom(pts)
        ctx.stroke()
        ctx.globalAlpha = 0.5
        ctx.translate(0, 1.4)
        pathFrom(pts)
        ctx.stroke()
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.globalAlpha = 1
      }
      // 一層山：墨色從稜線往下暈開，山腳化進霧裡
      const layer = (pts: [number, number][], rgb: string, fade: number, alpha: number) => {
        const minY = Math.min(...pts.map((p) => p[1]))
        const g = ctx.createLinearGradient(0, minY, 0, minY + fade)
        g.addColorStop(0, `rgba(${rgb},${alpha})`)
        g.addColorStop(0.55, `rgba(${rgb},${alpha * 0.8})`)
        g.addColorStop(1, `rgba(${rgb},0)`)
        pathFrom(pts)
        ctx.lineTo(W + 4, H)
        ctx.lineTo(-4, H)
        ctx.closePath()
        ctx.fillStyle = g
        ctx.fill()
      }
      const mistBand = (y: number, h: number, a: number) => {
        const g = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2)
        g.addColorStop(0, 'rgba(159,176,220,0)')
        g.addColorStop(0.5, `rgba(159,176,220,${a})`)
        g.addColorStop(1, 'rgba(159,176,220,0)')
        ctx.fillStyle = g
        ctx.fillRect(0, y - h / 2, W, h)
      }

      const far = ridgeLine(W, H * 0.55, 50, 7)
      const mid = ridgeLine(W, H * 0.63, 40, 23)
      const near = ridgeLine(W, H * 0.72, 30, 91)
      layer(far, '44,54,92', 150, 0.85)
      rim(far, 0.3)
      mistBand(H * 0.56, 60, 0.1)
      layer(mid, '30,38,70', 140, 0.92)
      rim(mid, 0.55)
      mistBand(H * 0.66, 50, 0.09)
      layer(near, '20,26,50', 130, 1)
      rim(near, 0.9)

      // 前山＝權益曲線，由左往右畫出
      const eq = equityLine(W, H, rs)
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, W * progress + 2, H)
      ctx.clip()
      const g = ctx.createLinearGradient(0, H * 0.62, 0, H)
      g.addColorStop(0, '#111730')
      g.addColorStop(0.5, '#0d1222')
      g.addColorStop(1, '#0b0f1c')
      pathFrom(eq.pts)
      ctx.lineTo(W + 6, H)
      ctx.lineTo(-6, H)
      ctx.closePath()
      ctx.fillStyle = g
      ctx.fill()
      rim(eq.pts, 1.5)
      ctx.restore()

      if (progress >= 1 && eq.end) {
        const [ex, ey] = eq.end
        ctx.save()
        ctx.shadowColor = 'rgba(233,212,158,0.9)'
        ctx.shadowBlur = 14
        ctx.fillStyle = '#e9d49e'
        ctx.beginPath()
        ctx.arc(ex, ey, 3.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }
      return eq
    }

    const finish = () => {
      const eq = draw(1)
      setPeak(eq.end ? { x: eq.end[0], y: eq.end[1], total: eq.total } : null)
      setRevealed(true)
    }

    if (reduceMotion()) {
      finish()
    } else {
      const DURATION = 1700
      const tick = (t: number) => {
        if (!start) start = t
        const p = Math.min(1, (t - start) / DURATION)
        const eased = 1 - Math.pow(1 - p, 3)
        if (p < 1) {
          draw(eased)
          raf = requestAnimationFrame(tick)
        } else {
          finish()
        }
      }
      draw(0)
      raf = requestAnimationFrame(tick)
    }

    let lastW = wrap.clientWidth
    const ro = new ResizeObserver(() => {
      if (wrap.clientWidth === lastW) return
      lastW = wrap.clientWidth
      cancelAnimationFrame(raf)
      finish()
    })
    ro.observe(wrap)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
    // 只在本季 R 序列改變時重畫
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const pct = Math.max(0, Math.min(100, (xp / xpToNext) * 100))

  return (
    <div className="scene" ref={wrapRef}>
      <canvas ref={canvasRef} aria-hidden="true" />
      <div className="mist a" aria-hidden="true" />
      <div className="mist b" aria-hidden="true" />

      <div className="hero-id">
        <span className="eyebrow">{eyebrow}</span>
        <h1 className="hero-name">{title}</h1>
        <span className="hero-sub">{sub}</span>
        <div className="xp">
          <div className="xp-row">
            <span>經驗值</span>
            <b>
              {xp.toLocaleString()} / {xpToNext.toLocaleString()}
            </b>
          </div>
          <div className="xp-track">
            <div className="xp-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      <div className="moon-wrap">
        <Moon hp={hp} />
        <div className="moon-cap">
          <div className="k">精神力</div>
          <div className="v">
            {hp}
            <small> / 100</small>
          </div>
          <div className="s">{hpHint}</div>
        </div>
      </div>

      {peak && (
        <div className={`peak-tag${revealed ? ' on' : ''}`} style={{ left: peak.x, top: peak.y }}>
          今 {fmtR1(peak.total)}
        </div>
      )}
      <div className="scene-cap">
        {rs.length < 2 ? (
          <span>{rs.length === 0 ? '本季還沒有交易' : '本季 1 筆 · 滿 2 筆才畫出前山'}</span>
        ) : (
          <>
            <span>前山是本季權益曲線</span>
            <span>
              <b>{rs.length}</b> 筆 · 最大回撤 <b>{maxDrawdownPct === null ? '—' : `${maxDrawdownPct}%`}</b>
            </span>
          </>
        )}
      </div>
    </div>
  )
}
