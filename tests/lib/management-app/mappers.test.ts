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
      facebook_short_link: "https://l.the-anchor.pub/fb-live-jazz",
      link_in_bio_short_link: "https://l.the-anchor.pub/bio-live-jazz",
      meta_ads_short_link: "https://l.the-anchor.pub/ma-live-jazz",
      meta_ads_destination_url: "https://www.the-anchor.pub/events/live-jazz?utm_source=facebook",
      booking_url: "https://www.the-anchor.pub/events/live-jazz",
      booking_mode: "table",
      payment_mode: "cash_only",
      price_per_seat: 3,
      capacity: 60,
      seats_remaining: 24,
      category: {
        name: "Live Music",
        slug: "live-music",
      },
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
      ctaUrl: "https://l.the-anchor.pub/fb-live-jazz",
      bookingUrl: "https://www.the-anchor.pub/events/live-jazz",
      linkInBioUrl: "https://l.the-anchor.pub/bio-live-jazz",
      metaAdsShortLink: "https://l.the-anchor.pub/ma-live-jazz",
      metaAdsDestinationUrl: "https://www.the-anchor.pub/events/live-jazz?utm_source=facebook",
      ctaLinks: {
        facebook: "https://l.the-anchor.pub/fb-live-jazz",
        instagram: "https://l.the-anchor.pub/bio-live-jazz",
      },
      eventCategoryName: "Live Music",
      eventCategorySlug: "live-music",
      paymentMode: "cash_only",
      bookingMode: "table",
      pricePerSeat: 3,
      capacity: 60,
      seatsRemaining: 24,
    });
    expect(mapped.fields.prompt).toContain("Imported from management app event");
    // The copy fact sheet and a starting tone travel with the prefill.
    expect(mapped.fields.facts).toMatchObject({ price: "£3 per person, paid in cash on arrival", booking: "Book a table" });
    expect(mapped.fields.prompt).toContain("Booking details: booking mode table, payment mode cash_only, price £3 per person.");
    expect(mapped.fields.prompt).toContain("Capacity signal: capacity 60, 24 seats remaining.");
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

    expect(mapped.fields.endDate).toBe("2026-02-12");
    expect(mapped.fields.offerSummary).toBe("Two burgers for one every Tuesday.");
    expect(mapped.sourceLabel).toBe("Burger Tuesday (ends 2026-02-12)");
  });

  it("prefills promotion end date from availableThrough", () => {
    const mapped = mapManagementSpecialToPromotionPrefill({
      id: "special-2",
      name: "Fizz Friday",
      description: "Half price sparkling wine.",
      offers: {
        availableAtOrFrom: "2026-03-10",
        availableThrough: "2026-03-05",
      },
    });

    expect(mapped.fields.endDate).toBe("2026-03-05");
    expect(mapped.sourceLabel).toBe("Fizz Friday (ends 2026-03-05)");
  });
});


describe("management app mappers: copy facts", () => {
  it("cleans the imported brief and suggests a tone from the category", () => {
    const mapped = mapManagementEventToEventCampaignPrefill({
      id: "evt-9",
      name: "Sleigh My Name",
      date: "2026-12-11",
      time: "19:00",
      brief: "## Music Bingo Night\r\n\r\n**Get ready** for a themed night",
      categoryName: "Music Bingo",
      doors_time: "18:30:00",
    });
    expect(mapped.fields.description).toBe("Music Bingo Night\n\nGet ready for a themed night");
    expect(mapped.fields.suggestedTone).toBe("playful");
    expect(mapped.fields.facts).toMatchObject({ category: "Music Bingo", times: "starts 7pm; doors 6:30pm" });
  });
});


describe("management app mappers: Google event post fields", () => {
  const base = { id: "evt-20", name: "Quiz Night", date: "2026-12-04", time: "19:00" };

  it("carries the event id, the Google link and whether it takes bookings", () => {
    const mapped = mapManagementEventToEventCampaignPrefill({
      ...base,
      booking_url: "https://www.the-anchor.pub/events/quiz-night",
      cta_links: { gbp: "https://l.the-anchor.pub/gbp-quiz" },
    });
    expect(mapped.fields).toMatchObject({
      managementEventId: "evt-20",
      googleCtaUrl: "https://l.the-anchor.pub/gbp-quiz",
      takesBookings: true,
    });
    // The Facebook and Instagram links are unchanged by the Google one.
    expect(mapped.fields.ctaLinks).toEqual({});
  });

  it("falls back to the Google short link field, and reports no bookings without a booking link", () => {
    const mapped = mapManagementEventToEventCampaignPrefill({
      ...base,
      google_business_profile_short_link: "https://l.the-anchor.pub/gbp-quiz-2",
    });
    expect(mapped.fields.googleCtaUrl).toBe("https://l.the-anchor.pub/gbp-quiz-2");
    expect(mapped.fields.takesBookings).toBe(false);
  });

  it("uses the management app's end time, with or without seconds", () => {
    expect(mapManagementEventToEventCampaignPrefill({ ...base, end_time: "22:30:00" }).fields.endTime).toBe("22:30");
    expect(mapManagementEventToEventCampaignPrefill({ ...base, end_time: "00:00" }).fields.endTime).toBe("00:00");
  });

  it("prefers the end time over the duration", () => {
    const mapped = mapManagementEventToEventCampaignPrefill({ ...base, end_time: "22:30:00", duration_minutes: 60 });
    expect(mapped.fields.endTime).toBe("22:30");
    expect(mapped.fields.endDate).toBeUndefined();
  });

  it("works the end out from the duration when there is no end time", () => {
    const mapped = mapManagementEventToEventCampaignPrefill({ ...base, duration_minutes: 150 });
    expect(mapped.fields.endTime).toBe("21:30");
    expect(mapped.fields.endDate).toBeUndefined();
  });

  it("never guesses an end: no end time and no usable duration leaves it empty", () => {
    expect(mapManagementEventToEventCampaignPrefill({ ...base }).fields.endTime).toBeUndefined();
    expect(mapManagementEventToEventCampaignPrefill({ ...base, duration_minutes: 0 }).fields.endTime).toBeUndefined();
    expect(mapManagementEventToEventCampaignPrefill({ ...base, end_time: "late" }).fields.endTime).toBeUndefined();
  });

  it("does not work an end out from a placeholder start time", () => {
    const mapped = mapManagementEventToEventCampaignPrefill({ id: "evt-21", name: "No time yet", date: "2026-12-04", duration_minutes: 120 });
    expect(mapped.fields.startTime).toBe("19:00");
    expect(mapped.fields.endTime).toBeUndefined();
  });
});
