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