/**
 * 由逐筆評估推導的長期進度：狀態異常、屬性、職業、功課、連續天數、心魔、成就、圖鑑、賽季、經驗值。
 * 純函數。所有「完成」都由紀錄推導，不另外存勾選狀態。
 */
import { weekStartOf } from '../lib/stats'
import type { DailyNote, Setup, TradeImage } from '../lib/types'
import { DAY_MS, tpe, tpeMidnight, ymd } from '../lib/tz'
import { dayKey, maxDrawdownPct, monthBounds, monthKey, nextMidnight, prevMonth, type Timeline, type TradeEval } from './evaluate'
import {
  ACHIEVEMENTS,
  ANNOTATE_TARGET,
  ATTRIBUTE_ADVICE,
  ATTRIBUTE_MIN_TRADES,
  BOSS_DESCRIPTIONS,
  BOSS_HP,
  BOSS_NAMES,
  BOSS_REWARD_TITLE,
  BOSS_REWARD_XP,
  CLASS_MIN_TRADES,
  COOLDOWN_MS,
  DEBUFF_MS,
  DEX_REVEAL_N,
  MONTH_NAMES,
  QUEST_XP,
  VIOLATIONS,
  XP_ACHIEVEMENT,
  XP_BY_GRADE,
  XP_CARD_AFTER,
  XP_CARD_BEFORE,
  XP_REVIEW,
  XP_REVIEW_ANNOTATED,
  levelTitle,
  xpToNext,
  type AchievementId,
  type AttributeKey,
  type ClassName,
  type DebuffKind,
  type Violation,
} from './rules'

export type ImageMeta = Pick<TradeImage, 'trade_id' | 'kind' | 'caption' | 'captioned_at'>

const ms = (iso: string) => Date.parse(iso)
const round2 = (x: number) => Math.round(x * 100) / 100
const hasText = (s: string | null | undefined) => Boolean(s && s.trim())
const pct = (part: number, total: number) => (total ? Math.round((part / total) * 100) : 0)

/** 已平倉的 gamified 交易 */
const scored = (closes: TradeEval[]) => closes.filter((e) => e.trade.gamified)
const inMonth = (iso: string, month: string) => monthKey(iso) === month

// ── 狀態異常 §4.5 ──────────────────────────────────────

export interface Debuff {
  kind: DebuffKind
  endsAt: string
  detail: string
}

const DEBUFF_DETAILS: Record<Exclude<DebuffKind, 'cooldown'>, string> = {
  revenge: '虧損後加大倉位。記入情緒控管。',
  overconfidence: '連贏後加大倉位。記入情緒控管。',
  fomo: '沒有作戰卡就進場。記入耐心。',
  fatigue: '深夜開單，或今天已經開太多單。記入耐心。',
}
const DEBUFF_ORDER: DebuffKind[] = ['cooldown', 'revenge', 'overconfidence', 'fomo', 'fatigue']

export function activeDebuffs(tl: Timeline, now: Date): Debuff[] {
  const nowMs = now.getTime()
  const found = new Map<DebuffKind, Debuff>()
  const put = (kind: DebuffKind, endsAt: number, detail: string) => {
    if (endsAt <= nowMs) return
    const prev = found.get(kind)
    if (!prev || ms(prev.endsAt) < endsAt) found.set(kind, { kind, endsAt: new Date(endsAt).toISOString(), detail })
  }

  const lastLoss = [...tl.closes].reverse().find((e) => e.r! < 0 && ms(e.trade.closed_at!) <= nowMs)
  if (lastLoss) {
    const closed = ms(lastLoss.trade.closed_at!)
    const mins = Math.floor((nowMs - closed) / 60_000)
    put('cooldown', closed + COOLDOWN_MS, `上一筆虧損後 ${mins} 分鐘。冷卻期間開單會記為上頭：評分上限 B、倉位降一階。`)
  }

  const midnight = nextMidnight(now)
  for (const e of tl.evals) {
    const opened = ms(e.trade.opened_at)
    if (opened > nowMs) continue
    if (e.violations.includes('revenge')) put('revenge', opened + DEBUFF_MS, DEBUFF_DETAILS.revenge)
    if (e.violations.includes('overconfidence')) put('overconfidence', opened + DEBUFF_MS, DEBUFF_DETAILS.overconfidence)
    if (e.violations.includes('no_card')) put('fomo', opened + DEBUFF_MS, DEBUFF_DETAILS.fomo)
    if (e.violations.includes('fatigue') && dayKey(e.trade.opened_at) === dayKey(now)) put('fatigue', midnight, DEBUFF_DETAILS.fatigue)
  }
  return DEBUFF_ORDER.filter((k) => found.has(k)).map((k) => found.get(k)!)
}

