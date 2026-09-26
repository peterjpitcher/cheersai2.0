"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { useToast } from "@/components/providers/toast-provider";
import { Button } from "@/components/ui/button";
import { checkBillingAgain, openBillingPortal, startCheckout } from "@/app/(app)/settings/billing-actions";
import type { BillingOverview, BillingPlanOption, TrialEligibility } from "@/lib/billing/overview";
import type { BillingInterval, PlanId, SelfServePlanId } from "@/lib/billing/plans";

export type CheckoutReturn = "success" | "cancelled" | null;

interface BillingSectionProps {
  /** The brand this page was rendered for; the server refuses if the active brand has changed since. */
  accountId: string;
  /** Null when the billing details could not be loaded. */
  overview: BillingOverview | null;
  plans: BillingPlanOption[];
  canManage: boolean;
  checkoutReturn: CheckoutReturn;
  trialDays: number;
}

const NOT_SET_UP = "Billing is not set up yet. Please contact Cheers support.";
const AUTO_REFRESH_MS = 4000;
const AUTO_REFRESH_TRIES = 8;

function Notice({ tone = "info", children }: { tone?: "info" | "error" | "success"; children: ReactNode }) {
  const style =
    tone === "error"
      ? { backgroundColor: "var(--c-claret-soft)", color: "var(--c-claret)" }
      : tone === "success"
        ? { backgroundColor: "var(--c-status-posted-bg)", color: "var(--c-status-posted-fg)" }
        : { backgroundColor: "var(--c-orange-tint)", color: "var(--c-ink)" };
  return (
    <div role={tone === "error" ? "alert" : "status"} className="rounded-[var(--r-md)] p-3 text-sm" style={style}>
      {children}
    </div>
  );
}

