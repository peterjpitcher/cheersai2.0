# QA Review Report: Smart Scheduling & Copy Improvements Spec

**Scope:** Design spec validation against existing codebase
**Date:** 2026-04-10
**Mode:** Spec Compliance Review
**Engines:** Codex + Claude (Codex hit capacity mid-review; 3 of 5 specialists ran as Claude)
**Spec:** `docs/superpowers/specs/2026-04-10-smart-scheduling-and-copy-improvements-design.md`

---

## Executive Summary

The spec's design is sound but makes several incorrect assumptions about the existing code structure. **6 critical/high findings** need addressing before implementation: the spec assumes a shared scheduling metadata model that doesn't exist (each campaign type has its own schema), the hook/pillar rotation can't work within batch generation without in-memory state, new settings fields target the wrong model, the spec misses live scheduling workers outside the listed files, and there is zero test coverage across all affected modules. Additionally, an existing bug in `conflicts.ts:findResolution()` was independently flagged by 3 specialists.

**Total findings: 2 Critical, 7 High, 14 Medium, 12 Low**

---

## Spec Compliance Summary

**20 assumptions checked: 8 confirmed, 7 deviated, 3 partial, 2 N/A**

### Critical Spec Gaps

| ID | Finding | Specialists |
|----|---------|------------|
| SPEC-001 | Spec assumes shared `CampaignScheduleMetadata` but each campaign type (weekly, event, promotion) has its own schema/service path | Codex Spec Compliance |
| SPEC-002 | Hook rotation and pillar nudge require DB lookups during generation, but generation has no `accountId` or `supabase` access; same-batch posts won't see each other | Codex Spec Compliance |

### High Spec Gaps

| ID | Finding | Specialists |
|----|---------|------------|
| SPEC-003 | `defaultPostingTime` and `venueLocation` target `BrandProfile` but scheduling defaults live under `PostingDefaults`; missing SQL migration, settings schema, actions, and UI changes | Codex Spec + Standards |
| SPEC-004 | Spec misses live scheduling workers: `supabase/functions/campaign-materialiser/` and `supabase/functions/materialise-weekly/worker.ts` | Codex Spec |
| SPEC-005 | Prompt pipeline is broader than described: streaming route, postprocess, preflight, and `prompt_context` at publish time all need consideration | Codex Spec |
| SEC-001 | `venueLocation` (and existing `venueName`) interpolated into AI prompts without sanitisation — prompt injection vector | Security |
| STD-014 | Zero test files exist for any of the 8 reviewed modules — adding complex new logic on untested code creates regression risk | Standards |

---

## Cross-Specialist Agreements (highest confidence)

These findings were independently flagged by **2+ specialists**:

| Finding | Flagged By | Confidence |
|---------|-----------|------------|
| **`findResolution()` bug** — always returns +15 min, never checks other occupied slots | Performance (PERF-010), Standards (STD-018), Codex Spec (R018) | Very High |
| **Sequential OpenAI calls** — 12-36s campaigns when they could be 3-9s | Performance (PERF-001, PERF-002) | High |
| **Missing test coverage** — zero tests across all affected files | Standards (STD-014), Spec Compliance (testing strategy) | High |
| **Settings field placement** — spec puts scheduling data on `BrandProfile` (voice model) instead of `PostingDefaults` | Spec Compliance (SPEC-003), Standards (STD-022) | High |
| **Hook/pillar N+1 queries** — if placed in per-plan loop instead of hoisted | Performance (PERF-004, PERF-011), Spec Compliance (SPEC-002) | High |
| **Unvalidated campaign metadata JSONB** — no schema validation on read or write | Security (SEC-009), Spec Compliance (R011) | Medium |

---

## All Findings by Severity

### Critical (2)

1. **SPEC-001: Shared scheduling model doesn't exist** — Each campaign type has its own schema/service flow. The spec must scope to weekly campaigns first or define per-type changes.
2. **SPEC-002: Batch generation can't do hook/pillar rotation as specified** — Must carry account context into generation and track selections in-memory across the batch.

### High (7)

