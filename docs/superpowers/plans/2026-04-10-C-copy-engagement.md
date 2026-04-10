# Plan C: Copy Engagement Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add hook variety rotation, content pillar awareness, platform personality sharpening, and time-aware copy generation to the content creation pipeline.

**Architecture:** New modules for hook selection (hooks.ts) and pillar inference (pillars.ts). Hoisted history fetch with in-memory batch tracking in service.ts. Prompt additions in prompts.ts. Extended temporal proximity in describeEventTimingCue().

**Tech Stack:** TypeScript, Vitest, OpenAI API prompts

**Depends on:** Plan A (Prerequisite Fixes) — requires parallelised OpenAI calls and fixed describeEventTimingCue
**Note:** Plan B's database migration creates the hook_strategy and content_pillar columns this plan writes to. Run Plan B's migration task first.

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `src/lib/ai/hooks.ts` | Hook strategy constants, selection logic, Zod enum |
| Create | `src/lib/ai/pillars.ts` | Content pillar constants, inference logic, Zod enum |
| Modify | `src/lib/create/service.ts` | Hoisted history fetch, batch tracker threading, content_items INSERT columns |
| Modify | `src/lib/ai/prompts.ts` | Hook instruction in adjustments, pillar nudge section, platform guidance additions, temporal proximity, venue XML delimiters |
| Create | `tests/lib/ai/hooks.test.ts` | Tests for hook selection logic |
| Create | `tests/lib/ai/pillars.test.ts` | Tests for pillar inference logic |
| Create | `tests/lib/ai/prompts-engagement.test.ts` | Tests for prompt additions (hook, pillar, platform, temporal) |
| Create | `tests/lib/create/service-engagement.test.ts` | Tests for history fetch and batch tracking integration |

---

## Chunk 1: Hook Strategy Module

### Task 1: Create hook strategy constants and selection logic

**Files:**
- Create: `src/lib/ai/hooks.ts`

- [ ] **Step 1.1: Create `src/lib/ai/hooks.ts` with constants, Zod enum, and selection function**

```typescript
// src/lib/ai/hooks.ts
import { z } from "zod";

/**
 * Eight hook strategies — each has a prompt instruction that tells the AI
 * how to open the post.
 */
export const HOOK_STRATEGIES = {
  question: "Open with a question that invites a response from the reader.",
  bold_statement: "Open with a confident, opinionated statement — own it.",
  direct_address:
    "Open by speaking directly to a specific group (e.g., families, dog owners, rugby fans).",
  curiosity_gap:
    "Open by teasing something without revealing it all — make them want to read on.",
  seasonal:
    "Open with a reference to the weather, season, time of year, or a timely local moment.",
  scarcity:
    "Open by highlighting limited availability, time pressure, or high demand.",
  behind_scenes:
    "Open as if sharing an insider glimpse — something the reader wouldn't normally see.",
  social_proof:
    "Open by referencing popularity, customer love, or high demand for this.",
} as const;

export type HookStrategy = keyof typeof HOOK_STRATEGIES;

export const HOOK_STRATEGY_KEYS = Object.keys(HOOK_STRATEGIES) as HookStrategy[];

/** Zod enum for application-layer validation before DB write. */
export const hookStrategySchema = z.enum([
  "question",
  "bold_statement",
  "direct_address",
  "curiosity_gap",
  "seasonal",
  "scarcity",
  "behind_scenes",
  "social_proof",
]);

/** How many recent hooks to avoid when selecting the next one. */
const LOOKBACK = 3;

/**
 * Pick a hook strategy that avoids the last `LOOKBACK` entries in `recentHooks`.
 *
 * - Filters the 8 strategies to exclude the last 3 in `recentHooks`
 * - Picks one at random from the remaining
 * - If all 8 are exhausted within the lookback window (impossible with 8 strategies
 *   and lookback of 3, but defensive), falls back to full random
 */
export function selectHookStrategy(recentHooks: string[]): HookStrategy {
  const validRecent = recentHooks.filter(
    (h): h is HookStrategy => h in HOOK_STRATEGIES,
  );
  const avoid = new Set(validRecent.slice(-LOOKBACK));
  const candidates = HOOK_STRATEGY_KEYS.filter((k) => !avoid.has(k));

  if (candidates.length === 0) {
    // Defensive fallback — should never happen with 8 strategies and lookback 3
    return HOOK_STRATEGY_KEYS[Math.floor(Math.random() * HOOK_STRATEGY_KEYS.length)]!;
  }

  return candidates[Math.floor(Math.random() * candidates.length)]!;
}

/**
 * Return the prompt instruction line for a given hook strategy.
 */
export function getHookInstruction(strategy: HookStrategy): string {
  return HOOK_STRATEGIES[strategy];
}
```

- [ ] **Step 1.2: Verify file compiles**

```bash
cd /Users/peterpitcher/Cursor/OJ-CheersAI2.0
npx tsc --noEmit --pretty 2>&1 | head -30
```

Expected: no errors related to `hooks.ts`.

- [ ] **Step 1.3: Commit**

```bash
git add src/lib/ai/hooks.ts
git commit -m "feat: add hook strategy constants and selection logic"
```

---

### Task 2: Tests for hook selection

**Files:**
- Create: `tests/lib/ai/hooks.test.ts`

- [ ] **Step 2.1: Create `tests/lib/ai/hooks.test.ts`**

```typescript
// tests/lib/ai/hooks.test.ts
import { describe, it, expect } from "vitest";
import {
  selectHookStrategy,
  getHookInstruction,
  HOOK_STRATEGY_KEYS,
  HOOK_STRATEGIES,
  hookStrategySchema,
} from "@/lib/ai/hooks";

describe("selectHookStrategy", () => {
  it("should return a valid hook strategy", () => {
    const result = selectHookStrategy([]);
    expect(HOOK_STRATEGY_KEYS).toContain(result);
  });

  it("should avoid the last 3 hooks in recentHooks", () => {
    const recent = ["question", "bold_statement", "direct_address"];
    const avoided = new Set(recent);
    // Run 50 times to reduce flakiness from randomness
    for (let i = 0; i < 50; i++) {
      const result = selectHookStrategy(recent);
      expect(avoided.has(result)).toBe(false);
    }
  });

  it("should pick from all 8 when fewer than 3 prior posts exist", () => {
    const result = selectHookStrategy([]);
    expect(HOOK_STRATEGY_KEYS).toContain(result);
  });

  it("should pick from all 8 when recentHooks has only 1 entry", () => {
    const recent = ["question"];
    // With lookback of 3, only "question" is avoided
    for (let i = 0; i < 50; i++) {
      const result = selectHookStrategy(recent);
      expect(result).not.toBe("question");
    }
  });

  it("should ignore corrupted/invalid hook_strategy values in history", () => {
    const recent = ["INVALID", "not_a_hook", "garbage"];
    // All invalid — should pick from full 8
    const result = selectHookStrategy(recent);
    expect(HOOK_STRATEGY_KEYS).toContain(result);
  });

  it("should only avoid the last 3 even when more history is provided", () => {
    // 5 entries — only last 3 should be avoided
    const recent = [
      "question",
      "bold_statement",
      "direct_address",
      "curiosity_gap",
      "seasonal",
    ];
    const avoided = new Set(recent.slice(-3)); // direct_address, curiosity_gap, seasonal
    for (let i = 0; i < 50; i++) {
      const result = selectHookStrategy(recent);
      expect(avoided.has(result)).toBe(false);
    }
  });

  it("batch of 6 posts should never have two consecutive identical hooks", () => {
    const used: string[] = [];
    for (let i = 0; i < 6; i++) {
      const hook = selectHookStrategy(used);
      if (used.length > 0) {
        expect(hook).not.toBe(used[used.length - 1]);
      }
      used.push(hook);
    }
  });
});

describe("getHookInstruction", () => {
  it("should return the correct instruction for each strategy", () => {
    for (const key of HOOK_STRATEGY_KEYS) {
      const instruction = getHookInstruction(key);
      expect(instruction).toBe(HOOK_STRATEGIES[key]);
      expect(instruction.length).toBeGreaterThan(0);
    }
  });
});

describe("hookStrategySchema", () => {
  it("should accept valid strategies", () => {
    for (const key of HOOK_STRATEGY_KEYS) {
      expect(hookStrategySchema.parse(key)).toBe(key);
    }
  });

  it("should reject invalid strategies", () => {
    expect(() => hookStrategySchema.parse("injected_value")).toThrow();
    expect(() => hookStrategySchema.parse("")).toThrow();
  });
});
```

