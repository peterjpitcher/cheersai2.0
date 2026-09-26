import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryBillingDb } from '../../../tests/helpers/in-memory-billing-db';

const mockSendEmail = vi.fn();
vi.mock('@/lib/email/resend', () => ({ sendEmail: (...args: unknown[]) => mockSendEmail(...args) }));

const mockLogAdminEvent = vi.fn();
vi.mock('@/lib/admin/audit', () => ({ logAdminEvent: (...args: unknown[]) => mockLogAdminEvent(...args) }));

const envState = { OPERATOR_ALERT_EMAIL: 'ops@test.example' };
vi.mock('@/env', () => ({ env: { server: envState, client: {} } }));

const { alertPossibleDoubleBilling, alertRepeatedPublishFailures, alertStripeInvoiceFinalizationFailed, alertStripeWebhookFailure } = await import(
  '@/lib/notifications/operator-alerts'
);

type Result = { data: unknown; error: unknown };

function mockService(tables: Record<string, Result>) {
  return {
    from: vi.fn((table: string) => {
      const result = tables[table] ?? { data: null, error: null };
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'gt', 'in', 'limit']) chain[method] = vi.fn(() => chain);
      chain.returns = vi.fn().mockResolvedValue(result);
      chain.maybeSingle = vi.fn().mockResolvedValue(result);
      return chain;
    }),
  };
}

const NOW = new Date('2026-09-24T12:00:00Z');
const jobs = (contentIds: string[]) => ({ data: contentIds.map((id) => ({ content_item_id: id })), error: null });

beforeEach(() => {
  vi.clearAllMocks();
  mockSendEmail.mockResolvedValue(undefined);
  envState.OPERATOR_ALERT_EMAIL = 'ops@test.example';
});

