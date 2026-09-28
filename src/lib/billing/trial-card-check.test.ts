import type Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryBillingDb } from '../../../tests/helpers/in-memory-billing-db';
import { billingServerEnv, createFakeStripe, fakeSubscription, type FakeStripe, type FakeSubscriptionInput } from '../../../tests/helpers/fake-stripe';

/**
 * Repeat free trials, checked by card (SPEC-self-serve-signup §4.7, L6, P5),
 * run through the real reconcileBrandFromStripe (and, for retries, the real
 * webhook processing) against an in-memory database that enforces the
 * migration's constraints, including the partial unique index on card_hash.
 */

const serverEnv = vi.hoisted(() => ({}) as Record<string, string>);
vi.mock('@/env', () => ({ env: { server: serverEnv, client: { NEXT_PUBLIC_SITE_URL: 'https://cheers.orangejelly.co.uk' } } }));
const logger = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/logging', () => ({ createLogger: () => logger }));
const mockSendEmail = vi.fn();
vi.mock('@/lib/email/resend', () => ({ sendEmail: (...args: unknown[]) => mockSendEmail(...args) }));
// Only the webhook-failure alert writes through logAdminEvent (its own client);
// the refusal's audit row goes through the reconcile's client, checked in the db.
const mockLogAdminEvent = vi.fn();
vi.mock('@/lib/admin/audit', () => ({ logAdminEvent: (...args: unknown[]) => mockLogAdminEvent(...args) }));

const { reconcileBrandFromStripe } = await import('./reconcile');
const { processStripeEvent } = await import('./webhook');
const { BillingNotConfiguredError } = await import('./stripe');
const { NO_CARD_HASH, REFUSAL_TAKEOVER_AFTER_MS, TRIAL_CARD_CHECK_STARTS_AT, TrialCardCheckError, trialCardHash } = await import('./trial-card-check');

const FIRST = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const SECOND = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
const COMPED = '3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f';
const CUSTOMER = { [FIRST]: 'cus_first', [SECOND]: 'cus_second', [COMPED]: 'cus_comped' } as const;
const SHARED_CARD = 'fp_shared_card_4242';
const NOW = new Date('2026-10-01T10:00:00.000Z');
const minutes = (count: number): Date => new Date(NOW.getTime() + count * 60 * 1000);

let db: InMemoryBillingDb;
let fake: FakeStripe;

/** Lets the other reconcile run between polls, as a real one-second wait would. */
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function reconcile(accountId: string, now: Date = NOW) {
  return reconcileBrandFromStripe(accountId, { service: db.client(), stripe: fake.stripe, now: () => now, sleep: tick });
}

function trial(accountId: keyof typeof CUSTOMER, id: string, extra: Partial<FakeSubscriptionInput> = {}): Stripe.Subscription {
  return fakeSubscription({
    id,
    customer: CUSTOMER[accountId],
    status: 'trialing',
    created: '2026-10-01T09:59:00Z',
    trialEnd: '2026-10-15T09:59:00Z',
    currentPeriodStart: '2026-10-01T09:59:00Z',
    currentPeriodEnd: '2026-10-15T09:59:00Z',
    paymentMethod: { fingerprint: SHARED_CARD },
    ...extra,
  });
}

function check(id: string) {
  return db.rows('trial_card_checks').find((row) => row.stripe_subscription_id === id);
}

function stored(id: string) {
  return db.rows('subscriptions').find((row) => row.stripe_subscription_id === id);
}

function refusalAudits() {
  return db.rows('admin_audit').filter((row) => row.action === 'trial_refused_repeat_card');
}

function emailsWithSubject(pattern: RegExp) {
  return mockSendEmail.mock.calls.map(([options]) => options as { subject: string; html: string }).filter((options) => pattern.test(options.subject));
}

/** Holds every retrieve until `count` have arrived, so parallel reconciles all decide at the same moment. */
function gateRetrieves(count: number): void {
  const original = fake.subscriptionsRetrieve.getMockImplementation() as ((...args: unknown[]) => Promise<unknown>) | undefined;
  let arrived = 0;
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  fake.subscriptionsRetrieve.mockImplementation(async (...args: unknown[]) => {
    arrived += 1;
    if (arrived >= count) open();
    await opened;
    return original?.(...args);
  });
}

