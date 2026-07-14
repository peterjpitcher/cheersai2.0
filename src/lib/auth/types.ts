import type { SupabaseClient } from '@supabase/supabase-js';

/** A brand (accounts row) the user can access, used to render the switcher. */
export interface BrandSummary {
  /** accounts table primary key */
  accountId: string;
  /** Brand name (accounts.business_name); may be null for un-named legacy rows */
  name: string | null;
  /** Defaults to Europe/London */
  timezone: string;
}

/**
 * Authenticated user shape for v2 (multi-brand).
 * Maps from the Supabase auth user + the ACTIVE brand's accounts row.
 */
export interface AppUser {
  /** Supabase auth user ID */
  id: string;
  email: string;
  /**
   * The ACTIVE brand's accounts primary key. Null when the user has zero
   * accessible brands (they are routed to /no-access before any brand-scoped
   * page renders). Alias of `activeAccountId`, kept so existing callers that
   * read `user.accountId` keep compiling.
   */
  accountId: string | null;
  /** Explicit active-brand id (same value as accountId); null when no brands. */
  activeAccountId: string | null;
  /** Active brand's name (accounts.business_name). */
  businessName: string | null;
  /** Active brand's timezone; defaults to Europe/London. */
  timezone: string;
  /** Every brand the user can access (member brands, or all for a super-admin). */
  brands: BrandSummary[];
  /** Global super-admin (god-mode) flag. */
  isSuperAdmin: boolean;
}

/**
 * Auth context returned by requireAuthContext().
 * Provides the authenticated user and a service-role Supabase client for writes.
 *
 * `accountId` is exposed at the top level for backward compatibility with
 * existing server actions that destructure { supabase, accountId }. It is
 * NON-NULL here: requireAuthContext redirects a zero-brand user to /no-access
 * before returning, so callers can rely on an active brand being present.
 */
export interface AuthContext {
  user: AppUser;
  /** Service-role client for writes -- bypasses RLS */
  supabase: SupabaseClient;
  /** The active brand id (non-null). Convenience alias for activeAccountId. */
  accountId: string;
  /** The active brand id (non-null). */
  activeAccountId: string;
  /** Every brand the user can access. */
  brands: BrandSummary[];
  /** Global super-admin (god-mode) flag. */
  isSuperAdmin: boolean;
}
