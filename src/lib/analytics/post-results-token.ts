import type { SupabaseClient } from '@supabase/supabase-js';

import type { ResultsPlatform } from '@/lib/analytics/post-results';
import { getDecryptedToken } from '@/lib/providers/token-helpers';

/**
 * The brand's stored access token for a platform, or null when it has no usable connection.
 * The Instagram "expiring" status is a dead label, not a fault, so it counts as connected.
 */
export async function tokenForPlatform(
  db: SupabaseClient,
  accountId: string,
  platform: ResultsPlatform,
): Promise<string | null> {
  const { data, error } = await db
    .from('social_connections')
    .select('id, status')
    .eq('account_id', accountId)
    .eq('provider', platform)
    .maybeSingle<{ id: string; status: string | null }>();
  if (error) throw new Error(`the ${platform} connection could not be read: ${error.message}`);
  if (!data || (data.status !== 'active' && data.status !== 'expiring')) return null;
  try {
    return await getDecryptedToken(data.id, 'access');
  } catch {
    return null;
  }
}
