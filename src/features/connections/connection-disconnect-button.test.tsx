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
    disconnectProviderMock.mockResolvedValue({ success: false, error: "We could not disconnect this account. Please try again." });
    render(<ConnectionDisconnectButton provider="facebook" />);

    fireEvent.click(screen.getByRole("button", { name: "Disconnect Facebook" }));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("Could not disconnect Facebook", {
        description: "We could not disconnect this account. Please try again.",
      }),
    );
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it("shows a plain failure, never the thrown text, when the server action throws", async () => {
    // Production turns a thrown action into React's generic technical sentence.
    disconnectProviderMock.mockRejectedValue(new Error("An error occurred in the Server Components render."));
    render(<ConnectionDisconnectButton provider="facebook" />);

    fireEvent.click(screen.getByRole("button", { name: "Disconnect Facebook" }));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("Could not disconnect Facebook", {
        description: "Please try again.",
      }),
    );
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });
});
