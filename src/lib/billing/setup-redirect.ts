import { getBrandEntitlement } from '@/lib/billing/entitlement-server';
import { getCurrentUser } from '@/lib/auth/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

/** Where an owner of a brand that has not set up billing goes to start it. */
export const BILLING_SETUP_PATH = '/settings#billing';
export const DEFAULT_AFTER_PASSWORD_PATH = '/planner';

/**
 * Where to send someone who has just set their password (spec §4.4): an owner
 * whose active brand has not finished billing (state incomplete) goes to the
 * Billing section to start their plan; everyone else, including every comped
 * brand (our own venues) and members, goes to the planner.
 *
 * Navigation only, never access control: any lookup failure falls back to the
 * planner, where the brand's normal checks still apply.
 */
export async function destinationAfterPasswordSet(): Promise<string> {
  try {
    const user = await getCurrentUser();
    if (!user?.activeAccountId || user.role !== 'owner') return DEFAULT_AFTER_PASSWORD_PATH;
    const state = await getBrandEntitlement(createServiceSupabaseClient(), user.activeAccountId);
    return state === 'incomplete' ? BILLING_SETUP_PATH : DEFAULT_AFTER_PASSWORD_PATH;
  } catch (error) {
    console.error('[auth] could not work out the page after setting a password', error);
    return DEFAULT_AFTER_PASSWORD_PATH;
  }
}