- [ ] **Step 2.2: Run tests**

```bash
cd /Users/peterpitcher/Cursor/OJ-CheersAI2.0
npx vitest run tests/lib/ai/hooks.test.ts
```

Expected: all tests pass.

- [ ] **Step 2.3: Commit**

```bash
git add tests/lib/ai/hooks.test.ts
git commit -m "test: add hook strategy selection tests"
```

---

## Chunk 2: Content Pillar Module

### Task 3: Create content pillar constants and inference logic

**Files:**
- Create: `src/lib/ai/pillars.ts`

- [ ] **Step 3.1: Create `src/lib/ai/pillars.ts` with constants, regex patterns, inference, and nudge**

```typescript
// src/lib/ai/pillars.ts
import { z } from "zod";

export const CONTENT_PILLARS = {
  food_drink: {
    label: "Food & Drink",
    keywords: [
      "food", "menu", "dish", "burger", "roast", "kitchen", "chef",
      "drink", "pint", "cocktail", "wine", "beer", "lunch", "dinner", "breakfast",
    ],
  },
  events: {
    label: "Events & Entertainment",
    keywords: [
      "event", "quiz", "music", "live", "band", "karaoke", "sport",
      "match", "screening", "bingo", "comedy", "dj",
    ],
  },
  people: {
    label: "People & Community",
    keywords: [
      "staff", "team", "manager", "barman", "new starter",
      "anniversary", "charity", "community",
    ],
  },
  behind_scenes: {
    label: "Behind the Scenes",
    keywords: [
      "behind the scenes", "prep", "setup", "delivery",
      "morning", "before we open", "getting ready",
    ],
  },
  customer_love: {
    label: "Customer Love",
    keywords: [
      "review", "favourite", "popular", "most-requested",
      "regulars", "feedback", "thank you",
    ],
  },
  seasonal: {
    label: "Seasonal & Holidays",
    keywords: [
      "christmas", "easter", "bank holiday", "summer", "winter",
      "spring", "autumn", "halloween", "valentine",
      "mother's day", "father's day", "new year",
    ],
  },
} as const;

export type ContentPillar = keyof typeof CONTENT_PILLARS;

export const CONTENT_PILLAR_KEYS = Object.keys(CONTENT_PILLARS) as ContentPillar[];

/** Zod enum for application-layer validation before DB write. */
export const contentPillarSchema = z.enum([
  "food_drink",
  "events",
  "people",
  "behind_scenes",
  "customer_love",
  "seasonal",
]);

/**
 * Pre-compiled regex per pillar. Each pattern uses word-boundary anchors
 * to prevent partial matches (e.g. "sun" must not match "Sunday").
 * Multi-word phrases come before single words in the alternation so they
 * match first (regex alternation is left-to-right).
 */
const PILLAR_PATTERNS: Record<ContentPillar, RegExp> = (() => {
  const result = {} as Record<ContentPillar, RegExp>;
  for (const key of CONTENT_PILLAR_KEYS) {
    const kws = CONTENT_PILLARS[key].keywords;
    // Sort longest-first so multi-word phrases get priority in alternation
    const sorted = [...kws].sort((a, b) => b.length - a.length);
    const escaped = sorted.map((kw) =>
      kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
    result[key] = new RegExp(`\\b(?:${escaped.join("|")})\\b`, "gi");
  }
  return result;
})();

/** Tie-break order: events > seasonal > customer_love > behind_scenes > people > food_drink */
const TIE_BREAK_ORDER: ContentPillar[] = [
  "events",
  "seasonal",
  "customer_love",
  "behind_scenes",
  "people",
  "food_drink",
];

/**
 * Infer the content pillar from the post title and prompt.
 * Uses score-based matching — pillar with the most keyword hits wins.
 * Ties broken by TIE_BREAK_ORDER. Default: food_drink.
 */
export function inferContentPillar(title: string, prompt: string): ContentPillar {
  const text = `${title} ${prompt}`.toLowerCase();
  if (!text.trim()) return "food_drink";

  const scores: Record<ContentPillar, number> = {
    food_drink: 0,
    events: 0,
    people: 0,
    behind_scenes: 0,
    customer_love: 0,
    seasonal: 0,
  };

  for (const key of CONTENT_PILLAR_KEYS) {
    const pattern = PILLAR_PATTERNS[key];
    const matches = text.match(pattern);
    pattern.lastIndex = 0;
    scores[key] = matches?.length ?? 0;
  }

  let best: ContentPillar = "food_drink";
  let bestScore = 0;

  for (const key of TIE_BREAK_ORDER) {
    if (scores[key] > bestScore) {
      best = key;
      bestScore = scores[key];
    }
  }

  return best;
}

/**
 * Build a pillar nudge string if the inferred pillar matches the most recent 2
 * entries in recentPillars. Advisory only — the AI may still write to the
 * inferred pillar if the brief demands it.
 *
 * Returns null if no nudge is needed.
 */
export function buildPillarNudge(
  inferredPillar: ContentPillar,
  recentPillars: string[],
): string | null {
  const validRecent = recentPillars.filter(
    (p): p is ContentPillar => p in CONTENT_PILLARS,
  );
  const lastTwo = validRecent.slice(-2);

  if (lastTwo.length < 2) return null;
  if (!lastTwo.every((p) => p === inferredPillar)) return null;

  // Suggest 2 alternative pillars
  const alternatives = CONTENT_PILLAR_KEYS.filter((k) => k !== inferredPillar).slice(0, 2);
  const altLabels = alternatives.map((k) => CONTENT_PILLARS[k].label);

  return `Recent posts have focused on ${CONTENT_PILLARS[inferredPillar].label}. If possible, try a different angle — e.g., frame this from the ${altLabels.join(" or ")} perspective.`;
}

/**
 * Get the human-readable label for a pillar.
 */
export function getPillarLabel(pillar: ContentPillar): string {
  return CONTENT_PILLARS[pillar].label;
}
```

