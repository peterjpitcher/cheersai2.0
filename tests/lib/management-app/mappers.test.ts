import { afterEach, describe, expect, it, vi } from "vitest";

import {
  mapManagementEventToEventCampaignPrefill,
  mapManagementSpecialToPromotionPrefill,
} from "@/lib/management-app/mappers";

describe("management app mappers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("maps event detail fields into event campaign values", () => {
    const mapped = mapManagementEventToEventCampaignPrefill({
      id: "evt-1",
      name: "Live Jazz",
      date: "2026-04-09",
      time: "20:00",
      brief: "Short event brief from management.",
      longDescription: "A full live jazz set with local artists.",
      facebook_short_link: "https://vip-club.uk/fb-live-jazz",
      link_in_bio_short_link: "https://vip-club.uk/bio-live-jazz",
      event_status: "published",
      highlights: ["Live saxophone", "Late bar"],
      performer_name: "The Harbours",
      performer_type: "Band",
    });

    expect(mapped.fields).toMatchObject({
      name: "Live Jazz",
      description: "Short event brief from management.",
      startDate: "2026-04-09",
      startTime: "20:00",
      ctaUrl: "https://vip-club.uk/fb-live-jazz",
      linkInBioUrl: "https://vip-club.uk/bio-live-jazz",
    });
    expect(mapped.fields.prompt).toContain("Imported from management app event");
    expect(mapped.fields.prompt).toContain("Highlights: Live saxophone, Late bar.");
    expect(mapped.sourceLabel).toBe("Live Jazz (2026-04-09 20:00)");
  });

  it("maps description only from brief", () => {
    const mapped = mapManagementEventToEventCampaignPrefill({
      id: "evt-2",
      name: "Late Session",
      longDescription: "Long description should not be mapped to description.",
      description: "Generic description should not be mapped either.",
    });

    expect(mapped.fields.description).toBeUndefined();
  });

  it("uses a default promotion window when availability dates are missing", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-05T10:00:00.000Z"));

    const mapped = mapManagementSpecialToPromotionPrefill({
      id: "special-1",
      name: "Burger Tuesday",
      description: "Two burgers for one every Tuesday.",
      section: "Mains",
      offers: {},
    });

    expect(mapped.fields.startDate).toBe("2026-02-05");
    expect(mapped.fields.endDate).toBe("2026-02-12");
    expect(mapped.fields.offerSummary).toBe("Two burgers for one every Tuesday.");
  });

  it("clamps promotion end date so it never lands before start date", () => {
    const mapped = mapManagementSpecialToPromotionPrefill({
      id: "special-2",
      name: "Fizz Friday",
      description: "Half price sparkling wine.",
      offers: {
        availableAtOrFrom: "2026-03-10",
        availableThrough: "2026-03-05",
      },
    });

    expect(mapped.fields.startDate).toBe("2026-03-10");
    expect(mapped.fields.endDate).toBe("2026-03-10");
  });
});
