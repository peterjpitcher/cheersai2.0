// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlannerCalendar } from "@/features/planner/planner-calendar-v2";

vi.mock("@/features/planner/post-drawer", () => ({
  PostDrawer: () => null,
}));

describe("<PlannerCalendar />", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows labelled month navigation controls and emits the next month immediately", () => {
    const onMonthChange = vi.fn();

    render(
      <PlannerCalendar
        items={[]}
        materialisedSlots={[]}
        month="2026-05"
        showImages
        onMonthChange={onMonthChange}
      />,
    );

    expect(screen.getByText("Previous")).toBeInTheDocument();
    expect(screen.getByText("Next")).toBeInTheDocument();
    expect(screen.getByText("May 2026")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next month, June 2026" }));

    expect(onMonthChange).toHaveBeenCalledWith("2026-06");
  });
});
