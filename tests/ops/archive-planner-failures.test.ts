import { describe, expect, it } from "vitest";

import {
  collectNotificationIdsToDismiss,
  parseArgs,
  type NotificationForCleanup,
} from "../../scripts/ops/archive-planner-failures";

describe("archive-planner-failures ops helpers", () => {
  it("defaults to dry-run for The Anchor", () => {
    expect(parseArgs([])).toEqual({
      execute: false,
      account: "The Anchor",
      cutoffDays: 30,
    });
  });

  it("parses execute mode and account id", () => {
    expect(parseArgs(["--execute", "--account-id", "account-1", "--cutoff-days", "14"])).toEqual({
      execute: true,
      account: "The Anchor",
      accountId: "account-1",
      cutoffDays: 14,
    });
  });

  it("dismisses archived post alerts and stale retry alerts", () => {
    const now = new Date("2026-07-05T12:00:00.000Z");
    const staleBefore = new Date("2026-06-05T12:00:00.000Z");
    const notifications: NotificationForCleanup[] = [
      {
        id: "archived-post-alert",
        category: "publish_failed",
        metadata: { contentId: "content-1" },
        created_at: "2026-07-01T12:00:00.000Z",
      },
      {
        id: "active-retry-alert",
        category: "publish_retry",
        metadata: { jobId: "job-active", nextAttemptAt: "2026-07-05T12:05:00.000Z" },
        created_at: "2026-07-05T11:59:00.000Z",
      },
      {
        id: "stale-retry-alert",
        category: "story_publish_retry",
        metadata: { jobId: "job-missing", nextAttemptAt: "2026-07-04T12:00:00.000Z" },
        created_at: "2026-07-04T12:00:00.000Z",
      },
      {
        id: "old-problem-alert",
        category: "connection_needs_action",
        metadata: {},
        created_at: "2026-05-01T12:00:00.000Z",
      },
      {
        id: "already-dismissed",
        category: "publish_failed",
        metadata: { contentId: "content-1" },
        created_at: "2026-07-01T12:00:00.000Z",
        dismissed_at: "2026-07-02T12:00:00.000Z",
      },
    ];

    expect(
      collectNotificationIdsToDismiss({
        notifications,
        archivedContentIds: new Set(["content-1"]),
        activeJobIds: new Set(["job-active"]),
        now,
        staleBefore,
      }).sort(),
    ).toEqual(["archived-post-alert", "old-problem-alert", "stale-retry-alert"]);
  });
});