describe('alertRepeatedPublishFailures', () => {
  it('alerts the operator once when a brand reaches 3 failures in 24 hours', async () => {
    const service = mockService({
      publish_jobs: jobs(['c1', 'c2', 'c3', 'c4']),
      content_items: {
        data: [
          { id: 'c1', account_id: 'brand-a' },
          { id: 'c2', account_id: 'brand-a' },
          { id: 'c3', account_id: 'brand-a' },
          { id: 'c4', account_id: 'brand-b' },
        ],
        error: null,
      },
      admin_audit: { data: null, error: null },
      accounts: { data: { business_name: 'The New Venue' }, error: null },
    });

    const result = await alertRepeatedPublishFailures(service as never, NOW);

    expect(result.alerted).toEqual(['brand-a']);
    expect(mockSendEmail).toHaveBeenCalledOnce();
    const email = mockSendEmail.mock.calls[0][0] as { to: string; subject: string; html: string; required: boolean };
    expect(email.to).toBe('ops@test.example');
    expect(email.required).toBe(true);
    expect(email.subject).toBe('[Cheers operator] The New Venue: 3 failed posts in 24 hours');
    for (const bad of ['undefined', 'NaN', 'null']) expect(email.html).not.toContain(bad);
    expect(mockLogAdminEvent).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: null, action: 'operator_publish_failure_alert', targetAccountId: 'brand-a' }),
    );
  });

  it('does not alert again within 24 hours', async () => {
    const service = mockService({
      publish_jobs: jobs(['c1', 'c2', 'c3']),
      content_items: { data: ['c1', 'c2', 'c3'].map((id) => ({ id, account_id: 'brand-a' })), error: null },
      admin_audit: { data: { id: 'previous-alert' }, error: null },
    });

    const result = await alertRepeatedPublishFailures(service as never, NOW);

    expect(result).toEqual({ alerted: [], skipped: ['brand-a'] });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('stays quiet below the threshold', async () => {
    const service = mockService({
      publish_jobs: jobs(['c1', 'c2']),
      content_items: { data: ['c1', 'c2'].map((id) => ({ id, account_id: 'brand-a' })), error: null },
    });
    expect(await alertRepeatedPublishFailures(service as never, NOW)).toEqual({ alerted: [], skipped: [] });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('fails loudly (never silently) when the operator address is missing or the lookup fails', async () => {
    envState.OPERATOR_ALERT_EMAIL = '';
    const service = mockService({
      publish_jobs: jobs(['c1', 'c2', 'c3']),
      content_items: { data: ['c1', 'c2', 'c3'].map((id) => ({ id, account_id: 'brand-a' })), error: null },
      admin_audit: { data: null, error: null },
      accounts: { data: { business_name: 'X' }, error: null },
    });
    await expect(alertRepeatedPublishFailures(service as never, NOW)).rejects.toThrow('OPERATOR_ALERT_EMAIL');

    const broken = mockService({ publish_jobs: { data: null, error: { message: 'db down' } } });
    await expect(alertRepeatedPublishFailures(broken as never, NOW)).rejects.toThrow('db down');
  });
});

describe('Stripe operator alerts: one per brand per 24 hours', () => {
  const BRAND_A = '6f1d2c3b-4a59-4e68-8d7c-9b0a1f2e3d4c';
  const BRAND_B = '7a2e3d4c-5b6a-4f79-9e8d-0c1b2a3f4e5d';
  let db: InMemoryBillingDb;

  beforeEach(() => {
    db = new InMemoryBillingDb();
    // The audit row lands in admin_audit, as it does in production.
    mockLogAdminEvent.mockImplementation(async (params: { action: string; targetAccountId?: string | null; detail?: unknown }) => {
      db.seed('admin_audit', [{ action: params.action, target_account_id: params.targetAccountId ?? null, detail: params.detail ?? null }]);
    });
  });

  const failure = (accountId: string | null, eventId: string) =>
    alertStripeWebhookFailure(db.client(), { eventId, eventType: 'invoice.paid', message: 'Stripe API unavailable', accountId }, NOW);

  it('throttles per brand, so one brand failing never hides another', async () => {
    expect(await failure(BRAND_A, 'evt_1')).toBe('sent');
    expect(await failure(BRAND_A, 'evt_2')).toBe('skipped');
    expect(await failure(BRAND_B, 'evt_3')).toBe('sent');
    expect(mockSendEmail).toHaveBeenCalledTimes(2);
    expect(db.rows('admin_audit').map((row) => row.target_account_id)).toEqual([BRAND_A, BRAND_B]);
  });

  it('keeps unknown customers in their own bucket', async () => {
    expect(await failure(BRAND_A, 'evt_1')).toBe('sent');
    expect(await failure(null, 'evt_2')).toBe('sent');
    expect(await failure(null, 'evt_3')).toBe('skipped');
    expect(await failure(BRAND_B, 'evt_4')).toBe('sent');
    expect(mockSendEmail).toHaveBeenCalledTimes(3);
  });

  it('alerts again for a brand once 24 hours have passed', async () => {
    db.seed('admin_audit', [{ action: 'operator_stripe_webhook_alert', target_account_id: BRAND_A, created_at: '2026-09-23T11:59:59Z' }]);
    expect(await failure(BRAND_A, 'evt_1')).toBe('sent');
  });

  it('throttles invoice and double-billing alerts separately from webhook failures', async () => {
    expect(await failure(BRAND_A, 'evt_1')).toBe('sent');
    const invoice = () =>
      alertStripeInvoiceFinalizationFailed(
        db.client(),
        { eventId: 'evt_inv', invoiceId: 'in_1', customerId: 'cus_a', accountId: BRAND_A, reason: 'Customer address is required for tax' },
        NOW,
      );
    expect(await invoice()).toBe('sent');
    expect(await invoice()).toBe('skipped');
    const doubleBilling = () =>
      alertPossibleDoubleBilling(db.client(), { accountId: BRAND_A, customerId: 'cus_a', subscriptionIds: ['sub_1', 'sub_2'] }, NOW);
    expect(await doubleBilling()).toBe('sent');
    expect(await doubleBilling()).toBe('skipped');
    const emails = mockSendEmail.mock.calls.map((call) => (call[0] as { subject: string; html: string }));
    expect(emails[1].subject).toMatch(/could not finalise/);
    expect(emails[1].html).toContain('Customer address is required for tax');
    expect(emails[2].subject).toMatch(/Possible double billing/);
    expect(emails[2].html).toContain('sub_1, sub_2');
  });

  it('fails loudly when the audit lookup fails', async () => {
    db.fail('admin_audit', 'select');
    await expect(failure(BRAND_A, 'evt_1')).rejects.toThrow(/admin_audit lookup failed/);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
