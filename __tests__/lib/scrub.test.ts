import { describe, it, expect } from '@jest/globals'
import { scrubSensitive } from '@/lib/scrub'

describe('scrubSensitive', () => {
  it('redacts tokens, emails and headers', () => {
    const input = {
      authorization: 'Bearer abcdefghijklmnopqrstuvwxyz123456',
      cookies: 'sb:session=verylongtokenvalue',
      email: 'user@example.com',
      nested: {
        refresh_token: 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
        note: 'contact test.user+label@example.co.uk',
      }
    }
    const out = scrubSensitive(input) as any
    expect(out.authorization).toBe('[redacted]')
    expect(out.cookies).toBe('[redacted]')
    expect(out.nested.refresh_token).toBe('[redacted]')
    expect(String(out.email)).toContain('[redacted:email]')
    expect(String(out.nested.note)).toContain('[redacted:email]')
  })
})

