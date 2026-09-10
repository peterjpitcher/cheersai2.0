# SPEC: Evergreen delivery schedule (chosen days and hours)

Status: approved 10 September 2026, built as four stacked PRs. Complexity 4 (7+ files, the Meta
Marketing API, a new column).

## What changes

An evergreen campaign (`campaign_kind 'evergreen'`, `source_type 'custom_promotion'`) can carry a
delivery schedule: the days of the week and the whole hours its Meta ad set may deliver. Without
a schedule, nothing changes: the ad set delivers at any time, as every campaign does today.

## Why

The Anchor's weekday lunch and dinner ads must never deliver on a Monday (the kitchen is closed)
and should only run in the hours people choose each meal: lunch Tuesday to Friday 09:00 to 14:00,
dinner Tuesday to Friday 14:00 to 20:00, UK time, on lifetime budgets. Evergreen campaigns cannot
do this today, and `food_booking` does not fit (dinner only, no traffic optimisation, no image
step). Delivery hours also keep the copy honest: a lunch ad only runs on a day lunch is served.

## Meta rules (Graph v24.0, checked on developers.facebook.com, 10 September 2026)

- Ad set params `pacing_type: ["day_parting"]` and `adset_schedule: [{ start_minute, end_minute,
  days, timezone_type }]`.
- `days` run 0 to 6, 0 = Sunday. Whole hours only (minutes are multiples of 60), at least one hour.
- Lifetime budgets only, so the ad set needs an `end_time`. With campaign budget optimisation the
  pacing moves to the campaign; evergreen does not use it, so the schedule sits on the ad set.
- `timezone_type` is `USER` or `ADVERTISER`. We send `ADVERTISER`: the ad account runs on
  Europe/London (checked in `meta_ad_accounts.timezone` on the live project).

## Design

**Storage.** New nullable column `public.meta_campaigns.delivery_schedule jsonb`, checked to be
null or a JSON object. Null means no schedule. Not a key in `source_snapshot`, which is rebuilt at
generation and rewritten at publish. Stored form: `{"days": ["tuesday", ...], "startHour": 9,
"endHour": 14}`, days in week order, `endHour` exclusive (24 allowed).

**Type.** `DeliverySchedule { days: RunDay[]; startHour: number; endHour: number }` in
`src/types/campaigns.ts`, next to `RunDay`.

**Module.** `src/lib/campaigns/delivery-schedule.ts`, pure, Luxon, no I/O, safe in the browser:
- `validateDeliverySchedule(value, { campaignKind, budgetType, startDate, endDate })` returns the
  first problem in plain English, or null. Rules: evergreen only; lifetime budget only (daily is
  rejected); at least one day, no repeats, known days only; whole hours with
  0 <= start < end <= 24; an end date; at least one scheduled weekday between the start and end
  dates, counted as Europe/London calendar days.
- `normaliseDeliverySchedule` puts days in week order before storing.
- `toMetaAdSetSchedule` maps to Meta: day numbers (Sunday 0), hours x 60, `ADVERTISER`.
- `metaAdSetScheduleMatches` compares what Meta reports back with what was sent.
- `describeDeliverySchedule` gives plain English for the prompt and UI, for example
  "Tuesday to Friday, 09:00 to 14:00".
- Copy helpers (PR 3): the words a schedule rules out, and the phrases to keep out of ad copy.

**Where validation runs.** The brief form (`validateBriefForm`), `generateCampaignAction` before any
external call, `validatePaidCampaignMeta` on save, and the publish preflight. The preflight also
refuses when the stored schedule is malformed or the ad account time zone (the stored
`meta_ad_accounts.timezone`) is not Europe/London. All of these stop before any Meta call.

**Meta client** (`src/lib/meta/marketing.ts`). `CreateAdSetParams.schedule` is optional.
`createMetaAdSet` throws before sending anything if a schedule comes with a daily budget, without
a lifetime budget, or with campaign budget optimisation; otherwise it adds `pacing_type` and
`adset_schedule`. Without a schedule the request body is byte-for-byte unchanged. A small
read-back helper built on the existing `metaGet` fetches `pacing_type,adset_schedule`.

**Publish** (`src/app/(app)/campaigns/[id]/actions.ts`). Selects the column, passes the Meta
schedule to ad set creation, and reads each scheduled ad set back from Meta as soon as it is
created (or resumed on a retry), before its ads are built and before anything is switched on. A
mismatch, or a read-back that fails, throws into the existing rollback: every object created in
this attempt is paused, the campaign returns to draft and the reason is saved in `publish_error`.
A read-back without `day_parting`, with different days or minutes, or without `timezone_type
ADVERTISER` counts as a mismatch.

