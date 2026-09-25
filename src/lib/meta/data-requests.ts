import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Acting on Meta data-deletion and deauthorise callbacks (spec §4.8, M2).
 *
 * Meta identifies the person by their app-scoped user id, which we record on
 * social_connections and meta_ad_accounts at connection time. For each match
 * we delete the stored tokens (vault rows and any plaintext columns), mark the
 * connection as needing a reconnect, and forget the Meta user id. Posts
 * already published on Facebook or Instagram stay there: they belong to the
 * Page, and the person can remove them on Meta.
 *
 * Deauthorise only revokes connections made before Meta issued the request,
 * so a reconnection that raced the callback is never undone.
 */

export type MetaRequestKind = 'deletion' | 'deauthorise';

export interface RevokeResult {
  connectionsRevoked: number;
  adAccountsRevoked: number;
}

export async function revokeMetaUserData(
  service: SupabaseClient,
  metaUserId: string,
  options: { kind: MetaRequestKind; issuedAt: Date | null },
): Promise<RevokeResult> {
  let connectionsQuery = service
    .from('social_connections')
    .select('id, last_synced_at')
    .eq('meta_user_id', metaUserId);
  if (options.kind === 'deauthorise' && options.issuedAt) {
    connectionsQuery = connectionsQuery.lte('last_synced_at', options.issuedAt.toISOString());
  }
  const { data: connections, error: connectionsError } = await connectionsQuery;
  if (connectionsError) throw new Error(`social_connections lookup failed: ${connectionsError.message}`);

  const connectionIds = ((connections ?? []) as Array<{ id: string }>).map((row) => row.id);
  if (connectionIds.length) {
    const { error: vaultError } = await service.from('token_vault').delete().in('social_connection_id', connectionIds);
    if (vaultError) throw new Error(`token_vault delete failed: ${vaultError.message}`);

    const { error: updateError } = await service
      .from('social_connections')
      .update({
        status: 'needs_action',
        access_token: null,
        refresh_token: null,
        token_expires_at: null,
        meta_user_id: null,
        updated_at: new Date().toISOString(),
      })
      .in('id', connectionIds);
    if (updateError) throw new Error(`social_connections update failed: ${updateError.message}`);
  }

  // meta_ad_accounts keeps no reconnection timestamp, so deauthorise revokes
  // every match; the owner reconnects ads if they still want them.
  // access_token is NOT NULL (default ''), so it is blanked rather than nulled.
  const { data: adAccounts, error: adLookupError } = await service
    .from('meta_ad_accounts')
    .update({ access_token: '', token_expires_at: null, setup_complete: false, meta_user_id: null })
    .eq('meta_user_id', metaUserId)
    .select('id');
  if (adLookupError) throw new Error(`meta_ad_accounts update failed: ${adLookupError.message}`);

  return { connectionsRevoked: connectionIds.length, adAccountsRevoked: adAccounts?.length ?? 0 };
}

export async function recordMetaDataRequest(
  service: SupabaseClient,
  row: {
    kind: MetaRequestKind;
    confirmationCode: string;
    status: 'completed' | 'no_match' | 'failed';
    result?: RevokeResult;
    detail?: string;
    issuedAt: Date | null;
  },
): Promise<void> {
  const { error } = await service.from('meta_data_requests').insert({
    kind: row.kind,
    confirmation_code: row.confirmationCode,
    status: row.status,
    connections_revoked: row.result?.connectionsRevoked ?? 0,
    ad_accounts_revoked: row.result?.adAccountsRevoked ?? 0,
    detail: row.detail ?? null,
    meta_issued_at: row.issuedAt?.toISOString() ?? null,
  });
  if (error) throw new Error(`meta_data_requests insert failed: ${error.message}`);
}

export async function latestMetaDataRequest(
  service: SupabaseClient,
  confirmationCode: string,
): Promise<{ status: 'completed' | 'no_match' | 'failed'; createdAt: string; connectionsRevoked: number; adAccountsRevoked: number } | null> {
  const { data, error } = await service
    .from('meta_data_requests')
    .select('status, created_at, connections_revoked, ad_accounts_revoked')
    .eq('confirmation_code', confirmationCode)
    .eq('kind', 'deletion')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ status: 'completed' | 'no_match' | 'failed'; created_at: string; connections_revoked: number; ad_accounts_revoked: number }>();
  if (error) throw new Error(`meta_data_requests lookup failed: ${error.message}`);
  if (!data) return null;
  return {
    status: data.status,
    createdAt: data.created_at,
    connectionsRevoked: data.connections_revoked,
    adAccountsRevoked: data.ad_accounts_revoked,
  };
}

/** Meta sends issued_at in seconds since the epoch. */
export function issuedAtFromPayload(issuedAt: unknown): Date | null {
  return typeof issuedAt === 'number' && Number.isFinite(issuedAt) ? new Date(issuedAt * 1000) : null;
}
