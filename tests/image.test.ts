import { describe, expect, test } from 'vitest'
import { fitSize } from '../src/lib/image'

describe('fitSize', () => {
  test('iPhone 直式截圖', () => expect(fitSize(1179, 2556)).toEqual({ width: 923, height: 2000 }))
  test('小圖不放大', () => expect(fitSize(800, 600)).toEqual({ width: 800, height: 600 }))
  test('橫式大圖', () => expect(fitSize(4000, 3000)).toEqual({ width: 2000, height: 1500 }))
  test('剛好 2000', () => expect(fitSize(2000, 1000)).toEqual({ width: 2000, height: 1000 }))
})
