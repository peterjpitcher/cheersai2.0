import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getCookieOptions } from './cookie-options'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DatabaseWithoutInternals as GeneratedDatabaseWithoutInternals, Database as GeneratedDatabase } from '@/lib/database.types'

export type SupabaseServerClient = SupabaseClient<GeneratedDatabaseWithoutInternals, 'public'>

export async function createClient(): Promise<SupabaseServerClient> {
  const cookieStore = await cookies()

  return createServerClient<GeneratedDatabase>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll().map(({ name, value }) => ({ name, value }))
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            try {
              const remove = options?.maxAge === 0
              cookieStore.set({
                name,
                value,
                ...getCookieOptions(remove),
                ...options,
              })
            } catch {
              // Expected when invoked from server components without response access
            }
          }
        },
      },
    }
  ) as unknown as SupabaseServerClient
}

// Helper function to get the current user with proper validation
export async function getAuthenticatedUser() {
  const supabase = await createClient()
  
  // ALWAYS use getUser() for security - it validates the session with Supabase
  const { data: { user }, error } = await supabase.auth.getUser()
  
  if (error || !user) {
    return null
  }
  
  return user
}

// Service role client for bypassing RLS in OAuth callbacks
export async function createServiceRoleClient() {
  const { createClient } = await import('@supabase/supabase-js')

  return createClient<GeneratedDatabase>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  ) as unknown as SupabaseServerClient
}
