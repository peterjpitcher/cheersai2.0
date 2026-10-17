import { describe, expect, it } from "vitest";

import {
  buildEventFactSheet,
  friendlyClock,
  stripImportedFormatting,
  toneForCategory,
} from "@/lib/management-app/event-facts";

describe("buildEventFactSheet", () => {
  it("turns a cash-on-arrival music bingo record into plain facts", () => {
    const sheet = buildEventFactSheet({
      time: "19:00",
      end_time: "22:00:00",
      doors_time: "18:30:00",
      last_entry_time: "19:15:00",
      categoryName: "Music Bingo",
      payment_mode: "cash_only",
      booking_mode: "communal",
      price: 5,
      price_per_seat: 5,
      performer_name: "Nikki Manfadge",
      highlights: ["two themed rounds", "  ", "dinner served from 4pm to 9pm"],
      faqs: [{ question: "Do I need to book?", answer: "Yes, we recommend booking ahead." }],
    });
    expect(sheet).toEqual({
      category: "Music Bingo",
      times: "7pm to 10pm; doors 6:30pm; last entry 7:15pm",
      price: "£5 per person, paid in cash on arrival",
      booking: "Shared tables: book a place for each person",
      host: "Nikki Manfadge",
      highlights: ["two themed rounds", "dinner served from 4pm to 9pm"],
      faqs: [{ question: "Do I need to book?", answer: "Yes, we recommend booking ahead." }],
    });
  });

  it("gives the book-ahead price and the price on the night when there is an online discount", () => {
    // The API's `price` already has the live discount taken off (40); the
    // ticket price (45) is the price on the night.
    const sheet = buildEventFactSheet({ payment_mode: "prepaid", price: 40, ticket_price: 45, online_discount_type: "fixed", online_discount_value: 5 });
    expect(sheet.price).toBe("£40 per person when booked online in advance; £45 on the night");
    const percent = buildEventFactSheet({ payment_mode: "prepaid", ticket_price: 20, online_discount_type: "percent", online_discount_value: 10, online_discount_ends_at: "2026-11-13T23:59:00Z" });
    expect(percent.price).toBe("10% off per person when booked online in advance until 13 November; £20 on the night");
  });

  it("says free entry for free events and leaves out anything the record does not hold", () => {
    expect(buildEventFactSheet({ is_free: true, payment_mode: "free" })).toEqual({ price: "Free entry" });
    expect(buildEventFactSheet({})).toEqual({});
  });

  it("keeps at most eight FAQs and shortens long answers at a word", () => {
    const faqs = Array.from({ length: 10 }, (_, index) => ({ question: `Question ${index}?`, answer: `${"word ".repeat(100)}end` }));
    const sheet = buildEventFactSheet({ faqs });
    expect(sheet.faqs).toHaveLength(8);
    expect(sheet.faqs?.[0].answer.length).toBeLessThanOrEqual(323);
    expect(sheet.faqs?.[0].answer.endsWith("...")).toBe(true);
  });
});

describe("imported text and tone", () => {
  it("strips Markdown headings, bold and Windows line endings", () => {
    expect(stripImportedFormatting("## Music Bingo Night\r\n\r\n**Get ready** for a night\r\n\r\n\r\nOn **Friday**"))
      .toBe("Music Bingo Night\n\nGet ready for a night\n\nOn Friday");
  });

  it("formats times in house style", () => {
    expect(friendlyClock("19:00")).toBe("7pm");
    expect(friendlyClock("18:30:00")).toBe("6:30pm");
    expect(friendlyClock("noon")).toBeNull();
  });

  it.each([
    ["Music Bingo", "playful"], ["Quiz Night", "playful"], ["Parties", "playful"], ["Cash Bingo", "community_focused"],
    ["Tasting Nights", "friendly_warm"], ["Live Sport", "community_focused"], ["Open Mic", null], [null, null],
  ] as const)("suggests a tone for %s", (category, tone) => {
    expect(toneForCategory(category)).toBe(tone);
  });
});
