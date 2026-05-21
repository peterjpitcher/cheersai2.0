import { redirect } from 'next/navigation';

import type { AppUser, AuthContext } from '@/lib/auth/types';
import { DEFAULT_TIMEZONE } from '@/lib/constants';
import { isSchemaMissingError } from '@/lib/supabase/errors';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

/**
 * Get the current authenticated user, or null if not signed in.
 *
 * Critical: uses getUser() (NOT getSession()) to validate the JWT server-side.
 * See RESEARCH.md Pitfall 2 -- getSession() does not re-validate the JWT.
 */
export async function getCurrentUser(): Promise<AppUser | null> {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError) {
      // session_not_found or refresh_token_not_found -- user is not authenticated
      if (isSessionError(authError)) {
        return null;
      }
      console.error('[auth] getCurrentUser error:', authError.message);
      return null;
    }

    if (!user) {
      return null;
    }

    // Query accounts table for the user's account
    const accountId = resolveAccountId(user);

    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .select('id, email, business_name, timezone')
      .eq('auth_user_id', user.id)
      .maybeSingle<{
        id: string;
        email: string;
        business_name: string | null;
        timezone: string | null;
      }>();

    if (accountError && !isSchemaMissingError(accountError)) {
      console.error('[auth] account query error:', accountError.message);
      // Fall back to auto-provision below
    }

    if (account) {
      return {
        id: user.id,
        email: user.email ?? account.email,
        accountId: account.id,
        businessName: account.business_name,
        timezone: account.timezone ?? DEFAULT_TIMEZONE,
      };
    }

    // Auto-provision account on first login
    const provisionedAccount = await autoProvisionAccount(
      accountId,
      user.id,
      user.email ?? `${user.id}@placeholder.local`,
    );

    return {
      id: user.id,
      email: user.email ?? provisionedAccount.email,
      accountId: provisionedAccount.id,
      businessName: provisionedAccount.businessName,
      timezone: provisionedAccount.timezone,
    };
  } catch (error) {
    // Next.js throws "Dynamic server usage" during static generation for pages
    // that call cookies()/headers(). This is a control-flow signal, not an auth
    // error -- re-throw so Next.js handles it properly.
    if (error instanceof Error && error.message.includes('Dynamic server usage')) {
      throw error;
    }
    console.error('[auth] getCurrentUser unexpected error:', error);
    return null;
  }
}

/**
 * Require an authenticated user, redirecting to login if not signed in.
 * Returns an AuthContext with the user and a service-role Supabase client.
 *
 * Per AUTH-07: server actions must re-verify auth server-side.
 */
export async function requireAuthContext(): Promise<AuthContext> {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/auth/login');
  }

  // Service-role client for writes -- bypasses RLS
  const supabase = createServiceSupabaseClient();

  return { user, supabase, accountId: user.accountId };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve account ID from user metadata, falling back to user.id.
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

/**
 * Auto-provision an account record on first login.
 * Uses service-role client to bypass RLS for the initial insert.
 */
async function autoProvisionAccount(
  accountId: string,
  authUserId: string,
  email: string,
): Promise<{ id: string; email: string; businessName: string | null; timezone: string }> {
  const defaults = {
    id: accountId,
    auth_user_id: authUserId,
    email,
    business_name: null as string | null,
    timezone: DEFAULT_TIMEZONE,
  };

  try {
    const service = createServiceSupabaseClient();

    // Check if account already exists (race condition guard)
    const { data: existing } = await service
      .from('accounts')
      .select('id, email, business_name, timezone')
      .eq('auth_user_id', authUserId)
      .maybeSingle<{
        id: string;
        email: string;
        business_name: string | null;
        timezone: string | null;
      }>();

    if (existing) {
      return {
        id: existing.id,
        email: existing.email,
        businessName: existing.business_name,
        timezone: existing.timezone ?? DEFAULT_TIMEZONE,
      };
    }

    const { data: inserted, error: insertError } = await service
      .from('accounts')
      .insert(defaults)
      .select('id, email, business_name, timezone')
      .single<{
        id: string;
        email: string;
        business_name: string | null;
        timezone: string | null;
      }>();

    if (insertError) {
      if (isSchemaMissingError(insertError)) {
        // Schema not yet deployed -- return fallback
        return {
          id: accountId,
          email,
          businessName: null,
          timezone: DEFAULT_TIMEZONE,
        };
      }
      console.error('[auth] auto-provision insert error:', insertError.message);
      // Fall through to return defaults
    }

    if (inserted) {
      return {
        id: inserted.id,
        email: inserted.email,
        businessName: inserted.business_name,
        timezone: inserted.timezone ?? DEFAULT_TIMEZONE,
      };
    }
  } catch (error) {
    console.error('[auth] auto-provision error:', error);
  }

  // Fallback: return a minimal AppUser even if DB provisioning fails
  return {
    id: accountId,
    email,
    businessName: null,
    timezone: DEFAULT_TIMEZONE,
  };
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
