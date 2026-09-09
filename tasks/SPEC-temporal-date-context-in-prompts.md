# SPEC: temporal date context in content generation prompts

Status: draft, awaiting review
Date: 2026-09-08
Scope: `src/lib/ai/`, `src/lib/create/temporal-context.ts`, `src/lib/scheduling/proximity-label.ts`, `src/lib/publishing/preflight.ts`, `src/app/(app)/planner/actions.ts`
Type: prompt and validation change. No schema change, no migration.

## 1. Question this answers

Do the content generation prompts describe events in the right relation to the day the post goes out ("this Saturday", "tomorrow", "next Wednesday", "Saturday 13th November")?

**Partly.** The machinery to do it well already exists and the day maths is sound, but four things are wrong and one is a deliberate design choice that is probably the wrong call.

## 2. What the system does today

Every finding below was verified by running the real functions, not by reading them. The probe used `buildGenerationTemporalContext`, `buildUserPrompt` and `lintContent` directly under Vitest with `TZ=Europe/London`.

### 2.1 The date frame is computed from the publish date, and the maths is correct

`buildGenerationTemporalContext` (`src/lib/create/temporal-context.ts:248`) compares the slot's publish time to the event time and returns a `temporalInstruction`. Verified output for an event at 19:00 on Saturday 19 September 2026:

| Post publishes | `timingLabel` | Instruction given to the model | Overlay label |
|---|---|---|---|
| 19 Sep 07:00 (same day) | `today_morning` | "The event is today at 7pm. Naturally use 'today' or 'tonight'." | `TONIGHT` |
| 18 Sep (1 day out) | `tomorrow` | "The event is tomorrow (Saturday 19 September). Use 'tomorrow' naturally." | `TOMORROW NIGHT` |
| 16 Sep (3 days out) | `building` | "The event is on Saturday 19th September at 7pm. Use this full date; do not fall back to vague relative or countdown wording." | `THIS SATURDAY` |
| 14 Sep (5 days out) | `building` | same as above | `THIS SATURDAY` |
| 30 Aug (20 days out) | `early_awareness` | "The event is on Saturday 19th September at 7pm. Use the clear calendar date instead of 'soon'." | `SATURDAY 19TH SEPTEMBER` |

The day banding, the GMT/BST week arithmetic in `getProximityLabel` and the "this Saturday" versus "next Saturday" disambiguation are all correct and well tested (`tests/lib/scheduling/proximity-label.test.ts`, 428 lines, including four DST cases).

### 2.2 Finding A: "Post now" tells the model the event is happening now (bug, high)

When the wizard is in "post now" mode, `generate-step.tsx:522` sets `slotIso = null`. `describeEventTimingCue` (`temporal-context.ts:84`) treats a null publish time as "no schedule, therefore live" and returns:

```
timingLabel: "today_imminent"
temporalInstruction: "Use live, present-tense wording such as \"today\", \"tonight\", or \"happening now\" where natural."
```

It returns this **regardless of when the event actually is**. Verified: an event 11 days away, posted now, produces exactly that instruction. The prompt for that case also carries no "Post scheduled for" line at all, so the only timing signal the model gets is "write as if it is happening now".

The same shape applies to promotions: a promotion ending in 22 days, posted now, is labelled `promotion_last_day` with "Drive immediate interest and invite guests to take advantage now."

For `weekly_recurring` in post-now mode the function returns `{}`, so there is no timing context at all.

### 2.3 Finding B: the prompt contradicts itself (bug, medium)

The user prompt for the 5-days-out case contains all of these lines at once:

```
Event date: 2026-09-19                                    <- raw ISO, from the brief
Event date: Saturday 19th September at 7pm (Europe/London) <- same key, different format
Relative date wording: ... Use this full date in the copy; do not fall back to
  vague relative or countdown wording.
Temporal framing: This post is a countdown, 5 day(s) until the event.
  Build anticipation. Use forward-looking language like "just 5 days away".
```

