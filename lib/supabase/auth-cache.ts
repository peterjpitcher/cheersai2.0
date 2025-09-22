import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { User } from '@supabase/supabase-js'
import { getCookieOptions } from './cookie-options'
import { unstable_noStore as noStore } from 'next/cache'
import type { DatabaseWithoutInternals as GeneratedDatabaseWithoutInternals } from '@/lib/database.types'
import type { Database } from '@/lib/types/database'
import type { SupabaseServerClient } from './server'

export type TenantRecord = Database['public']['Tables']['tenants']['Row'] | null;

interface AuthCacheEntry {
  user: User | null;
  tenantId: string | null;
  tenantData: TenantRecord;
  expires: number;
}

const authCache = new Map<string, AuthCacheEntry>()

// Create Supabase client for server components
export async function createClient(): Promise<SupabaseServerClient> {
  const cookieStore = await cookies()

  return createServerClient<GeneratedDatabaseWithoutInternals>(
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
              cookieStore.set({
                name,
                value,
                ...getCookieOptions(options?.maxAge === 0),
                ...options,
              })
            } catch {
              // Expected when called from contexts without mutable cookies
            }
          }
        },
      },
    }
  ) as unknown as SupabaseServerClient
}

// Fetch fresh auth data with robust tenant detection (falls back to membership)
async function fetchFreshAuth(): Promise<{ user: User | null; tenantId: string | null; tenantData: TenantRecord }> {
  const supabase = await createClient();

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return { user: null, tenantId: null, tenantData: null };
  }

  // Read user profile without joining tenants (avoid RLS join pitfalls)
  const { data: userRow } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single<{ tenant_id: string | null }>();

  let tenantId: string | null = userRow?.tenant_id ?? null;

  // Fall back to user_tenants membership if tenant_id missing
  if (!tenantId) {
    const { data: membership } = await supabase
      .from('user_tenants')
      .select('tenant_id, role')
      .eq('user_id', user.id)
      .order('role', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (membership?.tenant_id) {
      tenantId = membership.tenant_id as string;
      // Best-effort: persist onto users for consistency (ignore failures)
      await supabase.from('users').update({ tenant_id: tenantId }).eq('id', user.id);
    }
  }

  // Fetch tenant data separately (if visible under RLS)
  let tenantData: TenantRecord = null;
  if (tenantId) {
    const { data: tenantRow } = await supabase
      .from('tenants')
      .select('*')
      .eq('id', tenantId)
      .maybeSingle<TenantRecord>();
    tenantData = tenantRow || null;
  }

  return { user, tenantId, tenantData };
}

// Main function to get auth with caching
export async function getAuthWithCache() {
  noStore();
  // For now, skip caching to avoid issues - fetch fresh data each time
  // We can re-enable caching once we verify auth flow works
  const authData = await fetchFreshAuth();
  return authData;
}

// Clear cache for a specific session (e.g., on logout)
export function clearAuthCache(sessionToken?: string) {
  if (sessionToken) {
    authCache.delete(sessionToken);
  } else {
    authCache.clear();
  }
}

// Get only user without tenant data (lighter weight)
export async function getUserOnly() {
  // Fetch from Supabase directly
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  return user;
}

// Get tenant ID without full tenant data
export async function getTenantId(): Promise<string | null> {
  const { tenantId } = await getAuthWithCache();
  return tenantId;
}

// Optimized function for checking if user is authenticated
export async function isAuthenticated(): Promise<boolean> {
  const user = await getUserOnly();
  return !!user;
}
