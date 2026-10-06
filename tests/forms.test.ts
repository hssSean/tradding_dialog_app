import { describe, expect, test } from 'vitest'
import { emptyEntryForm, emptyExitForm, entryToForm, parseEntry, parseExit } from '../src/lib/forms'
import { mk } from './helpers'

describe('parseEntry', () => {
  test('合法表單', () => {
    const f = { ...emptyEntryForm(10, '2026-10-05T09:00'), symbol: ' btcusdt ', entry_price: '100', planned_stop: '95' }
    const { value, errors } = parseEntry(f)
    expect(errors).toEqual([])
    expect(value.symbol).toBe('BTCUSDT')
    expect(value.planned_target).toBeNull()
    expect(value.setup_id).toBeNull()
    expect(value.opened_at).toBe('2026-10-05T01:00:00.000Z')
    expect(value.risk_usdt).toBe(10)
  })
  test('必填數字空白要報錯', () => {
    const f = { ...emptyEntryForm(10, '2026-10-05T09:00'), symbol: 'BTC', planned_stop: '95' }
    expect(parseEntry(f).errors).toContain('進場價要是大於 0 的數字')
  })
  test('往返', () => {
    const t = mk({ planned_target: 120, setup_id: 's1', entry_reason: '突破' })
    const { value, errors } = parseEntry(entryToForm(t))
    expect(errors).toEqual([])
    expect(value).toMatchObject({ entry_price: 100, planned_stop: 95, planned_target: 120, setup_id: 's1', opened_at: '2026-10-06T01:00:00.000Z' })
  })
})

describe('parseExit', () => {
  const t = mk({ closed_at: null, exit_price: null, exit_reason: null, final_stop: null })
  test('最後止損預設帶入計畫止損', () => expect(emptyExitForm(t, '2026-10-06T12:00').final_stop).toBe('95'))
  test('要選出場原因', () => {
    const f = { ...emptyExitForm(t, '2026-10-06T12:00'), exit_price: '110' }
    expect(parseExit(f, t).errors).toContain('請選出場原因')
  })
  test('合法，損益空白為 null、心得空白為 null', () => {
    const f = { ...emptyExitForm(t, '2026-10-06T12:00'), exit_price: '110', exit_reason: 'target' as const }
    const { value, errors } = parseExit(f, t)
    expect(errors).toEqual([])
    expect(value.pnl_usdt).toBeNull()
    expect(value.note).toBeNull()
    expect(value.final_stop).toBe(95)
  })
  // 2026-10-06：ENAUSDT 做多 0.24932 → 0.24436（虧損），實際損益卻填了 17，畫面顯示成賺錢
  const exitWith = (exit_price: string, pnl: string) => ({
    ...emptyExitForm(t, '2026-10-06T12:00'),
    exit_price,
    pnl_usdt: pnl,
    exit_reason: 'stop' as const,
  })
  test('價格是虧損、實際損益填正數 → 自動當成負數', () => {
    const r = parseExit(exitWith('92', '17'), t)
    expect(r.value.pnl_usdt).toBe(-17)
    expect(r.pnlSignFixed).toBe(true)
  })
  test('做空虧損也一樣', () => {
    const short = mk({ direction: 'short', planned_stop: 105, closed_at: null, exit_price: null, exit_reason: null, final_stop: null })
    const f = { ...emptyExitForm(short, '2026-10-06T12:00'), exit_price: '104', pnl_usdt: '8', exit_reason: 'stop' as const }
    expect(parseExit(f, short).value.pnl_usdt).toBe(-8)
  })
  test('虧損填負數維持不變', () => {
    const r = parseExit(exitWith('92', '-17'), t)
    expect(r.value.pnl_usdt).toBe(-17)
    expect(r.pnlSignFixed).toBe(false)
  })
  test('價格小賺、實際小虧（被手續費吃掉）保留負數', () => {
    expect(parseExit(exitWith('100.5', '-0.3'), t).value.pnl_usdt).toBe(-0.3)
  })
  test('獲利填正數維持不變', () => {
    expect(parseExit(exitWith('110', '20'), t).value.pnl_usdt).toBe(20)
  })
})
