import { describe, it, expect } from '@jest/globals'
import { limitSlidingWindow } from '@/lib/rate-limit'

describe('rate-limit', () => {
  it('limits within a small window', async () => {
    const id = `test:${Date.now()}`
    // 3 requests allowed per 1s window
    const w = '1 s'
    const max = 3
    for (let i = 0; i < max; i++) {
      const r = await limitSlidingWindow(id, max, w)
      expect(r.success).toBe(true)
    }
    const blocked = await limitSlidingWindow(id, max, w)
    expect(blocked.success).toBe(false)
  })
})

