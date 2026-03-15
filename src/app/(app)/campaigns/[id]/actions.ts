'use server';

import { revalidatePath } from 'next/cache';

import { requireAuthContext } from '@/lib/auth/server';
import { MEDIA_BUCKET } from '@/lib/constants';
import { toMidnightLondon } from '@/lib/campaigns/time-utils';
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
  meta_campaign_id: string | null;
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
  meta_ad_id: string | null;
  name: string;
  headline: string;
  primary_text: string;
  description: string;
  cta: string;
  media_asset_id: string | null;
}

interface AdSetRow {
  id: string;
  meta_adset_id: string | null;
  name: string;
  targeting: Record<string, unknown>;
  optimisation_goal: string;
  bid_strategy: string;
  budget_amount: number | null;
  phase_start: string | null;
  phase_end: string | null;
  adset_media_asset_id: string | null;
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
 * Partial-failure resume: if meta_campaign_id / meta_adset_id / meta_ad_id are
 * already set the corresponding Meta object is skipped — allowing the Retry
 * button to pick up where a previous attempt left off.
 *
 * On any error a best-effort rollback pauses all created Meta objects and
 * resets the local campaign status to DRAFT before returning { error }.
 */
// Fix D7: Map raw Meta error messages to human-readable text.
function mapMetaErrorToUserMessage(message: string): string {
  if (message.includes('Invalid parameter')) {
    return 'Meta rejected the campaign configuration — please check your ad account settings and retry.';
  }
  if (message.includes('Error validating access token') || message.includes('access token')) {
    return 'Your Meta Ads token has expired. Please reconnect your Meta Ads account in Connections.';
  }
  if (message.includes('permission')) {
    return 'Your Meta Ads account does not have permission to create campaigns. Check your Business Manager access.';
  }
  return message;
}

export async function publishCampaign(
  campaignId: string,
): Promise<{ success?: boolean; error?: string }> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  // Track every Meta object id we successfully create so we can roll back.
  const createdMetaObjects: string[] = [];

  // ── 1. Fetch campaign ─────────────────────────────────────────────────────

