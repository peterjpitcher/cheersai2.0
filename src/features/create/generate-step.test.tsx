// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DateTime } from "luxon";
import { afterEach, describe, expect, it, vi } from "vitest";

import { generateContent } from "@/app/actions/ai-generate";
import { ToastProvider } from "@/components/providers/toast-provider";
import { GenerateStep } from "@/features/create/steps/generate-step";
import type { ContentBrief } from "@/features/create/schemas/content-schemas";
import type { MediaAssetSummary } from "@/lib/library/data";
import type { SlotGeneratedCopy } from "@/types/content";

vi.mock("@/app/actions/ai-generate", () => ({
  generateContent: vi.fn(),
  regenerateWithModifier: vi.fn(),
}));

/** Minimal AI response so handleGenerateAll completes without throwing */
function mockGenerateSuccess(): void {
  vi.mocked(generateContent).mockResolvedValue({
    data: {
      copy: {
        facebook: { body: "FB body" },
        instagram: { body: "IG body" },
      },
      warnings: [],
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock only needs the shape the component reads
  } as any);
}

/** Library asset fixture that renders a preview image when attached */
function mediaAsset(id: string, overrides: Partial<MediaAssetSummary> = {}): MediaAssetSummary {
  return {
    id,
    fileName: `${id}.jpg`,
    mediaType: "image",
    tags: [],
    uploadedAt: "2026-06-01T00:00:00.000Z",
    storagePath: `media/${id}.jpg`,
    processedStatus: "ready",
    derivedVariants: {},
    aspectClass: "square",
    previewUrl: `https://example.com/${id}.jpg`,
    previewShape: "square",
    ...overrides,
  };
}

/**
 * Library asset with a ready 1080x1920 crop, which is what a story card needs
 * to preview an overlay against the image that will actually publish.
 */
function storyReadyAsset(id: string, overrides: Partial<MediaAssetSummary> = {}): MediaAssetSummary {
  return mediaAsset(id, {
    derivedVariants: { story: `derived/${id}/story.jpg` },
    storyPreviewUrl: `https://example.com/${id}-story.jpg`,
    ...overrides,
  });
}

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
        },
      },
    ];

    render(
      <ToastProvider>
        <GenerateStep
          contentId="draft-1"
          contentBrief={{
            contentType: "event",
            platforms: ["facebook", "instagram"],
            ctaLinks: {
              facebook: "https://example.com/fb",
              instagram: "https://example.com/ig",
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
    expect(previews).toHaveLength(2);
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

  it("prepares story-only event campaign slots without generating written content", async () => {
    const onSlotCopiesChange = vi.fn();

    render(
      <ToastProvider>
        <GenerateStep
          contentId="draft-1"
          contentBrief={{
            contentType: "event",
            title: "Quiz Night",
            eventName: "Quiz Night",
            eventDate: "2026-06-15",
            eventTime: "19:00",
            platforms: ["facebook", "instagram"],
            placements: ["story"],
          } as unknown as ContentBrief}
          selectedSlots={[
            {
              key: "event-story-slot-1",
              date: "2026-06-14",
              time: "07:00",
              source: "manual",
            },
          ]}
          generatedSlotCopies={[]}
          onSlotCopiesChange={onSlotCopiesChange}
          selectedMediaIds={["media-1"]}
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

    expect(screen.queryByRole("button", { name: /generate/i })).not.toBeInTheDocument();

    await waitFor(() => expect(onSlotCopiesChange).toHaveBeenCalled());

    const storyCopies = onSlotCopiesChange.mock.calls.at(-1)?.[0] as SlotGeneratedCopy[];
    expect(storyCopies).toHaveLength(1);
    expect(storyCopies[0].status).toBe("ready");
    expect(storyCopies[0].approved).toBe(true);
    expect(storyCopies[0].copy?.facebook.body).toBe("");
    expect(storyCopies[0].copy?.instagram.body).toBe("");
    expect(generateContent).not.toHaveBeenCalled();
  });

  // Regression (ASR media inherit): generating BEFORE media is attached must
  // not freeze the slot at an empty array — it should stay `undefined` so the
  // render/publish paths inherit the latest wizard selection. See defect log
  // entry for the per-slot media `??` bug.
  it("seeds slot media as undefined (inherit) when generating before media is attached", async () => {
    mockGenerateSuccess();
    const onSlotCopiesChange = vi.fn();

    render(
      <ToastProvider>
        <GenerateStep
          contentId="draft-1"
          contentBrief={{
            contentType: "event",
            platforms: ["facebook", "instagram"],
          } as unknown as ContentBrief}
          selectedSlots={[{ key: "slot-1", date: "2026-06-01", time: "17:00", source: "manual" }]}
          generatedSlotCopies={[]}
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

    fireEvent.click(screen.getByRole("button", { name: /generate content/i }));

    // First call is the synchronous seed of all slots.
    const seeded = onSlotCopiesChange.mock.calls[0]?.[0] as SlotGeneratedCopy[];
    expect(seeded).toHaveLength(1);
    expect(seeded[0].mediaIds).toBeUndefined();

    await waitFor(() => expect(generateContent).toHaveBeenCalled());
  });

  it("preserves an explicit per-slot media choice across Regenerate All", async () => {
    mockGenerateSuccess();
    const onSlotCopiesChange = vi.fn();
    const existing: SlotGeneratedCopy[] = [
      {
        slotKey: "slot-1",
        scheduledAt: "2026-06-01T16:00:00.000Z",
        status: "ready",
        mediaIds: ["media-9"],
        copy: {
          facebook: { body: "FB" },
          instagram: { body: "IG" },
        },
      },
    ];

    render(
      <ToastProvider>
        <GenerateStep
          contentId="draft-1"
          contentBrief={{
            contentType: "event",
            platforms: ["facebook", "instagram"],
          } as unknown as ContentBrief}
          selectedSlots={[{ key: "slot-1", date: "2026-06-01", time: "17:00", source: "manual" }]}
          generatedSlotCopies={existing}
          onSlotCopiesChange={onSlotCopiesChange}
          selectedMediaIds={["media-1"]}
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

    fireEvent.click(screen.getByRole("button", { name: /regenerate all/i }));

    const seeded = onSlotCopiesChange.mock.calls[0]?.[0] as SlotGeneratedCopy[];
    expect(seeded[0].mediaIds).toEqual(["media-9"]);

    await waitFor(() => expect(generateContent).toHaveBeenCalled());
  });

  it("inherits the wizard media selection when a slot's media is undefined", () => {
    const slotCopies: SlotGeneratedCopy[] = [
      {
        slotKey: "slot-1",
        scheduledAt: "2026-06-01T16:00:00.000Z",
        status: "ready",
        mediaIds: undefined,
        copy: {
          facebook: { body: "FB" },
          instagram: { body: "IG" },
        },
      },
    ];

    render(
      <ToastProvider>
        <GenerateStep
          contentId="draft-1"
          contentBrief={{
            contentType: "event",
            platforms: ["facebook", "instagram"],
          } as unknown as ContentBrief}
          selectedSlots={[{ key: "slot-1", date: "2026-06-01", time: "17:00", source: "manual" }]}
          generatedSlotCopies={slotCopies}
          onSlotCopiesChange={vi.fn()}
          selectedMediaIds={["media-1"]}
          publishMode="schedule"
          isContextStale={false}
          onGeneratedWithContext={vi.fn()}
          onSaveDraft={vi.fn()}
          onScheduleAll={vi.fn()}
          onQueueAll={vi.fn()}
          isSubmitting={false}
          accountId="acc-1"
          libraryItems={[mediaAsset("media-1")]}
          bannerDefaults={null}
        />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Mon 1 Jun, 17:00/i }));

    expect(screen.getAllByRole("img").length).toBeGreaterThan(0);
    expect(screen.queryByText("No media attached")).not.toBeInTheDocument();
  });

  it("keeps a slot empty when its media is an explicit empty array", () => {
    const slotCopies: SlotGeneratedCopy[] = [
      {
        slotKey: "slot-1",
        scheduledAt: "2026-06-01T16:00:00.000Z",
        status: "ready",
        mediaIds: [],
        copy: {
          facebook: { body: "FB" },
          instagram: { body: "IG" },
        },
      },
    ];

    render(
      <ToastProvider>
        <GenerateStep
          contentId="draft-1"
          contentBrief={{
            contentType: "event",
            platforms: ["facebook", "instagram"],
          } as unknown as ContentBrief}
          selectedSlots={[{ key: "slot-1", date: "2026-06-01", time: "17:00", source: "manual" }]}
          generatedSlotCopies={slotCopies}
          onSlotCopiesChange={vi.fn()}
          selectedMediaIds={["media-1"]}
          publishMode="schedule"
          isContextStale={false}
          onGeneratedWithContext={vi.fn()}
          onSaveDraft={vi.fn()}
          onScheduleAll={vi.fn()}
          onQueueAll={vi.fn()}
          isSubmitting={false}
          accountId="acc-1"
          libraryItems={[mediaAsset("media-1")]}
          bannerDefaults={null}
        />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Mon 1 Jun, 17:00/i }));

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getAllByText("No media attached").length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Per-post image overlay (opt-in)
  // -------------------------------------------------------------------------

  function readySlot(overrides: Partial<SlotGeneratedCopy> = {}): SlotGeneratedCopy {
    return {
      slotKey: "slot-1",
      scheduledAt: "2026-06-01T16:00:00.000Z",
      status: "ready",
      mediaIds: ["media-1"],
      copy: {
        facebook: { body: "FB body" },
        instagram: { body: "IG body" },
      },
      ...overrides,
    };
  }

  function renderOverlayStep(
    slotCopies: SlotGeneratedCopy[],
    onSlotCopiesChange = vi.fn(),
    options: { brief?: Record<string, unknown>; libraryItems?: MediaAssetSummary[] } = {},
  ) {
    render(
      <ToastProvider>
        <GenerateStep
          contentId="draft-1"
          contentBrief={{
            contentType: "event",
            platforms: ["facebook"],
            ctaLinks: { facebook: "https://example.com/fb" },
            ...options.brief,
          } as unknown as ContentBrief}
          selectedSlots={[{ key: "slot-1", date: "2026-06-01", time: "17:00", source: "manual" }]}
          generatedSlotCopies={slotCopies}
          onSlotCopiesChange={onSlotCopiesChange}
          selectedMediaIds={["media-1"]}
          publishMode="schedule"
          isContextStale={false}
          onGeneratedWithContext={vi.fn()}
          onSaveDraft={vi.fn()}
          onScheduleAll={vi.fn()}
          onQueueAll={vi.fn()}
          isSubmitting={false}
          accountId="acc-1"
          libraryItems={options.libraryItems ?? [mediaAsset("media-1")]}
          bannerDefaults={null}
        />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Mon 1 Jun, 17:00/i }));
    return onSlotCopiesChange;
  }

  it("shows an empty overlay input and no overlay strip when no text is set", () => {
    renderOverlayStep([readySlot()]);
    const input = screen.getByLabelText("Image overlay (optional)") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(document.querySelector("[data-banner-overlay]")).toBeNull();
  });

  it("previews the overlay strip and fills the input when overlay text is set", () => {
    renderOverlayStep([readySlot({ bannerTextOverride: "£5 PINTS" })]);
    const input = screen.getByLabelText("Image overlay (optional)") as HTMLInputElement;
    expect(input.value).toBe("£5 PINTS");
    expect(document.querySelector("[data-banner-overlay]")).not.toBeNull();
  });

  it("disables Approve and shows an error when overlay text is invalid", () => {
    renderOverlayStep([readySlot({ bannerTextOverride: "QUIZ \u{1F389}" })]);
    expect(screen.getByText(/Overlay text can only use/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Approve this post/i })).toBeDisabled();
  });

  it("records typed overlay text via onSlotCopiesChange", () => {
    const onSlotCopiesChange = renderOverlayStep([readySlot()]);
    fireEvent.change(screen.getByLabelText("Image overlay (optional)"), {
      target: { value: "quiz night" },
    });
    const updated = onSlotCopiesChange.mock.calls.at(-1)?.[0] as SlotGeneratedCopy[];
    expect(updated[0].bannerTextOverride).toBe("quiz night");
  });

  // -------------------------------------------------------------------------
  // Story cards: overlay input and 9:16 preview
  // -------------------------------------------------------------------------

  const STORY_SLOT = {
    key: "story-slot-1",
    date: "2026-06-01",
    time: "07:00",
    source: "manual" as const,
  };

  /**
   * Mirrors slotToIso inside the component. A seeded story copy has to match
   * what the auto-seed effect would compute, otherwise the effect rebuilds the
   * slots and re-expands the card, which would fight the explicit expand click.
   */
  function slotIso(date: string, time: string): string {
    return DateTime.fromISO(`${date}T${time}`, { zone: "Europe/London" }).toISO()!;
  }

  function storySlotCopy(overrides: Partial<SlotGeneratedCopy> = {}): SlotGeneratedCopy {
    return {
      slotKey: STORY_SLOT.key,
      scheduledAt: slotIso(STORY_SLOT.date, STORY_SLOT.time),
      status: "ready",
      approved: true,
      warnings: [],
      mediaIds: ["media-1"],
      copy: {
        facebook: { body: "" },
        instagram: { body: "" },
      },
      ...overrides,
    };
  }

  interface StoryWizardOptions {
    brief?: Record<string, unknown>;
    slotCopies?: SlotGeneratedCopy[];
    libraryItems?: MediaAssetSummary[];
    onSlotCopiesChange?: (copies: SlotGeneratedCopy[]) => void;
  }

  function storyWizard(options: StoryWizardOptions = {}) {
    return (
      <ToastProvider>
        <GenerateStep
          contentId="draft-1"
          contentBrief={{
            contentType: "story",
            title: "Weekend story",
            platforms: ["facebook", "instagram"],
            ...options.brief,
          } as unknown as ContentBrief}
          selectedSlots={[STORY_SLOT]}
          generatedSlotCopies={options.slotCopies ?? [storySlotCopy()]}
          onSlotCopiesChange={options.onSlotCopiesChange ?? vi.fn()}
          selectedMediaIds={["media-1"]}
          publishMode="schedule"
          isContextStale={false}
          onGeneratedWithContext={vi.fn()}
          onSaveDraft={vi.fn()}
          onScheduleAll={vi.fn()}
          onQueueAll={vi.fn()}
          isSubmitting={false}
          accountId="acc-1"
          libraryItems={options.libraryItems ?? [storyReadyAsset("media-1")]}
          bannerDefaults={null}
        />
      </ToastProvider>
    );
  }

  /** Renders a single-slot story wizard and expands the card. */
  function renderStoryWizard(options: StoryWizardOptions = {}) {
    const utils = render(storyWizard(options));
    fireEvent.click(screen.getByRole("button", { name: /Mon 1 Jun, 07:00/i }));
    return utils;
  }

  it("shows an enabled overlay input on a story slot", () => {
    renderStoryWizard();
    // Story slots are force-approved by the auto-seed effect, so the input must
    // not be gated on approval or it would be permanently read-only.
    expect(screen.getByLabelText("Image overlay (optional)")).toBeEnabled();
  });

  it("records typed story overlay text via onSlotCopiesChange", () => {
    const onSlotCopiesChange = vi.fn();
    renderStoryWizard({ onSlotCopiesChange });

    fireEvent.change(screen.getByLabelText("Image overlay (optional)"), {
      target: { value: "£5 PINTS" },
    });

    const updated = onSlotCopiesChange.mock.calls.at(-1)?.[0] as SlotGeneratedCopy[];
    expect(updated[0].bannerTextOverride).toBe("£5 PINTS");
  });

  it("offers the automatic date label on an event story slot", () => {
    renderStoryWizard({
      brief: {
        contentType: "event",
        title: "Quiz Night",
        eventName: "Quiz Night",
        eventDate: "2026-06-15",
        eventTime: "19:00",
        placements: ["story"],
      },
    });

    const input = screen.getByLabelText("Image overlay (optional)") as HTMLInputElement;
    expect(input.placeholder).toMatch(/^Auto: .+, type to override$/);
  });

  it("previews the overlay over the story crop, not the feed image", () => {
    renderStoryWizard({ slotCopies: [storySlotCopy({ bannerTextOverride: "QUIZ" })] });

    const image = screen.getByAltText("Story media");
    expect(image).toHaveAttribute("src", "https://example.com/media-1-story.jpg");
    expect(document.querySelector("[data-banner-overlay]")).not.toBeNull();
  });

  it("previews the plain story crop when no overlay text is set", () => {
    renderStoryWizard();

    expect(screen.getByAltText("media-1.jpg")).toHaveAttribute(
      "src",
      "https://example.com/media-1-story.jpg",
    );
    expect(document.querySelector("[data-banner-overlay]")).toBeNull();
  });

  it("shows a not-ready state when the image has no story crop", () => {
    renderStoryWizard({ libraryItems: [mediaAsset("media-1")] });

    expect(screen.getByText(/story crop not ready/i)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Story readiness: the card must not claim ready in states the server rejects
  // -------------------------------------------------------------------------

  it("shows the ready badge and enables scheduling when the story crop exists", () => {
    renderStoryWizard();

    expect(screen.getByText(/Story media ready to schedule/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Schedule stories/i })).toBeEnabled();
  });

  it("blocks scheduling and names the problem when the image has no story crop", () => {
    renderStoryWizard({ libraryItems: [mediaAsset("media-1")] });

    expect(screen.queryByText(/Story media ready to schedule/i)).not.toBeInTheDocument();
    expect(screen.getByText(/no 9:16 story crop/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Schedule stories/i })).toBeDisabled();
  });

  it("blocks scheduling when the attached media is a video", () => {
    renderStoryWizard({ libraryItems: [mediaAsset("media-1", { mediaType: "video" })] });

    expect(screen.queryByText(/Story media ready to schedule/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Stories need an image/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Schedule stories/i })).toBeDisabled();
  });

  it("blocks scheduling when more than one image is attached", () => {
    renderStoryWizard({
      slotCopies: [storySlotCopy({ mediaIds: ["media-1", "media-2"] })],
      libraryItems: [storyReadyAsset("media-1"), storyReadyAsset("media-2")],
    });

    expect(screen.queryByText(/Story media ready to schedule/i)).not.toBeInTheDocument();
    expect(screen.getByText(/single image/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Schedule stories/i })).toBeDisabled();
  });

  it("blocks scheduling when no media is attached", () => {
    renderStoryWizard({
      slotCopies: [storySlotCopy({ mediaIds: [] })],
      libraryItems: [],
    });

    expect(screen.queryByText(/Story media ready to schedule/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Schedule stories/i })).toBeDisabled();
  });

  it("keeps story overlay text when the auto-seed effect rebuilds the slot", async () => {
    const onSlotCopiesChange = vi.fn();
    render(
      storyWizard({
        onSlotCopiesChange,
        // A stale scheduledAt is what a schedule change looks like to the
        // auto-seed effect: the signature differs, so it rebuilds every slot
        // from scratch. Typed overlay text must survive that rebuild.
        slotCopies: [
          storySlotCopy({
            scheduledAt: slotIso(STORY_SLOT.date, "06:00"),
            bannerTextOverride: "£5 PINTS",
          }),
        ],
      }),
    );

    await waitFor(() => expect(onSlotCopiesChange).toHaveBeenCalled());

    const rebuilt = onSlotCopiesChange.mock.calls.at(-1)?.[0] as SlotGeneratedCopy[];
    expect(rebuilt[0].scheduledAt).toBe(slotIso(STORY_SLOT.date, STORY_SLOT.time));
    expect(rebuilt[0].bannerTextOverride).toBe("£5 PINTS");
  });

  // -------------------------------------------------------------------------
  // Mixed feed and story briefs
  // -------------------------------------------------------------------------

  it("shows a story preview alongside the feed preview for mixed placements", () => {
    renderOverlayStep([readySlot({ bannerTextOverride: "QUIZ" })], vi.fn(), {
      brief: { placements: ["feed", "story"] },
      libraryItems: [storyReadyAsset("media-1")],
    });

    const storyPreview = screen.getByTestId("story-preview");
    expect(storyPreview).toBeInTheDocument();
    expect(storyPreview.querySelector("[data-media-placement='story']")).not.toBeNull();
    // One text field drives both previews: mixed placements share one overlay.
    expect(screen.getAllByLabelText("Image overlay (optional)")).toHaveLength(1);
    expect(screen.getByAltText("Story media")).toHaveAttribute(
      "src",
      "https://example.com/media-1-story.jpg",
    );
  });

  it("does not show a story preview for a feed-only brief", () => {
    renderOverlayStep([readySlot({ bannerTextOverride: "QUIZ" })], vi.fn(), {
      libraryItems: [storyReadyAsset("media-1")],
    });

    expect(screen.queryByTestId("story-preview")).not.toBeInTheDocument();
  });
});
