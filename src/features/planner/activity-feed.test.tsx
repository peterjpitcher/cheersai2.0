// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlannerActivityFeed } from "@/features/planner/activity-feed";
import type { FeedEvent } from "@/types/notifications";

// The live feed hands back what it was given; Supabase realtime is not under test here.
vi.mock("@/hooks/use-realtime-feed", () => ({
  useRealtimeFeed: (_accountId: string, initial: FeedEvent[]) => initial,
}));
vi.mock("@/features/planner/dismiss-notification-button", () => ({
  DismissNotificationButton: () => null,
}));

afterEach(() => {
  cleanup();
});

describe("PlannerActivityFeed", () => {
  it("shows an event-order notice as a warning, not ordinary activity", () => {
    render(
      <PlannerActivityFeed
        accountId="acc-1"
        initialEvents={[{
          id: "n-1",
          // The planner page loads every notice as info; the feed decides the level by category.
          level: "info",
          category: "event_order_conflict",
          message: "Christmas Jackpot Cash Bingo: 2 scheduled posts go out before Thursday 19th November, when its promotion may start. Move or delete them in the planner.",
          timestamp: "2026-10-24T06:45:00.000Z",
          metadata: null,
          readAt: null,
        }]}
      />,
    );

    expect(screen.getByText("Heads up")).toBeInTheDocument();
    expect(screen.getByText(/Christmas Jackpot Cash Bingo: 2 scheduled posts go out before/)).toBeInTheDocument();
  });
});
