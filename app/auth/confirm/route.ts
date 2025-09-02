import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getCookieOptions } from '@/lib/supabase/cookie-options'

export async function GET(req: NextRequest) {
  const requestUrl = new URL(req.url)
  const origin = requestUrl.origin
  
  // Log all parameters for debugging
  console.log('[Auth Confirm] Called with params:', Object.fromEntries(requestUrl.searchParams))
  
  // Get parameters
  const token_hash = requestUrl.searchParams.get('token_hash')
  const type = requestUrl.searchParams.get('type')
  const next = requestUrl.searchParams.get('next') || '/dashboard'
  
  // Check for error parameters
  const error = requestUrl.searchParams.get('error')
  const error_description = requestUrl.searchParams.get('error_description')
  
  if (error) {
    console.error('Auth confirm error:', error, error_description)
    return NextResponse.redirect(`${origin}/auth/error?reason=${encodeURIComponent(error_description || error)}`)
  }
  
  if (!token_hash || !type) {
    console.error('Missing required parameters')
    return NextResponse.redirect(`${origin}/auth/error?reason=missing_params`)
  }
  
  // Create a temporary response to collect cookies
  const cookiesToSet: Array<{ name: string; value: string; options: any }> = []
  
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name) => req.cookies.get(name)?.value,
        set: (name, value, options) => {
          cookiesToSet.push({ name, value, options: { ...options, ...getCookieOptions() } })
        },
        remove: (name, options) => {
          cookiesToSet.push({ name, value: '', options: { ...options, ...getCookieOptions(true) } })
        },
      },
    }
  )

  // Handle different confirmation types
  if (type === 'email' || type === 'signup') {
    // Email confirmation for signup
    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash,
      type: 'email',
    })
    
    if (verifyError) {
      console.error('Email verification error:', verifyError)
      return NextResponse.redirect(
        `${origin}/auth/error?reason=${encodeURIComponent(verifyError.message)}`
      )
    }
    
    // Verification successful, check if user needs onboarding
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      console.error('No user after verification')
      return NextResponse.redirect(`${origin}/auth/login`)
    }
    
    const { data: userData } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single()
    
    const redirectTo = !userData?.tenant_id ? '/onboarding' : next
    
    // Create redirect response and set all cookies
    const redirectResponse = NextResponse.redirect(`${origin}${redirectTo}`)
    cookiesToSet.forEach(({ name, value, options }) => {
      redirectResponse.cookies.set({ name, value, ...options })
    })
    return redirectResponse
    
  } else if (type === 'magiclink') {
    // Magic link login - use 'email' type since 'magiclink' is deprecated
    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash,
      type: 'email',
    })
    
    if (verifyError) {
      console.error('Magic link verification error:', verifyError)
      return NextResponse.redirect(
        `${origin}/auth/error?reason=${encodeURIComponent(verifyError.message)}`
      )
    }
    
    // Check if user needs onboarding
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      console.error('No user after magic link verification')
      return NextResponse.redirect(`${origin}/auth/login`)
    }
    
    const { data: userData } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single()
    
    const redirectTo = !userData?.tenant_id ? '/onboarding' : next
    
    // Create redirect response and set all cookies
    const redirectResponse = NextResponse.redirect(`${origin}${redirectTo}`)
    cookiesToSet.forEach(({ name, value, options }) => {
      redirectResponse.cookies.set({ name, value, ...options })
    })
    return redirectResponse
    
  } else if (type === 'recovery') {
    // Password reset - redirect to reset password page
    // The token will be verified on the reset password page
    return NextResponse.redirect(
      `${origin}/auth/reset-password?token_hash=${token_hash}`
    )
    
  } else if (type === 'invite') {
    // Team invitation
    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash,
      type: 'invite',
    })
    
    if (verifyError) {
      console.error('Invite verification error:', verifyError)
      return NextResponse.redirect(
        `${origin}/auth/error?reason=${encodeURIComponent(verifyError.message)}`
      )
    }
    
    // Create redirect response and set all cookies
    const redirectResponse = NextResponse.redirect(`${origin}/onboarding`)
    cookiesToSet.forEach(({ name, value, options }) => {
      redirectResponse.cookies.set({ name, value, ...options })
    })
    return redirectResponse
    
  } else if (type === 'email_change') {
    // Email change confirmation
    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash,
      type: 'email_change',
    })
    
    if (verifyError) {
      console.error('Email change verification error:', verifyError)
      return NextResponse.redirect(
        `${origin}/auth/error?reason=${encodeURIComponent(verifyError.message)}`
      )
    }
    
    // Create redirect response and set all cookies
    const redirectResponse = NextResponse.redirect(`${origin}/settings?message=Email+updated+successfully`)
    cookiesToSet.forEach(({ name, value, options }) => {
      redirectResponse.cookies.set({ name, value, ...options })
    })
    return redirectResponse
    
  } else {
    // Unknown type
    console.error('Unknown confirmation type:', type)
    return NextResponse.redirect(`${origin}/auth/error?reason=invalid_type`)
  }
}