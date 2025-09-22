import { type NextRequest, NextResponse } from 'next/server'

export async function middleware(req: NextRequest) {
  // Prepare a base response we can decorate with headers
  const res = NextResponse.next()
  // Attach simple request/trace ids
  const incomingReqId = req.headers.get('x-request-id')
  const requestId = incomingReqId || (globalThis as any).crypto?.randomUUID?.() || `${Date.now()}`
  res.headers.set('x-request-id', requestId)
  if (!req.headers.get('x-trace-id')) {
    res.headers.set('x-trace-id', requestId)
  }

  // Lightweight auth check in Edge: detect Supabase auth cookies
  // We avoid calling Supabase in middleware to keep the Edge bundle small
  const cookies = req.cookies.getAll()
  // Supabase SSR sets split cookies: sb-<ref>-auth-token.0 and .1
  const hasSbAuthToken = cookies.some(c => /^sb-.*-auth-token(?:\.\d+)?$/.test(c.name))
  const hasAccess = !!req.cookies.get('sb-access-token')?.value
  const hasRefresh = !!req.cookies.get('sb-refresh-token')?.value
  const isAuthenticated = hasSbAuthToken || hasAccess || hasRefresh

  const pathname = req.nextUrl.pathname
  const isApi = pathname.startsWith('/api')
  const isAuthRoute = pathname.startsWith('/auth')
  const isPublicMarketing = pathname === '/privacy' || pathname === '/terms' || pathname === '/help' || pathname === '/pricing'
  // Define top-level authed sections that require login
  const authedPrefixes = ['/dashboard', '/campaigns', '/publishing', '/settings', '/analytics', '/media', '/onboarding', '/admin', '/calendar']
  const isAuthedSection = authedPrefixes.some(p => pathname === p || pathname.startsWith(`${p}/`))

  // Skip redirecting root here; let the home page validate sessions with Supabase to avoid cookie-induced loops

  // If unauthenticated user hits authed section, redirect to root
  if (!isAuthenticated && isAuthedSection && !isApi && !isPublicMarketing) {
    const url = req.nextUrl.clone()
    url.pathname = '/'
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
