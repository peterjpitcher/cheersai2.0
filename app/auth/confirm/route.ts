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
    
    // Ensure a users row exists
    const { data: userRow, error: userRowErr } = await supabase
      .from('users')
      .select('id, tenant_id')
      .eq('id', user.id)
      .maybeSingle()

    if (!userRow) {
      await supabase.from('users').insert({
        id: user.id,
        email: user.email,
        full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
        first_name: user.user_metadata?.first_name || user.email?.split('@')[0] || 'User',
        last_name: user.user_metadata?.last_name || '',
      })
    }

    let hasTenant = !!userRow?.tenant_id;
    let foundTenantId: string | null = userRow?.tenant_id ?? null;
    if (!hasTenant) {
      const { data: membership } = await supabase
        .from('user_tenants')
        .select('tenant_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();
      if (membership?.tenant_id) {
        hasTenant = true;
        foundTenantId = membership.tenant_id as string;
        // Persist onto users for consistency
        await supabase.from('users').update({ tenant_id: foundTenantId }).eq('id', user.id);
      }
    }
    const redirectTo = !hasTenant ? '/onboarding' : next
    
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
    
    // Ensure a users row exists
    const { data: userRow, error: userRowErr } = await supabase
      .from('users')
      .select('id, tenant_id')
      .eq('id', user.id)
      .maybeSingle()

    if (!userRow) {
      await supabase.from('users').insert({
        id: user.id,
        email: user.email,
        full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
        first_name: user.user_metadata?.first_name || user.email?.split('@')[0] || 'User',
        last_name: user.user_metadata?.last_name || '',
      })
    }

    let hasTenant2 = !!userRow?.tenant_id;
    let foundTenantId2: string | null = userRow?.tenant_id ?? null;
    if (!hasTenant2) {
      const { data: membership } = await supabase
        .from('user_tenants')
        .select('tenant_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();
      if (membership?.tenant_id) {
        hasTenant2 = true;
        foundTenantId2 = membership.tenant_id as string;
        await supabase.from('users').update({ tenant_id: foundTenantId2 }).eq('id', user.id);
      }
    }
    const redirectTo = !hasTenant2 ? '/onboarding' : next
    
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
