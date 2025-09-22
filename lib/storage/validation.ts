export function assertIsPublicSupabaseMediaUrl(fileUrl: string, bucket = 'media'): void {
  let parsed: URL
  try {
    parsed = new URL(fileUrl)
  } catch {
    throw new Error('Media URL is malformed')
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) {
    throw new Error('Supabase URL is not configured')
  }
  const supabaseOrigin = new URL(supabaseUrl).origin
  if (parsed.origin !== supabaseOrigin) {
    throw new Error('Media must be served from Supabase storage')
  }
  const normalisedPath = parsed.pathname.toLowerCase()
  if (!normalisedPath.startsWith('/storage/v1/object/public/')) {
    throw new Error('Media URL is not a public storage asset')
  }
  if (bucket && !normalisedPath.includes(`/${bucket.toLowerCase()}/`)) {
    throw new Error(`Media must reside in the ${bucket} bucket`)
  }
}