- [ ] **Step 3.2: Verify file compiles**

```bash
cd /Users/peterpitcher/Cursor/OJ-CheersAI2.0
npx tsc --noEmit --pretty 2>&1 | head -30
```

Expected: no errors related to `pillars.ts`.

- [ ] **Step 3.3: Commit**

```bash
git add src/lib/ai/pillars.ts
git commit -m "feat: add content pillar constants and inference logic"
```

---

### Task 4: Tests for pillar inference

**Files:**
- Create: `tests/lib/ai/pillars.test.ts`

- [ ] **Step 4.1: Create `tests/lib/ai/pillars.test.ts`**

```typescript
// tests/lib/ai/pillars.test.ts
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

  it("should infer seasonal from 'Christmas menu'", () => {
    expect(inferContentPillar("Christmas menu", "Our festive menu is here")).toBe("seasonal");
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

  it("should use score-based matching — 'Chef's birthday' with more food keywords tips to food_drink", () => {
    // "chef" appears in food_drink keywords
    // title alone: food_drink gets 1, people gets 0
    const result = inferContentPillar("Chef's birthday lunch menu", "");
    // "chef" + "lunch" + "menu" = 3 food hits, 0 people hits
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
```

- [ ] **Step 4.2: Run tests**

```bash
cd /Users/peterpitcher/Cursor/OJ-CheersAI2.0
npx vitest run tests/lib/ai/pillars.test.ts
```

Expected: all tests pass.

- [ ] **Step 4.3: Commit**

```bash
git add tests/lib/ai/pillars.test.ts
git commit -m "test: add content pillar inference tests"
```

---

## Chunk 3: Prompt Enhancements

### Task 5: Hook instruction integration into prompts.ts (describeAdjustments)

**Files:**
- Modify: `src/lib/ai/prompts.ts`

- [ ] **Step 5.1: Add `hookInstruction` to the `PromptContext` interface and thread it through**

In `src/lib/ai/prompts.ts`, update the `PromptContext` interface to accept an optional `hookInstruction`:

```typescript
// In PromptContext interface, add after venueName:
  hookInstruction?: string;
```

The full interface becomes:

```typescript
interface PromptContext {
  brand: BrandProfile;
  input: InstantPostInput;
  platform: "facebook" | "instagram" | "gbp";
  scheduledFor?: Date | null;
  context?: Record<string, unknown>;
  venueName?: string;
  hookInstruction?: string;
}
```

- [ ] **Step 5.2: Destructure `hookInstruction` in `buildInstantPostPrompt` and pass to `describeAdjustments`**

Update the function signature destructuring:

```typescript
export function buildInstantPostPrompt({ brand, input, platform, scheduledFor, context, venueName, hookInstruction }: PromptContext): PromptMessages {
```

Update the `describeAdjustments` call in the `sections` array:

```typescript
    `Adjustments:\n${describeAdjustments(platform, input, hookInstruction)}`,
```

- [ ] **Step 5.3: Add `hookInstruction` parameter to `describeAdjustments` and append it**

Update the `describeAdjustments` function signature:

```typescript
function describeAdjustments(
  platform: "facebook" | "instagram" | "gbp",
  input: InstantPostInput,
  hookInstruction?: string,
) {
```

Add the hook line at the end, just before the `if (!lines.length)` guard:

```typescript
  // Hook variety instruction (appended after existing adjustments)
  if (hookInstruction) {
    lines.push(`Opening hook style: ${hookInstruction}`);
  }
```

The full insertion point is right before:

```typescript
  if (!lines.length) {
    lines.push("Follow the brand defaults for tone, pacing, and CTA style.");
  }
```

- [ ] **Step 5.4: Verify file compiles**

```bash
cd /Users/peterpitcher/Cursor/OJ-CheersAI2.0
npx tsc --noEmit --pretty 2>&1 | head -30
```

- [ ] **Step 5.5: Commit**

```bash
git add src/lib/ai/prompts.ts
git commit -m "feat: add hook instruction to prompt adjustments section"
```

---

### Task 6: Pillar nudge integration into prompts.ts (new section in user prompt)

**Files:**
- Modify: `src/lib/ai/prompts.ts`

- [ ] **Step 6.1: Add `pillarNudge` to `PromptContext` interface**

```typescript
interface PromptContext {
  brand: BrandProfile;
  input: InstantPostInput;
  platform: "facebook" | "instagram" | "gbp";
  scheduledFor?: Date | null;
  context?: Record<string, unknown>;
  venueName?: string;
  hookInstruction?: string;
  pillarNudge?: string | null;
}
```

- [ ] **Step 6.2: Destructure and add pillar nudge section to user prompt**

Update `buildInstantPostPrompt` destructuring:

```typescript
export function buildInstantPostPrompt({ brand, input, platform, scheduledFor, context, venueName, hookInstruction, pillarNudge }: PromptContext): PromptMessages {
```

Add the pillar nudge as a new section in the `sections` array, after the `Adjustments` section and before the `Examples` section:

```typescript
    pillarNudge ? `Content angle advisory:\n${pillarNudge}` : null,
```

The sections array should now include (in order):

```typescript
  const sections: string[] = [
    input.title?.trim() ? `Title (for context only — do not copy verbatim or use as sentence subject): ${input.title.trim()}` : null,
    input.prompt?.trim() ? `Request: ${input.prompt.trim()}` : null,
    brandLines.length ? `Brand voice:\n${brandLines.join("\n")}` : null,
    buildMediaLine(input),
    buildContextBlock({ scheduledFor, context }),
    `Platform guidance:\n${buildPlatformGuidance(platform, brand, input)}`,
    `Adjustments:\n${describeAdjustments(platform, input, hookInstruction)}`,
    pillarNudge ? `Content angle advisory:\n${pillarNudge}` : null,
    `Examples of good style (British English, warm, no hashtags in body):\n${getFewShotExamples()}`,
  ].filter(isNonEmptyString);
```

- [ ] **Step 6.3: Verify file compiles**

```bash
cd /Users/peterpitcher/Cursor/OJ-CheersAI2.0
npx tsc --noEmit --pretty 2>&1 | head -30
```

- [ ] **Step 6.4: Commit**

```bash
git add src/lib/ai/prompts.ts
git commit -m "feat: add content pillar nudge section to user prompt"
```

---

### Task 7: Platform personality sharpening — Facebook, Instagram, GBP guidance additions

**Files:**
- Modify: `src/lib/ai/prompts.ts`

- [ ] **Step 7.1: Update `buildPlatformGuidance` — Facebook case**

In the `case "facebook":` block, add two new lines to the array before the `formatOptionalLine(...)` for the signature:

```typescript
    case "facebook":
      return [
        "Keep it concise, but feel free to write up to 120 words if the story needs it.",
        input.includeHashtags
          ? "Include a CTA and 2-3 relevant hashtags if it feels natural."
          : "Include a CTA and keep copy hashtag-free.",
        "Where natural, close with a question or opinion prompt that invites comments (e.g., 'What's your order?', 'Who's joining us?'). Facebook rewards posts that generate replies.",
        "Write as if talking to a regular — conversational, not announcement-style.",
        formatOptionalLine("Append this exact signature verbatim at the end if it fits naturally (do not rephrase it)", brand.facebookSignature),
      ]
        .filter(Boolean)
        .join("\n");
```

