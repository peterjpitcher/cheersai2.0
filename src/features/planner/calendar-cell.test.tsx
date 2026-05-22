// @vitest-environment jsdom
/* eslint-disable @next/next/no-img-element */
import { cleanup, render, screen } from "@testing-library/react";
import { DateTime } from "luxon";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CalendarCell } from "@/features/planner/calendar-cell";
import type { ContentItem } from "@/types/content";

vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    className,
  }: {
    src: string;
    alt: string;
    className?: string;
  }) => <img src={src} alt={alt} className={className} />,
}));

const baseItem: ContentItem = {
  id: "content-1",
  accountId: "account-1",
  contentType: "story",
  status: "scheduled",
  title: "Story post",
  bodyDraft: { platforms: ["instagram"] },
  campaignName: null,
  scheduledAt: new Date("2026-05-22T07:00:00.000Z"),
  eventDate: null,
  eventEndDate: null,
  couponCode: null,
  recurringDayOfWeek: null,
  autoConfirm: false,
  aiGenerationParams: null,
  thumbnailUrl: "https://example.com/story.jpg",
  placement: "story",
  platform: "instagram",
  createdAt: new Date("2026-05-21T12:00:00.000Z"),
  updatedAt: new Date("2026-05-21T12:00:00.000Z"),
};

describe("CalendarCell media sizing", () => {
  afterEach(() => cleanup());

  it("uses the shared 9:16 media frame for story thumbnails", () => {
    render(
      <CalendarCell
        date={DateTime.fromISO("2026-05-22", { zone: "Europe/London" })}
        items={[baseItem]}
        conflicts={[]}
        isToday={false}
        isMuted={false}
        showImages
        onItemClick={vi.fn()}
      />,
    );

    const frame = screen.getByAltText("Story post").closest("[data-media-placement]");

    expect(frame).toHaveAttribute("data-media-placement", "story");
    expect(frame).toHaveAttribute("data-media-size", "calendar");
    expect(frame).toHaveClass("aspect-[9/16]");
    expect(frame).not.toHaveClass("aspect-video");
  });

  it("renders an icon-only channel marker from the item platform", () => {
    render(
      <CalendarCell
        date={DateTime.fromISO("2026-05-22", { zone: "Europe/London" })}
        items={[{ ...baseItem, platform: "facebook", bodyDraft: { platforms: ["instagram"] } }]}
        conflicts={[]}
        isToday={false}
        isMuted={false}
        showImages
        onItemClick={vi.fn()}
      />,
    );

    expect(screen.getByTitle("Channel: Facebook")).toBeInTheDocument();
    expect(screen.queryByText("Facebook")).not.toBeInTheDocument();
  });
});
