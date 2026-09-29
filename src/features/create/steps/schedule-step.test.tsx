// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ExistingPlannerItemDisplay } from "@/features/create/schedule/schedule-calendar";
import { ScheduleStep } from "@/features/create/steps/schedule-step";
import type { ContentBrief } from "@/features/create/schemas/content-schemas";
import type { ScheduleSlot } from "@/types/content";

const getCalendarItemsActionMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/actions/content", () => ({
  getCalendarItemsAction: getCalendarItemsActionMock,
}));

beforeEach(() => {
  // An empty planner unless a test says otherwise: how every new venue starts.
  getCalendarItemsActionMock.mockResolvedValue({ data: [] });
});

const storyBrief: ContentBrief = {
  contentType: "story",
  title: "Weekend story",
  prompt: "",
  platforms: ["facebook", "instagram"],
  tone: "friendly_warm",
  lengthPreference: "standard",
  includeHashtags: true,
  includeEmojis: true,
  ctaStyle: "default",
  proofPoints: [],
};

function StoryScheduleHarness() {
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);

  return (
    <ScheduleStep
      contentId="draft-1"
      contentBrief={storyBrief}
      publishMode="schedule"
      selectedSlots={slots}
      onPublishModeChange={vi.fn()}
      onSlotsChange={setSlots}
      accountId="acc-1"
    />
  );
}

