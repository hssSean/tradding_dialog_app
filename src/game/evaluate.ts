/**
 * 逐筆評估：依時間順序重播所有交易，算出每筆的違規、開倉當下的精神力、評分與評級。
 * 純函數，不碰資料庫。舊資料（gamified = false）照樣影響精神力、冷卻等時間事件，但不評分、不記違規。
 * 2026-10-11 起不碰金錢：沒有權益、風險 %、倉位階級，損益只用 R。
 */
import { isClosed, isOpened, movedStopAgainst, rMultiple } from '../lib/trade'
import type { OpenTrade, Trade } from '../lib/types'
import { DAY_MS, tpe, tpeMidnight, ymd } from '../lib/tz'
import {
  COOLDOWN_MS,
  DISCIPLINED_SCORE,
  FATIGUE_HOURS,
  FATIGUE_NTH_TRADE,
  GRADE_THRESHOLDS,
  HP_MAX,
  HP_PER_LOSS_R,
  HP_PER_OPEN,
  ITEM_MAX,
  ITEM_MESSAGES,
  REVIEW_FULL_MS,
  REVIEW_HALF_MS,
  TILT_MESSAGE,
  TILT_SCORE_CAP,
  type Grade,
  type Quadrant,
  type ScoreItem,
  type Violation,
} from './rules'

export interface TradeEval {
  trade: OpenTrade
  closed: boolean
  /** 已平倉才有 */
  r: number | null
  cardBefore: boolean
  cardAfter: boolean
  stopAgainst: boolean
  /** 舊資料一律為空 */
  violations: Violation[]
  hpAtOpen: number
  /** 已平倉且 gamified 才有評分 */
  score: number | null
  items: Record<ScoreItem, number> | null
  provisional: boolean
  grade: Grade | null
  quadrant: Quadrant | null
  mainViolation: string | null
  reviewedIn24h: boolean
}

export interface Timeline {
  /** 已進場的交易，依進場時間排序 */
  evals: TradeEval[]
  byId: Map<string, TradeEval>
  /** 已平倉，依平倉時間排序 */
  closes: TradeEval[]
}

// ── 時間工具（台北） ────────────────────────────────────

const ms = (iso: string) => Date.parse(iso)
export const dayKey = (iso: string | Date) => ymd(tpe(iso))
export const monthKey = (iso: string | Date) => dayKey(iso).slice(0, 7)
export const tpeHour = (iso: string) => tpe(iso).getUTCHours()

export function monthBounds(month: string): { start: number; end: number } {
  const [y, m] = month.split('-').map(Number)
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  return { start: tpeMidnight(`${month}-01`).getTime(), end: tpeMidnight(`${next}-01`).getTime() }
}

export function prevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

// ── 小工具 ──────────────────────────────────────────────

export function gradeOf(score: number): Grade {
  return GRADE_THRESHOLDS.find(([, min]) => score >= min)![0]
}

const GRADE_ORDER: Grade[] = ['S', 'A', 'B', 'C', 'D']
export function downgrade(g: Grade): Grade {
  return GRADE_ORDER[Math.min(GRADE_ORDER.length - 1, GRADE_ORDER.indexOf(g) + 1)]
}

export function quadrantOf(r: number, score: number): Quadrant {
  const disciplined = score >= DISCIPLINED_SCORE
  if (r > 0) return disciplined ? 'good_win' : 'lucky_bad'
  return disciplined ? 'good_loss' : 'bad_loss'
}

/** 虧損平倉扣的精神力：round(10 × |R|)，連續第 2 筆以上的虧損加倍 */
export function lossHpCost(r: number, lossStreak: number): number {
  const base = Math.round(HP_PER_LOSS_R * Math.abs(r))
  return lossStreak >= 2 ? base * 2 : base
}

/** 累積 R 序列的最大回落（從高點到低點，單位 R，起點 0 也算高點） */
export function maxDrawdownR(rs: number[]): number {
  let cum = 0
  let peak = 0
  let dd = 0
  for (const r of rs) {
    cum += r
    peak = Math.max(peak, cum)
    dd = Math.max(dd, peak - cum)
  }
  return Math.round(dd * 100) / 100
}

// ── 重播 ────────────────────────────────────────────────