One instruction forbids countdown wording, the next demands it. `Event date` appears twice with two different formats, one of which is a raw ISO string the model may echo. `Timing label: building` also leaks an internal enum name into the prompt.

### 2.4 Finding C: natural relative wording is banned in body copy, then stripped (design choice, worth revisiting)

Two mechanisms suppress "this Saturday" in the caption:

- `PUB_WRITING_RULES` (`src/lib/ai/prompts.ts:399`) forbids putting "this" or "next" in front of a specific date, and the per-event line repeats it.
- `normaliseEventDatePhrasing` (`src/lib/ai/postprocess.ts:369`) then rewrites any surviving "this Friday" or "next Friday" into "Friday 17th July" deterministically.

The result is that for the 2 to 6 day window the image strip says `THIS SATURDAY` while the caption underneath says "Saturday 19th September" and is forbidden from saying "this Saturday". Both are accurate. The caption just does not sound like a pub landlord, and the two halves of the post use different registers.

The original reason for the ban is recorded in the code and is sound: the model was leaking the uppercase overlay label into the body as "this FRI 17 JUL", and "this Friday" plus a date can imply the wrong week. The fix chosen was to ban the whole construction rather than to constrain it.

### 2.5 Finding D: the model is never told what "today" is (gap, medium)

There is no date anchor anywhere in `buildSystemPrompt`, and for an instant post in post-now mode `buildUserPrompt` emits no date line whatsoever. Verified output for a brief whose description reads "Live music this Saturday with the band":

```
Title: Quiz Night
Description: Live music this Saturday with the band
Platforms: facebook
Tone: friendly_warm
Length preference: standard
Include relevant hashtags per platform.
Accuracy guardrails: do not invent booking requirements, ...
```

The model has no way to know which Saturday, and nothing downstream can normalise it because there is no `eventStart` for an instant post. Whatever relative wording the owner types in free text ships unverified.

### 2.6 Finding E: rescheduling leaves the caption stale while the image updates (bug, high)

The banner proximity label is recomputed at publish time from the current `scheduled_for` (`supabase/functions/publish-queue/worker.ts:317`), and again on every planner render. The body copy is frozen at generation.

No reschedule path regenerates, re-validates or warns:

- `updatePlannerContentSchedule` (`src/app/(app)/planner/actions.ts:1060`, writes at `:1165`) changes `scheduled_for` and requeues the job. It re-runs media and connection readiness, never copy.
- `retryPublishJob` (`src/app/actions/publish.ts:24`) does not touch `scheduled_for`, so a post that failed on Thursday and is retried on Saturday publishes Thursday's wording verbatim.
- `tournament.ts:691` resets `scheduled_for` to now on publish-now, which can move an item by days.

Move a Friday event post from Thursday to Monday and the image strip flips from `TOMORROW` to `THIS FRIDAY` while the caption still says "tomorrow". The image and the caption contradict each other in the same post.

The data needed to detect this is already persisted: `ai_generation_params.generationContext.scheduledAt` (`src/app/actions/ai-generate.ts:115` and `:215`). Nothing ever compares it to the current `scheduled_for`.

The only stale-context warning in the app is in the create wizard before anything is saved (`generate-step.tsx:819`).

### 2.7 Finding F: the day-name lint blocks legitimate copy and misses the real risk (bug, high)

`lintContent` returns `pass = issues.length === 0` (`content-rules.ts:515`), so **any** warning fails the lint. `getPublishReadinessIssues` turns `!lint.pass` into a `lint_failed` issue (`preflight.ts:91`), and readiness issues block approval (`approve-and-schedule.ts:54`, `planner/actions.ts:214`) and rescheduling (`:1151`) with the message "Post copy failed quality checks. Regenerate the content before scheduling."