3. **SPEC-003: Settings fields target wrong model** — Full migration chain needed: SQL + row type + interface + query + mapping.
4. **SPEC-004: Missed live scheduling workers** — Two Supabase Edge Functions do materialisation outside the listed files.
5. **SPEC-005: Prompt pipeline broader than described** — Streaming preview, postprocess, and publish-time validation need accounting for.
6. **SEC-001: Prompt injection via venueLocation/venueName** — Add input validation (alphanumeric + punctuation, max 100 chars) and consider XML tag delimiters.
7. **STD-002: Spec missing auth check documentation** — Must state all new paths run within existing `requireAuthContext()` flow.
8. **STD-014: Zero test coverage** — Write baseline tests for `conflicts.ts`, `materialise.ts`, `voice.ts`, `content-rules.ts` before adding new logic.
9. **PERF-001+002: Sequential OpenAI calls** — Parallelise platform calls and plan processing. Would cut 36-call campaigns from ~108s to ~18s.

### Medium (14)

10. **SPEC-006: Downstream readers encode timing assumptions** — Weekly campaign UI, link-in-bio, planner data all need checking.
11. **SEC-002: materialise.ts hardcodes OWNER_ACCOUNT_ID, no cron auth gate** — Add CRON_SECRET verification.
12. **SEC-003: hook_strategy/content_pillar need CHECK constraints** — Add DB-level enum validation.
13. **SEC-004: Spread algorithm must scope to authenticated account** — Explicit `.eq("account_id")` required.
14. **SEC-005: postsPerWeek needs server-side validation** — Add `z.number().int().min(1).max(7)`.
15. **SEC-006: staggerPlatforms needs typed validation** — Parse from JSONB with Zod.
16. **STD-003: Testing strategy needs error/edge cases** — Each test area should list at least 1 error case.
17. **STD-004: No audit logging mentioned for new mutations** — Clarify these run within existing audited flows.
18. **STD-005: Missing DB migration for brand settings columns** — Add ALTER TABLE for posting_defaults.
19. **STD-007: describeTemporalProximity vs describeEventTimingCue overlap** — Clarify: extend existing or replace.
20. **PERF-003+012: Spread algorithm needs composite index** — `CREATE INDEX ON content_items(account_id, scheduled_for)`.
21. **PERF-004+011: Hook/pillar queries must be hoisted** — Single query at campaign level, not per-plan.
22. **PERF-008: materialise processes campaigns sequentially** — Use `Promise.all()` with concurrency limit.
23. **PERF-010: findResolution() always returns +15 min** — Must check candidate against ALL occupied slots, not just the triggering conflict.

### Low (12)

24-35. Missing return types on exported functions (STD-008, STD-011, STD-012, STD-020), duplicated `formatFriendlyTime` (STD-019), missing service-role comments (STD-016), `fromDb` helper not used in settings (STD-015), prompt injection on existing venueName (SEC-008), defaultPostingTime format validation (SEC-007), campaign metadata JSONB validation (SEC-009), regex pre-compilation (PERF-005), redundant Supabase client creation (PERF-009).

---

## Recommended Action Plan

### Before implementation (spec updates):
1. Fix SPEC-001: Scope spread-evenly to weekly campaigns first; define per-campaign-type schema changes
2. Fix SPEC-002: Design in-memory hook/pillar tracking within batch generation
3. Fix SPEC-003: Move new settings to correct model with full migration chain
4. Fix SPEC-004: Add the Supabase Edge Function workers to affected files list
5. Fix SEC-001: Add input validation for venueLocation/venueName
6. Fix PERF-010: Fix `findResolution()` bug before building spread algorithm on top

### During implementation (first PR — prep work):
7. Write baseline tests for conflicts.ts, materialise.ts, content-rules.ts
8. Add composite index on content_items(account_id, scheduled_for)
9. Parallelise OpenAI API calls (PERF-001+002)
10. Extract duplicated formatFriendlyTime to shared utility
11. Add explicit return types to affected exported functions

### During implementation (feature PRs):
12. Add Zod validation for all new fields (postsPerWeek, scheduleMode, staggerPlatforms, hook_strategy, content_pillar)
13. Add CHECK constraints in DB migration
14. Hoist hook/pillar queries to campaign level
15. Wire materialise cron with CRON_SECRET auth
