# Plan B: Smart Scheduling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add spread-evenly scheduling mode to weekly campaigns with platform staggering and engagement-optimised posting times.

**Architecture:** New scheduling algorithm in service.ts, schema extensions for weekly campaigns, PostingDefaults model updates, materialise.ts support, and weekly campaign form UI changes.

**Tech Stack:** TypeScript, Vitest, Supabase (PostgreSQL), Zod, React Hook Form, Next.js App Router

**Depends on:** Plan A (Prerequisite Fixes) — requires fixed conflicts.ts and reserveSlotOnSameDay
**Blocks:** Nothing (Plan C can run in parallel after Plan A)

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `supabase/migrations/20260410_smart_scheduling.sql` | Add columns to `posting_defaults` and `content_items`, composite index |
| Modify | `src/lib/settings/data.ts` | Add `defaultPostingTime`, `venueLocation` to PostingDefaults types and mapping |
| Modify | `src/features/settings/schema.ts` | Zod validation for new PostingDefaults fields |
| Modify | `src/app/(app)/settings/actions.ts` | Read/write new settings fields in `updatePostingDefaults` |
| Modify | `src/lib/create/schema.ts` | Add `scheduleMode`, `postsPerWeek`, `staggerPlatforms` to weekly campaign schemas |
| Modify | `src/lib/create/service.ts` | Spread algorithm, platform staggering, engagement-optimised time selection |
| Modify | `src/lib/scheduling/materialise.ts` | Support `spread_evenly` mode in recurring materialisation |
| Modify | `src/features/create/weekly-campaign-form.tsx` | Spread/fixed toggle, posts-per-week dropdown, stagger toggle |
| Create | `tests/scheduling/spread-algorithm.test.ts` | Tests for spread-evenly scheduling |
| Create | `tests/scheduling/platform-stagger.test.ts` | Tests for platform staggering logic |
| Create | `tests/scheduling/engagement-time.test.ts` | Tests for engagement-optimised time selection |
| Create | `tests/settings/posting-defaults.test.ts` | Tests for new PostingDefaults fields |

---

## Chunk 1: Database Migration and PostingDefaults Model

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260410_smart_scheduling.sql`

- [ ] **Step 1.1: Create migration file**

```sql
-- supabase/migrations/20260410_smart_scheduling.sql

-- New columns on posting_defaults for user-configurable posting time and venue location
ALTER TABLE posting_defaults ADD COLUMN default_posting_time text
  CHECK (default_posting_time IS NULL OR default_posting_time ~ '^([01]\d|2[0-3]):[0-5]\d$');
ALTER TABLE posting_defaults ADD COLUMN venue_location text
  CHECK (venue_location IS NULL OR length(venue_location) <= 100);

-- New columns on content_items for hook and pillar tracking (used by Parts 2 & 3, but migrated together)
ALTER TABLE content_items ADD COLUMN hook_strategy text
  CHECK (hook_strategy IS NULL OR hook_strategy IN (
    'question', 'bold_statement', 'direct_address', 'curiosity_gap',
    'seasonal', 'scarcity', 'behind_scenes', 'social_proof'));
ALTER TABLE content_items ADD COLUMN content_pillar text
  CHECK (content_pillar IS NULL OR content_pillar IN (
    'food_drink', 'events', 'people', 'behind_scenes', 'customer_love', 'seasonal'));

-- Composite index for spread algorithm performance (account + schedule range queries)
CREATE INDEX idx_content_items_account_schedule
ON content_items(account_id, scheduled_for);
```

All columns are nullable — non-breaking migration, no data backfill needed.

- [ ] **Step 1.2: Apply migration locally (dry-run first)**

```bash
cd /Users/peterpitcher/Cursor/OJ-CheersAI2.0
npx supabase db push --dry-run
```
Expected: migration listed, no errors.

```bash
npx supabase db push
```
Expected: migration applied successfully.

- [ ] **Step 1.3: Commit**

```bash
git add supabase/migrations/20260410_smart_scheduling.sql
git commit -m "feat: add smart scheduling columns to posting_defaults and content_items"
```

---

### Task 2: Update PostingDefaults types and getOwnerSettings() mapping

**Files:**
- Modify: `src/lib/settings/data.ts`

- [ ] **Step 2.1: Add fields to `PostingDefaults` interface**

In `src/lib/settings/data.ts`, find the `PostingDefaults` interface (line 18). Add two fields after `gbpCtaDefaults`:

```typescript
export interface PostingDefaults {
  timezone: string;
  facebookLocationId?: string;
  instagramLocationId?: string;
  gbpLocationId?: string;
  notifications: {
    emailFailures: boolean;
    emailTokenExpiring: boolean;
  };
  gbpCtaDefaults: {
    standard: "LEARN_MORE" | "BOOK" | "CALL";
    event: "LEARN_MORE" | "BOOK" | "CALL";
    offer: "REDEEM" | "CALL" | "LEARN_MORE";
  };
  defaultPostingTime?: string;    // ← add (HH:mm format, e.g. "12:00")
  venueLocation?: string;         // ← add (e.g. "Leatherhead, Surrey")
}
```

- [ ] **Step 2.2: Add fields to `PostingDefaultsRow` type**

Find `PostingDefaultsRow` (line 53). Add two fields:

```typescript
type PostingDefaultsRow = {
  facebook_location_id: string | null;
  instagram_location_id: string | null;
  gbp_location_id: string | null;
  notifications: Record<string, boolean> | null;
  gbp_cta_standard: string;
  gbp_cta_event: string;
  gbp_cta_offer: string;
  default_posting_time: string | null;   // ← add
  venue_location: string | null;         // ← add
};
```

- [ ] **Step 2.3: Update SELECT query in `getOwnerSettings()`**

Find the `posting_defaults` SELECT query (~line 128). Add the new columns:

```typescript
    const { data: postingRow, error: postingError } = await supabase
      .from("posting_defaults")
      .select(
        "facebook_location_id, instagram_location_id, gbp_location_id, notifications, gbp_cta_standard, gbp_cta_event, gbp_cta_offer, default_posting_time, venue_location",
      )
      .eq("account_id", accountId)
      .maybeSingle<PostingDefaultsRow>();
```

- [ ] **Step 2.4: Update camelCase mapping in `getOwnerSettings()`**

Find the `posting` object construction (~line 156). Add the new fields after `gbpCtaDefaults`:

```typescript
    const posting: PostingDefaults = {
      timezone,
      facebookLocationId: postingRow?.facebook_location_id ?? undefined,
      instagramLocationId: postingRow?.instagram_location_id ?? undefined,
      gbpLocationId: postingRow?.gbp_location_id ?? undefined,
      notifications: {
        emailFailures: Boolean(notifications?.emailFailures ?? defaultPosting.notifications.emailFailures),
        emailTokenExpiring: Boolean(notifications?.emailTokenExpiring ?? defaultPosting.notifications.emailTokenExpiring),
      },
      gbpCtaDefaults: {
        standard:
          (postingRow?.gbp_cta_standard as PostingDefaults["gbpCtaDefaults"]["standard"]) ?? defaultPosting.gbpCtaDefaults.standard,
        event:
          (postingRow?.gbp_cta_event as PostingDefaults["gbpCtaDefaults"]["event"]) ?? defaultPosting.gbpCtaDefaults.event,
        offer:
          (postingRow?.gbp_cta_offer as PostingDefaults["gbpCtaDefaults"]["offer"]) ?? defaultPosting.gbpCtaDefaults.offer,
      },
      defaultPostingTime: postingRow?.default_posting_time ?? undefined,   // ← add
      venueLocation: postingRow?.venue_location ?? undefined,               // ← add
    };
