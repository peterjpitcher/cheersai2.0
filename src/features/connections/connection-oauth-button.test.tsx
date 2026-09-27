/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/app/(app)/connections/actions", () => ({
  initiateOAuthConnect: vi.fn(),
}));

vi.mock("@/components/providers/toast-provider", () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn() }),
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
