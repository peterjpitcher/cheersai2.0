import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { User } from '@supabase/supabase-js';

// Cache configuration
const AUTH_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const authCache = new Map<string, { 
  user: User | null; 
  tenantId: string | null;
  tenantData: any;
  expires: number;
}>();

// Create Supabase client for server components
export function createClient() {
  const cookieStore = cookies();
  
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: any) {
          cookieStore.set({ name, value: '', ...options });
        },
      },
    }
  );
}

// Get session token for caching
async function getSessionToken(): Promise<string | null> {
  const cookieStore = cookies();
  const sessionCookie = cookieStore.get('sb-auth-token');
  return sessionCookie?.value || null;
}

// Fetch fresh auth data
async function fetchFreshAuth(sessionToken: string | null) {
  const supabase = createClient();
  
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
  const sessionToken = await getSessionToken();
  
  if (!sessionToken) {
    return { user: null, tenantId: null, tenantData: null };
  }
  
  // Check cache
  const cached = authCache.get(sessionToken);
  if (cached && cached.expires > Date.now()) {
    return {
      user: cached.user,
      tenantId: cached.tenantId,
      tenantData: cached.tenantData,
    };
  }
  
  // Cache miss - fetch fresh data
  const authData = await fetchFreshAuth(sessionToken);
  
  // Update cache
  authCache.set(sessionToken, {
    ...authData,
    expires: Date.now() + AUTH_CACHE_TTL,
  });
  
  // Clean up old entries periodically
  if (Math.random() < 0.1) { // 10% chance to clean up
    const now = Date.now();
    for (const [key, value] of authCache.entries()) {
      if (value.expires < now) {
        authCache.delete(key);
      }
    }
  }
  
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
  const sessionToken = await getSessionToken();
  
  if (!sessionToken) {
    return null;
  }
  
  // Check cache first
  const cached = authCache.get(sessionToken);
  if (cached && cached.expires > Date.now()) {
    return cached.user;
  }
  
  // Fetch from Supabase
  const supabase = createClient();
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