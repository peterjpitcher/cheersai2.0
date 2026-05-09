# Review Pack: proximity-label-week-fix-impl

**Generated:** 2026-05-09
**Mode:** B (A=Adversarial / B=Code / C=Spec Compliance)
**Project root:** `/Users/peterpitcher/Cursor/OJ-CheersAI2.0/.claude/worktrees/loving-antonelli-8797d7`
**Base ref:** `ce23e71`
**HEAD:** `138179c`
**Diff range:** `ce23e71...HEAD`
**Stats:**  4 files changed, 199 insertions(+), 19 deletions(-)

> This pack is the sole input for reviewers. Do NOT read files outside it unless a specific finding requires verification. If a file not in the pack is needed, mark the finding `Needs verification` and describe what would resolve it.

## Changed Files

```
src/lib/scheduling/proximity-label.ts
supabase/functions/publish-queue/banner-label.ts
tests/lib/scheduling/proximity-label-parity.test.ts
tests/lib/scheduling/proximity-label.test.ts
```

## User Concerns

Reviewing the IMPLEMENTED 4-commit fix for the proximity-label NEXT_SATURDAY bug. Spec at tasks/banner-orchestration/proximity-week-fix/SPEC.md was reviewed adversarially earlier and revised; this is the second-stage review of the resulting code. Target: confirm the week-aware logic is correct, the Node and Deno copies match, and the test coverage is sufficient (DST, year-boundary, parity). Diff covers 4 commits: tests added, parity test, Node fix, Deno fix.

## Diff (`ce23e71...HEAD`)

