import { describe, expect, test } from 'vitest'
import { computeGameState } from '../src/game/engine'
import { smoothCumR } from '../src/game/equityLine'
import { buildTimeline, dailyHp, downgrade, gradeOf, quadrantOf } from '../src/game/evaluate'
import { activeDebuffs, attributesOf, bossOf, classOf, levelFromXp, setupDex } from '../src/game/progress'
import { xpToNext } from '../src/game/rules'
import { isAgainstMove, movedStopAgainst } from '../src/lib/trade'
import type { Trade } from '../src/lib/types'
import { add, g } from './helpers'

const NOW = new Date('2026-10-06T08:00:00Z') // 台北 10/06 16:00
const T = (trades: Trade[], now = NOW, equity: number | null = 10000) => buildTimeline(trades, equity, now)
const evalOf = (trades: Trade[], id: string, now = NOW) => T(trades, now).byId.get(id)!

describe('精神力 §4.4', () => {
  test('兩筆交易、其中一筆 −1R → 70', () => {
    const trades = [g({ opened: '2026-10-06T01:00:00Z', r: 1.5 }), g({ opened: '2026-10-06T03:00:00Z', r: -1 })]
    expect(dailyHp(T(trades), NOW)).toBe(70)
  })
  test('連續第二筆虧損的扣分加倍', () => {
    const trades = [g({ opened: '2026-10-06T01:00:00Z', r: -1 }), g({ opened: '2026-10-06T03:00:00Z', r: -1 })]
    // 100 − 10 − 10（開兩筆）− 10（第一筆虧損）− 20（連虧第二筆加倍）
    expect(dailyHp(T(trades), NOW)).toBe(50)
  })
  test('最低為 0', () => {
    const trades = Array.from({ length: 5 }, (_, i) => g({ opened: add('2026-10-06T00:00:00Z', i * 70), r: -2 }))
    expect(dailyHp(T(trades), NOW)).toBe(0)
  })
  test('昨天的交易不影響今天', () => {
    expect(dailyHp(T([g({ opened: '2026-10-05T01:00:00Z', r: -3 })]), NOW)).toBe(100)
  })
})

describe('評分 §4.2', () => {
  test('五項全滿 → 100、S', () => {
    const t = g()
    const e = evalOf([t], t.id)
    expect(e.score).toBe(100)
    expect(e.grade).toBe('S')
    expect(e.provisional).toBe(false)
  })
  test('沒有作戰卡 → 80、A', () => {
    const t = g({ card_at: null })
    const e = evalOf([t], t.id)
    expect(e.items!.card).toBe(0)
    expect(e.score).toBe(80)
    expect(e.violations).toContain('no_card')
  })
  test('進場後才補卡：評分仍視為沒有作戰卡', () => {
    const t = g({ card_at: '2026-10-06T01:30:00Z' })
    const e = evalOf([t], t.id)
    expect(e.cardBefore).toBe(false)
    expect(e.cardAfter).toBe(true)
    expect(e.items!.card).toBe(0)
  })
  test('風險部分給分：≤ 上限 20、≤ 1.25 倍 10、超過 0', () => {
    expect(evalOf([g({ id: 'a', risk_usdt: 50 })], 'a').items!.risk).toBe(20)
    expect(evalOf([g({ id: 'b', risk_usdt: 62.5 })], 'b').items!.risk).toBe(10)
    expect(evalOf([g({ id: 'c', risk_usdt: 63 })], 'c').items!.risk).toBe(0)
  })
  test('逆向移動止損 → 該項 0 分', () => {
    const t = g({ stop_edits: [{ at: '2026-10-06T01:20:00Z', from: 95, to: 93 }] })
    expect(evalOf([t], t.id).items!.stopMove).toBe(0)
  })
  test('復盤：24 小時內 20、72 小時內 10、超過 0', () => {
    const closed = '2026-10-06T02:00:00Z'
    expect(evalOf([g({ id: 'a', reviewed_at: add(closed, 24 * 60) })], 'a').items!.review).toBe(20)
    expect(evalOf([g({ id: 'b', reviewed_at: add(closed, 48 * 60) })], 'b').items!.review).toBe(10)
    const late = new Date('2026-10-12T00:00:00Z')
    expect(evalOf([g({ id: 'c', reviewed_at: add(closed, 80 * 60) })], 'c', late).items!.review).toBe(0)
  })
  test('尚未復盤：標為暫定', () => {
    const t = g({ reviewed_at: null })
    const e = evalOf([t], t.id)
    expect(e.provisional).toBe(true)
    expect(e.score).toBe(80)
  })
  test('超過 72 小時還沒復盤：不再是暫定', () => {
    const t = g({ reviewed_at: null })
    expect(evalOf([t], t.id, new Date('2026-10-10T00:00:00Z')).provisional).toBe(false)
  })
  test('上頭違規：分數上限 74', () => {
    const loss = g({ id: 'loss', opened: '2026-10-06T00:00:00Z', holdMin: 30, r: -1 })
    const tilt = g({ id: 'tilt', opened: '2026-10-06T00:40:00Z' }) // 虧損平倉後 10 分鐘
    const e = evalOf([loss, tilt], 'tilt')
    expect(e.violations).toContain('tilt')
    expect(e.score).toBe(74)
    expect(e.grade).toBe('B')
  })
  test('冷卻剛好 15 分鐘仍算上頭，16 分鐘不算', () => {
    const loss = g({ id: 'loss', opened: '2026-10-06T00:00:00Z', holdMin: 30, r: -1 })
    expect(evalOf([loss, g({ id: 'x', opened: '2026-10-06T00:45:00Z' })], 'x').violations).toContain('tilt')
    expect(evalOf([loss, g({ id: 'y', opened: '2026-10-06T00:46:00Z' })], 'y').violations).not.toContain('tilt')
  })
  test('精神力已歸零後開的單：評級降一級', () => {
    const losses = Array.from({ length: 4 }, (_, i) => g({ opened: add('2026-10-06T00:00:00Z', i * 40), holdMin: 10, r: -2 }))
    const last = g({ id: 'last', opened: '2026-10-06T04:00:00Z' })
    const e = evalOf([...losses, last], 'last')
    expect(e.hpAtOpen).toBe(0)
    expect(e.score).toBe(100)
    expect(e.grade).toBe('A')
  })
  test('評級門檻', () => {
    expect([90, 89, 75, 74, 65, 64, 50, 49].map(gradeOf)).toEqual(['S', 'A', 'A', 'B', 'B', 'C', 'C', 'D'])
    expect(downgrade('D')).toBe('D')
  })
  test('舊資料不評分', () => {
    const t = g({ gamified: false })
    const e = evalOf([t], t.id)
    expect(e.score).toBeNull()
    expect(e.violations).toEqual([])
    expect(e.r).toBe(1)
  })
})

