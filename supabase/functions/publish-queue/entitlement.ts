/**
 * Worker copy of the brand entitlement rules (SPEC-new-customer-readiness
 * §4.1, decision D3). Deno edge functions cannot import from src/, so this
 * mirrors src/lib/billing/entitlement.ts. tests/publish-queue-entitlement-parity.test.ts
 * fails if the two copies ever disagree: change both together.
 */

export type EntitlementState =
  | "archived"
  | "suspended"
  | "comped"
  | "active"
  | "trialing"
  | "past_due_grace"
  | "lapsed"
  | "incomplete";

export type StripeSubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete"
  | "incomplete_expired"
  | "paused";

/** Days after the unpaid period starts that a past-due brand keeps working. */
export const PAST_DUE_GRACE_DAYS = 7;

const GRACE_MS = PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000;

export interface EntitlementSubscription {
  status: StripeSubscriptionStatus;
  /** Start of the unpaid period for a past-due subscription; null on legacy rows. */
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
}

export interface EntitlementInput {
  archivedAt: string | null;
  billingOverride: "comped" | "suspended" | null;
  subscription: EntitlementSubscription | null;
  now: Date;
}

function parseTime(value: string | null): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

/**
 * PAST_DUE_GRACE_DAYS after the unpaid period started; a legacy row with no
 * period start falls back to the period end. Null when neither date is usable.
 */
export function pastDueGraceEndsAt(
  subscription: Pick<EntitlementSubscription, "currentPeriodStart" | "currentPeriodEnd">,
): Date | null {
  const anchor = subscription.currentPeriodStart !== null
    ? parseTime(subscription.currentPeriodStart)
    : parseTime(subscription.currentPeriodEnd);
  return anchor === null ? null : new Date(anchor + GRACE_MS);
}

export function resolveEntitlement(input: EntitlementInput): EntitlementState {
  if (input.archivedAt) return "archived";
  if (input.billingOverride === "suspended") return "suspended";
  if (input.billingOverride === "comped") return "comped";

  const subscription = input.subscription;
  if (!subscription) return "incomplete";

  switch (subscription.status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due": {
      const graceEnds = pastDueGraceEndsAt(subscription);
      if (!graceEnds) return "lapsed";
      return input.now.getTime() <= graceEnds.getTime() ? "past_due_grace" : "lapsed";
    }
    case "incomplete":
      return "incomplete";
    case "canceled":
    case "unpaid":
    case "incomplete_expired":
    case "paused":
      return "lapsed";
  }
}

const MAY_PUBLISH: ReadonlySet<EntitlementState> = new Set(["comped", "active", "trialing", "past_due_grace"]);

export function mayPublish(state: EntitlementState): boolean {
  return MAY_PUBLISH.has(state);
}