// ── 屬性 §4.7、職業 §4.8 ───────────────────────────────

export interface Attributes {
  values: { key: AttributeKey; value: number }[]
  weakest: AttributeKey
  advice: string
}

export function attributesOf(closes: TradeEval[]): Attributes | null {
  const list = scored(closes)
  if (list.length < ATTRIBUTE_MIN_TRADES) return null
  const n = list.length
  const count = (f: (e: TradeEval) => boolean) => list.filter(f).length
  const has = (e: TradeEval, ...vs: Violation[]) => vs.some((v) => e.violations.includes(v))
  const values: { key: AttributeKey; value: number }[] = [
    { key: '風控', value: pct(count((e) => e.trade.planned_stop !== null && e.riskPct !== null && e.riskPct <= e.capPct + 1e-9), n) },
    { key: '復盤', value: pct(count((e) => e.reviewedIn24h), n) },
    { key: '執行力', value: pct(count((e) => e.cardBefore && !e.stopAgainst), n) },
    { key: '耐心', value: 100 - pct(count((e) => has(e, 'no_card', 'fatigue')), n) },
    { key: '情緒控管', value: 100 - pct(count((e) => has(e, 'tilt', 'revenge', 'overconfidence')), n) },
  ]
  const weakest = values.reduce((m, v) => (v.value < m.value ? v : m)).key
  return { values, weakest, advice: ATTRIBUTE_ADVICE[weakest] }
}

export function classOf(closes: TradeEval[]): ClassName | null {
  if (closes.length < CLASS_MIN_TRADES) return null
  const holds = closes.map((e) => ms(e.trade.closed_at!) - ms(e.trade.opened_at)).sort((a, b) => a - b)
  const mid = holds.length / 2
  const median = holds.length % 2 ? holds[Math.floor(mid)] : (holds[mid - 1] + holds[mid]) / 2
  const wins = closes.filter((e) => e.r! > 0).map((e) => e.r!)
  const losses = closes.filter((e) => e.r! < 0).map((e) => Math.abs(e.r!))
  const winRate = wins.length / closes.length
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
  if (winRate < 0.4 && wins.length && losses.length && avg(wins) / avg(losses) >= 2.5) return '狙擊手型'
  return median < 3600_000 ? '刺客型' : '遊俠型'
}

// ── 功課 §4.11 與連續天數 ──────────────────────────────

export interface Quest {
  id: string
  label: string
  progress?: string
  xp: number
  done: boolean
  /** 點擊後前往完成這件事的頁面 */
  href: string
}

interface QuestInputs {
  tl: Timeline
  notes: DailyNote[]
  images: ImageMeta[]
  setups: Setup[]
}

const weekOf = (iso: string) => weekStartOf(iso)
const noteOn = (notes: DailyNote[], date: string) => notes.find((n) => n.date === date)

/** 某台北日期平倉的交易，與其中已復盤的筆數 */
function reviewStatus(tl: Timeline, date: string) {
  const closes = tl.closes.filter((e) => dayKey(e.trade.closed_at!) === date)
  return { closes, reviewed: closes.filter((e) => e.trade.reviewed_at !== null).length }
}

function annotatedEntryImages(images: ImageMeta[], week: string) {
  return images.filter((i) => i.kind === 'entry' && hasText(i.caption) && i.captioned_at && weekOf(i.captioned_at) === week).length
}

export function currentQuests({ tl, notes, images, setups }: QuestInputs, now: Date): Quest[] {
  const today = dayKey(now)
  const week = weekOf(now.toISOString())
  const month = monthKey(now)
  const quests: Quest[] = []

  quests.push({
    id: 'market-view',
    label: '開盤前寫市場觀察',
    xp: QUEST_XP.marketView,
    done: hasText(noteOn(notes, today)?.market_view),
    href: '/notes',
  })

  const { closes, reviewed } = reviewStatus(tl, today)
  if (closes.length) {
    const next = closes.find((e) => e.trade.reviewed_at === null)
    quests.push({
      id: 'review-today',
      label: '復盤今日所有交易',
      progress: `${reviewed}/${closes.length}`,
      xp: QUEST_XP.reviewToday,
      done: reviewed === closes.length,
      href: next ? `/trade/${next.trade.id}` : '/log',
    })
  }

  const annotated = annotatedEntryImages(images, week)
  quests.push({
    id: 'annotate',
    label: `本週標註 ${ANNOTATE_TARGET} 張進場截圖`,
    progress: `${Math.min(annotated, ANNOTATE_TARGET)}/${ANNOTATE_TARGET}`,
    xp: QUEST_XP.annotate,
    done: annotated >= ANNOTATE_TARGET,
    href: '/log',
  })

  quests.push({
    id: 'weekly-mistake',
    label: '寫下本週最大的錯誤',
    xp: QUEST_XP.weeklyMistake,
    done: notes.some((n) => weekOf(tpeMidnight(n.date).toISOString()) === week && hasText(n.weekly_mistake)),
    href: '/notes',
  })

  quests.push({
    id: 'dex-check',
    label: '檢查一張圖鑑卡，決定保留或淘汰',
    xp: QUEST_XP.dexCheck,
    done: setups.some((s) => s.reviewed_at !== null && inMonth(s.reviewed_at, month)),
    href: '/dex',
  })
  return quests
}

