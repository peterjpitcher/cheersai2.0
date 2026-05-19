import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";

import type { EventCampaignInput } from "@/lib/create/schema";

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "https://example.com/key";
process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "supabase-service-role-key";

const { __testables } = await import("@/lib/create/service");

const TZ = "Europe/London";

function buildEventInput(overrides: Partial<EventCampaignInput> = {}): EventCampaignInput {
  // Pick a future date in London — the helper enforces ensureFutureDate so
  // anything in the past gets bumped forward.
  const startDate = DateTime.now().setZone(TZ).plus({ months: 6 }).startOf("day").toJSDate();
  return {
    name: "Quiz Night",
    description: "Friendly pub quiz with prizes for the top three teams.",
    startDate,
    startTime: "19:00",
    timezone: TZ,
    prompt: undefined,
    platforms: ["facebook", "instagram"],
    placements: ["feed"],
    heroMedia: [
      { assetId: "asset-1", mediaType: "image", fileName: "hero.jpg" },
    ],
    ctaUrl: undefined,
    ctaLabel: undefined,
    linkInBioUrl: undefined,
    toneAdjust: "default",
    lengthPreference: "standard",
    includeHashtags: true,
    includeEmojis: true,
    ctaStyle: "default",
    proofPointMode: "off",
    proofPointsSelected: [],
    proofPointIntentTags: [],
    scheduleOffsets: [
      { label: "1 week before", offsetHours: -7 * 24 },
      { label: "2 days to go", offsetHours: -2 * 24 },
      { label: "Event day", offsetHours: 0 },
    ],
    customSchedule: undefined,
    bannerDefaults: undefined,
    ...overrides,
  } as EventCampaignInput;
}

