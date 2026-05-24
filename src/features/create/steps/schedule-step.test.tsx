// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScheduleStep } from "@/features/create/steps/schedule-step";
import type { ContentBrief } from "@/features/create/schemas/content-schemas";
import type { ScheduleSlot } from "@/types/content";

vi.mock("@/app/actions/content", () => ({
  getCalendarItemsAction: vi.fn().mockResolvedValue({ data: [] }),
}));

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
});
