import { useEffect, useMemo, useRef, useState } from 'react'

/* ---------- 示意資料 ---------- */
// 本季每筆交易的 R 倍數（時間順序，最後一筆是最新）
const SEASON_R = [
  0.8, -1, 1.8, -1, -1, 2.1, 0.5, -1, 1.4, -0.6, -1, 2.4, -1, 0.9, -1, -1,
  -1, 1.6, 2.2, -1, 0.7, -0.4, 1.9, -1, -1.6, 0.9, -1, 1.8, -1.6, 0.9, 1.8, -1,
]
const HP = 70

type Grade = 'S' | 'A' | 'B' | 'C' | 'D'
type Trade = {
  sym: string
  side: '多' | '空'
  grade: Grade
  r: number
  score: number
  tag: { label: string; tone: 'jade' | 'mist' | 'moon' | 'ochre' }
  setup?: string
  note?: string
}
const TRADES: Trade[] = [
  { sym: 'ETHUSDT', side: '空', grade: 'A', r: -1.0, score: 85, tag: { label: '好的虧損', tone: 'mist' }, setup: '流動性掃蕩' },
  { sym: 'BTCUSDT', side: '多', grade: 'S', r: 1.8, score: 94, tag: { label: '好的獲利', tone: 'jade' }, setup: '突破回踩' },
  { sym: 'SOLUSDT', side: '多', grade: 'C', r: 0.9, score: 60, tag: { label: '運氣好的壞交易', tone: 'moon' }, note: '沒有作戰卡就進場，這筆賺的不是你的優勢' },
  { sym: 'BTCUSDT', side: '空', grade: 'D', r: -1.6, score: 40, tag: { label: '壞的虧損', tone: 'ochre' }, setup: '假突破 · 移動止損' },
]

const STATS = [
  { k: '風控', v: 82 },
  { k: '復盤', v: 88 },
  { k: '執行力', v: 71 },
  { k: '耐心', v: 64 },
  { k: '情緒控管', v: 55 },
]

/* ---------- 工具 ---------- */
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
const fmtR = (r: number) => `${r >= 0 ? '+' : '−'}${Math.abs(r).toFixed(1)}R`
const reduceMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/* 一條遠山稜線：脊狀噪聲（1-|sin|）疊加，山頭會尖、山谷會圓 */
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

/* 前山：把累積 R 曲線平滑後當成稜線 */
function equityLine(W: number, H: number, rs: number[]) {
  const cum = [0]
  rs.forEach((r) => cum.push(cum[cum.length - 1] + r))
  // 指數平滑讓逐筆的鋸齒變成山勢，但終點仍是真實累積值
  const sm: number[] = []
  cum.forEach((c, i) => sm.push(i === 0 ? c : sm[i - 1] * 0.45 + c * 0.55))
  sm[sm.length - 1] = cum[cum.length - 1]
  const min = Math.min(...sm)
  const max = Math.max(...sm)
  const top = H * 0.66
  const bottom = H * 0.86
  const x0 = -6
  const x1 = W - 34
  const raw: [number, number][] = sm.map((c, i) => [
    x0 + ((x1 - x0) * i) / (sm.length - 1),
    bottom - ((c - min) / (max - min || 1)) * (bottom - top),
  ])
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
  // 山在終點後緩降出畫面
  pts.push([W + 6, end[1] + 18])
  return { pts, end, total: cum[cum.length - 1], n: rs.length }
}

