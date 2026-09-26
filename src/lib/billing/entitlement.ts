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

/** Days after the unpaid period starts that a past-due brand keeps working. */
export const PAST_DUE_GRACE_DAYS = 7;

const GRACE_MS = PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000;

export type StripeSubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused';

/**
 * Stripe statuses where a subscription still runs, or still waits on a
 * payment, and so can still bill the customer.
 */
export const LIVE_SUBSCRIPTION_STATUSES: ReadonlySet<StripeSubscriptionStatus> = new Set<StripeSubscriptionStatus>([
  'trialing',
  'active',
  'past_due',
  'unpaid',
  'paused',
  'incomplete',
]);

export function isLiveSubscriptionStatus(status: string): boolean {
  return LIVE_SUBSCRIPTION_STATUSES.has(status as StripeSubscriptionStatus);
}

export interface EntitlementSubscription {
  status: StripeSubscriptionStatus;
  /**
   * Start of the current billing period. When a renewal payment fails, Stripe
   * has already moved the period forward, so for a past-due subscription this
   * is the start of the unpaid period. Null on rows stored before the column
   * existed.
   */
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
}

export interface EntitlementInput {
  archivedAt: string | null;
  billingOverride: 'comped' | 'suspended' | null;
  subscription: EntitlementSubscription | null;
  now: Date;
}

function parseTime(value: string | null): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

/**
 * When a past-due brand stops working: PAST_DUE_GRACE_DAYS after the unpaid
 * period started. Measured in absolute time, so a clock change does not move
 * it. A legacy row with no period start falls back to the period end (the old
 * rule) so it never loses access early. Null when neither date is usable; the
 * caller then treats the brand as lapsed (fail closed).
 */
export function pastDueGraceEndsAt(subscription: Pick<EntitlementSubscription, 'currentPeriodStart' | 'currentPeriodEnd'>): Date | null {
  const anchor = subscription.currentPeriodStart !== null
    ? parseTime(subscription.currentPeriodStart)
    : parseTime(subscription.currentPeriodEnd);
  return anchor === null ? null : new Date(anchor + GRACE_MS);
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
      const graceEnds = pastDueGraceEndsAt(subscription);
      if (!graceEnds) return 'lapsed';
      return input.now.getTime() <= graceEnds.getTime() ? 'past_due_grace' : 'lapsed';
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
