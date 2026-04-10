import { describe, it, expect } from "vitest";

import { selectHookStrategy, HOOK_STRATEGIES, HOOK_STRATEGY_KEYS, hookStrategySchema } from "@/lib/ai/hooks";
import {
  inferContentPillar,
  buildPillarNudge,
  CONTENT_PILLARS,
  CONTENT_PILLAR_KEYS,
  contentPillarSchema,
} from "@/lib/ai/pillars";
import {
  buildSpreadEvenlySlots,
  getEngagementOptimisedHour,
  type SpreadConfig,
} from "@/lib/scheduling/spread";
import { buildInstantPostPrompt } from "@/lib/ai/prompts";
import { formatFriendlyTime, formatFriendlyTimeFromZoned } from "@/lib/utils/date";
import { DateTime } from "luxon";

/**
 * Integration smoke test: verifies the smart scheduling and copy intelligence
 * features work together end-to-end in a realistic campaign creation flow.
 */

// --- Test fixtures ---

function makeBrandProfile() {
  return {
    toneFormal: 0.4,
    tonePlayful: 0.6,
    keyPhrases: ["proper pub grub"],
    bannedTopics: ["politics"],
    bannedPhrases: ["limited time only"],
    defaultHashtags: ["#TheAnchor", "#PubLife"],
    defaultEmojis: ["🍺", "🎉"],
    facebookSignature: "— The Anchor Team",
    instagramSignature: null,
    gbpCta: "LEARN_MORE",
  };
}

function makeInstantPostInput(overrides?: Record<string, unknown>) {
  return {
    title: "Sunday roast with live music",
    prompt: "Promote our Sunday roast with live acoustic music from 2pm",
    includeHashtags: true,
    includeEmojis: true,
    toneAdjust: null,
    lengthPreference: null,
    ctaStyle: "direct",
    media: [],
    linkInBioUrl: null,
    ctaUrl: null,
    ...overrides,
  };
}

// --- 1. Copy History & Hook Strategy ---

describe("Copy Intelligence: hook strategy selection", () => {
  it("avoids the last 3 hooks used", () => {
    const recentHooks = ["question", "bold_statement", "curiosity_gap"];
    const results = new Set<string>();

    // Run 50 times to get a good sample
    for (let i = 0; i < 50; i++) {
      results.add(selectHookStrategy(recentHooks));
    }

    // Should never pick any of the last 3
    expect(results.has("question")).toBe(false);
    expect(results.has("bold_statement")).toBe(false);
    expect(results.has("curiosity_gap")).toBe(false);

    // Should pick from the remaining 5
    expect(results.size).toBeGreaterThanOrEqual(1);
    for (const hook of results) {
      expect(HOOK_STRATEGY_KEYS).toContain(hook);
    }
  });

  it("falls back gracefully with empty history", () => {
    const hook = selectHookStrategy([]);
    expect(HOOK_STRATEGY_KEYS).toContain(hook);
  });

  it("exports all expected constants", () => {
    expect(Object.keys(HOOK_STRATEGIES)).toHaveLength(8);
    expect(HOOK_STRATEGY_KEYS).toHaveLength(8);
    expect(hookStrategySchema.safeParse("question").success).toBe(true);
    expect(hookStrategySchema.safeParse("invalid_hook").success).toBe(false);
  });
});

// --- 2. Content Pillar Inference ---

describe("Copy Intelligence: content pillar inference", () => {
  it("infers food_drink from menu-related content", () => {
    const pillar = inferContentPillar("Sunday Roast Special", "Our kitchen is serving roast beef with all the trimmings");
    expect(pillar).toBe("food_drink");
  });

  it("infers events from entertainment content", () => {
    const pillar = inferContentPillar("Quiz Night", "Live quiz night with prizes every Wednesday");
    expect(pillar).toBe("events");
  });

  it("infers seasonal from holiday content", () => {
    const pillar = inferContentPillar("Christmas Party", "Book your christmas party with us this winter");
    expect(pillar).toBe("seasonal");
  });

  it("infers customer_love from review content", () => {
    const pillar = inferContentPillar("Our Regulars Love It", "Thank you for the amazing review and feedback");
    expect(pillar).toBe("customer_love");
  });

  it("defaults to food_drink for empty input", () => {
    expect(inferContentPillar("", "")).toBe("food_drink");
  });

  it("builds a pillar nudge when the same pillar appears twice in a row", () => {
    const nudge = buildPillarNudge("food_drink", ["food_drink", "food_drink"]);
    expect(nudge).not.toBeNull();
    expect(nudge).toContain("Food & Drink");
    expect(nudge).toContain("different angle");
  });

  it("returns null nudge when pillars are varied", () => {
    const nudge = buildPillarNudge("food_drink", ["events", "food_drink"]);
    expect(nudge).toBeNull();
  });

  it("exports all expected constants", () => {
    expect(Object.keys(CONTENT_PILLARS)).toHaveLength(6);
    expect(CONTENT_PILLAR_KEYS).toHaveLength(6);
    expect(contentPillarSchema.safeParse("events").success).toBe(true);
    expect(contentPillarSchema.safeParse("invalid_pillar").success).toBe(false);
  });
});