describe('四象限 §4.3', () => {
  test('R = 0 算虧損那邊', () => expect(quadrantOf(0, 90)).toBe('good_loss'))
  test('評分剛好 75 算守紀律', () => expect(quadrantOf(1, 75)).toBe('good_win'))
  test('74 分的獲利是運氣好的壞交易', () => expect(quadrantOf(1, 74)).toBe('lucky_bad'))
  test('違規虧損', () => expect(quadrantOf(-1, 50)).toBe('bad_loss'))
  test('運氣好的壞交易寫出扣分最多的一項', () => {
    const t = g({ card_at: null, risk_usdt: 70, r: 2 }) // 沒卡 −20、超風險 −20
    const e = evalOf([t], t.id)
    expect(e.quadrant).toBe('lucky_bad')
    expect(e.mainViolation).toBe('沒有作戰卡就進場，這筆賺的不是你的優勢')
  })
})

describe('逆向移動止損 §4.2', () => {
  test('做多往下移才算', () => {
    expect(isAgainstMove('long', 95, 94)).toBe(true)
    expect(isAgainstMove('long', 95, 100)).toBe(false)
  })
  test('做空往上移才算', () => {
    expect(isAgainstMove('short', 105, 106)).toBe(true)
    expect(isAgainstMove('short', 105, 100)).toBe(false)
  })
  test('移到保本不算', () => {
    const t = g({ stop_edits: [{ at: '2026-10-06T01:20:00Z', from: 95, to: 100 }] })
    expect(movedStopAgainst(t)).toBe(false)
  })
  test('移遠又移回來，仍然算', () => {
    const t = g({
      stop_edits: [
        { at: '2026-10-06T01:10:00Z', from: 95, to: 93 },
        { at: '2026-10-06T01:20:00Z', from: 93, to: 95 },
      ],
    })
    expect(movedStopAgainst(t)).toBe(true)
  })
  test('舊資料沒有紀錄時比較最後止損', () => {
    expect(movedStopAgainst(g({ final_stop: 94 }))).toBe(true)
    expect(movedStopAgainst(g({ final_stop: 95 }))).toBe(false)
  })
})