/** Brand FIRST has already had its free trial on the shared card. */
async function firstBrandHadATrial(): Promise<void> {
  fake.subscriptions.push(trial(FIRST, 'sub_first'));
  expect((await reconcile(FIRST)).state).toBe('trialing');
  expect(check('sub_first')?.outcome).toBe('first_trial');
  vi.clearAllMocks();
  mockSendEmail.mockResolvedValue(undefined);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSendEmail.mockResolvedValue(undefined);
  mockLogAdminEvent.mockResolvedValue(undefined);
  for (const key of Object.keys(serverEnv)) delete serverEnv[key];
  Object.assign(serverEnv, billingServerEnv(), { RESEND_API_KEY: 're_unit', RESEND_FROM: 'Cheers <alerts@example.test>' });
  db = new InMemoryBillingDb();
  db.seed('accounts', [
    { id: FIRST, business_name: 'First Venue', billing_override: null },
    { id: SECOND, business_name: 'Second Venue', billing_override: null },
    { id: COMPED, business_name: 'Comped Venue', billing_override: 'comped' },
  ]);
  db.seed('billing_customers', [
    { account_id: FIRST, stripe_customer_id: CUSTOMER[FIRST] },
    { account_id: SECOND, stripe_customer_id: CUSTOMER[SECOND] },
  ]);
  fake = createFakeStripe();
});

