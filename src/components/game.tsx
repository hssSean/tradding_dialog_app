import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { TradeEval } from '../game/evaluate'
import { QUADRANT_LABELS, type Grade, type Quadrant } from '../game/rules'
import { fmtR1 } from './home/Scene'

const QUADRANT_TONE: Record<Quadrant, string> = {
  good_win: 'c-jade',
  good_loss: 'c-mist',
  lucky_bad: 'c-moon',
  bad_loss: 'c-ochre',
}

const ROTATIONS = [-3, 2, -1.5, 3, -2, 1]

/** 評級朱印：S／A 朱底、D 赭線、其他灰線；舊資料顯示「舊」 */
export function GradeSeal({ grade, index = 0, small = false }: { grade: Grade | null; index?: number; small?: boolean }) {
  const cls = grade === null ? 'line grey' : grade === 'S' || grade === 'A' ? 'red' : grade === 'D' ? 'line ochre' : 'line grey'
  return (
    <div
      className={`seal ${cls}${small ? ' small' : ''}`}
      style={{ transform: `rotate(${ROTATIONS[index % ROTATIONS.length]}deg)` }}
      aria-label={grade ? `評級 ${grade}` : '資料不足'}
    >
      {grade ?? '舊'}
    </div>
  )
}

export function QuadrantTag({ quadrant }: { quadrant: Quadrant }) {
  return <span className={`tag ${QUADRANT_TONE[quadrant]}`}>{QUADRANT_LABELS[quadrant]}</span>
}

export const WarnIcon = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4M12 17h.01" />
  </svg>
)

/** 近事／日誌的一列交易 */
export function TradeRow({ e, setupName, index }: { e: TradeEval; setupName?: string; index: number }) {
  const t = e.trade
  const r = e.r ?? 0
  return (
    <Link to={`/trade/${t.id}`} className="trade">
      <GradeSeal grade={e.grade} index={index} />
      <div className="trade-mid">
        <div className="trade-sym">
          {t.symbol}
          <span className={`side ${t.direction === 'long' ? 'c-jade' : 'c-ochre'}`}>{t.direction === 'long' ? '多' : '空'}</span>
        </div>
        <div className="trade-meta">
          {e.quadrant ? <QuadrantTag quadrant={e.quadrant} /> : <span className="tag">資料不足</span>}
          {setupName && <span>{setupName}</span>}
        </div>
        {e.quadrant === 'lucky_bad' && e.mainViolation && (
          <div className="trade-note">
            {WarnIcon}
            {e.mainViolation}
          </div>
        )}
      </div>
      <div className="trade-r">
        <span className={`data ${r > 0 ? 'c-jade' : 'c-ochre'}`}>{fmtR1(r)}</span>
        <small>{e.score === null ? '不評分' : `評分 ${e.score}${e.provisional ? ' · 暫定' : ''}`}</small>
      </div>
    </Link>
  )
}

/** 筆畫圓：沒合攏的圓（像一筆畫的圓相），完成時填滿 */
export function Ring({ done }: { done: boolean }) {
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

/** 圖鑑縮圖：累積 R 走勢 */
export function Spark({ path, tone }: { path: number[]; tone: string }) {
  if (path.length < 2) return <svg viewBox="0 0 80 40" aria-hidden="true" />
  const min = Math.min(...path)
  const max = Math.max(...path)
  const d = path
    .map((v, i) => `${i ? 'L' : 'M'}${(2 + (76 * i) / (path.length - 1)).toFixed(1)} ${(36 - ((v - min) / (max - min || 1)) * 32).toFixed(1)}`)
    .join(' ')
  return (
    <svg viewBox="0 0 80 40" preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill="none" stroke={tone} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** 每秒更新的現在時間，給倒數用 */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/** 剩餘時間 mm:ss（超過一小時顯示 h:mm:ss） */
export function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
}

/** 情緒 1–5 選擇 */
export const EMOTION_LABELS = ['', '平靜', '專注', '普通', '急躁', '激動']

export function EmotionPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <span className="mb-1 block text-sm text-paper-dim">當下情緒</span>
      <div className="grid grid-cols-5 gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(value === String(n) ? '' : String(n))}
            className={`flex min-h-12 flex-col items-center justify-center rounded-md text-xs ${
              value === String(n) ? (n >= 4 ? 'bg-ochre text-ink' : 'bg-moon text-ink') : 'bg-paper/10 text-paper-dim'
            }`}
          >
            <span className="data text-base">{n}</span>
            {EMOTION_LABELS[n]}
          </button>
        ))}
      </div>
    </div>
  )
}
