import { describe, expect, it } from "vitest";

import {
  cutToLimit,
  deriveGoogleSummary,
  GOOGLE_SUMMARY_MAX_CHARS,
  holdForWording,
  looksLikeAlcoholPromotion,
} from "@/lib/google-posts/summary";

describe("deriveGoogleSummary: what is removed", () => {
  it("removes links, and the lead-in that pointed at them", () => {
    expect(deriveGoogleSummary("Quiz night this Thursday from 8pm. Book here: https://example.com/quiz?utm_source=fb")).toBe(
      "Quiz night this Thursday from 8pm.",
    );
    expect(deriveGoogleSummary("Music bingo is back!\nBook now 👉 www.example.co.uk/bingo")).toBe("Music bingo is back!");
    expect(deriveGoogleSummary("Tables are filling up. Reserve yours at example.co.uk/book")).toBe("Tables are filling up.");
  });

  it("removes phone numbers and email addresses, with their lead-ins", () => {
    expect(deriveGoogleSummary("Sunday roast is served from noon. Call us on 01784 123456 to book.")).toBe(
      "Sunday roast is served from noon.",
    );
    expect(deriveGoogleSummary("Private hire available.\nEmail hello@example.com")).toBe("Private hire available.");
    expect(deriveGoogleSummary("Ring +44 1784 123456")).toBe("");
    expect(deriveGoogleSummary("Questions? Text 07700 900123")).toBe("Questions?");
  });

  it("removes hashtags and handles but keeps ordinary words, prices and times", () => {
    expect(deriveGoogleSummary("Live football on the big screen tonight at 8pm, £2 entry #football #pub with @someband")).toBe(
      "Live football on the big screen tonight at 8pm, £2 entry with",
    );
    expect(deriveGoogleSummary("Fish & chips Friday. #FishFriday")).toBe("Fish & chips Friday.");
  });

  it("drops 'link in bio' lines, empty lines and doubled spaces", () => {
    expect(deriveGoogleSummary("Cash bingo tonight.  \n\n\n\nTap the link in our bio to book!\n\nSee you there")).toBe(
      "Cash bingo tonight.\n\nSee you there",
    );
  });

  it("keeps the rest of a sentence whose last clause pointed at a link", () => {
    expect(deriveGoogleSummary("Join us for quiz night on Thursday, book at https://example.com/quiz")).toBe(
      "Join us for quiz night on Thursday",
    );
  });

  it("keeps the paragraph breaks of the post", () => {
    expect(deriveGoogleSummary("Line one.\n\nLine two.\nLine three.")).toBe("Line one.\n\nLine two.\nLine three.");
  });

  it("returns an empty string when nothing is left", () => {
    expect(deriveGoogleSummary("#tbt @friends https://example.com")).toBe("");
    expect(deriveGoogleSummary(null)).toBe("");
    expect(deriveGoogleSummary("")).toBe("");
  });

  it("leaves wording without any of those untouched", () => {
    const text = "Tasting night on Friday 20 November, 7pm to 10pm. Six wines from Rioja with a cheese board.";
    expect(deriveGoogleSummary(text)).toBe(text);
  });
});

describe("cutToLimit and the 1,500 character limit", () => {
  it("never returns more than 1,500 code points", () => {
    const long = "This is a sentence about the pub quiz. ".repeat(80);
    const summary = deriveGoogleSummary(long);
    expect(Array.from(summary).length).toBeLessThanOrEqual(GOOGLE_SUMMARY_MAX_CHARS);
    expect(summary.endsWith(".")).toBe(true);
  });

  it("cuts at a word boundary when no sentence ends near the limit", () => {
    const words = "word ".repeat(400);
    const cut = cutToLimit(words);
    expect(Array.from(cut).length).toBeLessThanOrEqual(GOOGLE_SUMMARY_MAX_CHARS);
    expect(cut.endsWith("word")).toBe(true);
  });

  it("counts an emoji as one character and never splits a surrogate pair", () => {
    const emoji = "🍺".repeat(1600);
    const cut = cutToLimit(emoji);
    expect(Array.from(cut).length).toBe(GOOGLE_SUMMARY_MAX_CHARS);
    expect(cut).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);

    const exact = "🎉".repeat(GOOGLE_SUMMARY_MAX_CHARS);
    expect(cutToLimit(exact)).toBe(exact);
  });
});

describe("looksLikeAlcoholPromotion", () => {
  it.each([
    "2 for 1 cocktails every Friday from 5pm.",
    "Happy hour 5 to 7pm: pints and house wine.",
    "20% off all wine this weekend.",
    "£4 pints all day Saturday.",
    "Cocktails just £6 until 9pm.",
    "Prosecco £20 a bottle tonight.",
    "Half price gin on Thursdays.",
    "Bottomless brunch with prosecco.",
    "Buy one get one free on shots.",
    "Drinks offers all night long.",
  ])("holds %s", (text) => {
    expect(looksLikeAlcoholPromotion(text)).toBe(true);
    expect(holdForWording(text)).toBe("alcohol_promotion");
  });

  it.each([
    "Quiz night every Thursday at 8pm. £1 entry, teams of up to six, great prizes.",
    "Music bingo is back on Friday. Grab a drink and your dabber.",
    "Cash bingo on Sunday, £10 a book, doors 6pm.",
    "Live sport: every Premier League match on the big screen.",
    "Wine tasting night, £25 per person, six wines from Rioja with cheese.",
    "Sunday roast from £15.95, served noon to 6pm.",
    "Join us for the darts final. Food served until 9pm.",
  ])("passes %s", (text) => {
    expect(looksLikeAlcoholPromotion(text)).toBe(false);
    expect(holdForWording(text)).toBeNull();
  });

  it("holds empty wording for a person to write", () => {
    expect(holdForWording("   ")).toBe("no_wording");
  });
});
