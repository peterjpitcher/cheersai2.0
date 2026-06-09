/**
 * Phase 3 (3c) — QStash worker for weekly food-window materialisation.
 *
 * Receives one signed message per rolling food campaign from the materialise-food-windows cron,
 * verifies the QStash signature, and extends that campaign by exactly one week of ad sets via
 * materialiseFoodWindowsForCampaign (idempotent: a re-delivered message creates nothing because
 * the target week's service dates are already present).
 *
 * Returns 500 on failure so QStash retries (5m/15m/45m) — same contract as the publish webhook.
 *
 * See docs/plans/2026-06-09-food-booking-phase-3-optimisation-spec.md §5 (3c), P3-4, P3-7.
 */

import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';

import { verifyQStashSignature } from '@/lib/qstash/client';
import { materialiseFoodWindowsForCampaign } from '@/lib/campaigns/food-materialise';
import { withCorrelationId } from '@/lib/logging/correlation';
import { createLogger } from '@/lib/logging';

export const dynamic = 'force-dynamic';

const logger = createLogger('food-materialise-webhook');

interface FoodMaterialisePayload {
  campaignId?: string;
  referenceIso?: string;
}

export async function POST(request: Request): Promise<NextResponse> {
  // Clone before verify — verifyQStashSignature consumes request.text().
  const cloned = request.clone();
  const isValid = await verifyQStashSignature(request);
  if (!isValid) {
    logger.warn('Invalid QStash signature rejected');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const body = (await cloned.json()) as FoodMaterialisePayload;
  const campaignId = body.campaignId;
  const referenceIso = body.referenceIso;
  if (!campaignId || !referenceIso) {
    logger.warn('Missing campaignId or referenceIso in payload', { campaignId, referenceIso });
    return NextResponse.json({ error: 'Missing campaignId or referenceIso' }, { status: 400 });
  }

  return withCorrelationId(async () => {
    const startMs = Date.now();
    logger.info('Materialising food windows', { campaignId, referenceIso });

    try {
      const result = await materialiseFoodWindowsForCampaign({ campaignId, referenceIso });

      // Only bust caches when something actually changed.
      if (result.created > 0) {
        revalidatePath('/campaigns');
        revalidatePath(`/campaigns/${campaignId}`);
      }

      const durationMs = Date.now() - startMs;
      logger.info('Materialisation complete', {
        campaignId,
        created: result.created,
        serviceDates: result.serviceDates,
        durationMs,
      });
      return NextResponse.json({ created: result.created, serviceDates: result.serviceDates });
    } catch (error) {
      const durationMs = Date.now() - startMs;
      logger.error('Materialisation failed', error as Error, { campaignId, durationMs });
      // Return 500 so QStash retries.
      return NextResponse.json({ error: 'Materialisation failed' }, { status: 500 });
    }
  });
}