```diff
diff --git a/src/lib/scheduling/proximity-label.ts b/src/lib/scheduling/proximity-label.ts
index d6dfa19..2b60bf3 100644
--- a/src/lib/scheduling/proximity-label.ts
+++ b/src/lib/scheduling/proximity-label.ts
@@ -3,7 +3,7 @@ import { DateTime } from "luxon";
 import type { CampaignTiming } from "./campaign-timing";
 import { getNextWeeklyOccurrence } from "./campaign-timing";
 
-// Duplicated in supabase/functions/publish-queue/proximity.ts — keep in sync
+// Duplicated in supabase/functions/publish-queue/banner-label.ts — keep in sync
 export type ProximityLabel = string | null;
 
 export interface ProximityLabelInput {
@@ -73,20 +73,25 @@ function getEventLabel(
     return `THIS ${weekdayName}`;
   }
 
-  // 7–13 days → NEXT [WEEKDAY]
-  if (daysDiff >= 7 && daysDiff <= 13) {
+  // 7+ days → use calendar-week difference, not raw days, to disambiguate
+  // "next Saturday" (1 week ahead) from "Saturday week-after-next" (2 weeks ahead).
+  // Luxon's startOf("week") returns Monday 00:00; rounding the diff handles
+  // DST-shortened (23h) and DST-lengthened (25h) weeks correctly.
+  const refWeekStart = refDay.startOf("week");
+  const eventWeekStart = eventDay.startOf("week");
+  const weekDiff = Math.round(
+    eventWeekStart.diff(refWeekStart, "weeks").weeks
+  );
+
+  if (weekDiff === 1) {
     const weekdayName = WEEKDAY_NAMES[targetInTz.weekday];
     return `NEXT ${weekdayName}`;
   }
 
-  // 14+ days → date format e.g. "FRI 19 JUN"
-  if (daysDiff >= 14) {
-    const weekdayShort = WEEKDAY_NAMES[targetInTz.weekday].slice(0, 3);
-    const monthShort = MONTH_SHORT[targetInTz.month - 1];
-    return `${weekdayShort} ${targetInTz.day} ${monthShort}`;
-  }
-
-  return null;
+  // weekDiff >= 2 → unambiguous date format
+  const weekdayShort = WEEKDAY_NAMES[targetInTz.weekday].slice(0, 3);
+  const monthShort = MONTH_SHORT[targetInTz.month - 1];
+  return `${weekdayShort} ${targetInTz.day} ${monthShort}`;
 }
 
 export function getProximityLabel(input: ProximityLabelInput): ProximityLabel {
diff --git a/supabase/functions/publish-queue/banner-label.ts b/supabase/functions/publish-queue/banner-label.ts
index e260ece..e914636 100644
--- a/supabase/functions/publish-queue/banner-label.ts
+++ b/supabase/functions/publish-queue/banner-label.ts
@@ -179,18 +179,21 @@ function getEventLabel(
         return `THIS ${weekdayName}`;
     }
 
-    if (daysDiff >= 7 && daysDiff <= 13) {
+    // 7+ days → use calendar-week difference, not raw days
+    const refWeekStart = refDay.startOf("week");
+    const eventWeekStart = eventDay.startOf("week");
+    const weekDiff = Math.round(
+        eventWeekStart.diff(refWeekStart, "weeks").weeks,
+    );
+
+    if (weekDiff === 1) {
         const weekdayName = WEEKDAY_NAMES[targetInTz.weekday];
         return `NEXT ${weekdayName}`;
     }
 
-    if (daysDiff >= 14) {
-        const weekdayShort = WEEKDAY_NAMES[targetInTz.weekday].slice(0, 3);
-        const monthShort = MONTH_SHORT[targetInTz.month - 1];
-        return `${weekdayShort} ${targetInTz.day} ${monthShort}`;
-    }
-
-    return null;
+    const weekdayShort = WEEKDAY_NAMES[targetInTz.weekday].slice(0, 3);
+    const monthShort = MONTH_SHORT[targetInTz.month - 1];
+    return `${weekdayShort} ${targetInTz.day} ${monthShort}`;
 }
 
 function getPromotionLabel(
diff --git a/tests/lib/scheduling/proximity-label-parity.test.ts b/tests/lib/scheduling/proximity-label-parity.test.ts
new file mode 100644
index 0000000..db3ff60
--- /dev/null
+++ b/tests/lib/scheduling/proximity-label-parity.test.ts
@@ -0,0 +1,87 @@
+// tests/lib/scheduling/proximity-label-parity.test.ts
+//
+// Behavioural parity between the Node copy of getProximityLabel
+// (src/lib/scheduling/proximity-label.ts) and the Deno copy used by the
+// publish-queue worker (supabase/functions/publish-queue/banner-label.ts).
+//
+// Vitest aliases `https://esm.sh/luxon@.*` -> `luxon` in vitest.config.ts:23,
+// so the Deno file imports cleanly under Node's test runtime.
+//
+// This file deliberately does NOT assert the *correct* label for any fixture
+// — that is the responsibility of proximity-label.test.ts. This file only
+// asserts that whatever the two implementations return, they return the
+// same thing. Drift between the duplicated copies is the bug it catches.
+import { describe, expect, it } from "vitest";
+import { DateTime } from "luxon";
+import { getProximityLabel as nodeImpl } from "@/lib/scheduling/proximity-label";
+import {
+  getProximityLabel as denoImpl,
+  type CampaignTiming,
+} from "../../../supabase/functions/publish-queue/banner-label.ts";
+
+const TZ = "Europe/London";
+
+interface Fixture {
+  name: string;
+  ref: string; // ISO
+  campaignType: "event" | "promotion" | "weekly";
+  startAt: string; // ISO
+  endAt?: string; // ISO, promotion only
+  startTime?: string; // "HH:MM"
+  weeklyDayOfWeek?: number;
+}
+
+const FIXTURES: Fixture[] = [
+  // Event — bug regression and band boundaries
+  { name: "bug: Sun → Sat 13d",       ref: "2026-05-10T06:00", campaignType: "event", startAt: "2026-05-23", startTime: "19:00" },
+  { name: "Sat → Sat 14d",            ref: "2026-05-09T10:00", campaignType: "event", startAt: "2026-05-23", startTime: "19:00" },
+  { name: "Sun → Mon 8d",             ref: "2026-05-10T10:00", campaignType: "event", startAt: "2026-05-18", startTime: "19:00" },
+  { name: "Sun → Sat 6d",             ref: "2026-05-10T10:00", campaignType: "event", startAt: "2026-05-16", startTime: "19:00" },
+  { name: "Sat → Sat 7d",             ref: "2026-05-02T10:00", campaignType: "event", startAt: "2026-05-09", startTime: "19:00" },
+  { name: "Fri → Mon 3d cross-week",  ref: "2026-05-08T10:00", campaignType: "event", startAt: "2026-05-11", startTime: "19:00" },
+  { name: "today, evening",           ref: "2026-05-07T08:00", campaignType: "event", startAt: "2026-05-07", startTime: "19:00" },
+  { name: "tomorrow, daytime",        ref: "2026-05-06T10:00", campaignType: "event", startAt: "2026-05-07", startTime: "14:00" },
+  { name: "post-event",               ref: "2026-05-08T10:00", campaignType: "event", startAt: "2026-05-07", startTime: "19:00" },
+  // Event — DST and year boundary
+  { name: "DST spring 7d",            ref: "2026-03-22T10:00", campaignType: "event", startAt: "2026-03-29", startTime: "19:00" },
+  { name: "DST spring 13d",           ref: "2026-03-22T10:00", campaignType: "event", startAt: "2026-04-04", startTime: "19:00" },
+  { name: "DST fall 7d",              ref: "2026-10-18T10:00", campaignType: "event", startAt: "2026-10-25", startTime: "19:00" },
+  { name: "DST fall 13d",             ref: "2026-10-18T10:00", campaignType: "event", startAt: "2026-10-31", startTime: "19:00" },
+  { name: "year boundary 7d",         ref: "2026-12-22T10:00", campaignType: "event", startAt: "2026-12-29", startTime: "19:00" },
+  { name: "year boundary 13d",        ref: "2026-12-22T10:00", campaignType: "event", startAt: "2027-01-04", startTime: "19:00" },
+  // Promotion
+  { name: "promo before start 5d",    ref: "2026-05-05T10:00", campaignType: "promotion", startAt: "2026-05-10", endAt: "2026-05-20" },
+  { name: "promo on first day",       ref: "2026-05-10T10:00", campaignType: "promotion", startAt: "2026-05-10", endAt: "2026-05-20" },
+  { name: "promo mid",                ref: "2026-05-15T10:00", campaignType: "promotion", startAt: "2026-05-10", endAt: "2026-05-20" },
+  { name: "promo end day",            ref: "2026-05-20T10:00", campaignType: "promotion", startAt: "2026-05-10", endAt: "2026-05-20" },
+  { name: "promo ends tomorrow",      ref: "2026-05-19T10:00", campaignType: "promotion", startAt: "2026-05-10", endAt: "2026-05-20" },
+  { name: "promo 4 weeks left",       ref: "2026-05-08T10:00", campaignType: "promotion", startAt: "2026-05-08", endAt: "2026-06-10" },
+  { name: "promo legacy no end",      ref: "2026-05-10T10:00", campaignType: "promotion", startAt: "2026-05-08" },
+  // Weekly
+  { name: "weekly Mon → Thu",         ref: "2026-05-04T10:00", campaignType: "weekly", startAt: "2026-05-04", weeklyDayOfWeek: 4, startTime: "19:00" },
+  { name: "weekly Wed → Thu (1d)",    ref: "2026-05-06T10:00", campaignType: "weekly", startAt: "2026-05-06", weeklyDayOfWeek: 4, startTime: "19:00" },
+  { name: "weekly Fri after Thu",     ref: "2026-05-08T10:00", campaignType: "weekly", startAt: "2026-05-08", weeklyDayOfWeek: 4, startTime: "19:00" },
+];
+
+function buildTiming(f: Fixture): CampaignTiming {
+  return {
+    campaignType: f.campaignType,
+    startAt: DateTime.fromISO(f.startAt, { zone: TZ }),
+    endAt: f.endAt ? DateTime.fromISO(f.endAt, { zone: TZ }) : undefined,
+    startTime: f.startTime,
+    weeklyDayOfWeek: f.weeklyDayOfWeek,
+    timezone: TZ,
+  };
+}
+
+describe("proximity-label parity (Node ↔ Deno worker copy)", () => {
+  for (const f of FIXTURES) {
+    it(`agrees on: ${f.name}`, () => {
+      const referenceAt = DateTime.fromISO(f.ref, { zone: TZ });
+      const timing = buildTiming(f);
+      const nodeResult = nodeImpl({ referenceAt, campaignTiming: timing });
+      const denoResult = denoImpl({ referenceAt, campaignTiming: timing });
+      expect(denoResult).toBe(nodeResult);
+    });
+  }
+});
diff --git a/tests/lib/scheduling/proximity-label.test.ts b/tests/lib/scheduling/proximity-label.test.ts
index 9cacae1..ea79353 100644
--- a/tests/lib/scheduling/proximity-label.test.ts
+++ b/tests/lib/scheduling/proximity-label.test.ts
@@ -293,6 +293,91 @@ describe("getProximityLabel — extended bands", () => {
     });
     expect(result).toBeNull();
   });
