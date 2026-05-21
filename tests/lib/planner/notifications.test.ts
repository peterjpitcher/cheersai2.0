import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthContextMock = vi.fn();

vi.mock("@/lib/auth/server", () => ({
  requireAuthContext: requireAuthContextMock,
}));

describe("planner notifications", () => {
  beforeEach(() => {
    vi.resetModules();
    requireAuthContextMock.mockReset();
  });

  it("counts only unread actionable notifications for the header badge", async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      is: vi.fn(),
      or: vi.fn(),
      gte: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.is.mockReturnValue(query);
    query.or.mockReturnValue(query);
    query.gte.mockResolvedValue({ count: 3, error: null });

    const from = vi.fn(() => query);
    requireAuthContextMock.mockResolvedValue({
      accountId: "account-1",
      supabase: { from },
    });

    const { getUnreadNotificationCount } = await import("@/lib/planner/notifications");
    const count = await getUnreadNotificationCount();

    expect(count).toBe(3);
    expect(from).toHaveBeenCalledWith("notifications");
    expect(query.eq).toHaveBeenCalledWith("account_id", "account-1");
    expect(query.is).toHaveBeenCalledWith("read_at", null);
    expect(query.is).toHaveBeenCalledWith("dismissed_at", null);
    expect(query.or).toHaveBeenCalledWith(expect.stringContaining("urgency.eq.urgent"));
    expect(query.or).toHaveBeenCalledWith(expect.stringContaining("publish_failed"));
    expect(query.or).toHaveBeenCalledWith(expect.stringContaining("connection_expiring"));
    expect(query.or).not.toHaveBeenCalledWith(expect.stringContaining("publish_success"));
    expect(query.or).not.toHaveBeenCalledWith(expect.stringContaining("content_approved"));
    expect(query.gte).toHaveBeenCalledWith("created_at", expect.any(String));
  });

  it("classifies only problems as header badge alerts", async () => {
    const { isHeaderBadgeNotification } = await import("@/lib/planner/notifications");

    expect(isHeaderBadgeNotification({ urgency: "standard", category: "content_approved" })).toBe(false);
    expect(isHeaderBadgeNotification({ urgency: "standard", category: "publish_success" })).toBe(false);
    expect(isHeaderBadgeNotification({ urgency: "standard", category: "story_publish_succeeded" })).toBe(false);
    expect(isHeaderBadgeNotification({ urgency: "standard", category: "publish_retry" })).toBe(false);
    expect(isHeaderBadgeNotification({ urgency: "standard", category: "connection_metadata_updated" })).toBe(false);
    expect(isHeaderBadgeNotification({ urgency: "standard", category: "publish_failed" })).toBe(true);
    expect(isHeaderBadgeNotification({ urgency: "standard", category: "connection_expiring" })).toBe(true);
    expect(isHeaderBadgeNotification({ urgency: "standard", category: "media_derivative_failed" })).toBe(true);
    expect(isHeaderBadgeNotification({ urgency: "urgent", category: "custom_alert" })).toBe(true);
  });
});
