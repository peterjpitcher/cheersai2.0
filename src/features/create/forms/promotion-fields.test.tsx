// @vitest-environment jsdom
import { zodResolver } from "@hookform/resolvers/zod";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useForm } from "react-hook-form";
import type { FieldValues, UseFormReturn } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PromotionFields } from "@/features/create/forms/promotion-fields";
import {
  contentBriefSubmissionSchema,
  OFFER_DATE_MESSAGES,
} from "@/features/create/schemas/content-schemas";
import type { ContentBriefInput } from "@/features/create/schemas/content-schemas";

/**
 * The offer fields under the same form set-up as the create wizard
 * (create-wizard.tsx): the submission schema as the resolver, validated on
 * touch, and the whole form checked when the owner presses Next.
 */
function OfferForm({ startDate = "", endDate }: { startDate?: string; endDate: string }) {
  const form = useForm<ContentBriefInput>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- same cast as the wizard: the union's input and output types differ
    resolver: zodResolver(contentBriefSubmissionSchema) as any,
    defaultValues: {
      contentType: "promotion",
      title: "Two for one",
      prompt: "",
      platforms: ["facebook", "instagram"],
      offerSummary: "Two mains for the price of one",
      startDate,
      endDate,
      placements: ["feed"],
    },
    mode: "onTouched",
  });

  return (
    <>
      <PromotionFields form={form as unknown as UseFormReturn<FieldValues>} />
      <button type="button" onClick={() => void form.trigger()}>
        Next
      </button>
    </>
  );
}

describe("<PromotionFields /> offer dates", () => {
  beforeEach(() => {
    // Tuesday 29 September 2026, 09:00 BST. Only Date is faked so the form's
    // async validation and waitFor still run on real timers.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-29T08:00:00.000Z"));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("refuses an end date that has passed, under the end date field", async () => {
    render(<OfferForm endDate="2026-09-28" />);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByText(OFFER_DATE_MESSAGES.endDatePassed)).toBeInTheDocument();
    expect(screen.getByLabelText(/End date/)).toHaveAttribute("aria-invalid", "true");
  });

  it("accepts an end date of today", async () => {
    render(<OfferForm endDate="2026-09-29" />);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => expect(screen.getByLabelText(/End date/)).toHaveAttribute("aria-invalid", "false"));
    expect(screen.queryByText(OFFER_DATE_MESSAGES.endDatePassed)).not.toBeInTheDocument();
  });

  it("shows the passed end date as soon as the owner leaves the field", async () => {
    render(<OfferForm endDate="2026-10-09" />);
    const endDate = screen.getByLabelText(/End date/);

    fireEvent.change(endDate, { target: { value: "2026-09-28" } });
    fireEvent.blur(endDate);

    expect(await screen.findByText(OFFER_DATE_MESSAGES.endDatePassed)).toBeInTheDocument();
  });

  it("refuses a start date after the end date, and clears it once the end date moves later", async () => {
    render(<OfferForm startDate="2026-10-20" endDate="2026-10-09" />);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText(OFFER_DATE_MESSAGES.startAfterEnd)).toBeInTheDocument();
    expect(screen.getByLabelText(/Start date/)).toHaveAttribute("aria-invalid", "true");

    const endDate = screen.getByLabelText(/End date/);
    fireEvent.change(endDate, { target: { value: "2026-10-30" } });
    fireEvent.blur(endDate);

    await waitFor(() => expect(screen.queryByText(OFFER_DATE_MESSAGES.startAfterEnd)).not.toBeInTheDocument());
  });
});
