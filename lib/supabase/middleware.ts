import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Apply cookies to the request
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          // Create a new response with updated request
          supabaseResponse = NextResponse.next({
            request,
          })
          // Apply cookies to the response with proper options
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: Avoid writing any logic between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make your server
  // vulnerable to CSRF attacks.
  
  // This will refresh the session if expired - CRITICAL for proper auth
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Protected route handling - redirect to login if no user
  // Skip protection for auth routes, API routes, and public pages
  const publicRoutes = ['/', '/auth', '/api', '/_next', '/favicon.ico']
  const isProtectedRoute = !publicRoutes.some(route => 
    request.nextUrl.pathname.startsWith(route)
  )
  
  if (!user && isProtectedRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/login'
    url.searchParams.set('next', request.nextUrl.pathname)
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}