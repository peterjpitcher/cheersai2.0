import { describe, it, expect } from '@jest/globals'
import { mapToGbpPayload, GbpValidationError } from '@/lib/gbp/mapper'

describe('GBP mapper', () => {
  it('maps UPDATE with image', () => {
    const r = mapToGbpPayload({ type: 'UPDATE', text: 'Hello', imageUrl: 'https://x/y.jpg' })
    expect(r.payload.summary).toBe('Hello')
    expect(r.postType).toBe('UPDATE')
  })
  it('validates EVENT requires start', () => {
    expect(() => mapToGbpPayload({ type: 'EVENT', text: 'x', imageUrl: 'https://x/y.jpg' } as any)).toThrow(GbpValidationError)
  })
  it('validates OFFER requires code or redeem', () => {
    expect(() => mapToGbpPayload({ type: 'OFFER', text: 'x', imageUrl: 'https://x/y.jpg', offer: {} } as any)).toThrow(GbpValidationError)
  })
})