+
+  // Wave 1: week-aware proximity-label fix — see PLAN.md Phase 1.
+  // Each of the cases below is RED until the implementation is corrected
+  // in Wave 2 to use Luxon `startOf("week")` calendar-week bucketing.
+
+  it("bug regression: Sun → Sat 13 days returns date format (was NEXT SATURDAY)", () => {
+    // THE BUG. Sun 10 May → Sat 23 May = 13 days, weekDiff = 2 → SAT 23 MAY.
+    const result = getProximityLabel({
+      referenceAt: ref("2026-05-10T06:00:00"),
+      campaignTiming: eventTiming("2026-05-23", "19:00"),
+    });
+    expect(result).toBe("SAT 23 MAY");
+  });
+
+  it("Sat → Sat 14 days exact returns date format (sanity, unchanged)", () => {
+    const result = getProximityLabel({
+      referenceAt: ref("2026-05-09T10:00:00"),
+      campaignTiming: eventTiming("2026-05-23", "19:00"),
+    });
+    expect(result).toBe("SAT 23 MAY");
+  });
+
+  it("Sun → Mon 8 days returns date format (currently NEXT MONDAY — must change)", () => {
+    const result = getProximityLabel({
+      referenceAt: ref("2026-05-10T10:00:00"),
+      campaignTiming: eventTiming("2026-05-18", "19:00"),
+    });
+    expect(result).toBe("MON 18 MAY");
+  });
+
+  it("Sun → Sat 6 days returns THIS SATURDAY (proximity wins, unchanged)", () => {
+    const result = getProximityLabel({
+      referenceAt: ref("2026-05-10T10:00:00"),
+      campaignTiming: eventTiming("2026-05-16", "19:00"),
+    });
+    expect(result).toBe("THIS SATURDAY");
+  });
+
+  it("year boundary 7d: Tue 22 Dec → Tue 29 Dec returns NEXT TUESDAY", () => {
+    const result = getProximityLabel({
+      referenceAt: ref("2026-12-22T10:00:00"),
+      campaignTiming: eventTiming("2026-12-29", "19:00"),
+    });
+    expect(result).toBe("NEXT TUESDAY");
+  });
+
+  it("year boundary 13d: Tue 22 Dec → Mon 4 Jan returns date format across year-end", () => {
+    const result = getProximityLabel({
+      referenceAt: ref("2026-12-22T10:00:00"),
+      campaignTiming: eventTiming("2027-01-04", "19:00"),
+    });
+    expect(result).toBe("MON 4 JAN");
+  });
+
+  it("DST spring-forward 7d: Sun 22 Mar → Sun 29 Mar returns NEXT SUNDAY (23h week)", () => {
+    const result = getProximityLabel({
+      referenceAt: ref("2026-03-22T10:00:00"),
+      campaignTiming: eventTiming("2026-03-29", "19:00"),
+    });
+    expect(result).toBe("NEXT SUNDAY");
+  });
+
+  it("DST spring-forward 13d: Sun 22 Mar → Sat 4 Apr returns date format (spans BST start)", () => {
+    const result = getProximityLabel({
+      referenceAt: ref("2026-03-22T10:00:00"),
+      campaignTiming: eventTiming("2026-04-04", "19:00"),
+    });
+    expect(result).toBe("SAT 4 APR");
+  });
+
+  it("DST fall-back 7d: Sun 18 Oct → Sun 25 Oct returns NEXT SUNDAY (25h week)", () => {
+    const result = getProximityLabel({
+      referenceAt: ref("2026-10-18T10:00:00"),
+      campaignTiming: eventTiming("2026-10-25", "19:00"),
+    });
+    expect(result).toBe("NEXT SUNDAY");
+  });
+
+  it("DST fall-back 13d: Sun 18 Oct → Sat 31 Oct returns date format (spans GMT start)", () => {
+    const result = getProximityLabel({
+      referenceAt: ref("2026-10-18T10:00:00"),
+      campaignTiming: eventTiming("2026-10-31", "19:00"),
+    });
+    expect(result).toBe("SAT 31 OCT");
+  });
 });
 
 describe("getProximityLabel — weekly campaigns", () => {
```

## Changed File Contents

### `src/lib/scheduling/proximity-label.ts`

```
// src/lib/scheduling/proximity-label.ts
import { DateTime } from "luxon";
import type { CampaignTiming } from "./campaign-timing";
import { getNextWeeklyOccurrence } from "./campaign-timing";

// Duplicated in supabase/functions/publish-queue/banner-label.ts — keep in sync
export type ProximityLabel = string | null;

export interface ProximityLabelInput {
  referenceAt: DateTime;
  campaignTiming: CampaignTiming;
}

const EVENING_THRESHOLD_HOUR = 17;

const WEEKDAY_NAMES = [
  "", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY",
];

const MONTH_SHORT = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

function isEvening(startTime?: string): boolean {
  if (!startTime) return false;
  const hour = parseInt(startTime.split(":")[0], 10);
  return hour >= EVENING_THRESHOLD_HOUR;
}

function getEventStartTimestamp(
  eventDate: DateTime,
  startTime: string | undefined,
  timezone: string
): DateTime {
  if (!startTime) {
    // No start time — use end of day as the "event start" for post-event comparison
    return eventDate.setZone(timezone).endOf("day");
  }
  const [h, m] = startTime.split(":").map(Number);
  return eventDate.setZone(timezone).set({ hour: h, minute: m, second: 0, millisecond: 0 });
}

function getEventLabel(
  referenceAt: DateTime,
  timing: CampaignTiming
): ProximityLabel {
  const tz = timing.timezone;
  const refDay = referenceAt.setZone(tz).startOf("day");
  const eventDay = timing.startAt.setZone(tz).startOf("day");

  // Post-event check: compare against full timestamp
  const eventTimestamp = getEventStartTimestamp(timing.startAt, timing.startTime, tz);
  if (referenceAt >= eventTimestamp) {
    return null;
  }

  const daysDiff = eventDay.diff(refDay, "days").days;

  if (daysDiff <= 0) {
    // Same day
    return isEvening(timing.startTime) ? "TONIGHT" : "TODAY";
  }

  if (daysDiff === 1) {
    return isEvening(timing.startTime) ? "TOMORROW NIGHT" : "TOMORROW";
  }

  const targetInTz = timing.startAt.setZone(tz);

  if (daysDiff >= 2 && daysDiff <= 6) {
    const weekdayName = WEEKDAY_NAMES[targetInTz.weekday];
    return `THIS ${weekdayName}`;
  }

  // 7+ days → use calendar-week difference, not raw days, to disambiguate
  // "next Saturday" (1 week ahead) from "Saturday week-after-next" (2 weeks ahead).
  // Luxon's startOf("week") returns Monday 00:00; rounding the diff handles
  // DST-shortened (23h) and DST-lengthened (25h) weeks correctly.
  const refWeekStart = refDay.startOf("week");
  const eventWeekStart = eventDay.startOf("week");
  const weekDiff = Math.round(
    eventWeekStart.diff(refWeekStart, "weeks").weeks
  );

  if (weekDiff === 1) {
    const weekdayName = WEEKDAY_NAMES[targetInTz.weekday];
    return `NEXT ${weekdayName}`;
  }

  // weekDiff >= 2 → unambiguous date format
  const weekdayShort = WEEKDAY_NAMES[targetInTz.weekday].slice(0, 3);
  const monthShort = MONTH_SHORT[targetInTz.month - 1];
  return `${weekdayShort} ${targetInTz.day} ${monthShort}`;
}

export function getProximityLabel(input: ProximityLabelInput): ProximityLabel {
  const { referenceAt, campaignTiming } = input;

  switch (campaignTiming.campaignType) {
    case "event":
      return getEventLabel(referenceAt, campaignTiming);

    case "weekly": {
      if (!campaignTiming.weeklyDayOfWeek) return null;
      const nextOccurrence = getNextWeeklyOccurrence(
        referenceAt,
        campaignTiming.weeklyDayOfWeek,
        campaignTiming.timezone
      );
      const weeklyTiming: CampaignTiming = {
        ...campaignTiming,
        campaignType: "event",
        startAt: nextOccurrence,
      };
      return getEventLabel(referenceAt, weeklyTiming);
    }

    case "promotion":
      return getPromotionLabel(referenceAt, campaignTiming);

    default:
      return null;
  }
}

function getPromotionLabel(
  referenceAt: DateTime,
  timing: CampaignTiming
): ProximityLabel {
  const tz = timing.timezone;
  const refDay = referenceAt.setZone(tz).startOf("day");
  const startDay = timing.startAt.setZone(tz).startOf("day");

  // End-of-day semantics for endAt
  const endDay = timing.endAt
    ? timing.endAt.setZone(tz).startOf("day")
    : undefined;
  const endEOD = endDay
    ? endDay.endOf("day")
    : undefined;

  // After promotion ended
  if (endEOD && referenceAt > endEOD) {
    return null;
  }

  // During promotion (referenceAt >= startAt)
  if (referenceAt >= timing.startAt.setZone(tz).startOf("day")) {
    if (!endDay) return "ON NOW";

    const daysToEnd = endDay.diff(refDay, "days").days;

    if (daysToEnd <= 0) return "LAST DAY";
    if (daysToEnd === 1) return "ENDS TOMORROW";
    if (daysToEnd >= 2 && daysToEnd <= 6) return `${daysToEnd} DAYS LEFT`;

    const weeksToEnd = Math.floor(daysToEnd / 7);
    return `${weeksToEnd} ${weeksToEnd === 1 ? "WEEK" : "WEEKS"} LEFT`;
  }

  // Before promotion start — use event-style logic against startAt
  const daysDiff = startDay.diff(refDay, "days").days;

  if (daysDiff <= 0) return "TODAY";
  if (daysDiff === 1) return "TOMORROW";
  if (daysDiff >= 2 && daysDiff <= 6) {
    const weekdayName = WEEKDAY_NAMES[startDay.weekday];
    return `THIS ${weekdayName}`;
  }

  return null; // 7+ days before start
}
```

### `supabase/functions/publish-queue/banner-label.ts`

```
// supabase/functions/publish-queue/banner-label.ts
//
// DUPLICATED from src/lib/scheduling/campaign-timing.ts and
// src/lib/scheduling/proximity-label.ts because Deno cannot resolve the
// `@/...` alias used in Node code. Keep the timing extraction and label
// derivation logic in sync with the canonical sources in src/lib/scheduling/.
// The same intentional-duplication pattern is already used by
// supabase/functions/materialise-weekly/utils.ts.

import { DateTime } from "https://esm.sh/luxon@3.7.2";

const DEFAULT_TZ = "Europe/London";

/**
 * Convert a JS getDay() weekday (0=Sunday..6=Saturday) — the format used by
 * weekly campaign metadata — into a Luxon weekday (1=Monday..7=Sunday).
 * Falls back to 1 (Monday) for non-numeric input. Mirrors
 * src/lib/scheduling/campaign-timing.ts:jsDayToLuxonWeekday — keep in sync.
 */
function jsDayToLuxonWeekday(value: unknown): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return 1;
    if (n < 0 || n > 6) return 1;
    return n === 0 ? 7 : n;
}

export interface CampaignTiming {
    campaignType: "event" | "promotion" | "weekly";
    startAt: DateTime;
    endAt?: DateTime;
    startTime?: string; // "HH:MM"
    weeklyDayOfWeek?: number; // 1=Mon..7=Sun (Luxon weekday)
    timezone: string;
}

/**
 * Extract canonical timing from a campaign's metadata.
 * Handles both current metadata shapes and legacy eventStart ISO strings.
 */
export function extractCampaignTiming(campaign: {
    campaign_type: string;
    metadata: unknown;
}): CampaignTiming {
    const meta = (campaign.metadata ?? {}) as Record<string, unknown>;
    const tz = DEFAULT_TZ;

    if (campaign.campaign_type === "weekly") {
        // metadata.dayOfWeek is JS getDay() (0=Sun..6=Sat). Translate to
        // Luxon weekday (1=Mon..7=Sun) so getNextWeeklyOccurrence works.
        return {
            campaignType: "weekly",
            startAt: DateTime.now().setZone(tz),
            weeklyDayOfWeek: jsDayToLuxonWeekday(meta.dayOfWeek),
            startTime: typeof meta.time === "string" ? meta.time : undefined,
            timezone: tz,
        };
    }

    let startAt: DateTime;
    if (typeof meta.startDate === "string") {
        startAt = DateTime.fromISO(meta.startDate, { zone: tz });
    } else if (typeof meta.eventStart === "string") {
        startAt = DateTime.fromISO(meta.eventStart, { zone: tz });
    } else {
        startAt = DateTime.now().setZone(tz);
    }

    let startTime: string | undefined;
    if (typeof meta.startTime === "string") {
        startTime = meta.startTime;
    } else if (typeof meta.eventStart === "string") {
        const parsed = DateTime.fromISO(meta.eventStart, { zone: tz });
        if (parsed.isValid) {
            startTime = parsed.toFormat("HH:mm");
        }
    }

    if (campaign.campaign_type === "promotion") {
        const endAt = typeof meta.endDate === "string"
            ? DateTime.fromISO(meta.endDate, { zone: tz })
            : undefined;

        return {
            campaignType: "promotion",
            startAt,
            endAt,
            startTime,
            timezone: tz,
        };
    }

    return {
        campaignType: "event",
        startAt,
        startTime,
        timezone: tz,
    };
}

export function getNextWeeklyOccurrence(
    referenceAt: DateTime,
    dayOfWeek: number,
    timezone: string,
): DateTime {
    const ref = referenceAt.setZone(timezone).startOf("day");
    const currentWeekday = ref.weekday;

    let daysUntil = dayOfWeek - currentWeekday;
    if (daysUntil < 0) {
        daysUntil += 7;
    }

    return ref.plus({ days: daysUntil });
}

export type ProximityLabel = string | null;

export interface ProximityLabelInput {
    referenceAt: DateTime;
    campaignTiming: CampaignTiming;
}

const EVENING_THRESHOLD_HOUR = 17;

const WEEKDAY_NAMES = [
    "", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY",
];

const MONTH_SHORT = [
    "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
    "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

function isEvening(startTime?: string): boolean {
    if (!startTime) return false;
    const hour = parseInt(startTime.split(":")[0], 10);
    return hour >= EVENING_THRESHOLD_HOUR;
}

function getEventStartTimestamp(
    eventDate: DateTime,
    startTime: string | undefined,
    timezone: string,
): DateTime {
    if (!startTime) {
        return eventDate.setZone(timezone).endOf("day");
    }
    const [h, m] = startTime.split(":").map(Number);
    return eventDate.setZone(timezone).set({ hour: h, minute: m, second: 0, millisecond: 0 });
}

function getEventLabel(
    referenceAt: DateTime,
    timing: CampaignTiming,
): ProximityLabel {
    const tz = timing.timezone;
    const refDay = referenceAt.setZone(tz).startOf("day");
    const eventDay = timing.startAt.setZone(tz).startOf("day");

    const eventTimestamp = getEventStartTimestamp(timing.startAt, timing.startTime, tz);
    if (referenceAt >= eventTimestamp) {
        return null;
    }

    const daysDiff = eventDay.diff(refDay, "days").days;

    if (daysDiff <= 0) {
        return isEvening(timing.startTime) ? "TONIGHT" : "TODAY";
    }

    if (daysDiff === 1) {
        return isEvening(timing.startTime) ? "TOMORROW NIGHT" : "TOMORROW";
    }

    const targetInTz = timing.startAt.setZone(tz);

    if (daysDiff >= 2 && daysDiff <= 6) {
        const weekdayName = WEEKDAY_NAMES[targetInTz.weekday];
        return `THIS ${weekdayName}`;
    }

    // 7+ days → use calendar-week difference, not raw days
    const refWeekStart = refDay.startOf("week");
    const eventWeekStart = eventDay.startOf("week");
    const weekDiff = Math.round(
        eventWeekStart.diff(refWeekStart, "weeks").weeks,
    );

    if (weekDiff === 1) {
        const weekdayName = WEEKDAY_NAMES[targetInTz.weekday];
        return `NEXT ${weekdayName}`;
    }

    const weekdayShort = WEEKDAY_NAMES[targetInTz.weekday].slice(0, 3);
    const monthShort = MONTH_SHORT[targetInTz.month - 1];
    return `${weekdayShort} ${targetInTz.day} ${monthShort}`;
}

function getPromotionLabel(
    referenceAt: DateTime,

[truncated at line 200 — original has 271 lines]
```

### `tests/lib/scheduling/proximity-label-parity.test.ts`

```
// tests/lib/scheduling/proximity-label-parity.test.ts
//
// Behavioural parity between the Node copy of getProximityLabel
// (src/lib/scheduling/proximity-label.ts) and the Deno copy used by the
// publish-queue worker (supabase/functions/publish-queue/banner-label.ts).
//
// Vitest aliases `https://esm.sh/luxon@.*` -> `luxon` in vitest.config.ts:23,
// so the Deno file imports cleanly under Node's test runtime.
//
// This file deliberately does NOT assert the *correct* label for any fixture
// — that is the responsibility of proximity-label.test.ts. This file only
// asserts that whatever the two implementations return, they return the
// same thing. Drift between the duplicated copies is the bug it catches.
import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { getProximityLabel as nodeImpl } from "@/lib/scheduling/proximity-label";
import {
  getProximityLabel as denoImpl,
  type CampaignTiming,
} from "../../../supabase/functions/publish-queue/banner-label.ts";

const TZ = "Europe/London";

interface Fixture {
  name: string;
  ref: string; // ISO
  campaignType: "event" | "promotion" | "weekly";
  startAt: string; // ISO
  endAt?: string; // ISO, promotion only
  startTime?: string; // "HH:MM"
  weeklyDayOfWeek?: number;
}

const FIXTURES: Fixture[] = [
  // Event — bug regression and band boundaries
  { name: "bug: Sun → Sat 13d",       ref: "2026-05-10T06:00", campaignType: "event", startAt: "2026-05-23", startTime: "19:00" },
  { name: "Sat → Sat 14d",            ref: "2026-05-09T10:00", campaignType: "event", startAt: "2026-05-23", startTime: "19:00" },
  { name: "Sun → Mon 8d",             ref: "2026-05-10T10:00", campaignType: "event", startAt: "2026-05-18", startTime: "19:00" },
  { name: "Sun → Sat 6d",             ref: "2026-05-10T10:00", campaignType: "event", startAt: "2026-05-16", startTime: "19:00" },
  { name: "Sat → Sat 7d",             ref: "2026-05-02T10:00", campaignType: "event", startAt: "2026-05-09", startTime: "19:00" },
  { name: "Fri → Mon 3d cross-week",  ref: "2026-05-08T10:00", campaignType: "event", startAt: "2026-05-11", startTime: "19:00" },
  { name: "today, evening",           ref: "2026-05-07T08:00", campaignType: "event", startAt: "2026-05-07", startTime: "19:00" },
  { name: "tomorrow, daytime",        ref: "2026-05-06T10:00", campaignType: "event", startAt: "2026-05-07", startTime: "14:00" },
  { name: "post-event",               ref: "2026-05-08T10:00", campaignType: "event", startAt: "2026-05-07", startTime: "19:00" },
  // Event — DST and year boundary
  { name: "DST spring 7d",            ref: "2026-03-22T10:00", campaignType: "event", startAt: "2026-03-29", startTime: "19:00" },
  { name: "DST spring 13d",           ref: "2026-03-22T10:00", campaignType: "event", startAt: "2026-04-04", startTime: "19:00" },
  { name: "DST fall 7d",              ref: "2026-10-18T10:00", campaignType: "event", startAt: "2026-10-25", startTime: "19:00" },
  { name: "DST fall 13d",             ref: "2026-10-18T10:00", campaignType: "event", startAt: "2026-10-31", startTime: "19:00" },
  { name: "year boundary 7d",         ref: "2026-12-22T10:00", campaignType: "event", startAt: "2026-12-29", startTime: "19:00" },
  { name: "year boundary 13d",        ref: "2026-12-22T10:00", campaignType: "event", startAt: "2027-01-04", startTime: "19:00" },
  // Promotion
  { name: "promo before start 5d",    ref: "2026-05-05T10:00", campaignType: "promotion", startAt: "2026-05-10", endAt: "2026-05-20" },
  { name: "promo on first day",       ref: "2026-05-10T10:00", campaignType: "promotion", startAt: "2026-05-10", endAt: "2026-05-20" },
  { name: "promo mid",                ref: "2026-05-15T10:00", campaignType: "promotion", startAt: "2026-05-10", endAt: "2026-05-20" },
  { name: "promo end day",            ref: "2026-05-20T10:00", campaignType: "promotion", startAt: "2026-05-10", endAt: "2026-05-20" },
  { name: "promo ends tomorrow",      ref: "2026-05-19T10:00", campaignType: "promotion", startAt: "2026-05-10", endAt: "2026-05-20" },
  { name: "promo 4 weeks left",       ref: "2026-05-08T10:00", campaignType: "promotion", startAt: "2026-05-08", endAt: "2026-06-10" },
  { name: "promo legacy no end",      ref: "2026-05-10T10:00", campaignType: "promotion", startAt: "2026-05-08" },
  // Weekly
  { name: "weekly Mon → Thu",         ref: "2026-05-04T10:00", campaignType: "weekly", startAt: "2026-05-04", weeklyDayOfWeek: 4, startTime: "19:00" },
  { name: "weekly Wed → Thu (1d)",    ref: "2026-05-06T10:00", campaignType: "weekly", startAt: "2026-05-06", weeklyDayOfWeek: 4, startTime: "19:00" },
  { name: "weekly Fri after Thu",     ref: "2026-05-08T10:00", campaignType: "weekly", startAt: "2026-05-08", weeklyDayOfWeek: 4, startTime: "19:00" },
];

function buildTiming(f: Fixture): CampaignTiming {
  return {
    campaignType: f.campaignType,
    startAt: DateTime.fromISO(f.startAt, { zone: TZ }),
    endAt: f.endAt ? DateTime.fromISO(f.endAt, { zone: TZ }) : undefined,
    startTime: f.startTime,
    weeklyDayOfWeek: f.weeklyDayOfWeek,
    timezone: TZ,
  };
}

describe("proximity-label parity (Node ↔ Deno worker copy)", () => {
  for (const f of FIXTURES) {
    it(`agrees on: ${f.name}`, () => {
      const referenceAt = DateTime.fromISO(f.ref, { zone: TZ });
      const timing = buildTiming(f);
      const nodeResult = nodeImpl({ referenceAt, campaignTiming: timing });
      const denoResult = denoImpl({ referenceAt, campaignTiming: timing });
      expect(denoResult).toBe(nodeResult);
    });
  }
});
```

### `tests/lib/scheduling/proximity-label.test.ts`

```
// tests/lib/scheduling/proximity-label.test.ts
import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { getProximityLabel } from "@/lib/scheduling/proximity-label";
import type { CampaignTiming } from "@/lib/scheduling/campaign-timing";

const TZ = "Europe/London";

function eventTiming(date: string, time?: string): CampaignTiming {
  return {
    campaignType: "event",
    startAt: DateTime.fromISO(date, { zone: TZ }),
    startTime: time,
    timezone: TZ,
  };
}

function ref(iso: string): DateTime {
  return DateTime.fromISO(iso, { zone: TZ });
}

describe("getProximityLabel — event campaigns", () => {
  it("should return NEXT {WEEKDAY} for 7 days before event", () => {
    // Extended in Wave 1: 7–13 days now produces NEXT [WEEKDAY] instead of null.
    const result = getProximityLabel({
      referenceAt: ref("2026-05-01T10:00:00"), // Friday
      campaignTiming: eventTiming("2026-05-08", "19:00"), // Friday +7
    });
    expect(result).toBe("NEXT FRIDAY");
  });

  it("should return THIS {WEEKDAY} for 6 days before", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-01T10:00:00"), // Friday
      campaignTiming: eventTiming("2026-05-07", "19:00"), // Thursday
    });
    expect(result).toBe("THIS THURSDAY");
  });

  it("should return THIS {WEEKDAY} for 2 days before", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-05T10:00:00"), // Tuesday
      campaignTiming: eventTiming("2026-05-07", "19:00"), // Thursday
    });
    expect(result).toBe("THIS THURSDAY");
  });

  it("should return THIS MONDAY for Friday→Monday (3 days, cross-week)", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-08T10:00:00"), // Friday
      campaignTiming: eventTiming("2026-05-11", "19:00"), // Monday
    });
    expect(result).toBe("THIS MONDAY");
  });

  it("should return NEXT SATURDAY for Saturday→Saturday (7 days)", () => {
    // Extended in Wave 1: same-weekday-7-days resolves to NEXT [WEEKDAY], not null.
    const result = getProximityLabel({
      referenceAt: ref("2026-05-02T10:00:00"), // Saturday
      campaignTiming: eventTiming("2026-05-09", "19:00"), // next Saturday
    });
    expect(result).toBe("NEXT SATURDAY");
  });

  it("should return TOMORROW for 1 day before, daytime event", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-06T10:00:00"),
      campaignTiming: eventTiming("2026-05-07", "14:00"),
    });
    expect(result).toBe("TOMORROW");
  });

  it("should return TOMORROW NIGHT for 1 day before, evening event", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-06T10:00:00"),
      campaignTiming: eventTiming("2026-05-07", "19:00"),
    });
    expect(result).toBe("TOMORROW NIGHT");
  });

  it("should return TODAY for same day, daytime event", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-07T08:00:00"),
      campaignTiming: eventTiming("2026-05-07", "14:00"),
    });
    expect(result).toBe("TODAY");
  });

  it("should return TONIGHT for same day, evening event", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-07T08:00:00"),
      campaignTiming: eventTiming("2026-05-07", "19:00"),
    });
    expect(result).toBe("TONIGHT");
  });

  it("should return TODAY when no start time specified", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-07T08:00:00"),
      campaignTiming: eventTiming("2026-05-07"),
    });
    expect(result).toBe("TODAY");
  });

  it("should return TOMORROW when no start time, 1 day before", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-06T10:00:00"),
      campaignTiming: eventTiming("2026-05-07"),
    });
    expect(result).toBe("TOMORROW");
  });

  it("should return null for post after event start timestamp", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-07T20:00:00"),
      campaignTiming: eventTiming("2026-05-07", "19:00"),
    });
    expect(result).toBeNull();
  });

  it("should return null for post day after event", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-08T10:00:00"),
      campaignTiming: eventTiming("2026-05-07", "19:00"),
    });
    expect(result).toBeNull();
  });
});

