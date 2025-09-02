import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getCookieOptions } from '@/lib/supabase/cookie-options'

export async function GET(req: NextRequest) {
  const requestUrl = new URL(req.url)
  const code = requestUrl.searchParams.get('code')
  const error = requestUrl.searchParams.get('error')
  const error_description = requestUrl.searchParams.get('error_description')
  const next = requestUrl.searchParams.get('next') || '/dashboard'
  const origin = requestUrl.origin

  // Handle errors from Supabase
  if (error) {
    console.error('Auth callback error:', error, error_description)
    return NextResponse.redirect(`${origin}/auth/error?reason=${encodeURIComponent(error_description || error)}`)
  }

  // This route should only handle OAuth/PKCE flows with a code
  if (!code) {
    console.log('No code in callback, redirecting to error')
    return NextResponse.redirect(`${origin}/auth/error?reason=missing_code`)
  }

  // Create the response object that we'll use for redirects and cookie operations
  const response = NextResponse.next()

  try {
    // Create supabase client with single response object for cookie handling
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name) => req.cookies.get(name)?.value,
          set: (name, value, options) => {
            response.cookies.set({
              name,
              value,
              ...options,
              ...getCookieOptions()
            })
          },
          remove: (name, options) => {
            response.cookies.set({
              name,
              value: '',
              ...options,
              ...getCookieOptions(true)
            })
          },
        },
      }
    )

    // Exchange the code for a session (OAuth/PKCE flow)
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
    
    if (exchangeError) {
      console.error('Session exchange error:', exchangeError)
      return NextResponse.redirect(
        `${origin}/auth/error?reason=${encodeURIComponent(exchangeError.message)}`
      )
    }

    // Successfully authenticated - get user to check status
    const { data: { user } } = await supabase.auth.getUser()
    
    let redirectUrl = `${origin}${next}`
    
    if (user) {
      // Check if user has a tenant (determines if onboarding needed)
      const { data: userData } = await supabase
        .from('users')
        .select('tenant_id')
        .eq('id', user.id)
        .single()
      
      if (!userData?.tenant_id) {
        // New user needs onboarding
        redirectUrl = `${origin}/onboarding`
      }
    }

    // Return redirect with cookies already set on the response
    return NextResponse.redirect(redirectUrl, {
      headers: response.headers
    })

  } catch (error) {
    console.error('Unexpected error in auth callback:', error)
    return NextResponse.redirect(
      `${origin}/auth/error?reason=unexpected_error`
    )
  }
}