describe("<ScheduleStep />", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("keeps earlier story slots when another story slot is added", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T08:00:00.000Z"));

    render(<StoryScheduleHarness />);

    fireEvent.click(screen.getByLabelText("Add custom slot for 5 May"));
    fireEvent.click(screen.getByRole("button", { name: "7am" }));

    expect(screen.getByText("1 slot selected.")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Add custom slot for 6 May"));
    fireEvent.click(screen.getByRole("button", { name: "7am" }));

    expect(screen.getByText("2 slots selected.")).toBeInTheDocument();
    expect(screen.getAllByText("07:00")).toHaveLength(2);
  });

  it("opens the schedule calendar on the current month, not the event month", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-24T10:00:00.000Z"));

    render(
      <ScheduleStep
        contentId="draft-1"
        contentBrief={{
          contentType: "event",
          title: "Future event",
          prompt: "",
          platforms: ["facebook", "instagram"],
          tone: "friendly_warm",
          lengthPreference: "standard",
          includeHashtags: true,
          includeEmojis: true,
          ctaStyle: "default",
          proofPoints: [],
          eventName: "Future event",
          eventDate: "2026-06-15",
          eventTime: "19:00",
          placements: ["feed"],
        } as ContentBrief}
        publishMode="schedule"
        selectedSlots={[]}
        onPublishModeChange={vi.fn()}
        onSlotsChange={vi.fn()}
        accountId="acc-1"
      />,
    );

    expect(screen.getByText("May 2026")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Event timing: 7am on the day, midday on the days before (PR #31)
// ---------------------------------------------------------------------------

function eventBrief(eventDate: string, eventTime: string): ContentBrief {
  return {
    contentType: "event",
    title: "Live music",
    prompt: "",
    platforms: ["facebook", "instagram"],
    tone: "friendly_warm",
    lengthPreference: "standard",
    includeHashtags: true,
    includeEmojis: true,
    ctaStyle: "default",
    proofPoints: [],
    eventName: "Live music",
    eventDate,
    eventTime,
    placements: ["feed", "story"],
  } as ContentBrief;
}

function existingPost(id: string, scheduledFor: string): ExistingPlannerItemDisplay {
  return {
    id,
    scheduledFor,
    platform: "facebook",
    status: "scheduled",
    placement: "feed",
    campaignName: "Quiz night",
  };
}

function EventScheduleHarness({
  brief,
  onSlotsChange,
}: {
  brief: ContentBrief;
  onSlotsChange: (slots: ScheduleSlot[]) => void;
}) {
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);

  return (
    <ScheduleStep
      contentId="draft-1"
      contentBrief={brief}
      publishMode="schedule"
      selectedSlots={slots}
      onPublishModeChange={vi.fn()}
      onSlotsChange={(next) => {
        setSlots(next);
        onSlotsChange(next);
      }}
      accountId="acc-1"
    />
  );
}

/** The suggestion buttons in calendar order, as "<label> · <time>". */
function suggestedSlots(): string[] {
  return screen
    .getAllByRole("button", { name: /^Add suggested slot · / })
    .map((button) => (button.textContent ?? "").replace("Add suggested slot · ", ""));
}

async function plannerLoaded(): Promise<void> {
  await waitFor(() => expect(getCalendarItemsActionMock).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByText("Loading existing schedule...")).not.toBeInTheDocument());
}

describe("<ScheduleStep /> event timing", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("suggests the event-day post at 07:00 on an empty planner, on the day the clocks go back", async () => {
    // Monday 12 October 2026, 09:00 BST. The event is on Sunday 25 October,
    // when the clocks go back from BST to GMT at 02:00. Only Date is faked so
    // the planner fetch and waitFor still run on real timers.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T08:00:00.000Z"));
    const onSlotsChange = vi.fn();

    render(<EventScheduleHarness brief={eventBrief("2026-10-25", "20:00")} onSlotsChange={onSlotsChange} />);
    await plannerLoaded();

    expect(suggestedSlots()).toEqual([
      "Weekly hype · 1 week out · 12:00",
      "2 days to go · 12:00",
      "1 day to go · 12:00",
      "Event day · 07:00",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Add suggested slot · Event day · 07:00" }));

    expect(onSlotsChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ date: "2026-10-25", time: "07:00", label: "Event day", source: "suggestion" }),
    ]);
  });

  it("keeps the event-day post at 07:00 and the usual deconfliction when the month already has posts", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T08:00:00.000Z"));
    getCalendarItemsActionMock.mockResolvedValue({
      data: [
        // Saturday 24 October, 12:00 BST: the "1 day to go" day.
        existingPost("existing-1", "2026-10-24T11:00:00.000Z"),
        // Sunday 25 October, 18:30 GMT: the event day itself.
        existingPost("existing-2", "2026-10-25T18:30:00.000Z"),
      ],
    });

    render(<EventScheduleHarness brief={eventBrief("2026-10-25", "20:00")} onSlotsChange={vi.fn()} />);
    await plannerLoaded();
    expect(screen.getAllByText("Quiz night")).toHaveLength(2);

    // "1 day to go" is dropped because its day is taken and its label only fits
    // that day; the event-day post stays on its day, at 07:00, despite the post
    // already there. Nothing else moves.
    expect(suggestedSlots()).toEqual([
      "Weekly hype · 1 week out · 12:00",
      "2 days to go · 12:00",
      "Event day · 07:00",
    ]);
  });

  it("suggests the event-day post at 07:00 for an event in GMT", async () => {
    // Monday 2 November 2026, 09:00 GMT; the event is on Saturday 14 November.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-02T09:00:00.000Z"));
    const onSlotsChange = vi.fn();

    render(<EventScheduleHarness brief={eventBrief("2026-11-14", "19:00")} onSlotsChange={onSlotsChange} />);
    await plannerLoaded();

    expect(suggestedSlots()).toEqual([
      "Weekly hype · 1 week out · 12:00",
      "2 days to go · 12:00",
      "1 day to go · 12:00",
      "Event day · 07:00",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Add suggested slot · Event day · 07:00" }));

    expect(onSlotsChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ date: "2026-11-14", time: "07:00", label: "Event day", source: "suggestion" }),
    ]);
  });

  it("suggests the event-day post at 07:00 while the planner is still loading", () => {
    // A slow planner fetch must not leave a midday event-day suggestion on
    // screen for the owner to click before the existing posts arrive.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T08:00:00.000Z"));
    getCalendarItemsActionMock.mockReturnValue(new Promise(() => {}));

    render(<EventScheduleHarness brief={eventBrief("2026-10-25", "20:00")} onSlotsChange={vi.fn()} />);

    expect(screen.getByText("Loading existing schedule...")).toBeInTheDocument();
    expect(suggestedSlots()).toContain("Event day · 07:00");
    expect(suggestedSlots()).not.toContain("Event day · 12:00");
  });
});
