import type { ReactNode } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/features/planner/dismiss-notification-button", () => ({
  DismissNotificationButton: () => null,
}));

let resolvePresenter: typeof import("@/features/planner/activity-feed")["resolvePresenter"];
let mapCategoryToLevel: typeof import("@/lib/planner/data")["mapCategoryToLevel"];

beforeAll(async () => {
  const defaults: Record<string, string> = {
    ALERTS_SECRET: "test-alert",
    CRON_SECRET: "test-cron",
    FACEBOOK_APP_SECRET: "fb-secret",
    GOOGLE_MY_BUSINESS_CLIENT_ID: "google-client",
    GOOGLE_MY_BUSINESS_CLIENT_SECRET: "google-secret",
    INSTAGRAM_APP_ID: "ig-app",
    INSTAGRAM_APP_SECRET: "ig-secret",
    INSTAGRAM_VERIFY_TOKEN: "verify",
    OPENAI_API_KEY: "openai",
    RESEND_API_KEY: "resend",
    RESEND_FROM: "notifications@test",
    SUPABASE_SERVICE_ROLE_KEY: "supabase",
    NEXT_PUBLIC_FACEBOOK_APP_ID: "fb-app",
    NEXT_PUBLIC_SITE_URL: "https://example.com",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    NEXT_PUBLIC_SUPABASE_URL: "https://supabase.local",
    ENABLE_CONNECTION_DIAGNOSTICS: "false",
  };

  Object.entries(defaults).forEach(([key, value]) => {
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });

  ({ resolvePresenter } = await import("@/features/planner/activity-feed"));
  ({ mapCategoryToLevel } = await import("@/lib/planner/data"));
});

describe("mapCategoryToLevel", () => {
  it("flags publish failures as errors", () => {
    expect(mapCategoryToLevel("publish_failed")).toBe("error");
  });

  it("flags publish retries as warnings", () => {
    expect(mapCategoryToLevel("publish_retry")).toBe("warning");
  });
});

describe("resolvePresenter", () => {
  const baseItem = {
    id: "notif-1",
    message: "Posting to facebook failed",
    timestamp: new Date().toISOString(),
    level: "error" as const,
    metadata: null as Record<string, unknown> | null,
    category: "publish_failed",
    readAt: null,
  };

  it("builds an error presenter for publish failures with metadata details", () => {
    const presenter = resolvePresenter({
      ...baseItem,
      metadata: { attempt: 2, error: "Rate limit", contentId: "content-123" },
    });

    expect(presenter.badge).toBe("Publish failed");
    expect(presenter.containerClass).toContain("border-rose");
    expect(presenter.details).toContain("Attempt 2");
    expect(presenter.details).toContain("Rate limit");
    expect(presenter.action).toEqual({ href: "/planner/content-123", label: "Review post" });
  });

  it("builds a warning presenter for publish retries and keeps planner action", () => {
    const presenter = resolvePresenter({
      ...baseItem,
      level: "warning",
      category: "publish_retry",
      metadata: {
        attempt: 3,
        nextAttemptAt: "2025-01-01T10:00:00.000Z",
        error: "Temporary failure",
      },
    });

    expect(presenter.badge).toBe("Retry scheduled");
    expect(presenter.containerClass).toContain("border-amber");
    expect(presenter.details).toContain("Attempt 3");
    expect(presenter.details).toContain("Temporary failure");
    expect(presenter.action).toEqual({ href: "/planner", label: "View post" });
  });

  it("presents media derivative skips with a library action", () => {
    const presenter = resolvePresenter({
      ...baseItem,
      level: "warning",
      category: "media_derivative_skipped",
      message: "Derivatives skipped",
      metadata: { assetId: "asset-1", reason: "unsupported_media_type" },
    });

    expect(presenter.badge).toBe("Media derivatives");
    expect(presenter.action).toEqual({ href: "/library?asset=asset-1", label: "Review media" });
    expect(presenter.details).toContain("Video derivatives are skipped");
  });

  it("presents media derivative failures with retry guidance", () => {
    const presenter = resolvePresenter({
      ...baseItem,
      category: "media_derivative_failed",
      message: "Derivatives failed",
      metadata: { assetId: "asset-2", error: "FFmpeg crashed" },
    });

    expect(presenter.badge).toBe("Media derivatives failed");
    expect(presenter.details).toContain("FFmpeg crashed");
    expect(presenter.action).toEqual({ href: "/library?asset=asset-2", label: "Retry processing" });
  });
});