describe("buildEventCampaignPlans", () => {
  describe("with placements ['feed', 'story'] (Issue 1 regression)", () => {
    it("does not throw and produces feed and story plans for each scheduling slot", () => {
      const input = buildEventInput({ placements: ["feed", "story"] });
      const eventStart = DateTime.fromJSDate(input.startDate, { zone: TZ })
        .set({ hour: 19, minute: 0 })
        .toJSDate();

      const plans = __testables.buildEventCampaignPlansForTest({
        input,
        eventStart,
        minimumTime: Date.now() - 1_000,
        advancedOptions: {
          toneAdjust: "default",
          lengthPreference: "standard",
          includeHashtags: true,
          includeEmojis: true,
          ctaStyle: "default",
        },
        basePrompt: "Event name: Quiz Night",
        eventCtaLabel: null,
        defaultPostingTime: null,
      });

      expect(plans.length).toBe(input.scheduleOffsets.length * 2);
      const feedPlans = plans.filter((plan) => plan.placement === "feed");
      const storyPlans = plans.filter((plan) => plan.placement === "story");
      expect(feedPlans.length).toBe(input.scheduleOffsets.length);
      expect(storyPlans.length).toBe(input.scheduleOffsets.length);
    });

    it("produces well-formed VariantPlan objects with required fields populated", () => {
      const input = buildEventInput({ placements: ["feed", "story"] });
      const eventStart = DateTime.fromJSDate(input.startDate, { zone: TZ })
        .set({ hour: 19, minute: 0 })
        .toJSDate();

      const plans = __testables.buildEventCampaignPlansForTest({
        input,
        eventStart,
        minimumTime: Date.now() - 1_000,
        advancedOptions: {
          toneAdjust: "default",
          lengthPreference: "standard",
          includeHashtags: true,
          includeEmojis: true,
          ctaStyle: "default",
        },
        basePrompt: "Event name: Quiz Night",
        eventCtaLabel: null,
        defaultPostingTime: null,
      });

      for (const plan of plans) {
        expect(plan.title).toBeTruthy();
        expect(plan.prompt).toBeTruthy();
        expect(plan.platforms.length).toBeGreaterThan(0);
        expect(plan.scheduledFor).toBeInstanceOf(Date);
        expect(plan.placement === "feed" || plan.placement === "story").toBe(true);
        expect(typeof plan.planIndex).toBe("number");
      }
    });

    it("does not pin story-placement plans even when same calendar day as event", () => {
      const input = buildEventInput({ placements: ["feed", "story"] });
      const eventStart = DateTime.fromJSDate(input.startDate, { zone: TZ })
        .set({ hour: 19, minute: 0 })
        .toJSDate();

      const plans = __testables.buildEventCampaignPlansForTest({
        input,
        eventStart,
        minimumTime: Date.now() - 1_000,
        advancedOptions: {
          toneAdjust: "default",
          lengthPreference: "standard",
          includeHashtags: true,
          includeEmojis: true,
          ctaStyle: "default",
        },
        basePrompt: "Event name: Quiz Night",
        eventCtaLabel: null,
        defaultPostingTime: null,
      });

      // Stories should never have pinned=true even on the event day.
      const storyPlans = plans.filter((p) => p.placement === "story");
      for (const plan of storyPlans) {
        expect(plan.pinned).toBeFalsy();
      }
    });
  });

  describe("Issue 3: stories default to 07:00 in Europe/London", () => {
    it("schedules story plans at 07:00 local time (event-day cadence)", () => {
      const input = buildEventInput({ placements: ["feed", "story"] });
      const eventStart = DateTime.fromJSDate(input.startDate, { zone: TZ })
        .set({ hour: 12, minute: 0 })
        .toJSDate();

      const plans = __testables.buildEventCampaignPlansForTest({
        input,
        eventStart,
        minimumTime: Date.now() - 1_000,
        advancedOptions: {
          toneAdjust: "default",
          lengthPreference: "standard",
          includeHashtags: true,
          includeEmojis: true,
          ctaStyle: "default",
        },
        basePrompt: "Event name: Quiz Night",
        eventCtaLabel: null,
        defaultPostingTime: null,
      });

      const storyPlans = plans.filter((p) => p.placement === "story");
      expect(storyPlans.length).toBeGreaterThan(0);
      for (const plan of storyPlans) {
        const scheduledFor = plan.scheduledFor;
        expect(scheduledFor).toBeInstanceOf(Date);
        const local = DateTime.fromJSDate(scheduledFor!, { zone: TZ });
        expect(local.toFormat("HH:mm")).toBe("07:00");
      }
    });

    it("schedules story plans at 07:00 for manual schedule slots", () => {
      const manualDate = DateTime.now().setZone(TZ).plus({ months: 6 }).set({ hour: 18, minute: 30 }).toJSDate();
      const input = buildEventInput({
        placements: ["feed", "story"],
        customSchedule: [manualDate],
      });
      const eventStart = DateTime.fromJSDate(input.startDate, { zone: TZ })
        .set({ hour: 19, minute: 0 })
        .toJSDate();

      const plans = __testables.buildEventCampaignPlansForTest({
        input,
        eventStart,
        minimumTime: Date.now() - 1_000,
        advancedOptions: {
          toneAdjust: "default",
          lengthPreference: "standard",
          includeHashtags: true,
          includeEmojis: true,
          ctaStyle: "default",
        },
        basePrompt: "Event name: Quiz Night",
        eventCtaLabel: null,
        defaultPostingTime: null,
      });

      // 1 manual slot × 2 placements = 2 plans
      expect(plans.length).toBe(2);
      const storyPlan = plans.find((p) => p.placement === "story");
      expect(storyPlan).toBeDefined();
      const local = DateTime.fromJSDate(storyPlan!.scheduledFor!, { zone: TZ });
      expect(local.toFormat("HH:mm")).toBe("07:00");
    });
  });

  describe("placement distribution", () => {
    it("produces only feed plans when placements is ['feed']", () => {
      const input = buildEventInput({ placements: ["feed"] });
      const eventStart = DateTime.fromJSDate(input.startDate, { zone: TZ })
        .set({ hour: 19, minute: 0 })
        .toJSDate();

      const plans = __testables.buildEventCampaignPlansForTest({
        input,
        eventStart,
        minimumTime: Date.now() - 1_000,
        advancedOptions: {
          toneAdjust: "default",
          lengthPreference: "standard",
          includeHashtags: true,
          includeEmojis: true,
          ctaStyle: "default",
        },
        basePrompt: "Event name: Quiz Night",
        eventCtaLabel: null,
        defaultPostingTime: null,
      });

      expect(plans.every((p) => p.placement === "feed")).toBe(true);
    });

    it("produces only story plans when placements is ['story']", () => {
      const input = buildEventInput({ placements: ["story"] });
      const eventStart = DateTime.fromJSDate(input.startDate, { zone: TZ })
        .set({ hour: 19, minute: 0 })
        .toJSDate();

      const plans = __testables.buildEventCampaignPlansForTest({
        input,
        eventStart,
        minimumTime: Date.now() - 1_000,
        advancedOptions: {
          toneAdjust: "default",
          lengthPreference: "standard",
          includeHashtags: true,
          includeEmojis: true,
          ctaStyle: "default",
        },
        basePrompt: "Event name: Quiz Night",
        eventCtaLabel: null,
        defaultPostingTime: null,
      });

      expect(plans.every((p) => p.placement === "story")).toBe(true);
    });
  });

  describe("timing cue regression: Monday post for Wednesday event", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(DateTime.fromISO("2026-05-17T10:00", { zone: TZ }).toJSDate());
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("does not say 'tomorrow' for a 2-calendar-day gap", () => {
      const eventStart = DateTime.fromISO("2026-05-20T19:00", { zone: TZ }).toJSDate();
      const input = buildEventInput({
        name: "Cash Bingo",
        startDate: DateTime.fromISO("2026-05-20T00:00", { zone: TZ }).toJSDate(),
        startTime: "19:00",
        customSchedule: [DateTime.fromISO("2026-05-18T12:00", { zone: TZ }).toJSDate()],
        placements: ["feed"],
        scheduleOffsets: [{ label: "2 days to go", offsetHours: -2 * 24 }],
      });

      const plans = __testables.buildEventCampaignPlansForTest({
        input,
        eventStart,
        minimumTime: 0,
        advancedOptions: {
          toneAdjust: "default",
          lengthPreference: "standard",
          includeHashtags: true,
          includeEmojis: true,
          ctaStyle: "default",
        },
        basePrompt: "Event name: Cash Bingo",
        eventCtaLabel: null,
        defaultPostingTime: null,
      });

      expect(plans.length).toBeGreaterThan(0);
      for (const plan of plans) {
        expect(plan.prompt.toLowerCase()).not.toContain("tomorrow");
        expect(plan.promptContext?.timingLabel).not.toBe("tomorrow");
      }
    });

    it("computes timing cue per placement when feed and story are both present", () => {
      const eventStart = DateTime.fromISO("2026-05-20T19:00", { zone: TZ }).toJSDate();
      const input = buildEventInput({
        name: "Quiz Night",
        startDate: DateTime.fromISO("2026-05-20T00:00", { zone: TZ }).toJSDate(),
        startTime: "19:00",
        customSchedule: [DateTime.fromISO("2026-05-19T12:00", { zone: TZ }).toJSDate()],
        placements: ["feed", "story"],
        scheduleOffsets: [{ label: "1 day to go", offsetHours: -24 }],
      });

      const plans = __testables.buildEventCampaignPlansForTest({
        input,
        eventStart,
        minimumTime: 0,
        advancedOptions: {
          toneAdjust: "default",
          lengthPreference: "standard",
          includeHashtags: true,
          includeEmojis: true,
          ctaStyle: "default",
        },
        basePrompt: "Event name: Quiz Night",
        eventCtaLabel: null,
        defaultPostingTime: null,
      });

      const feedPlan = plans.find((p) => p.placement === "feed");
      const storyPlan = plans.find((p) => p.placement === "story");
      expect(feedPlan).toBeDefined();
      expect(storyPlan).toBeDefined();

      expect(feedPlan!.promptContext?.timingLabel).toBeTruthy();
      expect(storyPlan!.promptContext?.timingLabel).toBeTruthy();
    });
  });
});
