import { describe, it, expect } from '@jest/globals'
import { twitterLength, enforcePlatformLimits, collapseWhitespace } from '@/lib/utils/text'

describe('text utils - twitter', () => {
  it('counts URLs as fixed length (~23)', () => {
    const base = 'Hello world '
    const longUrl = 'https://example.com/this/is/a/very/long/url/that/would/be/shortened/by/tco'
    const text = base + longUrl + ' end'
    const rawLen = collapseWhitespace(text).length
    const twLen = twitterLength(text)
    expect(rawLen).toBeGreaterThan(twLen)
    expect(twLen).toBe(base.length + 23 + ' end'.length)
  })

  it('enforces 280 char limit with ellipsis', () => {
    const long = 'A'.repeat(400)
    const trimmed = enforcePlatformLimits(long, 'twitter')
    expect(twitterLength(trimmed)).toBeLessThanOrEqual(280)
    expect(trimmed.endsWith('…')).toBe(true)
  })
})

