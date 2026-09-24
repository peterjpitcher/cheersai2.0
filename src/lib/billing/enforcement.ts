import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The billing-enforcement switch (spec §4.1, §6). It lives in the database
 * (public.app_flags, row 'billing_enforcement') so the Next.js app and the
 * publish-queue edge function read the same value, and so it can be turned
 * off instantly without a deploy. Starts off.
 *
 * A read failure throws: callers are guarded actions, which then fail with
 * an error rather than silently skipping the check.
 */
export const BILLING_ENFORCEMENT_FLAG = 'billing_enforcement';

export async function isBillingEnforcementEnabled(service: SupabaseClient): Promise<boolean> {
  const { data, error } = await service
    .from('app_flags')
    .select('enabled')
    .eq('name', BILLING_ENFORCEMENT_FLAG)
    .maybeSingle<{ enabled: boolean }>();
  if (error) throw new Error(`billing enforcement flag lookup failed: ${error.message}`);
  return data?.enabled === true;
}
