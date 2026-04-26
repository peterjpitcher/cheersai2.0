import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";

/**
 * Tests the grouping logic used by GeneratedContentReviewList.
 * Extracted to verify that items with different scheduled times but the same
 * planIndex are grouped into one review row.
 */

type Platform = "facebook" | "instagram" | "gbp";

interface MockItem {
  id: string;
  platform: Platform;
  scheduledFor: string | null;
  campaign: { id: string; name: string } | null;
  promptContext: Record<string, unknown> | null;
}

interface ReviewRow {
  key: string;
  dateTime: DateTime | null;
  items: Partial<Record<Platform, MockItem>>;
}

/**
 * Mirrors the grouping logic from generated-content-review-list.tsx
 */
function groupItems(items: MockItem[], ownerTimezone: string): ReviewRow[] {
  const map = new Map<string, ReviewRow>();

  items.forEach((item) => {
    const scheduled = item.scheduledFor
      ? DateTime.fromISO(item.scheduledFor, { zone: "utc" }).setZone(ownerTimezone)
      : null;

    const campaignId = item.campaign?.id ?? "no-campaign";
    const ctx = item.promptContext;
    const planIndex = ctx?.planIndex;
    const legacySlot = ctx?.slot ?? ctx?.phase ?? ctx?.occurrenceIndex ?? ctx?.slotIndex;
    const planKey = planIndex != null
      ? `${campaignId}:plan-${planIndex}`
      : legacySlot != null
        ? `${campaignId}:slot-${legacySlot}`
        : scheduled
          ? `${campaignId}:day-${scheduled.startOf("day").toISODate()}`
          : `draft-${item.id}`;

    const existing = map.get(planKey) ?? {
      key: planKey,
      dateTime: scheduled,
      items: {},
    };

    if (scheduled && (!existing.dateTime || scheduled.toMillis() < existing.dateTime.toMillis())) {
      existing.dateTime = scheduled;
    }

    existing.items[item.platform] = item;
    map.set(planKey, existing);
  });

  return Array.from(map.values()).sort((a, b) => {
    if (a.dateTime && b.dateTime) return a.dateTime.toMillis() - b.dateTime.toMillis();
    if (a.dateTime && !b.dateTime) return -1;
    if (!a.dateTime && b.dateTime) return 1;
    return a.key.localeCompare(b.key);
  });
}

describe("review list grouping", () => {
  const tz = "Europe/London";
  const campaignId = "campaign-1";

  it("should group facebook and instagram with same planIndex into one row even with different times", () => {
    const items: MockItem[] = [
      {
        id: "fb-1",
        platform: "facebook",
        scheduledFor: "2026-04-27T12:30:00Z",
        campaign: { id: campaignId, name: "Cash Bingo" },
        promptContext: { planIndex: 1 },
      },
      {
        id: "ig-1",
        platform: "instagram",
        scheduledFor: "2026-04-27T11:30:00Z",
        campaign: { id: campaignId, name: "Cash Bingo" },
        promptContext: { planIndex: 1 },
      },
    ];

    const rows = groupItems(items, tz);

    expect(rows).toHaveLength(1);
    expect(rows[0].items.facebook).toBeDefined();
    expect(rows[0].items.instagram).toBeDefined();
  });

  it("should keep items with different planIndex in separate rows", () => {
    const items: MockItem[] = [
      {
        id: "fb-1",
        platform: "facebook",
        scheduledFor: "2026-04-27T12:00:00Z",
        campaign: { id: campaignId, name: "Cash Bingo" },
        promptContext: { planIndex: 0 },
      },
      {
        id: "fb-2",
        platform: "facebook",
        scheduledFor: "2026-04-28T12:00:00Z",
        campaign: { id: campaignId, name: "Cash Bingo" },
        promptContext: { planIndex: 1 },
      },
    ];

    const rows = groupItems(items, tz);

    expect(rows).toHaveLength(2);
    expect(rows[0].items.facebook?.id).toBe("fb-1");
    expect(rows[1].items.facebook?.id).toBe("fb-2");
  });

  it("should not overwrite when two same-platform items have different planIndex on same day", () => {
    const items: MockItem[] = [
      {
        id: "fb-morning",
        platform: "facebook",
        scheduledFor: "2026-04-27T09:00:00Z",
        campaign: { id: campaignId, name: "Cash Bingo" },
        promptContext: { planIndex: 0 },
      },
      {
        id: "fb-evening",
        platform: "facebook",
        scheduledFor: "2026-04-27T18:00:00Z",
        campaign: { id: campaignId, name: "Cash Bingo" },
        promptContext: { planIndex: 1 },
      },
    ];

    const rows = groupItems(items, tz);

    expect(rows).toHaveLength(2);
    expect(rows[0].items.facebook?.id).toBe("fb-morning");
    expect(rows[1].items.facebook?.id).toBe("fb-evening");
  });

  it("should use earliest scheduled time as the row header", () => {
    const items: MockItem[] = [
      {
        id: "fb-1",
        platform: "facebook",
        scheduledFor: "2026-04-27T14:00:00Z",
        campaign: { id: campaignId, name: "Cash Bingo" },
        promptContext: { planIndex: 0 },
      },
      {
        id: "ig-1",
        platform: "instagram",
        scheduledFor: "2026-04-27T11:00:00Z",
        campaign: { id: campaignId, name: "Cash Bingo" },
        promptContext: { planIndex: 0 },
      },
    ];

    const rows = groupItems(items, tz);

    expect(rows).toHaveLength(1);
    // The row dateTime should use the earlier instagram time
    expect(rows[0].dateTime?.hour).toBe(12); // 11:00 UTC = 12:00 BST
  });

  it("should fall back to legacy slot/phase for old content without planIndex", () => {
    const items: MockItem[] = [
      {
        id: "fb-1",
        platform: "facebook",
        scheduledFor: "2026-04-27T12:30:00Z",
        campaign: { id: campaignId, name: "Cash Bingo" },
        promptContext: { slot: "1 week before" },
      },
      {
        id: "ig-1",
        platform: "instagram",
        scheduledFor: "2026-04-27T11:00:00Z",
        campaign: { id: campaignId, name: "Cash Bingo" },
        promptContext: { slot: "1 week before" },
      },
    ];

    const rows = groupItems(items, tz);

    expect(rows).toHaveLength(1);
    expect(rows[0].items.facebook).toBeDefined();
    expect(rows[0].items.instagram).toBeDefined();
  });

  it("should fall back to day grouping for content without planIndex or legacy fields", () => {
    const items: MockItem[] = [
      {
        id: "fb-1",
        platform: "facebook",
        scheduledFor: "2026-04-27T12:30:00Z",
        campaign: { id: campaignId, name: "Test" },
        promptContext: {},
      },
      {
        id: "ig-1",
        platform: "instagram",
        scheduledFor: "2026-04-27T11:00:00Z",
        campaign: { id: campaignId, name: "Test" },
        promptContext: {},
      },
    ];

    const rows = groupItems(items, tz);

    expect(rows).toHaveLength(1);
    expect(rows[0].items.facebook).toBeDefined();
    expect(rows[0].items.instagram).toBeDefined();
  });
});
