# Adversarial Review: Story Series Event Date & Proximity Overlays

**Date:** 2026-04-26
**Mode:** A (Adversarial Challenge)
**Scope:** 8 files across 2 commits — default posting time change + event date wiring for story series proximity banners
**Pack:** `tasks/codex-qa-review/2026-04-26-story-series-event-date-review-pack.md`
**Reviewers:** Assumption Breaker, Workflow & Failure-Path, Security & Data Risk (Integration & Architecture still running)

## Executive Summary

The changes correctly wire an event date through the story series form into campaign metadata, enabling proximity overlay labels ("TOMORROW", "THIS WEDNESDAY") for story_series campaigns. One real bug was found and fixed: the optional `eventTime` field would reject empty strings from blank browser inputs. No security, auth, or RLS regressions were found.

## What Appears Solid

- Campaign metadata now carries `startDate` and optional `startTime`, matching the pattern used by event and promotion campaigns
- Both the app-side and Edge Function proximity label implementations were updated in sync
- The `CampaignTiming` type was extended to include `story_series` explicitly rather than silently falling through
- Server-side validation still runs via `storySeriesFormSchema.parse()` before any database writes
- No new PII, secrets, or RLS policy changes were introduced

## Critical Risks

None remaining after the eventTime fix.

## Implementation Defects

### FIXED: AB-001 / WF-001 / SEC-001 — Empty eventTime blocks form submission (High)

**File:** `src/lib/create/schema.ts:241`
**Status:** Fixed in commit `7f44e6d`

The `eventTime` field used `z.string().regex(/^\d{2}:\d{2}$/).optional()` but browser `<input type="time">` submits `""` when left blank, failing the regex. Fixed by adding a `.transform()` that coerces empty strings to `undefined`.

## Unproven Assumptions

### AB-002 — Existing story_series campaigns have no event date (Medium)

Existing `story_series` campaigns created before this change have no `startDate` in their metadata. The `extractCampaignTiming` function falls back to `DateTime.now()` for these, which means their proximity labels will be computed relative to "now" rather than any real event. This is acceptable if the intent is forward-only — new story series get labels, old ones don't.

**Decision needed:** Is a backfill of existing campaigns required, or is forward-only acceptable?

## Recommended Fix Order

1. ~~Fix eventTime empty string validation~~ **DONE**
2. Decide on existing campaign backfill (AB-002) — likely forward-only is fine

## Minor Observations

- AB-003 noted no new tests were added for the proximity label `story_series` path. This is noted but not blocking given the change reuses the existing `getEventLabel` logic which is already tested.
- The `eventDate` parameter in `getEngagementOptimisedHour` is now unused after the 7am default change — the parameter is kept for signature compatibility but could be cleaned up later.
