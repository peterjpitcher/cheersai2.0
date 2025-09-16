import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ok, badRequest, unauthorized, serverError } from '@/lib/http'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json().catch(() => ({})) as { email?: string; password?: string }
    if (!email || !password) {
      return badRequest('validation_error', 'Email and password are required', { fields: ['email','password'] }, request)
    }

    const supabase = await createClient()
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      return unauthorized('Invalid credentials', error.message, request)
    }

    // If email not confirmed, end session and surface message
    if (!data?.user?.email_confirmed_at) {
      try { await supabase.auth.signOut() } catch {}
      return unauthorized('Please confirm your email before signing in.', undefined, request)
    }

    // Cookies are set by the Supabase SSR helper via next/headers cookies API.
    return ok({ success: true }, request)
  } catch (e) {
    return serverError('Unexpected error during password login', undefined, request)
  }
}
