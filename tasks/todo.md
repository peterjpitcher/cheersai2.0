# TODO — Weekly recurrence: CTA link, multi-day + end date, planner overlay

Plan: `tasks/PLAN-weekly-recurrence-cta-and-date-controls.md`
Branch: `feat/weekly-recurrence-cta-date-controls`
Execution: implement-plan orchestration (agents edit files; orchestrator owns git).

## Wave 1 — PR1 recurrence model (Agent A, sequential) — DONE (commit 8526c38)
- [x] Task 1: weekly schema daysOfWeek + endDate (+ tests)
- [x] Task 2: buildWeeklyMultiDaySuggestions (+ tests)
- [x] Task 3: weekly form checkboxes + end date + live counter
- [x] Task 4: wizard defaults + Brief→Media occurrence gate
- [x] Task 5: schedule-step uses multi-day builder; delete old builder
- [x] Task 6: createDraft stores first day
- [x] Task 7: buildCampaignMetadata weekly shape (+ tests)
- [x] Task 8: prompts.ts renders all days
- [x] Task 9: createScheduledBatch server slot cap
- [x] Task 10: runbook fix

## Wave 2 — PR2 overlay (Agent B, commit a574672) ∥ PR3 CTA (Agent C, commit 98f216b) — DONE
- [x] Task 12: ScheduleCalendar onMonthChange
- [x] Task 13: schedule-step routes weekly through calendar (seed-once)
- [x] Task 14: wizard requires ≥1 slot for weekly
- [x] Task 16: weekly form CTA link field (feed only)
- [x] Task 17: createScheduledBatch writes link_in_bio_url
- [x] Task 18: compose-body weekly CTA tests

## Verification
- [x] Orchestrator: npm run ci:verify green (lint, typecheck, 1722 tests, build exit 0 after clearing stale .next)
- [x] Adversarial review (codex-qa-review): 4 Codex reviewers; 6 real fixes applied (commit 1bc4240), rest are documented descopes
- [x] Re-verify after fixes: typecheck clean, 1722 tests pass, lint clean, build exit 0
- [x] Git: 5 commits on feature branch (docs + PR1 + PR2 + PR3 + review fixes)

## Follow-ups from user Q&A — DONE
- [x] Cap raised to 52 (commit 66c507d)
- [x] Exact multi-day next-occurrence labels — bio card + banner (commit ec5e8cb); Deno banner-label needs redeploy
- [x] Custom CTA button label (commit 39317b1)
- [x] Re-verify: typecheck clean, lint clean, 1728 tests pass, build exit 0
- [x] Pushed + PR #19 opened (single PR): https://github.com/peterjpitcher/cheersai2.0/pull/19

## Remaining known limitations (deliberate descopes)
- materialiseRecurring draft-ghost preview shows first day only (cosmetic; self-corrects on submit).
- No old-draft preprocess upgrade: a weekly draft in flight at deploy shows empty day/end-date fields and must be re-picked (crash-guarded, self-heals).

## Not done (needs user)
- [ ] Deploy: redeploy supabase/functions/publish-queue edge function separately (Vercel deploy won't cover it).
- [ ] Recommended follow-up if you go big on cap: batched/progressive copy generation (52 upfront drafts is a lot to review at once).
