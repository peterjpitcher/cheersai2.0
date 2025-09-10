import { describe, it, expect } from '@jest/globals'
import { preflight } from '@/lib/preflight'

describe('preflight twitter length', () => {
  it('passes when a long URL is present (counted as 23)', () => {
    const longUrl = 'https://example.com/' + 'x'.repeat(200)
    const text = 'Join us tonight! ' + longUrl + ' for more info.'
    const pf = preflight(text, 'twitter')
    expect(pf.findings.find(f => f.code === 'length_twitter')).toBeUndefined()
  })

  it('fails when content truly exceeds limit', () => {
    const text = 'x'.repeat(300)
    const pf = preflight(text, 'twitter')
    expect(pf.findings.find(f => f.code === 'length_twitter')).toBeDefined()
  })
})

