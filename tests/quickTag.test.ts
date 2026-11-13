import { describe, expect, it } from 'vitest'
import { closeTagPatch, INBOX_DAYS, needsTag, openTagPatch, untaggedOpen } from '../src/lib/quickTag'
import type { BxOpenPosition } from '../src/notify/events'
import { mk } from './helpers'

const NOW = '2026-11-13T10:00:00Z'
const nowMs = Date.parse(NOW)

describe('openTagPatch', () => {
  it('臨時起意加 unplanned，理由去空白，card_at 沒有就用現在', () => {
    expect(openTagPatch({ setup_id: 's1', planned: false, reason: '  破前高 ' }, [], NOW, null)).toEqual({
      setup_id: 's1',
      entry_reason: '破前高',
      mistake_tags: ['unplanned'],
      card_at: NOW,
    })
  })
  it('照計畫拿掉舊的 unplanned，保留其他標籤；空理由 → null；card_at 保留既有', () => {
    expect(openTagPatch({ setup_id: null, planned: true, reason: ' ' }, ['unplanned', 'chasing'], NOW, '2026-11-13T01:00:00Z')).toEqual({
      setup_id: null,
      entry_reason: null,
      mistake_tags: ['chasing'],
      card_at: '2026-11-13T01:00:00Z',
    })
  })
  it('unplanned 不重複', () => {
    expect(openTagPatch({ setup_id: null, planned: false, reason: '' }, ['unplanned'], NOW, null).mistake_tags).toEqual(['unplanned'])
  })
})

describe('closeTagPatch', () => {
  const t = mk({ gamified: true, source: 'bingx', mistake_tags: ['early_exit'], note: '舊的', card_at: '2026-11-13T01:00:00Z' })
  it('照計畫拿掉 early_exit／late_exit，沒追價拿掉 chasing；空 note 不覆蓋；reviewed_at 用現在', () => {
    const p = closeTagPatch({ ...t, mistake_tags: ['early_exit', 'chasing', 'unplanned'] }, { exit: 'plan', chased: false, note: '' }, null, NOW)
    expect(p).toEqual({ mistake_tags: ['unplanned'], reviewed_at: NOW })
  })
  it('抱太久加 late_exit 並拿掉 early_exit；追價加 chasing；有 note 就寫', () => {
    const p = closeTagPatch(t, { exit: 'late', chased: true, note: ' 太貪 ' }, null, NOW)
    expect(p.mistake_tags).toEqual(['late_exit', 'chasing'])
    expect(p.note).toBe('太貪')
  })
  it('提前跑加 early_exit', () => {
    expect(closeTagPatch({ ...t, mistake_tags: [] }, { exit: 'early', chased: false, note: '' }, null, NOW).mistake_tags).toEqual(['early_exit'])
  })
  it('reviewed_at 已有就保留', () => {
    expect(closeTagPatch({ ...t, reviewed_at: '2026-11-12T00:00:00Z' }, { exit: 'plan', chased: false, note: '' }, null, NOW).reviewed_at).toBe('2026-11-12T00:00:00Z')
  })
  it('開倉沒標過：一起寫入 setup、理由、card_at', () => {
    const p = closeTagPatch({ ...t, card_at: null, mistake_tags: [] }, { exit: 'plan', chased: false, note: '' }, { setup_id: 's2', planned: false, reason: '' }, NOW)
    expect(p).toMatchObject({ setup_id: 's2', entry_reason: null, card_at: NOW, mistake_tags: ['unplanned'], reviewed_at: NOW })
  })
})

describe('needsTag', () => {
  const base = { gamified: true, source: 'bingx' as const, opened_at: '2026-11-12T01:00:00Z', closed_at: '2026-11-12T03:00:00Z' }
  it('最近平倉、沒檢討 → 要標', () => {
    expect(needsTag(mk({ ...base, reviewed_at: null, card_at: NOW }), nowMs)).toBe(true)
  })
  it('沒作戰卡也要標', () => {
    expect(needsTag(mk({ ...base, reviewed_at: NOW, card_at: null }), nowMs)).toBe(true)
  })
  it('都標了、手動紀錄、舊資料、放棄、超過 7 天 → 不用', () => {
    expect(needsTag(mk({ ...base, reviewed_at: NOW, card_at: NOW }), nowMs)).toBe(false)
    expect(needsTag(mk({ ...base, source: 'manual', reviewed_at: null }), nowMs)).toBe(false)
    expect(needsTag(mk({ ...base, gamified: false, reviewed_at: null }), nowMs)).toBe(false)
    expect(needsTag(mk({ ...base, abandoned_at: NOW, reviewed_at: null }), nowMs)).toBe(false)
    const old = new Date(nowMs - INBOX_DAYS * 86_400_000 - 1).toISOString()
    expect(needsTag(mk({ ...base, closed_at: old, reviewed_at: null }), nowMs)).toBe(false)
  })
  it('持倉中：沒作戰卡才要標', () => {
    expect(needsTag(mk({ ...base, closed_at: null, exit_price: null, card_at: null }), nowMs)).toBe(true)
    expect(needsTag(mk({ ...base, closed_at: null, exit_price: null, card_at: NOW }), nowMs)).toBe(false)
  })
})

describe('untaggedOpen', () => {
  it('日誌裡已有同 external_id 的不算', () => {
    const p = (id: string): BxOpenPosition => ({ positionId: id, symbol: 'SOL-USDT', positionSide: 'LONG', avgPrice: '1' })
    expect(untaggedOpen([p('a'), p('b')], [mk({ external_id: 'a' })]).map((x) => x.positionId)).toEqual(['b'])
  })
})
