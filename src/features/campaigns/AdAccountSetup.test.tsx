/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const fetchAdAccountsMock = vi.hoisted(() => vi.fn());
const selectAdAccountMock = vi.hoisted(() => vi.fn());
const startAdsOAuthMock = vi.hoisted(() => vi.fn());
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

    render(<AdAccountSetup initialStatus={baseStatus} />);

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
