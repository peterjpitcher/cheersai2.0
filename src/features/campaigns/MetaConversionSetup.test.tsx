/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const updateAdAccountConversionSettingsMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/(app)/connections/actions-ads", () => ({
  updateAdAccountConversionSettings: updateAdAccountConversionSettingsMock,
}));

vi.mock("@/components/providers/toast-provider", () => ({
  useToast: () => ({
    error: toastErrorMock,
    success: toastSuccessMock,
  }),
}));

import { MetaConversionSetup } from "./MetaConversionSetup";
import type { AdAccountSetupStatus } from "@/app/(app)/connections/actions-ads";

const baseStatus: AdAccountSetupStatus = {
  connected: true,
  setupComplete: true,
  tokenExpiringSoon: false,
  metaPixelId: null,
  conversionEventName: "Purchase",
  conversionOptimisationEnabled: true,
  conversionReady: false,
  conversionIssues: ["Add the venue Meta pixel ID."],
  conversionsApiConfigured: false,
};

describe("MetaConversionSetup", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("does not render before Meta Ads setup is complete", () => {
    const { container } = render(
      <MetaConversionSetup status={{ ...baseStatus, setupComplete: false }} />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("surfaces the booking optimisation blocker", () => {
    render(<MetaConversionSetup status={baseStatus} />);

    expect(screen.getByText("Meta Purchase tracking needs setup")).toBeTruthy();
    expect(screen.getByText("Add the venue Meta pixel ID.")).toBeTruthy();
    expect(screen.getByLabelText("Meta pixel ID")).toBeTruthy();
  });

  it("shows ready state when Purchase tracking is configured", () => {
    render(
      <MetaConversionSetup
        status={{
          ...baseStatus,
          metaPixelId: "123456789012345",
          conversionReady: true,
          conversionIssues: [],
        }}
      />,
    );

    expect(screen.getByText("Meta Purchase tracking is ready")).toBeTruthy();
    expect(screen.getByText("Using pixel 123456789012345 and Purchase optimisation for booking campaigns. CAPI is not configured.")).toBeTruthy();
  });

  it("submits the pixel ID and displays save errors", async () => {
    updateAdAccountConversionSettingsMock.mockResolvedValueOnce({ error: "Invalid pixel" });
    render(<MetaConversionSetup status={baseStatus} />);

    fireEvent.change(screen.getByLabelText("Meta pixel ID"), {
      target: { value: "123456789012345" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(updateAdAccountConversionSettingsMock).toHaveBeenCalledWith({
        metaPixelId: "123456789012345",
        conversionsApiAccessToken: "",
      });
    });
    expect(toastErrorMock).toHaveBeenCalledWith("Conversion setup not saved", {
      description: "Invalid pixel",
    });
  });
});