/** 歷來所有完成過的功課的經驗值總和 */
export function questXp({ tl, notes, images, setups }: QuestInputs): number {
  let xp = 0
  for (const n of notes) if (hasText(n.market_view)) xp += QUEST_XP.marketView
  const closeDays = new Set(tl.closes.map((e) => dayKey(e.trade.closed_at!)))
  for (const d of closeDays) {
    const { closes, reviewed } = reviewStatus(tl, d)
    if (closes.length && reviewed === closes.length) xp += QUEST_XP.reviewToday
  }
  const weeks = new Set(images.filter((i) => i.captioned_at).map((i) => weekOf(i.captioned_at!)))
  for (const w of weeks) if (annotatedEntryImages(images, w) >= ANNOTATE_TARGET) xp += QUEST_XP.annotate
  const mistakeWeeks = new Set(notes.filter((n) => hasText(n.weekly_mistake)).map((n) => weekOf(tpeMidnight(n.date).toISOString())))
  xp += mistakeWeeks.size * QUEST_XP.weeklyMistake
  const dexMonths = new Set(setups.filter((s) => s.reviewed_at).map((s) => monthKey(s.reviewed_at!)))
  xp += dexMonths.size * QUEST_XP.dexCheck
  return xp
}

/** 連續天數：有平倉的日子要全部復盤；沒平倉的日子寫了市場觀察也算 */
export function streakDays(tl: Timeline, notes: DailyNote[], now: Date): number {
  const ok = (date: string) => {
    const { closes, reviewed } = reviewStatus(tl, date)
    return closes.length ? reviewed === closes.length : hasText(noteOn(notes, date)?.market_view)
  }
  const shift = (date: string, days: number) => ymd(new Date(tpe(tpeMidnight(date)).getTime() + days * DAY_MS))
  let date = dayKey(now)
  if (!ok(date)) date = shift(date, -1)
  let n = 0
  while (n < 1000 && ok(date)) {
    n += 1
    date = shift(date, -1)
  }
  return n
}

// ── 心魔 §4.10 ─────────────────────────────────────────

export interface Boss {
  month: string
  violation: Violation
  name: string
  description: string
  hp: number
  maxHp: number
  reward: string
  defeated: boolean
}

