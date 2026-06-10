# Adversarial Review: Food Booking Phases 2 + 3

**Date:** 2026-06-09/10
**Mode:** B (code review) + C (spec compliance)
**Scope:** All Phase 2 (measurement) + Phase 3 (optimisation) source on `feat/food-booking-campaign` (diff `558fedb..HEAD`), reviewed via two packs:
- **Pack A** — spend/automation core (materialisation, cron, worker, caps, weighting): `2026-06-09-food-phase3-spend-review-pack.md`
- **Pack B** — measurement/fatigue/cutoff/create (`food-booking-insights`, `creative-fatigue`, `performance-sync`, `optimisation`, `food-cutoff-tuning`, create path, `ad_metrics_history` migration): `2026-06-09-food-phase2-fatigue-review-pack.md`

**Engines (disclosed):** Pack A = OpenAI Codex × 3 reviewers (assumption-breaker, workflow-failure-path, security-data-risk). Pack B = Claude × 2 reviewers (workflow-failure-path, security-data-risk) **plus** Codex assumption-breaker — the Codex trio was interrupted twice by session restarts mid-run; the documented mixed-engine fallback was used, openly, and the surviving Codex pass corroborated/extended the Claude results. Phase 1 was separately Codex-reviewed on 2026-06-08 (see `2026-06-08-food-booking-adversarial-review.md`).

## Executive Summary
18 material findings across both packs; **all 18 fixed and regression-tested in the same branch** (commits `3ba0d8d..3605e6e`). The dominant theme was failure-path correctness in the auto-spend worker (partial-failure retries, kill-switch coverage, silent DB errors) and metric integrity in fatigue/insights (cumulative-vs-delta confusion, window mismatches). No cross-account/RLS issue was found anywhere. Final state: `ci:verify` green at 1640 tests, all automation flags off by default, no migration applied to any live database.

## What Appears Solid (verified, do not rewrite)
- Materialised ads always get fresh unique `utm_content` (`windowKey-runDate-index`) — confirmed independently by all three Pack A reviewers; the Phase-1 duplicate-UTM bug did not recur.
- Cron auth (`CRON_SECRET`, timing-safe) and QStash signature verification (clone-before-verify) before any side effect.
- `ad_metrics_history` RLS exactly matches the canonical `campaigns` policy (service_role OR `current_account_id()`, USING+CHECK); all new reads scoped by trusted `accountId`.
- Fatigue can never auto-pause: optimiser only inserts `status='planned'`; the apply path hard-rejects everything except `copy_rewrite`.
- Dashboard failure isolation: insights fetch has one call site, wrapped catch → `EMPTY_FOOD_BOOKING_INSIGHTS`.
- Cutoff tuning is pure and advisory-only; abstains below sample thresholds.
- CHECK-constraint widen is a strict superset of the original values; create path re-verifies auth + feature flag server-side; `food_intent`/`utm_content` never reach SQL (in-memory bucketing only).

## Findings → fixes (all closed)

### Pack A — spend/automation (10)
| # | Sev | Finding | Fix (commit) |
|---|-----|---------|--------------|
| F1 | High | Worker ignored the kill switch — queued/replayed signed jobs still materialised after `FOOD_AUTO_MATERIALISE_ENABLED` off | Flag re-check post-signature; 200 `{skipped}` so QStash doesn't retry (`0e10674`) |
| F2 | High | Partial-failure retry-skip: any existing (service_key, phase_start) row counted as done, stranding broken windows | Completeness rule (meta_adset_id AND ≥1 ad); incomplete rows cleaned up + recreated (`715ec0b`) |
| F3 | High | Post-Meta DB writes ignored Supabase errors → silent stale linkage | Every write checked; failure ⇒ 500 ⇒ safe retry (`08c61f8`) |
| F4 | High | No conversion-readiness re-check; silent fallback optimisation goal | Gate re-checked before any creation; abort + audit; fallback deleted (`0658303`) |
| F5 | Med | Ad sets activated with zero ads when media missing | Activate only with ≥1 ad; else PAUSED + `skippedNoMedia` (`08c61f8`) |
| F6 | High | Idempotency horizon (`min(8, weeks+4)`) broke long-running campaigns | Existing windows derived from ad-set rows; horizon deleted (`715ec0b`) |
| F7 | High/Med | Concurrent same-week deliveries could double-create | Partial unique index on `(campaign_id, service_key, decision_stage, phase_start)` + graceful 23505 handling (`2c93393`, migration `20260610052138`) |
| F8 | Med | Cron returned 200 when every dispatch failed | 500 on total failure; partial = 200 + counts (`0e10674`) |
| F9 | Med | Caps could emit `max < floored min` | `max = max(target×1.5, min)` invariant (`3ba0d8d`) |
| F10 | Med | Cap preflight could run for a hypothetical non-CBO food publish | Caps computed only under the CBO condition (`5b9f122`) |

