import type { BrandFeatures } from '@/lib/auth/types';
import { resolveEntitlement, type EntitlementState, type StripeSubscriptionStatus } from '@/lib/billing/entitlement';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

/**
 * Admin overview data (super-admin only — callers must gate). Reads via the
 * service-role client. Users come from public.user_auth_snapshot (a mirror of
 * auth.users maintained by triggers), avoiding a paged auth.admin.listUsers scan.
 */

export interface AdminBrand {
  accountId: string;
  name: string | null;
  timezone: string;
  archivedAt: string | null;
  /** Whether a per-brand booking-conversion ingest key is set (secret never exposed here). */
  bookingIngestConfigured: boolean;
  features: BrandFeatures;
  billing: AdminBrandBilling;
  /** Set when the operator offboarded the brand (decision D5). */
  offboardedAt: string | null;
  /** Earliest time the brand's data may be deleted. */
  purgeAfter: string | null;
  /** Whether that time has passed (worked out when the overview loads). */
  purgeDue: boolean;
}

export interface AdminBrandBilling {
  /** Operator state: comped (free), suspended (held) or null (Stripe decides). */
  override: 'comped' | 'suspended' | null;
  /** Resolved entitlement (same rules as enforcement, which may still be switched off). */
  state: EntitlementState;
  subscription: { plan: string; status: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean } | null;
  heldPosts: number;
}

export interface AdminUser {
  userId: string;
  email: string | null;
  isSuperAdmin: boolean;
  brandIds: string[];
}

interface SubscriptionRow {
  account_id: string;
  plan: string;
  status: StripeSubscriptionStatus;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  stripe_state_at: string;
}

export async function getAdminOverview(): Promise<{ brands: AdminBrand[]; users: AdminUser[] }> {
  const db = createServiceSupabaseClient();

  const [accounts, snapshots, members, admins, subscriptions, heldJobs] = await Promise.all([
    db.from('accounts').select('id, business_name, timezone, archived_at, booking_ingest_secret, paid_ads_enabled, tournaments_enabled, management_import_enabled, billing_override, offboarded_at, purge_after').order('business_name', { ascending: true }),
    db.from('user_auth_snapshot').select('user_id, email').order('email', { ascending: true }),
    db.from('account_members').select('account_id, user_id'),
    db.from('app_admins').select('user_id'),
    db.from('subscriptions').select('account_id, plan, status, current_period_end, cancel_at_period_end, stripe_state_at'),
    db.from('publish_jobs').select('account_id').eq('status', 'held'),
  ]);

  // Newest subscription per brand (by Stripe's own timestamp).
  const subscriptionByAccount = new Map<string, SubscriptionRow>();
  for (const row of (subscriptions.data ?? []) as SubscriptionRow[]) {
    const current = subscriptionByAccount.get(row.account_id);
    if (!current || row.stripe_state_at > current.stripe_state_at) subscriptionByAccount.set(row.account_id, row);
  }
  const heldByAccount = new Map<string, number>();
  for (const row of (heldJobs.data ?? []) as Array<{ account_id: string }>) {
    heldByAccount.set(row.account_id, (heldByAccount.get(row.account_id) ?? 0) + 1);
  }
  const now = new Date();

  const adminSet = new Set(((admins.data ?? []) as { user_id: string }[]).map((a) => a.user_id));

  const brandIdsByUser = new Map<string, string[]>();
  for (const row of (members.data ?? []) as { account_id: string; user_id: string }[]) {
    const list = brandIdsByUser.get(row.user_id) ?? [];
    list.push(row.account_id);
    brandIdsByUser.set(row.user_id, list);
  }

  const brands: AdminBrand[] = (
    (accounts.data ?? []) as {
      id: string;
      business_name: string | null;
      timezone: string;
      archived_at: string | null;
      booking_ingest_secret: string | null;
      paid_ads_enabled: boolean | null;
      tournaments_enabled: boolean | null;
      management_import_enabled: boolean | null;
      billing_override: 'comped' | 'suspended' | null;
      offboarded_at: string | null;
      purge_after: string | null;
    }[]
  ).map((a) => {
    const subscription = subscriptionByAccount.get(a.id) ?? null;
    return {
    accountId: a.id,
    name: a.business_name,
    timezone: a.timezone,
    archivedAt: a.archived_at,
    bookingIngestConfigured: Boolean(a.booking_ingest_secret),
    features: {
      paidAds: a.paid_ads_enabled === true,
      tournaments: a.tournaments_enabled === true,
      managementImport: a.management_import_enabled === true,
    },
    billing: {
      override: a.billing_override,
      state: resolveEntitlement({
        archivedAt: a.archived_at,
        billingOverride: a.billing_override,
        subscription: subscription ? { status: subscription.status, currentPeriodEnd: subscription.current_period_end } : null,
        now,
      }),
      subscription: subscription
        ? {
            plan: subscription.plan,
            status: subscription.status,
            currentPeriodEnd: subscription.current_period_end,
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
          }
        : null,
      heldPosts: heldByAccount.get(a.id) ?? 0,
    },
    offboardedAt: a.offboarded_at,
    purgeAfter: a.purge_after,
    purgeDue: Boolean(a.purge_after && Date.parse(a.purge_after) <= now.getTime()),
  };
  });

  const users: AdminUser[] = (
    (snapshots.data ?? []) as { user_id: string; email: string | null }[]
  ).map((s) => ({
    userId: s.user_id,
    email: s.email,
    isSuperAdmin: adminSet.has(s.user_id),
    brandIds: brandIdsByUser.get(s.user_id) ?? [],
  }));

  return { brands, users };
}