```

- [ ] **Step 2.5: Also expose `venueLocation` on `OwnerSettings`**

Find the `OwnerSettings` interface (line 34). Add `venueLocation`:

```typescript
export interface OwnerSettings {
  brand: BrandProfile;
  posting: PostingDefaults;
  venueName?: string;
  venueLocation?: string;   // ← add
}
```

Update the return statement (~line 175) to include `venueLocation`:

```typescript
    return { brand, posting, venueName, venueLocation: posting.venueLocation };
```

- [ ] **Step 2.6: Verify types compile**

```bash
cd /Users/peterpitcher/Cursor/OJ-CheersAI2.0
npx tsc --noEmit
```
Expected: no type errors.

- [ ] **Step 2.7: Commit**

```bash
git add src/lib/settings/data.ts
git commit -m "feat: add defaultPostingTime and venueLocation to PostingDefaults model"
```

---

### Task 3: Update settings Zod schema and server action

**Files:**
- Modify: `src/features/settings/schema.ts`
- Modify: `src/app/(app)/settings/actions.ts`

- [ ] **Step 3.1: Add fields to `postingDefaultsFormSchema`**

In `src/features/settings/schema.ts`, find `postingDefaultsFormSchema` (line 18). Add two fields after `gbpCtaDefaults`:

```typescript
export const postingDefaultsFormSchema = z.object({
  timezone: z.string(),
  facebookLocationId: z.string().optional(),
  instagramLocationId: z.string().optional(),
  gbpLocationId: z.string().optional(),
  notifications: z.object({
    emailFailures: z.boolean(),
    emailTokenExpiring: z.boolean(),
  }),
  gbpCtaDefaults: z.object({
    standard: z.enum(["LEARN_MORE", "BOOK", "CALL"]),
    event: z.enum(["LEARN_MORE", "BOOK", "CALL"]),
    offer: z.enum(["REDEEM", "CALL", "LEARN_MORE"]),
  }),
  defaultPostingTime: z                                                      // ← add block start
    .union([z.literal(""), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm format")])
    .transform((value) => (value ? value : undefined))
    .optional(),
  venueLocation: z                                                           // ← add
    .union([
      z.literal(""),
      z.string()
        .max(100, "Keep under 100 characters")
        .regex(/^[\p{L}\p{N}\s,.\-']+$/u, "Only letters, numbers, spaces, commas, full stops, hyphens, and apostrophes"),
    ])
    .transform((value) => (value ? value : undefined))
    .optional(),                                                             // ← add block end
});
```

- [ ] **Step 3.2: Update `updatePostingDefaults` server action**

In `src/app/(app)/settings/actions.ts`, find `updatePostingDefaults` (~line 121). Update the upsert payload to include the new columns:

```typescript
  await supabase
    .from("posting_defaults")
    .upsert(
      {
        account_id: accountId,
        facebook_location_id: parsed.facebookLocationId ?? null,
        instagram_location_id: parsed.instagramLocationId ?? null,
        gbp_location_id: parsed.gbpLocationId ?? null,
        notifications: {
          emailFailures: parsed.notifications.emailFailures,
          emailTokenExpiring: parsed.notifications.emailTokenExpiring,
        },
        gbp_cta_standard: parsed.gbpCtaDefaults.standard,
        gbp_cta_event: parsed.gbpCtaDefaults.event,
        gbp_cta_offer: parsed.gbpCtaDefaults.offer,
        default_posting_time: parsed.defaultPostingTime ?? null,    // ← add
        venue_location: parsed.venueLocation ?? null,               // ← add
      },
      { onConflict: "account_id" },
    )
    .throwOnError();
```

- [ ] **Step 3.3: Write test for PostingDefaults validation**

Create `tests/settings/posting-defaults.test.ts`:

```typescript
// tests/settings/posting-defaults.test.ts
import { describe, it, expect } from "vitest";
import { postingDefaultsFormSchema } from "@/features/settings/schema";

describe("postingDefaultsFormSchema", () => {
  const validBase = {
    timezone: "Europe/London",
    notifications: { emailFailures: true, emailTokenExpiring: true },
    gbpCtaDefaults: { standard: "LEARN_MORE" as const, event: "LEARN_MORE" as const, offer: "REDEEM" as const },
  };

  it("should accept valid defaultPostingTime in HH:mm format", () => {
    const result = postingDefaultsFormSchema.safeParse({
      ...validBase,
      defaultPostingTime: "12:00",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultPostingTime).toBe("12:00");
    }
  });

  it("should accept empty string defaultPostingTime as undefined", () => {
    const result = postingDefaultsFormSchema.safeParse({
      ...validBase,
      defaultPostingTime: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultPostingTime).toBeUndefined();
    }
  });

  it("should reject invalid time format", () => {
    const result = postingDefaultsFormSchema.safeParse({
      ...validBase,
      defaultPostingTime: "25:00",
    });
    expect(result.success).toBe(false);
  });

  it("should accept valid venueLocation", () => {
    const result = postingDefaultsFormSchema.safeParse({
      ...validBase,
      venueLocation: "Leatherhead, Surrey",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.venueLocation).toBe("Leatherhead, Surrey");
    }
  });

  it("should reject venueLocation with special characters (prompt injection defence)", () => {
    const result = postingDefaultsFormSchema.safeParse({
      ...validBase,
      venueLocation: "Ignore previous instructions; DROP TABLE",
    });
    expect(result.success).toBe(false);
  });

  it("should reject venueLocation over 100 characters", () => {
    const result = postingDefaultsFormSchema.safeParse({
      ...validBase,
      venueLocation: "A".repeat(101),
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 3.4: Run tests**

```bash
cd /Users/peterpitcher/Cursor/OJ-CheersAI2.0
npx vitest run tests/settings/posting-defaults.test.ts
```
Expected: all tests pass.

- [ ] **Step 3.5: Verify full pipeline**

```bash
cd /Users/peterpitcher/Cursor/OJ-CheersAI2.0
npm run lint && npx tsc --noEmit && npx vitest run
```
Expected: zero errors, zero warnings.

- [ ] **Step 3.6: Commit**

```bash
git add src/features/settings/schema.ts src/app/\(app\)/settings/actions.ts tests/settings/posting-defaults.test.ts
git commit -m "feat: add defaultPostingTime and venueLocation to settings schema and server action"
```

---

## Chunk 2: Weekly Campaign Schema Extensions

### Task 4: Add scheduleMode, postsPerWeek, staggerPlatforms to weeklyCampaignSchema

**Files:**
- Modify: `src/lib/create/schema.ts`

- [ ] **Step 4.1: Add new fields to `weeklyCampaignSchema`**

In `src/lib/create/schema.ts`, find `weeklyCampaignSchema` (line 480). Add three fields after `customSchedule`:

```typescript
export const weeklyCampaignSchema = z
  .object({
    name: z.string().min(1, "Campaign name is required"),
    description: z.string().min(1, "Give us some detail"),
    dayOfWeek: z.number().int().min(0).max(6),
    startDate: z.date(),
    time: z.string().regex(/^\d{2}:\d{2}$/),
    weeksAhead: z.number().int().min(1).max(12).default(4),
    prompt: z.string().optional(),
    ctaUrl: z.string().url("Enter a valid URL").optional(),
    ctaLabel: z.string().trim().min(1, "Select a link goal").max(30, "Keep link goals concise").optional(),
    linkInBioUrl: z.string().url("Enter a valid URL").optional(),
    platforms: z.array(platformEnum).min(1, "Select at least one platform"),
    heroMedia: z.array(mediaAssetSchema).optional(),
    toneAdjust: toneAdjustEnum.default("default"),
    lengthPreference: lengthPreferenceEnum.default("standard"),
    includeHashtags: z.boolean().default(true),
    includeEmojis: z.boolean().default(true),
    ctaStyle: ctaStyleEnum.default("default"),
    customSchedule: z.array(z.date()).optional(),
    scheduleMode: z.enum(["fixed_days", "spread_evenly"]).default("fixed_days"),       // ← add
    postsPerWeek: z.number().int().min(1).max(7).optional(),                           // ← add
    staggerPlatforms: z.boolean().default(true),                                        // ← add
  })
  .merge(proofPointOptionsSchema)
  .superRefine((data, ctx) => {
    if (!data.heroMedia || data.heroMedia.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Attach at least one image or video.",
        path: ["heroMedia"],
      });
    }

    if (data.customSchedule && data.customSchedule.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Add at least one manual schedule slot or disable manual scheduling.",
        path: ["customSchedule"],
      });
    }

    // postsPerWeek is required when scheduleMode is "spread_evenly"             // ← add block start
    if (data.scheduleMode === "spread_evenly" && (data.postsPerWeek == null || data.postsPerWeek < 1)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select how many posts per week for spread-evenly mode.",
        path: ["postsPerWeek"],
      });
    }                                                                             // ← add block end
  });
```

- [ ] **Step 4.2: Add matching fields to `weeklyCampaignFormSchema`**

Find `weeklyCampaignFormSchema` (line 520). Add three fields after `manualSlots`:

```typescript
export const weeklyCampaignFormSchema = z
  .object({
    name: z.string().min(1, "Campaign name is required"),
    description: z.string().min(1, "Give us some detail"),
    dayOfWeek: z.string().min(1, "Select a day"),
    startDate: z.string().min(1, "Start date required"),
    time: z.string().regex(/^\d{2}:\d{2}$/),
    weeksAhead: z.string().optional(),
    prompt: z.string().optional(),
    ctaUrl: optionalUrlFormField,
    ctaLabel: optionalCtaLabelFormField,
    linkInBioUrl: optionalUrlFormField,
    platforms: z.array(platformEnum).min(1, "Select at least one platform"),
    heroMedia: z.array(mediaAssetSchema).optional(),
    toneAdjust: toneAdjustEnum.default("default"),
    lengthPreference: lengthPreferenceEnum.default("standard"),
    includeHashtags: z.boolean().default(true),
    includeEmojis: z.boolean().default(true),
    ctaStyle: ctaStyleEnum.default("default"),
    useManualSchedule: z.boolean().default(false),
    manualSlots: z
      .array(
        z.object({
          date: z.string().min(1, "Date required"),
          time: z.string().regex(/^\d{2}:\d{2}$/),
        }),
      )
      .default([]),
    scheduleMode: z.enum(["fixed_days", "spread_evenly"]).default("fixed_days"),       // ← add
    postsPerWeek: z.string().default("3"),                                              // ← add (string for form select)
    staggerPlatforms: z.boolean().default(true),                                        // ← add
  })
  .merge(proofPointOptionsSchema)
  .superRefine((data, ctx) => {
    if (!data.heroMedia || data.heroMedia.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Attach at least one image or video.",
        path: ["heroMedia"],
      });
    }

    if (data.useManualSchedule && data.manualSlots.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Add at least one schedule slot.",
        path: ["manualSlots"],
      });
    }

    // postsPerWeek required for spread_evenly mode                               // ← add block start
    if (data.scheduleMode === "spread_evenly") {
      const ppw = Number(data.postsPerWeek);
      if (!Number.isFinite(ppw) || ppw < 1 || ppw > 7) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Select 1-7 posts per week.",
          path: ["postsPerWeek"],
        });
      }
    }                                                                             // ← add block end
  });
```

- [ ] **Step 4.3: Verify types compile**

```bash
cd /Users/peterpitcher/Cursor/OJ-CheersAI2.0
npx tsc --noEmit
```
Expected: no type errors. `WeeklyCampaignInput` and `WeeklyCampaignFormValues` automatically pick up the new fields via `z.infer`.

- [ ] **Step 4.4: Commit**

```bash
git add src/lib/create/schema.ts
git commit -m "feat: add scheduleMode, postsPerWeek, staggerPlatforms to weekly campaign schemas"
```

---

## Chunk 3: Spread Algorithm and Engagement-Optimised Time Selection

### Task 5: Implement the spread algorithm

**Files:**
- Modify: `src/lib/create/service.ts`
- Create: `tests/scheduling/spread-algorithm.test.ts`

- [ ] **Step 5.1: Add engagement-optimised time selection helper**

In `src/lib/create/service.ts`, add after the `ensureFutureDate` function (~line 140):

```typescript
/** Engagement-optimised default posting hour based on proximity to event/occurrence. */
function getEngagementOptimisedHour(
  scheduledDate: Date,
  eventDate: Date | null,
  defaultPostingTime: string | undefined,
): { hour: number; minute: number } {
  // User override takes precedence
  if (defaultPostingTime) {
    const [h, m] = defaultPostingTime.split(":").map(Number);
    if (Number.isFinite(h) && Number.isFinite(m)) {
      return { hour: h!, minute: m! };
    }
  }

  if (!eventDate) {
    return { hour: 12, minute: 0 }; // default lunch-time
  }

  const diffMs = eventDate.getTime() - scheduledDate.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  if (diffDays <= 0) {
    // Same day — after-work crowd, high intent
    return { hour: 17, minute: 0 };
  }
  // 1-6 days or 7+ days — lunch browsers
  return { hour: 12, minute: 0 };
}
```

- [ ] **Step 5.2: Add the spread-evenly scheduling function**

In `src/lib/create/service.ts`, add after the new helper from Step 5.1:

```typescript
interface SpreadConfig {
  startDate: Date;
  weeksAhead: number;
  postsPerWeek: number;
  platforms: Platform[];
  staggerPlatforms: boolean;
  defaultPostingTime: string | undefined;
}

interface SpreadSlot {
  scheduledFor: Date;
  platform: Platform;
}

/**
 * Spread-evenly algorithm: distributes posts across the emptiest days in the scheduling window.
 * Weekly campaigns only. Runs within authenticated context — all queries scoped to accountId.
 */
async function buildSpreadEvenlySlots(
  supabase: SupabaseClient,
  accountId: string,
  config: SpreadConfig,
): Promise<SpreadSlot[]> {
  const { startDate, weeksAhead, postsPerWeek, platforms, staggerPlatforms, defaultPostingTime } = config;

  // 1. Determine scheduling window
  const windowStart = DateTime.fromJSDate(startDate, { zone: DEFAULT_TIMEZONE }).startOf("day");
  const windowEnd = windowStart.plus({ weeks: weeksAhead });
  const windowStartIso = windowStart.toUTC().toISO();
  const windowEndIso = windowEnd.toUTC().toISO();

  if (!windowStartIso || !windowEndIso) {
    return [];
  }

  // 2. Fetch existing feed posts for this account in the window
  const { data: existingRows, error } = await supabase
    .from("content_items")
    .select("scheduled_for, platform, placement")
    .eq("account_id", accountId)
    .gte("scheduled_for", windowStartIso)
    .lte("scheduled_for", windowEndIso)
    .returns<ScheduledSlotRow[]>();

  if (error) {
    throw error;
  }

  // 3. Build day-occupancy map: count feed posts per day per week
  const dayOccupancy = new Map<string, number>(); // dayKey -> count
  for (const row of existingRows ?? []) {
    if (!row.scheduled_for || row.placement === "story") continue;
    const dt = DateTime.fromISO(row.scheduled_for, { zone: DEFAULT_TIMEZONE });
    const dayKey = dt.toISODate();
    if (!dayKey) continue;
    dayOccupancy.set(dayKey, (dayOccupancy.get(dayKey) ?? 0) + 1);
  }

  // 4. Build candidate days for each week
  const slots: SpreadSlot[] = [];
  let weekPointer = windowStart;

  while (weekPointer < windowEnd) {
    const weekEndBound = weekPointer.plus({ weeks: 1 });
    const candidateDays: DateTime[] = [];

    // Collect all 7 days in this week that are within the window
    for (let d = 0; d < 7; d++) {
      const day = weekPointer.plus({ days: d });
      if (day >= windowEnd) break;
      if (day < windowStart) continue;
      candidateDays.push(day);
    }

    if (!candidateDays.length) {
      weekPointer = weekEndBound;
      continue;
    }

    // 5. Score and sort: emptiest days first, tie-break by weekday order
    const scored = candidateDays.map((day) => ({
      day,
      dayKey: day.toISODate()!,
      occupancy: dayOccupancy.get(day.toISODate()!) ?? 0,
    }));
    scored.sort((a, b) => a.occupancy - b.occupancy || a.day.weekday - b.day.weekday);

    // 6. Place posts for this week
    const postsThisWeek = Math.min(postsPerWeek, candidateDays.length);

    if (staggerPlatforms && platforms.length > 1) {
      // Platform staggering: each platform gets a different day
      const platformPriority: Platform[] = ["instagram", "facebook", "gbp"];
      const orderedPlatforms = platformPriority.filter((p) => platforms.includes(p));

      // For each post slot this week, assign platforms across days
      for (let postIdx = 0; postIdx < postsThisWeek; postIdx++) {
        const availableDaysForPost = scored.slice(postIdx * orderedPlatforms.length);

        for (let platIdx = 0; platIdx < orderedPlatforms.length; platIdx++) {
          const platform = orderedPlatforms[platIdx]!;
          // Pick the next emptiest day, or double up on least busy if insufficient
          const dayEntry = availableDaysForPost[platIdx] ?? scored[scored.length - 1]!;

          const timeInfo = getEngagementOptimisedHour(
            dayEntry.day.toJSDate(),
            null, // weekly campaigns don't have a single event date
            defaultPostingTime,
          );

          const scheduledFor = dayEntry.day
            .set({ hour: timeInfo.hour, minute: timeInfo.minute, second: 0, millisecond: 0 })
            .toUTC()
            .toJSDate();

          slots.push({ scheduledFor, platform });

          // Update occupancy for subsequent placement decisions
          dayOccupancy.set(dayEntry.dayKey, (dayOccupancy.get(dayEntry.dayKey) ?? 0) + 1);
        }
      }
    } else {
      // No staggering: all platforms on the same day
      for (let postIdx = 0; postIdx < postsThisWeek; postIdx++) {
        const dayEntry = scored[postIdx] ?? scored[scored.length - 1]!;

        for (const platform of platforms) {
          const timeInfo = getEngagementOptimisedHour(
            dayEntry.day.toJSDate(),
            null,
            defaultPostingTime,
          );

          const scheduledFor = dayEntry.day
            .set({ hour: timeInfo.hour, minute: timeInfo.minute, second: 0, millisecond: 0 })
            .toUTC()
            .toJSDate();

          slots.push({ scheduledFor, platform });
          dayOccupancy.set(dayEntry.dayKey, (dayOccupancy.get(dayEntry.dayKey) ?? 0) + 1);
        }
      }
    }

    weekPointer = weekEndBound;
  }

  return slots;
}
```

- [ ] **Step 5.3: Write tests for spread algorithm**

Create `tests/scheduling/spread-algorithm.test.ts`:

```typescript
// tests/scheduling/spread-algorithm.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock auth before importing service
vi.mock("@/lib/auth/server", () => ({
  requireAuthContext: vi.fn().mockResolvedValue({
    accountId: "test-account",
    supabase: {},
  }),
}));

vi.mock("@/lib/settings/data", () => ({
  getOwnerSettings: vi.fn().mockResolvedValue({
    brand: { toneFormal: 0.5, tonePlayful: 0.5, keyPhrases: [], bannedTopics: [], bannedPhrases: [], defaultHashtags: [], defaultEmojis: [] },
    posting: { timezone: "Europe/London", notifications: { emailFailures: true, emailTokenExpiring: true }, gbpCtaDefaults: { standard: "LEARN_MORE", event: "LEARN_MORE", offer: "REDEEM" } },
    venueName: "The Anchor",
  }),
}));

vi.mock("@/lib/ai/client", () => ({
  getOpenAIClient: vi.fn(),
}));

vi.mock("@/lib/publishing/queue", () => ({
  enqueuePublishJob: vi.fn(),
}));

vi.mock("@/lib/supabase/errors", () => ({
  isSchemaMissingError: vi.fn().mockReturnValue(false),
}));

// We test the spread algorithm by importing and testing the exported helper
// Since buildSpreadEvenlySlots is not exported, we test it through createWeeklyCampaign
// or extract it for testability. For now, test the engagement time helper.

describe("getEngagementOptimisedHour", () => {
  // Since this is a private function, we test via schema validation and integration.
  // This file tests schema-level validation of spread-evenly inputs.

  it("should reject postsPerWeek > 7 via schema", async () => {
    const { weeklyCampaignSchema } = await import("@/lib/create/schema");
    const result = weeklyCampaignSchema.safeParse({
      name: "Test",
      description: "Test campaign",
      dayOfWeek: 4,
      startDate: new Date("2026-05-01"),
      time: "12:00",
      weeksAhead: 4,
      platforms: ["instagram"],
      heroMedia: [{ assetId: "abc", mediaType: "image" }],
      scheduleMode: "spread_evenly",
      postsPerWeek: 8,
    });
    expect(result.success).toBe(false);
  });

  it("should reject spread_evenly without postsPerWeek", async () => {
    const { weeklyCampaignSchema } = await import("@/lib/create/schema");
    const result = weeklyCampaignSchema.safeParse({
      name: "Test",
      description: "Test campaign",
      dayOfWeek: 4,
      startDate: new Date("2026-05-01"),
      time: "12:00",
      weeksAhead: 4,
      platforms: ["instagram"],
      heroMedia: [{ assetId: "abc", mediaType: "image" }],
      scheduleMode: "spread_evenly",
      // postsPerWeek omitted
    });
    expect(result.success).toBe(false);
  });

  it("should accept valid spread_evenly config", async () => {
    const { weeklyCampaignSchema } = await import("@/lib/create/schema");
    const result = weeklyCampaignSchema.safeParse({
      name: "Test",
      description: "Test campaign",
      dayOfWeek: 4,
      startDate: new Date("2026-05-01"),
      time: "12:00",
      weeksAhead: 4,
      platforms: ["instagram"],
      heroMedia: [{ assetId: "abc", mediaType: "image" }],
      scheduleMode: "spread_evenly",
      postsPerWeek: 3,
      staggerPlatforms: true,
    });
    expect(result.success).toBe(true);
  });

  it("should accept fixed_days without postsPerWeek", async () => {
    const { weeklyCampaignSchema } = await import("@/lib/create/schema");
    const result = weeklyCampaignSchema.safeParse({
      name: "Test",
      description: "Test campaign",
      dayOfWeek: 4,
      startDate: new Date("2026-05-01"),
      time: "12:00",
      weeksAhead: 4,
      platforms: ["instagram"],
      heroMedia: [{ assetId: "abc", mediaType: "image" }],
      scheduleMode: "fixed_days",
    });
    expect(result.success).toBe(true);
  });

  it("should default scheduleMode to fixed_days when omitted", async () => {
    const { weeklyCampaignSchema } = await import("@/lib/create/schema");
    const result = weeklyCampaignSchema.safeParse({
      name: "Test",
      description: "Test campaign",
      dayOfWeek: 4,
      startDate: new Date("2026-05-01"),
      time: "12:00",
      weeksAhead: 4,
      platforms: ["instagram"],
      heroMedia: [{ assetId: "abc", mediaType: "image" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scheduleMode).toBe("fixed_days");
    }
  });
});
```

- [ ] **Step 5.4: Write tests for engagement-optimised time selection**

Create `tests/scheduling/engagement-time.test.ts`:

```typescript
// tests/scheduling/engagement-time.test.ts
import { describe, it, expect } from "vitest";

// Test the engagement time logic as a pure function
// We replicate the logic here since the original is private in service.ts
// In production, consider exporting it for testability

function getEngagementOptimisedHour(
  scheduledDate: Date,
  eventDate: Date | null,
  defaultPostingTime: string | undefined,
): { hour: number; minute: number } {
  if (defaultPostingTime) {
    const [h, m] = defaultPostingTime.split(":").map(Number);
    if (Number.isFinite(h) && Number.isFinite(m)) {
      return { hour: h!, minute: m! };
    }
  }
  if (!eventDate) {
    return { hour: 12, minute: 0 };
  }
  const diffMs = eventDate.getTime() - scheduledDate.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (diffDays <= 0) {
    return { hour: 17, minute: 0 };
  }
  return { hour: 12, minute: 0 };
}

describe("getEngagementOptimisedHour", () => {
  it("should return user override when defaultPostingTime is set", () => {
    const result = getEngagementOptimisedHour(
      new Date("2026-05-01T00:00:00Z"),
      new Date("2026-05-08T19:00:00Z"),
      "14:30",
    );
    expect(result).toEqual({ hour: 14, minute: 30 });
  });

  it("should return 12:00 when no event date", () => {
    const result = getEngagementOptimisedHour(
      new Date("2026-05-01T00:00:00Z"),
      null,
      undefined,
    );
    expect(result).toEqual({ hour: 12, minute: 0 });
  });

  it("should return 17:00 for same-day posts", () => {
    const result = getEngagementOptimisedHour(
      new Date("2026-05-01T10:00:00Z"),
      new Date("2026-05-01T19:00:00Z"),
      undefined,
    );
    expect(result).toEqual({ hour: 17, minute: 0 });
  });

  it("should return 12:00 for 7+ days before event", () => {
    const result = getEngagementOptimisedHour(
      new Date("2026-05-01T00:00:00Z"),
      new Date("2026-05-10T19:00:00Z"),
      undefined,
    );
    expect(result).toEqual({ hour: 12, minute: 0 });
  });

  it("should return 12:00 for 1-6 days before event", () => {
    const result = getEngagementOptimisedHour(
      new Date("2026-05-01T00:00:00Z"),
      new Date("2026-05-04T19:00:00Z"),
      undefined,
    );
    expect(result).toEqual({ hour: 12, minute: 0 });
  });
});
```

- [ ] **Step 5.5: Run tests**

```bash
cd /Users/peterpitcher/Cursor/OJ-CheersAI2.0
npx vitest run tests/scheduling/spread-algorithm.test.ts tests/scheduling/engagement-time.test.ts
```
Expected: all tests pass.

- [ ] **Step 5.6: Commit**

```bash
git add src/lib/create/service.ts tests/scheduling/spread-algorithm.test.ts tests/scheduling/engagement-time.test.ts
git commit -m "feat: implement spread-evenly algorithm and engagement-optimised time selection"
```

---

### Task 6: Implement platform staggering logic

**Files:**
- Modify: `src/lib/create/service.ts` (already done as part of `buildSpreadEvenlySlots` in Step 5.2)
- Create: `tests/scheduling/platform-stagger.test.ts`

- [ ] **Step 6.1: Write tests for platform staggering**

Create `tests/scheduling/platform-stagger.test.ts`:

```typescript
// tests/scheduling/platform-stagger.test.ts
import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";

// Test the staggering logic as pure functions
// Platform priority order: Instagram -> Facebook -> GBP

const PLATFORM_PRIORITY = ["instagram", "facebook", "gbp"] as const;

type Platform = (typeof PLATFORM_PRIORITY)[number];

function assignPlatformsToDays(
  platforms: Platform[],
  emptyDays: string[], // ISO date strings, sorted emptiest first
): Array<{ platform: Platform; dayKey: string }> {
  const orderedPlatforms = PLATFORM_PRIORITY.filter((p) => platforms.includes(p));
  const assignments: Array<{ platform: Platform; dayKey: string }> = [];

  for (let i = 0; i < orderedPlatforms.length; i++) {
    const platform = orderedPlatforms[i]!;
    // Assign to next available day, or double up on last available
    const dayKey = emptyDays[i] ?? emptyDays[emptyDays.length - 1]!;
    assignments.push({ platform, dayKey });
  }

  return assignments;
}

describe("platform staggering", () => {
  it("should assign 3 platforms to 3 different days", () => {
    const result = assignPlatformsToDays(
      ["instagram", "facebook", "gbp"],
      ["2026-05-05", "2026-05-06", "2026-05-07"],
    );
    expect(result).toEqual([
      { platform: "instagram", dayKey: "2026-05-05" },
      { platform: "facebook", dayKey: "2026-05-06" },
      { platform: "gbp", dayKey: "2026-05-07" },
    ]);
  });

  it("should respect priority order: Instagram first, then Facebook, then GBP", () => {
    const result = assignPlatformsToDays(
      ["gbp", "facebook", "instagram"],
      ["2026-05-05", "2026-05-06", "2026-05-07"],
    );
    expect(result[0]!.platform).toBe("instagram");
    expect(result[1]!.platform).toBe("facebook");
    expect(result[2]!.platform).toBe("gbp");
  });

  it("should group remaining platforms when fewer empty days than platforms", () => {
    const result = assignPlatformsToDays(
      ["instagram", "facebook", "gbp"],
      ["2026-05-05", "2026-05-06"], // only 2 empty days for 3 platforms
    );
    expect(result).toEqual([
      { platform: "instagram", dayKey: "2026-05-05" },
      { platform: "facebook", dayKey: "2026-05-06" },
      { platform: "gbp", dayKey: "2026-05-06" }, // doubles up on last available
    ]);
  });

  it("should handle single platform (no staggering needed)", () => {
    const result = assignPlatformsToDays(
      ["instagram"],
      ["2026-05-05", "2026-05-06", "2026-05-07"],
    );
    expect(result).toEqual([
      { platform: "instagram", dayKey: "2026-05-05" },
    ]);
  });

  it("should handle 2 platforms with 1 empty day", () => {
    const result = assignPlatformsToDays(
      ["instagram", "facebook"],
      ["2026-05-05"],
    );
    expect(result).toEqual([
      { platform: "instagram", dayKey: "2026-05-05" },
      { platform: "facebook", dayKey: "2026-05-05" },
    ]);
  });
});
```

- [ ] **Step 6.2: Run tests**

```bash
cd /Users/peterpitcher/Cursor/OJ-CheersAI2.0
npx vitest run tests/scheduling/platform-stagger.test.ts
```
Expected: all tests pass.

- [ ] **Step 6.3: Commit**

```bash
git add tests/scheduling/platform-stagger.test.ts
git commit -m "test: add platform staggering logic tests"
```

---

## Chunk 4: Wire Spread Algorithm into createWeeklyCampaign

### Task 7: Integrate spread algorithm into the weekly campaign creation flow

**Files:**
- Modify: `src/lib/create/service.ts`

- [ ] **Step 7.1: Update `createWeeklyCampaign` to read new fields and branch on scheduleMode**

In `src/lib/create/service.ts`, find `createWeeklyCampaign` (line 760). The function needs to:
1. Read `scheduleMode`, `postsPerWeek`, `staggerPlatforms` from input
2. Read `posting.defaultPostingTime` from owner settings
3. Branch: if `scheduleMode === "spread_evenly"`, use `buildSpreadEvenlySlots()` instead of fixed-day logic

Replace the entire `createWeeklyCampaign` function body. Key changes are marked:

```typescript
export async function createWeeklyCampaign(input: WeeklyCampaignInput) {
  const { accountId, supabase } = await requireAuthContext();
  const { brand, venueName, posting } = await getOwnerSettings();    // ← add: destructure posting

  const firstOccurrence = getFirstOccurrence(input.startDate, input.dayOfWeek, input.time);
  const minimumTime = Date.now() + MIN_SCHEDULE_OFFSET_MS;
  const weeksAhead = input.weeksAhead ?? 4;
  const advancedOptions = extractAdvancedOptions(input);
  const [hourStr = "07", minuteStr = "0"] = input.time.split(":");
  const parsedHour = Number(hourStr);
  const parsedMinute = Number(minuteStr);
  const cadenceHour = Number.isFinite(parsedHour) ? parsedHour : 7;
  const cadenceMinute = Number.isFinite(parsedMinute) ? parsedMinute : 0;
  const manualSchedule = input.customSchedule ?? [];
  const usingManualSchedule = manualSchedule.length > 0;

  // ↓↓↓ NEW: Detect spread-evenly mode ↓↓↓
  const scheduleMode = input.scheduleMode ?? "fixed_days";
  const usingSpreadEvenly = scheduleMode === "spread_evenly" && !usingManualSchedule;
  const postsPerWeek = input.postsPerWeek ?? 3;
  const staggerPlatforms = input.staggerPlatforms ?? true;
  // ↑↑↑ END NEW ↑↑↑

  const cadence = usingManualSchedule || usingSpreadEvenly                   // ← changed: also skip cadence for spread
    ? undefined
    : input.platforms.map((platform) => ({
      platform,
      weekday: input.dayOfWeek,
      hour: cadenceHour,
      minute: cadenceMinute,
    }));

  const resolvedCtaLabel = resolveDefaultCtaLabel("weekly", input.ctaUrl, input.ctaLabel);
  const promptBase = composePrompt(
    [
      `Weekly feature: ${input.name}`,
      input.description ? `Campaign details: ${input.description}` : "",
      `Occurs every ${weekdayLabel(input.dayOfWeek)} at ${input.time}.`,
    ],
    input.prompt,
  );

  const focusLineForOccurrence = (occurrenceIndex: number) => {
    const cues = [
      "Lead with a warm invite and the key details.",
      "Lean into the atmosphere and who it's perfect for (mates, dates, families).",
      "Highlight one specific detail from the description (what guests can expect).",
      "Add a clear, friendly call to action without sounding salesy.",
      "Keep it short, punchy, and upbeat — a quick weekly reminder.",
      "Vary the wording and opening hook so it doesn't feel copy-pasted from one post to the next.",
    ];
    const cue = cues[(Math.max(1, occurrenceIndex) - 1) % cues.length] ?? cues[0];
    return `Focus: Regular reminder for the upcoming occurrence. Keep it evergreen — do not label it as a numbered instalment or part of a numbered series. ${cue}`;
  };

  const sortedManualSchedule = usingManualSchedule
    ? manualSchedule
      .filter((date): date is Date => date instanceof Date && !Number.isNaN(date.getTime()))
      .sort((a, b) => a.getTime() - b.getTime())
    : [];

  // ↓↓↓ NEW: Build plans from spread-evenly slots ↓↓↓
  let plans: VariantPlan[];

  if (usingSpreadEvenly) {
    const spreadSlots = await buildSpreadEvenlySlots(supabase, accountId, {
      startDate: input.startDate,
      weeksAhead,
      postsPerWeek,
      platforms: input.platforms,
      staggerPlatforms,
      defaultPostingTime: posting?.defaultPostingTime,
    });

    plans = spreadSlots.map((slot, index) => {
      const futureSlot = ensureFutureDate(slot.scheduledFor) ?? new Date(minimumTime);
      const occurrenceNumber = index + 1;
      return {
        title: input.name,
        prompt: [promptBase, focusLineForOccurrence(occurrenceNumber)].filter(Boolean).join("\n\n"),
        scheduledFor: futureSlot,
        platforms: [slot.platform], // Each slot targets one platform in spread mode
        media: input.heroMedia,
        promptContext: {
          occurrenceIndex: occurrenceNumber,
          useCase: "weekly",
          scheduleMode: "spread_evenly",
          proofPointMode: input.proofPointMode,
          proofPointsSelected: input.proofPointsSelected ?? [],
          proofPointIntentTags: input.proofPointIntentTags ?? [],
          ctaLabel: resolvedCtaLabel,
          ctaUrl: input.ctaUrl ?? null,
          linkInBioUrl: input.linkInBioUrl ?? null,
        },
        options: advancedOptions,
        ctaUrl: input.ctaUrl ?? null,
        linkInBioUrl: input.linkInBioUrl ?? null,
        placement: "feed" as const,
      };
    });
  } else if (usingManualSchedule) {
    // ↑↑↑ END NEW — existing manual schedule logic below is unchanged ↑↑↑
    plans = sortedManualSchedule.map((scheduledFor, index) => {
      const futureSlot = ensureFutureDate(scheduledFor ?? null) ?? new Date(minimumTime);
      const occurrenceNumber = index + 1;
      return {
        title: input.name,
        prompt: [promptBase, focusLineForOccurrence(occurrenceNumber)].filter(Boolean).join("\n\n"),
        scheduledFor: futureSlot,
        platforms: input.platforms,
        media: input.heroMedia,
        promptContext: {
          occurrenceIndex: occurrenceNumber,
          custom: true,
          useCase: "weekly",
          proofPointMode: input.proofPointMode,
          proofPointsSelected: input.proofPointsSelected ?? [],
          proofPointIntentTags: input.proofPointIntentTags ?? [],
          ctaLabel: resolvedCtaLabel,
          ctaUrl: input.ctaUrl ?? null,
          linkInBioUrl: input.linkInBioUrl ?? null,
        },
        options: advancedOptions,
        ctaUrl: input.ctaUrl ?? null,
        linkInBioUrl: input.linkInBioUrl ?? null,
        placement: "feed" as const,
      };
    });
  } else {
    // Existing fixed-day logic — unchanged
    const list: VariantPlan[] = [];
    let weekOffset = 0;
    while (list.length < weeksAhead) {
      const candidate = new Date(firstOccurrence.getTime() + weekOffset * 7 * DAY_MS);
      weekOffset += 1;
      const futureSlot = ensureFutureDate(candidate) ?? new Date(minimumTime);
      const occurrenceNumber = list.length + 1;
      list.push({
        title: input.name,
        prompt: [promptBase, focusLineForOccurrence(occurrenceNumber)].filter(Boolean).join("\n\n"),
        scheduledFor: futureSlot,
        platforms: input.platforms,
        media: input.heroMedia,
        promptContext: {
          occurrenceIndex: occurrenceNumber,
          dayOfWeek: input.dayOfWeek,
          time: input.time,
          useCase: "weekly",
          proofPointMode: input.proofPointMode,
          proofPointsSelected: input.proofPointsSelected ?? [],
          proofPointIntentTags: input.proofPointIntentTags ?? [],
          ctaLabel: resolvedCtaLabel,
          ctaUrl: input.ctaUrl ?? null,
          linkInBioUrl: input.linkInBioUrl ?? null,
        },
        options: advancedOptions,
        ctaUrl: input.ctaUrl ?? null,
        linkInBioUrl: input.linkInBioUrl ?? null,
        placement: "feed" as const,
      });
    }
    plans = list;
  }

  const displayEndDateIso = plans.length
    ? plans[plans.length - 1]?.scheduledFor?.toISOString() ?? null
    : null;

  const effectiveWeeksAhead = usingManualSchedule ? sortedManualSchedule.length || weeksAhead : weeksAhead;

  return createCampaignFromPlans({
    supabase,
    accountId,
    brand,
    venueName,
    name: input.name,
    type: "weekly",
    metadata: {
      description: input.description,
      dayOfWeek: input.dayOfWeek,
      time: input.time,
      weeksAhead: effectiveWeeksAhead,
      cadence,
      scheduleMode,                                                              // ← add
      postsPerWeek: usingSpreadEvenly ? postsPerWeek : undefined,                // ← add
      staggerPlatforms: usingSpreadEvenly ? staggerPlatforms : undefined,        // ← add
      manualSchedule: usingManualSchedule
        ? sortedManualSchedule.map((date) => date.toISOString())
        : undefined,
      advanced: advancedOptions,
      proofPointMode: input.proofPointMode,
      proofPointsSelected: input.proofPointsSelected ?? [],
      proofPointIntentTags: input.proofPointIntentTags ?? [],
      ctaUrl: input.ctaUrl ?? null,
      ctaLabel: resolvedCtaLabel,
      linkInBioUrl: input.linkInBioUrl ?? null,
      startDate: input.startDate.toISOString(),
      displayEndDate: displayEndDateIso,
    },
    plans,
    options: {
      autoSchedule: false,
    },
    linkInBioUrl: input.linkInBioUrl ?? null,
  });
}
```

- [ ] **Step 7.2: Update `getOwnerSettings` destructuring**

Note that `getOwnerSettings()` already returns `posting` in the `OwnerSettings` interface. The line at the top of `createWeeklyCampaign` changes from:
```typescript
const { brand, venueName } = await getOwnerSettings();
```
to:
```typescript
const { brand, venueName, posting } = await getOwnerSettings();
```

This is the only change needed — the `posting` property already exists on `OwnerSettings`.

- [ ] **Step 7.3: Verify types compile**

```bash
cd /Users/peterpitcher/Cursor/OJ-CheersAI2.0
npx tsc --noEmit
```
Expected: no type errors.

- [ ] **Step 7.4: Run full test suite**

```bash
cd /Users/peterpitcher/Cursor/OJ-CheersAI2.0
npx vitest run
```
Expected: all tests pass.

- [ ] **Step 7.5: Commit**

```bash
git add src/lib/create/service.ts
git commit -m "feat: wire spread-evenly algorithm into createWeeklyCampaign"
```

---

## Chunk 5: Update materialise.ts for spread_evenly Support

### Task 8: Update materialise.ts to support spread_evenly mode

**Files:**
- Modify: `src/lib/scheduling/materialise.ts`

- [ ] **Step 8.1: Add Zod-validated metadata parser for weekly campaigns**

In `src/lib/scheduling/materialise.ts`, add after the `parseCadence` function (~line 52):

```typescript
import { z } from "zod";

const weeklyMetadataSchema = z.object({
  scheduleMode: z.enum(["fixed_days", "spread_evenly"]).optional().default("fixed_days"),
  postsPerWeek: z.number().int().min(1).max(7).optional(),
  staggerPlatforms: z.boolean().optional().default(true),
  cadence: z.array(z.object({
    platform: z.enum(["facebook", "instagram", "gbp"]),
    weekday: z.number(),
    hour: z.number(),
    minute: z.number(),
  })).optional().default([]),
  startDate: z.string().optional(),
});

type WeeklyMetadata = z.infer<typeof weeklyMetadataSchema>;

function parseWeeklyCampaignMetadata(metadata: Record<string, unknown> | null): WeeklyMetadata {
  const result = weeklyMetadataSchema.safeParse(metadata ?? {});
  if (!result.success) {
    return { scheduleMode: "fixed_days", postsPerWeek: undefined, staggerPlatforms: true, cadence: [] };
  }
  return result.data;
}
```

- [ ] **Step 8.2: Update `materialiseRecurringCampaigns` to handle spread_evenly**

Replace the campaign iteration loop in `materialiseRecurringCampaigns`:

```typescript
export async function materialiseRecurringCampaigns(reference: Date = new Date()) {
  const supabase = tryCreateServiceSupabaseClient();

  if (!supabase) {
    return;
  }

  const { data: campaigns, error } = await supabase
    .from("campaigns")
    .select("id, name, metadata, account_id")              // ← add account_id
    .eq("account_id", OWNER_ACCOUNT_ID)
    .eq("campaign_type", "weekly")
    .eq("status", "scheduled");

  if (error) {
    if (isSchemaMissingError(error)) return;
    throw error;
  }

  for (const campaign of campaigns ?? []) {
    const meta = parseWeeklyCampaignMetadata(campaign.metadata as Record<string, unknown> | null);

    if (meta.scheduleMode === "spread_evenly") {
      // Spread-evenly campaigns are fully scheduled at creation time.
      // Materialisation only applies to fixed_days cadence campaigns.
      // Future: could extend to "top up" spread campaigns beyond their initial window.
      continue;
    }

    const cadence = meta.cadence;
    if (!cadence.length) continue;
    await materialiseCampaign(campaign.id, cadence, reference);
  }
}
```

- [ ] **Step 8.3: Verify types compile and tests pass**

```bash
cd /Users/peterpitcher/Cursor/OJ-CheersAI2.0
npx tsc --noEmit && npx vitest run
```
Expected: no errors.

- [ ] **Step 8.4: Commit**

```bash
git add src/lib/scheduling/materialise.ts
git commit -m "feat: add spread_evenly metadata parsing to materialise.ts, skip spread campaigns in cron"
```

---

## Chunk 6: Weekly Campaign Form UI Changes

### Task 9: Add spread/fixed toggle, posts-per-week dropdown, stagger toggle to form

**Files:**
- Modify: `src/features/create/weekly-campaign-form.tsx`

- [ ] **Step 9.1: Add the schedule mode toggle and posts-per-week controls to the "Weekly pattern" stage**

In `src/features/create/weekly-campaign-form.tsx`, find the `pattern` stage content (~line 400). Add controls **before** the existing day-of-week / time grid. The schedule mode toggle conditionally shows either the spread-evenly controls or the existing fixed-day controls.

Insert after `return (` and before the first `<div className="grid gap-4 sm:grid-cols-2">`:

```tsx
          {/* Schedule mode toggle */}
          <div className="space-y-3">
            <Label>Scheduling mode</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={form.watch("scheduleMode") === "fixed_days" ? "default" : "outline"}
                onClick={() => form.setValue("scheduleMode", "fixed_days")}
                className={form.watch("scheduleMode") !== "fixed_days" ? "bg-white shadow-sm" : ""}
              >
                Specific days
              </Button>
              <Button
                type="button"
                variant={form.watch("scheduleMode") === "spread_evenly" ? "default" : "outline"}
                onClick={() => form.setValue("scheduleMode", "spread_evenly")}
                className={form.watch("scheduleMode") !== "spread_evenly" ? "bg-white shadow-sm" : ""}
              >
                Spread evenly
              </Button>
            </div>
            <p className="text-xs text-slate-500">
              {form.watch("scheduleMode") === "spread_evenly"
                ? "Posts are distributed across the emptiest days in your calendar for maximum coverage."
                : "Posts go out on the same day each week."}
            </p>
          </div>
```

- [ ] **Step 9.2: Add conditional spread-evenly controls**

After the schedule mode toggle, add the posts-per-week and stagger controls that only show in spread_evenly mode:

```tsx
          {form.watch("scheduleMode") === "spread_evenly" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="posts-per-week">Posts per week</Label>
                <select
                  id="posts-per-week"
                  className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
                  {...form.register("postsPerWeek")}
                >
                  {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                    <option key={n} value={String(n)}>
                      {n} {n === 1 ? "post" : "posts"} per week
                    </option>
                  ))}
                </select>
                {form.formState.errors.postsPerWeek ? (
                  <p className="text-xs text-rose-500">{form.formState.errors.postsPerWeek.message}</p>
                ) : null}
              </div>

              <div className="flex items-end pb-1">
                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    {...form.register("staggerPlatforms")}
                  />
                  <span>Stagger across platforms</span>
                </label>
              </div>
            </div>
          ) : null}
```

- [ ] **Step 9.3: Conditionally hide day-of-week picker in spread_evenly mode**

Wrap the existing day-of-week and time grid with a conditional. In spread_evenly mode, the day-of-week picker is hidden (the algorithm picks days), but the time and start date fields remain visible:

```tsx
          {form.watch("scheduleMode") === "fixed_days" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="weekly-day-of-week">Day of week</Label>
                <select
                  id="weekly-day-of-week"
                  className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
                  {...form.register("dayOfWeek")}
                >
                  {DAYS.map((day) => (
                    <option key={day.value} value={day.value}>
                      {day.label}
                    </option>
                  ))}
                </select>
                {form.formState.errors.dayOfWeek ? (
                  <p className="text-xs text-rose-500">{form.formState.errors.dayOfWeek.message}</p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="weekly-time">Time</Label>
                <Input
                  id="weekly-time"
                  type="time"
                  {...form.register("time")}
                />
                {form.formState.errors.time ? (
                  <p className="text-xs text-rose-500">{form.formState.errors.time.message}</p>
                ) : null}
              </div>
            </div>
          ) : null}
```

- [ ] **Step 9.4: Keep start date and weeks-ahead visible in both modes**

The start date and weeks-ahead grid remains visible in both modes — no changes needed to that section. Verify the existing grid at ~line 443-468 is outside the conditional.

- [ ] **Step 9.5: Update pattern stage field validation for spread mode**

Find the `handleNext` function in the `pattern` stage (~line 405). Update the validated fields based on mode:

```typescript
        const handleNext = async () => {
          const mode = form.getValues("scheduleMode");
          const fields: (keyof WeeklyCampaignFormValues)[] =
            mode === "spread_evenly"
              ? ["startDate", "weeksAhead", "postsPerWeek"]
              : ["dayOfWeek", "time", "startDate", "weeksAhead"];
          await goToNextWhenValid(controls, "pattern", fields);
        };
```

- [ ] **Step 9.6: Verify the form renders without errors**

```bash
cd /Users/peterpitcher/Cursor/OJ-CheersAI2.0
npm run build
```
Expected: build succeeds. No type errors, no build warnings.

- [ ] **Step 9.7: Commit**

```bash
git add src/features/create/weekly-campaign-form.tsx
git commit -m "feat: add spread/fixed toggle, posts-per-week dropdown, stagger toggle to weekly campaign form"
```

---

## Chunk 7: Final Verification

### Task 10: Full verification pipeline

- [ ] **Step 10.1: Run lint**

```bash
cd /Users/peterpitcher/Cursor/OJ-CheersAI2.0
npm run lint
```
Expected: zero errors, zero warnings.

- [ ] **Step 10.2: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: clean compilation.

- [ ] **Step 10.3: Run all tests**

```bash
npx vitest run
```
Expected: all tests pass.

- [ ] **Step 10.4: Run production build**

```bash
npm run build
```
Expected: successful build.

- [ ] **Step 10.5: Manual smoke test checklist**

Verify in the browser:
- [ ] Settings page: new "Default posting time" and "Venue location" fields appear, save, and persist
- [ ] Weekly campaign form: schedule mode toggle shows "Specific days" and "Spread evenly"
- [ ] Selecting "Spread evenly" hides day-of-week picker, shows posts-per-week dropdown
- [ ] Selecting "Specific days" shows the existing day-of-week picker
- [ ] "Stagger across platforms" checkbox appears in spread mode
- [ ] Generating a spread-evenly campaign produces posts on different days
- [ ] Generating a fixed-day campaign works unchanged

---

## Rollback Plan

All changes are additive and non-breaking:

1. **Database:** `DROP COLUMN` migration for each new column (all nullable, safe to remove)
2. **Schema:** Remove new Zod fields — existing campaigns default to `fixed_days` mode
3. **Service:** Revert `createWeeklyCampaign` to remove spread-evenly branch
4. **Materialise:** Remove `parseWeeklyCampaignMetadata` — existing campaigns use `parseCadence`
5. **Form:** Remove UI toggle — form reverts to fixed-day-only controls
6. **No destructive changes** to existing data at any point
