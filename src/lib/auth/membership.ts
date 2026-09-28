import type { SupabaseClient } from '@supabase/supabase-js';

import { AuthDependencyError } from '@/lib/auth/errors';
import type { BrandFeatures, BrandRole, BrandSummary } from '@/lib/auth/types';
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
  paid_ads_enabled: boolean | null;
  tournaments_enabled: boolean | null;
  management_import_enabled: boolean | null;
}

const ACCOUNT_COLUMNS =
  'id, business_name, timezone, paid_ads_enabled, tournaments_enabled, management_import_enabled';

/** Every feature switch off: the default for a brand, and for a user with no brand. */
export const NO_FEATURES: BrandFeatures = Object.freeze({
  paidAds: false,
  tournaments: false,
  managementImport: false,
});

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
 * Load the brands a user can access, ordered by name (the switcher's display
 * order). Super-admins (god-mode) can reach every non-archived brand; everyone
 * else sees only brands they are a member of. Each brand carries when the user
 * joined it, which decides the default brand (resolveActiveBrand).
 */
export async function loadBrands(
  service: SupabaseClient,
  userId: string,
  superAdmin: boolean,
): Promise<BrandSummary[]> {
  let rows: AccountRow[];
  // Super-admins act as owner in every brand (god mode).
  const roleByAccount = new Map<string, BrandRole>();
  const joinedAtByAccount = new Map<string, string>();

  // The user's own memberships, for everyone: a super-admin's own brands come
  // before the brands they only see as super-admin when choosing a default.
  const { data: memberships, error: membershipError } = await service
    .from('account_members')
    .select('account_id, role, created_at')
    .eq('user_id', userId);
  if (membershipError) throw new AuthDependencyError('account_members lookup failed', membershipError);

  const memberRows = (memberships ?? []) as Array<{ account_id: string; role: string | null; created_at: string | null }>;
  for (const m of memberRows) {
    // Anything other than an explicit member role is treated as owner, matching
    // the column default (D4: every existing membership became an owner).
    roleByAccount.set(m.account_id, m.role === 'member' ? 'member' : 'owner');
    if (m.created_at) joinedAtByAccount.set(m.account_id, m.created_at);
  }

  if (superAdmin) {
    const { data, error } = await service
      .from('accounts')
      .select(ACCOUNT_COLUMNS)
      .is('archived_at', null)
      .order('business_name', { ascending: true });
    if (error) throw new AuthDependencyError('accounts lookup failed', error);
    rows = (data as AccountRow[] | null) ?? [];
  } else {
    const ids = memberRows.map((m) => m.account_id);
    if (ids.length === 0) return [];

    const { data, error } = await service
      .from('accounts')
      .select(ACCOUNT_COLUMNS)
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
    features: {
      paidAds: row.paid_ads_enabled === true,
      tournaments: row.tournaments_enabled === true,
      managementImport: row.management_import_enabled === true,
    },
    role: superAdmin ? 'owner' : roleByAccount.get(row.id) ?? 'member',
    joinedAt: joinedAtByAccount.get(row.id) ?? null,
  }));
}

function joinedTime(brand: BrandSummary): number | null {
  if (!brand.joinedAt) return null;
  const time = Date.parse(brand.joinedAt);
  return Number.isNaN(time) ? null : time;
}

/**
 * Choose the active brand: the cookie-selected brand if the user can still
 * reach it; otherwise the brand the user joined first (spec §4.6), so a new
 * membership never changes anyone's default. A super-admin's own memberships
 * come before brands they only see as super-admin; with none, the first by
 * name. Ties keep the name order. Null when the user has no accessible brands.
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
  let first: BrandSummary | null = null;
  let firstTime = Number.POSITIVE_INFINITY;
  for (const brand of brands) {
    const time = joinedTime(brand);
    if (time !== null && time < firstTime) {
      first = brand;
      firstTime = time;
    }
  }
  return first ?? brands[0];
}
