# Adversarial Review: Tournament Content Module Spec

**Date:** 2026-05-09
**Mode:** A (Adversarial Challenge)
**Scope:** Design spec — `docs/superpowers/specs/2026-05-09-tournament-content-design.md`
**Pack:** `tasks/codex-qa-review/2026-05-09-tournament-content-spec-review-pack.md`
**Reviewers:** Assumption Breaker, Integration & Architecture, Workflow & Failure-Path, Security & Data Risk

## Executive Summary

The spec has sound high-level architecture — standalone tables, separated overlay renderer, reuse of existing publish pipeline. However, four reviewers independently flagged the same cluster of issues: **generation lacks transactionality and idempotency**, **media cleanup can orphan or over-delete assets**, **partially published fixtures create duplicate content on regeneration**, and **the `platforms` field is decorative** (generation hardcodes 4 items regardless). These must be resolved before implementation.

## What Appears Solid

- Separation from existing banner system via dedicated `src/lib/tournament/overlay.ts`
- Unique constraints on `(account_id, slug)` and `(tournament_id, match_number)`
- Already-published content is never modified — correct for social media where posts can't be reliably recalled
- RLS on both new tables, account-scoped
- UTC storage with Europe/London display — timezone handling is explicit
- Content routing through existing `content_items` → `publish_jobs` pipeline

## Critical Risks (must fix before implementation)

### CR-1: Generation needs transaction + idempotency
*Sources: AB-003, WF-001, WF-002, SEC-002*

Generation creates media assets, content items, content variants, and publish jobs across multiple writes. No transaction boundary, lock, or idempotency key is specified. Save + Bulk Generate can race and create duplicates.

**Fix:** Wrap generation in a single DB transaction. Add a unique constraint on `(fixture_id, platform, placement)` in content_items metadata (or a dedicated junction). Use `content_generated` as a post-commit flag, not a pre-check guard alone.

### CR-2: `platforms` field is decorative
*Source: AB-001*

The tournament table stores `platforms text[]` but the generation flow hardcodes exactly 4 items (IG feed, IG story, FB feed, FB story). Changing platforms in settings would have no effect.

**Fix:** Generation must iterate `tournament.platforms × [feed, story]` to build the content item list dynamically.

### CR-3: Generation can start without base images
*Source: AB-002*

Base image columns are nullable, but trigger conditions only check fixture flags. Generation would fail at render time.

**Fix:** Add tournament-level preconditions to all generation paths: `status = 'active'`, both base images present, `post_template` non-empty, at least one platform configured.

### CR-4: Partially published regeneration creates duplicates
*Sources: AB-005, WF-003*

If 2 of 4 items are published and team names change, the spec deletes unpublished items and regenerates fresh — but regeneration creates all 4 items again, duplicating the already-published placements.

**Fix:** Regeneration must check which `(platform, placement)` combinations are already published and only generate the missing ones.

### CR-5: Media asset ownership and cleanup
*Sources: AB-004, ARCH-002, WF-007, SEC-006*

Two overlay images serve four content items. Cleanup deletes "associated media_assets" but doesn't define ownership. Could delete media still referenced by published content, or orphan storage objects.

**Fix:** Tag generated media with `tournament_fixture_id` in media_assets metadata. Cleanup must check no remaining `content_variants.media_ids` references exist before deleting. Consider one media asset per content item (4 assets, not 2) for simpler ownership.

### CR-6: Auth checks not specified in server actions
*Source: SEC-001*

The spec names `src/app/actions/tournament.ts` but doesn't require `getUser()` + account membership verification in each action. Project conventions require this, but the spec should be explicit.

**Fix:** State that all tournament server actions must call `getUser()`, verify `account_id` ownership, and scope all queries to the authenticated account.

### CR-7: Content lookup needs account scoping
*Sources: SEC-003, ARCH-001*

