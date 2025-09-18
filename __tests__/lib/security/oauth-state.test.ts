import { jest } from '@jest/globals'

import { persistOAuthStateWithStore, consumeOAuthStateWithStore, type OAuthStateMeta } from '../../../lib/security/oauth-state'

const cookieStore = new Map<string, string>()

const mockCookies = {
  get: jest.fn((name: string) => {
    if (!cookieStore.has(name)) return undefined
    return { value: cookieStore.get(name)! }
  }),
  set: jest.fn((name: string, value: string) => {
    cookieStore.set(name, value)
  }),
  delete: jest.fn((name: string) => {
    cookieStore.delete(name)
  }),
}

describe('oauth state storage', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 2).toString('base64')
    cookieStore.clear()
    mockCookies.get.mockClear()
    mockCookies.set.mockClear()
    mockCookies.delete.mockClear()
  })

  it('persists state and consumes it once', () => {
    const meta: OAuthStateMeta = {
      tenantId: 'tenant-123',
      userId: 'user-456',
      redirectPath: '/settings/connections',
      platform: 'facebook',
    }

    const start = Date.now()
    const nonce = persistOAuthStateWithStore(mockCookies, meta, start)
    expect(cookieStore.has('cheers_oauth_state')).toBe(true)

    expect(typeof nonce).toBe('string')
    expect(nonce).toHaveLength(32)

    const result = consumeOAuthStateWithStore(mockCookies, nonce, start + 1000)
    expect(result).toEqual(meta)

    expect(consumeOAuthStateWithStore(mockCookies, nonce, start + 1000)).toBeNull()
    expect(mockCookies.delete).toHaveBeenCalled()
  })

  it('returns null for expired nonces', () => {
    const start = Date.now()
    const nonce = persistOAuthStateWithStore(mockCookies, { tenantId: 'tenant', userId: 'user' }, start)
    expect(consumeOAuthStateWithStore(mockCookies, nonce, start + 11 * 60 * 1000)).toBeNull()
  })
})