describe('trial card check: first trials', () => {
  it('records a first trial with a keyed code of the card, never the card itself', async () => {
    fake.subscriptions.push(trial(FIRST, 'sub_first'));

    const result = await reconcile(FIRST);

    expect(result).toMatchObject({ state: 'trialing', status: 'trialing', trialRefused: false });
    expect(fake.subscriptionsRetrieve).toHaveBeenCalledWith('sub_first', { expand: ['default_payment_method'] });
    const row = check('sub_first');
    expect(row).toMatchObject({ account_id: FIRST, outcome: 'first_trial', cancelled_at: null });
    expect(row?.card_hash).toBe(trialCardHash(SHARED_CARD, serverEnv.TRIAL_CARD_HASH_KEY));
    expect(row?.card_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(db.tables)).not.toContain(SHARED_CARD);
    expect(fake.subscriptionsCancel).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('decides once per trial: a later event for the same trial makes no Stripe call for the card', async () => {
    fake.subscriptions.push(trial(FIRST, 'sub_first'));
    await reconcile(FIRST);
    await reconcile(FIRST, minutes(5));
    expect(fake.subscriptionsRetrieve).toHaveBeenCalledTimes(1);
    expect(db.rows('trial_card_checks')).toHaveLength(1);
  });

  it('allows a different card on another brand', async () => {
    await firstBrandHadATrial();
    fake.subscriptions.push(trial(SECOND, 'sub_second', { paymentMethod: { fingerprint: 'fp_another_card_5555' } }));

    const result = await reconcile(SECOND);

    expect(result).toMatchObject({ state: 'trialing', trialRefused: false });
    expect(check('sub_second')?.outcome).toBe('first_trial');
    expect(fake.subscriptionsCancel).not.toHaveBeenCalled();
  });

  it('keys the code with TRIAL_CARD_HASH_KEY, so another key gives another code', () => {
    const other = 'f'.repeat(64);
    expect(trialCardHash(SHARED_CARD, serverEnv.TRIAL_CARD_HASH_KEY)).not.toBe(trialCardHash(SHARED_CARD, other));
    expect(trialCardHash(SHARED_CARD, other)).toBe(trialCardHash(SHARED_CARD, other));
  });
});

describe('trial card check: a card that has had a trial before (P5)', () => {
  it('cancels the new trial at once with nothing charged, stores it cancelled before finish(), audits and emails', async () => {
    await firstBrandHadATrial();
    fake.subscriptions.push(trial(SECOND, 'sub_second'));

    const result = await reconcile(SECOND);

    expect(result).toMatchObject({ subscriptionId: 'sub_second', status: 'canceled', state: 'lapsed', trialRefused: true });
    expect(fake.subscriptionsCancel).toHaveBeenCalledTimes(1);
    expect(fake.subscriptionsCancel).toHaveBeenCalledWith('sub_second', { invoice_now: false, prorate: false });
    expect(stored('sub_second')).toMatchObject({ status: 'canceled', account_id: SECOND });
    expect(Date.parse(String(stored('sub_second')?.canceled_at))).not.toBeNaN();
    expect(check('sub_second')).toMatchObject({ account_id: SECOND, outcome: 'repeat_refused', cancelled_at: NOW.toISOString() });
    expect(check('sub_second')?.card_hash).toBe(check('sub_first')?.card_hash);

    expect(refusalAudits()).toEqual([
      expect.objectContaining({
        actor_user_id: null,
        target_account_id: SECOND,
        result: 'success',
        detail: { subscriptionId: 'sub_second', customerId: CUSTOMER[SECOND] },
      }),
    ]);
    const [email] = emailsWithSubject(/Free trial refused for Second Venue/);
    expect(email).toBeDefined();
    expect(email.html).toContain('sub_second');
    for (const secret of [SHARED_CARD, '4242', String(check('sub_second')?.card_hash)]) {
      expect(email.html).not.toContain(secret);
      expect(JSON.stringify(refusalAudits())).not.toContain(secret);
    }

    // The first brand's trial is untouched.
    expect(stored('sub_first')?.status).toBe('trialing');
    expect(check('sub_first')?.outcome).toBe('first_trial');
  });

  it('holds the refused brand: held posts are not released', async () => {
    await firstBrandHadATrial();
    db.seed('publish_jobs', [
      { id: '9a9a9a9a-1111-4111-8111-111111111111', account_id: SECOND, status: 'held', hold_reason: 'entitlement', next_attempt_at: '2026-10-02T09:00:00Z' },
    ]);
    fake.subscriptions.push(trial(SECOND, 'sub_second'));

    expect(await reconcile(SECOND)).toMatchObject({ state: 'lapsed', released: 0 });
    expect(db.rows('publish_jobs')[0].status).toBe('held');
  });

  it('refuses the same card on a second venue of the same business too (one trial per business)', async () => {
    await firstBrandHadATrial();
    // Another brand of the same owner: a separate customer, the same card.
    fake.subscriptions.push(trial(SECOND, 'sub_second_venue'));
    expect((await reconcile(SECOND)).trialRefused).toBe(true);
  });

  it('treats our own cancellation\'s events as done: no second cancel, audit or email', async () => {
    await firstBrandHadATrial();
    fake.subscriptions.push(trial(SECOND, 'sub_second'));
    await reconcile(SECOND);

    // customer.subscription.deleted and .updated for the cancellation arrive next.
    const again = await reconcile(SECOND, minutes(1));

    expect(again).toMatchObject({ status: 'canceled', state: 'lapsed', trialRefused: true });
    expect(fake.subscriptionsCancel).toHaveBeenCalledTimes(1);
    expect(fake.subscriptionsRetrieve).toHaveBeenCalledTimes(1);
    expect(refusalAudits()).toHaveLength(1);
    expect(emailsWithSubject(/Free trial refused/)).toHaveLength(1);
  });

  it('counts "already cancelled" as success when Stripe cancelled but the answer was lost', async () => {
    await firstBrandHadATrial();
    fake.subscriptions.push(trial(SECOND, 'sub_second'));
    fake.subscriptionsCancel.mockImplementationOnce(async (id: string) => {
      Object.assign(fake.subscriptions.find((subscription) => subscription.id === id) ?? {}, { status: 'canceled', canceled_at: Math.floor(NOW.getTime() / 1000) });
      throw new Error('socket hang up');
    });

    expect(await reconcile(SECOND)).toMatchObject({ state: 'lapsed', trialRefused: true });
    expect(check('sub_second')?.cancelled_at).toBe(NOW.toISOString());
  });

  it('records a trial from before the check started, but never refuses it', async () => {
    await firstBrandHadATrial();
    const created = new Date(TRIAL_CARD_CHECK_STARTS_AT.getTime() - 60 * 1000).toISOString();
    fake.subscriptions.push(trial(SECOND, 'sub_old_trial', { created }));

    const result = await reconcile(SECOND);

    expect(result).toMatchObject({ state: 'trialing', trialRefused: false });
    expect(check('sub_old_trial')).toBeUndefined();
    expect(fake.subscriptionsCancel).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/before the card check/), expect.objectContaining({ subscriptionId: 'sub_old_trial' }));
  });

  it('records a pre-check trial whose card is free as the first trial', async () => {
    const created = new Date(TRIAL_CARD_CHECK_STARTS_AT.getTime() - 60 * 1000).toISOString();
    fake.subscriptions.push(trial(FIRST, 'sub_old_trial', { created }));
    await reconcile(FIRST);
    expect(check('sub_old_trial')?.outcome).toBe('first_trial');
  });
});

