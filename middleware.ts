import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getCookieOptions } from '@/lib/supabase/cookie-options'

export async function middleware(req: NextRequest) {
  // Create response object that we can modify
  const res = NextResponse.next()
  
  // Create Supabase client with cookie handling
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name) => req.cookies.get(name)?.value,
        set: (name, value, options) => {
          // Set cookie on both request and response
          res.cookies.set({
            name,
            value,
            ...options,
            ...getCookieOptions()
          })
        },
        remove: (name, options) => {
          res.cookies.set({
            name,
            value: '',
            ...options,
            ...getCookieOptions(true)
          })
        },
      },
    }
  )

  // IMPORTANT: Use getUser() to revalidate session, not getSession()
  // This forces a refresh and writes back fresh cookies
  const { data: { user }, error } = await supabase.auth.getUser()
  
  // Check if user is logged in but email not verified
  const pathname = req.nextUrl.pathname
  const isPublicRoute = pathname.startsWith('/auth') || pathname.startsWith('/api') || pathname === '/' || pathname === '/privacy' || pathname === '/terms' || pathname === '/help'
  
  if (user && !user.email_confirmed_at && !isPublicRoute) {
    // User is logged in but email not confirmed, redirect to check-email page
    const url = req.nextUrl.clone()
    url.pathname = '/auth/check-email'
    return NextResponse.redirect(url)
  }
  
  return res
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (public folder)
     * - api routes that don't need auth (webhooks, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}