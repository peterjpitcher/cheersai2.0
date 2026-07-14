import { redirect } from 'next/navigation';

import { readActiveBrandCookie } from '@/lib/auth/active-brand';
import { AuthDependencyError } from '@/lib/auth/errors';
import { isSuperAdmin, loadBrands, resolveActiveBrand } from '@/lib/auth/membership';
import type { AppUser, AuthContext } from '@/lib/auth/types';
import { DEFAULT_TIMEZONE } from '@/lib/constants';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

/**
 * Get the current authenticated user (with their brands + active brand), or
 * null if not signed in.
 *
 * Critical: uses getUser() (NOT getSession()) to validate the JWT server-side.
 * See RESEARCH.md Pitfall 2 -- getSession() does not re-validate the JWT.
 *
 * Error taxonomy (multi-brand): a NULL return means "not authenticated". A
 * dependency failure (membership/account/admin query error) is THROWN as
 * AuthDependencyError so it surfaces as a service error, rather than silently
 * logging an authenticated user out.
 */
export async function getCurrentUser(): Promise<AppUser | null> {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError) {
      // session_not_found / refresh_token_not_found -- user is not authenticated
      if (isSessionError(authError)) {
        return null;
      }
      console.error('[auth] getCurrentUser error:', authError.message);
      return null;
    }

    if (!user) {
      return null;
    }

    // Resolve brands + active brand via the service-role client. Query errors
    // here throw AuthDependencyError (see catch below) rather than returning
    // null, so an outage is not mistaken for a logout.
    const service = createServiceSupabaseClient();
    const superAdmin = await isSuperAdmin(service, user.id);
    const brands = await loadBrands(service, user.id, superAdmin);
    const cookieValue = await readActiveBrandCookie();
    const active = resolveActiveBrand(brands, cookieValue);

    return {
      id: user.id,
      email: user.email ?? '',
      accountId: active?.accountId ?? null,
      activeAccountId: active?.accountId ?? null,
      businessName: active?.name ?? null,
      timezone: active?.timezone ?? DEFAULT_TIMEZONE,
      brands,
      isSuperAdmin: superAdmin,
    };
  } catch (error) {
    // Next.js throws "Dynamic server usage" during static generation for pages
    // that read cookies()/headers(). This is a control-flow signal -- re-throw.
    if (error instanceof Error && error.message.includes('Dynamic server usage')) {
      throw error;
    }
    // A genuine dependency failure must surface as an error, not a logout.
    if (error instanceof AuthDependencyError) {
      console.error('[auth] getCurrentUser dependency error:', error.message, error.cause);
      throw error;
    }
    console.error('[auth] getCurrentUser unexpected error:', error);
    return null;
  }
}

/**
 * Require an authenticated user WITH an active brand, redirecting otherwise.
 * Returns an AuthContext with a service-role Supabase client and the verified
 * active brand.
 *
 * Per AUTH-07: server actions must re-verify auth server-side.
 */
export async function requireAuthContext(): Promise<AuthContext> {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/auth/login');
  }

  // Authenticated but assigned no brand -> a distinct state from "logged out".
  if (!user.activeAccountId) {
    redirect('/no-access');
  }

  // Service-role client for writes -- bypasses RLS. Tenant isolation is enforced
  // by the verified active-brand accountId, never a caller-supplied value.
  const supabase = createServiceSupabaseClient();

  return {
    user,
    supabase,
    accountId: user.activeAccountId,
    activeAccountId: user.activeAccountId,
    brands: user.brands,
    isSuperAdmin: user.isSuperAdmin,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve an account id from user metadata, falling back to user.id.
 *
 * Retained for the streaming API route which has only the auth user in context;
 * it is NOT used for active-brand resolution (that is cookie + membership based,
 * see getCurrentUser). Slated for replacement by a request-aware resolver when
 * the streaming route is migrated to requireApiAuthContext.
 */
export function resolveAccountId(user: {
  id: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
}): string {
  const appMetadataAccountId = readAccountId(user.app_metadata);
  if (appMetadataAccountId) return appMetadataAccountId;
  return user.id;
}

function readAccountId(
  metadata: Record<string, unknown> | undefined,
): string | null {
  if (!metadata) return null;
  const candidate = metadata['account_id'] ?? metadata['accountId'];
  if (typeof candidate !== 'string') return null;
  const trimmed = candidate.trim();
  return trimmed.length ? trimmed : null;
}

function isSessionError(
  error: { name?: string; status?: number; message?: string; code?: string } | null | undefined,
): boolean {
  if (!error) return false;
  if (error.name === 'AuthSessionMissingError') return true;
  if (error.code === 'refresh_token_not_found') return true;
  if (error.code === 'session_not_found') return true;

  const message = (error.message ?? '').toLowerCase();
  if (error.status === 400 && message.includes('session missing')) return true;
  if (message.includes('invalid refresh token')) return true;
  if (message.includes('refresh token not found')) return true;

  return false;
}
