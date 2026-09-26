import { describe, expect, it } from 'vitest';

import { can, PAST_DUE_GRACE_DAYS, pastDueGraceEndsAt, resolveEntitlement, type EntitlementInput } from '@/lib/billing/entitlement';
import { PLANS } from '@/lib/billing/plans';

const NOW = new Date('2026-10-15T12:00:00Z');
const base: EntitlementInput = { archivedAt: null, billingOverride: null, subscription: null, now: NOW };
type Status = NonNullable<EntitlementInput['subscription']>['status'];
const sub = (
  status: Status,
  period: { start?: string | null; end?: string | null } = {},
) => ({
  ...base,
  subscription: {
    status,
    currentPeriodStart: period.start === undefined ? '2026-10-10T00:00:00Z' : period.start,
    currentPeriodEnd: period.end === undefined ? '2026-11-10T00:00:00Z' : period.end,
  },
});

/**
 * Stripe's real past_due shape: the renewal moved the period forward before
 * the payment failed, so the period END is in the future and the START is when
 * the unpaid period began.
 */
const pastDue = (unpaidSince: string, now: Date = NOW) => ({
  ...sub('past_due', { start: unpaidSince, end: '2026-11-20T00:00:00Z' }),
  now,
});

describe('resolveEntitlement precedence', () => {
  it('archived beats everything', () => {
    expect(resolveEntitlement({ ...sub('active'), archivedAt: '2026-10-01T00:00:00Z', billingOverride: 'comped' })).toBe('archived');
  });

  it('suspension overrides a comped or paying brand', () => {
    expect(resolveEntitlement({ ...sub('active'), billingOverride: 'suspended' })).toBe('suspended');
  });

  it('comped needs no subscription', () => {
    expect(resolveEntitlement({ ...base, billingOverride: 'comped' })).toBe('comped');
  });

  it('a brand with no subscription has not finished checkout', () => {
    expect(resolveEntitlement(base)).toBe('incomplete');
  });
});

describe('resolveEntitlement from Stripe status', () => {
  it.each([
    ['trialing', 'trialing'],
    ['active', 'active'],
    ['incomplete', 'incomplete'],
    ['canceled', 'lapsed'],
    ['unpaid', 'lapsed'],
    ['incomplete_expired', 'lapsed'],
    ['paused', 'lapsed'],
  ] as const)('%s -> %s', (status, expected) => {
    expect(resolveEntitlement(sub(status))).toBe(expected);
  });

  it(`keeps a past-due brand working for ${PAST_DUE_GRACE_DAYS} days after the unpaid period starts`, () => {
    // Now is 2026-10-15T12:00Z. Unpaid for 6 days: still in grace.
    expect(resolveEntitlement(pastDue('2026-10-09T12:00:00Z'))).toBe('past_due_grace');
    // Unpaid for 8 days: lapsed, even though the (unpaid) period runs to 20 November.
    expect(resolveEntitlement(pastDue('2026-10-07T12:00:00Z'))).toBe('lapsed');
  });

  it('does not stretch the grace to the end of an annual period', () => {
    const annual = { ...sub('past_due', { start: '2026-10-01T00:00:00Z', end: '2027-10-01T00:00:00Z' }), now: NOW };
    expect(resolveEntitlement(annual)).toBe('lapsed');
  });

  it('measures the grace in absolute time across a clock change (BST ends 25 October)', () => {
    expect(resolveEntitlement(pastDue('2026-10-20T00:00:00Z', new Date('2026-10-27T00:00:00Z')))).toBe('past_due_grace');
    expect(resolveEntitlement(pastDue('2026-10-20T00:00:00Z', new Date('2026-10-27T00:00:01Z')))).toBe('lapsed');
  });

  it('falls back to the period end for a legacy row with no period start', () => {
    const legacy = (now: Date) => ({ ...sub('past_due', { start: null, end: '2026-10-10T00:00:00Z' }), now });
    expect(resolveEntitlement(legacy(NOW))).toBe('past_due_grace');
    expect(resolveEntitlement(legacy(new Date('2026-10-17T00:00:01Z')))).toBe('lapsed');
  });

  it('treats a past-due brand with no usable period dates as lapsed (fail closed)', () => {
    expect(resolveEntitlement(sub('past_due', { start: null, end: null }))).toBe('lapsed');
    expect(resolveEntitlement(sub('past_due', { start: 'not a date' }))).toBe('lapsed');
  });
});

describe('pastDueGraceEndsAt', () => {
  it('is seven days after the unpaid period started', () => {
    expect(pastDueGraceEndsAt({ currentPeriodStart: '2026-10-09T12:00:00Z', currentPeriodEnd: '2026-11-09T12:00:00Z' })?.toISOString()).toBe(
      '2026-10-16T12:00:00.000Z',
    );
  });

  it('uses the period end only when the start is missing', () => {
    expect(pastDueGraceEndsAt({ currentPeriodStart: null, currentPeriodEnd: '2026-10-10T00:00:00Z' })?.toISOString()).toBe('2026-10-17T00:00:00.000Z');
    expect(pastDueGraceEndsAt({ currentPeriodStart: null, currentPeriodEnd: null })).toBeNull();
  });
});

describe('capability matrix (decision D3)', () => {
  it('paying, trialing, grace and comped brands can do everything', () => {
    for (const state of ['active', 'trialing', 'past_due_grace', 'comped'] as const) {
      for (const capability of ['read', 'create', 'publish', 'billing', 'export', 'switch_brand'] as const) {
        expect(can(state, capability)).toBe(true);
      }
    }
  });

  it('held brands keep read, billing and export but cannot create or publish', () => {
    for (const state of ['lapsed', 'incomplete', 'suspended'] as const) {
      expect(can(state, 'read')).toBe(true);
      expect(can(state, 'billing')).toBe(true);
      expect(can(state, 'export')).toBe(true);
      expect(can(state, 'switch_brand')).toBe(true);
      expect(can(state, 'create')).toBe(false);
      expect(can(state, 'publish')).toBe(false);
    }
  });

  it('archived brands get nothing', () => {
    expect(can('archived', 'read')).toBe(false);
  });
});

describe('plans', () => {
  it('match the approved plan table', () => {
    expect(PLANS.starter.limits).toEqual({ postsPerMonth: 120, aiGenerationsPerMonth: 150, storageBytes: 2 * 1024 ** 3, seats: 2 });
    expect(PLANS.professional.limits).toEqual({ postsPerMonth: 400, aiGenerationsPerMonth: 500, storageBytes: 10 * 1024 ** 3, seats: 5 });
    expect([PLANS.starter.monthlyPricePence, PLANS.starter.annualPricePence]).toEqual([2999, 32389]);
    expect([PLANS.professional.monthlyPricePence, PLANS.professional.annualPricePence]).toEqual([5999, 64789]);
    expect(PLANS.group.selfServe).toBe(false);
  });
});