describe('倉位階級 §4.6', () => {
  /** n 筆 S 級交易，每筆間隔 2 小時 */
  const goodRun = (n: number, start = '2026-10-01T00:00:00Z', risk = 50) =>
    Array.from({ length: n }, (_, i) => g({ opened: add(start, i * 120), holdMin: 30, r: 1, risk_usdt: risk }))
  const late = new Date('2026-10-30T00:00:00Z')

  test('預設見習 0.5%', () => {
    const tier = T([], late).tier
    expect(tier).toMatchObject({ level: 1, name: '見習', capPct: 0.5, progress: 0, progressTarget: 30 })
  })
  test('29 筆 A 以上還是見習', () => expect(T(goodRun(29), late).tier.progress).toBe(29))
  test('30 筆 A 以上晉升正式，計數歸零', () => {
    expect(T(goodRun(30), late).tier).toMatchObject({ level: 2, capPct: 1, progress: 0, progressTarget: 50 })
  })
  test('上頭違規：降一階、計數歸零', () => {
    const run = goodRun(32)
    const last = run[run.length - 1]
    const loss = g({ opened: add(last.closed_at!, 60), holdMin: 10, r: -1, risk_usdt: 50 })
    const tilt = g({ opened: add(loss.closed_at!, 5), holdMin: 10, r: 1, risk_usdt: 50 })
    expect(T([...run, loss, tilt], late).tier).toMatchObject({ level: 1, progress: 0 })
  })
  test('升老手需要回撤 < 8%', () => {
    // 先升正式（30 筆），再 50 筆 A；中間一筆大虧讓本季回撤超過 8%
    const first = goodRun(30, '2026-10-01T00:00:00Z')
    const crash = g({ opened: '2026-10-04T12:00:00Z', holdMin: 10, r: -1, pnl_usdt: -2000 })
    const second = goodRun(50, '2026-10-05T00:00:00Z', 100)
    const tl = T([...first, crash, ...second], late)
    expect(tl.tier.level).toBe(2)
    expect(tl.tier.ddOk).toBe(false)
    expect(T([...first, ...second], late).tier.level).toBe(3)
  })
})

describe('經驗值與等級 §4.9', () => {
  test('Lv.12 升級需要 3,000', () => expect(xpToNext(12)).toBe(3000))
  test('累積經驗值換算等級', () => {
    const toLv12 = Array.from({ length: 11 }, (_, i) => xpToNext(i + 1)).reduce((a, b) => a + b, 0)
    expect(levelFromXp(toLv12)).toEqual({ level: 12, xp: 0, xpToNext: 3000 })
    expect(levelFromXp(toLv12 - 1).level).toBe(11)
  })
  test('盈虧不影響經驗值', () => {
    const base = { opened: '2026-10-06T01:00:00Z' }
    const win = computeGameState({ trades: [g({ ...base, r: 3 })], images: [], notes: [], setups: [], startingEquity: 10000, displayTitle: null, now: NOW })
    const loss = computeGameState({ trades: [g({ ...base, r: -1 })], images: [], notes: [], setups: [], startingEquity: 10000, displayTitle: null, now: NOW })
    expect(win.profile.totalXp).toBe(loss.profile.totalXp)
  })
})

describe('心魔 §4.10', () => {
  const sep = (i: number, v: Partial<Trade> = {}) => g({ opened: add('2026-09-10T00:00:00Z', i * 120), holdMin: 30, ...v })
  const oct = (i: number, v: Partial<Trade> = {}) => g({ opened: add('2026-10-02T00:00:00Z', i * 120), holdMin: 30, ...v })
  const moved = { stop_edits: [{ at: '2026-01-01T00:00:00Z', from: 95, to: 93 }] }

  test('上個月沒有違規 → 本月無心魔', () => expect(bossOf(T([sep(0)]), '2026-10')).toBeNull())
  test('挑上個月最多的違規', () => {
    const boss = bossOf(T([sep(0, moved), sep(1, moved), sep(2, { card_at: null })]), '2026-10')!
    expect(boss.name).toBe('移動止損者')
    expect(boss.hp).toBe(30)
  })
  test('沒犯的交易扣一滴血，犯一次回滿', () => {
    const base = [sep(0, moved)]
    expect(bossOf(T([...base, oct(0), oct(1), oct(2)]), '2026-10')!.hp).toBe(27)
    expect(bossOf(T([...base, oct(0), oct(1), oct(2, moved), oct(3)]), '2026-10')!.hp).toBe(29)
  })
  test('連續 30 筆沒犯 → 擊敗', () => {
    const boss = bossOf(T([sep(0, moved), ...Array.from({ length: 30 }, (_, i) => oct(i))]), '2026-10')!
    expect(boss.hp).toBe(0)
    expect(boss.defeated).toBe(true)
  })
})

