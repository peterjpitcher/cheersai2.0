/** @jest-environment node */
import { jest } from '@jest/globals'
let cronGet: typeof import('@/app/api/cron/route').GET

const ORIGINAL_FETCH = global.fetch

function createRequest(headers: Record<string, string | undefined>) {
  const filtered = Object.entries(headers).filter(([, value]) => value !== undefined) as [string, string][]
  return {
    method: 'GET',
    headers: new Headers(filtered),
    url: 'http://localhost/api/cron',
    nextUrl: new URL('http://localhost/api/cron'),
  } as unknown as Request
}

describe('cron route authentication', () => {
  beforeAll(async () => {
    const globalAny = global as any
    if (!globalAny.Request) {
      class MinimalRequest {}
      globalAny.Request = MinimalRequest
    }
    if (!globalAny.Headers) {
      class MinimalHeaders {
        private readonly store = new Map<string, string>()
        constructor(entries: [string, string][] = []) {
          for (const [key, value] of entries) {
            this.store.set(key.toLowerCase(), value)
          }
        }
        get(name: string) {
          const val = this.store.get(name.toLowerCase())
          return val === undefined ? null : val
        }
        set(name: string, value: string) {
          this.store.set(name.toLowerCase(), value)
        }
        has(name: string) {
          return this.store.has(name.toLowerCase())
        }
        delete(name: string) {
          this.store.delete(name.toLowerCase())
        }
        [Symbol.iterator]() {
          return this.store.entries()
        }
      }
      globalAny.Headers = MinimalHeaders
    }
    const module = await import('@/app/api/cron/route')
    cronGet = module.GET
  })
  beforeEach(() => {
    jest.restoreAllMocks()
    global.fetch = jest.fn() as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH
    delete process.env.CRON_SECRET
  })

  it('forwards CRON_SECRET when provided', async () => {
    process.env.CRON_SECRET = 'super-secret'
    const request = createRequest({ Authorization: 'Bearer super-secret' })

    const fetchMock = global.fetch as unknown as jest.Mock
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    )

    const response = await cronGet(request as unknown as Request)
    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const call of fetchMock.mock.calls) {
      const headers = call[1]?.headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer super-secret')
    }
  })

  it('omits Authorization when CRON_SECRET is absent but vercel header exists', async () => {
    process.env.CRON_SECRET = ''
    const request = createRequest({ 'x-vercel-cron': '1 * * * *' })

    const fetchMock = global.fetch as unknown as jest.Mock
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    )

    const response = await cronGet(request as unknown as Request)

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const call of fetchMock.mock.calls) {
      const headers = call[1]?.headers as Record<string, string>
      expect(headers.Authorization).toBeUndefined()
      expect(headers['x-vercel-cron']).toBe('1 * * * *')
    }
  })

  it('rejects unauthorized requests when secret mismatches', async () => {
    process.env.CRON_SECRET = 'expected'
    const request = createRequest({ Authorization: 'Bearer wrong' })

    const response = await cronGet(request as unknown as Request)

    expect(response.status).toBe(401)
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
