/**
 * Phase 3 (3c) — weekly food-window materialisation cron.
 *
 * Runs weekly (vercel.json: Sun 01:00 UTC). For each ACTIVE, published food_booking campaign it
 * enqueues one QStash job that extends that campaign by one week (the worker at
 * /api/webhooks/qstash-food-materialise does the actual Meta work). Keeping each campaign in its
 * own job keeps every unit small and inside the function timeout, and lets QStash retry per
 * campaign independently.
 *
 * Safety:
 *  - Auth: verifyCronAuth (timing-safe CRON_SECRET) — same as the other crons.
 *  - Gating: when FOOD_AUTO_MATERIALISE_ENABLED is off this route is a PURE NO-OP — it returns
 *    `{ skipped: true }` without loading campaigns or dispatching anything (no Meta, no writes).
 *  - Idempotency: the deduplicationId is `${campaignId}:${isoWeek}`, so re-running the cron in the
 *    same ISO week never enqueues a duplicate job for a campaign; the worker is independently
 *    idempotent via existing-ad-set detection.
 *
 * See docs/plans/2026-06-09-food-booking-phase-3-optimisation-spec.md §5 (3c), P3-4, P3-7.
 */

import { NextResponse } from 'next/server';
import { DateTime } from 'luxon';

import { verifyCronAuth } from '@/lib/security/cron-auth';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { getQStashClient } from '@/lib/qstash/client';
import { createLogger } from '@/lib/logging';
import { featureFlags } from '@/env';
import { env } from '@/env';

export const dynamic = 'force-dynamic';

const logger = createLogger('materialise-food-windows');
const ZONE = 'Europe/London';

interface RollingFoodCampaignRow {
  id: string;
  account_id: string;
}

/** ISO week label (`YYYY-Www`) for a UTC instant, in the London calendar. */
function isoWeekLabelFor(reference: Date): string {
  const dt = DateTime.fromJSDate(reference, { zone: ZONE });
  return `${dt.weekYear}-W${String(dt.weekNumber).padStart(2, '0')}`;
}

async function handle(request: Request): Promise<NextResponse> {
  const auth = verifyCronAuth(request);
  if (!auth.authorised) {
    return NextResponse.json({ error: auth.errorMessage }, { status: auth.errorStatus ?? 401 });
  }

  // Flag OFF (default): pure no-op. No campaign load, no dispatch, no Meta. Disabling the flag
  // is the instant rollback for the whole rolling-materialisation feature.
  if (!featureFlags.foodAutoMaterialise) {
    logger.info('Skipped: FOOD_AUTO_MATERIALISE_ENABLED is off');
    return NextResponse.json({ skipped: true });
  }

  // The request time is the run's reference instant. We read it once here (route boundary) so the
  // worker's window selection stays pure and so every campaign in this run shares one ISO week.
  const referenceDate = new Date();
  const referenceIso = referenceDate.toISOString();
  const isoWeek = isoWeekLabelFor(referenceDate);

  const supabase = createServiceSupabaseClient();
  const { data: campaigns, error } = await supabase
    .from('meta_campaigns')
    .select('id, account_id')
    .eq('campaign_kind', 'food_booking')
    .eq('status', 'ACTIVE')
    .not('meta_campaign_id', 'is', null);

  if (error) {
    logger.error('Failed to load rolling food campaigns', new Error(error.message));
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const client = getQStashClient();
  const baseUrl = env.client.NEXT_PUBLIC_SITE_URL;
  const rows = (campaigns ?? []) as RollingFoodCampaignRow[];

  let dispatched = 0;
  const failed: string[] = [];

  for (const campaign of rows) {
    if (!campaign.id) continue;
    try {
      await client.publishJSON({
        url: `${baseUrl}/api/webhooks/qstash-food-materialise`,
        body: { campaignId: campaign.id, referenceIso },
        retries: 3,
        // Dedup per campaign+week so a re-run in the same ISO week enqueues nothing new.
        deduplicationId: `${campaign.id}:${isoWeek}`,
        headers: { 'Upstash-Forward-Content-Type': 'application/json' },
      });
      dispatched += 1;
    } catch (err) {
      failed.push(campaign.id);
      logger.error(
        'Failed to enqueue materialisation job',
        err instanceof Error ? err : new Error(String(err)),
        { campaignId: campaign.id },
      );
    }
  }

  logger.info('Materialisation cron complete', { isoWeek, dispatched, failed: failed.length });
  return NextResponse.json({ dispatched, failed: failed.length, isoWeek });
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
