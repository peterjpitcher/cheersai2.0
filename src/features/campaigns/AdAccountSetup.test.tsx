/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const fetchAdAccountsMock = vi.hoisted(() => vi.fn());
const selectAdAccountMock = vi.hoisted(() => vi.fn());
const startAdsOAuthMock = vi.hoisted(() => vi.fn());
const disconnectAdAccountMock = vi.hoisted(() => vi.fn());
const replaceMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
    refresh: refreshMock,
  }),
  useSearchParams: () => new URLSearchParams("ads_step=select_account"),
}));

vi.mock("@/app/(app)/connections/actions-ads", () => ({
  disconnectAdAccount: disconnectAdAccountMock,
  fetchAdAccounts: fetchAdAccountsMock,
  selectAdAccount: selectAdAccountMock,
  startAdsOAuth: startAdsOAuthMock,
}));

vi.mock("@/components/providers/toast-provider", () => ({
  useToast: () => ({
    error: toastErrorMock,
    success: toastSuccessMock,
  }),
}));

import { AdAccountSetup } from "./AdAccountSetup";
import type { AdAccountSetupStatus } from "@/app/(app)/connections/actions-ads";

const baseStatus: AdAccountSetupStatus = {
  connected: true,
  setupComplete: false,
  tokenExpiringSoon: false,
  metaPixelId: null,
  conversionEventName: "Purchase",
  conversionOptimisationEnabled: true,
  conversionReady: false,
  conversionIssues: [],
  conversionsApiConfigured: false,
};

describe("AdAccountSetup", () => {
  beforeEach(() => {
    fetchAdAccountsMock.mockResolvedValue({
      success: true,
      accounts: [
        {
          id: "act_111",
          name: "The Anchor",
          currency: "GBP",
          timezoneName: "Europe/London",
        },
        {
          id: "act_222",
          name: "Barons Paid Media",
          currency: "GBP",
          timezoneName: "Europe/London",
        },
      ],
    });
    selectAdAccountMock.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("selects only the clicked ad account and refreshes the clean connections route", async () => {
    let resolveSelection: ((result: { success: true }) => void) | undefined;
    selectAdAccountMock.mockImplementationOnce(
      () =>
        new Promise<{ success: true }>((resolve) => {
          resolveSelection = resolve;
        }),
    );

    render(<AdAccountSetup initialStatus={baseStatus} canDisconnect={false} />);

    await screen.findByText("The Anchor");
    await screen.findByText("Barons Paid Media");

    const buttons = screen.getAllByRole("button", { name: "Select" });
    fireEvent.click(buttons[1]);

    expect(screen.getByRole("button", { name: "Selecting..." })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Select" })).toHaveLength(1);

    await act(async () => {
      resolveSelection?.({ success: true });
    });

    await waitFor(() => {
      expect(selectAdAccountMock).toHaveBeenCalledWith("act_222");
    });
    expect(selectAdAccountMock).toHaveBeenCalledTimes(1);
    expect(toastSuccessMock).toHaveBeenCalledWith('Ad account "Barons Paid Media" selected');
    expect(replaceMock).toHaveBeenCalledWith("/connections");
    expect(refreshMock).toHaveBeenCalled();
  });
});

describe("AdAccountSetup: disconnect", () => {
  const connectedStatus: AdAccountSetupStatus = { ...baseStatus, setupComplete: true };
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchAdAccountsMock.mockResolvedValue({ success: true, accounts: [] });
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    confirmSpy.mockRestore();
    cleanup();
    vi.clearAllMocks();
  });

  it("offers Disconnect to owners only", () => {
    const { unmount } = render(<AdAccountSetup initialStatus={connectedStatus} canDisconnect={false} />);
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
    unmount();

    render(<AdAccountSetup initialStatus={connectedStatus} canDisconnect />);
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
  });

  it("offers Disconnect while an owner is still choosing an ad account", async () => {
    render(<AdAccountSetup initialStatus={baseStatus} canDisconnect />);

    await screen.findByText("No ad accounts found on this Meta connection.");
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
  });

  it("does nothing when the owner cancels the confirmation", () => {
    confirmSpy.mockReturnValue(false);
    render(<AdAccountSetup initialStatus={connectedStatus} canDisconnect />);

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("Conversions API token"));
    expect(disconnectAdAccountMock).not.toHaveBeenCalled();
  });

  it("disconnects and returns to the clean connections route", async () => {
    disconnectAdAccountMock.mockResolvedValue({ success: true });
    render(<AdAccountSetup initialStatus={connectedStatus} canDisconnect />);

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith("Meta Ads disconnected"));
    expect(disconnectAdAccountMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).toHaveBeenCalledWith("/connections");
    expect(refreshMock).toHaveBeenCalled();
  });

  it("shows the refusal when campaigns are still running", async () => {
    const refusal = "Pause your running campaigns in Campaigns first, so spend cannot carry on after CheersAI loses access.";
    disconnectAdAccountMock.mockResolvedValue({ error: refusal });
    render(<AdAccountSetup initialStatus={connectedStatus} canDisconnect />);

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("Could not disconnect Meta Ads", { description: refusal }),
    );
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("shows the failure when the server action throws", async () => {
    disconnectAdAccountMock.mockRejectedValue(new Error("network down"));
    render(<AdAccountSetup initialStatus={connectedStatus} canDisconnect />);

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("Could not disconnect Meta Ads", { description: "network down" }),
    );
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
