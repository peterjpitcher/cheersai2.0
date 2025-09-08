import { describe, it, expect } from '@jest/globals'
import { mergeUtm } from '@/lib/utm'

describe('mergeUtm', () => {
  it('appends UTM params idempotently', () => {
    const url = 'https://example.com/page?x=1'
    const merged = mergeUtm(url, { utm_source: 'facebook', utm_medium: 'social' })
    expect(merged).toContain('utm_source=facebook')
    expect(merged).toContain('utm_medium=social')
    const merged2 = mergeUtm(merged, { utm_source: 'facebook' })
    expect(merged2).toBe(merged)
  })
})

