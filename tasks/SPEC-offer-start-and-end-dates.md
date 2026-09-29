# SPEC: offer suggestions follow the start date; a passed end date is refused

Status: approved by Peter on 29 September 2026. Follows PR #174 (`tasks/SPEC-offer-suggestions-no-duplicates.md`).

## Problem

In the create wizard, an offer (promotion) brief has an optional start date and a required end date. The schedule step suggests "Launch", "Mid-run reminder" and "Last chance" from `buildPromotionSuggestions` (`src/features/create/schedule/suggestion-utils.ts`).

1. **The start date was ignored.** `buildPromotionSuggestions` took only the end date, so "Launch" was always today and the reminder was spaced from today. An offer starting next week got its launch post this week, before the offer existed.
2. **A passed end date was accepted.** The form and both server actions that take a brief (`createDraft`, `createScheduledBatch` in `src/app/actions/content.ts`) accepted an end date that had already gone, and the wizard then suggested a "Launch" post for today for an offer that had ended.
3. **A start date after the end date was accepted** by the form and the server.

## Decisions

- **Launch on the start date when it is still to come.** When the brief has a start date after today (London) and on or before the end date, the run starts on that date: "Launch" is at 12:00 London (`DEFAULT_POST_TIME`) on the start date and the reminder sits halfway between the start and the end. With no start date, a blank one, one of today, or one already passed, nothing changes: the run starts today, as before. The 15-minute rule and one-suggestion-per-day rule from PR #174 still apply.
- **An offer whose end date has passed gets no suggestions.** A draft saved before its end date passed can still reach the schedule step; it now shows no suggested slots rather than a "Launch" for today. The server refuses the batch anyway (below).
- **A start date after the end date is ignored by the suggestions** (the run starts today), so an old draft never suggests a launch after the offer ends. The form and the server refuse such a brief.
- **Refusals, in plain British English, on the field concerned:**
  - end date before today in London: "The offer end date has passed. Choose today or a later date." (end date field). An end date of today is accepted.
  - start date after the end date: "The offer start date is after the end date. Choose a start date on or before the end date." (start date field). A start date equal to the end date is accepted.
- **Where the rules live:**
  - Start after end is part of `promotionBriefSchema` (`src/features/create/schemas/content-schemas.ts`), so every parse of a brief refuses it.
  - The end-date check depends on today, so it lives in a new `contentBriefSubmissionSchema`: `contentBriefSchema` plus the checks that read today's London date at parse time. `contentBriefSchema` itself stays free of today's date, as the weekly-recurring comment in that file already requires, so stored briefs and tests still parse.
  - The wizard's form resolver (`create-wizard.tsx`), `createDraft` and `createScheduledBatch` all use `contentBriefSubmissionSchema`, so the form and the server refuse the same briefs and a form left open past midnight cannot slip through.
- **London days, not UTC ones.** Today is `DateTime.now().setZone(DEFAULT_TIMEZONE)`; dates are compared as `YYYY-MM-DD` London days. Just after midnight in British Summer Time the UTC date is still yesterday's; the tests cover the night of 24 to 25 October 2026.
- **The two date fields re-check each other** (`deps` on each `register`), so fixing the end date clears a stale "start date is after the end date" message once the owner leaves the field.
- **Out of scope:** the calendar still opens on the current month, so an offer starting next month needs one click to see its launch; event and weekly-recurring validation; the legacy `promotionCampaignFormSchema` in `src/lib/create/schema.ts`, which nothing outside its own file and tests uses.
- The homepage offers claim ("Give it an end date and Cheers suggests a launch post, a reminder and a last-chance post.") stays true; `src/content/homepage-claims.test.ts` passes unchanged.

## Change

- `src/features/create/schemas/content-schemas.ts`: `OFFER_DATE_MESSAGES`; the start-after-end refinement on `promotionBriefSchema`; `contentBriefSubmissionSchema`.
- `src/features/create/schedule/suggestion-utils.ts`: `buildPromotionSuggestions` takes `startDate` and returns nothing for an ended offer.
- `src/features/create/steps/schedule-step.tsx`: passes the brief's start date.
- `src/features/create/create-wizard.tsx`: the form resolver uses `contentBriefSubmissionSchema`.
- `src/features/create/forms/promotion-fields.tsx`: the start and end date fields re-check each other.
- `src/app/actions/content.ts`: `createDraft` and `createScheduledBatch` validate with `contentBriefSubmissionSchema`.

No schema, data, settings or edge-function change.

## Tests

Written first; 24 failed before the change. All run under `npm run test:ci` (Europe/London) and `npm run test:utc`.

- `tests/features/create/suggestion-utils.test.ts`: start date next week, today, blank, missing, already passed, after the end date, same day as the end, tomorrow; end date yesterday, today (before and after noon); a run over the 25 October clock change, one starting on that day, one that ended on the Saturday checked just after midnight BST; the launch's exact UTC instant either side of the change.
- `src/features/create/schemas/content-schemas.test.ts`: start after end refused on the start date field (stored and submitted); start on, before, blank or missing accepted; the stored-brief schema ignores today; end date yesterday refused, today and later accepted; the end-date problem is reported alongside other problems; London date either side of the clock change.
- `src/features/create/forms/promotion-fields.test.tsx` (rendered, the wizard's resolver): a passed end date shows the message under the end date on Next and on leaving the field; today is accepted; a start after the end is shown under the start date and clears once the end date moves later.
- `src/features/create/steps/schedule-step.test.tsx` (rendered): an offer starting next week launches on its start date (19 October) with the reminder and last chance on 24 and 29 October, across the clock change; a blank start date launches today; an ended offer shows no suggestions.
- `tests/app/actions/content.test.ts`: `createScheduledBatch` and `createDraft` refuse an ended offer and a start after the end before writing anything; `createDraft` accepts an offer ending today. The four existing offer batch tests (fixtures in May 2026) now pin the clock to 1 May 2026.

## Rollback

Revert the PR. No schema, data or settings change; nothing to deploy first. Posts already scheduled are not touched either way. Drafts are unaffected; after a rollback an ended offer is accepted again and launches today.
