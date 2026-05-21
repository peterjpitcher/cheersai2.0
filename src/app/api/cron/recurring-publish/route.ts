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
import { verifyCronAuth } from '@/lib/security/cron-auth';

export const dynamic = 'force-dynamic';

// POST /api/cron/recurring-publish
// Schedule: every 15 minutes (cron: 0,15,30,45 * * * *)
// Purpose: materialise recurring campaign slots, then dispatch due auto-confirm items
export async function POST(request: Request): Promise<NextResponse> {
  const auth = verifyCronAuth(request);
  if (!auth.authorised) {
    return NextResponse.json({ error: auth.errorMessage }, { status: auth.errorStatus ?? 401 });
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
