// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlannerShell } from "@/features/planner/planner-shell";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  params: new URLSearchParams("status=failed"),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
  useSearchParams: () => navigation.params,
}));

vi.mock("@/features/planner/planner-calendar-v2", () => ({
  PlannerCalendar: ({ month, onMonthChange }: { month?: string; onMonthChange?: (month: string) => void }) => (
    <div>
      <p>Calendar month: {month ?? "current"}</p>
      <button type="button" onClick={() => onMonthChange?.("2026-06")}>
        Go next
      </button>
    </div>
  ),
}));

vi.mock("@/features/planner/planner-agenda", () => ({
  PlannerAgenda: () => <div>Agenda</div>,
}));

vi.mock("@/features/planner/activity-feed", () => ({
  PlannerActivityFeed: () => <div>Activity</div>,
}));

vi.mock("@/components/layout/status-drawer", () => ({
  StatusDrawer: () => <button type="button">Status</button>,
}));

describe("<PlannerShell />", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    navigation.params = new URLSearchParams("status=failed");
  });

  it("updates the displayed month immediately when calendar navigation changes month", () => {
    render(
      <PlannerShell
        items={[]}
        materialisedSlots={[]}
        month="2026-05"
        initialView="cal"
        initialShowImages
        initialStatus="failed"
        dayLine="Sunday 24 May"
        displayMonth="May"
        scheduledCount={0}
        needAttentionCount={0}
        accountId="acc-1"
        initialEvents={[]}
      />,
    );

    expect(screen.getByText("May")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Go next" }));

    expect(screen.getByText("June")).toBeInTheDocument();
    expect(screen.getByText("Calendar month: 2026-06")).toBeInTheDocument();
    expect(navigation.push).toHaveBeenCalledWith("/planner?status=failed&month=2026-06", {
      scroll: false,
    });
  });
});
