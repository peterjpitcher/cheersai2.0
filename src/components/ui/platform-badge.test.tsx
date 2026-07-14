// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PlatformBadge } from "@/components/ui/platform-badge";

afterEach(cleanup);

describe("PlatformBadge", () => {
  it("renders the platform label for a known platform", () => {
    render(<PlatformBadge platform="facebook" showLabel />);
    expect(screen.getByText("Facebook")).toBeInTheDocument();
  });

  it("renders a neutral fallback for a null platform without throwing", () => {
    expect(() =>
      render(<PlatformBadge platform={null} showLabel />),
    ).not.toThrow();
    expect(screen.getByText("No platform")).toBeInTheDocument();
  });

  it("renders a neutral fallback for an undefined platform without throwing", () => {
    expect(() =>
      render(<PlatformBadge platform={undefined} showLabel />),
    ).not.toThrow();
    expect(screen.getByText("No platform")).toBeInTheDocument();
  });
});
