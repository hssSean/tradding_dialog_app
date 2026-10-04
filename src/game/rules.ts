/** 遊戲化規則的所有數值與文字（SPEC §4）。改數值只改這裡。 */

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D'
export type Quadrant = 'good_win' | 'good_loss' | 'lucky_bad' | 'bad_loss'
export type Violation = 'stop_against' | 'no_card' | 'over_risk' | 'tilt' | 'revenge' | 'overconfidence' | 'fatigue'
export type DebuffKind = 'cooldown' | 'revenge' | 'overconfidence' | 'fomo' | 'fatigue'
export type AttributeKey = '風控' | '復盤' | '執行力' | '耐心' | '情緒控管'
export type ClassName = '刺客型' | '遊俠型' | '狙擊手型'
export type ScoreItem = 'card' | 'stop' | 'risk' | 'stopMove' | 'review'

// ── 評分 §4.2 ──────────────────────────────────────────
export const ITEM_MAX = 20
export const RISK_HALF_RATIO = 1.25
export const REVIEW_FULL_MS = 24 * 3600_000
export const REVIEW_HALF_MS = 72 * 3600_000
export const TILT_SCORE_CAP = 74
export const GRADE_THRESHOLDS: [Grade, number][] = [
  ['S', 90],
  ['A', 75],
  ['B', 65],
  ['C', 50],
  ['D', 0],
]
export const DISCIPLINED_SCORE = 75

export const QUADRANT_LABELS: Record<Quadrant, string> = {
  good_win: '好的獲利',
  good_loss: '好的虧損',
  lucky_bad: '運氣好的壞交易',
  bad_loss: '壞的虧損',
}

/** 「運氣好的壞交易」下方那行：扣分最多的項目 */
export const ITEM_MESSAGES: Record<ScoreItem, string> = {
  card: '沒有作戰卡就進場，這筆賺的不是你的優勢',
  stop: '沒有初始止損，這筆賺的是運氣',
  risk: '風險超過上限，賺到的是放大的運氣',
  stopMove: '把止損往不利方向移，這筆賺的是運氣',
  review: '沒有及時復盤，賺了也學不到東西',
}
export const TILT_MESSAGE = '冷卻期間開單，上頭的單賺了也不算數'

// ── 精神力 §4.4 ────────────────────────────────────────
export const HP_MAX = 100
export const HP_PER_OPEN = 10
export const HP_PER_LOSS_R = 10
export function hpLabel(hp: number): string {
  if (hp >= 60) return '穩定'
  if (hp >= 30) return '注意疲勞'
  if (hp >= 1) return '瀕臨休兵'
  return '今日休兵'
}
export function hpHint(hp: number): string {
  if (hp >= 60) return '月盈則穩'
  if (hp >= 30) return '下一張作戰卡需二次確認'
  if (hp >= 1) return '建議今天到此為止'
  return '之後的交易評級降一級'
}

// ── 狀態異常 §4.5 ──────────────────────────────────────
export const COOLDOWN_MS = 15 * 60_000
export const DEBUFF_MS = 60 * 60_000
export const SIZE_UP_RATIO = 1.2
export const OVERCONFIDENCE_STREAK = 3
export const FATIGUE_HOURS = [2, 6] as const // 台北 02:00–05:59
export const FATIGUE_NTH_TRADE = 6

export const DEBUFF_NAMES: Record<DebuffKind, string> = {
  cooldown: '上頭',
  revenge: '報復',
  overconfidence: '過度自信',
  fomo: 'FOMO',
  fatigue: '疲勞',
}

// ── 違規與心魔 §4.10 ───────────────────────────────────
/** 順序也是心魔同票時的優先序 */
export const VIOLATIONS: Violation[] = ['stop_against', 'no_card', 'over_risk', 'tilt', 'revenge', 'overconfidence', 'fatigue']
export const VIOLATION_LABELS: Record<Violation, string> = {
  stop_against: '逆向移動止損',
  no_card: '無作戰卡',
  over_risk: '超風險',
  tilt: '上頭',
  revenge: '報復',
  overconfidence: '過度自信',
  fatigue: '疲勞',
}
export const BOSS_NAMES: Record<Violation, string> = {
  stop_against: '移動止損者',
  no_card: '衝動者',
  over_risk: '重倉者',
  tilt: '上頭者',
  revenge: '報復者',
  overconfidence: '自滿者',
  fatigue: '夜行者',
}
export const BOSS_DESCRIPTIONS: Record<Violation, string> = {
  stop_against: '沒把止損往不利方向移',
  no_card: '進場前都有立作戰卡',
  over_risk: '風險都在上限內',
  tilt: '虧損後都等完冷卻才開單',
  revenge: '虧損後沒有加大倉位',
  overconfidence: '連贏後沒有加大倉位',
  fatigue: '沒在深夜或疲勞時開單',
}
export const BOSS_HP = 30
export const BOSS_REWARD_TITLE = '鐵律武士'
export const BOSS_REWARD_XP = 300

