// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components/providers/toast-provider";
import { GenerateStep } from "@/features/create/steps/generate-step";
import type { ContentBrief } from "@/features/create/schemas/content-schemas";
import type { SlotGeneratedCopy } from "@/types/content";

afterEach(() => {
  cleanup();
});

describe("<GenerateStep />", () => {
  it("shows one editable final publish preview per platform", () => {
    const onSlotCopiesChange = vi.fn();
    const slotCopies: SlotGeneratedCopy[] = [
      {
        slotKey: "slot-1",
        scheduledAt: "2026-06-01T16:00:00.000Z",
        status: "ready",
        copy: {
          facebook: {
            body: "Generated Facebook body",
            ctaText: "Book now",
            hashtags: ["#PubNight"],
          },
          instagram: {
            body: "Generated Instagram body",
            linkInBioLine: "Link in bio to book",
            hashtags: ["#PubNight"],
          },
          gbp: {
            body: "Generated Google body",
            ctaAction: "BOOK",
          },
        },
      },
    ];

    render(
      <ToastProvider>
        <GenerateStep
          contentId="draft-1"
          contentBrief={{
            contentType: "event",
            platforms: ["facebook", "instagram", "gbp"],
            ctaLinks: {
              facebook: "https://example.com/fb",
              instagram: "https://example.com/ig",
              gbp: "https://example.com/gbp",
            },
          } as unknown as ContentBrief}
          selectedSlots={[{
            key: "slot-1",
            date: "2026-06-01",
            time: "17:00",
            source: "manual",
          }]}
          generatedSlotCopies={slotCopies}
          onSlotCopiesChange={onSlotCopiesChange}
          selectedMediaIds={[]}
          publishMode="schedule"
          isContextStale={false}
          onGeneratedWithContext={vi.fn()}
          onSaveDraft={vi.fn()}
          onScheduleAll={vi.fn()}
          onQueueAll={vi.fn()}
          isSubmitting={false}
          accountId="acc-1"
          libraryItems={[]}
          bannerDefaults={null}
        />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Mon 1 Jun, 17:00/i }));

    expect(screen.queryByText("Body")).not.toBeInTheDocument();
    expect(screen.queryByText("Hashtags")).not.toBeInTheDocument();
    expect(screen.queryByText("CTA")).not.toBeInTheDocument();

    const previews = screen.getAllByLabelText("Final publish preview") as HTMLTextAreaElement[];
    expect(previews).toHaveLength(3);
    expect(previews[0].value).toContain("Book now: https://example.com/fb");

    fireEvent.change(previews[0], { target: { value: "Edited final Facebook post" } });

    const updatedCopies = onSlotCopiesChange.mock.calls.at(-1)?.[0] as SlotGeneratedCopy[];
    expect(updatedCopies[0].copy?.facebook.publishBodyOverride).toBe("Edited final Facebook post");
  });
});
