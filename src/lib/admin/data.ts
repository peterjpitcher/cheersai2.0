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
}

export interface AdminUser {
  userId: string;
  email: string | null;
  isSuperAdmin: boolean;
  brandIds: string[];
}

export async function getAdminOverview(): Promise<{ brands: AdminBrand[]; users: AdminUser[] }> {
  const db = createServiceSupabaseClient();

  const [accounts, snapshots, members, admins] = await Promise.all([
    db.from('accounts').select('id, business_name, timezone, archived_at, booking_ingest_secret').order('business_name', { ascending: true }),
    db.from('user_auth_snapshot').select('user_id, email').order('email', { ascending: true }),
    db.from('account_members').select('account_id, user_id'),
    db.from('app_admins').select('user_id'),
  ]);

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
    }[]
  ).map((a) => ({
    accountId: a.id,
    name: a.business_name,
    timezone: a.timezone,
    archivedAt: a.archived_at,
    bookingIngestConfigured: Boolean(a.booking_ingest_secret),
  }));

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
