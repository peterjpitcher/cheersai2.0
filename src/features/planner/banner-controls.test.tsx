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

  it("saves custom text per post with fixed banner presentation", async () => {
    updatePlannerBannerConfigMock.mockResolvedValueOnce({});
    const onUpdate = vi.fn();

    render(
      <BannerControls
        contentItemId="content-1"
        status="draft"
        accountDefaults={accountDefaults}
        overrides={defaultOverrides}
        autoLabel="THIS FRIDAY"
        onUpdate={onUpdate}
      />,
    );

    expect(screen.getByText(/right-side gold banner/i)).toBeInTheDocument();

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

  it("clears post custom text back to the automatic label", async () => {
    updatePlannerBannerConfigMock.mockResolvedValueOnce({});

    render(
      <BannerControls
        contentItemId="content-1"
        status="draft"
        accountDefaults={accountDefaults}
        overrides={{ ...defaultOverrides, banner_text_override: "BANK HOLIDAY" }}
        autoLabel="THIS FRIDAY"
      />,
    );

    const input = screen.getByLabelText("Custom overlay text");
    expect(input).toHaveValue("BANK HOLIDAY");

    fireEvent.click(screen.getByRole("button", { name: "Auto" }));

    await waitFor(() => {
      expect(updatePlannerBannerConfigMock).toHaveBeenCalledWith(
        expect.objectContaining({ textOverride: null }),
      );
    });
  });
});