// --- 3. Spread-Evenly Scheduling ---

describe("Spread-evenly scheduling", () => {
  it("distributes posts across empty days in a week", () => {
    const config: SpreadConfig = {
      postsPerWeek: 3,
      platforms: ["facebook", "instagram"],
      staggerPlatforms: true,
      windowStart: new Date(2026, 3, 6), // Monday 6 Apr 2026
      windowEnd: new Date(2026, 3, 12),  // Sunday 12 Apr 2026
    };

    const slots = buildSpreadEvenlySlots(config, []);

    // Should create 3 slots total (postsPerWeek = 3)
    expect(slots).toHaveLength(3);

    // All slots should be within the window
    for (const slot of slots) {
      expect(slot.date.getTime()).toBeGreaterThanOrEqual(config.windowStart.getTime());
      expect(slot.date.getTime()).toBeLessThanOrEqual(config.windowEnd.getTime());
    }

    // With staggering, platforms should be on different days where possible
    const days = new Set(slots.map((s) => s.date.toISOString().slice(0, 10)));
    expect(days.size).toBeGreaterThanOrEqual(2);
  });

  it("avoids days that already have content", () => {
    const config: SpreadConfig = {
      postsPerWeek: 1,
      platforms: ["facebook"],
      staggerPlatforms: false,
      windowStart: new Date(2026, 3, 6),
      windowEnd: new Date(2026, 3, 12),
    };

    const existingPosts = [
      { scheduledFor: new Date(2026, 3, 6), platform: "facebook", placement: "feed" },
      { scheduledFor: new Date(2026, 3, 7), platform: "facebook", placement: "feed" },
    ];

    const slots = buildSpreadEvenlySlots(config, existingPosts);
    expect(slots).toHaveLength(1);

    // Should not pick Monday (6th) or Tuesday (7th) since they already have posts
    const chosenDay = slots[0]!.date.getDate();
    expect(chosenDay).not.toBe(6);
    expect(chosenDay).not.toBe(7);
  });
});

// --- 4. Engagement-Optimised Time ---

describe("Engagement-optimised time selection", () => {
  it("uses defaultPostingTime when provided", () => {
    const result = getEngagementOptimisedHour(
      new Date(2026, 3, 10),
      null,
      "18:30",
    );
    expect(result).toEqual({ hour: 18, minute: 30 });
  });

  it("returns 17:00 for same-day events", () => {
    const eventDate = new Date(2026, 3, 10);
    const scheduledDate = new Date(2026, 3, 10);
    const result = getEngagementOptimisedHour(scheduledDate, eventDate, null);
    expect(result).toEqual({ hour: 17, minute: 0 });
  });

  it("defaults to 12:00 with no preferences", () => {
    const result = getEngagementOptimisedHour(new Date(2026, 3, 10), null, null);
    expect(result).toEqual({ hour: 12, minute: 0 });
  });

  it("defaultPostingTime takes priority over same-day event", () => {
    const eventDate = new Date(2026, 3, 10);
    const scheduledDate = new Date(2026, 3, 10);
    const result = getEngagementOptimisedHour(scheduledDate, eventDate, "09:00");
    expect(result).toEqual({ hour: 9, minute: 0 });
  });
});

// --- 5. Prompt Builder with Copy Intelligence ---

describe("Prompt builder includes copy intelligence context", () => {
  it("includes hook instruction in prompt adjustments", () => {
    const brand = makeBrandProfile();
    const input = makeInstantPostInput();

    const { user } = buildInstantPostPrompt({
      brand: brand as never,
      input: input as never,
      platform: "facebook",
      scheduledFor: new Date(2026, 3, 12, 12, 0),
      context: {
        hookStrategy: "question",
        hookInstruction: "Open with a question that invites a response from the reader.",
      },
    });

    expect(user).toContain("Hook style:");
    expect(user).toContain("Open with a question");
  });

  it("includes pillar nudge when provided in context", () => {
    const brand = makeBrandProfile();
    const input = makeInstantPostInput();

    const pillarNudge = buildPillarNudge("food_drink", ["food_drink", "food_drink"]);

    const { user } = buildInstantPostPrompt({
      brand: brand as never,
      input: input as never,
      platform: "instagram",
      context: {
        pillarNudge,
      },
    });

    expect(user).toContain("Content angle advisory:");
    expect(user).toContain("Food & Drink");
  });

  it("includes temporal proximity tone cue", () => {
    const brand = makeBrandProfile();
    const input = makeInstantPostInput();

    const { user } = buildInstantPostPrompt({
      brand: brand as never,
      input: input as never,
      platform: "facebook",
      context: {
        temporalProximity: "This event is happening today — use urgent, present-tense language.",
      },
    });

    expect(user).toContain("Timing tone:");
    expect(user).toContain("happening today");
  });

  it("includes platform-specific guidance for each platform", () => {
    const brand = makeBrandProfile();
    const input = makeInstantPostInput();

    const fbResult = buildInstantPostPrompt({
      brand: brand as never,
      input: input as never,
      platform: "facebook",
    });
    expect(fbResult.user).toContain("Platform guidance:");
    expect(fbResult.user).toContain("concise");

    const igResult = buildInstantPostPrompt({
      brand: brand as never,
      input: input as never,
      platform: "instagram",
    });
    expect(igResult.user).toContain("first line must stop the scroll");

    const gbpResult = buildInstantPostPrompt({
      brand: brand as never,
      input: input as never,
      platform: "gbp",
      venueName: "The Anchor",
      context: {
        venueLocation: "Shepperton, Surrey",
      },
    });
    expect(gbpResult.user).toContain("Google Business Profile");
    expect(gbpResult.user).toContain("<venue_location>Shepperton, Surrey</venue_location>");
    expect(gbpResult.user).toContain("<venue_name>The Anchor</venue_name>");
  });
});

