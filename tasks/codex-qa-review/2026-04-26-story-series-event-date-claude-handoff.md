# Claude Hand-Off Brief: Story Series Event Date

**Generated:** 2026-04-26
**Review mode:** A (Adversarial Challenge)
**Overall risk:** Low (after fix applied)

## DO NOT REWRITE

- The proximity label switch case additions in both `proximity-label.ts` and the Edge Function `proximity.ts`
- The `CampaignTiming` type extension to include `story_series`
- The `extractCampaignTiming` resolved type logic
- The campaign metadata structure (`startDate`, `startTime`)
- The form UI layout (event date + optional event time)

## IMPLEMENTATION CHANGES REQUIRED

- [x] AB-001: `schema.ts` — transform empty eventTime to undefined (FIXED: `7f44e6d`)

## ASSUMPTIONS TO RESOLVE

- [ ] AB-002: Decide if existing story_series campaigns need a metadata backfill with `startDate`. Likely forward-only is acceptable — existing stories without event dates simply won't get proximity labels.

## REPO CONVENTIONS TO PRESERVE

- Edge Function `proximity.ts` must stay in sync with app-side `proximity-label.ts` and `campaign-timing.ts`
- Campaign metadata keys use camelCase (`startDate`, `startTime`)
- Form schemas use `.transform()` for coercion, `.refine()` for validation

## RE-REVIEW REQUIRED AFTER FIXES

- None — all blocking findings resolved.
