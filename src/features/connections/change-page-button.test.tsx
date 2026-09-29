/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const initiateMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/(app)/connections/actions", () => ({
  initiateOAuthConnect: initiateMock,
}));

vi.mock("@/components/providers/toast-provider", () => ({
  useToast: () => ({ error: toastErrorMock, success: vi.fn() }),
}));

import { ChangePageButton } from "./change-page-button";

describe("ChangePageButton", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "location", { configurable: true, value: { href: "https://app.test/connections" } });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    cleanup();
  });

  it("starts the Facebook login with the chooser forced, then goes there", async () => {
    initiateMock.mockResolvedValue({ success: true, redirectUrl: "https://www.facebook.com/dialog/oauth?state=x" });
    render(<ChangePageButton provider="facebook" />);

    fireEvent.click(screen.getByRole("button", { name: "Change Page" }));

    await waitFor(() => expect(window.location.href).toBe("https://www.facebook.com/dialog/oauth?state=x"));
    expect(initiateMock).toHaveBeenCalledWith("facebook", { changePage: true });
  });

  it("shows why it could not start", async () => {
    initiateMock.mockResolvedValue({
      success: false,
      error: "Instagram uses the Page connected to Facebook. To change it, use Change Page on the Facebook card.",
    });
    render(<ChangePageButton provider="instagram" />);

    fireEvent.click(screen.getByRole("button", { name: "Change Page" }));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("Could not open Facebook", {
        description: "Instagram uses the Page connected to Facebook. To change it, use Change Page on the Facebook card.",
      }),
    );
    expect(window.location.href).toBe("https://app.test/connections");
  });

  it("restarts a normal connect for Start again", async () => {
    initiateMock.mockResolvedValue({ success: true, redirectUrl: "https://www.facebook.com/dialog/oauth?state=y" });
    render(<ChangePageButton provider="instagram" changePage={false} label="Start again" />);

    fireEvent.click(screen.getByRole("button", { name: "Start again" }));

    await waitFor(() => expect(initiateMock).toHaveBeenCalledWith("instagram", { changePage: false }));
  });
});