// --- 6. Date Formatting Utilities ---

describe("Date formatting utilities", () => {
  it("formatFriendlyTime converts Date to 12-hour string", () => {
    // 6pm on a date in Europe/London
    const date = new Date(Date.UTC(2026, 3, 10, 17, 0, 0)); // 17:00 UTC = 18:00 BST
    const result = formatFriendlyTime(date);
    expect(result).toBe("6pm");
  });

  it("formatFriendlyTimeFromZoned handles minutes", () => {
    const zoned = DateTime.fromObject(
      { hour: 13, minute: 30 },
      { zone: "Europe/London" },
    );
    const result = formatFriendlyTimeFromZoned(zoned);
    expect(result).toBe("1:30pm");
  });

  it("formatFriendlyTimeFromZoned handles midnight", () => {
    const zoned = DateTime.fromObject(
      { hour: 0, minute: 0 },
      { zone: "Europe/London" },
    );
    const result = formatFriendlyTimeFromZoned(zoned);
    expect(result).toBe("12am");
  });
});

// --- 7. End-to-end flow: all modules working together ---

describe("End-to-end: scheduling + copy intelligence", () => {
  it("complete flow produces a valid prompt with all intelligence signals", () => {
    // 1. Simulate recent copy history
    const recentHooks = ["question", "bold_statement", "curiosity_gap"];
    const recentPillars = ["food_drink", "food_drink"];

    // 2. Select hook strategy (avoids recent)
    const hookStrategy = selectHookStrategy(recentHooks);
    expect(["direct_address", "seasonal", "scarcity", "behind_scenes", "social_proof"]).toContain(hookStrategy);

    // 3. Infer content pillar from title/prompt
    const pillar = inferContentPillar("Sunday Roast", "roast beef with live music event");
    // Should match food or events
    expect(["food_drink", "events"]).toContain(pillar);

    // 4. Build pillar nudge (should fire since last 2 were food_drink)
    const nudge = buildPillarNudge(pillar === "food_drink" ? "food_drink" : "events", recentPillars);
    // nudge is only non-null if inferred pillar matches both recent entries
    if (pillar === "food_drink") {
      expect(nudge).not.toBeNull();
    }

    // 5. Schedule across a week
    const config: SpreadConfig = {
      postsPerWeek: 3,
      platforms: ["facebook", "instagram", "gbp"],
      staggerPlatforms: true,
      windowStart: new Date(2026, 3, 6),
      windowEnd: new Date(2026, 3, 12),
    };
    const slots = buildSpreadEvenlySlots(config, []);
    expect(slots).toHaveLength(3);

    // 6. Get posting time for first slot
    const time = getEngagementOptimisedHour(slots[0]!.date, null, "18:00");
    expect(time).toEqual({ hour: 18, minute: 0 });

    // 7. Build prompt with all intelligence
    const hookInstruction = HOOK_STRATEGIES[hookStrategy];
    const brand = makeBrandProfile();
    const input = makeInstantPostInput();

    const { system, user } = buildInstantPostPrompt({
      brand: brand as never,
      input: input as never,
      platform: slots[0]!.platform,
      scheduledFor: slots[0]!.date,
      context: {
        hookStrategy,
        hookInstruction,
        pillarNudge: nudge,
        temporalProximity: "This event is coming up this weekend — build anticipation.",
      },
    });

    // Verify system prompt has core instructions
    expect(system).toContain("CheersAI");
    expect(system).toContain("British English");

    // Verify user prompt has all intelligence signals
    expect(user).toContain("Hook style:");
    expect(user).toContain("Timing tone:");
    expect(user).toContain("coming up this weekend");
    expect(user).toContain("Platform guidance:");

    // Pillar nudge only appears if the last 2 pillars matched
    if (nudge) {
      expect(user).toContain("Content angle advisory:");
    }
  });
});
