import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * First-run setup progress for a brand (spec §5 Stage 2, piece 2.8).
 *
 * Worked out from data the brand already has, so progress persists across
 * devices and people without a table of its own. The checklist is shown only
 * until the brand's first post has been published (confirmed by Facebook or
 * Instagram), so established brands never see it. One connected channel is
 * enough: Facebook-only and Instagram-only venues can finish.
 */
export interface SetupProgress {
  profile: boolean;
  facebook: boolean;
  instagram: boolean;
  firstPost: boolean;
  /** Show the checklist: nothing has been published yet. */
  show: boolean;
}

export async function getSetupProgress(service: SupabaseClient, accountId: string): Promise<SetupProgress> {
  const [posted, profile, connections] = await Promise.all([
    service
      .from('content_items')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('status', 'posted'),
    service
      .from('brand_profile')
      .select('business_type, business_description')
      .eq('account_id', accountId)
      .maybeSingle<{ business_type: string | null; business_description: string | null }>(),
    service.from('social_connections').select('provider, status').eq('account_id', accountId),
  ]);
  if (posted.error) throw new Error(`content_items lookup failed: ${posted.error.message}`);
  if (profile.error) throw new Error(`brand_profile lookup failed: ${profile.error.message}`);
  if (connections.error) throw new Error(`social_connections lookup failed: ${connections.error.message}`);

  const connected = new Set(
    ((connections.data ?? []) as Array<{ provider: string; status: string }>)
      .filter((row) => row.status === 'active' || row.status === 'expiring')
      .map((row) => row.provider),
  );
  const firstPost = (posted.count ?? 0) > 0;

  return {
    profile: Boolean(profile.data?.business_type?.trim() || profile.data?.business_description?.trim()),
    facebook: connected.has('facebook'),
    instagram: connected.has('instagram'),
    firstPost,
    show: !firstPost,
  };
}
