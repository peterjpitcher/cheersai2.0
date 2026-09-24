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

export const PAST_DUE_GRACE_DAYS = 7;

export interface EntitlementInput {
  archivedAt: string | null;
  billingOverride: "comped" | "suspended" | null;
  subscription: { status: StripeSubscriptionStatus; currentPeriodEnd: string | null } | null;
  now: Date;
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
      const periodEnd = subscription.currentPeriodEnd ? Date.parse(subscription.currentPeriodEnd) : NaN;
      if (Number.isNaN(periodEnd)) return "lapsed";
      const graceEnds = periodEnd + PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000;
      return input.now.getTime() <= graceEnds ? "past_due_grace" : "lapsed";
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