function Line({ children }: { children: ReactNode }) {
  return (
    <p className="text-sm" style={{ color: "var(--c-ink)" }}>
      {children}
    </p>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return (
    <p className="text-sm" style={{ color: "var(--c-ink-3)" }}>
      {children}
    </p>
  );
}

function intervalWord(interval: BillingInterval): string {
  return interval === "year" ? "annually" : "monthly";
}

/**
 * Spec §2.1: a trial of any plan runs on the trial plan's limits. Null when
 * the chosen plan is the trial plan. Worded as a condition when the page
 * cannot be sure the brand gets a trial.
 */
function trialLimitsNote(
  trialPlan: { plan: PlanId; name: string },
  chosen: { plan: PlanId; name: string },
  certain = true,
): string | null {
  if (chosen.plan === trialPlan.plan) return null;
  return certain
    ? `Your free trial uses ${trialPlan.name} limits; ${chosen.name} limits start when the trial ends.`
    : `If a free trial applies, it uses ${trialPlan.name} limits; ${chosen.name} limits start when the trial ends.`;
}

/**
 * Billing for the active brand (spec §4.1, §4.3). Owners choose a plan (Stripe
 * Checkout) or manage it (Stripe customer portal); members see the plan only.
 * Comped brands see "Included, no billing" and never a payment prompt. The
 * server actions re-check the owner and the brand, so hiding a button here is
 * convenience, not security.
 */
export function BillingSection({ accountId, overview, plans, canManage, checkoutReturn, trialDays }: BillingSectionProps) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function goTo(action: () => Promise<{ success?: boolean; error?: string; url?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.success && result.url) {
        window.location.assign(result.url);
        return;
      }
      const message = result.error ?? "That didn't work. Please try again.";
      setError(message);
      toast.error("Billing", { description: message });
    });
  }

  function checkAgain() {
    setError(null);
    startTransition(async () => {
      const result = await checkBillingAgain({ accountId });
      if (!result.success) {
        const message = result.error ?? "Could not check with Stripe. Please try again.";
        setError(message);
        toast.error("Billing", { description: message });
        return;
      }
      if (result.state === "incomplete" || result.state === "lapsed") {
        toast.info("Not confirmed yet", {
          description: "Stripe has not confirmed a subscription yet. If you finished checkout, wait a minute and check again.",
        });
      }
      router.refresh();
    });
  }

  if (!overview) {
    return <Notice tone="error">Billing details could not be loaded. Refresh the page to try again.</Notice>;
  }

  const { state, subscription } = overview;
  const portalButton =
    canManage && overview.hasCustomer ? (
      overview.portalReady ? (
        <Button type="button" variant="secondary" disabled={isPending} onClick={() => goTo(() => openBillingPortal({ accountId }))}>
          {isPending ? "Opening..." : "Manage billing"}
        </Button>
      ) : (
        <Muted>{NOT_SET_UP}</Muted>
      )
    ) : null;
  const ownerOnly = canManage ? null : <Muted>Only an owner can change billing.</Muted>;
  const errorNotice = error ? <Notice tone="error">{error}</Notice> : null;

  if (state === "comped") {
    // Comped brands never pay. If Stripe was somehow not cancelled, owners
    // still need the portal to stop it charging.
    if (canManage && overview.hasCustomer && overview.liveSubscription) {
      return (
        <div className="space-y-3">
          <Line>Included, no billing.</Line>
          <Notice tone="error">This brand still has a Stripe subscription. Use Manage billing to cancel it so you are not charged.</Notice>
          {portalButton}
          {errorNotice}
        </div>
      );
    }
    return <Line>Included, no billing.</Line>;
  }

  if (state === "archived") {
    return <Line>This brand has been closed.</Line>;
  }

  const confirmedNotice =
    checkoutReturn === "success" && (state === "trialing" || state === "active") ? (
      <Notice tone="success">You are all set. Thank you.</Notice>
    ) : null;

  if (state === "suspended") {
    return (
      <div className="space-y-3">
        <Line>This brand is on hold. Contact Cheers support.</Line>
        {portalButton}
        {ownerOnly}
        {errorNotice}
      </div>
    );
  }

  if (state === "trialing" && subscription) {
    const limitsNote = trialLimitsNote(overview.trialLimitsPlan, { plan: subscription.plan, name: subscription.planName });
    return (
      <div className="space-y-3">
        {confirmedNotice}
        <Line>
          Free trial of {subscription.planName}, billed {intervalWord(subscription.interval)}
          {subscription.trialEndLabel ? `, until ${subscription.trialEndLabel}` : ""}.
        </Line>
        {limitsNote ? <Muted>{limitsNote}</Muted> : null}
        <Muted>
          {subscription.cancelAtPeriodEnd
            ? "Your plan is set to end when the trial finishes, so you will not be charged."
            : "Your first payment is taken when the trial ends, unless you cancel before then."}
        </Muted>
        {portalButton}
        {ownerOnly}
        {errorNotice}
      </div>
    );
  }

  if (state === "active" && subscription) {
    return (
      <div className="space-y-3">
        {confirmedNotice}
        <Line>
          {subscription.planName}, billed {intervalWord(subscription.interval)}.
          {subscription.periodEndLabel
            ? subscription.cancelAtPeriodEnd
              ? ` Ends on ${subscription.periodEndLabel}.`
              : ` Renews on ${subscription.periodEndLabel}.`
            : ""}
        </Line>
        {portalButton}
        {ownerOnly}
        {errorNotice}
      </div>
    );
  }

  if (state === "past_due_grace") {
    return (
      <div className="space-y-3">
        <Notice tone="error">
          Your last payment did not go through.
          {subscription?.graceEndLabel ? ` Update your payment details by ${subscription.graceEndLabel} to keep posting.` : " Update your payment details to keep posting."}
        </Notice>
        {portalButton}
        {ownerOnly}
        {errorNotice}
      </div>
    );
  }

  // Held states: lapsed or incomplete. Back from Checkout, both mean "not
  // confirmed yet": a first subscription (incomplete) or a returning brand
  // whose old subscription has ended (lapsed).
  if (checkoutReturn === "success") {
    return <ConfirmingPayment canManage={canManage} isPending={isPending} onCheckAgain={checkAgain} error={errorNotice} />;
  }

  const endedOrNone = !subscription || subscription.status === "canceled" || subscription.status === "incomplete_expired";
  if (!endedOrNone) {
    // A subscription still exists in Stripe but needs a payment.
    return (
      <div className="space-y-3">
        <Notice tone="error">
          {subscription?.status === "incomplete"
            ? "Your first payment needs attention before the plan can start."
            : "This brand is on hold because a payment has not been made. Update your payment details to carry on."}
        </Notice>
        {portalButton}
        {ownerOnly}
        {errorNotice}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {checkoutReturn === "cancelled" ? <Notice>Checkout was cancelled. Nothing has been charged.</Notice> : null}
      <Line>
        {state === "lapsed"
          ? "Your subscription has ended. Choose a plan to start posting again."
          : "Choose a plan to start using Cheers for this brand."}
      </Line>
      {canManage ? (
        overview.checkoutReady ? (
          <PlanPicker
            plans={plans}
            trial={overview.trial}
            trialLimitsPlan={overview.trialLimitsPlan}
            trialDays={trialDays}
            isPending={isPending}
            onStart={(plan, interval) => goTo(() => startCheckout({ plan, interval, accountId }))}
          />
        ) : (
          <Muted>{NOT_SET_UP}</Muted>
        )
      ) : (
        <Muted>Ask an owner of this brand to choose a plan.</Muted>
      )}
      {overview.hasCustomer && state === "lapsed" ? portalButton : null}
      {errorNotice}
    </div>
  );
}

