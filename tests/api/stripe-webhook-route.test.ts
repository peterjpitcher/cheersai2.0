import Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryBillingDb } from '../helpers/in-memory-billing-db';
import { billingServerEnv } from '../helpers/fake-stripe';

const serverEnv = vi.hoisted(() => ({}) as Record<string, string>);
vi.mock('@/env', () => ({ env: { server: serverEnv, client: { NEXT_PUBLIC_SITE_URL: 'https://cheers.orangejelly.co.uk' } } }));

const logger = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/logging', () => ({ createLogger: () => logger }));

const dbRef = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/lib/supabase/service', () => ({ createServiceSupabaseClient: () => dbRef.current }));

const mockReconcile = vi.fn();
vi.mock('@/lib/billing/reconcile', () => ({ reconcileBrandFromStripe: (...args: unknown[]) => mockReconcile(...args) }));

const mockSendEmail = vi.fn();
vi.mock('@/lib/email/resend', () => ({ sendEmail: (...args: unknown[]) => mockSendEmail(...args) }));
const mockAudit = vi.fn();
vi.mock('@/lib/admin/audit', () => ({ logAdminEvent: (...args: unknown[]) => mockAudit(...args) }));

const { POST } = await import('@/app/api/stripe/webhook/route');

const BRAND = '6f1d2c3b-4a59-4e68-8d7c-9b0a1f2e3d4c';
const CHEERS_CUSTOMER = 'cus_test_cheers';
const MANAGEMENT_APP_CUSTOMER = 'cus_test_management';

let db: InMemoryBillingDb;

function event(id: string, type: string, object: Record<string, unknown>): string {
  return JSON.stringify({ id, object: 'event', type, api_version: '2026-08-26.dahlia', created: 1790420000, data: { object } });
}

function signedRequest(payload: string, secret = serverEnv.STRIPE_WEBHOOK_SECRET): Request {
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  return new Request('https://cheers.orangejelly.co.uk/api/stripe/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    body: payload,
  });
}

const subscriptionUpdated = (id = 'evt_1', customer = CHEERS_CUSTOMER) =>
  event(id, 'customer.subscription.updated', { id: 'sub_1', object: 'subscription', customer, metadata: { app: 'cheersai', account_id: BRAND } });

function storedEvent(id: string) {
  return db.rows('stripe_events').find((row) => row.id === id);
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(serverEnv)) delete serverEnv[key];
  Object.assign(serverEnv, billingServerEnv());
  db = new InMemoryBillingDb();
  db.seed('accounts', [{ id: BRAND, business_name: 'New Venue' }]);
  db.seed('billing_customers', [{ account_id: BRAND, stripe_customer_id: CHEERS_CUSTOMER }]);
  dbRef.current = db.client();
  mockReconcile.mockResolvedValue({ outcome: 'synced', subscriptionId: 'sub_1', status: 'active', state: 'active', released: 0, stillHeld: 0 });
  mockSendEmail.mockResolvedValue(undefined);
  mockAudit.mockResolvedValue(undefined);
});

describe('POST /api/stripe/webhook: trust', () => {
  it('answers 503 (never a silent success) when billing is not configured', async () => {
    delete serverEnv.STRIPE_WEBHOOK_SECRET;
    const response = await POST(signedRequest(subscriptionUpdated(), 'whsec_unit_test_secret'));
    expect(response.status).toBe(503);
    expect(db.rows('stripe_events')).toHaveLength(0);
    expect(logger.error).toHaveBeenCalled();
  });

  it('rejects a missing signature with 400 and stores nothing', async () => {
    const request = new Request('https://cheers.orangejelly.co.uk/api/stripe/webhook', { method: 'POST', body: subscriptionUpdated() });
    expect((await POST(request)).status).toBe(400);
    expect(db.rows('stripe_events')).toHaveLength(0);
  });

  it('rejects a bad signature with 400 and stores nothing', async () => {
    const response = await POST(signedRequest(subscriptionUpdated(), 'whsec_someone_else'));
    expect(response.status).toBe(400);
    expect(db.rows('stripe_events')).toHaveLength(0);
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it('rejects a body changed after signing', async () => {
    const signature = Stripe.webhooks.generateTestHeaderString({ payload: subscriptionUpdated(), secret: serverEnv.STRIPE_WEBHOOK_SECRET });
    const tampered = new Request('https://cheers.orangejelly.co.uk/api/stripe/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': signature },
      body: subscriptionUpdated('evt_1', MANAGEMENT_APP_CUSTOMER),
    });
    expect((await POST(tampered)).status).toBe(400);
  });
});

