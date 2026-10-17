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
import {
  getProximityLabel as nodeImpl,
  getStoryBookingPrompt as nodeStoryPrompt,
  type StoryBookingPromptInput,
} from "@/lib/scheduling/proximity-label";
import { MAX_STORY_PROMPT_LENGTH as NODE_MAX_STORY_PROMPT_LENGTH } from "@/lib/banner/text";
import {
  getProximityLabel as denoImpl,
  getStoryBookingPrompt as denoStoryPrompt,
  MAX_STORY_PROMPT_LENGTH as DENO_MAX_STORY_PROMPT_LENGTH,
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
  { name: "weekly Thu post-event 20:00", ref: "2026-05-07T20:00", campaignType: "weekly", startAt: "2026-05-07", weeklyDayOfWeek: 4, startTime: "19:00" },
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

// The story booking prompt is duplicated the same way: the planner previews
// the Node copy and the worker publishes the Deno copy.
const BOOKING_LINKS = {
  brief: { ctaLinks: { facebook: "https://l.example.pub/fb1", instagram: "https://l.example.pub/ig1" } },
};

const STORY_PROMPT_FIXTURES: Array<{ name: string; input: StoryBookingPromptInput }> = [
  { name: "facebook event story, website", input: { platform: "facebook", placement: "story", campaignType: "event", promptContext: BOOKING_LINKS, websiteUrl: "https://www.the-anchor.pub" } },
  { name: "facebook, bare domain", input: { platform: "facebook", placement: "story", campaignType: "event", promptContext: BOOKING_LINKS, websiteUrl: "the-anchor.pub" } },
  { name: "facebook, no website", input: { platform: "facebook", placement: "story", campaignType: "event", promptContext: BOOKING_LINKS, websiteUrl: null } },
  { name: "facebook, IP website", input: { platform: "facebook", placement: "story", campaignType: "event", promptContext: BOOKING_LINKS, websiteUrl: "http://10.0.0.1" } },
  { name: "facebook, mailto website", input: { platform: "facebook", placement: "story", campaignType: "event", promptContext: BOOKING_LINKS, websiteUrl: "mailto:a@b.com" } },
  { name: "facebook, xn-- website", input: { platform: "facebook", placement: "story", campaignType: "event", promptContext: BOOKING_LINKS, websiteUrl: "https://xn--caf-dma.com" } },
  { name: "facebook, 40-character prompt", input: { platform: "facebook", placement: "story", campaignType: "event", promptContext: BOOKING_LINKS, websiteUrl: `https://${"b".repeat(28)}.com` } },
  { name: "facebook, 41-character prompt", input: { platform: "facebook", placement: "story", campaignType: "event", promptContext: BOOKING_LINKS, websiteUrl: `https://${"b".repeat(29)}.com` } },
  { name: "instagram event story", input: { platform: "instagram", placement: "story", campaignType: "event", promptContext: BOOKING_LINKS, websiteUrl: "https://www.the-anchor.pub" } },
  { name: "instagram, facebook link only", input: { platform: "instagram", placement: "story", campaignType: "event", promptContext: { brief: { ctaLinks: { facebook: "https://x.example/1" } } } } },
  { name: "facebook, non-http link", input: { platform: "facebook", placement: "story", campaignType: "event", promptContext: { brief: { ctaLinks: { facebook: "javascript:alert(1)" } } } } },
  { name: "feed post", input: { platform: "facebook", placement: "feed", campaignType: "event", promptContext: BOOKING_LINKS, websiteUrl: "https://www.the-anchor.pub" } },
  { name: "promotion story", input: { platform: "instagram", placement: "story", campaignType: "promotion", promptContext: BOOKING_LINKS } },
  { name: "no campaign", input: { platform: "instagram", placement: "story", campaignType: null, promptContext: BOOKING_LINKS } },
  { name: "no prompt context", input: { platform: "facebook", placement: "story", campaignType: "event", promptContext: null } },
  { name: "unknown platform", input: { platform: "gbp", placement: "story", campaignType: "event", promptContext: BOOKING_LINKS } },
];

describe("story booking prompt parity (Node ↔ Deno worker copy)", () => {
  it("shares the length cap", () => {
    expect(DENO_MAX_STORY_PROMPT_LENGTH).toBe(NODE_MAX_STORY_PROMPT_LENGTH);
  });

  for (const f of STORY_PROMPT_FIXTURES) {
    it(`agrees on: ${f.name}`, () => {
      expect(denoStoryPrompt(f.input)).toBe(nodeStoryPrompt(f.input));
    });
  }
});
