/**
 * 逐筆評估：依時間順序重播所有交易，算出每筆的違規、開倉當下的精神力與倉位階級、評分與評級。
 * 純函數，不碰資料庫。舊資料（gamified = false）照樣影響精神力、冷卻等時間事件，但不評分、不記違規。
 */
import { isClosed, isOpened, movedStopAgainst, riskPct as riskPctOf, rMultiple, tradePnl } from '../lib/trade'
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
  OVERCONFIDENCE_STREAK,
  REVIEW_FULL_MS,
  REVIEW_HALF_MS,
  RISK_HALF_RATIO,
  SIZE_UP_RATIO,
  TIERS,
  TILT_MESSAGE,
  TILT_SCORE_CAP,
  VETERAN_MAX_DD_PCT,
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
  pnl: number | null
  riskPct: number | null
  tierAtOpen: 1 | 2 | 3
  capPct: number
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

export interface TierState {
  level: 1 | 2 | 3
  name: string
  capPct: number
  /** 目前階級往上一階已累積的 A 以上筆數 */
  progress: number
  progressTarget: number | null
  ddOk: boolean
}

export interface Timeline {
  /** 已進場的交易，依進場時間排序 */
  evals: TradeEval[]
  byId: Map<string, TradeEval>
  /** 已平倉，依平倉時間排序 */
  closes: TradeEval[]
  tier: TierState
  /** 每筆平倉後的權益；沒設起始權益時為空 */
  curve: EquityPoint[]
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

/** 浮點數比較：風險 % 是除出來的，門檻邊界要容忍極小誤差 */
const lte = (a: number, b: number) => a <= b + 1e-9

const tierDef = (level: 1 | 2 | 3) => TIERS[level - 1]

/** 虧損平倉扣的精神力：round(10 × |R|)，連續第 2 筆以上的虧損加倍 */
export function lossHpCost(r: number, lossStreak: number): number {
  const base = Math.round(HP_PER_LOSS_R * Math.abs(r))
  return lossStreak >= 2 ? base * 2 : base
}

// ── 權益與回撤 ──────────────────────────────────────────

export interface EquityPoint {
  at: number
  equity: number
}

/** 每筆平倉後的權益（起始權益＋累計損益）；沒有起始權益時為空 */
export function equityCurve(closes: { trade: Trade; pnl: number | null }[], startingEquity: number | null): EquityPoint[] {
  if (startingEquity === null) return []
  let eq = startingEquity
  return closes.map((c) => {
    eq += c.pnl ?? 0
    return { at: ms(c.trade.closed_at!), equity: eq }
  })
}

/** 區間 [start, upTo] 內的最大回撤 %，起點權益也算高點 */
export function maxDrawdownPct(curve: EquityPoint[], startingEquity: number | null, start: number, upTo: number): number | null {
  if (startingEquity === null) return null
  let peak = startingEquity
  for (const p of curve) {
    if (p.at >= start) break
    peak = p.equity
  }
  let maxDd = 0
  for (const p of curve) {
    if (p.at < start || p.at > upTo) continue
    peak = Math.max(peak, p.equity)
    maxDd = Math.max(maxDd, (peak - p.equity) / peak)
  }
  return Math.round(maxDd * 1000) / 10
}

// ── 重播 ────────────────────────────────────────────────

export function buildTimeline(trades: Trade[], startingEquity: number | null, now: Date): Timeline {
  const nowMs = now.getTime()
  const opened = trades
    .filter((t): t is OpenTrade => isOpened(t) && t.abandoned_at === null)
    .sort((a, b) => ms(a.opened_at) - ms(b.opened_at) || ms(a.created_at) - ms(b.created_at))

  // 平倉序列：R、損益、連虧數
  const closedTrades = opened.filter(isClosed).sort((a, b) => ms(a.closed_at) - ms(b.closed_at))
  const rOf = new Map<string, number>()
  const pnlOf = new Map<string, number>()
  const lossStreakOf = new Map<string, number>()
  let streak = 0
  for (const t of closedTrades) {
    const r = rMultiple(t)
    rOf.set(t.id, r)
    pnlOf.set(t.id, tradePnl(t).value)
    streak = r < 0 ? streak + 1 : 0
    lossStreakOf.set(t.id, streak)
  }
  const curve = equityCurve(
    closedTrades.map((t) => ({ trade: t, pnl: pnlOf.get(t.id)! })),
    startingEquity,
  )

  /** 某時刻（不含）之前，當天的精神力 */
  const hpBefore = (at: number): number => {
    const day = dayKey(new Date(at))
    let hp = HP_MAX
    for (const t of opened) if (ms(t.opened_at) < at && dayKey(t.opened_at) === day) hp -= HP_PER_OPEN
    for (const t of closedTrades) {
      const c = ms(t.closed_at)
      const r = rOf.get(t.id)!
      if (c < at && r < 0 && dayKey(t.closed_at) === day) hp -= lossHpCost(r, lossStreakOf.get(t.id)!)
    }
    return Math.max(0, hp)
  }

  /** 某時刻（含）之前最近的幾筆平倉，由新到舊 */
  const closesBefore = (at: number) => closedTrades.filter((t) => ms(t.closed_at) <= at).reverse()
  /** 兩個時刻之間有沒有其他進場 */
  const openedBetween = (from: number, to: number, except: string) =>
    opened.some((t) => t.id !== except && ms(t.opened_at) > from && ms(t.opened_at) < to)

  // 倉位階級狀態
  let tier: 1 | 2 | 3 = 1
  let counter = 0
  const ddAt = (at: number) => {
    const { start } = monthBounds(monthKey(new Date(at)))
    return maxDrawdownPct(curve, startingEquity, start, at)
  }
  const ddOkAt = (at: number) => {
    const dd = ddAt(at)
    return dd !== null && dd < VETERAN_MAX_DD_PCT
  }
  const tryPromote = (at: number) => {
    const def = tierDef(tier)
    if (def.promoteAt === null || counter < def.promoteAt) return
    if (tier === 2 && !ddOkAt(at)) return
    tier = (tier + 1) as 1 | 2 | 3
    counter = 0
  }

  // 事件依時間排序：進場決定當下上限與違規；平倉累積晉升計數
  type Ev = { at: number; kind: 'open' | 'close'; t: OpenTrade }
  const events: Ev[] = [
    ...opened.map((t) => ({ at: ms(t.opened_at), kind: 'open' as const, t })),
    ...closedTrades.map((t) => ({ at: ms(t.closed_at), kind: 'close' as const, t })),
  ].sort((a, b) => a.at - b.at || (a.kind === 'open' ? -1 : 1))

  const byId = new Map<string, TradeEval>()
  const dayCount = new Map<string, number>()

  for (const ev of events) {
    const t = ev.t
    if (ev.kind === 'open') {
      const day = dayKey(t.opened_at)
      const nth = (dayCount.get(day) ?? 0) + 1
      dayCount.set(day, nth)

      const rp = riskPctOf(t)
      const capPct = tierDef(tier).capPct
      const cardBefore = t.card_at !== null && ms(t.card_at) < ev.at
      const stopAgainst = movedStopAgainst(t)
      const violations: Violation[] = []
      if (t.gamified) {
        if (stopAgainst) violations.push('stop_against')
        if (!cardBefore) violations.push('no_card')
        if (rp !== null && !lte(rp, capPct)) violations.push('over_risk')

        const prior = closesBefore(ev.at)
        if (prior.some((c) => rOf.get(c.id)! < 0 && ev.at - ms(c.closed_at) <= COOLDOWN_MS)) violations.push('tilt')

        const last = prior[0]
        if (last && rOf.get(last.id)! < 0 && !openedBetween(ms(last.closed_at), ev.at, t.id)) {
          const lastRp = riskPctOf(last)
          if (rp !== null && lastRp !== null && rp > lastRp * SIZE_UP_RATIO) violations.push('revenge')
        }

        const wins = prior.slice(0, OVERCONFIDENCE_STREAK)
        if (
          wins.length === OVERCONFIDENCE_STREAK &&
          wins.every((c) => rOf.get(c.id)! > 0) &&
          !openedBetween(ms(wins[0].closed_at), ev.at, t.id)
        ) {
          const rps = wins.map(riskPctOf)
          if (rp !== null && rps.every((x) => x !== null)) {
            const avg = (rps as number[]).reduce((s, x) => s + x, 0) / rps.length
            if (rp > avg * SIZE_UP_RATIO) violations.push('overconfidence')
          }
        }

        const hour = tpeHour(t.opened_at)
        if ((hour >= FATIGUE_HOURS[0] && hour < FATIGUE_HOURS[1]) || nth >= FATIGUE_NTH_TRADE) violations.push('fatigue')
      }

      byId.set(t.id, {
        trade: t,
        closed: false,
        r: null,
        pnl: null,
        riskPct: rp,
        tierAtOpen: tier,
        capPct,
        cardBefore,
        cardAfter: t.card_at !== null && !cardBefore,
        stopAgainst,
        violations,
        hpAtOpen: hpBefore(ev.at),
        score: null,
        items: null,
        provisional: false,
        grade: null,
        quadrant: null,
        mainViolation: null,
        reviewedIn24h: false,
      })

      // 上頭違規：降一階、晉升計數歸零
      if (violations.includes('tilt')) {
        tier = Math.max(1, tier - 1) as 1 | 2 | 3
        counter = 0
      }
    } else {
      const e = byId.get(t.id)!
      const closedTrade = isClosed(t) ? t : null
      if (!closedTrade) continue
      e.closed = true
      e.r = rOf.get(t.id)!
      e.pnl = pnlOf.get(t.id)!
      const closedAt = ms(closedTrade.closed_at)
      const reviewDelay = t.reviewed_at === null ? null : ms(t.reviewed_at) - closedAt
      e.reviewedIn24h = reviewDelay !== null && reviewDelay <= REVIEW_FULL_MS
      if (!t.gamified) continue

      const items: Record<ScoreItem, number> = {
        card: e.cardBefore ? ITEM_MAX : 0,
        stop: t.planned_stop !== null ? ITEM_MAX : 0,
        risk: e.riskPct === null ? 0 : lte(e.riskPct, e.capPct) ? ITEM_MAX : lte(e.riskPct, e.capPct * RISK_HALF_RATIO) ? ITEM_MAX / 2 : 0,
        stopMove: e.stopAgainst ? 0 : ITEM_MAX,
        review: reviewDelay === null ? 0 : reviewDelay <= REVIEW_FULL_MS ? ITEM_MAX : reviewDelay <= REVIEW_HALF_MS ? ITEM_MAX / 2 : 0,
      }
      const raw = Object.values(items).reduce((s, x) => s + x, 0)
      const tilt = e.violations.includes('tilt')
      const score = tilt ? Math.min(raw, TILT_SCORE_CAP) : raw
      let grade = gradeOf(score)
      if (e.hpAtOpen === 0) grade = downgrade(grade)

      e.items = items
      e.score = score
      e.grade = grade
      e.provisional = reviewDelay === null && nowMs - closedAt < REVIEW_HALF_MS
      e.quadrant = quadrantOf(e.r, score)
      e.mainViolation = mainViolationOf(items, tilt && raw > TILT_SCORE_CAP)

      if (grade === 'S' || grade === 'A') {
        counter += 1
        tryPromote(ev.at)
      }
    }
  }
  // 回撤條件可能在最後一筆 A 之後才達標
  tryPromote(nowMs)

  const evals = opened.map((t) => byId.get(t.id)!)
  const def = tierDef(tier)
  return {
    evals,
    byId,
    closes: closedTrades.map((t) => byId.get(t.id)!),
    curve,
    tier: {
      level: tier,
      name: def.name,
      capPct: def.capPct,
      progress: counter,
      progressTarget: def.promoteAt,
      ddOk: ddOkAt(nowMs),
    },
  }
}

/** 扣分最多的那一項；冷卻期間開單時以上頭為主 */
function mainViolationOf(items: Record<ScoreItem, number>, tiltCapped: boolean): string | null {
  if (tiltCapped) return TILT_MESSAGE
  let worst: ScoreItem | null = null
  for (const k of ['card', 'stop', 'risk', 'stopMove', 'review'] as ScoreItem[]) {
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
