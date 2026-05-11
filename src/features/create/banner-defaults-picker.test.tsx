// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  it("shows the editable overlay text in the input and preview", () => {
    render(
      <BannerDefaultsPicker
        value={{ ...baseValue, customMessage: "TONIGHT" }}
        onChange={vi.fn()}
        autoLabelPreview="TODAY"
      />,
    );

    expect(screen.getByLabelText("Overlay Text")).toHaveValue("TONIGHT");
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

  it("normalises edited overlay text before notifying callers", () => {
    const onChange = vi.fn();
    render(
      <BannerDefaultsPicker
        value={baseValue}
        onChange={onChange}
        autoLabelPreview="TODAY"
      />,
    );

    fireEvent.change(screen.getByLabelText("Overlay Text"), {
      target: { value: "late deal" },
    });

    expect(onChange).toHaveBeenCalledWith({
      ...baseValue,
      customMessage: "LATE DEAL",
    });
  });
});
