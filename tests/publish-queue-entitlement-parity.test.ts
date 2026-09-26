import { describe, expect, it } from 'vitest';

import * as app from '@/lib/billing/entitlement';
import * as worker from '../supabase/functions/publish-queue/entitlement';

/**
 * The publish-queue edge function carries its own copy of the entitlement
 * rules (it cannot import src/). This fails if the copies disagree.
 */
const STATUSES = ['trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'] as const;
const OVERRIDES = [null, 'comped', 'suspended'] as const;
const PERIOD_STARTS = [null, '2026-10-01T00:00:00Z', '2026-10-09T00:00:00Z', '2026-10-20T00:00:00Z', 'not a date'];
const PERIOD_ENDS = [null, '2026-10-01T00:00:00Z', '2026-10-10T00:00:00Z', '2026-10-20T00:00:00Z', '2027-10-01T00:00:00Z'];
const NOWS = [new Date('2026-10-15T12:00:00Z'), new Date('2026-10-27T00:00:01Z')];

describe('publish-queue entitlement copy matches the app', () => {
  it('uses the same grace period', () => {
    expect(worker.PAST_DUE_GRACE_DAYS).toBe(app.PAST_DUE_GRACE_DAYS);
  });

  it('resolves every combination identically and agrees on who may publish', () => {
    let checked = 0;
    for (const archivedAt of [null, '2026-09-01T00:00:00Z']) {
      for (const billingOverride of OVERRIDES) {
        for (const now of NOWS) {
          const subscriptions = [
            null,
            ...STATUSES.flatMap((status) =>
              PERIOD_STARTS.flatMap((currentPeriodStart) => PERIOD_ENDS.map((currentPeriodEnd) => ({ status, currentPeriodStart, currentPeriodEnd }))),
            ),
          ];
          for (const subscription of subscriptions) {
            const input = { archivedAt, billingOverride, subscription, now };
            const appState = app.resolveEntitlement(input);
            expect(worker.resolveEntitlement(input)).toBe(appState);
            expect(worker.mayPublish(appState)).toBe(app.can(appState, 'publish'));
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(2000);
  });

  it('works out the same past-due grace end', () => {
    for (const currentPeriodStart of PERIOD_STARTS) {
      for (const currentPeriodEnd of PERIOD_ENDS) {
        const period = { currentPeriodStart, currentPeriodEnd };
        expect(worker.pastDueGraceEndsAt(period)?.toISOString() ?? null).toBe(app.pastDueGraceEndsAt(period)?.toISOString() ?? null);
      }
    }
  });
});
