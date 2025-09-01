import { type NextRequest, NextResponse } from 'next/server'
import { redirect } from 'next/navigation'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const token_hash = url.searchParams.get('token_hash')
  const type = url.searchParams.get('type') as EmailOtpType | null
  const next = url.searchParams.get('next') ?? '/'

  if (!token_hash || !type) {
    return redirect('/auth/error?reason=missing_params')
  }

  // Create response object to collect cookies
  const res = NextResponse.redirect(new URL(next, url))
  
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name) => req.cookies.get(name)?.value,
        set: (name, value, options) => {
          res.cookies.set({
            name,
            value,
            ...options,
            path: '/',
            sameSite: 'lax',
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production'
          })
        },
        remove: (name, options) => {
          res.cookies.set({
            name,
            value: '',
            ...options,
            path: '/',
            maxAge: 0,
            sameSite: 'lax',
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production'
          })
        },
      },
    }
  )

  // Verify the OTP
  const { data, error } = await supabase.auth.verifyOtp({ 
    type, 
    token_hash 
  })

  if (error) {
    // Provide more specific error messages
    let errorReason = 'unknown'
    if (error.message.includes('expired') || error.message.includes('not found')) {
      errorReason = 'expired_link'
    } else if (error.message.includes('already')) {
      errorReason = 'already_used'
    }
    return redirect(`/auth/error?reason=${errorReason}&message=${encodeURIComponent(error.message)}`)
  }

  // Check if user needs onboarding (no tenant_id)
  if (data?.user) {
    const { data: userData } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', data.user.id)
      .single()
    
    if (!userData?.tenant_id) {
      return redirect('/onboarding')
    }
  }

  // Redirect to dashboard or requested page
  return res
}