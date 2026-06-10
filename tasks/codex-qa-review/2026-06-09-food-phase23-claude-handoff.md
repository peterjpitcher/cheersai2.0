# Claude Hand-Off Brief: Food Booking Phases 2 + 3

**Generated:** 2026-06-10
**Review mode:** B + C (mixed engines, disclosed — see the adversarial-review doc)
**Overall risk:** Low (was High pre-repair) — all 18 material findings fixed and regression-tested; automation flags ship OFF.

## DO NOT REWRITE
- Materialisation utm uniqueness (`windowKey-runDate-index`), completeness-based idempotency, and the 23505 unique-index guard — verified by 4 reviewer passes.
- `ad_metrics_history` RLS (campaigns-pattern policy) and the dynamic CHECK-widen block.
- Fatigue delta-semantics rewrite and the `actionType:campaignId:adId` dedup.
- The conversion-gate abort (no silent fallback) in the worker.
- Per-service URL `validatePaidDestinationAttribution` guard at create.

## SPEC REVISION REQUIRED
- [x] None — implementation now matches the Phase 2/3 specs plus the strengthened safety semantics above (specs already note `apply` is opt-in and flags default off).

## IMPLEMENTATION CHANGES REQUIRED
- [x] All complete (F1–F10, WF-1..6, SEC-1/2, CDX-2). Branch `feat/food-booking-campaign`, commits `3ba0d8d..3605e6e`, 1640 tests green.

## ASSUMPTIONS TO RESOLVE (operational, before/at go-live — owner: Peter)
- [ ] Apply both pending migrations to prod (`20260609092541`, `20260610052138`) BEFORE deploying this code (WF-2 makes code-first safe, but migration-first is still correct order).
- [ ] Confirm prod's `meta_optimisation_actions` has exactly one CHECK on `action_type` (WF-4's dynamic drop handles naming, not multiplicity).
- [ ] Verify Meta's live per-ad-set minimum budgets on the first `FOOD_OPTIMISATION_ENABLED` run (code floor: £1/day, conservative).
- [ ] Confirm the booking site forwards `utm_content` on table bookings in production (attribution coverage — the `unattributed` bucket makes gaps visible).

## REPO CONVENTIONS TO PRESERVE
- Flags: server env via `featureFlags.*` (string `'true'|'1'` coercion), never raw Zod booleans.
- Audit: `logPublishAuditEvent` (NOT `logAuditEvent`); QStash workers return 500 to retry, 200 to stop.
- Migrations: additive only; dry-run before push; never push to prod without explicit approval.

## RE-REVIEW REQUIRED AFTER FIXES
- [ ] Only if the materialisation creation sequence is restructured again → re-run Pack A reviewers on the new diff.

## REVISION PROMPT
None needed — no open corrections. For future passes: rebuild a pack with `build-review-pack.sh --base <last-reviewed-sha>` and run the three-reviewer wave per `~/.claude/skills/codex-qa-review/`.
