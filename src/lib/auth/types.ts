import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Authenticated user shape for v2.
 * Maps from Supabase auth user + accounts table data.
 */
export interface AppUser {
  /** Supabase auth user ID */
  id: string;
  email: string;
  /** accounts table primary key */
  accountId: string;
  businessName: string | null;
  /** Defaults to Europe/London */
  timezone: string;
}

/**
 * Auth context returned by requireAuthContext().
 * Provides authenticated user and a service-role Supabase client for writes.
 *
 * `accountId` is exposed at the top level for backward compatibility with
 * existing server actions that destructure { supabase, accountId }.
 */
export interface AuthContext {
  user: AppUser;
  /** Service-role client for writes -- bypasses RLS */
  supabase: SupabaseClient;
  /** Convenience alias for user.accountId -- backward compat with v1 callers */
  accountId: string;
}