`validateDayNames` (`content-rules.ts:732`) compares every weekday name in the copy against **one** reference date, and fails if the copy contains two different weekdays. Verified with real `lintContent` calls:

| Copy | Context | Result |
|---|---|---|
| "…this Wednesday at 7pm…" (weekly recurring, publishes Monday) | no `eventStart`, falls back to publish date | `pass: false`, `day_name_mismatch` |
| "…Saturday 19th September…" | `eventStart` = that Saturday | `pass: true` |
| "…Saturday 19th September… our Sunday roast is served from noon the day after…" | `eventStart` = Saturday | `pass: false`, `day_name_mismatch` |
| "…back on Saturday with the band…" (instant post, publishes Tuesday) | no context | `pass: false`, `day_name_mismatch` |

So: a weekly recurring post that follows its own generated instruction ("This recurring event is this wednesday, use that relative timing naturally") is blocked from being approved. Any post that mentions a second day of the week is blocked. The owner is told to regenerate, which will not help, because the generator produced exactly what it was told to produce.

Meanwhile the lint never checks "today", "tonight" or "tomorrow" at all, which is the wording most likely to be wrong after a reschedule.

### 2.8 Finding G: date formats are inconsistent in code that writes into live copy (bug, low)

House style is "Weekday Nth Month" ("Saturday 19th September"), produced by `formatEventDateLong`. Three code paths produce the non-ordinal form instead:

- `temporal-context.ts:71` `formatDayMonth`, used in the "tomorrow" and all four promotion instructions, giving the model "Saturday 19 September".
- `prompts.ts:340` and `:344` and `:567`, giving "Post scheduled for Monday 14 September".
- `postprocess.ts:217` `formatCountdownDate`, which **appends a sentence into the published body**: "It ends on Sunday 30 November". This is asserted as correct in `tests/lib/ai/postprocess.test.ts:40`, so the non-house-style date is currently enshrined in a test.

### 2.9 Finding H: duplicated and orphaned temporal logic

- `describeEventTimingCue` exists twice with independent implementations: `src/lib/create/temporal-context.ts:79` (v2 wizard) and `src/lib/create/service.ts:525` (v1). Both carry the Finding A bug.
- The v1 path is reachable only via `POST /api/create/generate-stream`, and nothing in `src/` calls that route. `buildInstantPostPrompt` is invoked there with **no** `context` argument at all (`route.ts:162`), so the v1 path has no temporal context beyond `scheduledFor`.
- `proximity-label.ts` is duplicated in `supabase/functions/publish-queue/banner-label.ts` by design. Parity is covered behaviourally by 22 fixtures (`tests/lib/scheduling/proximity-label-parity.test.ts`) but there is no source-text drift check.

### 2.10 Finding I: the UTC test run is never executed

`package.json:17` defines `test:utc` (`TZ=UTC CI=1 vitest run`), but `ci:verify` (`:18`) does not include it and `.github/workflows/ci.yml:67` runs `test:ci` only. The second timezone run, which is precisely what protects this class of logic, is manual-only and in practice never runs.

### 2.11 Finding J: the day-name normaliser mangles published copy (bug, high)

Added after the 9 September review, which flagged this path. Verified independently by running `applyChannelRules` directly:

| Input | Context | Output | Repair recorded |
|---|---|---|---|
| "Join us Saturday. Sunday roast follows." | event is Saturday | **"Join us . roast follows."** | `day_names_removed` |
| "Join us Monday for the quiz." | event is Saturday | "Join us Saturday for the quiz." | `day_name_replaced` |
| "Join us Saturday for live music." | no reference date | "Join us for live music." | `day_names_removed` |
| "Join us Saturday for the quiz." | event is Saturday | unchanged | none |

`normalizeDayNames` (`content-rules.ts:706`) runs inside `applyChannelRules` (`:230`), separately from `validateDayNames`. When it sees two different weekdays it deletes **every** weekday token, leaving broken punctuation. When there is no reference date it deletes them too. When it sees one wrong weekday it silently rewrites it, which can convert an accurate sentence about a Monday into a false claim about Saturday.

