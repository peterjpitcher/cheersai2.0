import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getCookieOptions } from './cookie-options'

export async function createClient() {
  const cookieStore = await cookies()
  type OverrideOptions = Partial<ReturnType<typeof getCookieOptions>> & Record<string, unknown>

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
        set(name: string, value: string, options: OverrideOptions = {}) {
          try {
            cookieStore.set({ 
              name, 
              value, 
              ...options,
              ...getCookieOptions()
            })
          } catch (_error) {
            // The `set` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
        remove(name: string, options: OverrideOptions = {}) {
          try {
            cookieStore.set({ 
              name, 
              value: '', 
              ...options,
              ...getCookieOptions(true)
            })
          } catch (_error) {
            // Expected in Server Components
          }
        },
      },
    }
  )
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
  
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  )
}
