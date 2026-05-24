// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { generateContent } from "@/app/actions/ai-generate";
import { ToastProvider } from "@/components/providers/toast-provider";
import { GenerateStep } from "@/features/create/steps/generate-step";
import type { ContentBrief } from "@/features/create/schemas/content-schemas";
import type { SlotGeneratedCopy } from "@/types/content";

vi.mock("@/app/actions/ai-generate", () => ({
  generateContent: vi.fn(),
  regenerateWithModifier: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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

  it("prepares story slots without generating written content", async () => {
    const onSlotCopiesChange = vi.fn();
    const onGeneratedWithContext = vi.fn();

    render(
      <ToastProvider>
        <GenerateStep
          contentId="draft-1"
          contentBrief={{
            contentType: "story",
            title: "Weekend story",
            platforms: ["facebook", "instagram"],
          } as unknown as ContentBrief}
          selectedSlots={[
            {
              key: "story-slot-1",
              date: "2026-06-01",
              time: "07:00",
              source: "manual",
            },
            {
              key: "story-slot-2",
              date: "2026-06-02",
              time: "07:00",
              source: "manual",
            },
          ]}
          generatedSlotCopies={[]}
          onSlotCopiesChange={onSlotCopiesChange}
          selectedMediaIds={["media-1"]}
          publishMode="schedule"
          isContextStale={false}
          onGeneratedWithContext={onGeneratedWithContext}
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

    expect(screen.queryByRole("button", { name: /generate/i })).not.toBeInTheDocument();

    await waitFor(() => expect(onSlotCopiesChange).toHaveBeenCalled());

    const storyCopies = onSlotCopiesChange.mock.calls.at(-1)?.[0] as SlotGeneratedCopy[];
    expect(storyCopies).toHaveLength(2);
    expect(storyCopies.every((copy) => copy.status === "ready" && copy.approved === true)).toBe(true);
    expect(storyCopies.every((copy) => copy.copy?.facebook.body === "")).toBe(true);
    expect(storyCopies.every((copy) => copy.copy?.instagram.body === "")).toBe(true);
    expect(generateContent).not.toHaveBeenCalled();
    expect(onGeneratedWithContext).toHaveBeenCalledWith({
      mediaIds: ["media-1"],
      slots: [
        { key: "story-slot-1", date: "2026-06-01", time: "07:00", label: undefined },
        { key: "story-slot-2", date: "2026-06-02", time: "07:00", label: undefined },
      ],
    });
  });
});
