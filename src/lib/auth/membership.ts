import type { SupabaseClient } from '@supabase/supabase-js';

import { AuthDependencyError } from '@/lib/auth/errors';
import type { BrandSummary } from '@/lib/auth/types';
import { DEFAULT_TIMEZONE } from '@/lib/constants';

/**
 * Membership resolution for multi-brand tenancy.
 *
 * These queries run through the SERVICE-ROLE client (they must see membership
 * rows regardless of RLS), so a query error here is a dependency failure, not
 * an authorisation result -- it is thrown as AuthDependencyError.
 */

interface AccountRow {
  id: string;
  business_name: string | null;
  timezone: string | null;
}

/** Whether the user is a global super-admin (app_admins registry). */
export async function isSuperAdmin(service: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await service
    .from('app_admins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new AuthDependencyError('app_admins lookup failed', error);
  return Boolean(data);
}

/**
 * Load the brands a user can access, ordered by name for a stable default.
 * Super-admins (god-mode) can reach every non-archived brand; everyone else
 * sees only brands they are a member of.
 */
export async function loadBrands(
  service: SupabaseClient,
  userId: string,
  superAdmin: boolean,
): Promise<BrandSummary[]> {
  let rows: AccountRow[];

  if (superAdmin) {
    const { data, error } = await service
      .from('accounts')
      .select('id, business_name, timezone')
      .is('archived_at', null)
      .order('business_name', { ascending: true });
    if (error) throw new AuthDependencyError('accounts lookup failed', error);
    rows = (data as AccountRow[] | null) ?? [];
  } else {
    const { data: memberships, error: membershipError } = await service
      .from('account_members')
      .select('account_id')
      .eq('user_id', userId);
    if (membershipError) throw new AuthDependencyError('account_members lookup failed', membershipError);

    const ids = (memberships ?? []).map((m) => (m as { account_id: string }).account_id);
    if (ids.length === 0) return [];

    const { data, error } = await service
      .from('accounts')
      .select('id, business_name, timezone')
      .in('id', ids)
      .is('archived_at', null)
      .order('business_name', { ascending: true });
    if (error) throw new AuthDependencyError('accounts lookup failed', error);
    rows = (data as AccountRow[] | null) ?? [];
  }

  return rows.map((row) => ({
    accountId: row.id,
    name: row.business_name,
    timezone: row.timezone ?? DEFAULT_TIMEZONE,
  }));
}

/**
 * Choose the active brand: the cookie-selected brand if the user is still a
 * member of it, otherwise the first brand by stable order. Null when the user
 * has no accessible brands.
 */
export function resolveActiveBrand(
  brands: BrandSummary[],
  cookieValue: string | null,
): BrandSummary | null {
  if (brands.length === 0) return null;
  if (cookieValue) {
    const match = brands.find((b) => b.accountId === cookieValue);
    if (match) return match;
  }
  return brands[0];
}
