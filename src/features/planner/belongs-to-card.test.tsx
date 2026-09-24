// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BelongsToCard } from "@/features/planner/belongs-to-card";

describe("<BelongsToCard />", () => {
  afterEach(() => {
    cleanup();
  });

  it("names the content campaign without linking to the paid campaigns page", () => {
    const { container } = render(<BelongsToCard campaignName="Quiz night" />);

    expect(screen.getByText("Quiz night")).toBeTruthy();
    expect(screen.queryByText("Not part of a campaign")).toBeNull();
    expect(screen.queryByText("View campaign")).toBeNull();
    expect(container.querySelector('a[href^="/campaigns"]')).toBeNull();
  });

  it("labels a post with no campaign as an instant post", () => {
    render(<BelongsToCard campaignName={null} />);

    expect(screen.getByText("Instant post")).toBeTruthy();
    expect(screen.getByText("Not part of a campaign")).toBeTruthy();
  });
});
