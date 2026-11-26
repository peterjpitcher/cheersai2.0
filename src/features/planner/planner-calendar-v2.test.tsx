// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlannerCalendar } from "@/features/planner/planner-calendar-v2";

import { toGoogleTile } from "@/lib/google-posts/tile";

const router = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("@/features/planner/post-drawer", () => ({
  PostDrawer: ({ contentId, open }: { contentId: string | null; open: boolean }) =>
    open ? <div data-testid="drawer">{contentId}</div> : null,
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/features/planner/google-post-drawer", () => ({
  GooglePostDrawer: ({ googlePostId, open }: { googlePostId: string | null; open: boolean }) =>
    open ? <div data-testid="google-drawer">{googlePostId}</div> : null,
}));

describe("<PlannerCalendar />", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
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

  it("shows a Google post as its own tile and opens it in the Google drawer, as a Facebook tile opens the post drawer", () => {
    const googleId = "5b0d2d0e-3a1c-4c58-9f0a-2f6a3a0f3c11";
    const tile = toGoogleTile({
      id: googleId,
      accountId: "acc-1",
      state: "pending",
      when: new Date("2026-05-20T10:00:00.000Z"),
      title: "Quiz Night",
      campaignName: null,
      thumbnailUrl: null,
    });

    render(<PlannerCalendar items={[]} googleItems={[tile]} materialisedSlots={[]} month="2026-05" showImages={false} />);

    // The channel badge names Google, so the tile is told apart from the Facebook and Instagram ones.
    expect(screen.getByLabelText("Channel: Google")).toBeInTheDocument();
    expect(screen.queryByTestId("google-drawer")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByText("Quiz Night")[0]);

    // Same click, same kind of drawer: no navigation, and never the content drawer (it cannot read a Google post).
    expect(screen.getByTestId("google-drawer")).toHaveTextContent(googleId);
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.queryByTestId("drawer")).not.toBeInTheDocument();
  });

  it("starts the default planner view at the current week", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-24T10:00:00.000Z"));

    render(
      <PlannerCalendar
        items={[]}
        materialisedSlots={[]}
        showImages
      />,
    );

    expect(screen.getByLabelText("Create post for 18 May")).toBeInTheDocument();
    expect(screen.queryByLabelText("Create post for 4 May")).not.toBeInTheDocument();
  });
});