describe('狀態異常 §4.5', () => {
  test('虧損平倉 2 分 30 秒後：冷卻剩 12:30', () => {
    const loss = g({ opened: '2026-10-06T07:00:00Z', holdMin: 30, r: -1 })
    const now = new Date(Date.parse(loss.closed_at!) + 150_000)
    const d = activeDebuffs(T([loss], now), now).find((x) => x.kind === 'cooldown')!
    expect(Date.parse(d.endsAt) - now.getTime()).toBe(12.5 * 60_000)
  })
  test('15 分鐘後冷卻消失', () => {
    const loss = g({ opened: '2026-10-06T07:00:00Z', holdMin: 30, r: -1 })
    const now = new Date(Date.parse(loss.closed_at!) + 15 * 60_000)
    expect(activeDebuffs(T([loss], now), now).find((x) => x.kind === 'cooldown')).toBeUndefined()
  })
  test('報復：虧損後下一筆風險 > 1.2 倍', () => {
    const loss = g({ id: 'l', opened: '2026-10-06T00:00:00Z', holdMin: 30, r: -1, risk_usdt: 50 })
    const big = g({ id: 'b', opened: '2026-10-06T02:00:00Z', risk_usdt: 61 })
    const same = g({ id: 's', opened: '2026-10-06T02:00:00Z', risk_usdt: 60 })
    expect(evalOf([loss, big], 'b').violations).toContain('revenge')
    expect(evalOf([loss, same], 's').violations).not.toContain('revenge')
  })
  test('過度自信：連贏 3 筆後風險 > 前 3 筆平均 1.2 倍', () => {
    const wins = [0, 1, 2].map((i) => g({ opened: add('2026-10-06T00:00:00Z', i * 40), holdMin: 20, r: 1, risk_usdt: 40 }))
    const big = g({ id: 'b', opened: '2026-10-06T03:00:00Z', risk_usdt: 49 })
    expect(evalOf([...wins, big], 'b').violations).toContain('overconfidence')
  })
  test('疲勞：台北 02:00–06:00 開單，或當天第 6 筆', () => {
    expect(evalOf([g({ id: 'n', opened: '2026-10-05T19:30:00Z' })], 'n').violations).toContain('fatigue') // 台北 03:30
    const six = Array.from({ length: 6 }, (_, i) => g({ id: `d${i}`, opened: add('2026-10-06T00:00:00Z', i * 30), holdMin: 10 }))
    expect(evalOf(six, 'd4').violations).not.toContain('fatigue')
    expect(evalOf(six, 'd5').violations).toContain('fatigue')
  })
})

describe('屬性與職業 §4.7–4.8', () => {
  test('少於 5 筆不顯示', () => expect(attributesOf(T([g(), g(), g(), g()]).closes)).toBeNull())
  test('最弱項與建議', () => {
    const trades = Array.from({ length: 5 }, (_, i) => g({ opened: add('2026-10-06T00:00:00Z', i * 70), holdMin: 30, reviewed_at: null }))
    const a = attributesOf(T(trades).closes)!
    expect(a.weakest).toBe('復盤')
    expect(a.advice).toBe('今天平倉的單，睡前寫完復盤')
  })
  test('持倉中位數 < 1 小時是刺客型', () => {
    const trades = Array.from({ length: 10 }, (_, i) => g({ opened: add('2026-10-06T00:00:00Z', i * 60), holdMin: 30 }))
    expect(classOf(T(trades).closes)).toBe('刺客型')
  })
  test('低勝率高賠率是狙擊手型', () => {
    const trades = Array.from({ length: 10 }, (_, i) =>
      g({ opened: add('2026-10-01T00:00:00Z', i * 300), holdMin: 240, r: i < 3 ? 3 : -1 }),
    )
    expect(classOf(T(trades).closes)).toBe('狙擊手型')
  })
})

describe('圖鑑 §4.12', () => {
  const setup = { id: 's1', user_id: 'u1', name: '假突破', archived: false, sort_order: 0, reviewed_at: null }
  test('未滿 20 筆不揭曉', () => {
    const card = setupDex(T([g({ setup_id: 's1' })]), [setup])[0]
    expect(card).toMatchObject({ n: 1, revealed: false, cursed: false })
    expect(card.ev).toBeUndefined()
  })
  test('滿 20 筆且期望值 < 0 是詛咒卡', () => {
    const trades = Array.from({ length: 20 }, (_, i) => g({ setup_id: 's1', opened: add('2026-10-01T00:00:00Z', i * 60), holdMin: 30, r: i < 5 ? 1 : -1 }))
    expect(setupDex(T(trades), [setup])[0]).toMatchObject({ revealed: true, cursed: true, ev: -0.5, winRate: 0.25 })
  })
})

describe('前山 §3', () => {
  test('平滑後最後一點等於真實累積 R', () => {
    const { cum, smooth } = smoothCumR([0.8, -1, 1.8, -1, 2.1])
    expect(smooth[smooth.length - 1]).toBeCloseTo(cum[cum.length - 1])
    expect(smooth[1]).toBeCloseTo(0.44)
  })
})