/* ---------- 山水 ---------- */
function Scene() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [peak, setPeak] = useState<{ x: number; y: number; total: number; n: number } | null>(null)
  const [revealed, setRevealed] = useState(false)

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
      // 月光照在稜線上的亮邊：越靠月亮越亮
      const rim = (pts: [number, number][], strength: number) => {
        const g = ctx.createLinearGradient(0, 0, W, 0)
        g.addColorStop(0, `rgba(236,228,208,${0.03 * strength})`)
        g.addColorStop(1, `rgba(233,212,158,${0.32 * strength})`)
        ctx.strokeStyle = g
        ctx.lineWidth = 1
        pathFrom(pts)
        ctx.stroke()
        // 乾筆：再描一條略微偏移的細線
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
      const eq = equityLine(W, H, SEASON_R)
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

      if (progress >= 1) {
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
      setPeak({ x: eq.end[0], y: eq.end[1], total: eq.total, n: eq.n })
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
  }, [])

  return (
    <div className="scene" ref={wrapRef}>
      <canvas ref={canvasRef} aria-hidden="true" />
      <div className="mist a" aria-hidden="true" />
      <div className="mist b" aria-hidden="true" />

      <div className="hero-id">
        <span className="eyebrow">10.04 週日 · 十月賽季 第 4 天</span>
        <h1 className="hero-name">紀律學徒</h1>
        <span className="hero-sub">Lv.12 · 遊俠型 · 波段交易者</span>
        <div className="xp">
          <div className="xp-row">
            <span>經驗值</span>
            <b>2,340 / 3,000</b>
          </div>
          <div className="xp-track">
            <div className="xp-fill" style={{ width: '78%' }} />
          </div>
        </div>
      </div>

      <div className="moon-wrap">
        <Moon hp={HP} />
        <div className="moon-cap">
          <div className="k">精神力</div>
          <div className="v">
            {HP}
            <small> / 100</small>
          </div>
          <div className="s">月盈則穩</div>
        </div>
      </div>

      {peak && (
        <div className={`peak-tag${revealed ? ' on' : ''}`} style={{ left: peak.x, top: peak.y }}>
          今 {fmtR(peak.total)}
        </div>
      )}
      <div className="scene-cap">
        <span>前山是本季權益曲線</span>
        <span>
          <b>{SEASON_R.length}</b> 筆 · 最大回撤 <b>5.2%</b>
        </span>
      </div>
    </div>
  )
}

/* 月相：亮面比例＝精神力 */
function Moon({ hp }: { hp: number }) {
  const r = 30
  const c = 34
  const k = Math.max(0, Math.min(1, hp / 100))
  const rx = Math.abs(2 * k - 1) * r
  const sweep = k > 0.5 ? 1 : 0
  const lit =
    k >= 0.999
      ? `M ${c} ${c - r} A ${r} ${r} 0 1 1 ${c - 0.01} ${c - r} Z`
      : `M ${c} ${c - r} A ${r} ${r} 0 0 1 ${c} ${c + r} A ${rx} ${r} 0 0 ${sweep} ${c} ${c - r} Z`
  return (
    <svg width="68" height="68" viewBox="0 0 68 68" role="img" aria-label={`精神力 ${hp}，月相盈 ${Math.round(k * 100)}%`}>
      <defs>
        <radialGradient id="moonFill" cx="40%" cy="38%" r="70%">
          <stop offset="0%" stopColor="#f6ead0" />
          <stop offset="70%" stopColor="#e9d49e" />
          <stop offset="100%" stopColor="#cdb57c" />
        </radialGradient>
        <filter id="moonGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>
      <circle cx={c} cy={c} r={r} fill="#1d2440" stroke="rgba(233,212,158,0.18)" strokeWidth="1" />
      <path d={lit} fill="#e9d49e" opacity="0.55" filter="url(#moonGlow)" />
      <path d={lit} fill="url(#moonFill)" />
      <circle cx={c + 9} cy={c - 6} r={4} fill="#cdb57c" opacity="0.35" />
      <circle cx={c + 3} cy={c + 10} r={2.6} fill="#cdb57c" opacity="0.3" />
    </svg>
  )
}

/* ---------- 小圖示（墨線） ---------- */
const Icon = {
  flame: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3.3a2.5 2.5 0 0 0 2.5 2.8z" />
    </svg>
  ),
  warn: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  ),
}

