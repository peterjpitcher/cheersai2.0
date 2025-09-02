import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getCookieOptions } from '@/lib/supabase/cookie-options'

export async function GET(req: NextRequest) {
  const requestUrl = new URL(req.url)
  const origin = requestUrl.origin
  
  // Log all parameters for debugging
  console.log('Auth confirm called with params:', Object.fromEntries(requestUrl.searchParams))
  
  // Check for error parameters first
  const error = requestUrl.searchParams.get('error')
  const error_description = requestUrl.searchParams.get('error_description')
  
  if (error) {
    console.error('Auth confirm error:', error, error_description)
    return NextResponse.redirect(`${origin}/auth/error?reason=${encodeURIComponent(error_description || error)}`)
  }
  
  // After Supabase verifies the email internally, it redirects here
  // The session should already be set by Supabase, we just need to check it
  const response = NextResponse.next()
  
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

  // Check if user is authenticated after email confirmation
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  
  if (userError || !user) {
    console.error('No authenticated user found after confirmation:', userError)
    // Session might not be set yet, redirect to login
    return NextResponse.redirect(`${origin}/auth/login?message=${encodeURIComponent('Please login to continue')}`)
  }
  
  console.log('User confirmed and authenticated:', user.id)
  
  // Check if user needs onboarding
  const { data: userData } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()
  
  // Determine where to redirect
  const redirectTo = !userData?.tenant_id ? '/onboarding' : '/dashboard'
  
  console.log('Redirecting confirmed user to:', redirectTo)
  return NextResponse.redirect(`${origin}${redirectTo}`)
}