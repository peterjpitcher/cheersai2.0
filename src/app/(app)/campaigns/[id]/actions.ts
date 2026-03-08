'use server';

import { revalidatePath } from 'next/cache';

import { requireAuthContext } from '@/lib/auth/server';
import { MEDIA_BUCKET } from '@/lib/constants';
import {
  createMetaAd,
  createMetaAdCreative,
  createMetaAdSet,
  createMetaCampaign,
  pauseMetaObject,
  uploadMetaImage,
} from '@/lib/meta/marketing';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

// ---------------------------------------------------------------------------
// Local DB row types
// ---------------------------------------------------------------------------

interface CampaignRow {
  id: string;
  account_id: string;
  name: string;
  objective: string;
  special_ad_category: string;
  budget_type: string;
  budget_amount: number;
  start_date: string;
  end_date: string | null;
}

interface AdRow {
  id: string;
  name: string;
  headline: string;
  primary_text: string;
  description: string;
  cta: string;
  media_asset_id: string | null;
}

interface AdSetRow {
  id: string;
  name: string;
  targeting: Record<string, unknown>;
  optimisation_goal: string;
  bid_strategy: string;
  budget_amount: number | null;
  ads: AdRow[];
}

// ---------------------------------------------------------------------------
// publishCampaign
// ---------------------------------------------------------------------------

/**
 * Publishes a DRAFT campaign to Meta Ads Manager.
 *
 * Sequence:
 *  1. Fetch campaign (verify ownership)
 *  2. Fetch ad account token + account id
 *  3. Check token expiry
 *  4. Fetch Facebook page connection for pageId
 *  5. Fetch ad_sets with nested ads
 *  6. Create Meta campaign (PAUSED) — store meta_campaign_id
 *  7. For each ad_set: create Meta ad set, then for each ad with a media asset
 *     upload image → create creative → create ad (ACTIVE)
 *  8. Mark campaign ACTIVE on success
 *
 * On any error a best-effort rollback pauses all created Meta objects and
 * resets the local campaign status to DRAFT before returning { error }.
 */