- [ ] **Step 7.2: Update `buildPlatformGuidance` — Instagram case**

In the `case "instagram":` block, replace `"Write up to 80 words with line breaks."` with the softened version, and add the two new lines:

```typescript
    case "instagram":
      const hasLink = Boolean(input.linkInBioUrl || input.ctaUrl);
      return [
        "Aim for 60-80 words with line breaks.",
        "The first line must stop the scroll. Front-load the hook — only the first 125 characters show before 'more'.",
        "Use line breaks to create scannable structure. One thought per line.",
        "Do not include URLs.",
        hasLink
          ? "Finish with a natural link-in-bio line (e.g. 'Link in bio to book', 'Check the link in our bio', 'Details in bio')."
          : "Do not mention link in bio unless a link is provided.",
        input.includeHashtags
          ? formatHashtagGuidance(brand)
          : "Do not add hashtags; rely on copy only.",
        formatOptionalLine("Append this exact signature verbatim at the end if it fits naturally (do not rephrase it)", brand.instagramSignature),
      ]
        .filter(Boolean)
        .join("\n");
```

- [ ] **Step 7.3: Update `buildPlatformGuidance` — GBP case (with venue XML delimiters)**

Update the `PromptContext` interface to also accept `venueLocation`:

```typescript
interface PromptContext {
  brand: BrandProfile;
  input: InstantPostInput;
  platform: "facebook" | "instagram" | "gbp";
  scheduledFor?: Date | null;
  context?: Record<string, unknown>;
  venueName?: string;
  venueLocation?: string;
  hookInstruction?: string;
  pillarNudge?: string | null;
}
```

Update `buildInstantPostPrompt` destructuring:

```typescript
export function buildInstantPostPrompt({ brand, input, platform, scheduledFor, context, venueName, venueLocation, hookInstruction, pillarNudge }: PromptContext): PromptMessages {
```

Update `buildPlatformGuidance` to accept `venueName` and `venueLocation`:

```typescript
function buildPlatformGuidance(
  platform: "facebook" | "instagram" | "gbp",
  brand: BrandProfile,
  input: InstantPostInput,
  venueName?: string,
  venueLocation?: string,
) {
```

Update the call site in `buildInstantPostPrompt`:

```typescript
    `Platform guidance:\n${buildPlatformGuidance(platform, brand, input, venueName, venueLocation)}`,
```

In the `case "gbp":` block, add the new lines and venue context:

```typescript
    case "gbp": {
      const gbpLines = [
        "Write a concise Google Business Profile update. Keep it under 150 words (hard limit: 900 characters).",
        'Write in first-person plural — "we", "our", "us" — exactly as you would for Facebook or Instagram. GBP copy must also follow the first-person rule.',
        "Write for someone searching Google for a local pub. Include natural local keywords (e.g., the town name, 'pub near [area]').",
        "Lead with the most important fact — what, when, and how to act. No preamble.",
        `Include CTA action: ${brand.gbpCta ?? "LEARN_MORE"}.`,
        "Avoid hashtags. Avoid exclamation-heavy hype language. Write as if speaking directly to a local who already knows the pub.",
      ];
      if (venueName) {
        gbpLines.push(`Venue name: <venue_name>${venueName}</venue_name>`);
      }
      if (venueLocation) {
        gbpLines.push(`Venue location: <venue_location>${venueLocation}</venue_location>`);
      }
      return gbpLines.join("\n");
    }
```

**Note:** The XML-style delimiters (`<venue_name>`, `<venue_location>`) create clear boundaries for prompt injection defence. The values are already validated by Zod regex at the settings layer (Plan B migration), so they contain only safe characters.

- [ ] **Step 7.4: Verify file compiles**

```bash
cd /Users/peterpitcher/Cursor/OJ-CheersAI2.0
npx tsc --noEmit --pretty 2>&1 | head -30
```

- [ ] **Step 7.5: Commit**

```bash
git add src/lib/ai/prompts.ts
git commit -m "feat: sharpen platform personality guidance and add venue XML delimiters for GBP"
```

---

### Task 8: Extend describeEventTimingCue() with toneCue and label returns

**Files:**
- Modify: `src/lib/create/service.ts`

- [ ] **Step 8.1: Update `describeEventTimingCue` return type and add toneCue/label to each bracket**

Change the function signature and body. The existing `description` return values become the `description` field. New `toneCue` and `label` fields are added.

Replace the existing `describeEventTimingCue` function (lines 290-327) with:

```typescript
interface EventTimingCue {
  description: string;
  toneCue: string;
  label: string;
}

function describeEventTimingCue(
  scheduledFor: Date | null,
  eventStart: Date,
): EventTimingCue {
  if (!scheduledFor) {
    return {
      description:
        "Share live highlights and keep guests engaged in real time.",
      toneCue:
        "This is happening now or very soon. Be direct and punchy. Tone: urgent, 'get here'.",
      label: "today_imminent",
    };
  }

  const diffMs = eventStart.getTime() - scheduledFor.getTime();
  const diffHours = Math.round(diffMs / HOUR_MS);
  const diffDays = Math.floor(diffMs / DAY_MS);
  const weekday = formatWeekday(eventStart);
  const dayMonth = formatDayMonth(eventStart);
  const timeLabel = formatTime(eventStart);

  // Post-event recap
  if (diffMs < 0) {
    return {
      description:
        "Celebrate what happened, thank attendees, and share highlights.",
      toneCue:
        "This already happened. Celebrate it, thank people, share highlights. Tone: warm, grateful.",
      label: "recap",
    };
  }

  // Same day, afternoon+ (2pm onwards) — imminent
  if (diffDays === 0 && diffHours <= 3) {
    const scheduledHour = DateTime.fromJSDate(scheduledFor, {
      zone: DEFAULT_TIMEZONE,
    }).hour;
    if (scheduledHour >= 14) {
      return {
        description: `Say it's happening in just a few hours (tonight at ${timeLabel}) and drive final RSVPs.`,
        toneCue:
          "This is happening now or very soon. Be direct and punchy. Tone: urgent, 'get here'.",
        label: "today_imminent",
      };
    }
    return {
      description: `Say it's happening in just a few hours (tonight at ${timeLabel}) and drive final RSVPs.`,
      toneCue:
        "This is today. Set the scene for later. Tone: anticipation, 'it's happening'.",
      label: "today_morning",
    };
  }

  // Same day, morning post (before 2pm)
  if (diffDays === 0) {
    const scheduledHour = DateTime.fromJSDate(scheduledFor, {
      zone: DEFAULT_TIMEZONE,
    }).hour;
    if (scheduledHour < 14) {
      return {
        description: `Call out that it's happening today at ${timeLabel}—push final sign-ups and arrivals.`,
        toneCue:
          "This is today. Set the scene for later. Tone: anticipation, 'it's happening'.",
        label: "today_morning",
      };
    }
    return {
      description: `Call out that it's happening today at ${timeLabel}—push final sign-ups and arrivals.`,
      toneCue:
        "This is happening now or very soon. Be direct and punchy. Tone: urgent, 'get here'.",
      label: "today_imminent",
    };
  }

  // 1-2 days before
  if (diffDays <= 2) {
    return {
      description: `Say it's tomorrow (${weekday} ${dayMonth}) and stress limited spots before ${timeLabel}.`,
      toneCue:
        "This is happening very soon. Create gentle urgency. Tone: excited, 'don't forget'.",
      label: "tomorrow",
    };
  }

  // 3-6 days before
  if (diffDays <= 6) {
    return {
      description: `Refer to it as this ${weekday} (${dayMonth}) and keep the countdown energy high.`,
      toneCue:
        "Build anticipation. Give details that help people plan. Tone: enthusiastic, inviting.",
      label: "building",
    };
  }

  // 7+ days before
  return {
    description: `Highlight the date ${weekday} ${dayMonth} at ${timeLabel} and build anticipation while pushing sign-ups.`,
    toneCue:
      "This is an early heads-up. Focus on saving the date, not urgency. Tone: informative, warm.",
    label: "early_awareness",
  };
}
```

- [ ] **Step 8.2: Update all call sites of `describeEventTimingCue` to use `.description`**

Search for all usages of `describeEventTimingCue` in `service.ts`. The function is used to produce a string that goes into `promptContext`. Each call site currently expects a string return. Update them to use `.description`:

Find all usages with:
```bash
cd /Users/peterpitcher/Cursor/OJ-CheersAI2.0
grep -n "describeEventTimingCue" src/lib/create/service.ts
```

For each call site that previously assigned the return value as a string, change it to destructure or access `.description`. For example, if the pattern is:

```typescript
const timingCue = describeEventTimingCue(scheduledFor, eventStartDate);
```

Change to:

```typescript
const timingResult = describeEventTimingCue(scheduledFor, eventStartDate);
const timingCue = timingResult.description;
```

And store the full result so that `toneCue` and `label` can be threaded into the prompt context:

```typescript
// Add to promptContext where timingCue is used:
temporalProximity: timingResult.toneCue,
temporalLabel: timingResult.label,
```

- [ ] **Step 8.3: Verify file compiles**

```bash
cd /Users/peterpitcher/Cursor/OJ-CheersAI2.0
npx tsc --noEmit --pretty 2>&1 | head -30
```

- [ ] **Step 8.4: Commit**

```bash
git add src/lib/create/service.ts
git commit -m "feat: extend describeEventTimingCue with toneCue and label returns"
```

---

### Task 9: Temporal proximity integration into buildContextBlock()

**Files:**
- Modify: `src/lib/ai/prompts.ts`

- [ ] **Step 9.1: Read `temporalProximity` from the context object in `buildContextBlock`**

In the `buildContextBlock` function, after the existing `eventStart` section, add:

```typescript
  const temporalProximity = extractContextString(context, "temporalProximity");
  if (temporalProximity) {
    lines.push(`Timing tone: ${temporalProximity}`);
  }