**Save** (`saveCampaignDraft`). Writes the normalised schedule. The insert only carries the
`delivery_schedule` key when there is a schedule, so saving a campaign without one sends exactly
what it sent before.

**Copy** (PR 3, `src/lib/campaigns/generate.ts`). `GenerateInput` takes the schedule and the prompt
gains a line such as "These ads only show Tuesday to Friday, 09:00 to 14:00; never mention Monday,
the weekend, or every day." A new copy check, `off_schedule_day`, flags a day outside the
schedule (full name, or a capitalised abbreviation such as "Mon" or "Sat"), "weekend" unless both
weekend days are scheduled, and "every day", "everyday", "daily" or "7 days a week" unless all
seven days are. It feeds the existing correction loop. `saveCampaignDraft` re-runs this one check
on the copy as saved, because hand edits on the review screen skip every generation check today.
No other generation check starts running on save.

**UI** (PR 4, evergreen only). A checkbox "Only deliver on chosen days and hours", off by default.
When on: seven day checkboxes (none ticked to start, so every delivery day is a deliberate choice)
and start and end hour selects in whole hours (00:00 to 24:00 to start). Turning it on forces the
Total budget and disables Daily. A line under the controls shows the schedule in words, or the
reason it cannot be used, and Generate stays disabled until it can. The schedule clears when the
campaign type changes, is sent to both the generate and save actions, and shows under Campaign
checks on the review screen with the number of delivery days in the flight.

## Delivery and deploy order

| PR | Branch | Contents | Depends on |
|---|---|---|---|
| 1 | `feat/delivery-schedule-1-migration` | this spec, the migration, schema doc, SQL verify script | main |
| 2 | `feat/delivery-schedule-2-backend` | module, type, Meta client, save, publish, read-back | 1 |
| 3 | `feat/delivery-schedule-3-copy` | prompt line, `off_schedule_day`, save-time re-check | 2 |
| 4 | `feat/delivery-schedule-4-ui` | form controls and review display | 3 |

**The migration must be applied to production before PR 2 merges.** PR 2 selects the column at
publish, so publishing any campaign fails if PR 2 reaches production first. PR 1 on its own
changes nothing: no code reads the column. Each later PR changes nothing for a campaign without a
schedule, and nothing can create a schedule until PR 4 ships the controls.

Merging to main deploys to production (Vercel). After the migration: `npx supabase migration list`
to confirm the remote list matches, then run `supabase/tests/meta_campaigns_delivery_schedule_verify.sql`
against the live project (it writes nothing lasting).

## Rollback

- PR 3 and PR 4 revert cleanly.
- Revert PR 4 before PR 2, and revert PR 2 only when no draft campaign holds a schedule (a reverted
  publish path would ignore it and deliver every day).
- A campaign already on Meta keeps its schedule there; pause it from the app if needed.
- The column stays. Dropping it (`alter table public.meta_campaigns drop column if exists
  delivery_schedule;`) discards stored schedules and needs the owner's approval.

## Tests

- PR 1: the migration applied from scratch on a local database with the whole chain (v1 baseline
  staged as CI does), then the verify script, then `supabase db lint`.
- PR 2: `tests/lib/campaigns/delivery-schedule.test.ts` (mapping, every rejection, the flight
  15 September to 9 October 2026, a flight crossing the 25 October 2026 clock change); Meta client
  tests (body with and without a schedule, guards throw before any request, read-back parsing);
  publish tests with Meta mocked (schedule passed; null unchanged; daily budget or wrong time
  zone stops before any Meta call; read-back mismatch rolls back); save tests.
- PR 3: prompt line and `off_schedule_day` with OpenAI mocked, including the correction loop; the
  save-time re-check.
- PR 4: the brief form, modelled on `campaign-brief-form.food.test.tsx`.

Every PR passes `npm run ci:verify`, which includes `npm run test:utc`.

## Decisions

- Own column, not `source_snapshot` (see Storage).
- `ADVERTISER` time zone, guarded by the stored ad account time zone at publish.
- Read-back runs straight after each ad set is created or resumed, so a bad ad set never gets ads
  and nothing is ever switched on with an unconfirmed schedule. Fails closed.
- Abbreviations only count when capitalised ("Sun", "SAT"), so "in the sun" or "sat down" do not
  trip the copy check; full day names count in any case.
- The day boxes start empty, so no delivery day is chosen by default.
- Only `off_schedule_day` runs on save; the other generation checks stay generation-only.