export async function publishCampaign(
  campaignId: string,
): Promise<{ success?: boolean; error?: string }> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  // Track every Meta object id we successfully create so we can roll back.
  const createdMetaObjects: string[] = [];

  // ── 1. Fetch campaign ─────────────────────────────────────────────────────

  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select(
      'id, account_id, name, objective, special_ad_category, budget_type, budget_amount, start_date, end_date',
    )
    .eq('id', campaignId)
    .eq('account_id', accountId)
    .single<CampaignRow>();

  if (campaignError || !campaign) {
    return { error: campaignError?.message ?? 'Campaign not found.' };
  }

  // ── 2. Fetch ad account (access token + account id) ──────────────────────

  const { data: adAccount } = await supabase
    .from('meta_ad_accounts')
    .select('access_token, meta_account_id')
    .eq('account_id', accountId)
    .single<{ access_token: string; meta_account_id: string }>();

  if (!adAccount?.access_token) {
    return { error: 'Meta Ads account not connected. Please reconnect in Connections.' };
  }

  const { access_token: accessToken, meta_account_id: adAccountId } = adAccount;

  // ── 3. Token expiry check (separate query) ────────────────────────────────

  const { data: tokenRow } = await supabase
    .from('meta_ad_accounts')
    .select('token_expires_at')
    .eq('account_id', accountId)
    .single<{ token_expires_at: string | null }>();

  if (tokenRow?.token_expires_at && new Date(tokenRow.token_expires_at) < new Date()) {
    return {
      error:
        'Your Meta Ads token has expired. Please reconnect your Meta Ads account in Connections.',
    };
  }

  // ── 4. Facebook page connection ───────────────────────────────────────────

  const { data: fbConnection } = await supabase
    .from('social_connections')
    .select('metadata')
    .eq('account_id', accountId)
    .eq('provider', 'facebook')
    .single<{ metadata: { pageId?: string } | null }>();

  const pageId = fbConnection?.metadata?.pageId;
  if (!pageId) {
    return { error: 'Facebook Page not connected. Please connect Facebook in Connections.' };
  }

  // ── 5. Fetch ad_sets with nested ads ──────────────────────────────────────

  // Returns an array of ad_sets for this campaign.
  // We cast via `unknown` to safely handle the array result Supabase returns.
  const adSetsResult = await supabase
    .from('ad_sets')
    .select('id, name, targeting, optimisation_goal, bid_strategy, budget_amount, ads(*)')
    .eq('campaign_id', campaignId);

  const adSets: AdSetRow[] = Array.isArray(adSetsResult?.data) ? (adSetsResult.data as unknown as AdSetRow[]) : [];

  // ── 5b. Fetch link URL for ad creatives ───────────────────────────────────

  const bioProfileResult = await supabase
    .from('link_in_bio_profiles')
    .select('website_url')
    .eq('account_id', accountId)
    .single<{ website_url: string | null }>();

  // Fall back to a generic placeholder if no website is set.
  const linkUrl = bioProfileResult?.data?.website_url ?? 'https://example.com';

  try {
    // ── 6. Create Meta campaign (PAUSED) ──────────────────────────────────────

    const metaCampaign = await createMetaCampaign({
      accessToken,
      adAccountId,
      name: campaign.name,
      objective: campaign.objective,
      specialAdCategory: campaign.special_ad_category,
      status: 'PAUSED',
    });

    createdMetaObjects.push(metaCampaign.id);

    // Persist meta_campaign_id immediately.
    await supabase
      .from('campaigns')
      .update({ meta_campaign_id: metaCampaign.id })
      .eq('id', campaignId);

    // ── 7. Process each ad set ────────────────────────────────────────────────

    for (const adSet of adSets) {
      // Budget: prefer adSet-level, fall back to campaign-level.
      const budgetAmount = adSet.budget_amount ?? Number(campaign.budget_amount);
      const isDaily = campaign.budget_type === 'DAILY';

      let metaAdSet: { id: string };
      try {
        metaAdSet = await createMetaAdSet({
          accessToken,
          adAccountId,
          campaignId: metaCampaign.id,
          name: adSet.name,
          targeting: adSet.targeting,
          optimisationGoal: adSet.optimisation_goal,
          bidStrategy: adSet.bid_strategy,
          dailyBudget: isDaily ? budgetAmount : undefined,
          lifetimeBudget: !isDaily ? budgetAmount : undefined,
          startTime: campaign.start_date,
          endTime: campaign.end_date ?? undefined,
          status: 'PAUSED',
        });
      } catch (adSetError) {
        // Skip ad sets that fail — mark them as DRAFT and continue.
        console.error(`[publishCampaign] Failed to create ad set "${adSet.name}":`, adSetError);
        continue;
      }

      createdMetaObjects.push(metaAdSet.id);

      await supabase
        .from('ad_sets')
        .update({ meta_adset_id: metaAdSet.id, status: 'ACTIVE' })
        .eq('id', adSet.id);

      // ── Process each ad in the set ──────────────────────────────────────────

      const ads: AdRow[] = Array.isArray(adSet.ads) ? adSet.ads : [];

      for (const ad of ads) {
        // Skip ads without a media asset — leave as DRAFT.
        if (!ad.media_asset_id) continue;

        try {
          // Fetch asset storage path.
          const { data: assetRow } = await supabase
            .from('media_assets')
            .select('storage_path')
            .eq('id', ad.media_asset_id)
            .single<{ storage_path: string }>();

          if (!assetRow?.storage_path) continue;

          // Normalise path — strip leading bucket prefix if present.
          const storagePath = assetRow.storage_path.startsWith(`${MEDIA_BUCKET}/`)
            ? assetRow.storage_path.slice(MEDIA_BUCKET.length + 1)
            : assetRow.storage_path;

          // Create a short-lived signed URL for Meta to fetch the image.
          const { data: signed, error: signError } = await supabase.storage
            .from(MEDIA_BUCKET)
            .createSignedUrl(storagePath, 300);

          if (signError || !signed?.signedUrl) {
            console.error(`[publishCampaign] Failed to sign URL for asset ${ad.media_asset_id}`);
            continue;
          }

          // Upload image to Meta and retrieve hash.
          const { hash: imageHash } = await uploadMetaImage(
            adAccountId,
            accessToken,
            signed.signedUrl,
          );

          // Create ad creative.
          const creative = await createMetaAdCreative({
            accessToken,
            adAccountId,
            name: ad.name,
            pageId,
            linkUrl,
            imageHash,
            message: ad.primary_text,
            headline: ad.headline,
            description: ad.description,
            callToActionType: ad.cta,
          });

          createdMetaObjects.push(creative.id);

          await supabase
            .from('ads')
            .update({ meta_creative_id: creative.id })
            .eq('id', ad.id);

          // Create the ad itself.
          const metaAd = await createMetaAd({
            accessToken,
            adAccountId,
            name: ad.name,
            adsetId: metaAdSet.id,
            creativeId: creative.id,
            status: 'ACTIVE',
          });

          createdMetaObjects.push(metaAd.id);

          await supabase
            .from('ads')
            .update({ meta_ad_id: metaAd.id, status: 'ACTIVE' })
            .eq('id', ad.id);
        } catch (adError) {
          // Skip failing ads — leave as DRAFT and continue.
          console.error(`[publishCampaign] Failed to create ad "${ad.name}":`, adError);
        }
      }
    }

    // ── 8. Mark campaign ACTIVE ───────────────────────────────────────────────

    await supabase
      .from('campaigns')
      .update({ status: 'ACTIVE', meta_status: 'ACTIVE' })
      .eq('id', campaignId);

    revalidatePath('/campaigns');
    revalidatePath(`/campaigns/${campaignId}`);

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to publish campaign.';

    // Best-effort rollback: pause all created Meta objects.
    for (const metaObjectId of createdMetaObjects) {
      try {
        await pauseMetaObject(metaObjectId, accessToken);
      } catch (rollbackErr) {
        // Ignore rollback errors — continue trying remaining objects.
        console.error(`[publishCampaign] Rollback failed for ${metaObjectId}:`, rollbackErr);
      }
    }

    // Reset campaign status to DRAFT — swallow any update error.
    try {
      await supabase
        .from('campaigns')
        .update({ status: 'DRAFT', meta_status: null })
        .eq('id', campaignId);
    } catch (updateErr) {
      console.error('[publishCampaign] Failed to reset campaign status after error:', updateErr);
    }

    return { error: message };
  }
}