```

This goes right after:

```typescript
  const eventStart = parseIsoDate(context?.eventStart);
  if (eventStart) {
    lines.push(`Event starts ${formatDateTime(eventStart)}.`);
  }
```

So the resulting section in the prompt will read:

```
Post scheduled for Thursday 15 April at 5pm (local time).
Event starts Thursday 15 April at 7pm.
Timing tone: This is happening very soon. Be direct and punchy. Tone: urgent, 'get here'.
```

- [ ] **Step 9.2: Verify file compiles**

```bash
cd /Users/peterpitcher/Cursor/OJ-CheersAI2.0
npx tsc --noEmit --pretty 2>&1 | head -30
```

- [ ] **Step 9.3: Commit**

```bash
git add src/lib/ai/prompts.ts
git commit -m "feat: add temporal proximity tone cue to prompt context block"
```

---

## Chunk 4: Service Layer Integration

### Task 10: Hoisted history fetch — combined query for hooks + pillars

**Files:**
- Modify: `src/lib/create/service.ts`

- [ ] **Step 10.1: Add a `fetchRecentCopyHistory` helper function to `service.ts`**

Add this function near the top of `service.ts` (after the imports/constants, before `createInstantPost`):

```typescript
/**
 * Fetch the last 5 hook_strategy and content_pillar values for this account.
 * Runs ONCE per campaign creation, not per plan.
 * Returns arrays seeded for in-memory batch tracking.
 */
