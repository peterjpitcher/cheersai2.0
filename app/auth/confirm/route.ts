import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { EmailOtpType } from '@supabase/supabase-js'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const token_hash = url.searchParams.get('token_hash')
  const type = url.searchParams.get('type') as EmailOtpType | null
  const next = url.searchParams.get('next') ?? '/dashboard'

  // Prepare a redirect without secrets
  const redirectUrl = new URL(next, url.origin)

  if (!token_hash || !type) {
    redirectUrl.pathname = '/auth/error'
    redirectUrl.searchParams.set('reason', 'missing_params')
    return NextResponse.redirect(redirectUrl)
  }

  const res = NextResponse.redirect(redirectUrl)
  
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name) => req.cookies.get(name)?.value,
        set: (name, value, options) =>
          res.cookies.set({ name, value, ...options, path: '/', sameSite: 'lax', httpOnly: true, secure: process.env.NODE_ENV === 'production' }),
        remove: (name, options) =>
          res.cookies.set({ name, value: '', ...options, path: '/', maxAge: 0, sameSite: 'lax', httpOnly: true, secure: process.env.NODE_ENV === 'production' }),
      },
    }
  )

  const { error } = await supabase.auth.verifyOtp({ type, token_hash })
  if (error) {
    const errUrl = new URL('/auth/error', url.origin)
    errUrl.searchParams.set('reason', error.message)
    return NextResponse.redirect(errUrl)
  }

  // Check if user needs onboarding after successful verification
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const { data: userData } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single()
    
    if (!userData?.tenant_id) {
      redirectUrl.pathname = '/onboarding'
      return NextResponse.redirect(redirectUrl)
    }
  }

  return res // cookies from verifyOtp are attached to res
}