`applyChannelRules` is called from `src/lib/tournament/generate.ts:141` (live) and `src/lib/create/service.ts:1498` (v1 path). Fixing the lint alone does not stop this: a later correction stage destroys the very text the validator was meant to judge.

## 3. Decisions taken

Recorded after review. These are settled; they are not open questions.

- **D1, house style.** Natural relative wording ("this Saturday") will be allowed alongside the absolute date. **Approved, but it lands in Phase 2, not Phase 1.** The 8 September draft leaked this into a Phase 1 example while claiming Phase 1 changed no house style; that contradiction is removed. Phase 1 keeps the current absolute-date style exactly as it is today.
- **D2, ambiguous free text.** Phase 1 gives the model the publish-date anchor and states the known facts. It does **not** attempt to resolve or verify relative wording the owner typed in free text, and this spec makes no claim that it does. Ambiguous owner prose is preserved.
- **D3, enforcement.** Drift detection warns first. No new blocking rule ships in Phase 1 or Phase 3 without a separate decision.
- **D4, legacy endpoint.** `/api/create/generate-stream` and its orphaned generation chain are removed. The route is a public endpoint with no caller inside `src/`; if an unknown external client exists it will receive a 404 after deploy. That risk is accepted.

## 4. Phase 1: scope and honest impact

Phase 1 fixes correctness defects and removes contradictions. It does **not** change house style.

Correcting the 8 September draft: Phase 1 is **not** "prompt text only". It changes three kinds of thing, and each has a different blast radius.

| Change | Affects | Applies to existing copy? |
|---|---|---|
| Prompt construction (4.1 to 4.4) | what the model is told | no, only new generations |
| Post-processing (4.5) | the body actually saved | yes, on next generation |
| Validation (4.6) | approval and reschedule | **yes, immediately, on copy generated before this release** |

4.6 only ever **removes** blocking conditions, never adds one, so no post that can be approved today becomes unapprovable after this release. That is the property that makes Phase 1 safe to ship without regenerating anything.

### 4.1 One effective publish instant, resolved server-side

- `buildGenerationTemporalContext` gains an explicit `referenceAt` and resolves exactly one effective publish instant per generation: a valid `scheduledAt` wins; otherwise `referenceAt`; and `referenceAt` defaults to now in `DEFAULT_TIMEZONE`.
- An **invalid** `scheduledAt` is no longer the same as an absent one. Absent means post-now. Invalid returns no temporal claims at all, so a malformed schedule can never silently become "happening now".
- The resolution moves from the browser (`generate-step.tsx:525`) into the server action, so the clock is the server's and one value feeds the prompt, the post-processor and the persisted generation context. The client keeps `getCreatePreviewBannerLabel` for preview only.
- Removes the null-schedule branches at `temporal-context.ts:84` and `:161` that cause Finding A.

### 4.2 Always state when the post publishes

`buildUserPrompt` always emits the publish line, for every content type including `instant_post` and `story`, and including post-now ("This post publishes today, Wednesday 9th September, at 3:40pm"). This is the anchor Finding D showed was missing. Per D2 it is an anchor, not a verification.

### 4.3 One timing block, current house style

Replace the scattered lines with a single block built by one function:

```
Timing (Europe/London):
- This post publishes on Monday 14th September at 10:00am.
- The event is on Saturday 19th September at 7pm, 5 days after this post publishes.
- Write the event date in full as "Saturday 19th September".
- Do not write "today", "tonight" or "tomorrow": the event is not on the day this post publishes.
```

The forbidden list is derived from the day gap, so it is always consistent with the image label's banding. The permitted vocabulary in Phase 1 is the absolute date only, matching today's house style.

