import { describe, it, expect } from "vitest";
import {
  inferContentPillar,
  buildPillarNudge,
  CONTENT_PILLAR_KEYS,
  contentPillarSchema,
} from "@/lib/ai/pillars";

describe("inferContentPillar", () => {
  it("should infer food_drink from 'Sunday roast'", () => {
    expect(inferContentPillar("Sunday roast", "")).toBe("food_drink");
  });

  it("should infer events from 'Live music Saturday'", () => {
    expect(inferContentPillar("Live music Saturday", "")).toBe("events");
  });

  it("should infer seasonal from 'Christmas party'", () => {
    // "christmas" = seasonal hit; "party" matches nothing
    expect(inferContentPillar("Christmas party", "Get into the festive spirit")).toBe("seasonal");
  });

  it("should infer customer_love from 'Thank you for the reviews'", () => {
    expect(inferContentPillar("Thank you", "We love reading your feedback and reviews")).toBe(
      "customer_love",
    );
  });

  it("should infer behind_scenes from 'Getting ready for tonight'", () => {
    expect(inferContentPillar("Getting ready", "Behind the scenes prep")).toBe("behind_scenes");
  });

  it("should infer people from 'Meet the new team member'", () => {
    expect(inferContentPillar("New starter", "Meet our new team member")).toBe("people");
  });

  it("should use score-based matching — 'Chef's birthday lunch menu' tips to food_drink", () => {
    // "chef" + "lunch" + "menu" = 3 food hits, 0 people hits
    const result = inferContentPillar("Chef's birthday lunch menu", "");
    expect(result).toBe("food_drink");
  });

  it("should default to food_drink for empty title and prompt", () => {
    expect(inferContentPillar("", "")).toBe("food_drink");
  });

  it("should NOT match 'Sunday sunshine' as seasonal (weather words removed)", () => {
    // "Sunday" and "sunshine" are not seasonal keywords
    const result = inferContentPillar("Sunday sunshine", "Beautiful day");
    // No seasonal keywords — should default to food_drink
    expect(result).not.toBe("seasonal");
  });

  it("should not partially match — 'sun' should not match 'Sunday'", () => {
    // "sun" is not a keyword. "Sunday" should not trigger any pillar.
    const result = inferContentPillar("A sunny day", "");
    expect(result).toBe("food_drink"); // default
  });

  it("should use tie-break order when scores are equal", () => {
    // "live event with food" — events=1 (event), food_drink=1 (food)
    // Tie-break: events > food_drink
    const result = inferContentPillar("Live event with food", "");
    expect(result).toBe("events");
  });
});

describe("buildPillarNudge", () => {
  it("should return null when fewer than 2 recent pillars", () => {
    expect(buildPillarNudge("food_drink", ["food_drink"])).toBeNull();
    expect(buildPillarNudge("food_drink", [])).toBeNull();
  });

  it("should return null when last 2 pillars differ from inferred", () => {
    expect(buildPillarNudge("food_drink", ["events", "seasonal"])).toBeNull();
  });

  it("should return null when inferred is not in recent (events not in recent)", () => {
    expect(buildPillarNudge("events", ["food_drink", "people"])).toBeNull();
  });

  it("should return nudge when last 2 match inferred pillar", () => {
    const nudge = buildPillarNudge("food_drink", ["food_drink", "food_drink"]);
    expect(nudge).toContain("Recent posts have focused on Food & Drink");
    expect(nudge).toContain("different angle");
  });

  it("should suggest alternative pillar labels in nudge", () => {
    const nudge = buildPillarNudge("events", ["events", "events"]);
    expect(nudge).toBeTruthy();
    // Should mention alternatives that are NOT events
    expect(nudge).not.toContain("Events & Entertainment perspective");
  });

  it("should ignore invalid pillar values in recent history", () => {
    // Invalid values are filtered — only 1 valid entry remains
    expect(buildPillarNudge("food_drink", ["INVALID", "food_drink"])).toBeNull();
  });
});

describe("contentPillarSchema", () => {
  it("should accept valid pillars", () => {
    for (const key of CONTENT_PILLAR_KEYS) {
      expect(contentPillarSchema.parse(key)).toBe(key);
    }
  });

  it("should reject invalid values", () => {
    expect(() => contentPillarSchema.parse("injected")).toThrow();
  });
});
