/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

/**
 * Tests for TokenExpiryLabel rendering inside ConnectionCards.
 *
 * We test the TokenExpiryLabel logic indirectly by mocking listConnectionSummaries
 * and rendering the full ConnectionCards server component.
 * Because ConnectionCards is async (server component), we await its return value.
 */

// Mock child components that aren't relevant to token expiry display
vi.mock("@/features/connections/connection-metadata-form", () => ({
  ConnectionMetadataForm: () => <div data-testid="metadata-form" />,
}));

vi.mock("@/features/connections/connection-oauth-button", () => ({
  ConnectionOAuthButton: () => <div data-testid="oauth-button" />,
}));

// Mock listConnectionSummaries
const mockListConnectionSummaries = vi.fn();
vi.mock("@/lib/connections/data", () => ({
  listConnectionSummaries: (...args: unknown[]) => mockListConnectionSummaries(...args),
}));

// Import after mocks are set up
const { ConnectionCards } = await import("./connection-cards");

function makeConnection(overrides: Record<string, unknown> = {}) {
  return {
    provider: "instagram" as const,
    status: "active" as const,
    displayName: "Test Account",
    expiresAt: undefined,
    lastSyncedAt: undefined,
    metadata: { igBusinessId: "123" },
    metadataValid: true,
    metadataMissingKeys: [],
    ...overrides,
  };
}

describe("ConnectionCards — token expiry display", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders "Does not expire" for Facebook with null expiry', async () => {
    mockListConnectionSummaries.mockResolvedValue([
      makeConnection({ provider: "facebook", expiresAt: undefined }),
    ]);

    const element = await ConnectionCards();
    render(element);

    expect(screen.getByText("Does not expire")).toBeDefined();
  });

  it('renders "Unknown expiry" for Instagram with null expiry', async () => {
    mockListConnectionSummaries.mockResolvedValue([
      makeConnection({ provider: "instagram", expiresAt: undefined }),
    ]);

    const element = await ConnectionCards();
    render(element);

    expect(screen.getByText("Unknown expiry")).toBeDefined();
  });

  it('renders "Unknown expiry" for GBP with null expiry', async () => {
    mockListConnectionSummaries.mockResolvedValue([
      makeConnection({ provider: "gbp", expiresAt: undefined }),
    ]);

    const element = await ConnectionCards();
    render(element);

    expect(screen.getByText("Unknown expiry")).toBeDefined();
  });

  it('renders "Expired — reconnect required" for past expiry date', async () => {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    mockListConnectionSummaries.mockResolvedValue([
      makeConnection({ provider: "instagram", expiresAt: pastDate }),
    ]);

    const element = await ConnectionCards();
    render(element);

    expect(screen.getByText("Expired — reconnect required")).toBeDefined();
  });

  it("renders expiry date with warning styling when within 7 days", async () => {
    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const soonIso = soon.toISOString();
    const formatted = soon.toLocaleDateString();

    mockListConnectionSummaries.mockResolvedValue([
      makeConnection({ provider: "gbp", expiresAt: soonIso }),
    ]);

    const element = await ConnectionCards();
    render(element);

    const label = screen.getByText(`Expires ${formatted}`);
    expect(label).toBeDefined();
    expect(label.className).toContain("text-amber-600");
  });

  it("renders plain expiry date when more than 7 days away", async () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const futureIso = future.toISOString();
    const formatted = future.toLocaleDateString();

    mockListConnectionSummaries.mockResolvedValue([
      makeConnection({ provider: "instagram", expiresAt: futureIso }),
    ]);

    const element = await ConnectionCards();
    render(element);

    const label = screen.getByText(formatted);
    expect(label).toBeDefined();
    // Should NOT have warning styling
    expect(label.className).not.toContain("text-amber-600");
    expect(label.className).not.toContain("text-rose-600");
  });
});
