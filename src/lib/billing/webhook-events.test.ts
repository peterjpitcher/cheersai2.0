import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/env', () => ({ env: { server: {}, client: {} } }));

const { OPERATOR_ALERT_EVENT_TYPES, RECONCILE_EVENT_TYPES, SUBSCRIBED_EVENT_TYPES } = await import('./webhook');

const RUNBOOK = readFileSync(path.join(process.cwd(), 'docs/runbooks/stripe-billing.md'), 'utf8');

/** The bulleted event list under "Events to send" in the runbook. */
function runbookEvents(): string[] {
  const section = RUNBOOK.slice(RUNBOOK.indexOf('**Events to send**'), RUNBOOK.indexOf('**Do not enable'));
  return [...section.matchAll(/^\s+- `([a-z_.]+)`$/gm)].map((match) => match[1]);
}

describe('Stripe webhook event subscription', () => {
  it('is exactly the documented list', () => {
    expect([...SUBSCRIBED_EVENT_TYPES].sort()).toEqual(runbookEvents().sort());
    expect(SUBSCRIBED_EVENT_TYPES).toEqual(
      expect.arrayContaining([
        'checkout.session.completed',
        'customer.subscription.created',
        'customer.subscription.updated',
        'customer.subscription.deleted',
        'customer.subscription.paused',
        'customer.subscription.resumed',
        'invoice.paid',
        'invoice.payment_failed',
        'invoice.finalization_failed',
      ]),
    );
    expect(SUBSCRIBED_EVENT_TYPES).toHaveLength(9);
  });

  it('never includes invoice.created or a customer.* event (the Stripe account is shared)', () => {
    expect(SUBSCRIBED_EVENT_TYPES).not.toContain('invoice.created');
    expect(SUBSCRIBED_EVENT_TYPES.filter((type) => type.startsWith('customer.') && !type.startsWith('customer.subscription.'))).toEqual([]);
  });

  it('alerts on invoice finalisation failures instead of reconciling them', () => {
    expect(OPERATOR_ALERT_EVENT_TYPES.has('invoice.finalization_failed')).toBe(true);
    expect(RECONCILE_EVENT_TYPES.has('invoice.finalization_failed')).toBe(false);
  });

  it('documents the endpoint URL and the pinned API version', async () => {
    const { STRIPE_API_VERSION } = await import('./stripe');
    expect(RUNBOOK).toContain('https://cheers.orangejelly.co.uk/api/stripe/webhook');
    expect(RUNBOOK).toContain(STRIPE_API_VERSION);
  });
});