// ── 倉位階級 §4.6 ──────────────────────────────────────
export interface TierDef {
  level: 1 | 2 | 3
  name: string
  capPct: number
  /** 升到下一階需要的 A 以上筆數 */
  promoteAt: number | null
}
export const TIERS: TierDef[] = [
  { level: 1, name: '見習', capPct: 0.5, promoteAt: 30 },
  { level: 2, name: '正式', capPct: 1.0, promoteAt: 50 },
  { level: 3, name: '老手', capPct: 1.5, promoteAt: null },
]
export const VETERAN_MAX_DD_PCT = 8

// ── 屬性 §4.7、職業 §4.8 ───────────────────────────────
export const ATTRIBUTE_MIN_TRADES = 5
export const ATTRIBUTE_ADVICE: Record<AttributeKey, string> = {
  風控: '下一筆進場前先把止損填進作戰卡',
  復盤: '今天平倉的單，睡前寫完復盤',
  執行力: '這週不要動止損，只允許往有利方向移',
  耐心: '沒有作戰卡就不進場',
  情緒控管: '連虧 2 筆後離開螢幕 30 分鐘',
}
export const CLASS_MIN_TRADES = 10
export const CLASS_DESCRIPTIONS: Record<ClassName, string> = {
  刺客型: '剝頭皮',
  遊俠型: '波段交易者',
  狙擊手型: '低勝率高賠率',
}

// ── 經驗值與等級 §4.9 ──────────────────────────────────
export const XP_CARD_BEFORE = 20
export const XP_CARD_AFTER = 10
export const XP_REVIEW = 20
export const XP_REVIEW_ANNOTATED = 10
export const XP_BY_GRADE: Record<Grade, number> = { S: 40, A: 30, B: 15, C: 5, D: 0 }
/** SPEC 沒寫數字，暫定 */
export const XP_ACHIEVEMENT = 100
export const xpToNext = (level: number) => 250 * level
export function levelTitle(level: number): string {
  if (level >= 30) return '冷血獵人'
  if (level >= 15) return '冷靜之手'
  if (level >= 6) return '紀律學徒'
  return '見習交易員'
}

// ── 功課 §4.11 ─────────────────────────────────────────
export const QUEST_XP = { marketView: 30, reviewToday: 40, annotate: 80, weeklyMistake: 60, dexCheck: 100 }
export const ANNOTATE_TARGET = 3

// ── 圖鑑 §4.12 ─────────────────────────────────────────
export const DEX_REVEAL_N = 20

// ── 成就 §4.13 ─────────────────────────────────────────
export type AchievementId = 'iron' | 'empty_hand' | 'know_stop' | 'historian' | 'diarist' | 'phoenix' | 'zen'
export const ACHIEVEMENTS: { id: AchievementId; name: string; condition: string; hidden: boolean }[] = [
  { id: 'iron', name: '鐵律', condition: '連續 50 筆沒有逆向移動止損', hidden: false },
  { id: 'empty_hand', name: '空手也是倉位', condition: '整週零交易，但每天都寫了市場觀察', hidden: false },
  { id: 'know_stop', name: '懂得收手', condition: '連虧 3 筆後當天沒有再開單', hidden: false },
  { id: 'historian', name: '史官', condition: '累積 100 篇復盤', hidden: false },
  { id: 'diarist', name: '日誌控', condition: '連續 20 筆都有作戰卡', hidden: false },
  { id: 'phoenix', name: '浴火重生', condition: '回撤超過 5% 後回到前高，期間沒有任何上頭違規', hidden: true },
  { id: 'zen', name: '佛系', condition: '連續 10 筆情緒評分都是 3', hidden: true },
]

export const MONTH_NAMES = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']
