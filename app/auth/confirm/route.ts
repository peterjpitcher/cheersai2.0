import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DatabaseWithoutInternals } from '@/lib/database.types'
import { getCookieOptions } from '@/lib/supabase/cookie-options'

type CookieOptions = {
  domain?: string
  expires?: Date
  httpOnly?: boolean
  maxAge?: number
  path?: string
  sameSite?: true | false | 'lax' | 'strict' | 'none'
  secure?: boolean
  priority?: 'low' | 'medium' | 'high'
  partitioned?: boolean
}

export const runtime = 'nodejs'

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
  const cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }> = []

  const supabase = createServerClient<DatabaseWithoutInternals>(
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
  ) as unknown as SupabaseClient<DatabaseWithoutInternals, 'public'>

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
    const { data: userRow } = await supabase
      .from('users')
      .select('id, tenant_id')
      .eq('id', user.id)
      .maybeSingle<{ id: string; tenant_id: string | null }>()

    if (!userRow) {
      const insertPayload: DatabaseWithoutInternals['public']['Tables']['users']['Insert'] = {
        id: user.id,
        email: user.email,
        full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
        first_name: user.user_metadata?.first_name || user.email?.split('@')[0] || 'User',
        last_name: user.user_metadata?.last_name || '',
      }
      await supabase.from('users').insert(insertPayload)
    }

    let tenantIdForUser = userRow?.tenant_id ?? null
    if (!tenantIdForUser) {
      const { data: membership } = await supabase
        .from('user_tenants')
        .select('tenant_id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle<{ tenant_id: string | null }>()
      if (membership?.tenant_id) {
        tenantIdForUser = membership.tenant_id
        await supabase
          .from('users')
          .update({ tenant_id: membership.tenant_id })
          .eq('id', user.id)
      }
    }
    const redirectTo = tenantIdForUser ? next : '/onboarding'
    
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
    const { data: magicUserRow } = await supabase
      .from('users')
      .select('id, tenant_id')
      .eq('id', user.id)
      .maybeSingle<{ id: string; tenant_id: string | null }>()

    if (!magicUserRow) {
      const insertPayload: DatabaseWithoutInternals['public']['Tables']['users']['Insert'] = {
        id: user.id,
        email: user.email,
        full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
        first_name: user.user_metadata?.first_name || user.email?.split('@')[0] || 'User',
        last_name: user.user_metadata?.last_name || '',
      }
      await supabase.from('users').insert(insertPayload)
    }

    let tenantIdForMagicUser = magicUserRow?.tenant_id ?? null
    if (!tenantIdForMagicUser) {
      const { data: membership } = await supabase
        .from('user_tenants')
        .select('tenant_id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle<{ tenant_id: string | null }>()
      if (membership?.tenant_id) {
        tenantIdForMagicUser = membership.tenant_id
        await supabase
          .from('users')
          .update({ tenant_id: membership.tenant_id })
          .eq('id', user.id)
      }
    }
    const redirectTo = tenantIdForMagicUser ? next : '/onboarding'
    
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