export function bossOf(tl: Timeline, month: string): Boss | null {
  const counts = new Map<Violation, number>()
  for (const e of scored(tl.closes)) {
    if (!inMonth(e.trade.closed_at!, prevMonth(month))) continue
    for (const v of e.violations) counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  let pick: Violation | null = null
  for (const v of VIOLATIONS) if ((counts.get(v) ?? 0) > (pick ? counts.get(pick)! : 0)) pick = v
  if (!pick) return null

  let hp = BOSS_HP
  let defeated = false
  for (const e of scored(tl.closes)) {
    if (defeated || !inMonth(e.trade.closed_at!, month)) continue
    if (e.violations.includes(pick)) hp = BOSS_HP
    else hp -= 1
    if (hp === 0) defeated = true
  }
  return {
    month,
    violation: pick,
    name: BOSS_NAMES[pick],
    description: BOSS_DESCRIPTIONS[pick],
    hp,
    maxHp: BOSS_HP,
    reward: BOSS_REWARD_TITLE,
    defeated,
  }
}

/** 從第一筆交易的月份到現在，擊敗過的心魔 */
export function defeatedBosses(tl: Timeline, now: Date): Boss[] {
  if (!tl.closes.length) return []
  const out: Boss[] = []
  let month = monthKey(tl.closes[0].trade.closed_at!)
  const last = monthKey(now)
  while (month <= last) {
    const b = bossOf(tl, month)
    if (b?.defeated) out.push(b)
    const [y, m] = month.split('-').map(Number)
    month = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  }
  return out
}

// ── 成就 §4.13 ─────────────────────────────────────────

function longestRun<T>(xs: T[], pred: (x: T) => boolean): number {
  let best = 0
  let run = 0
  for (const x of xs) {
    run = pred(x) ? run + 1 : 0
    best = Math.max(best, run)
  }
  return best
}

export function achievementsOf(
  tl: Timeline,
  notes: DailyNote[],
  startingEquity: number | null,
  now: Date,
): Set<AchievementId> {
  const got = new Set<AchievementId>()
  const gClosed = scored(tl.closes)
  const gOpened = tl.evals.filter((e) => e.trade.gamified)
  const today = dayKey(now)

  if (longestRun(gClosed, (e) => !e.stopAgainst) >= 50) got.add('iron')
  if (longestRun(gOpened, (e) => e.cardBefore) >= 20) got.add('diarist')
  if (longestRun(gOpened, (e) => e.trade.emotion === 3) >= 10) got.add('zen')
  if (tl.closes.filter((e) => e.trade.reviewed_at !== null).length >= 100) got.add('historian')

  // 懂得收手：某天第 3 筆連虧之後，當天沒有再開單（只看已經過完的日子）
  let streak = 0
  for (const e of tl.closes) {
    streak = e.r! < 0 ? streak + 1 : 0
    const day = dayKey(e.trade.closed_at!)
    if (streak >= 3 && day < today) {
      const after = ms(e.trade.closed_at!)
      if (!tl.evals.some((o) => ms(o.trade.opened_at) > after && dayKey(o.trade.opened_at) === day)) got.add('know_stop')
    }
  }

  // 空手也是倉位：已經過完的一整週，零進場且七天都有市場觀察
  const viewDates = new Set(notes.filter((n) => hasText(n.market_view)).map((n) => n.date))
  const thisWeek = weekStartOf(now.toISOString())
  for (const d of viewDates) {
    const week = weekStartOf(tpeMidnight(d).toISOString())
    if (week >= thisWeek) continue
    const start = tpeMidnight(week).getTime()
    const days = Array.from({ length: 7 }, (_, i) => ymd(tpe(new Date(start + i * DAY_MS))))
    const noTrades = !tl.evals.some((e) => {
      const t = ms(e.trade.opened_at)
      return t >= start && t < start + 7 * DAY_MS
    })
    if (noTrades && days.every((x) => viewDates.has(x))) got.add('empty_hand')
  }

  // 浴火重生：回撤超過 5% 後回到前高，期間沒有上頭違規
  if (startingEquity !== null) {
    let peak = startingEquity
    let peakAt = 0
    let armed = false
    for (const p of tl.curve) {
      if (armed && p.equity >= peak) {
        const tilted = tl.evals.some((e) => e.violations.includes('tilt') && ms(e.trade.opened_at) > peakAt && ms(e.trade.opened_at) <= p.at)
        if (!tilted) got.add('phoenix')
        armed = false
      }
      if (p.equity >= peak) {
        peak = p.equity
        peakAt = p.at
      } else if ((peak - p.equity) / peak > 0.05) armed = true
    }
  }
  return got
}

// ── 圖鑑 §4.12 ─────────────────────────────────────────

export interface DexCard {
  setupId: string
  name: string
  n: number
  revealed: boolean
  winRate?: number
  ev?: number
  cursed: boolean
  /** 累積 R 走勢（最多最近 30 筆），畫縮圖用 */
  path: number[]
  reviewedAt: string | null
}

export function setupDex(tl: Timeline, setups: Setup[]): DexCard[] {
  return setups
    .filter((s) => !s.archived)
    .map((s) => {
      const rs = tl.closes.filter((e) => e.trade.setup_id === s.id).map((e) => e.r!)
      const n = rs.length
      const revealed = n >= DEX_REVEAL_N
      const ev = n ? round2(rs.reduce((a, b) => a + b, 0) / n) : 0
      let cum = 0
      const path = [0, ...rs.map((r) => (cum += r))].slice(-31)
      return {
        setupId: s.id,
        name: s.name,
        n,
        revealed,
        winRate: revealed ? rs.filter((r) => r > 0).length / n : undefined,
        ev: revealed ? ev : undefined,
        cursed: revealed && ev < 0,
        path,
        reviewedAt: s.reviewed_at,
      }
    })
}

// ── 賽季 §4.14 ─────────────────────────────────────────

export interface Season {
  id: string
  name: string
  dayIndex: number
  daysLeft: number
  /** 本季每筆平倉的 R（時間順序） */
  rs: number[]
  totalR: number
  maxDrawdownPct: number | null
  disciplineScore: number | null
  tradeCount: number
}

export function seasonOf(tl: Timeline, startingEquity: number | null, month: string, now: Date): Season {
  const { start, end } = monthBounds(month)
  const closes = tl.closes.filter((e) => inMonth(e.trade.closed_at!, month))
  const rs = closes.map((e) => e.r!)
  const scores = scored(closes).map((e) => e.score!)
  const upTo = Math.min(now.getTime(), end - 1)
  const days = Math.round((end - start) / DAY_MS)
  const dayIndex = Math.min(days, Math.floor((upTo - start) / DAY_MS) + 1)
  return {
    id: month,
    name: `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]}賽季`,
    dayIndex,
    daysLeft: days - dayIndex,
    rs,
    totalR: round2(rs.reduce((a, b) => a + b, 0)),
    maxDrawdownPct: maxDrawdownPct(tl.curve, startingEquity, start, upTo),
    disciplineScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    tradeCount: closes.length,
  }
}

export interface SeasonRecap {
  season: Season
  best: TradeEval | null
  worst: TradeEval | null
  boss: Boss | null
  attributes: Attributes | null
  /** 與再上一季相比的屬性變化 */
  attributeDelta: { key: AttributeKey; delta: number }[] | null
}

/** 上一季的回顧卡；上一季沒有交易時為 null */
export function lastSeasonRecap(tl: Timeline, startingEquity: number | null, now: Date): SeasonRecap | null {
  const month = prevMonth(monthKey(now))
  const closes = tl.closes.filter((e) => inMonth(e.trade.closed_at!, month))
  if (!closes.length) return null
  const sorted = [...closes].sort((a, b) => a.r! - b.r!)
  const attrs = attributesOf(closes)
  const before = attributesOf(tl.closes.filter((e) => inMonth(e.trade.closed_at!, prevMonth(month))))
  return {
    season: seasonOf(tl, startingEquity, month, now),
    best: sorted[sorted.length - 1],
    worst: sorted[0],
    boss: bossOf(tl, month),
    attributes: attrs,
    attributeDelta:
      attrs && before ? attrs.values.map((v, i) => ({ key: v.key, delta: v.value - before.values[i].value })) : null,
  }
}

// ── 經驗值與等級 §4.9 ──────────────────────────────────

export interface Profile {
  level: number
  xp: number
  xpToNext: number
  totalXp: number
  title: string
  levelTitle: string
  titles: string[]
  className: ClassName | null
}

export function levelFromXp(total: number): { level: number; xp: number; xpToNext: number } {
  let level = 1
  let xp = total
  while (xp >= xpToNext(level)) {
    xp -= xpToNext(level)
    level += 1
  }
  return { level, xp, xpToNext: xpToNext(level) }
}

/** 交易本身給的經驗值：作戰卡、復盤、評級。盈虧不給任何經驗值。 */
export function tradeXp(e: TradeEval, images: ImageMeta[]): number {
  if (!e.trade.gamified) return 0
  let xp = e.cardBefore ? XP_CARD_BEFORE : e.cardAfter ? XP_CARD_AFTER : 0
  if (e.reviewedIn24h) {
    xp += XP_REVIEW
    if (images.some((i) => i.trade_id === e.trade.id && hasText(i.caption))) xp += XP_REVIEW_ANNOTATED
  }
  if (e.grade && !e.provisional) xp += XP_BY_GRADE[e.grade]
  return xp
}

export function profileOf(args: {
  tl: Timeline
  images: ImageMeta[]
  questXp: number
  achievements: Set<AchievementId>
  bossesDefeated: number
  seasonCloses: TradeEval[]
  displayTitle: string | null
}): Profile {
  const { tl, images, achievements, bossesDefeated } = args
  const total =
    tl.evals.reduce((s, e) => s + tradeXp(e, images), 0) +
    args.questXp +
    achievements.size * XP_ACHIEVEMENT +
    bossesDefeated * BOSS_REWARD_XP
  const lv = levelFromXp(total)
  const titles = [
    ...(bossesDefeated ? [BOSS_REWARD_TITLE] : []),
    ...ACHIEVEMENTS.filter((a) => achievements.has(a.id)).map((a) => a.name),
  ]
  const lt = levelTitle(lv.level)
  return {
    ...lv,
    totalXp: total,
    levelTitle: lt,
    titles,
    title: args.displayTitle && titles.includes(args.displayTitle) ? args.displayTitle : lt,
    className: classOf(args.seasonCloses),
  }
}

export { monthBounds }
