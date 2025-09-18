/**
 * Get the application URL for redirects and callbacks
 * Follows Supabase's recommended pattern for URL handling
 * 
 * Priority order:
 * 1. NEXT_PUBLIC_SITE_URL (production)
 * 2. NEXT_PUBLIC_APP_URL (legacy/fallback)
 * 3. NEXT_PUBLIC_VERCEL_URL (Vercel preview deployments)
 * 4. localhost:3000 (local development)
 */
export function getAppUrl(): string {
  let url =
    process.env.NEXT_PUBLIC_SITE_URL ?? // Production URL (preferred)
    process.env.NEXT_PUBLIC_APP_URL ??  // Legacy/fallback
    process.env.NEXT_PUBLIC_VERCEL_URL ?? // Vercel preview deployments
    'http://localhost:3000/' // Local development default

  // Ensure URL has protocol
  url = url.startsWith('http') ? url : `https://${url}`
  
  // Ensure URL has trailing slash for consistency
  url = url.endsWith('/') ? url : `${url}/`
  
  return url
}

/**
 * Get the base URL without trailing slash
 * Useful for constructing paths
 */
export function getBaseUrl(): string {
  const url = getAppUrl()
  return url.endsWith('/') ? url.slice(0, -1) : url
}

type RequestLike = Request | { headers?: Headers } | { nextUrl?: URL }

function hasNextUrl(value: unknown): value is { nextUrl: URL } {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'nextUrl' in value &&
    (value as { nextUrl: unknown }).nextUrl instanceof URL,
  )
}

function hasHeaders(value: unknown): value is { headers: Headers } {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'headers' in value &&
    (value as { headers: unknown }).headers instanceof Headers,
  )
}

/**
 * Derive the best base URL for internal fetches during API handling.
 * Prioritises request metadata so cron jobs and previews hit the same origin.
 */
export function getInternalBaseUrl(request?: RequestLike): string {
  // Next.js exposes `nextUrl` with the canonical origin when available
  if (request && hasNextUrl(request) && request.nextUrl.origin) {
    const nextUrl = request.nextUrl
    return nextUrl.origin
  }

  const headers =
    request instanceof Request
      ? request.headers
      : hasHeaders(request)
        ? request.headers
        : undefined

  if (headers) {
    const proto =
      headers.get('x-forwarded-proto') ||
      headers.get('x-forwarded-protocol') ||
      headers.get('x-url-scheme') ||
      undefined
    const host =
      headers.get('x-forwarded-host') ||
      headers.get('x-original-host') ||
      headers.get('host') ||
      undefined

    if (proto && host) {
      return `${proto}://${host}`
    }

    if (host) {
      // Default to https unless explicitly told otherwise
      const inferredProto = proto || 'https'
      return `${inferredProto}://${host}`
    }
  }

  const fallbackUrl =
    process.env.INTERNAL_SITE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_VERCEL_URL ||
    process.env.VERCEL_URL ||
    'http://localhost:3000'

  const normalised = fallbackUrl.startsWith('http')
    ? fallbackUrl
    : `https://${fallbackUrl}`

  return normalised.endsWith('/') ? normalised.slice(0, -1) : normalised
}