Removed: the raw `Event date: ${brief.eventDate}` ISO line (`prompts.ts:541`), the `Timing label:` internal enum (`:605`), and the countdown vocabulary in `buildTemporalInstructions` that contradicts the block. The slot label keeps its narrative purpose ("this is the last reminder before the event") but stops issuing date wording.

The existing deliberate exclusion of `context.proximityLabel` (`prompts.ts:609`) stays exactly as it is. The 8 September draft implied Phase 1 newly removed that leak; it does not, it was already excluded, and the regression guard at `tests/lib/ai/prompts.test.ts:294` stays.

### 4.4 Ordinal dates everywhere

Fix `formatDayMonth` (`temporal-context.ts:71`), `formatCountdownDate` (`postprocess.ts:217`), and the three date formatters in `prompts.ts` (`:340`, `:344`, `:567`) to use `formatEventDateLong`. Update `tests/lib/ai/postprocess.test.ts:40` to expect "Sunday 30th November". `formatCountdownDate` writes into the published body, so this one is user-visible.

### 4.5 Stop the normaliser mangling copy

`normalizeDayNames` changes from "delete or replace" to conservative:

- two or more different weekdays: **leave the copy alone** (previously deleted all of them, producing "Join us . roast follows.");
- no structured date to judge against: **leave the copy alone** (previously deleted the weekday);
- the reference date is now the **subject** date (event start, occurrence, promotion start or end), never the publish date. "Live music Saturday" scheduled for a Tuesday used to be rewritten to "Live music Tuesday", because `resolveReferenceDate` fell back to `scheduledFor`;
- one weekday that contradicts the structured **event** date: still corrected.

Amended during implementation. The 9 September draft proposed dropping that last replacement too. Keeping it matters: without it, copy that is silently auto-repaired today would instead reach the day-name lint and be reported, and the release would stop being a pure reduction in blocking. It is also the one case where the correction is well founded, a single weekday token in an event post is almost certainly naming the event.

The net effect is still a strict reduction in mutation: nothing correct today gets changed, and text that is currently destroyed survives.

### 4.6 Stop the lint blocking legitimate copy

`validateDayNames` checks weekday mentions against a **set** of legitimate dates (event start, publish date, promotion start and end) instead of one, and stops failing merely because two different weekdays appear.

Amended during implementation. The set alone is not enough. "Quiz Saturday, Sunday roast after" still reports a mismatch, because nothing in the brief supplies Sunday and a set of dates cannot know the roast is real. So `day_name_mismatch` also becomes **advisory**: it is reported in `lint.issues` but no longer fails `lint.pass`, and therefore no longer reaches preflight as a hard block. `lintContent` keeps `pass = false` for every other issue; only this one code is exempt, via an explicit `ADVISORY_LINT_CODES` set.

Stated limits, per the review and per D2:

- a set cannot tell which claim a weekday belongs to, so "The event is on Monday" where Monday is the publish day still passes. That false accept exists today too;
- with no structured date in the brief there is nothing to contradict, so nothing is reported. This function judges copy against supplied facts; it does not verify free text.

Phase 1 removes the false **blocks**, which are the demonstrated harm, and claims nothing more. Semantic claim validation is explicitly out of scope, as is any UI for surfacing the advisory, which Phase 3 needs anyway for the drift warning.

The message now names the offending day rather than saying only that quality checks failed.

### 4.7 Remove the orphaned v1 path

Deleting the route orphans the whole of `src/lib/create/service.ts`: every one of its exports is reachable only from that route or from its own tests. Removed, 3,969 lines in total:

| File | Lines |
|---|---|
| `src/lib/create/service.ts` | 1,632 |
| `tests/lib/create/service.test.ts` | 943 |
| `tests/api/generate-stream-route.test.ts` | 383 |
| `tests/lib/create/event-campaign-plans.test.ts` | 348 |
| `tests/lib/create/service-engagement.test.ts` | 315 |
| `src/app/api/create/generate-stream/route.ts` | 219 |
| `tests/lib/create/banner-override.test.ts` | 129 |

