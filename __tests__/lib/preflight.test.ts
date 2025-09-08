import { describe, it, expect } from '@jest/globals'
import { preflight } from '@/lib/preflight'

describe('preflight', () => {
  it('flags banned phrases', () => {
    const r = preflight('Click here for free gift card!', 'facebook')
    expect(r.overall).toBe('fail')
    expect(r.findings.some(f => f.code === 'banned_phrase')).toBe(true)
  })
  it('warns for long twitter text', () => {
    const r = preflight('x'.repeat(300), 'twitter')
    expect(r.overall).toBe('fail')
  })
})

