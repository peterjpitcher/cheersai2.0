# TODO — Weekly recurrence: CTA link, multi-day + end date, planner overlay

Plan: `tasks/PLAN-weekly-recurrence-cta-and-date-controls.md`
Branch: `feat/weekly-recurrence-cta-date-controls`
Execution: implement-plan orchestration (agents edit files; orchestrator owns git).

## Wave 1 — PR1 recurrence model (Agent A, sequential)
- [ ] Task 1: weekly schema daysOfWeek + endDate (+ tests)
- [ ] Task 2: buildWeeklyMultiDaySuggestions (+ tests)
- [ ] Task 3: weekly form checkboxes + end date + live counter
- [ ] Task 4: wizard defaults + Brief→Media occurrence gate
- [ ] Task 5: schedule-step uses multi-day builder; delete old builder
- [ ] Task 6: createDraft stores first day
- [ ] Task 7: buildCampaignMetadata weekly shape (+ tests)
- [ ] Task 8: prompts.ts renders all days
- [ ] Task 9: createScheduledBatch server slot cap
- [ ] Task 10: runbook fix

## Wave 2 — PR2 overlay (Agent B) ∥ PR3 CTA (Agent C)
- [ ] Task 12: ScheduleCalendar onMonthChange
- [ ] Task 13: schedule-step routes weekly through calendar (seed-once)
- [ ] Task 14: wizard requires ≥1 slot for weekly
- [ ] Task 16: weekly form CTA link field (feed only)
- [ ] Task 17: createScheduledBatch writes link_in_bio_url
- [ ] Task 18: compose-body weekly CTA tests

## Verification
- [ ] Orchestrator: npm run ci:verify green
- [ ] Adversarial review (codex-qa-review)
- [ ] Git: commit per PR on feature branch
