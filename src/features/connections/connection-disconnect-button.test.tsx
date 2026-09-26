/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const disconnectProviderMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/(app)/connections/actions", () => ({
  disconnectProvider: disconnectProviderMock,
}));

vi.mock("@/components/providers/toast-provider", () => ({
  useToast: () => ({
    error: toastErrorMock,
    success: toastSuccessMock,
  }),
}));

import { ConnectionDisconnectButton } from "./connection-disconnect-button";

describe("ConnectionDisconnectButton", () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    confirmSpy.mockRestore();
    cleanup();
  });

  it("does nothing when the owner cancels the confirmation", () => {
    confirmSpy.mockReturnValue(false);
    render(<ConnectionDisconnectButton provider="facebook" />);

    fireEvent.click(screen.getByRole("button", { name: "Disconnect Facebook" }));

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("scheduled Facebook posts will fail until you reconnect"));
    expect(disconnectProviderMock).not.toHaveBeenCalled();
  });

  it("disconnects the provider and confirms it", async () => {
    disconnectProviderMock.mockResolvedValue({ success: true });
    render(<ConnectionDisconnectButton provider="instagram" />);

    fireEvent.click(screen.getByRole("button", { name: "Disconnect Instagram" }));

    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith("Instagram disconnected"));
    expect(disconnectProviderMock).toHaveBeenCalledWith("instagram");
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("shows the failure when the disconnect does not complete", async () => {
    disconnectProviderMock.mockResolvedValue({ success: false, error: "Failed to disconnect provider" });
    render(<ConnectionDisconnectButton provider="facebook" />);

    fireEvent.click(screen.getByRole("button", { name: "Disconnect Facebook" }));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("Could not disconnect Facebook", {
        description: "Failed to disconnect provider",
      }),
    );
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it("shows the failure when the server action throws", async () => {
    disconnectProviderMock.mockRejectedValue(new Error("Only an owner of this brand can do that."));
    render(<ConnectionDisconnectButton provider="facebook" />);

    fireEvent.click(screen.getByRole("button", { name: "Disconnect Facebook" }));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("Could not disconnect Facebook", {
        description: "Only an owner of this brand can do that.",
      }),
    );
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });
});