### Pack B — measurement/fatigue/create (7)
| # | Sev | Finding | Fix (commit) |
|---|-----|---------|--------------|
| WF-1+6 | High | Fatigue maths treated lifetime running totals as daily values — CTR arm dead, frequency arm permanent, guard ~7× too lax; row-count windows ignored date gaps | Delta semantics on date-bucketed boundary snapshots; coverage minimum; frequency arm explicitly lifetime (`6f3c018`) |
| WF-2 | High | History-append failure aborted the nightly sync mid-loop (guaranteed daily breakage if code deploys before migration) | Best-effort append; schema-gap-aware logging; loop continues (`734b04b`) |
| WF-3 | High | Fatigue actions re-recorded daily (drifting numbers defeated dedup), flooding the dashboard | Dedup key `actionType:campaignId:adId` (`e5810df`) |
| WF-4 | Med | Migration dropped a CHECK by guessed name; action-insert errors swallowed | Dynamic constraint lookup via `pg_constraint`; `failedActionInserts` surfaced (`e5810df`, `01c3898`) |
| WF-5 | Med | Cost-per-booking divided lifetime spend by 90-day bookings | Spend restricted to campaigns overlapping the window (`d1be842`) |
| SEC-1 | Med | Per-service booking URLs bypassed `validatePaidDestinationAttribution` yet became live ad destinations | Same trusted-destination guard applied per service URL at create (`9b98d55`) |
| SEC-2 | Low | `ad_metrics_history` lacked sibling-pattern cascade FKs | FKs to `auth.users(id)` / `ads(id)` added to the unapplied migration (`01c3898`) |

### Codex assumption-breaker (Pack B scope, frozen pre-repair snapshot) — 5 raised, 1 new fix
| # | Disposition |
|---|-------------|
| CDX-1 upsert conflict omits account_id | **Rejected with evidence:** `ads.id` is a globally-unique uuid PK, now also FK-enforced — cross-account `ad_id` collision impossible. Claude security reviewer verified the same independently. |
| CDX-2 `food_intent` containing "dinner" guessed as weekday | **Fixed** (`3605e6e`): bare "dinner" with no day marker → visible `unattributed`, not a silent weekday guess. |
| CDX-3 lifetime spend vs 90d bookings | Duplicate of WF-5 — already fixed. |
| CDX-4 fatigue reason says "average", code uses max | Superseded by WF-1 rewrite (reason now states lifetime semantics explicitly). |
| CDX-5 service-URL error shape | Superseded by SEC-1 (returns `{error}` naming the service; Zod pre-validates). |

## Unproven Assumptions (carry into live validation)
1. `metaMinBudget` floor (£1/day) is a conservative constant — Meta's live per-ad-set minimums are authoritative at create time; verify on first `apply`-mode run.
2. WF-4's dynamic CHECK lookup assumes prod has exactly one CHECK covering `action_type` — confirm on the live DB before `db push`.
3. Cost-per-booking remains an approximation until daily spend history accrues in `ad_metrics_history`.

## Recommended Fix Order
None outstanding — all material findings closed. Re-review is only needed if the materialisation worker's creation sequence is restructured again.
