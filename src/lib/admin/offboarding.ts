import type { SupabaseClient } from '@supabase/supabase-js';

import { countCampaignsThatCanSpend } from '@/lib/campaigns/live-spend';
import { MEDIA_BUCKET } from '@/lib/constants';
import { deleteMetaAdAccountTokens } from '@/lib/meta/ad-account-tokens';

/**
 * Brand offboarding (spec §4.7, decision D5): operator-run, never a customer
 * button. Three separate steps, each refusing when unsafe:
 *
 * 1. offboardBrand: stop everything now. Refused while a Stripe subscription
 *    is still running (cancel it first) or a paid Meta campaign can still
 *    spend (countCampaignsThatCanSpend: ACTIVE in the app or at Meta and not
 *    past its end date), since revoking the token would leave spend running
 *    with no way to pause it.
 *    Scheduled posts become drafts and their jobs are held, every credential
 *    we hold for the brand is deleted (Facebook, Instagram and ads tokens, the
 *    Conversions API token, the booking-ingest key, tournament feed keys and
 *    the management app key), and the brand is archived (hidden from its
 *    users) with purge allowed 30 days later.
 * 2. exportBrandData: a JSON copy of the brand's content, schedule, profile,
 *    link-in-bio and media links, for the owner on request. No credentials.
 * 3. purgeBrand: after purge_after, delete the brand's files, then its rows
 *    (every table cascades from accounts), then any login that belonged only
 *    to this brand. Posts already on Facebook or Instagram stay there.
 *
 * Every step is safe to repeat: offboarded_at is set last, so a run that
 * stops part-way can simply be run again.
 */

export const PURGE_AFTER_DAYS = 30;

/** Rows per read. PostgREST caps a response (1000 by default), so larger sets are paged. */
const PAGE = 1000;

const LIVE_SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'unpaid', 'incomplete', 'paused'];

type Service = SupabaseClient;

