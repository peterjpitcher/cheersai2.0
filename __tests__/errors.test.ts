import { mapProviderError } from '@/lib/errors'

describe('error mapping', () => {
  test('maps instagram image requirement', () => {
    const e = new Error('Instagram requires an image')
    const mapped = mapProviderError(e, 'instagram')
    expect(mapped.code).toBe('IG_IMAGE_REQUIRED')
  })

  test('maps token expired', () => {
    const e = new Error('The token expired')
    const mapped = mapProviderError(e, 'facebook')
    expect(mapped.code).toBe('TOKEN_EXPIRED')
  })

  test('maps rate limited', () => {
    const e = new Error('Rate limit exceeded (429)')
    const mapped = mapProviderError(e, 'twitter')
    expect(mapped.code).toBe('RATE_LIMITED')
  })
})

