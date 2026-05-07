# Adversarial Review: Banner Overlay Consistency Design

**Date:** 2026-05-07
**Mode:** C (spec compliance)
**Scope:** [docs/superpowers/specs/2026-05-07-banner-overlay-consistency-design.md](../../docs/superpowers/specs/2026-05-07-banner-overlay-consistency-design.md)
**Pack:** [2026-05-07-banner-overlay-consistency-review-pack.md](2026-05-07-banner-overlay-consistency-review-pack.md)

## Executive Summary

Five reviewers ran. The spec is directionally strong on derived labels, timezone correctness, and cross-surface consistency. The genuine gaps concentrate around publish-time failure semantics, storage-cleanup mechanism, DB-level constraint hygiene, and a couple of ambiguous edges (multi-phase promotions, account-default change while queued, UI clock-boundary refresh).

Several findings (AB-001, SPEC-001, parts of WF-* and SEC-*) reduce to "no implementation diff exists yet." That's expected — this is a Mode C review of a spec before implementation. Dropped as noise.

## What Appears Solid (preserve)

- Pure shared `labelEngine` and `bannerConfigResolver` used by both UI and server. Eliminates label/config duplication.
- Server-only JPEG renderer; React overlay does no async work and no DB calls. Matches repo client/server conventions.
- Override semantics: non-empty override beats null label; `enabled = false` beats override.
- Migration explicitly audits PL/pgSQL functions and triggers for dropped column names per repo rules.
- Two-phase additive-then-cleanup migration plan (already in spec from self-review).

## Critical Gaps to Fix in Spec

### G1. Storage cleanup is not SQL — it's a separate ops script
*(Sources: SPEC-002, ARCH-003, WF-001, SEC-001)*

The spec says the migration deletes `banners/{contentId}/{variantId}.jpg` from Supabase Storage. SQL can't reliably enumerate or delete object-store files. **Fix:** call out an ops script that uses the Supabase Storage API with the service-role key, runs after Migration 2, and reports per-file success/failure. Document idempotency and rollback (the script can be re-run; partial failure is acceptable because the DB no longer references the files).

### G2. Render failure → publish behaviour must be explicit
*(Sources: SPEC-003, ARCH-001, WF-002, SEC-005)*

The spec says "render fails → job marked failed" but doesn't tie that into the actual publish queue mechanics in [supabase/functions/publish-queue/worker.ts](../../supabase/functions/publish-queue/worker.ts) or [src/lib/publishing/preflight.ts](../../src/lib/publishing/preflight.ts). **Fix:** spell out (a) banner render runs at publish time *before* any platform API call, (b) on render failure, the `publish_jobs` row goes to status `failed` with `last_error` populated and `next_attempt_at` set per existing retry policy, (c) no platform-side mutation occurs, (d) the user-visible status surfaces the failure.

### G3. DB CHECK constraints on banner override fields
*(Sources: SPEC-007, ARCH-005, WF-006, SEC-002)*

App-side validation isn't enough — operational scripts can write directly. **Fix:** add CHECK constraints in the additive migration:
- `banner_position IN ('top','bottom','left','right')`
- `banner_bg` and `banner_text_colour` match `^#[0-9A-Fa-f]{6}$`
- `banner_text_override` has `char_length ≤ 20`

### G4. Legacy `prompt_context.bannerConfig` may contain invalid values
*(Source: SEC-004)*

When copying into the new override columns, the migration data step must validate. **Fix:** during data-copy, validate position/hex/length; invalid values become `null` (which means inherit account default). Log how many rows had invalid values during the migration.

### G5. Multi-phase promotion target — pick `scheduled_for` consistently
*(Sources: SPEC-006, WF-003)*

The "phase date" wording is ambiguous. In practice every promotion post is one row in `content_items` with its own `scheduled_for`. **Fix:** simplify the target table — use `scheduled_for` for every campaign type *except* event posts, which use `event_start_at`. Drop the "phase date" column entirely.

### G6. UI clock-boundary refresh
*(Source: ARCH-006)*

A planner left open across 17:00 or midnight will keep showing yesterday's label. **Fix:** `<BannerOverlay />` recomputes its label every 60 seconds via a ticker hook. One shared `useNowMinute()` hook so all overlays on a page tick together.

### G7. Account-default change while job queued — document the trade-off
*(Source: WF-005)*

If user edits account defaults, queued posts will render at publish using the new defaults — not the ones in effect when the post was approved. This is the trade-off of the always-derived model. **Fix:** state this explicitly as a documented behaviour, not a bug. The user already chose this trade-off when they picked the auto-rerender model in brainstorming Q2.

### G8. Story-series per-frame atomicity
*(Source: WF-004)*

A story-series is N independent posts. **Fix:** explicit statement — each story frame renders and publishes independently. One frame's render failure does not block others; partial success is the expected outcome.

### G9. Drop the unused `contentType` parameter on `bannerConfigResolver`
*(Source: SPEC-005)*

The resolver accepts `contentType: 'feed' | 'story'` but config resolution doesn't depend on it (only the renderer does, via aspect inspection). **Fix:** remove the parameter from `bannerConfigResolver`'s contract.

### G10. Reference standard auth/ownership pattern explicitly
*(Source: SEC-003)*

Server actions in this repo always re-verify auth + ownership per [.claude/rules/supabase.md](../../.claude/rules/supabase.md). The spec should reference this rather than re-invent it. **Fix:** brief note that all banner-write server actions follow the standard pattern (`getUser()` then ownership join).

## Minor Observations

- Geometry constants (strip width %, font size) are defined in two places (SVG component + Sharp renderer). Drift risk is low at this scope; flag for refactor only if drift emerges.
- Surface-coverage audit (SPEC-008) is appropriate during implementation, not spec, since the planning agent will list every component touched.

## Recommended Fix Order

1. Apply G1–G10 to the spec inline. (Single revision pass.)
2. Re-commit spec.
3. Hand off to writing-plans for implementation plan.

## Reviewers run

- assumption-breaker — 1 finding (noise: no diff)
- spec-trace-auditor — 8 findings, 7 material
- integration-architecture — 6 findings, 6 material
- workflow-failure-path — 6 findings, 6 material
- security-data-risk — 5 findings, 5 material

Materially distinct issues after dedup: **10 (G1–G10)**.