This takes the duplicate `describeEventTimingCue` (`service.ts:525`) with it, which was the reason for the decision.

`buildInstantPostPrompt` (`prompts.ts`) and `postProcessGeneratedCopy` (`postprocess.ts`) are now unused by application code, but they are **kept**. They live in files the live v2 path depends on, their private helpers are interleaved with v2 helpers, and `tests/integration/smart-scheduling-and-copy.test.ts` still exercises `buildInstantPostPrompt`. Untangling them is a separate refactor with real risk to the live path and no behavioural benefit, so it is deliberately not part of this release.

## 5. Deferred, with reasons

- **Phase 2, natural relative wording.** Approved (D1), deferred so that Phase 1 has one acceptance oracle. Needs its own vocabulary table covering 7 or more days, where the image label already emits `NEXT <weekday>`.
- **Phase 3, schedule drift.** Blocked on a real per-body provenance contract. The review is right that `ai_generation_params.generationContext.scheduledAt` is written to the **draft** content id (`ai-generate.ts:111`), while `createScheduledBatch` (`content.ts:876`) then inserts separate rows per slot, platform and placement that do not carry it. There is therefore no reliable per-caption baseline today, and any drift check built on the draft field would compare against the wrong slot. Phase 3 must first define and persist a per-item generation reference. Its coverage must also include approve-now, automatic retry (`handler.ts:256`), tournament publish-now (`tournament.ts:695`) and delayed queue delivery, not just manual reschedule.
- **Promotion start versus end, and noon events.** The review showed a promotion post can carry overlay `THIS SATURDAY` (start) alongside an instruction about ending Wednesday 30 September (end), and that a noon event labelled `TODAY` still permits "tonight". Both are real. Phase 1's timing block states the facts and derives its forbidden list from the same gap the label uses, which removes the "tonight" case; the start-versus-end modelling is a Phase 2 concern.

## 6. Test requirements for Phase 1

1. **Effective instant resolution**, with an injected clock: valid `scheduledAt` wins; absent falls back to the clock; invalid yields no temporal claims and never the live branch.
2. **Post-now regression**: an event 11 days away, generated with no schedule, must not be described as happening today, tonight or now. Asserted on the event claim specifically, since the publish line legitimately contains the word "today".
3. **Day-gap matrix**, table-driven from 1 day after the event to 21 days before, asserting the publish line, the event line, and the forbidden vocabulary per band, for `event`, `promotion`, `weekly_recurring`, `instant_post` and post-now.
4. **No contradiction**: the forbidden vocabulary must never contain a word the same prompt elsewhere instructs the model to use. Asserted across the whole matrix.
5. **Normaliser**: "Join us Saturday. Sunday roast follows." survives intact; a missing reference date leaves copy untouched; correct single-weekday copy is still untouched.
6. **Lint**: two legitimate weekdays pass; weekly-recurring wording against its own publish date passes; a weekday matching none of the legitimate dates still fails.
7. **Format**: no model-visible or user-visible rendered date in the non-ordinal form, asserted on generated prompt text and on the post-processed body.
8. **DST**: the `TODAY` / `TONIGHT` / `TOMORROW` / `THIS <weekday>` bands either side of 29 March and 25 October, which today are only covered at 7 and 13 days.
9. **Both timezones**: add `test:utc` to `ci:verify` and to `.github/workflows/ci.yml`. Correcting the 8 September draft: configuration shows UTC is not an automatic gate, which is not the same as proving it has never been run manually.

## 7. Rollback

Revert. Phase 1 persists no new state and applies no migration. Prompt changes affect only later generations. The post-processing change affects bodies generated after it. The validation change only lifts blocks, so a revert restores the previous, stricter behaviour without leaving anything stranded. Copy already generated is never rewritten.