describe('POST /api/stripe/webhook: processing', () => {
  it('stores the event, reconciles the brand from Stripe and marks it processed', async () => {
    const response = await POST(signedRequest(subscriptionUpdated()));

    expect(response.status).toBe(200);
    expect(mockReconcile).toHaveBeenCalledWith(BRAND, expect.objectContaining({ service: expect.anything() }));
    expect(storedEvent('evt_1')).toMatchObject({ type: 'customer.subscription.updated', error: null });
    expect(storedEvent('evt_1')?.processed_at).toBeTruthy();
  });

  it('handles checkout, subscription and invoice events for a CheersAI customer', async () => {
    const types = [
      'checkout.session.completed',
      'customer.subscription.created',
      'customer.subscription.deleted',
      'invoice.paid',
      'invoice.payment_failed',
    ];
    for (const [index, type] of types.entries()) {
      const response = await POST(signedRequest(event(`evt_${index}`, type, { id: `obj_${index}`, customer: CHEERS_CUSTOMER, client_reference_id: BRAND })));
      expect(response.status).toBe(200);
    }
    expect(mockReconcile).toHaveBeenCalledTimes(types.length);
  });

  it('treats a redelivery of a processed event as a no-op', async () => {
    await POST(signedRequest(subscriptionUpdated('evt_dup')));
    const again = await POST(signedRequest(subscriptionUpdated('evt_dup')));

    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ duplicate: true });
    expect(mockReconcile).toHaveBeenCalledTimes(1);
    expect(db.rows('stripe_events')).toHaveLength(1);
  });

  it('ignores an event about a management app customer, but still records it', async () => {
    const response = await POST(signedRequest(subscriptionUpdated('evt_foreign', MANAGEMENT_APP_CUSTOMER).replace(/"metadata":\{[^}]*\}/, '"metadata":{}')));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ignored: true });
    expect(mockReconcile).not.toHaveBeenCalled();
    expect(storedEvent('evt_foreign')).toMatchObject({ error: null });
    expect(storedEvent('evt_foreign')?.processed_at).toBeTruthy();
  });

  it('records a CheersAI-tagged event for an unknown customer as an error, without retrying forever', async () => {
    const response = await POST(signedRequest(subscriptionUpdated('evt_orphan', 'cus_unknown')));
    expect(response.status).toBe(200);
    expect(storedEvent('evt_orphan')?.error).toMatch(/no billing customer/);
    expect(logger.error).toHaveBeenCalled();
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it('records other event types for a CheersAI customer without reconciling', async () => {
    const response = await POST(signedRequest(event('evt_other', 'customer.updated', { id: CHEERS_CUSTOMER, customer: CHEERS_CUSTOMER })));
    expect(response.status).toBe(200);
    expect(mockReconcile).not.toHaveBeenCalled();
    expect(storedEvent('evt_other')?.processed_at).toBeTruthy();
  });

  it('answers 500 when processing fails, keeps the error, logs it and alerts the operator', async () => {
    mockReconcile.mockRejectedValueOnce(new Error('Stripe API unavailable'));

    const response = await POST(signedRequest(subscriptionUpdated('evt_fail')));

    expect(response.status).toBe(500);
    expect(storedEvent('evt_fail')).toMatchObject({ processed_at: null, error: 'Stripe API unavailable' });
    expect(logger.error).toHaveBeenCalled();
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'operator@example.test', required: true }));
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'operator_stripe_webhook_alert' }));
  });

  it('processes a redelivery of an event that failed before', async () => {
    mockReconcile.mockRejectedValueOnce(new Error('Stripe API unavailable'));
    expect((await POST(signedRequest(subscriptionUpdated('evt_retry')))).status).toBe(500);

    const retry = await POST(signedRequest(subscriptionUpdated('evt_retry')));

    expect(retry.status).toBe(200);
    expect(mockReconcile).toHaveBeenCalledTimes(2);
    expect(storedEvent('evt_retry')).toMatchObject({ error: null });
    expect(storedEvent('evt_retry')?.processed_at).toBeTruthy();
  });

  it('sends at most one operator alert a day while events keep failing', async () => {
    // Let the audit write land in the in-memory table, as it would in production.
    mockAudit.mockImplementation(async (params: { action: string; targetAccountId?: string | null }) => {
      db.seed('admin_audit', [{ action: params.action, target_account_id: params.targetAccountId ?? null }]);
    });
    mockReconcile.mockRejectedValue(new Error('still failing'));

    for (const id of ['evt_a', 'evt_b', 'evt_c']) {
      expect((await POST(signedRequest(subscriptionUpdated(id)))).status).toBe(500);
    }

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(db.rows('stripe_events').every((row) => row.error === 'still failing')).toBe(true);
  });

  it('answers 500 without processing when the event cannot be stored (database down)', async () => {
    db.fail('stripe_events', 'insert');
    const response = await POST(signedRequest(subscriptionUpdated('evt_nodb')));
    expect(response.status).toBe(500);
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it('answers 500 when the customer lookup fails, so Stripe retries', async () => {
    db.fail('billing_customers', 'select');
    const response = await POST(signedRequest(subscriptionUpdated('evt_lookup')));
    expect(response.status).toBe(500);
    expect(storedEvent('evt_lookup')?.error).toMatch(/billing_customers lookup failed/);
  });
});
