import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')
  const error_description = url.searchParams.get('error_description')
  const next = url.searchParams.get('next') || '/dashboard'
  const origin = url.origin

  // Handle errors from Supabase
  if (error) {
    console.error('Auth callback error:', error, error_description)
    return NextResponse.redirect(`${origin}/auth/error?reason=${encodeURIComponent(error_description || error)}`)
  }

  // If no code, this might be a direct redirect after email verification
  if (!code) {
    console.log('No code in callback, likely from email confirmation redirect')
    // For email confirmations, Supabase should have set the session already
    // Redirect to confirm route to handle the actual verification
    return NextResponse.redirect(`${origin}/auth/confirm${url.search}`)
  }

  const cookieStore = cookies() // sync, not async

  // Create response FIRST so we can mutate it with cookie writes
  let redirectUrl = `${origin}${next}`
  
  // Check if this is a new signup (we'll check after exchange)
  let isNewUser = false

  try {
    // Create supabase client with proper cookie handling
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value
          },
          set(name: string, value: string, options: any) {
            // We'll set cookies on the response after determining redirect
            cookieStore.set({ name, value, ...options })
          },
          remove(name: string, options: any) {
            cookieStore.set({
              name,
              value: '',
              ...options,
              maxAge: 0,
            })
          },
        },
      }
    )

    // Exchange the code for a session
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
    
    if (exchangeError) {
      console.error('Session exchange error:', exchangeError)
      return NextResponse.redirect(
        `${origin}/auth/error?reason=${encodeURIComponent(exchangeError.message)}`
      )
    }

    // Successfully authenticated - get user to check status
    const { data: { user } } = await supabase.auth.getUser()
    
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
        isNewUser = true
      }
    }

    // Create the redirect response
    const response = NextResponse.redirect(redirectUrl)
    
    // Important: Transfer any cookies that were set during the exchange
    const allCookies = cookieStore.getAll()
    allCookies.forEach(cookie => {
      if (cookie.name.startsWith('sb-')) {
        response.cookies.set({
          name: cookie.name,
          value: cookie.value,
          path: '/',
          sameSite: 'lax',
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
        })
      }
    })

    return response

  } catch (error) {
    console.error('Unexpected error in auth callback:', error)
    return NextResponse.redirect(
      `${origin}/auth/error?reason=unexpected_error`
    )
  }
}