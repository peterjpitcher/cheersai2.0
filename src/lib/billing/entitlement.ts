/**
 * Brand entitlement (SPEC-new-customer-readiness §4.1, decision D3).
 *
 * Entitlement is separate from identity and membership: a user keeps every
 * brand they belong to; each brand resolves to one state, and the state
 * decides what may be done in that brand. Pure functions only, so the rules
 * are testable without Stripe or a database.
 */

export type EntitlementState =
  | 'archived'
  | 'suspended'
  | 'comped'
  | 'active'
  | 'trialing'
  | 'past_due_grace'
  | 'lapsed'
  | 'incomplete';

export type Capability =
  | 'read'
  | 'create'
  | 'publish'
  | 'billing'
  | 'export'
  | 'switch_brand';

/** Days after the paid period ends that a past-due brand keeps working. */
export const PAST_DUE_GRACE_DAYS = 7;

export type StripeSubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused';

export interface EntitlementInput {
  archivedAt: string | null;
  billingOverride: 'comped' | 'suspended' | null;
  subscription: {
    status: StripeSubscriptionStatus;
    currentPeriodEnd: string | null;
  } | null;
  now: Date;
}

/** Precedence: archived > suspended > comped > the Stripe-derived state. */
export function resolveEntitlement(input: EntitlementInput): EntitlementState {
  if (input.archivedAt) return 'archived';
  if (input.billingOverride === 'suspended') return 'suspended';
  if (input.billingOverride === 'comped') return 'comped';

  const subscription = input.subscription;
  if (!subscription) return 'incomplete';

  switch (subscription.status) {
    case 'trialing':
      return 'trialing';
    case 'active':
      return 'active';
    case 'past_due': {
      const periodEnd = subscription.currentPeriodEnd ? Date.parse(subscription.currentPeriodEnd) : NaN;
      if (Number.isNaN(periodEnd)) return 'lapsed';
      const graceEnds = periodEnd + PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000;
      return input.now.getTime() <= graceEnds ? 'past_due_grace' : 'lapsed';
    }
    case 'incomplete':
      return 'incomplete';
    case 'canceled':
    case 'unpaid':
    case 'incomplete_expired':
    case 'paused':
      return 'lapsed';
  }
}

const FULL: ReadonlySet<Capability> = new Set(['read', 'create', 'publish', 'billing', 'export', 'switch_brand']);
const HELD: ReadonlySet<Capability> = new Set(['read', 'billing', 'export', 'switch_brand']);

/**
 * The D3 matrix. Held states keep reading, billing (owners only, checked by
 * the caller's role check), export and brand switching, but may not create,
 * generate, upload or start new publishing. Archived brands are not listed to
 * users at all, so they get nothing.
 */
const CAPABILITIES: Record<EntitlementState, ReadonlySet<Capability>> = {
  comped: FULL,
  active: FULL,
  trialing: FULL,
  past_due_grace: FULL,
  lapsed: HELD,
  incomplete: HELD,
  suspended: HELD,
  archived: new Set(),
};

export function can(state: EntitlementState, capability: Capability): boolean {
  return CAPABILITIES[state].has(capability);
}