function promoTiming(start: string, end: string): CampaignTiming {
  return {
    campaignType: "promotion",
    startAt: DateTime.fromISO(start, { zone: TZ }),
    endAt: DateTime.fromISO(end, { zone: TZ }),
    timezone: TZ,
  };
}

function weeklyTiming(dayOfWeek: number, time?: string): CampaignTiming {
  return {
    campaignType: "weekly",
    startAt: DateTime.now().setZone(TZ),
    weeklyDayOfWeek: dayOfWeek,
    startTime: time,
    timezone: TZ,
  };
}

describe("getProximityLabel — promotion campaigns", () => {
  it("should return null before start, 7+ days out", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-01T10:00:00"),
      campaignTiming: promoTiming("2026-05-09", "2026-05-20"),
    });
    expect(result).toBeNull();
  });

  it("should return THIS {WEEKDAY} before start, 2-6 days", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-05T10:00:00"), // Tuesday
      campaignTiming: promoTiming("2026-05-08", "2026-05-20"), // starts Friday
    });
    expect(result).toBe("THIS FRIDAY");
  });

  it("should return TOMORROW before start, 1 day", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-07T10:00:00"),
      campaignTiming: promoTiming("2026-05-08", "2026-05-20"),
    });
    expect(result).toBe("TOMORROW");
  });

  it("should return WEEKS LEFT on start day when end is 7+ days away", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-08T10:00:00"),
      campaignTiming: promoTiming("2026-05-08", "2026-06-10"),
    });
    expect(result).toBe("4 WEEKS LEFT");
  });

  it("should return WEEKS LEFT during promotion when end is 7+ days away", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-10T10:00:00"),
      campaignTiming: promoTiming("2026-05-08", "2026-05-20"),
    });
    expect(result).toBe("1 WEEK LEFT");
  });

  it("should floor partial weeks for manager special countdowns", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-09T10:00:00"),
      campaignTiming: promoTiming("2026-05-01", "2026-05-31"),
    });
    expect(result).toBe("3 WEEKS LEFT");
  });

  it("should return DAYS LEFT during, end 2-6 days", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-18T10:00:00"),

[truncated at line 200 — original has 418 lines]
```

## Related Files (grep hints)

These files reference the basenames of changed files. They are hints for verification — not included inline. Read them only if a specific finding requires it.

```
.superpowers/brainstorm/47462-1777194875/state/server.log
.superpowers/brainstorm/85876-1777191999/state/server.log
docs/superpowers/plans/2026-04-26-proximity-banners.md
docs/superpowers/plans/2026-04-27-banner-overlay-redesign.md
docs/superpowers/plans/2026-05-07-banner-overlay-consistency.md
docs/superpowers/plans/2026-05-07-drop-story-series.md
docs/superpowers/specs/2026-04-26-proximity-banners-design.md
docs/superpowers/specs/2026-05-07-banner-overlay-consistency-design.md
docs/superpowers/specs/2026-05-07-drop-story-series-design.md
src/features/planner/planner-content-composer.tsx
```

## Project Conventions (`CLAUDE.md`)

```markdown
# CLAUDE.md — CheersAI 2.0

This file provides project-specific guidance. See the workspace-level `CLAUDE.md` one directory up for shared conventions.

## Quick Profile

- **Framework**: Next.js 16.1, React 19.2
- **Test runner**: Vitest
- **Database**: Supabase (PostgreSQL + RLS)
- **Key integrations**: OpenAI, Resend Email, Framer Motion animations, React Query, Social media APIs (Instagram, Facebook, Google My Business)
- **Size**: ~158 files in src/

## Commands

```bash
npm run dev              # Start development server
npm run build            # Production build
npm run start            # Start production server
npm run lint             # ESLint check (max-warnings=0 in CI)
npm run test             # Vitest run (single pass)
npm run test:watch       # Vitest watch mode
npm run typecheck        # TypeScript check (tsc --noEmit)
npm run ci:verify        # Full CI pipeline: lint + typecheck + test + build
npm run ops:*            # Operational scripts (backfill, link-auth, regenerate derivatives)
```

## Architecture

**Route Structure**: App Router with next.js 16 conventions. Key sections:
- `/auth` — Sign in, sign up, password reset (Supabase JWT + cookies)
- `/dashboard` — Main workspace for authenticated users
- `/api/` — Webhooks and integrations (Instagram, Facebook callbacks)

**Auth**: Supabase Auth with JWT + HTTP-only cookies. Auth context in `src/lib/auth/` provides user state and permissions. All server actions re-verify auth server-side.

**Database**: Supabase PostgreSQL with RLS enabled. Service-role operations for system tasks only (backfills, crons). Client operations use anon-key client.

**Key Integrations**:
- **OpenAI**: `src/lib/` — content generation and AI features
- **Social APIs**: Instagram (webhooks), Facebook (Graph API), Google My Business integrations
- **Resend**: Email notifications and transactional email
- **React Query**: Data fetching with custom hooks in `src/lib/`
- **Framer Motion**: Page transitions and animations

**Data Flow**: Server actions handle mutations (auth, content operations). Client components use React Query for fetching. All responses validated with Zod.

## Key Files

| Path | Purpose |
|------|---------|
| `src/types/` | TypeScript definitions (database, API contracts) |
| `src/lib/auth/` | Authentication, server-side auth helpers, rate limiting |
| `src/lib/publishing/` | Publishing queue and preflight checks |
| `src/lib/scheduling/` | Event conflict detection, scheduling logic |
| `src/lib/planner/` | Data fetching for planner features |
| `src/lib/settings/` | Settings data and user preferences |
| `src/env.ts` | Environment variable validation (Zod) |
| `src/app/api/` | Webhooks (Instagram, Facebook, email) |
| `src/features/` | Feature-specific components and logic |
| `supabase/migrations/` | Database schema migrations |
| `vitest.config.ts` | Vitest configuration |

## Environment Variables

| Var | Purpose |
|-----|---------|
| `OPENAI_API_KEY` | OpenAI API key for content generation |
| `RESEND_API_KEY` | Resend email service key |
| `RESEND_FROM` | Email sender address |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (server-only) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (public) |
| `NEXT_PUBLIC_SITE_URL` | App base URL for redirects/links |
| `FACEBOOK_APP_ID` | Facebook app ID (public) |
| `FACEBOOK_APP_SECRET` | Facebook app secret (server-only) |
| `INSTAGRAM_APP_ID` | Instagram app ID (public) |
| `INSTAGRAM_APP_SECRET` | Instagram app secret (server-only) |
| `INSTAGRAM_VERIFY_TOKEN` | Instagram webhook verification token |
| `GOOGLE_MY_BUSINESS_CLIENT_ID` | Google My Business OAuth client ID |
| `GOOGLE_MY_BUSINESS_CLIENT_SECRET` | Google My Business OAuth secret |
| `ALERTS_SECRET` | Internal webhook secret for alerts |
| `CRON_SECRET` | Internal webhook secret for cron jobs |
| `ENABLE_CONNECTION_DIAGNOSTICS` | Enable debug logging for integrations |
| `VERCEL_OIDC_TOKEN` | Vercel deployment OIDC (for Vercel functions) |

## Project-Specific Rules / Gotchas

### Env Validation
- `src/env.ts` uses Zod to validate all environment variables at startup
- Missing required vars will throw at build/start time
- Always add new vars to `src/env.ts` before using in code

### Social Media Integrations
- Instagram, Facebook, Google My Business require OAuth tokens and refresh logic
- Webhook verification tokens must match config exactly
- Rate limits enforced per platform — check `src/lib/auth/rate-limit.ts`

### Publishing Queue
- `src/lib/publishing/preflight.ts` validates posts before scheduling
- `src/lib/publishing/queue.ts` manages async publishing
- Always check preflight results before queuing posts

### Scheduling Logic
- `src/lib/scheduling/conflicts.ts` prevents double-booking
- `src/lib/scheduling/materialise.ts` expands recurring events
- Timezone handling uses Luxon library (see workspace CLAUDE.md)

### Testing with Vitest
- Test files coexist with source: `src/**/*.test.ts(x)`
- Mock external services (OpenAI, Resend, Supabase)
- Use factories for test data, not inline object literals
- Minimum 80% coverage on business logic

### Framer Motion Usage
- Used for page transitions and micro-interactions
- Keep animations performant (prefer transform, opacity)
- Test animations disabled in unit tests

### Supabase RLS
- All queries respect RLS — use service-role only for system operations
- Service-role operations documented with comments: `// admin operation: [reason]`
- Never disable RLS "temporarily"

### Resend Email
- All transactional email goes through Resend
- Email templates should be tested with `RESEND_API_KEY` set
- From address format: `"Name (email@domain)"`

### Operational Scripts
- `ops:backfill-connections` — sync social connections
- `ops:backfill-link-in-bio-url` — update profile links
- `ops:link-auth-user` — link Supabase auth to business profile
- `ops:regenerate-story-derivatives` — rebuild cached story variants
- Run in test environment first, then production with caution

### CI Pipeline
- `npm run ci:verify` runs full suite: lint → typecheck → test → build
- All four steps must pass before merge
- No console warnings allowed in CI

### Next.js 16 Specifics
- Using latest App Router patterns
- Server actions with 'use server' directive
- Streaming responses supported but not heavily used
- Build optimization enabled by default
```

---

_End of pack._