describe('trial card check: races (events for one Checkout reconcile at once)', () => {
  it('two reconciles of the same new trial on a used card: one decision, exactly one cancel, audit and email', async () => {
    await firstBrandHadATrial();
    fake.subscriptions.push(trial(SECOND, 'sub_second'));
    gateRetrieves(2);

    const results = await Promise.all([reconcile(SECOND), reconcile(SECOND)]);

    expect(fake.subscriptionsRetrieve).toHaveBeenCalledTimes(2);
    expect(fake.subscriptionsCancel).toHaveBeenCalledTimes(1);
    expect(db.rows('trial_card_checks').filter((row) => row.stripe_subscription_id === 'sub_second')).toHaveLength(1);
    expect(check('sub_second')).toMatchObject({ outcome: 'repeat_refused', cancelled_at: NOW.toISOString() });
    expect(refusalAudits()).toHaveLength(1);
    expect(emailsWithSubject(/Free trial refused/)).toHaveLength(1);
    // Both see the cancellation, so neither reports a running trial.
    for (const result of results) expect(result).toMatchObject({ state: 'lapsed', trialRefused: true });
  });

  it('two reconciles of the same new first trial: one row, no cancel', async () => {
    fake.subscriptions.push(trial(FIRST, 'sub_first'));
    gateRetrieves(2);

    const results = await Promise.all([reconcile(FIRST), reconcile(FIRST)]);

    expect(db.rows('trial_card_checks')).toEqual([expect.objectContaining({ stripe_subscription_id: 'sub_first', outcome: 'first_trial' })]);
    expect(fake.subscriptionsCancel).not.toHaveBeenCalled();
    for (const result of results) expect(result).toMatchObject({ state: 'trialing', trialRefused: false });
  });

  it('two brands with one card at the same moment: one first trial, one refusal, one cancel', async () => {
    fake.subscriptions.push(trial(FIRST, 'sub_first'), trial(SECOND, 'sub_second'));
    gateRetrieves(2);

    const [first, second] = await Promise.all([reconcile(FIRST), reconcile(SECOND)]);

    const rows = db.rows('trial_card_checks');
    expect(rows.filter((row) => row.outcome === 'first_trial')).toHaveLength(1);
    expect(rows.filter((row) => row.outcome === 'repeat_refused')).toHaveLength(1);
    const refused = rows.find((row) => row.outcome === 'repeat_refused');
    expect(fake.subscriptionsCancel).toHaveBeenCalledTimes(1);
    expect(fake.subscriptionsCancel).toHaveBeenCalledWith(refused?.stripe_subscription_id, { invoice_now: false, prorate: false });
    expect([first.trialRefused, second.trialRefused].sort()).toEqual([false, true]);
    expect(refusalAudits()).toHaveLength(1);
  });

  it('a parallel reconcile that cannot see the refusal finish gives up with an error, and never cancels itself', async () => {
    await firstBrandHadATrial();
    fake.subscriptions.push(trial(SECOND, 'sub_second'));
    gateRetrieves(2);
    // The deciding reconcile's cancel hangs until released.
    let releaseCancel: () => void = () => undefined;
    const cancelHeld = new Promise<void>((resolve) => {
      releaseCancel = resolve;
    });
    const realCancel = fake.subscriptionsCancel.getMockImplementation() as ((...args: unknown[]) => Promise<unknown>) | undefined;
    fake.subscriptionsCancel.mockImplementationOnce(async (...args: unknown[]) => {
      await cancelHeld;
      return realCancel?.(...args);
    });

    const outcomes = Promise.allSettled([reconcile(SECOND), reconcile(SECOND)]);
    // Let the waiting reconcile use up its polls, then let the cancel through.
    for (let i = 0; i < 60; i += 1) await tick();
    releaseCancel();
    const [a, b] = await outcomes;

    const rejected = [a, b].filter((outcome) => outcome.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(TrialCardCheckError);
    expect(fake.subscriptionsCancel).toHaveBeenCalledTimes(1);
    expect(check('sub_second')?.cancelled_at).toBe(NOW.toISOString());
    expect(refusalAudits()).toHaveLength(1);
  });
});

describe('trial card check: failures throw, and the refusal is finished on a later reconcile', () => {
  it('throws when Stripe cannot give the card, and records nothing', async () => {
    fake.subscriptions.push(trial(FIRST, 'sub_first'));
    fake.subscriptionsRetrieve.mockRejectedValueOnce(new Error('Stripe API unavailable'));
    await expect(reconcile(FIRST)).rejects.toThrow('Stripe API unavailable');
    expect(db.rows('trial_card_checks')).toHaveLength(0);
  });

  it('throws when the restricted key cannot read payment methods (Stripe refuses the expansion)', async () => {
    fake.subscriptions.push(trial(FIRST, 'sub_first'));
    fake.subscriptionsRetrieve.mockRejectedValueOnce(Object.assign(new Error('The provided key does not have the required permissions'), { type: 'StripePermissionError' }));
    await expect(reconcile(FIRST)).rejects.toThrow(/required permissions/);
  });

  it('throws when the check cannot be read or written', async () => {
    fake.subscriptions.push(trial(FIRST, 'sub_first'));
    db.fail('trial_card_checks', 'select', 1);
    await expect(reconcile(FIRST)).rejects.toThrow(/trial_card_checks lookup failed/);
    db.fail('trial_card_checks', 'insert', 1);
    await expect(reconcile(FIRST)).rejects.toThrow(/trial_card_checks insert failed/);
    expect(db.rows('trial_card_checks')).toHaveLength(0);
  });

  it('a failed cancel throws, leaves the refusal open, and a reconcile after the takeover window cancels it', async () => {
    await firstBrandHadATrial();
    fake.subscriptions.push(trial(SECOND, 'sub_second'));
    fake.subscriptionsCancel.mockRejectedValueOnce(new Error('Stripe API unavailable'));

    await expect(reconcile(SECOND)).rejects.toThrow('Stripe API unavailable');
    expect(check('sub_second')).toMatchObject({ outcome: 'repeat_refused', cancelled_at: null });
    expect(fake.subscriptions.find((subscription) => subscription.id === 'sub_second')?.status).toBe('trialing');
    expect(refusalAudits()).toHaveLength(0);

    // A retry inside the window waits for the (dead) first reconcile, then fails again.
    await expect(reconcile(SECOND, minutes(1))).rejects.toBeInstanceOf(TrialCardCheckError);
    expect(fake.subscriptionsCancel).toHaveBeenCalledTimes(1);

    // After it, the next reconcile finishes the refusal.
    const later = minutes(REFUSAL_TAKEOVER_AFTER_MS / 60000 + 1);
    const result = await reconcile(SECOND, later);
    expect(result).toMatchObject({ state: 'lapsed', trialRefused: true });
    expect(fake.subscriptionsCancel).toHaveBeenCalledTimes(2);
    expect(check('sub_second')?.cancelled_at).toBe(later.toISOString());
    expect(refusalAudits()).toHaveLength(1);
    expect(emailsWithSubject(/Free trial refused/)).toHaveLength(1);
  });

  it('a failed audit write or email throws after the cancel; the retry finishes without cancelling again', async () => {
    await firstBrandHadATrial();
    fake.subscriptions.push(trial(SECOND, 'sub_second'));
    db.fail('admin_audit', 'insert', 1);

    await expect(reconcile(SECOND)).rejects.toThrow(/admin_audit insert failed/);
    expect(stored('sub_second')?.status).toBe('canceled');
    expect(check('sub_second')?.cancelled_at).toBeNull();

    mockSendEmail.mockRejectedValueOnce(new Error('Resend API error: down'));
    const later = minutes(REFUSAL_TAKEOVER_AFTER_MS / 60000 + 1);
    await expect(reconcile(SECOND, later)).rejects.toThrow(/Resend API error/);
    expect(check('sub_second')?.cancelled_at).toBeNull();

    const result = await reconcile(SECOND, minutes(REFUSAL_TAKEOVER_AFTER_MS / 60000 + 2));
    expect(result).toMatchObject({ state: 'lapsed', trialRefused: true });
    expect(fake.subscriptionsCancel).toHaveBeenCalledTimes(1);
    expect(check('sub_second')?.cancelled_at).not.toBeNull();
    // At least once, never lost: the audit write that succeeded before the email failed stays.
    expect(refusalAudits().length).toBeGreaterThanOrEqual(1);
  });

  it('a failed cancelled_at write throws; the retry marks it without a second cancel', async () => {
    await firstBrandHadATrial();
    fake.subscriptions.push(trial(SECOND, 'sub_second'));
    db.fail('trial_card_checks', 'update', 1);

    await expect(reconcile(SECOND)).rejects.toThrow(/trial_card_checks update failed/);
    const later = minutes(REFUSAL_TAKEOVER_AFTER_MS / 60000 + 1);
    expect(await reconcile(SECOND, later)).toMatchObject({ trialRefused: true, state: 'lapsed' });
    expect(fake.subscriptionsCancel).toHaveBeenCalledTimes(1);
    expect(check('sub_second')?.cancelled_at).toBe(later.toISOString());
  });

  it('leaves a refused trial that is somehow paid by now to a person, loudly', async () => {
    db.seed('trial_card_checks', [
      { stripe_subscription_id: 'sub_second', account_id: SECOND, card_hash: 'b'.repeat(64), outcome: 'repeat_refused', created_at: '2026-09-15T10:00:00Z' },
    ]);
    fake.subscriptions.push(fakeSubscription({ id: 'sub_second', customer: CUSTOMER[SECOND], status: 'active', created: '2026-09-15T09:59:00Z' }));
    await expect(reconcile(SECOND)).rejects.toThrow(/is now active in Stripe; cancel or keep it by hand/);
    expect(fake.subscriptionsCancel).not.toHaveBeenCalled();
  });

  it('answers 500 through the webhook on a failure, and a redelivery finishes the refusal', async () => {
    await firstBrandHadATrial();
    fake.subscriptions.push(trial(SECOND, 'sub_second'));
    fake.subscriptionsCancel.mockRejectedValueOnce(new Error('Stripe API unavailable'));
    const event = {
      id: 'evt_sub_created',
      object: 'event',
      type: 'customer.subscription.created',
      data: { object: { id: 'sub_second', object: 'subscription', customer: CUSTOMER[SECOND], metadata: { app: 'cheersai', account_id: SECOND } } },
    } as unknown as Stripe.Event;
    const deliver = (at: Date) =>
      processStripeEvent(db.client(), event, {
        reconcile: (accountId) => reconcileBrandFromStripe(accountId, { service: db.client(), stripe: fake.stripe, now: () => at, sleep: tick }),
        now: () => at,
      });

    const first = await deliver(NOW);
    expect(first.status).toBe(500);
    expect(db.rows('stripe_events')[0]).toMatchObject({ processed_at: null, error: 'Stripe API unavailable' });
    expect(emailsWithSubject(/Stripe webhook failing/)).toHaveLength(1);

    const retry = await deliver(minutes(REFUSAL_TAKEOVER_AFTER_MS / 60000 + 1));
    expect(retry).toMatchObject({ status: 200 });
    expect(db.rows('stripe_events')[0].processed_at).toBeTruthy();
    expect(check('sub_second')?.cancelled_at).not.toBeNull();
    expect(stored('sub_second')?.status).toBe('canceled');
    expect(emailsWithSubject(/Free trial refused/)).toHaveLength(1);
  });
});

describe('trial card check: no card to check', () => {
  it('records no_card and emails the operator; the trial carries on', async () => {
    fake.subscriptions.push(trial(FIRST, 'sub_no_card', { paymentMethod: null }));

    const result = await reconcile(FIRST);

    expect(result).toMatchObject({ state: 'trialing', trialRefused: false });
    expect(check('sub_no_card')).toMatchObject({ outcome: 'no_card', card_hash: NO_CARD_HASH });
    expect(emailsWithSubject(/Free trial started with no card to check: First Venue/)).toHaveLength(1);
    expect(fake.subscriptionsCancel).not.toHaveBeenCalled();

    await reconcile(FIRST, minutes(1));
    expect(emailsWithSubject(/no card to check/)).toHaveLength(1);
  });

  it('treats a payment method with no card (Link) as no card', async () => {
    fake.subscriptions.push(trial(FIRST, 'sub_link', { paymentMethod: { type: 'link' } }));
    await reconcile(FIRST);
    expect(check('sub_link')?.outcome).toBe('no_card');
  });

  it('when the email fails, removes the row and throws, so the retry records and emails again', async () => {
    fake.subscriptions.push(trial(FIRST, 'sub_no_card', { paymentMethod: null }));
    mockSendEmail.mockRejectedValueOnce(new Error('Resend API error: down'));

    await expect(reconcile(FIRST)).rejects.toThrow(/Resend API error/);
    expect(check('sub_no_card')).toBeUndefined();

    await reconcile(FIRST, minutes(1));
    expect(check('sub_no_card')?.outcome).toBe('no_card');
    expect(emailsWithSubject(/no card to check/)).toHaveLength(2);
  });
});

describe('trial card check: existing brands are unaffected', () => {
  it('a comped brand with no Stripe customer: no Stripe call at all', async () => {
    const result = await reconcile(COMPED);
    expect(result).toMatchObject({ outcome: 'no_customer', state: 'comped', trialRefused: false });
    expect(fake.subscriptionsList).not.toHaveBeenCalled();
    expect(fake.subscriptionsRetrieve).not.toHaveBeenCalled();
    expect(db.queries.some((query) => query.table === 'trial_card_checks')).toBe(false);
  });

  it('a comped brand with one cancelled test subscription: no card lookup, no cancel, nothing written', async () => {
    db.seed('billing_customers', [{ account_id: COMPED, stripe_customer_id: CUSTOMER[COMPED] }]);
    fake.subscriptions.push(
      fakeSubscription({ id: 'sub_test_cancelled', customer: CUSTOMER[COMPED], status: 'canceled', trialEnd: '2026-10-12T08:03:36Z', canceledAt: '2026-09-28T09:00:00Z' }),
    );

    const result = await reconcile(COMPED);

    expect(result).toMatchObject({ state: 'comped', trialRefused: false });
    expect(fake.subscriptionsRetrieve).not.toHaveBeenCalled();
    expect(fake.subscriptionsCancel).not.toHaveBeenCalled();
    expect(db.writes.filter((write) => write.table === 'trial_card_checks' || write.table === 'admin_audit')).toEqual([]);
  });

  it('an active paid subscription is never checked', async () => {
    fake.subscriptions.push(fakeSubscription({ id: 'sub_paid', customer: CUSTOMER[FIRST], status: 'active', paymentMethod: { fingerprint: SHARED_CARD } }));
    await reconcile(FIRST);
    expect(fake.subscriptionsRetrieve).not.toHaveBeenCalled();
    expect(db.rows('trial_card_checks')).toHaveLength(0);
  });

  it('every trial_card_checks query is scoped to the brand', async () => {
    await firstBrandHadATrial();
    fake.subscriptions.push(trial(SECOND, 'sub_second'));
    db.queries.length = 0;
    await reconcile(SECOND);
    const checks = db.queries.filter((query) => query.table === 'trial_card_checks' && query.op !== 'insert');
    expect(checks.length).toBeGreaterThan(2);
    for (const query of checks) expect(query.eq).toContainEqual(['account_id', SECOND]);
  });
});

describe('trial card check: configuration', () => {
  it('treats a missing TRIAL_CARD_HASH_KEY as billing not set up', async () => {
    delete serverEnv.TRIAL_CARD_HASH_KEY;
    await expect(reconcile(FIRST)).rejects.toBeInstanceOf(BillingNotConfiguredError);
  });

  it('treats a malformed key as missing and logs it without the key', async () => {
    serverEnv.TRIAL_CARD_HASH_KEY = 'not-a-hex-key';
    await expect(reconcile(FIRST)).rejects.toBeInstanceOf(BillingNotConfiguredError);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('not-a-hex-key');
  });
});
