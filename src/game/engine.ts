/**
 * 遊戲化引擎入口（SPEC §5）：輸入交易紀錄與筆記，輸出首頁需要的全部推導值。
 * UI 只讀這裡的結果，不自己算規則。
 */
import type { DailyNote, Setup, Trade } from '../lib/types'
import { buildTimeline, dailyHp, dayKey, monthKey, type TierState, type Timeline, type TradeEval } from './evaluate'
import {
  achievementsOf,
  activeDebuffs,
  attributesOf,
  bossOf,
  currentQuests,
  defeatedBosses,
  lastSeasonRecap,
  profileOf,
  questXp,
  seasonOf,
  setupDex,
  streakDays,
  type Attributes,
  type Boss,
  type Debuff,
  type DexCard,
  type ImageMeta,
  type Profile,
  type Quest,
  type Season,
  type SeasonRecap,
} from './progress'
import { hpHint, hpLabel, type AchievementId } from './rules'

export interface EngineInput {
  trades: Trade[]
  images: ImageMeta[]
  notes: DailyNote[]
  setups: Setup[]
  startingEquity: number | null
  displayTitle: string | null
  now: Date
}

export interface GameState {
  profile: Profile
  tier: TierState
  daily: { hp: number; hpLabel: string; hpHint: string; tradeCount: number; totalR: number }
  debuffs: Debuff[]
  attributes: Attributes | null
  boss: Boss | null
  quests: Quest[]
  streak: number
  recentTrades: TradeEval[]
  setupDex: DexCard[]
  season: Season
  recap: SeasonRecap | null
  achievements: Set<AchievementId>
  timeline: Timeline
  /** 目前權益：起始權益＋累計損益；沒設起始權益時為 null */
  equity: number | null
}

export function computeGameState(input: EngineInput): GameState {
  const { trades, images, notes, setups, startingEquity, now } = input
  const tl = buildTimeline(trades, startingEquity, now)
  const month = monthKey(now)
  const today = dayKey(now)
  const seasonCloses = tl.closes.filter((e) => monthKey(e.trade.closed_at!) === month)

  const hp = dailyHp(tl, now)
  const todayCloses = tl.closes.filter((e) => dayKey(e.trade.closed_at!) === today)
  const achievements = achievementsOf(tl, notes, startingEquity, now)
  const qInputs = { tl, notes, images, setups }

  return {
    profile: profileOf({
      tl,
      images,
      questXp: questXp(qInputs),
      achievements,
      bossesDefeated: defeatedBosses(tl, now).length,
      seasonCloses,
      displayTitle: input.displayTitle,
    }),
    tier: tl.tier,
    daily: {
      hp,
      hpLabel: hpLabel(hp),
      hpHint: hpHint(hp),
      tradeCount: tl.evals.filter((e) => dayKey(e.trade.opened_at) === today).length,
      totalR: Math.round(todayCloses.reduce((s, e) => s + e.r!, 0) * 100) / 100,
    },
    debuffs: activeDebuffs(tl, now),
    attributes: attributesOf(seasonCloses),
    boss: bossOf(tl, month),
    quests: currentQuests(qInputs, now),
    streak: streakDays(tl, notes, now),
    recentTrades: [...tl.closes].reverse().slice(0, 4),
    setupDex: setupDex(tl, setups),
    season: seasonOf(tl, startingEquity, month, now),
    recap: lastSeasonRecap(tl, startingEquity, now),
    achievements,
    timeline: tl,
    equity: startingEquity === null ? null : startingEquity + tl.closes.reduce((s, e) => s + (e.pnl ?? 0), 0),
  }
}
