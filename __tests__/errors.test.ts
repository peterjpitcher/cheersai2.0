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

  test('maps rate limited by HTTP status', () => {
    const err: any = new Error('Too many requests')
    err.status = 429
    const mapped = mapProviderError(err, 'facebook')
    expect(mapped.code).toBe('RATE_LIMITED')
  })
})
