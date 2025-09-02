import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { User } from '@supabase/supabase-js';
import { getCookieOptions } from './cookie-options';

// Cache configuration
const AUTH_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const authCache = new Map<string, { 
  user: User | null; 
  tenantId: string | null;
  tenantData: any;
  expires: number;
}>();

// Create Supabase client for server components
export async function createClient() {
  const cookieStore = await cookies();
  
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          cookieStore.set({ 
            name, 
            value, 
            ...options,
            ...getCookieOptions()
          });
        },
        remove(name: string, options: any) {
          cookieStore.set({ 
            name, 
            value: '', 
            ...options,
            ...getCookieOptions(true)
          });
        },
      },
    }
  );
}

// Fetch fresh auth data
async function fetchFreshAuth() {
  const supabase = await createClient();
  
  // Get user from Supabase
  const { data: { user }, error } = await supabase.auth.getUser();
  
  if (error || !user) {
    return { user: null, tenantId: null, tenantData: null };
  }
  
  // Get tenant data
  const { data: userData } = await supabase
    .from('users')
    .select('tenant_id, tenants(*)')
    .eq('id', user.id)
    .single();
  
  return {
    user,
    tenantId: userData?.tenant_id || null,
    tenantData: userData?.tenants || null,
  };
}

// Main function to get auth with caching
export async function getAuthWithCache() {
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