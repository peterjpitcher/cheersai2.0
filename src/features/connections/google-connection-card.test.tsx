/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/features/connections/connection-oauth-button", () => ({
  ConnectionOAuthButton: ({ provider, hasAccessToken }: { provider: string; hasAccessToken: boolean }) => (
    <div data-testid={`oauth-button-${provider}`} data-stored={String(hasAccessToken)} />
  ),
}));

vi.mock("@/features/connections/connection-disconnect-button", () => ({
  ConnectionDisconnectButton: ({ provider }: { provider: string }) => <div data-testid={`disconnect-button-${provider}`} />,
}));

const mockSummary = vi.fn();
vi.mock("@/lib/connections/google-data", () => ({
  getGoogleConnectionSummary: (...args: unknown[]) => mockSummary(...args),
}));

const { GoogleConnectionCard } = await import("./google-connection-card");

function summary(overrides: Record<string, unknown> = {}) {
  return {
    configured: true,
    connected: true,
    status: "active",
    ready: true,
    locationTitle: "The Anchor",
    hasAccessToken: true,
    hasRefreshToken: true,
    issues: [],
    ...overrides,
  };
}

describe("GoogleConnectionCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders nothing at all for a brand without the switch", async () => {
    mockSummary.mockResolvedValue(null);

    const element = await GoogleConnectionCard({ canManage: true });

    expect(element).toBeNull();
  });

  it("shows the connected location and that access renews by itself", async () => {
    mockSummary.mockResolvedValue(summary());

    render((await GoogleConnectionCard({ canManage: true }))!);

    expect(screen.getByRole("heading", { name: "Google" })).toBeDefined();
    expect(screen.getByText("The Anchor")).toBeDefined();
    expect(screen.getByText("Renews automatically")).toBeDefined();
    expect(screen.getByText("Ready")).toBeDefined();
    expect(screen.queryByText(/expire/i)).toBeNull();
    expect(screen.getByTestId("oauth-button-gbp").getAttribute("data-stored")).toBe("true");
    expect(screen.getByTestId("disconnect-button-gbp")).toBeDefined();
  });

  it("says Google posting is not set up, with no connect button, when the OAuth client is missing", async () => {
    mockSummary.mockResolvedValue(
      summary({ configured: false, connected: false, status: "needs_action", ready: false, locationTitle: null, hasAccessToken: false, hasRefreshToken: false }),
    );

    render((await GoogleConnectionCard({ canManage: true }))!);

    expect(screen.getByText("Google posting is not set up.")).toBeDefined();
    expect(screen.queryByTestId("oauth-button-gbp")).toBeNull();
    expect(screen.queryByTestId("disconnect-button-gbp")).toBeNull();
  });

  it("offers Connect, and no Disconnect, before anything is connected", async () => {
    mockSummary.mockResolvedValue(
      summary({
        connected: false,
        status: "needs_action",
        ready: false,
        locationTitle: null,
        hasAccessToken: false,
        hasRefreshToken: false,
        issues: [{ code: "connection_missing", severity: "error", message: "Connect Google before publishing." }],
      }),
    );

    render((await GoogleConnectionCard({ canManage: true }))!);

    expect(screen.getAllByText("Not connected").length).toBeGreaterThan(0);
    // Never having connected is not shown as an error.
    expect(screen.queryByText("Connect Google before publishing.")).toBeNull();
    expect(screen.getByTestId("oauth-button-gbp").getAttribute("data-stored")).toBe("false");
    expect(screen.queryByTestId("disconnect-button-gbp")).toBeNull();
  });

  it("shows why a connection needs attention", async () => {
    mockSummary.mockResolvedValue(
      summary({
        status: "needs_action",
        ready: false,
        hasRefreshToken: false,
        issues: [{ code: "refresh_token_missing", severity: "error", message: "Google needs to be reconnected." }],
      }),
    );

    render((await GoogleConnectionCard({ canManage: true }))!);

    expect(screen.getByText("Google needs to be reconnected.")).toBeDefined();
    expect(screen.getByText("Action needed")).toBeDefined();
  });

  it("shows no buttons to someone who is not an owner", async () => {
    mockSummary.mockResolvedValue(summary());

    render((await GoogleConnectionCard({ canManage: false }))!);

    expect(screen.queryByTestId("oauth-button-gbp")).toBeNull();
    expect(screen.queryByTestId("disconnect-button-gbp")).toBeNull();
  });
});
