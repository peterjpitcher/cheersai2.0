// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components/providers/toast-provider";
import { BillingSection, type CheckoutReturn } from "@/features/settings/billing-section";
import type { BillingOverview, BillingPlanOption } from "@/lib/billing/overview";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const mockStartCheckout = vi.fn();
const mockOpenPortal = vi.fn();
const mockCheckAgain = vi.fn();
vi.mock("@/app/(app)/settings/billing-actions", () => ({
  startCheckout: (...a: unknown[]) => mockStartCheckout(...a),
  openBillingPortal: (...a: unknown[]) => mockOpenPortal(...a),
  checkBillingAgain: (...a: unknown[]) => mockCheckAgain(...a),
}));

const PLANS: BillingPlanOption[] = [
  { plan: "starter", name: "Starter", monthlyLabel: "£29.99 + VAT a month", annualLabel: "£323.89 + VAT a year", summary: "120 posts" },
  { plan: "professional", name: "Professional", monthlyLabel: "£59.99 + VAT a month", annualLabel: "£647.89 + VAT a year", summary: "400 posts" },
];

const NEW_BRAND: BillingOverview = {
  state: "incomplete",
  subscription: null,
  hasCustomer: false,
  liveSubscription: false,
  trialEligible: true,
  checkoutReady: true,
  portalReady: true,
  trialLimitsPlan: { plan: "starter", name: "Starter" },
};

const assign = vi.fn();

function renderSection(overview: BillingOverview | null, options: { canManage?: boolean; checkoutReturn?: CheckoutReturn } = {}) {
  return render(
    <ToastProvider>
      <BillingSection
        overview={overview}
        plans={PLANS}
        canManage={options.canManage ?? true}
        checkoutReturn={options.checkoutReturn ?? null}
        trialDays={14}
      />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, assign } });
});

afterEach(() => cleanup());

describe("BillingSection", () => {
  it("shows a comped brand 'Included, no billing' and never a payment prompt", () => {
    renderSection({ ...NEW_BRAND, state: "comped" });
    expect(screen.getByText("Included, no billing.")).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByText(/free trial/i)).not.toBeInTheDocument();
  });

  it("keeps Manage billing for an owner of a comped brand that still has a live Stripe subscription", async () => {
    mockOpenPortal.mockResolvedValue({ success: true, url: "https://billing.stripe.com/p/session/test_1" });
    renderSection({ ...NEW_BRAND, state: "comped", hasCustomer: true, liveSubscription: true });
    expect(screen.getByText("Included, no billing.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("This brand still has a Stripe subscription.");
    fireEvent.click(screen.getByRole("button", { name: "Manage billing" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://billing.stripe.com/p/session/test_1"));
    cleanup();

    // A member of the same brand sees only the plan line.
    renderSection({ ...NEW_BRAND, state: "comped", hasCustomer: true, liveSubscription: true }, { canManage: false });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("lets an owner of a new brand pick a plan and period, then sends them to Checkout", async () => {
    mockStartCheckout.mockResolvedValue({ success: true, url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    renderSection(NEW_BRAND);

    expect(screen.getByText("£29.99 + VAT a month")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Annual/));
    expect(screen.getByText("£647.89 + VAT a year")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Professional/));
    fireEvent.click(screen.getByRole("button", { name: "Start 14-day free trial" }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_test_1"));
    expect(mockStartCheckout).toHaveBeenCalledWith({ plan: "professional", interval: "year" });
  });

  it("says a Professional trial runs on Starter limits, before and during the trial (spec §2.1)", () => {
    renderSection(NEW_BRAND);
    const note = "Your free trial uses Starter limits; Professional limits start when the trial ends.";
    expect(screen.queryByText(note)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Professional/));
    expect(screen.getByText(note)).toBeInTheDocument();
    cleanup();

    renderSection({
      ...NEW_BRAND,
      state: "trialing",
      hasCustomer: true,
      trialEligible: false,
      subscription: {
        plan: "professional",
        planName: "Professional",
        interval: "month",
        status: "trialing",
        cancelAtPeriodEnd: false,
        trialEndLabel: "10 October 2026",
        periodEndLabel: "10 October 2026",
        graceEndLabel: null,
      },
    });
    expect(screen.getByText(note)).toBeInTheDocument();
  });

  it("shows the owner an error when Checkout cannot start", async () => {
    mockStartCheckout.mockResolvedValue({ error: "Could not start checkout. Please try again." });
    renderSection(NEW_BRAND);
    fireEvent.click(screen.getByRole("button", { name: "Start 14-day free trial" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not start checkout");
    expect(assign).not.toHaveBeenCalled();
  });

  it("shows a member the state only", () => {
    renderSection(NEW_BRAND, { canManage: false });
    expect(screen.getByText("Ask an owner of this brand to choose a plan.")).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("says billing is not set up instead of offering a plan when Stripe is not configured", () => {
    renderSection({ ...NEW_BRAND, checkoutReady: false });
    expect(screen.getByText(/Billing is not set up yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /free trial/ })).not.toBeInTheDocument();
  });

  it("shows 'Confirming your payment' after Checkout until the subscription is recorded, with Check again", async () => {
    mockCheckAgain.mockResolvedValue({ success: true, state: "trialing" });
    renderSection(NEW_BRAND, { checkoutReturn: "success" });
    expect(screen.getByText(/Confirming your payment/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(mockCheckAgain).toHaveBeenCalled());
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("shows a trial with its end date and a Manage billing button", async () => {
    mockOpenPortal.mockResolvedValue({ success: true, url: "https://billing.stripe.com/p/session/test_1" });
    renderSection({
      ...NEW_BRAND,
      state: "trialing",
      hasCustomer: true,
      trialEligible: false,
      subscription: {
        plan: "starter",
        planName: "Starter",
        interval: "month",
        status: "trialing",
        cancelAtPeriodEnd: false,
        trialEndLabel: "10 October 2026",
        periodEndLabel: "10 October 2026",
        graceEndLabel: null,
      },
    });
    expect(screen.getByText(/Free trial of Starter, billed monthly, until 10 October 2026/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Manage billing" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://billing.stripe.com/p/session/test_1"));
  });

  it("tells a past-due owner the date the grace ends", () => {
    renderSection({
      ...NEW_BRAND,
      state: "past_due_grace",
      hasCustomer: true,
      trialEligible: false,
      subscription: {
        plan: "starter",
        planName: "Starter",
        interval: "month",
        status: "past_due",
        cancelAtPeriodEnd: false,
        trialEndLabel: null,
        periodEndLabel: "1 December 2026",
        graceEndLabel: "8 November 2026",
      },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Update your payment details by 8 November 2026 to keep posting.");
  });

  it("shows a load failure as an error", () => {
    renderSection(null);
    expect(screen.getByRole("alert")).toHaveTextContent("Billing details could not be loaded");
  });
});