export function buildTimeline(trades: Trade[], now: Date): Timeline {
  const nowMs = now.getTime()
  const opened = trades
    .filter((t): t is OpenTrade => isOpened(t) && t.abandoned_at === null)
    .sort((a, b) => ms(a.opened_at) - ms(b.opened_at) || ms(a.created_at) - ms(b.created_at))

  // 平倉序列：R 與連虧數
  const closedTrades = opened.filter(isClosed).sort((a, b) => ms(a.closed_at) - ms(b.closed_at))
  const rOf = new Map<string, number>()
  const lossStreakOf = new Map<string, number>()
  let streak = 0
  for (const t of closedTrades) {
    const r = rMultiple(t)
    rOf.set(t.id, r)
    streak = r < 0 ? streak + 1 : 0
    lossStreakOf.set(t.id, streak)
  }

  /** 某時刻（不含）之前，當天的精神力 */
  const hpBefore = (at: number): number => {
    const day = dayKey(new Date(at))
    let hp = HP_MAX
    for (const t of opened) if (ms(t.opened_at) < at && dayKey(t.opened_at) === day) hp -= HP_PER_OPEN
    for (const t of closedTrades) {
      const r = rOf.get(t.id)!
      if (ms(t.closed_at) < at && r < 0 && dayKey(t.closed_at) === day) hp -= lossHpCost(r, lossStreakOf.get(t.id)!)
    }
    return Math.max(0, hp)
  }

  const byId = new Map<string, TradeEval>()
  const dayCount = new Map<string, number>()

  for (const t of opened) {
    const at = ms(t.opened_at)
    const day = dayKey(t.opened_at)
    const nth = (dayCount.get(day) ?? 0) + 1
    dayCount.set(day, nth)

    // 作戰卡在進場當天（台北 24:00 前）補完就算有（2026-10-12 使用者決定：晚上補也不扣分）
    const cardDeadline = nextMidnight(new Date(at))
    const cardBefore = t.card_at !== null && ms(t.card_at) < cardDeadline
    const cardPending = t.card_at === null && nowMs < cardDeadline
    const stopAgainst = movedStopAgainst(t)
    const violations: Violation[] = []
    if (t.gamified) {
      if (stopAgainst) violations.push('stop_against')
      if (!cardBefore && !cardPending) violations.push('no_card')
      // 上頭：任一筆虧損平倉後 15 分鐘內開單（舊資料的虧損也算）
      const cooling = closedTrades.some((c) => {
        const dt = at - ms(c.closed_at)
        return rOf.get(c.id)! < 0 && dt >= 0 && dt <= COOLDOWN_MS
      })
      if (cooling) violations.push('tilt')
      const hour = tpeHour(t.opened_at)
      if ((hour >= FATIGUE_HOURS[0] && hour < FATIGUE_HOURS[1]) || nth >= FATIGUE_NTH_TRADE) violations.push('fatigue')
    }

    const e: TradeEval = {
      trade: t,
      closed: false,
      r: null,
      cardBefore,
      cardAfter: t.card_at !== null && !cardBefore,
      stopAgainst,
      violations,
      hpAtOpen: hpBefore(at),
      score: null,
      items: null,
      provisional: false,
      grade: null,
      quadrant: null,
      mainViolation: null,
      reviewedIn24h: false,
    }
    byId.set(t.id, e)

    if (!isClosed(t)) continue
    e.closed = true
    e.r = rOf.get(t.id)!
    const closedAt = ms(t.closed_at)
    const reviewDelay = t.reviewed_at === null ? null : ms(t.reviewed_at) - closedAt
    e.reviewedIn24h = reviewDelay !== null && reviewDelay <= REVIEW_FULL_MS
    if (!t.gamified) continue

    const items: Record<ScoreItem, number> = {
      card: cardBefore ? ITEM_MAX : 0,
      stop: t.planned_stop !== null ? ITEM_MAX : 0,
      stopMove: stopAgainst ? 0 : ITEM_MAX,
      review: reviewDelay === null ? 0 : reviewDelay <= REVIEW_FULL_MS ? ITEM_MAX : reviewDelay <= REVIEW_HALF_MS ? ITEM_MAX / 2 : 0,
    }
    const raw = Object.values(items).reduce((s, x) => s + x, 0)
    const tilt = violations.includes('tilt')
    const score = tilt ? Math.min(raw, TILT_SCORE_CAP) : raw
    let grade = gradeOf(score)
    if (e.hpAtOpen === 0) grade = downgrade(grade)

    e.items = items
    e.score = score
    e.grade = grade
    e.provisional = (reviewDelay === null && nowMs - closedAt < REVIEW_HALF_MS) || cardPending
    e.quadrant = quadrantOf(e.r, score)
    e.mainViolation = mainViolationOf(items, tilt && raw > TILT_SCORE_CAP)
  }

  return {
    evals: opened.map((t) => byId.get(t.id)!),
    byId,
    closes: closedTrades.map((t) => byId.get(t.id)!),
  }
}

/** 扣分最多的那一項；冷卻期間開單時以上頭為主 */
function mainViolationOf(items: Record<ScoreItem, number>, tiltCapped: boolean): string | null {
  if (tiltCapped) return TILT_MESSAGE
  let worst: ScoreItem | null = null
  for (const k of ['card', 'stop', 'stopMove', 'review'] as ScoreItem[]) {
    if (items[k] < ITEM_MAX && (worst === null || items[k] < items[worst])) worst = k
  }
  return worst ? ITEM_MESSAGES[worst] : null
}

/** 今天（台北）到目前為止的精神力 */
export function dailyHp(timeline: Timeline, now: Date): number {
  const day = dayKey(now)
  const nowMs = now.getTime()
  let hp = HP_MAX
  for (const e of timeline.evals) {
    if (dayKey(e.trade.opened_at) === day && ms(e.trade.opened_at) <= nowMs) hp -= HP_PER_OPEN
  }
  // 連虧數要從整個平倉序列算
  let streak = 0
  for (const e of timeline.closes) {
    streak = e.r! < 0 ? streak + 1 : 0
    const c = e.trade.closed_at!
    if (e.r! < 0 && dayKey(c) === day && ms(c) <= nowMs) hp -= lossHpCost(e.r!, streak)
  }
  return Math.max(0, hp)
}

/** 下一個台北午夜 */
export function nextMidnight(now: Date): number {
  return tpeMidnight(dayKey(now)).getTime() + DAY_MS
}