  const { data: campaign, error: campaignError } = await supabase
    .from('meta_campaigns')
    .select(
      'id, account_id, meta_campaign_id, name, objective, special_ad_category, budget_type, budget_amount, start_date, end_date',
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
    .select(
      'id, meta_adset_id, name, targeting, optimisation_goal, bid_strategy, budget_amount, phase_start, phase_end, adset_media_asset_id, ads(id, meta_ad_id, name, headline, primary_text, description, cta, media_asset_id)',
    )
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

  // Helper: persist publish_error to DB. Best-effort — swallow any DB error.
  const setPublishError = async (message: string) => {
    try {
      await supabase
        .from('meta_campaigns')
        .update({ publish_error: message })
        .eq('id', campaignId);
    } catch {
      // Swallow — we're already in an error path.
    }
  };

  try {
    // ── 6. Create Meta campaign (or resume if already created) ────────────────

    let metaCampaignId: string;

    if (campaign.meta_campaign_id) {
      // Resuming after partial failure — reuse existing Meta campaign.
      metaCampaignId = campaign.meta_campaign_id;
    } else {
      const metaCampaign = await createMetaCampaign({
        accessToken,
        adAccountId,
        name: campaign.name,
        objective: campaign.objective,
        specialAdCategory: campaign.special_ad_category,
        status: 'PAUSED',
      });

      metaCampaignId = metaCampaign.id;
      createdMetaObjects.push(metaCampaignId);

      // Persist meta_campaign_id immediately.
      await supabase
        .from('meta_campaigns')
        .update({ meta_campaign_id: metaCampaignId })
        .eq('id', campaignId);
    }

    // ── 7. Process each ad set ────────────────────────────────────────────────

    let successfulAdSets = 0; // Fix D5: track how many ad sets were successfully created

    for (const adSet of adSets) {
      // Budget: prefer adSet-level, fall back to campaign-level.
      const budgetAmount = adSet.budget_amount ?? Number(campaign.budget_amount);
      const isDaily = campaign.budget_type === 'DAILY';

      let metaAdSetId: string;

      if (adSet.meta_adset_id) {
        // Already published — skip creation, reuse existing ID.
        metaAdSetId = adSet.meta_adset_id;
        successfulAdSets++; // Fix D5: count resumed ad sets as successful
      } else {
        let metaAdSet: { id: string };
        try {
          metaAdSet = await createMetaAdSet({
            accessToken,
            adAccountId,
            campaignId: metaCampaignId,
            name: adSet.name,
            targeting: adSet.targeting,
            optimisationGoal: adSet.optimisation_goal,
            bidStrategy: adSet.bid_strategy,
            dailyBudget: isDaily ? budgetAmount : undefined,
            lifetimeBudget: !isDaily ? budgetAmount : undefined,
            startTime: toMidnightLondon(adSet.phase_start ?? campaign.start_date),
            endTime:
              adSet.phase_end
                ? toMidnightLondon(adSet.phase_end)
                : campaign.end_date
                  ? toMidnightLondon(campaign.end_date)
                  : undefined,
            status: 'PAUSED',
          });
        } catch (adSetError) {
          // Skip ad sets that fail — mark them as DRAFT and continue.
          console.error(`[publishCampaign] Failed to create ad set "${adSet.name}":`, adSetError);
          continue;
        }

        metaAdSetId = metaAdSet.id;
        createdMetaObjects.push(metaAdSetId);
        successfulAdSets++; // Fix D5: increment on successful ad set creation

        await supabase
          .from('ad_sets')
          .update({ meta_adset_id: metaAdSetId, status: 'ACTIVE' })
          .eq('id', adSet.id);
      }

      // ── Process each ad in the set ──────────────────────────────────────────

      const ads: AdRow[] = Array.isArray(adSet.ads) ? adSet.ads : [];

      for (const ad of ads) {
        // Resolve the effective media asset: ad-level override first, then ad-set shared image.
        const effectiveAssetId = ad.media_asset_id ?? adSet.adset_media_asset_id;

        // Skip ads with no creative at either level — leave as DRAFT.
        if (!effectiveAssetId) continue;

        // Skip ads already published on a previous attempt.
        if (ad.meta_ad_id) continue;

        try {
          // Fetch asset storage path.
          const { data: assetRow } = await supabase
            .from('media_assets')
            .select('storage_path')
            .eq('id', effectiveAssetId)
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
            console.error(`[publishCampaign] Failed to sign URL for asset ${effectiveAssetId}`);
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
            adsetId: metaAdSetId,
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

    // ── 8. Guard: ensure at least one ad set was published ───────────────────

    // Fix D5: if ad sets exist but none were created on Meta, abort rather than
    // marking the campaign ACTIVE with zero live ad sets.
    if (adSets.length > 0 && successfulAdSets === 0) {
      const noAdSetsMsg =
        'Campaign created on Meta but no ad sets could be published. This may be a configuration issue — please retry or contact support.';
      await setPublishError(noAdSetsMsg);
      return { error: 'No ad sets published' };
    }

    // ── 9. Mark campaign ACTIVE ───────────────────────────────────────────────

    await supabase
      .from('meta_campaigns')
      .update({ status: 'ACTIVE', meta_status: 'ACTIVE', publish_error: null })
      .eq('id', campaignId);

    revalidatePath('/campaigns');
    revalidatePath(`/campaigns/${campaignId}`);

    return { success: true };
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : 'Failed to publish campaign.';
    const message = mapMetaErrorToUserMessage(rawMessage); // Fix D7: map to user-friendly text

    // Write the error to DB so the detail page can surface it.
    await setPublishError(message);

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
        .from('meta_campaigns')
        .update({ status: 'DRAFT', meta_status: null })
        .eq('id', campaignId);
    } catch (updateErr) {
      console.error('[publishCampaign] Failed to reset campaign status after error:', updateErr);
    }

    return { error: message }; // Fix D7: already mapped to user-friendly text
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
    .from('meta_campaigns')
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
    .from('meta_campaigns')
    .update({ status: 'PAUSED', meta_status: 'PAUSED' })
    .eq('id', campaignId);

  revalidatePath('/campaigns');
  revalidatePath(`/campaigns/${campaignId}`);

  return { success: true };
}
