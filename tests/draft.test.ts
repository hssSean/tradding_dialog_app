import { afterEach, describe, expect, test, vi } from 'vitest'
import { clearDraft, loadDraft, saveDraft } from '../src/lib/draft'

function memoryStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('draft', () => {
  test('存讀往返與清除', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    saveDraft('draft:new', { symbol: 'BTC' })
    expect(loadDraft('draft:new')).toEqual({ symbol: 'BTC' })
    clearDraft('draft:new')
    expect(loadDraft('draft:new')).toBeNull()
  })
  test('JSON 壞掉回 null', () => {
    const s = memoryStorage()
    s.setItem('draft:new', '{oops')
    vi.stubGlobal('localStorage', s)
    expect(loadDraft('draft:new')).toBeNull()
  })
  test('localStorage 丟錯時不丟錯', () => {
    const boom = () => {
      throw new Error('SecurityError')
    }
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, removeItem: boom })
    expect(loadDraft('draft:new')).toBeNull()
    expect(() => saveDraft('draft:new', 1)).not.toThrow()
    expect(() => clearDraft('draft:new')).not.toThrow()
  })
  test('沒有 localStorage 時不丟錯', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(loadDraft('x')).toBeNull()
  })
})
