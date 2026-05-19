/**
 * Recurring auto-publish cron endpoint (06-05, SCHED-04).
 * Runs every 15 minutes via QStash scheduled trigger.
 *
 * Two-step process:
 * 1. materialiseRecurringCampaigns() — generate any due content slots
 * 2. dispatchRecurringPublishes() — dispatch due auto_confirm items to QStash
 *
 * Auth: CRON_SECRET in Authorization Bearer header or x-cron-secret header.
 */

import { NextResponse } from 'next/server';

import { materialiseRecurringCampaigns } from '@/lib/scheduling/materialise';
import { dispatchRecurringPublishes } from '@/lib/publishing/recurring-dispatch';

export const dynamic = 'force-dynamic';

/**
 * Normalise auth header by stripping "Bearer " prefix.
 */
function normaliseAuthHeader(value: string | null): string {
  if (!value) return '';
  return value.replace(/^Bearer\s+/i, '').trim();
}

// POST /api/cron/recurring-publish
// Schedule: every 15 minutes (cron: 0,15,30,45 * * * *)
// Purpose: materialise recurring campaign slots, then dispatch due auto-confirm items
export async function POST(request: Request): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }

  const xCronSecret = request.headers.get('x-cron-secret')?.trim();
  const authHeader = normaliseAuthHeader(request.headers.get('authorization'));
  const headerSecret = xCronSecret || authHeader;
  const urlSecret = new URL(request.url).searchParams.get('secret')?.trim();

  if (headerSecret !== cronSecret && urlSecret !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Step 1: Materialise any due recurring campaign slots
    await materialiseRecurringCampaigns();

    // Step 2: Dispatch due auto_confirm items to QStash
    const result = await dispatchRecurringPublishes();

    return NextResponse.json({
      materialised: true,
      dispatched: result.dispatched,
      skipped: result.skipped,
      errors: result.errors,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[recurring-publish] Cron failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