function ConfirmingPayment({
  canManage,
  isPending,
  onCheckAgain,
  error,
}: {
  canManage: boolean;
  isPending: boolean;
  onCheckAgain: () => void;
  error: ReactNode;
}) {
  const router = useRouter();
  const [tries, setTries] = useState(0);

  // Re-read the page a few times while Stripe tells us about the payment.
  useEffect(() => {
    if (tries >= AUTO_REFRESH_TRIES) return;
    const timer = window.setTimeout(() => {
      setTries((count) => count + 1);
      router.refresh();
    }, AUTO_REFRESH_MS);
    return () => window.clearTimeout(timer);
  }, [tries, router]);

  return (
    <div className="space-y-3">
      <Notice>
        {tries >= AUTO_REFRESH_TRIES
          ? "Still confirming your payment with Stripe. Use Check again, or contact Cheers support if this does not change in a few minutes."
          : "Confirming your payment. This usually takes a few seconds."}
      </Notice>
      {canManage ? (
        <Button type="button" variant="secondary" disabled={isPending} onClick={onCheckAgain}>
          {isPending ? "Checking..." : "Check again"}
        </Button>
      ) : null}
      {error}
    </div>
  );
}

function PlanPicker({
  plans,
  trial,
  trialLimitsPlan,
  trialDays,
  isPending,
  onStart,
}: {
  plans: BillingPlanOption[];
  trial: TrialEligibility;
  trialLimitsPlan: { plan: PlanId; name: string };
  trialDays: number;
  isPending: boolean;
  onStart: (plan: SelfServePlanId, interval: BillingInterval) => void;
}) {
  const [plan, setPlan] = useState<SelfServePlanId>(plans[0]?.plan ?? "starter");
  const [interval, setBillingInterval] = useState<BillingInterval>("month");
  const chosen = plans.find((option) => option.plan === plan);
  const limitsNote =
    trial !== "ineligible" && chosen
      ? trialLimitsNote(trialLimitsPlan, { plan: chosen.plan, name: chosen.name }, trial === "eligible")
      : null;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        onStart(plan, interval);
      }}
    >
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium" style={{ color: "var(--c-ink)" }}>
          Billing period
        </legend>
        <div className="flex flex-wrap gap-2">
          {(["month", "year"] as const).map((value) => (
            <label
              key={value}
              className="flex cursor-pointer items-center gap-2 rounded-[var(--r-md)] border px-3 py-2 text-sm"
              style={{
                borderColor: interval === value ? "var(--c-orange)" : "var(--c-line)",
                backgroundColor: interval === value ? "var(--c-orange-tint)" : "var(--c-card)",
                color: "var(--c-ink)",
              }}
            >
              <input type="radio" name="billing-interval" value={value} checked={interval === value} onChange={() => setBillingInterval(value)} />
              {value === "month" ? "Monthly" : "Annual (10% off)"}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium" style={{ color: "var(--c-ink)" }}>
          Plan
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {plans.map((option) => (
            <label
              key={option.plan}
              className="flex cursor-pointer gap-3 rounded-[var(--r-xl)] border p-4"
              style={{
                borderColor: plan === option.plan ? "var(--c-orange)" : "var(--c-line)",
                backgroundColor: plan === option.plan ? "var(--c-orange-tint)" : "var(--c-card)",
              }}
            >
              <input
                type="radio"
                name="billing-plan"
                value={option.plan}
                checked={plan === option.plan}
                onChange={() => setPlan(option.plan)}
                className="mt-1"
              />
              <span className="space-y-1">
                <span className="block text-sm font-semibold" style={{ color: "var(--c-ink)" }}>
                  {option.name}
                </span>
                <span className="block text-sm" style={{ color: "var(--c-ink)" }}>
                  {interval === "year" ? option.annualLabel : option.monthlyLabel}
                </span>
                <span className="block text-xs" style={{ color: "var(--c-ink-3)" }}>
                  {option.summary}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {limitsNote ? <Muted>{limitsNote}</Muted> : null}
      <Button type="submit" variant="primary" disabled={isPending} className="w-full sm:w-auto">
        {isPending
          ? "Opening checkout..."
          : trial === "eligible"
            ? `Start ${trialDays}-day free trial`
            : trial === "uncertain"
              ? "Continue to checkout"
              : "Continue to payment"}
      </Button>
      <p className="text-xs" style={{ color: "var(--c-ink-3)" }}>
        {trial === "eligible"
          ? `Your card is needed today but nothing is charged until the ${trialDays}-day trial ends. Cancel any time before then. Prices exclude VAT, which is added at checkout.`
          : trial === "uncertain"
            ? `Includes a ${trialDays}-day free trial if this is the brand's first Cheers subscription. Prices exclude VAT, which is added at checkout.`
            : "Prices exclude VAT, which is added at checkout. Change or cancel any time from Manage billing."}
      </p>
    </form>
  );
}