Cleanup queries use only `metadata->>'tournament_fixture_id'` without an `account_id` filter. Should include account scoping as a defence-in-depth measure.

**Fix:** All content lookup/deletion queries must include `account_id = tournament.account_id`.

### CR-8: Archive status missing from trigger conditions
*Sources: AB-006, ARCH-005*

Trigger conditions list only fixture flags. An archived tournament could still generate content if a fixture is edited.

**Fix:** Add `tournament.status = 'active'` to all generation paths — single fixture, bulk, and regeneration.

### CR-9: Preflight before queuing
*Source: AB-009*

Project conventions require preflight validation before queuing publish jobs. The spec mentions reusing preflight but doesn't define when it runs or what happens on failure.

**Fix:** Run preflight per content item before creating publish jobs. Surface failures in the fixture table as a blocked status. Don't queue jobs that would fail preflight.

## Implementation Defects

### ID-1: Stagger rule underspecified
*Sources: AB-007, ARCH-004, WF-004*

Only handles "second fixture" — needs deterministic ordering for N simultaneous fixtures. Reruns can shift schedules.

**Fix:** Sort by `match_number`, offset by `index × 5 minutes`. Recompute consistently on bulk generation and kick-off changes.

### ID-2: Auto-generation fires too eagerly on inline edit
*Source: WF-006*

Typing a team name and tabbing away triggers immediate generation before the user finishes editing related fields (booking URL, showing note).

**Fix:** Require an explicit "Save & Generate" action per fixture or row, not auto-fire on blur/auto-confirm.

### ID-3: Past scheduled times unhandled
*Source: WF-008*

Late-confirmed fixtures may have `scheduled_for` in the past, causing immediate publish or cron churn.

**Fix:** If `scheduled_for` is in the past, require user confirmation before queuing (or queue with `next_attempt_at = now()` after showing a warning).

### ID-4: Lead hours change doesn't cascade
*Source: AB-010*

Editing `post_lead_hours` in tournament settings doesn't recalculate existing unpublished content.

**Fix:** Specify whether lead-hour changes apply to future-only generation or cascade to all unpublished content. Recommend future-only for simplicity.

## Security & Data Risks

### SDR-1: Booking URL validation
*Source: SEC-004*

Free-text `booking_url` with no protocol/domain validation. Could store phishing or `javascript:` URLs.

**Fix:** Validate `https://` protocol on save. Reject other schemes.

### SDR-2: Text length limits
*Source: SEC-005*

No max lengths on `house_rules_text`, team names, or `post_template`. Could exhaust Satori memory or break UI.

**Fix:** Add reasonable limits — team names 50 chars, house rules 200 chars, post template 500 chars.

### SDR-3: Bulk generate rate limiting
*Source: SEC-007*

No throttle on bulk generation. Repeated clicks could trigger expensive rendering.

**Fix:** Debounce in UI + server-side check that bulk generation isn't already in progress for this tournament.

## Minor Observations

- Archive could optionally offer "cancel all queued content" (WF-005) — nice to have, not blocking
- Multi-venue reusability is sufficient as-is since CheersAI is single-venue per account (ARCH-006)
- Dual-source-of-truth between `content_generated` and actual content items (ARCH-001) — acceptable if CR-1 transaction fix ensures they stay in sync

## Recommended Fix Order

1. **CR-1** Transaction + idempotency (foundational — everything depends on this)
2. **CR-2** Platforms field drives generation (changes the generation loop shape)
3. **CR-4** Partially published regeneration (depends on CR-2 for correct platform iteration)
4. **CR-5** Media ownership (depends on CR-2 for asset-per-item model)
5. **CR-3** Tournament preconditions
6. **CR-6 + CR-7 + CR-8** Auth, scoping, archive guard (can be done in parallel)
7. **CR-9** Preflight integration
8. **ID-1 through ID-4** Implementation details
9. **SDR-1 through SDR-3** Validation and limits