/* 筆畫圓：沒合攏的圓（像一筆畫的圓相），完成時填滿 */
function Ring({ done }: { done: boolean }) {
  return (
    <svg className="ring" viewBox="0 0 22 22" aria-hidden="true">
      {done ? (
        <>
          <circle cx="11" cy="11" r="10" fill="var(--jade)" />
          <path d="M6.5 11.5l3 3 6-6.5" fill="none" stroke="var(--ink)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <path d="M11 1.5a9.5 9.5 0 1 1-8.2 4.7" fill="none" stroke="var(--paper-dim)" strokeWidth="1.6" strokeLinecap="round" />
      )}
    </svg>
  )
}

/* ---------- 屬性雷達 ---------- */
function Radar() {
  const cx = 180
  const cy = 132
  const R = 92
  const ang = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / STATS.length
  const pt = (i: number, r: number) => [cx + r * Math.cos(ang(i)), cy + r * Math.sin(ang(i))]
  const poly = (r: number) => STATS.map((_, i) => pt(i, r).map((n) => n.toFixed(1)).join(',')).join(' ')
  const vals = STATS.map((s, i) => pt(i, (R * s.v) / 100))
  const weakest = STATS.reduce((m, s, i) => (s.v < STATS[m].v ? i : m), 0)
  const labelPos = (i: number) => {
    const [x, y] = pt(i, R + 22)
    const cos = Math.cos(ang(i))
    const anchor = Math.abs(cos) < 0.2 ? 'middle' : cos > 0 ? 'start' : 'end'
    return { x, y: y + 5, anchor }
  }
  return (
    <svg className="radar" viewBox="-24 0 408 262" role="img" aria-label={`角色屬性：${STATS.map((s) => `${s.k} ${s.v}`).join('、')}`}>
      <g fill="none" stroke="var(--ink-line)" strokeWidth="1">
        {[1, 0.66, 0.33].map((f) => (
          <polygon key={f} points={poly(R * f)} strokeDasharray={f === 1 ? undefined : '2 4'} />
        ))}
        {STATS.map((_, i) => {
          const [x, y] = pt(i, R)
          return <line key={i} x1={cx} y1={cy} x2={x} y2={y} />
        })}
      </g>
      <polygon
        points={vals.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ')}
        fill="rgba(233,212,158,0.13)"
        stroke="var(--moon)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      {vals.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === weakest ? 4.5 : 3} fill={i === weakest ? 'var(--ochre)' : 'var(--moon)'} />
      ))}
      {STATS.map((s, i) => {
        const { x, y, anchor } = labelPos(i)
        return (
          <text key={s.k} x={x} y={y} textAnchor={anchor as 'start' | 'middle' | 'end'} className={i === weakest ? 'weak' : undefined}>
            {s.k} <tspan className="n">{s.v}</tspan>
          </text>
        )
      })}
    </svg>
  )
}

