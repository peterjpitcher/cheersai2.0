import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getCookieOptions } from '@/lib/supabase/cookie-options'

export async function middleware(req: NextRequest) {
  // Create response object that we can modify
  const res = NextResponse.next()
  const applyCookies = (target: NextResponse) => {
    // Ensure any cookies set during auth refresh are forwarded on redirects
    res.cookies.getAll().forEach((cookie) => {
      target.cookies.set(cookie)
    })
    return target
  }
  
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
  
  const pathname = req.nextUrl.pathname
  const isApi = pathname.startsWith('/api')
  const isAuthRoute = pathname.startsWith('/auth')
  const isRoot = pathname === '/'
  const isPublicMarketing = pathname === '/privacy' || pathname === '/terms' || pathname === '/help' || pathname === '/pricing'
  // Define top-level authed sections that require login
  const authedPrefixes = ['/dashboard', '/campaigns', '/publishing', '/settings', '/analytics', '/media', '/onboarding', '/admin', '/calendar']
  const isAuthedSection = authedPrefixes.some(p => pathname === p || pathname.startsWith(`${p}/`))

  // If user is logged in but email not verified, block access to authed sections
  if (user && !user.email_confirmed_at && isAuthedSection) {
    const url = req.nextUrl.clone()
    url.pathname = '/auth/check-email'
    return applyCookies(NextResponse.redirect(url))
  }

  // If user is authenticated and hits root or any auth page, send them to dashboard
  if (user && user.email_confirmed_at && (isRoot || isAuthRoute)) {
    const url = req.nextUrl.clone()
    url.pathname = '/dashboard'
    return applyCookies(NextResponse.redirect(url))
  }

  // If unauthenticated user hits an authed section, send them to root
  if (!user && isAuthedSection && !isApi) {
    const url = req.nextUrl.clone()
    url.pathname = '/'
    return applyCookies(NextResponse.redirect(url))
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
