/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/app/(app)/connections/actions", () => ({
  initiateOAuthConnect: vi.fn(),
}));

const { initiateGoogleConnectMock, toastError } = vi.hoisted(() => ({
  initiateGoogleConnectMock: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/app/(app)/connections/google-actions", () => ({
  initiateGoogleConnect: initiateGoogleConnectMock,
}));

vi.mock("@/components/providers/toast-provider", () => ({
  useToast: () => ({ error: toastError, success: vi.fn() }),
}));

import { ConnectionOAuthButton } from "./connection-oauth-button";

describe("ConnectionOAuthButton label", () => {
  afterEach(() => {
    cleanup();
  });

  it("says Connect when nothing is stored yet", () => {
    render(<ConnectionOAuthButton provider="facebook" status="needs_action" hasAccessToken={false} />);
    expect(screen.getByRole("button").textContent).toBe("Connect");
  });

  it("says Reconnect when a stored connection needs fixing", () => {
    render(<ConnectionOAuthButton provider="instagram" status="needs_action" hasAccessToken />);
    expect(screen.getByRole("button").textContent).toBe("Reconnect");
  });

  it("keeps the labels for working and expiring connections", () => {
    render(<ConnectionOAuthButton provider="facebook" status="active" hasAccessToken />);
    expect(screen.getByRole("button").textContent).toBe("Update connection");
    cleanup();
    render(<ConnectionOAuthButton provider="facebook" status="expiring" hasAccessToken />);
    expect(screen.getByRole("button").textContent).toBe("Renew access");
  });
});

describe("ConnectionOAuthButton for Google", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("starts the Google sign-in, not the Facebook one, and names Google when it is refused", async () => {
    const { initiateOAuthConnect } = await import("@/app/(app)/connections/actions");
    initiateGoogleConnectMock.mockResolvedValue({ success: false, error: "Google posting is not set up." });
    render(<ConnectionOAuthButton provider="gbp" status="needs_action" hasAccessToken={false} />);

    const button = screen.getByRole("button", { name: "Connect for Google" });
    expect(button.textContent).toBe("Connect");
    fireEvent.click(button);

    await waitFor(() => expect(initiateGoogleConnectMock).toHaveBeenCalledOnce());
    expect(initiateOAuthConnect).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Could not open Google", { description: "Google posting is not set up." }),
    );
  });
});