/* ---------- 圖鑑縮圖 ---------- */
function Spark({ d, tone }: { d: string; tone: string }) {
  return (
    <svg viewBox="0 0 80 40" preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill="none" stroke={tone} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/* ---------- 頁面 ---------- */
export default function App() {
  const [quests, setQuests] = useState([
    { id: 'q1', label: '開盤前寫市場觀察', prog: '', xp: 30, done: true },
    { id: 'q2', label: '復盤今日交易', prog: '1/2', xp: 40, done: false },
    { id: 'q3', label: '本週標註 3 張進場截圖', prog: '1/3', xp: 80, done: false },
  ])
  const [tab, setTab] = useState('home')
  const todayR = useMemo(() => TRADES.slice(0, 2).reduce((s, t) => s + t.r, 0), [])

  const DEMON_TOTAL = 30
  const DEMON_HIT = 18

  return (
    <div className="app">
      <Scene />

      <main className="page">
        {/* 狀態異常 */}
        <section className="sec" aria-label="狀態異常">
          <div className="debuff">
            <div className="blot">{Icon.flame}</div>
            <div>
              <div className="debuff-name">
                上頭 <span className="data">冷卻 12:30</span>
              </div>
              <p>上一筆虧損後 4 分鐘。冷卻期間開單需二次確認，評分上限降為 B。</p>
            </div>
          </div>
          <button className="slip" type="button">
            <span>
              <span className="slip-title">立作戰卡</span>
              <br />
              <span className="slip-sub">進場前存檔，才拿得到完整經驗值</span>
            </span>
            <span className="slip-xp">+20</span>
          </button>
          <span className="sec-note">
            今日 <span className="data">2</span> 筆 · <span className="data">{fmtR(todayR)}</span>
          </span>
        </section>

        {/* 倉位階級 */}
        <section className="sec" aria-labelledby="tier-h">
          <div className="sec-head">
            <h2 className="sec-title" id="tier-h">倉位</h2>
            <span className="sec-note">用紀律換風險額度</span>
          </div>
          <div className="tier-top">
            <div className="tier-name">
              正式
              <small>第二階</small>
            </div>
            <div className="tier-cap">
              1.0%
              <small>單筆風險上限</small>
            </div>
          </div>
          <div className="ladder" aria-hidden="true">
            <div className="ladder-line" />
            <div className="ladder-done" style={{ width: `${50 + 50 * (34 / 50)}%` }} />
            <div className="rung past" style={{ left: '0%' }}>
              <i />
              <span>見習<b>0.5%</b></span>
            </div>
            <div className="rung on" style={{ left: '50%' }}>
              <i />
              <span>正式<b>1.0%</b></span>
            </div>
            <div className="rung" style={{ left: '100%' }}>
              <i />
              <span>老手<b>1.5%</b></span>
            </div>
          </div>
          <div className="conds">
            <div className="cond">
              <span>晉升老手：A 以上交易</span>
              <span className="data">34 / 50</span>
            </div>
            <div className="cond">
              <span>本季最大回撤低於 8%</span>
              <span className="data ok">5.2% 達標</span>
            </div>
          </div>
          <span className="warn-line">觸發「上頭」會降回見習（0.5%）</span>
        </section>

        {/* 屬性 */}
        <section className="sec" aria-labelledby="stat-h">
          <div className="sec-head">
            <h2 className="sec-title" id="stat-h">屬性</h2>
            <span className="sec-note">本季 · {SEASON_R.length} 筆</span>
          </div>
          <Radar />
          <p className="hint" style={{ margin: 0 }}>
            <b>最弱是情緒控管。</b>本週試著連虧 2 筆後離開螢幕 30 分鐘。
          </p>
        </section>

        {/* 心魔 */}
        <section className="sec demon" aria-labelledby="demon-h">
          <span className="demon-glyph" aria-hidden="true">魔</span>
          <div className="sec-head">
            <h2 className="sec-title" id="demon-h" style={{ fontSize: 15, fontWeight: 400, color: 'var(--paper-dim)' }}>
              本月心魔
            </h2>
          </div>
          <div className="demon-name">移動止損者</div>
          <div className="tally" role="img" aria-label={`已守住 ${DEMON_HIT} 筆，剩 ${DEMON_TOTAL - DEMON_HIT} 筆`}>
            {Array.from({ length: DEMON_TOTAL }, (_, i) => (
              <span key={i} className={i < DEMON_HIT ? 'hit' : undefined} />
            ))}
          </div>
          <p>
            已連續 <b>{DEMON_HIT}</b> 筆沒把止損往不利方向移。再守 <b>{DEMON_TOTAL - DEMON_HIT}</b> 筆就能擊敗它，換得稱號「鐵律武士」。
          </p>
        </section>

        {/* 任務 */}
        <section className="sec" aria-labelledby="quest-h">
          <div className="sec-head">
            <h2 className="sec-title" id="quest-h">功課</h2>
            <span className="sec-note">休息日也算連續</span>
          </div>
          <div className="quests">
            {quests.map((q) => (
              <button
                key={q.id}
                id={q.id}
                type="button"
                className={`quest${q.done ? ' done' : ''}`}
                aria-pressed={q.done}
                onClick={() => setQuests((qs) => qs.map((x) => (x.id === q.id ? { ...x, done: !x.done } : x)))}
              >
                <Ring done={q.done} />
                <span className="quest-label">
                  {q.label}
                  {q.prog && <span className="data">{q.prog}</span>}
                </span>
                <span className="quest-xp">+{q.xp}</span>
              </button>
            ))}
          </div>
        </section>

        {/* 最近交易 */}
        <section className="sec" aria-labelledby="trade-h">
          <div className="sec-head">
            <h2 className="sec-title" id="trade-h">近事</h2>
            <a href="#trade-h" className="sec-note">全部紀錄</a>
          </div>
          <div className="trades">
            {TRADES.map((t, i) => {
              const sealCls = t.grade === 'S' || t.grade === 'A' ? 'red' : t.grade === 'D' ? 'line ochre' : 'line grey'
              return (
                <div className="trade" key={i}>
                  <div className={`seal ${sealCls}`} style={{ transform: `rotate(${[-3, 2, -1.5, 3][i % 4]}deg)` }} aria-label={`評級 ${t.grade}`}>
                    {t.grade}
                  </div>
                  <div className="trade-mid">
                    <div className="trade-sym">
                      {t.sym}
                      <span className={`side ${t.side === '多' ? 'c-jade' : 'c-ochre'}`}>{t.side}</span>
                    </div>
                    <div className="trade-meta">
                      <span className={`tag c-${t.tag.tone}`}>{t.tag.label}</span>
                      {t.setup && <span>{t.setup}</span>}
                    </div>
                    {t.note && (
                      <div className="trade-note">
                        {Icon.warn}
                        {t.note}
                      </div>
                    )}
                  </div>
                  <div className="trade-r">
                    <span className={`data ${t.r >= 0 ? 'c-jade' : 'c-ochre'}`}>{fmtR(t.r)}</span>
                    <small>評分 {t.score}</small>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* 圖鑑 */}
        <section className="sec" aria-labelledby="dex-h">
          <div className="sec-head">
            <h2 className="sec-title" id="dex-h">圖鑑</h2>
            <span className="sec-note">已鑑定 3 / 7 · 滿 20 筆才揭曉</span>
          </div>
          <div className="scrolls">
            <div className="scroll">
              <Spark d="M2 32 L18 22 L28 28 L44 10 L52 18 L78 4" tone="var(--jade)" />
              <span className="scroll-name">突破回踩</span>
              <span className="scroll-ev c-jade">+0.32R</span>
              <span className="scroll-n">24 筆 · 已鑑定</span>
            </div>
            <div className="scroll veiled">
              <div className="veil">
                <Spark d="M2 20 L14 26 L22 8 L30 30 L46 16 L58 22 L78 12" tone="var(--paper-dim)" />
              </div>
              <span className="scroll-name">流動性掃蕩</span>
              <span className="scroll-ev data">？？？</span>
              <span className="scroll-n">12 / 20 筆</span>
            </div>
            <div className="scroll curse">
              <Spark d="M2 24 L20 16 L32 18 L42 4 L48 26 L78 36" tone="var(--ochre)" />
              <span className="scroll-name">假突破</span>
              <span className="scroll-ev c-ochre">−0.18R</span>
              <span className="mini-seal">詛咒 · 21 筆</span>
            </div>
          </div>
        </section>

        {/* 賽季落款 */}
        <section className="sec" aria-label="賽季">
          <div className="colophon">
            <div>
              <div className="k">十月賽季</div>
              <div className="s">剩 27 天 · 結算時生成回顧卡</div>
            </div>
            <div className="score">
              <div className="s">紀律分數</div>
              <div className="data">81</div>
            </div>
          </div>
          <span className="sample-note">畫面數字為示意資料</span>
        </section>
      </main>

      <nav className="tabs" aria-label="主選單">
        {[
          { id: 'home', label: '首頁', d: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z' },
          { id: 'log', label: '日誌', d: 'M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22.5zM8 7h8M8 11h6' },
          { id: 'dex', label: '圖鑑', d: 'M5 3h14M5 21h14M7 3v18M17 3v18' },
          { id: 'me', label: '角色', d: 'M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM4 21a8 8 0 0 1 16 0' },
        ].map((t) => (
          <button key={t.id} id={`tab-${t.id}`} type="button" className="tab" aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={t.d} />
            </svg>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