// ---------------------------------------------------------------------------
// pauseCampaign
// ---------------------------------------------------------------------------

/**
 * Pauses a live campaign by calling the Meta API and updating local status.
 */
export async function pauseCampaign(
  campaignId: string,
): Promise<{ success?: boolean; error?: string }> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  // 1. Fetch campaign — verify ownership and get meta_campaign_id.
  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('meta_campaign_id, account_id')
    .eq('id', campaignId)
    .eq('account_id', accountId)
    .single<{ meta_campaign_id: string | null; account_id: string }>();

  if (campaignError || !campaign) {
    return { error: campaignError?.message ?? 'Campaign not found.' };
  }

  if (!campaign.meta_campaign_id) {
    return { error: 'Campaign has not been published to Meta yet.' };
  }

  // 2. Fetch access token.
  const { data: adAccount } = await supabase
    .from('meta_ad_accounts')
    .select('access_token')
    .eq('account_id', accountId)
    .single<{ access_token: string }>();

  if (!adAccount?.access_token) {
    return { error: 'Meta Ads account not connected. Please reconnect in Connections.' };
  }

  // 3. Pause via Meta API.
  try {
    await pauseMetaObject(campaign.meta_campaign_id, adAccount.access_token);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to pause campaign on Meta.';
    return { error: message };
  }

  // 4. Update local status.
  await supabase
    .from('campaigns')
    .update({ status: 'PAUSED', meta_status: 'PAUSED' })
    .eq('id', campaignId);

  revalidatePath('/campaigns');
  revalidatePath(`/campaigns/${campaignId}`);

  return { success: true };
}
