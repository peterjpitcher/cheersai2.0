import type { SupabaseClient } from '@supabase/supabase-js';

import { AuthDependencyError } from '@/lib/auth/errors';
import { requireAuthContext } from '@/lib/auth/server';
import type { AuthContext } from '@/lib/auth/types';

/**
 * Who may use "Download my data" and "Ask us to close this venue" in Settings
 * (tasks/SPEC-self-serve-signup.md, section 5, "Later (P10)").
 *
 * Only a real owner of the active brand: an account_members row with role
 * 'owner'. requireAuthContext maps a super-admin to 'owner' in every brand,
 * which is right for running the app but not here: an operator exporting under
 * the customer's quota, or asking to close the customer's venue (with the
 * confirmation going to the operator and the real owner's request then held
 * back for a day), is not the customer asking. Operators export from Admin.
 */

/**
 * Whether the login has an owner membership row for the brand. Throws on a
 * database error so the caller can fail closed.
 */
export async function isBrandOwnerMember(service: SupabaseClient, accountId: string, userId: string): Promise<boolean> {
  const { data, error } = await service
    .from('account_members')
    .select('role')
    .eq('account_id', accountId)
    .eq('user_id', userId)
    .maybeSingle<{ role: string | null }>();
  if (error) throw new Error(`account_members lookup failed: ${error.message}`);
  return data?.role === 'owner';
}

/**
 * requireAuthContext for the two owner actions. A signed-out visitor is still
 * redirected (Next's redirect is rethrown); a failed membership or brand
 * lookup (AuthDependencyError) comes back as 'unavailable' so the caller can
 * show the owner an error with our address and alert the operator, instead of
 * Next's bare 500.
 */
export async function ownerActionContext(): Promise<AuthContext | { unavailable: string }> {
  try {
    return await requireAuthContext();
  } catch (error) {
    if (error instanceof AuthDependencyError) return { unavailable: error.message };
    throw error;
  }
}
