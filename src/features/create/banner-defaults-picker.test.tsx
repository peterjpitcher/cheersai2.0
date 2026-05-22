// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BannerDefaultsPicker } from "@/features/create/banner-defaults-picker";
import type { BannerDefaults } from "@/lib/scheduling/banner-config";

const baseValue: BannerDefaults = {
  position: "right",
  bgColour: "gold",
  textColour: "white",
};

afterEach(() => {
  cleanup();
});

describe("<BannerDefaultsPicker />", () => {
  it("shows fixed right-side banner guidance and preview text", () => {
    render(
      <BannerDefaultsPicker
        value={{ ...baseValue, customMessage: "TONIGHT" }}
        onChange={vi.fn()}
        autoLabelPreview="TODAY"
      />,
    );

    expect(screen.getByText(/right-side gold banner/i)).toBeInTheDocument();
    expect(screen.getByText("TONIGHT")).toBeInTheDocument();
  });

  it("uses the automatic label preview instead of hardcoded sample text", () => {
    render(
      <BannerDefaultsPicker
        value={baseValue}
        onChange={vi.fn()}
        autoLabelPreview="TODAY"
      />,
    );

    expect(screen.getByText("TODAY")).toBeInTheDocument();
    expect(screen.queryByText("SAMPLE TEXT")).not.toBeInTheDocument();
  });

  it("does not expose campaign-level overlay text controls", () => {
    const onChange = vi.fn();
    render(
      <BannerDefaultsPicker
        value={baseValue}
        onChange={onChange}
        autoLabelPreview="TODAY"
      />,
    );

    expect(screen.queryByLabelText("Overlay Text")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