/** Every row of a brand's table, read a page at a time in id order. */
async function selectAllForBrand<T>(service: Service, table: string, columns: string, accountId: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await service
      .from(table)
      .select(columns)
      .eq('account_id', accountId)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} lookup failed: ${error.message}`);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

async function listIds(service: Service, table: string, accountId: string): Promise<string[]> {
  return (await selectAllForBrand<{ id: string }>(service, table, 'id', accountId)).map((row) => row.id);
}

/** Run fn over items, a few at a time. */
async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let index = 0; index < items.length; index += size) {
    await Promise.all(items.slice(index, index + size).map(fn));
  }
}

export async function offboardBrand(
  service: Service,
  accountId: string,
  now: Date = new Date(),
): Promise<{ error: string } | { postsStopped: number; connectionsRevoked: number; purgeAfter: string }> {
  const { data: account, error: accountError } = await service
    .from('accounts')
    .select('id, offboarded_at')
    .eq('id', accountId)
    .maybeSingle<{ id: string; offboarded_at: string | null }>();
  if (accountError) throw new Error(`accounts lookup failed: ${accountError.message}`);
  if (!account) return { error: 'Brand not found.' };
  if (account.offboarded_at) return { error: 'This brand has already been offboarded.' };

  const { count: liveSubscriptions, error: subError } = await service
    .from('subscriptions')
    .select('stripe_subscription_id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .in('status', LIVE_SUBSCRIPTION_STATUSES);
  if (subError) throw new Error(`subscriptions lookup failed: ${subError.message}`);
  if ((liveSubscriptions ?? 0) > 0) {
    return { error: 'Cancel the brand\'s Stripe subscription first, then offboard.' };
  }

  // ACTIVE in the app or at Meta, with no end date or one today or later. A
  // campaign that ended months ago stays ACTIVE in the table but cannot spend.
  const liveCampaigns = await countCampaignsThatCanSpend(service, accountId, now);
  if (liveCampaigns > 0) {
    return { error: 'Pause the brand\'s live Meta ad campaigns first, so spend cannot run on after the token is deleted.' };
  }

  const nowIso = now.toISOString();

  // Stop posts: nothing scheduled may go out, even with billing enforcement off.
  const { data: stopped, error: contentError } = await service
    .from('content_items')
    .update({ status: 'draft', updated_at: nowIso })
    .eq('account_id', accountId)
    .in('status', ['scheduled', 'queued'])
    .select('id');
  if (contentError) throw new Error(`content_items update failed: ${contentError.message}`);
  const { error: jobsError } = await service
    .from('publish_jobs')
    .update({ status: 'held', hold_reason: 'entitlement', last_error: 'Brand offboarded.', updated_at: nowIso })
    .eq('account_id', accountId)
    .eq('status', 'queued');
  if (jobsError) throw new Error(`publish_jobs update failed: ${jobsError.message}`);

  // Delete every token we hold for the brand.
  const connectionIds = await listIds(service, 'social_connections', accountId);
  if (connectionIds.length) {
    const { error: vaultError } = await service.from('token_vault').delete().in('social_connection_id', connectionIds);
    if (vaultError) throw new Error(`token_vault delete failed: ${vaultError.message}`);
    const { error: connError } = await service
      .from('social_connections')
      .update({ status: 'needs_action', access_token: null, refresh_token: null, token_expires_at: null, updated_at: nowIso })
      .eq('account_id', accountId);
    if (connError) throw new Error(`social_connections update failed: ${connError.message}`);
  }
  await deleteMetaAdAccountTokens(service, [accountId], ['access', 'conversions_api']);
  const { error: adsError } = await service
    .from('meta_ad_accounts')
    .update({ token_expires_at: null, setup_complete: false })
    .eq('account_id', accountId);
  if (adsError) throw new Error(`meta_ad_accounts update failed: ${adsError.message}`);
  const { error: feedError } = await service
    .from('tournaments')
    .update({ feed_api_key: null, updated_at: nowIso })
    .eq('account_id', accountId);
  if (feedError) throw new Error(`tournaments update failed: ${feedError.message}`);
  // api_key is NOT NULL; a blank key reads as "not configured".
  const { error: managementError } = await service
    .from('management_app_connections')
    .update({ api_key: '', enabled: false })
    .eq('account_id', accountId);
  if (managementError) throw new Error(`management_app_connections update failed: ${managementError.message}`);

  const purgeAfter = new Date(now.getTime() + PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { error: archiveError } = await service
    .from('accounts')
    .update({ archived_at: nowIso, offboarded_at: nowIso, purge_after: purgeAfter, booking_ingest_secret: null })
    .eq('id', accountId);
  if (archiveError) throw new Error(`accounts update failed: ${archiveError.message}`);

  return { postsStopped: stopped?.length ?? 0, connectionsRevoked: connectionIds.length, purgeAfter };
}

/** The brand's own data, for the owner. Media links are signed for 7 days. */
export async function exportBrandData(service: Service, accountId: string): Promise<Record<string, unknown>> {
  const select = async (table: string, columns: string) => {
    const { data, error } = await service.from(table).select(columns).eq('account_id', accountId);
    if (error) throw new Error(`${table} export failed: ${error.message}`);
    return data ?? [];
  };

  // brand_profile and posting_defaults hold one row per brand; the rest are paged.
  const [account, brandProfile, postingDefaults, content, linkInBio, tiles, media] = await Promise.all([
    service.from('accounts').select('business_name, email, timezone, created_at').eq('id', accountId).maybeSingle(),
    select('brand_profile', '*'),
    select('posting_defaults', '*'),
    selectAllForBrand(service, 'content_items', 'id, platform, placement, status, scheduled_for, created_at, content_variants(body, media_ids)', accountId),
    selectAllForBrand(service, 'link_in_bio_profiles', '*', accountId),
    selectAllForBrand(service, 'link_in_bio_tiles', '*', accountId),
    selectAllForBrand(service, 'media_assets', 'id, file_name, media_type, storage_path, uploaded_at', accountId),
  ]);
  if (account.error) throw new Error(`accounts export failed: ${account.error.message}`);

  const mediaRows = media as unknown as Array<{ id: string; file_name: string | null; media_type: string; storage_path: string; uploaded_at: string | null }>;
  const signed = new Map<string, string>();
  for (let index = 0; index < mediaRows.length; index += PAGE) {
    const { data: urls, error } = await service.storage
      .from(MEDIA_BUCKET)
      .createSignedUrls(mediaRows.slice(index, index + PAGE).map((row) => row.storage_path), 7 * 24 * 60 * 60);
    if (error) throw new Error(`media signing failed: ${error.message}`);
    for (const entry of urls ?? []) if (entry.path && entry.signedUrl) signed.set(entry.path, entry.signedUrl);
  }

  return {
    exportedAt: new Date().toISOString(),
    brand: account.data,
    brandProfile,
    postingDefaults,
    posts: content,
    linkInBio: { profiles: linkInBio, tiles },
    media: mediaRows.map((row) => ({
      id: row.id,
      fileName: row.file_name,
      type: row.media_type,
      uploadedAt: row.uploaded_at,
      downloadUrl: signed.get(row.storage_path) ?? null,
    })),
    note: 'Download links expire 7 days after export. Posts already published remain on your Facebook Page and Instagram account.',
  };
}

/** Every storage object that belongs to the brand (see spec §4.7). */
async function brandStoragePaths(service: Service, accountId: string): Promise<string[]> {
  const paths = new Set<string>();

  const media = await selectAllForBrand<{ storage_path: string | null; derived_variants: Record<string, unknown> | null }>(
    service,
    'media_assets',
    'id, storage_path, derived_variants',
    accountId,
  );
  for (const row of media) {
    if (row.storage_path) paths.add(row.storage_path);
    for (const value of Object.values(row.derived_variants ?? {})) {
      if (typeof value === 'string' && value.length) paths.add(value);
    }
  }

  // Storage lists one page at a time; read every page. Folders have no id.
  const listFolder = async (prefix: string) => {
    const entries: Array<{ name: string; id: string | null }> = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await service.storage.from(MEDIA_BUCKET).list(prefix, { limit: PAGE, offset });
      if (error) throw new Error(`storage list failed for ${prefix}: ${error.message}`);
      const page = (data ?? []) as Array<{ name: string; id: string | null }>;
      entries.push(...page);
      if (page.length < PAGE) return entries;
    }
  };
  const addFilesIn = async (folder: string) => {
    for (const file of await listFolder(folder)) {
      if (file.id) paths.add(`${folder}/${file.name}`);
    }
  };

  // The brand's own folder (uploads are {accountId}/{assetId}/file).
  const subfolders: string[] = [];
  for (const entry of await listFolder(accountId)) {
    if (entry.id) paths.add(`${accountId}/${entry.name}`);
    else subfolders.push(`${accountId}/${entry.name}`);
  }
  await inBatches(subfolders, 10, addFilesIn);

  // Rendered banners are filed under each post id (banners/{contentId}/...).
  // Only posts that have a banner folder are listed.
  const postIds = new Set(await listIds(service, 'content_items', accountId));
  const bannerFolders = (await listFolder('banners'))
    .filter((entry) => !entry.id && postIds.has(entry.name))
    .map((entry) => `banners/${entry.name}`);
  await inBatches(bannerFolders, 10, addFilesIn);

  return [...paths];
}

export interface LoginNotDeleted {
  userId: string;
  reason: string;
}

export async function purgeBrand(
  service: Service,
  accountId: string,
  now: Date = new Date(),
): Promise<{ error: string } | { filesDeleted: number; loginsDeleted: number; loginsNotDeleted: LoginNotDeleted[] }> {
  const { data: account, error: accountError } = await service
    .from('accounts')
    .select('id, offboarded_at, purge_after')
    .eq('id', accountId)
    .maybeSingle<{ id: string; offboarded_at: string | null; purge_after: string | null }>();
  if (accountError) throw new Error(`accounts lookup failed: ${accountError.message}`);
  if (!account) return { error: 'Brand not found.' };
  if (!account.offboarded_at || !account.purge_after) return { error: 'Only an offboarded brand can be deleted.' };
  if (now.getTime() < Date.parse(account.purge_after)) {
    return { error: `This brand's data is kept until ${account.purge_after}. It can be deleted after that.` };
  }

  // Logins that belong only to this brand and are not operators.
  const { data: members, error: membersError } = await service
    .from('account_members')
    .select('user_id')
    .eq('account_id', accountId);
  if (membersError) throw new Error(`account_members lookup failed: ${membersError.message}`);
  const memberIds = ((members ?? []) as Array<{ user_id: string }>).map((m) => m.user_id);
  const soleLogins: string[] = [];
  if (memberIds.length) {
    const [{ data: otherMemberships, error: otherError }, { data: admins, error: adminError }] = await Promise.all([
      service.from('account_members').select('user_id').in('user_id', memberIds).neq('account_id', accountId),
      service.from('app_admins').select('user_id').in('user_id', memberIds),
    ]);
    if (otherError) throw new Error(`account_members lookup failed: ${otherError.message}`);
    if (adminError) throw new Error(`app_admins lookup failed: ${adminError.message}`);
    const keep = new Set([...(otherMemberships ?? []), ...(admins ?? [])].map((row) => (row as { user_id: string }).user_id));
    soleLogins.push(...memberIds.filter((id) => !keep.has(id)));
  }

  // Files first: if this fails nothing else has been deleted and it can be retried.
  const paths = await brandStoragePaths(service, accountId);
  for (let index = 0; index < paths.length; index += 100) {
    const { error } = await service.storage.from(MEDIA_BUCKET).remove(paths.slice(index, index + 100));
    if (error) throw new Error(`storage delete failed: ${error.message}`);
  }

  // Paid campaigns go first: ad_sets.adset_media_asset_id points at
  // media_assets with no ON DELETE action, and the accounts cascade reaches
  // media_assets before it reaches ad_sets (via meta_campaigns), which would
  // fail the whole delete. Deleting meta_campaigns cascades to ad_sets.
  const { error: campaignsError } = await service.from('meta_campaigns').delete().eq('account_id', accountId);
  if (campaignsError) throw new Error(`meta_campaigns delete failed: ${campaignsError.message}`);

  // Link-in-bio clicks and page views have no foreign key to the brand, so
  // the cascade would leave them behind.
  const profileIds = await listIds(service, 'link_in_bio_profiles', accountId);
  if (profileIds.length) {
    for (const table of ['link_in_bio_clicks', 'link_in_bio_page_views']) {
      const { error } = await service.from(table).delete().in('profile_id', profileIds);
      if (error) throw new Error(`${table} delete failed: ${error.message}`);
    }
  }

  // Every other brand table cascades from accounts.
  const { error: deleteError } = await service.from('accounts').delete().eq('id', accountId);
  if (deleteError) throw new Error(`accounts delete failed: ${deleteError.message}`);

  // The brand is gone, so a retry cannot reach these logins: report any that
  // fail, with the reason, instead of throwing (see the runbook).
  let loginsDeleted = 0;
  const loginsNotDeleted: LoginNotDeleted[] = [];
  for (const userId of soleLogins) {
    const { error } = await service.auth.admin.deleteUser(userId);
    if (error) loginsNotDeleted.push({ userId, reason: error.message });
    else loginsDeleted++;
  }

  return { filesDeleted: paths.length, loginsDeleted, loginsNotDeleted };
}