async function fetchRecentCopyHistory(
  supabase: SupabaseClient,
  accountId: string,
): Promise<{ recentHooks: string[]; recentPillars: string[] }> {
  const { data, error } = await supabase
    .from("content_items")
    .select("hook_strategy, content_pillar")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    // Non-fatal — fall back to empty history if columns don't exist yet
    console.warn("[create] fetchRecentCopyHistory failed, using empty history:", error.message);
    return { recentHooks: [], recentPillars: [] };
  }

  const recentHooks: string[] = [];
  const recentPillars: string[] = [];

  for (const row of data ?? []) {
    if (typeof row.hook_strategy === "string" && row.hook_strategy) {
      recentHooks.push(row.hook_strategy);
    }
    if (typeof row.content_pillar === "string" && row.content_pillar) {
      recentPillars.push(row.content_pillar);
    }
  }

  return { recentHooks, recentPillars };
}
```

- [ ] **Step 10.2: Verify file compiles**

```bash
cd /Users/peterpitcher/Cursor/OJ-CheersAI2.0
npx tsc --noEmit --pretty 2>&1 | head -30
```

- [ ] **Step 10.3: Commit**

```bash
git add src/lib/create/service.ts
git commit -m "feat: add hoisted copy history fetch for hooks and pillars"
```

---

### Task 11: In-memory batch tracker for hooks and pillars (threaded through buildVariants)

**Files:**
- Modify: `src/lib/create/service.ts`

- [ ] **Step 11.1: Add imports for hooks and pillars modules at the top of service.ts**

```typescript
import { selectHookStrategy, getHookInstruction } from "@/lib/ai/hooks";
import type { HookStrategy } from "@/lib/ai/hooks";
import { inferContentPillar, buildPillarNudge } from "@/lib/ai/pillars";
import type { ContentPillar } from "@/lib/ai/pillars";
```

- [ ] **Step 11.2: Define a `CopyEngagement` interface and add it to `buildVariants` params**

```typescript
/** In-memory batch state for hook + pillar variety tracking. */
interface CopyEngagement {
  recentHooks: string[];
  recentPillars: string[];
}
```

Update the `buildVariants` function signature to accept engagement state:

```typescript
async function buildVariants({
  brand,
  venueName,
  venueLocation,
  plans,
  engagement,
}: {
  brand: Awaited<ReturnType<typeof getOwnerSettings>>["brand"];
  venueName?: string;
  venueLocation?: string;
  plans: VariantPlan[];
  engagement?: CopyEngagement;
}): Promise<BuiltVariant[]> {
```

- [ ] **Step 11.3: Inside `buildVariants`, select hook and infer pillar per plan (feed only)**

Inside the `for (const plan of plans)` loop, after `const placement = plan.placement ?? "feed";` and before the `if (placement === "story")` check, add the engagement selection:

```typescript
    // --- Hook + pillar selection (feed posts only) ---
    let hookStrategy: HookStrategy | undefined;
    let hookInstruction: string | undefined;
    let contentPillar: ContentPillar | undefined;
    let pillarNudge: string | null = null;

    if (placement === "feed" && engagement) {
      hookStrategy = selectHookStrategy(engagement.recentHooks);
      hookInstruction = getHookInstruction(hookStrategy);
      engagement.recentHooks.push(hookStrategy);

      contentPillar = inferContentPillar(plan.title, plan.prompt);
      pillarNudge = buildPillarNudge(contentPillar, engagement.recentPillars);
      engagement.recentPillars.push(contentPillar);
    }
```

- [ ] **Step 11.4: Pass `hookInstruction`, `pillarNudge`, and `venueLocation` through to `generateVariants`**

Update the `generateVariants` call inside `buildVariants`:

```typescript
    const generated = await generateVariants({
      brand,
      venueName,
      venueLocation,
      input: instantInput,
      scheduledFor: plan.scheduledFor ?? null,
      context: plan.promptContext ?? undefined,
      hookInstruction,
      pillarNudge,
    });
```

- [ ] **Step 11.5: Store `hookStrategy` and `contentPillar` on each BuiltVariant**

Add two optional fields to the `BuiltVariant` interface:

```typescript
interface BuiltVariant {
  platform: Platform;
  body: string;
  scheduledFor: Date | null;
  promptContext: Record<string, unknown>;
  mediaIds: string[];
  options: InstantPostAdvancedOptions;
  linkInBioUrl?: string | null;
  placement: "feed" | "story";
  hookStrategy?: string;
  contentPillar?: string;
  validation?: {
    lintPass: boolean;
    issues: Array<{ code: string; message: string }>;
    repairsApplied: string[];
    metrics: Record<string, unknown>;
    timestamp: string;
  };
}
```

When pushing variants from the feed branch of `buildVariants`, include the values:

```typescript
    for (const variant of generated) {
      variants.push({
        platform: variant.platform,
        body: variant.body,
        scheduledFor: plan.scheduledFor,
        promptContext: {
          ...(plan.promptContext ?? {}),
          advanced: options,
          ctaUrl: planCta ?? null,
          linkInBioUrl: plan.linkInBioUrl ?? null,
        },
        options,
        mediaIds: plan.media?.map((asset) => asset.assetId) ?? [],
        linkInBioUrl: plan.linkInBioUrl ?? null,
        placement,
        hookStrategy,
        contentPillar,
        validation: variant.validation,
      });
    }
```

- [ ] **Step 11.6: Update `generateVariants` to accept and forward hook/pillar/venue params**

Update the function signature:

```typescript
async function generateVariants({
  brand,
  venueName,
  venueLocation,
  input,
  scheduledFor,
  context,
  hookInstruction,
  pillarNudge,
}: {
  brand: Awaited<ReturnType<typeof getOwnerSettings>>["brand"];
  venueName?: string;
  venueLocation?: string;
  input: InstantPostInput;
  scheduledFor?: Date | null;
  context?: Record<string, unknown>;
  hookInstruction?: string;
  pillarNudge?: string | null;
}): Promise<GeneratedVariantResult[]> {
```

Update the `buildInstantPostPrompt` call inside `generateVariants`:

```typescript
      const prompt = buildInstantPostPrompt({
        brand,
        venueName,
        venueLocation,
        input,
        platform,
        scheduledFor,
        context,
        hookInstruction,
        pillarNudge,
      });
```

- [ ] **Step 11.7: Verify file compiles**

```bash
cd /Users/peterpitcher/Cursor/OJ-CheersAI2.0
npx tsc --noEmit --pretty 2>&1 | head -30
```

- [ ] **Step 11.8: Commit**

```bash
git add src/lib/create/service.ts
git commit -m "feat: thread hook and pillar batch tracking through buildVariants and generateVariants"
```

---

### Task 12: Call fetchRecentCopyHistory in createCampaignFromPlans and pass engagement to buildVariants

**Files:**
- Modify: `src/lib/create/service.ts`

- [ ] **Step 12.1: Update `createCampaignFromPlans` to fetch history and pass engagement**

In `createCampaignFromPlans`, right before the `buildVariants` call (currently line ~944), add the history fetch:

```typescript
  // Hoisted copy history — runs ONCE per campaign, not per plan
  const engagement = await fetchRecentCopyHistory(supabase, accountId);
```

Update the `buildVariants` call to include the engagement state and venueLocation:

```typescript
  const variants = await buildVariants({
    brand,
    venueName,
    venueLocation,
    plans,
    engagement,
  });
```

The `createCampaignFromPlans` function signature needs `venueLocation` added. Update the params type:

```typescript
async function createCampaignFromPlans({
  supabase,
  accountId,
  brand,
  venueName,
  venueLocation,
  name,
  type,
  metadata,
  plans,
  options,
  linkInBioUrl,
}: {
  supabase: SupabaseClient;
  accountId: string;
  brand: Awaited<ReturnType<typeof getOwnerSettings>>["brand"];
  venueName?: string;
  venueLocation?: string;
  name: string;
  type: string;
  metadata: Record<string, unknown>;
  plans: VariantPlan[];
  options?: {
    autoSchedule?: boolean;
  };
  linkInBioUrl?: string | null;
}) {
```

- [ ] **Step 12.2: Thread `venueLocation` through the callers of `createCampaignFromPlans`**

In `createInstantPost`, `createWeeklyCampaign`, `createStorySeries`, and any other campaign creation functions, the `getOwnerSettings()` call already returns posting defaults. Add `venueLocation` to the destructure if the posting defaults include it (from Plan B's schema changes), or pass `undefined` for now:

```typescript
// In createInstantPost and createWeeklyCampaign, after getOwnerSettings:
const { brand, venueName, posting } = await getOwnerSettings();
const venueLocation = (posting as Record<string, unknown>)?.venueLocation as string | undefined;
```

Then pass it to `createCampaignFromPlans`:

```typescript
  return createCampaignFromPlans({
    supabase,
    accountId,
    brand,
    venueName,
    venueLocation,
    // ... rest of params
  });
```

**Note:** If `PostingDefaults` doesn't yet have `venueLocation` (Plan B migration hasn't run), the value will be `undefined` and GBP prompts simply won't include the venue location line. This is safe — the feature degrades gracefully.

- [ ] **Step 12.3: Verify file compiles**

```bash
cd /Users/peterpitcher/Cursor/OJ-CheersAI2.0
npx tsc --noEmit --pretty 2>&1 | head -30
```

- [ ] **Step 12.4: Commit**

```bash
git add src/lib/create/service.ts
git commit -m "feat: hoist copy history fetch to campaign level and thread venueLocation"
```

---

### Task 13: Wire hook_strategy and content_pillar into content_items INSERT

**Files:**
- Modify: `src/lib/create/service.ts`

- [ ] **Step 13.1: Add `hook_strategy` and `content_pillar` to the content_items insert rows**

In `createCampaignFromPlans`, find the `contentRows` mapping (currently around line 965):

```typescript
  const contentRows = variants.map((variant) => ({
    campaign_id: campaignRow.id,
    account_id: accountId,
    platform: variant.platform,
    placement: variant.placement,
    scheduled_for: variant.scheduledFor ? variant.scheduledFor.toISOString() : nowIso,
    status: shouldAutoSchedule
      ? variant.scheduledFor
        ? "scheduled"
        : "queued"
      : "draft",
    prompt_context: variant.promptContext,
    auto_generated: true,
  }));
```

Add `hook_strategy` and `content_pillar`:

```typescript
  const contentRows = variants.map((variant) => ({
    campaign_id: campaignRow.id,
    account_id: accountId,
    platform: variant.platform,
    placement: variant.placement,
    scheduled_for: variant.scheduledFor ? variant.scheduledFor.toISOString() : nowIso,
    status: shouldAutoSchedule
      ? variant.scheduledFor
        ? "scheduled"
        : "queued"
      : "draft",
    prompt_context: {
      ...variant.promptContext,
      temporalProximity: variant.promptContext?.temporalProximity ?? null,
    },
    auto_generated: true,
    hook_strategy: variant.hookStrategy ?? null,
    content_pillar: variant.contentPillar ?? null,
  }));
```

**Note:** Both columns are nullable with CHECK constraints from Plan B's migration. `null` values are safe — they indicate the feature wasn't active for that row (e.g. story placements, or pre-migration rows).

- [ ] **Step 13.2: Verify file compiles**

```bash
cd /Users/peterpitcher/Cursor/OJ-CheersAI2.0
npx tsc --noEmit --pretty 2>&1 | head -30
```

- [ ] **Step 13.3: Commit**

```bash
git add src/lib/create/service.ts
git commit -m "feat: write hook_strategy and content_pillar to content_items on insert"
```

---

## Chunk 5: Tests for Prompt and Integration Logic

### Task 14: Tests for prompt engagement additions

**Files:**
- Create: `tests/lib/ai/prompts-engagement.test.ts`

- [ ] **Step 14.1: Create `tests/lib/ai/prompts-engagement.test.ts`**

```typescript
// tests/lib/ai/prompts-engagement.test.ts
import { describe, it, expect } from "vitest";
import { buildInstantPostPrompt } from "@/lib/ai/prompts";
import type { BrandProfile } from "@/lib/settings/data";
import type { InstantPostInput } from "@/lib/create/schema";

function makeBrand(overrides?: Partial<BrandProfile>): BrandProfile {
  return {
    toneFormal: 0.5,
    tonePlayful: 0.5,
    keyPhrases: [],
    bannedPhrases: [],
    bannedTopics: [],
    defaultHashtags: [],
    defaultEmojis: [],
    facebookSignature: null,
    instagramSignature: null,
    gbpCta: "LEARN_MORE",
    ...overrides,
  } as BrandProfile;
}

function makeInput(overrides?: Partial<InstantPostInput>): InstantPostInput {
  return {
    title: "Sunday Roast",
    prompt: "Write about our roast dinner",
    publishMode: "now",
    platforms: ["facebook"],
    includeHashtags: true,
    includeEmojis: true,
    toneAdjust: "default",
    lengthPreference: "standard",
    ctaStyle: "default",
    proofPointMode: "off",
    proofPointsSelected: [],
    proofPointIntentTags: [],
    ...overrides,
  } as InstantPostInput;
}

describe("buildInstantPostPrompt — hook instruction", () => {
  it("should include hook instruction in adjustments when provided", () => {
    const result = buildInstantPostPrompt({
      brand: makeBrand(),
      input: makeInput(),
      platform: "facebook",
      hookInstruction: "Open with a question that invites a response from the reader.",
    });
    expect(result.user).toContain("Opening hook style:");
    expect(result.user).toContain("Open with a question");
  });

  it("should NOT include hook instruction line when not provided", () => {
    const result = buildInstantPostPrompt({
      brand: makeBrand(),
      input: makeInput(),
      platform: "facebook",
    });
    expect(result.user).not.toContain("Opening hook style:");
  });
});

describe("buildInstantPostPrompt — pillar nudge", () => {
  it("should include pillar nudge section when provided", () => {
    const result = buildInstantPostPrompt({
      brand: makeBrand(),
      input: makeInput(),
      platform: "facebook",
      pillarNudge: "Recent posts have focused on Food & Drink. Try a different angle.",
    });
    expect(result.user).toContain("Content angle advisory:");
    expect(result.user).toContain("Recent posts have focused on Food & Drink");
  });

  it("should NOT include pillar nudge when null", () => {
    const result = buildInstantPostPrompt({
      brand: makeBrand(),
      input: makeInput(),
      platform: "facebook",
      pillarNudge: null,
    });
    expect(result.user).not.toContain("Content angle advisory:");
  });
});

describe("buildInstantPostPrompt — platform guidance sharpening", () => {
  it("facebook should include comment-inviting guidance", () => {
    const result = buildInstantPostPrompt({
      brand: makeBrand(),
      input: makeInput({ platforms: ["facebook"] }),
      platform: "facebook",
    });
    expect(result.user).toContain("invites comments");
    expect(result.user).toContain("talking to a regular");
  });

  it("instagram should include scroll-stopping and line break guidance", () => {
    const result = buildInstantPostPrompt({
      brand: makeBrand(),
      input: makeInput({ platforms: ["instagram"] }),
      platform: "instagram",
    });
    expect(result.user).toContain("stop the scroll");
    expect(result.user).toContain("scannable structure");
    expect(result.user).toContain("60-80 words");
  });

  it("gbp should include local search guidance", () => {
    const result = buildInstantPostPrompt({
      brand: makeBrand(),
      input: makeInput({ platforms: ["gbp"] }),
      platform: "gbp",
    });
    expect(result.user).toContain("searching Google for a local pub");
    expect(result.user).toContain("most important fact");
  });

  it("gbp should include venue name and location in XML delimiters", () => {
    const result = buildInstantPostPrompt({
      brand: makeBrand(),
      input: makeInput({ platforms: ["gbp"] }),
      platform: "gbp",
      venueName: "The Anchor",
      venueLocation: "Leatherhead, Surrey",
    });
    expect(result.user).toContain("<venue_name>The Anchor</venue_name>");
    expect(result.user).toContain("<venue_location>Leatherhead, Surrey</venue_location>");
  });

  it("gbp should NOT include venue location when not provided", () => {
    const result = buildInstantPostPrompt({
      brand: makeBrand(),
      input: makeInput({ platforms: ["gbp"] }),
      platform: "gbp",
      venueName: "The Anchor",
    });
    expect(result.user).toContain("<venue_name>The Anchor</venue_name>");
    expect(result.user).not.toContain("<venue_location>");
  });
});

describe("buildInstantPostPrompt — temporal proximity", () => {
  it("should include timing tone from context.temporalProximity", () => {
    const result = buildInstantPostPrompt({
      brand: makeBrand(),
      input: makeInput(),
      platform: "facebook",
      scheduledFor: new Date("2026-04-15T17:00:00Z"),
      context: {
        eventStart: "2026-04-15T19:00:00Z",
        temporalProximity:
          "This is happening very soon. Be direct and punchy. Tone: urgent, 'get here'.",
      },
    });
    expect(result.user).toContain("Timing tone:");
    expect(result.user).toContain("Be direct and punchy");
  });

  it("should NOT include timing tone when temporalProximity not in context", () => {
    const result = buildInstantPostPrompt({
      brand: makeBrand(),
      input: makeInput(),
      platform: "facebook",
      scheduledFor: new Date("2026-04-15T17:00:00Z"),
      context: {
        eventStart: "2026-04-15T19:00:00Z",
      },
    });
    expect(result.user).not.toContain("Timing tone:");
  });
});
```

- [ ] **Step 14.2: Run tests**

```bash
cd /Users/peterpitcher/Cursor/OJ-CheersAI2.0
npx vitest run tests/lib/ai/prompts-engagement.test.ts
```

Expected: all tests pass.

- [ ] **Step 14.3: Commit**

```bash
git add tests/lib/ai/prompts-engagement.test.ts
git commit -m "test: add prompt engagement integration tests (hook, pillar, platform, temporal)"
```

---

### Task 15: Tests for describeEventTimingCue extended return type

**Files:**
- Create: `tests/lib/create/service-engagement.test.ts`

- [ ] **Step 15.1: Create `tests/lib/create/service-engagement.test.ts`**

Since `describeEventTimingCue` is not exported (it's a private function in service.ts), we have two options:
1. Export it for testing (preferred — add `export` keyword)
2. Test indirectly through the prompt context

Choose option 1: add `export` to `describeEventTimingCue` in `service.ts`.

```typescript
// tests/lib/create/service-engagement.test.ts
import { describe, it, expect } from "vitest";

// describeEventTimingCue needs to be exported from service.ts for direct testing.
// If not exported, these tests should be adapted to test indirectly.
// For now, we import it directly (requires adding 'export' to the function).

// We test the logic via a local reimplementation to avoid importing the full service
// module (which has heavy dependencies). Instead, validate via prompt output integration.

describe("describeEventTimingCue temporal brackets", () => {
  // These tests validate the expected bracket logic indirectly.
  // The function returns { description, toneCue, label }.

  it("should document expected bracket boundaries", () => {
    // This is a documentation test — the actual function tests are below
    // when the function is exported or tested through integration.
    const brackets = [
      { gap: "7+ days", label: "early_awareness" },
      { gap: "3-6 days", label: "building" },
      { gap: "1-2 days", label: "tomorrow" },
      { gap: "same day before 2pm", label: "today_morning" },
      { gap: "same day 2pm+", label: "today_imminent" },
      { gap: "after event", label: "recap" },
    ];
    expect(brackets).toHaveLength(6);
  });
});

// If describeEventTimingCue is exported, uncomment and use these:
// import { describeEventTimingCue } from "@/lib/create/service";
//
// describe("describeEventTimingCue — direct tests", () => {
//   const eventStart = new Date("2026-04-20T19:00:00Z");
//
//   it("8 days before → early_awareness", () => {
//     const scheduled = new Date("2026-04-12T12:00:00Z");
//     const result = describeEventTimingCue(scheduled, eventStart);
//     expect(result.label).toBe("early_awareness");
//     expect(result.toneCue).toContain("early heads-up");
//   });
//
//   it("6 days before → building", () => {
//     const scheduled = new Date("2026-04-14T12:00:00Z");
//     const result = describeEventTimingCue(scheduled, eventStart);
//     expect(result.label).toBe("building");
//     expect(result.toneCue).toContain("Build anticipation");
//   });
//
//   it("2 days before → tomorrow", () => {
//     const scheduled = new Date("2026-04-18T12:00:00Z");
//     const result = describeEventTimingCue(scheduled, eventStart);
//     expect(result.label).toBe("tomorrow");
//     expect(result.toneCue).toContain("very soon");
//   });
//
//   it("same day 10am → today_morning", () => {
//     const scheduled = new Date("2026-04-20T09:00:00Z");
//     const result = describeEventTimingCue(scheduled, eventStart);
//     expect(result.label).toBe("today_morning");
//     expect(result.toneCue).toContain("Set the scene");
//   });
//
//   it("same day 3pm → today_imminent", () => {
//     const scheduled = new Date("2026-04-20T14:00:00Z");
//     const result = describeEventTimingCue(scheduled, eventStart);
//     expect(result.label).toBe("today_imminent");
//     expect(result.toneCue).toContain("urgent");
//   });
//
//   it("day after event → recap", () => {
//     const scheduled = new Date("2026-04-21T12:00:00Z");
//     const result = describeEventTimingCue(scheduled, eventStart);
//     expect(result.label).toBe("recap");
//     expect(result.toneCue).toContain("already happened");
//   });
//
//   it("null scheduledFor → today_imminent (live)", () => {
//     const result = describeEventTimingCue(null, eventStart);
//     expect(result.label).toBe("today_imminent");
//   });
// });
```

**Implementation note:** The commented-out tests are the preferred approach if `describeEventTimingCue` is exported. The implementing agent should:
1. Add `export` to the `describeEventTimingCue` function in `service.ts`
2. Uncomment the direct tests
3. Remove the placeholder documentation test

- [ ] **Step 15.2: Run tests**

```bash
cd /Users/peterpitcher/Cursor/OJ-CheersAI2.0
npx vitest run tests/lib/create/service-engagement.test.ts
```

Expected: all tests pass.

- [ ] **Step 15.3: Commit**

```bash
git add tests/lib/create/service-engagement.test.ts
git commit -m "test: add temporal proximity bracket tests for describeEventTimingCue"
```

---

## Chunk 6: Final Verification

### Task 16: Full verification pipeline

- [ ] **Step 16.1: Run lint**

```bash
cd /Users/peterpitcher/Cursor/OJ-CheersAI2.0
npm run lint
```

Expected: zero errors, zero warnings.

- [ ] **Step 16.2: Run typecheck**

```bash
cd /Users/peterpitcher/Cursor/OJ-CheersAI2.0
npx tsc --noEmit
```

Expected: clean compilation.

- [ ] **Step 16.3: Run all tests**

```bash
cd /Users/peterpitcher/Cursor/OJ-CheersAI2.0
npm test
```

Expected: all tests pass, including new tests in:
- `tests/lib/ai/hooks.test.ts`
- `tests/lib/ai/pillars.test.ts`
- `tests/lib/ai/prompts-engagement.test.ts`
- `tests/lib/create/service-engagement.test.ts`

- [ ] **Step 16.4: Run build**

```bash
cd /Users/peterpitcher/Cursor/OJ-CheersAI2.0
npm run build
```

Expected: successful production build.

- [ ] **Step 16.5: Final commit (if any lint/type fixes were needed)**

```bash
git add -A
git commit -m "chore: fix lint and type issues from copy engagement changes"
```

---

## Summary

| Chunk | Tasks | New files | Modified files |
|-------|-------|-----------|----------------|
| 1: Hook Strategy | 1-2 | `src/lib/ai/hooks.ts`, `tests/lib/ai/hooks.test.ts` | — |
| 2: Content Pillars | 3-4 | `src/lib/ai/pillars.ts`, `tests/lib/ai/pillars.test.ts` | — |
| 3: Prompt Enhancements | 5-9 | — | `src/lib/ai/prompts.ts` |
| 4: Service Integration | 10-13 | — | `src/lib/create/service.ts` |
| 5: Integration Tests | 14-15 | `tests/lib/ai/prompts-engagement.test.ts`, `tests/lib/create/service-engagement.test.ts` | — |
| 6: Verification | 16 | — | — |

**Total new files:** 6
**Total modified files:** 2 (`prompts.ts`, `service.ts`)
**Estimated complexity:** M (touches 8 files, no schema changes — schema is in Plan B)
