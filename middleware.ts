import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(req: NextRequest) {
  // Create response first so we can mutate it
  const res = NextResponse.next({ 
    request: { 
      headers: req.headers 
    } 
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name) => req.cookies.get(name)?.value,
        set: (name, value, options) => {
          // Ensure proper cookie settings
          res.cookies.set({ 
            name, 
            value, 
            ...options, 
            path: '/', 
            sameSite: 'lax' 
          })
        },
        remove: (name, options) => {
          // Properly remove cookies
          res.cookies.set({ 
            name, 
            value: '', 
            ...options, 
            path: '/', 
            maxAge: 0 
          })
        },
      },
    }
  )

  // Will refresh session if needed and write cookies to response
  await supabase.auth.getUser()

  return res
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (images, etc)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}