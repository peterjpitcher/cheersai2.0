// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const updatePlannerBannerConfigMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/(app)/planner/actions", () => ({
  updatePlannerBannerConfig: updatePlannerBannerConfigMock,
}));

vi.mock("@/components/providers/toast-provider", () => ({
  useToast: () => ({
    error: toastErrorMock,
  }),
}));

import { BannerControls } from "@/features/planner/banner-controls";
import {
  FIXED_BANNER_BG,
  FIXED_BANNER_POSITION,
  FIXED_BANNER_TEXT,
  type AccountBannerDefaults,
  type PostBannerOverrides,
} from "@/lib/banner/config";

const accountDefaults: AccountBannerDefaults = {
  banners_enabled: true,
  banner_position: "bottom",
  banner_bg: "#005131",
  banner_text_colour: "#1a1a1a",
};

const defaultOverrides: PostBannerOverrides = {
  banner_enabled: null,
  banner_text_override: null,
  banner_position: null,
  banner_bg: null,
  banner_text_colour: null,
};

describe("<BannerControls />", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("enables the overlay and saves custom text with fixed presentation", async () => {
    updatePlannerBannerConfigMock.mockResolvedValueOnce({});
    const onUpdate = vi.fn();

    render(
      <BannerControls
        contentItemId="content-1"
        status="draft"
        accountDefaults={accountDefaults}
        overrides={defaultOverrides}
        onUpdate={onUpdate}
      />,
    );

    expect(screen.getByText(/leave blank for no overlay/i)).toBeInTheDocument();

    const input = screen.getByLabelText("Custom overlay text");
    fireEvent.change(input, { target: { value: "late deal" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(updatePlannerBannerConfigMock).toHaveBeenCalledWith({
        contentItemId: "content-1",
        enabled: true,
        position: FIXED_BANNER_POSITION,
        bgColour: FIXED_BANNER_BG,
        textColour: FIXED_BANNER_TEXT,
        textOverride: "LATE DEAL",
      });
    });

    expect(onUpdate).toHaveBeenCalledWith({
      enabled: true,
      position: FIXED_BANNER_POSITION,
      bgColour: FIXED_BANNER_BG,
      textColour: FIXED_BANNER_TEXT,
      textOverride: "LATE DEAL",
    });
  });

  it("turns the overlay OFF when the text is cleared", async () => {
    updatePlannerBannerConfigMock.mockResolvedValueOnce({});

    render(
      <BannerControls
        contentItemId="content-1"
        status="draft"
        accountDefaults={accountDefaults}
        overrides={{ ...defaultOverrides, banner_enabled: true, banner_text_override: "BANK HOLIDAY" }}
      />,
    );

    const input = screen.getByLabelText("Custom overlay text");
    expect(input).toHaveValue("BANK HOLIDAY");

    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));

    await waitFor(() => {
      expect(updatePlannerBannerConfigMock).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: false, textOverride: null }),
      );
    });
  });

  it("keeps the overlay OFF when a post with no text is re-saved blank (regression)", async () => {
    updatePlannerBannerConfigMock.mockResolvedValueOnce({});

    render(
      <BannerControls
        contentItemId="content-1"
        status="draft"
        accountDefaults={accountDefaults}
        overrides={{ ...defaultOverrides, banner_enabled: false }}
      />,
    );

    const input = screen.getByLabelText("Custom overlay text");
    expect(input).toHaveValue("");
    // Editing then blurring with no text must persist an explicit OFF, never
    // re-enable the banner (the trap this fix closes).
    fireEvent.focus(input);
    fireEvent.blur(input);

    await waitFor(() => {
      expect(updatePlannerBannerConfigMock).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: false, textOverride: null }),
      );
    });
  });

  it("rejects invalid overlay text with a toast and does not persist", async () => {
    render(
      <BannerControls
        contentItemId="content-1"
        status="draft"
        accountDefaults={accountDefaults}
        overrides={defaultOverrides}
      />,
    );

    const input = screen.getByLabelText("Custom overlay text");
    fireEvent.change(input, { target: { value: "QUIZ \u{1F389}" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalled();
    });
    expect(updatePlannerBannerConfigMock).not.toHaveBeenCalled();
  });
});
