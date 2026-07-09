# SPEC — Weekly recurring: CTA link, multi-day + end-date defaults, planner overlay

**Status:** Draft for approval
**Date:** 2026-07-09
**Complexity score:** 4 (L) — must ship as 3 PRs (see PR plan)
**Supersedes (partially):** `tasks/SPEC-weekly-recurrence-story-gbp-removal.md` decisions D2, D4 (schedule model) and its acceptance criterion "Creating a weekly-recurring post never shows a date calendar and never requires picking a date" (that spec :42, :44, :91). Its D6 ("no path can produce unbounded recurrence"; legacy materialisers stay retired) is **preserved and load-bearing** here.

---

## 1. What is changing (user-facing)

For the **weekly recurring** campaign type only:

1. **CTA link** — an optional "Campaign link" URL on the brief (feed placement only — see D7). When set, it is appended to the Facebook copy of every occurrence (`Book a table: <url>`), Instagram copy gains a "link in bio" line pointing at the bio page (Instagram never carries URLs — enforced at prompt, post-process and compose layers), and the campaign appears as a card on the public link-in-bio page for the duration of the campaign, linking to that URL.
2. **Recurrence defaults** — multi-select **days of the week** (was: single-day radio) and an **end date** (was: "Number of posts" slider 1–12).
3. **Planner overlay** — the derived occurrences are shown on the same schedule calendar used by event/promotion campaigns, overlaid on the existing plan. The user can remove, add and move dates before copy is generated, so they choose exactly which dates content is generated for.

Everything else about weekly recurring (feed/story placement, upfront AI copy generation with per-slot approval, auto-publish once approved, pinned `content_items` rows) is unchanged.

## 2. Current behaviour (verified against code, 2026-07-09)

- Brief form captures a **single** day-of-week radio (0=Sun..6=Sat), HH:MM time, feed|story placement, and a 1–12 "Number of posts" slider (`weeksAhead`) — no end date, no CTA field ([weekly-recurring-fields.tsx](src/features/create/forms/weekly-recurring-fields.tsx:66)).
- Schema: `weeklyCampaignBriefSchema` — `dayOfWeek` single int 0–6, `time`, `weeksAhead` 1–12 default 4 ("not a calendar end date"), `placement` ([content-schemas.ts:105](src/features/create/schemas/content-schemas.ts:105)). The **base** schema already has optional `ctaLinks: { facebook?, instagram? }` for all types (content-schemas.ts:52-58); only the event form populates it, via management-app import.
- Schedule step **hides the calendar** for weekly (`showCalendar = !isWeeklyRecurring…`, [schedule-step.tsx:282](src/features/create/steps/schedule-step.tsx:282)); an effect force-syncs `selectedSlots` to the derived occurrences on every change, bypassing deconfliction and the 12-slot cap (schedule-step.tsx:186-205); a read-only list tells the user they don't pick dates (:350-376).
- Occurrences derived by `buildWeeklySuggestions(today, dayOfWeek, time, weeksAhead)` — next matching weekday ≥ now+15min, then +7d × N, ids `week-N`, labels "Week N" ([suggestion-utils.ts:46](src/features/create/schedule/suggestion-utils.ts:46)).
- AI copy is generated **upfront per slot** in the Generate step (concurrency 3), approved by the user, and persisted verbatim; `composePublishBody` bakes the CTA into `content_variants.body` at creation — Facebook: `"<ctaText>: <url>"` appended; Instagram: link-in-bio line, never a URL ([compose-body.ts:32](src/lib/publishing/compose-body.ts:32); weekly defaults "Book a table" / "Link in bio to book a table" at :96-119). `sanitizePublishBody` strips any other URL, so the structured `ctaLinks` field is the **only** way a link enters copy ([copy-rules.ts:38](src/lib/publishing/copy-rules.ts:38)).
- `createScheduledBatch` writes one `campaigns` row (`campaign_type='weekly'`, `status='scheduled'`, `metadata = { brief, slotCount, dayOfWeek, time, weeksAhead }`) and one `content_items` + `content_variants` + `publish_jobs` per slot×placement×platform ([content.ts:642](src/app/actions/content.ts:642); metadata at [build-campaign-metadata.ts:57](src/lib/publishing/build-campaign-metadata.ts:57)). It does **not** write `campaigns.start_at`, `end_at` or `link_in_bio_url`.
- The link-in-bio public page (`/l/[slug]`, `force-dynamic`) already renders **campaign cards** derived per request from `content_items` (placement `feed`, platform in ig/fb, status scheduled/publishing/posted) joined to `campaigns`, but only when a link resolves via `campaigns.link_in_bio_url` → `metadata.linkInBioUrl` → `metadata.ctaUrl` ([public.ts:308,621](src/lib/link-in-bio/public.ts:621)). Card shows from the first live post until `max(displayEndsAt endOfDay, last post endOfDay)` (:273-280, :729-737). Weekly window logic (`extractCampaignTiming` + `getNextWeeklyOccurrence`) already reads `metadata.dayOfWeek` (single) and `metadata.displayEndDate ?? metadata.endDate` ([campaign-timing.ts:39](src/lib/scheduling/campaign-timing.ts:39)). Because the wizard writes neither a link nor an end date, **v2 weekly campaigns never appear on the page today**, and if they did the card would never expire.
- The dormant weekly materialisers (`supabase/functions/materialise-weekly`, `/api/cron/recurring-publish` → `materialiseRecurringCampaigns`) are confirmed **never running in prod** (pg_cron not installed; zero fingerprint rows across 8.5 months; all 69 weekly items came from the wizard). `docs/runbook.md:75` ("runs daily at 05:00") is stale.

## 3. Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Brief gains `daysOfWeek: number[]` (unique ints 0–6, min 1, max 7) replacing single `dayOfWeek`. One shared `time` for all selected days. | Multi-select requested; per-day times are scope creep — park. |
| D2 | Brief gains `endDate` (`YYYY-MM-DD`, Europe/London) replacing `weeksAhead`. Occurrences = every selected weekday from the first valid occurrence (≥ now+15min) up to and including `endDate`. | End date requested. Bounded by construction — preserves the "no unbounded recurrence" constraint without any background job. |
| D3 | Hard cap of **12 occurrences** per campaign, enforced in the form (live counter + validation), in the wizard step gate, and **server-side** in `createScheduledBatch` (which currently has no slot cap at all). 0 occurrences is also a validation error. | 12 is the existing `MAX_SLOTS_DEFAULT` and each occurrence is an upfront AI generation the user must review. See Open question Q1. |
| D4 | New builder `buildWeeklyMultiDaySuggestions(daysOfWeek, time, endDate)` with **date-based unique ids** (`weekly-<yyyy-MM-dd>`) and labels `"<Weekday> · Week <n>"`. | The current `week-N` ids/labels would duplicate across days and break React keys and the seed logic. Resolves SPEC-create-flow open question 4 (weekly slots get semantic weekday labels). |
| D5 | Weekly uses the standard `ScheduleCalendar` overlay: remove the `isWeeklyRecurring` exclusion and the force-sync effect. Derived occurrences are **pre-selected once** (initial seed); after that the user adds/removes/moves slots exactly like event/promotion. No silent deconfliction drops — clashes are visible because existing planner posts render on the calendar. | "Just like every campaign type" plus not losing the cadence the user just configured. See Open question Q2. |
| D6 | Add an `onMonthChange` callback to `ScheduleCalendar` and fetch further months incrementally in schedule-step (the existing `fetchedRangesRef` merge logic already supports it). | Month navigation is currently internal-only, so existing-post overlay goes blind past the initial fetch window. (Note: the actual window is centre−1 to centre+2 calendar months — ~4 months, not the "3-month window" the in-code comment at schedule-step.tsx:93 claims — but a 12-week end date can still reach past it, and the user can page anywhere.) |
| D7 | CTA capture: one optional URL field **"Campaign link"** on the weekly brief form, stored as **both** `brief.ctaLinks.facebook` and `brief.ctaLinks.instagram`. **Feed placement only** — the field is disabled with a hint when placement = story, because story rows carry no composed body at all (`body = ''` for stories, content.ts:827-831) and the bio-card query is feed-only, so a story CTA would surface nowhere. No CTA-label field — the existing defaults ("Book a table" on FB, card label "Book a table") stand. | The downstream pipeline (prompt instruction → postprocess dedupe → compose) works off `ctaLinks`; zero new composition code. Setting the instagram key is what enables the IG "link in bio" line — verified: with facebook-only links, Instagram gets **no** line (compose-body.ts:59 + copy-rules.ts:86-89; postprocess.ts:496-497 also strips AI-written ones). Mirrors the event import precedent (instagram = link-in-bio short link). Label customisation parked — Q3. |
| D8 | CTA persistence for link-in-bio: `createScheduledBatch` writes `campaigns.link_in_bio_url = brief.ctaLinks.facebook` (trimmed) when set. Column exists in prod (v1 baseline, indexed); the action already uses the service-role client, and the v1 flow set this column the same way (`src/lib/create/service.ts:1006`) — **no migration, no RLS change**. | First entry in the card's link resolution chain; the card then appears/expires automatically. |
| D9 | Campaign metadata (weekly branch of `buildCampaignMetadata`) becomes `{ brief, slotCount, daysOfWeek, dayOfWeek: daysOfWeek[0], time, endDate }`. `dayOfWeek` is kept as the first selected day for **backwards compatibility** with every existing reader; `weeksAhead` is dropped. | `extractCampaignTiming`, the link-in-bio window, and the duplicated banner-label logic all read top-level `dayOfWeek`/`time` (the A2 contract in SPEC-create-flow-improvements :246-307). `endDate` is already consumed by `campaign-timing.ts:48-53`. |
| D10 | `extractCampaignTiming` / `getNextWeeklyOccurrence` (and the card's next-occurrence label) learn `daysOfWeek[]`: next occurrence = soonest across all selected days. Fall back to single `dayOfWeek` when `daysOfWeek` is absent — the 10 live weekly campaigns keep working unchanged. The duplicated logic in `supabase/functions/publish-queue/banner-label.ts` is updated in the same PR. | Multi-day correctness for planner/banner/bio labels. The Deno copy is outside app tsc/eslint — it is covered by Vitest and deployed separately, so it must not be forgotten. |
| D11 | No new background jobs, no campaign-status automation. The series ends because no rows exist beyond `endDate`; the bio card expires via `metadata.endDate`. The dormant materialisers are **not** taught the new fields and stay retired; `docs/runbook.md:75` is corrected in passing. | Preserves prior D6; a status-flip to `completed` has no consumer today — parked. |

## 4. Detailed design

### 4.1 Feature 2 — multi-day + end date (foundation)

**Schema** (`src/features/create/schemas/content-schemas.ts:105-115`):

```ts
daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7)
  .refine(unique)                       // replaces dayOfWeek
time: unchanged
endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)  // replaces weeksAhead
placement: unchanged
```

Cross-field refinement: derived occurrence count must be ≥1 and ≤12 (shared helper used by form, wizard gate and server — single source of truth in `suggestion-utils.ts`).

**Form** (`weekly-recurring-fields.tsx`): day radio group → checkbox group (same Mon–Sun order); slider → date input (min = today, London); live helper text: *"Mon + Thu until 31 Aug — 9 posts"*, turning into an inline error when 0 or >12. Wizard defaults (`create-wizard.tsx:265`) become `{ daysOfWeek: [1], time: '12:00', endDate: today+4 weeks, placement: 'feed' }` (matches today's effective default of 4 occurrences).

**Draft back-compat:** a mid-wizard draft saved under the old shape (`dayOfWeek`, `weeksAhead`) is upgraded on load: `daysOfWeek = [dayOfWeek]`, `endDate = anchor + (weeksAhead−1)×7 days`. Zod `z.preprocess` on the weekly schema, so both the wizard resume path and `createScheduledBatch` re-parse handle it.

**Builder:** `buildWeeklyMultiDaySuggestions(daysOfWeek, time, endDate)` in `suggestion-utils.ts` — for each London calendar day from today to `endDate`, emit a suggestion when its weekday is selected and the slot is ≥ now+15min. Ids `weekly-<yyyy-MM-dd>`, labels `"<Weekday> · Week <n>"` (week counted from the first occurrence). Existing `buildWeeklySuggestions` is deleted with its callers (no other consumers — verify at implementation time).

**Persistence knock-ons:**
- `createDraft` (`content.ts:131-134`): `recurring_day_of_week = daysOfWeek[0]` (column is a single-int CHECK 0–6 used only for mid-wizard planner ghosts — no migration).
- `materialiseRecurring` (`src/lib/scheduling/materialise.ts:204-257`, the **pure planner-display function** for mid-wizard draft ghosts — unrelated to the retired DB materialisers): read `daysOfWeek`/`endDate` from `bodyDraft.brief`, falling back to the single-day/`weeksAhead` behaviour for old rows. (Batch-created weekly rows do pass through this function via the planner page but are excluded by the `recurringDayOfWeek == null` guard at materialise.ts:214 — keep that guard intact.)
- `campaign-timing.ts` + `banner-label.ts` per D9/D10.

### 4.2 Feature 3 — planner overlay / date picking

In `schedule-step.tsx`:
- Remove `isWeeklyRecurring` from the `showCalendar` exclusion (:282-284) and delete the force-sync effect (:186-205). Replace with a **seed-once** effect: when the weekly brief's `daysOfWeek`/`time`/`endDate` change and the user has not manually edited slots, reset `selectedSlots` to the derived set; after the first manual add/remove, stop re-seeding (dirty flag). This is the same "suggestions + user control" model other types get, minus the tedium of hand-adding 12 slots.
- Weekly slots go through the normal `handleAddSlot`/`handleRemoveSlot` (12-cap, past-slot rejection, dedupe). Un-selected derived occurrences remain visible as orange suggestion chips, re-addable.
- Wizard slot-count validation (`create-wizard.tsx:320-330`): remove the weekly bypass — weekly now requires ≥1 selected slot like everyone else.
- `ScheduleCalendar` gains `onMonthChange?(monthKey)`; schedule-step wires it to `loadExistingItems` so existing-post overlay follows the user (fetches are cached per month key already).
- Story placement: the existing single-story-slot rule applies to other types via slot caps; weekly story placement keeps its current semantics (each occurrence is its own fresh 24h story) — no change.

After submission nothing changes: slots become ordinary concrete `content_items` rows, which the planner already displays; delete/reschedule per occurrence already works via the planner item page.

### 4.3 Feature 1 — CTA link

- **Capture:** "Campaign link (optional)" URL input on the weekly form → `setValue('ctaLinks', { facebook: url, instagram: url })`. Zod base schema already validates the entries as URLs; `resolvePlatformCtaUrl` re-guards http(s) server-side.
- **Facebook copy:** no new code. `generateContent` already passes `brief.ctaLinks` into prompts (AI is told never to write the URL) and postprocess; `createScheduledBatch` → `composePublishBody` appends `Book a table: <url>` to each Facebook body and persists it in `content_variants.body`. Publish worker publishes the body verbatim, so every occurrence in the campaign window carries the link — "for the duration" holds by construction.
- **Instagram copy:** setting `ctaLinks.instagram` enables the "link in bio" line (default *"Link in bio to book a table"*), which is correct because the campaign card is on the bio page. The URL itself never appears (three-layer enforcement stays). **Verified:** with only `ctaLinks.facebook` set, Instagram would get no line at all — hence mapping the field to both keys (D7).
- **Link-in-bio page:** `createScheduledBatch` writes `campaigns.link_in_bio_url` (D8) and `metadata.endDate` (D9). The existing card machinery then does the rest: card visible from the first live post, labelled with the next occurrence ("Wednesday at 7pm"), expiring at midnight London after `endDate` (or the last post, whichever is later). The page is `force-dynamic` with an hourly client refresh — **no cache invalidation work is needed or added**; `revalidatePath('/planner')` stays as-is.
- **Story placement:** stories carry no composed body (`body = ''`, banner off — content.ts:827-848) and the card query hard-filters `placement='feed'`, so a CTA link on a story-placement weekly campaign would surface nowhere. The field is therefore **disabled when placement = story**, with hint text: *"Links aren't available on story campaigns — switch to Feed to use one."* When disabled, no `ctaLinks` and no `link_in_bio_url` are written (Q4).
- **No click tracking** on campaign cards (pre-existing; explicitly out of scope, matching docs/link-in-bio-scope.md non-goals).

## 5. Out of scope (parked, not forgotten)

- Per-day times / "every N weeks" cadence (re-affirms prior spec D3).
- CTA label customisation (Q3) and Instagram-specific CTA URLs.
- Click tracking for link-in-bio campaign cards.
- Retiring/deleting the dormant materialisers (`materialise-weekly` edge fn, `/api/cron/recurring-publish`, `campaign-materialiser`) — separate cleanup task; this spec only corrects `docs/runbook.md:75` and refuses to extend them.
- Stopping/pausing a live series after creation (no such action exists for any campaign type today; occurrences can be deleted individually from the planner).
- Restore-from-trash publishing at a stale past time (pre-existing behaviour, unchanged by this spec).

## 6. Edge cases

| Case | Behaviour |
|------|-----------|
| End date before first valid occurrence | 0 occurrences → form validation error, cannot proceed. |
| Days × weeks > 12 | Validation error with the live counter showing the maths; user shortens range or removes a day. |
| DST transitions (spring/autumn) | All derivation via Luxon in Europe/London; occurrence times stay at wall-clock `time`. Unit-tested across the 2026-03-29 and 2026-10-25 boundaries. |
| Legacy weekly campaigns (10 in prod, `metadata.dayOfWeek` single, no endDate) | All readers fall back to single-day; bio cards for them remain link-less (unchanged — no backfill). |
| Old mid-wizard draft resumed | Brief upgraded via preprocess (4.1). |
| CTA URL invalid / non-http(s) | Rejected by Zod at the form; `resolvePlatformCtaUrl` re-guards server-side. |
| AI writes its own URL or duplicate CTA | Existing `sanitizePublishBody` + postprocess dedupe strip it (unchanged, covered by existing tests). |
| User removes every pre-selected slot | Same as other types: cannot proceed past Schedule with 0 slots. |
| Occupied day (existing post on a derived date) | Slot stays selected; the clash is visible on the calendar (existing posts render in the same cell). No silent drop. Planner-side 30-min conflict detection is unchanged (and still doesn't fire for wizard rows — pre-existing gap, out of scope). |
| Placement switched to story after a link was entered | Field disables and the URL is cleared from the brief; switching back to feed re-enables an empty field. Story rows always have `body = ''` (existing behaviour) — a regression test pins that no CTA leaks into story rows. |

## 7. Acceptance criteria

1. Weekly brief shows day **checkboxes**, time, **end date**, placement, and optional **Campaign link** — no "Number of posts" slider.
2. Live occurrence counter; 0 or >12 occurrences blocks progression with a plain-English message; the same cap is enforced in `createScheduledBatch` (reject with `{ error }`).
3. Schedule step shows the standard calendar with existing posts overlaid; derived occurrences arrive pre-selected; the user can remove any, add custom dates/times, and page months with existing posts loading as they go.
4. Copy is generated only for the finally-selected slots.
5. With a CTA link set (feed placement): every Facebook `content_variants.body` ends with `Book a table: <url>`; Instagram bodies contain a link-in-bio line and no URL; `campaigns.link_in_bio_url` and `metadata.endDate` are persisted; `/l/<slug>` shows the campaign card from first live post and stops showing it after the end date (verified by unit tests on the window functions, not by waiting).
6. Without a CTA link: output is byte-identical to today's (no card, no appended lines).
6a. With placement = story: the Campaign link field is disabled with the hint text, and story rows keep `body = ''` even if a URL was entered before switching placement.
7. The 10 existing prod weekly campaigns still parse: `extractCampaignTiming` returns the same result as before for single-`dayOfWeek` metadata (regression test with a real metadata fixture).
8. `npm run ci:verify` green; `publish-queue` edge function redeployed if `banner-label.ts` changed.

## 8. Test requirements

- **`suggestion-utils`**: multi-day derivation (ordering, week numbering, unique ids), end-date inclusivity, ≥now+15min anchor, DST boundaries, 0-occurrence and >12 cases.
- **`content-schemas`**: daysOfWeek bounds/uniqueness, endDate format, cross-field count refinement, old-draft preprocess upgrade (extend existing `content-schemas.test.ts`).
- **`build-campaign-metadata`**: new weekly shape incl. `dayOfWeek` back-compat mirror.
- **`campaign-timing`**: multi-day next-occurrence, single-day fallback (prod-shaped fixture), endDate parsing.
- **`banner-label` (edge fn)**: same cases as campaign-timing — Vitest, since Deno code is outside app tsc/eslint.
- **`compose-body` / `copy-rules`**: weekly + both `ctaLinks` keys → FB gets `Book a table: <url>`, IG gets the link-in-bio line and never the URL; facebook-only ctaLinks → **no** IG line (pins the behaviour that forced D7's both-keys mapping). Extend existing tests.
- **link-in-bio `public.ts` window fns**: card appears/expires around `metadata.endDate`; no card when `link_in_bio_url` absent; multi-day next-occurrence label.
- **`schedule-step` component**: calendar visible for weekly, seed-once (edit survives brief tweak? — no: brief change before edits re-seeds; after edits doesn't), remove/add slot, month-change fetch.
- **`createScheduledBatch`**: server-side cap rejection; `link_in_bio_url` written when CTA present, null otherwise; story rows keep `body = ''` with a CTA in the brief; happy path unchanged for event type (regression).
- **`materialiseRecurring`**: multi-day draft ghosts + legacy fallback (extend `materialise.test.ts`).

## 9. Deployment, safety and rollback

- **No database migration.** New data lives in existing JSONB (`campaigns.metadata`, `content_items.body_draft`) and the existing `campaigns.link_in_bio_url` column. Nothing in the migration chain or the CI baseline changes. RLS untouched (writes use the same service-role path with the same explicit `account_id` scoping as today — the B2 constraint from SPEC-create-flow applies to the new writes).
- **No new env vars, crons, or QStash schedules.** No change to publish cadence or worker timeouts; worst-case upfront generation stays at 12 slots × concurrency 3, identical to today.
- **Edge function deploy:** `supabase/functions/publish-queue` must be redeployed after the `banner-label.ts` change (deployed separately from the Next.js app — do not assume Vercel deploy covers it). No other function changes.
- **Cache scoping:** `/l/[slug]` is `force-dynamic` — card appearance/expiry needs no invalidation. Planner uses existing `revalidatePath('/planner')`. No new caching introduced.
- **Rollback:** revert the commits. Data written under the new code is additive and safe under old code: old readers use `metadata.dayOfWeek` (which we keep writing) and ignore `daysOfWeek`/`endDate`. One degradation: under rolled-back code, cards for new-code campaigns lose their end-date expiry (they'd roll forward weekly) — acceptable for a rollback window; noted here so it isn't rediscovered as a bug.
- **Docs:** correct `docs/runbook.md:75` (materialise-weekly is deployed but unscheduled; pg_cron not installed).

## 10. PR plan (score 4 → three PRs, in order)

1. **`feat: weekly recurrence model — multi-day + end date`** — schema, form fields (minus CTA), defaults, draft upgrade, `buildWeeklyMultiDaySuggestions`, `createDraft`, `buildCampaignMetadata`, `campaign-timing`, `banner-label.ts` (+ redeploy), `materialiseRecurring`, tests. Independently shippable: schedule step still auto-selects (now from the multi-day set).
2. **`feat: weekly schedule calendar overlay`** — depends on PR 1. schedule-step un-hiding + seed-once, wizard gate, `ScheduleCalendar.onMonthChange`, server-side slot cap, tests.
3. **`feat: weekly CTA link + link-in-bio card`** — form field → `ctaLinks.facebook`, `link_in_bio_url` persistence, story-placement note, compose/window tests. Only soft-depends on PR 1 (card expiry uses its `endDate`); land last to avoid form-file conflicts.

## 11. Open questions — recommendations included; if unanswered, the recommendation is what gets built

| # | Question | Recommendation | Why |
|---|----------|----------------|-----|
| Q1 | Is the 12-occurrence cap acceptable (2 days/week ⇒ max 6 weeks per campaign)? | **Yes, keep 12.** | Matches the existing slot cap and the review burden of upfront generation; a longer run is just a second campaign. Raising the cap is a one-line change later. |
| Q2 | Pre-select the derived occurrences (remove what you don't want) vs. start empty (add like event campaigns)? | **Pre-select.** | You configured the cadence on the Brief step; making you re-click 12 chips adds friction without control you don't already get from remove/add. |
| Q3 | CTA label customisation ("Order now" etc.) now or later? | **Later.** URL-only field; defaults stay "Book a table". | Keeps PR 3 small; label plumbing (prompt, compose, card) is a clean follow-up. |
| Q4 | Story-placement weekly and the CTA: disable the field, or extend stories to carry links/cards? | **Disable the field for story placement.** | Verified: story rows carry no composed body at all and the bio-card query is feed-only, so a story CTA would surface *nowhere* — offering the field would be misleading. Extending stories to carry links/cards is a separate feature if ever wanted. |

## 12. Assumptions recorded

- "For the duration of the campaign" = from the first published occurrence until midnight (Europe/London) after `endDate` — matching the existing card-window semantics in `docs/link-in-bio-scope.md:80`.
- One CTA URL per campaign (not per occurrence, not per platform); Instagram exposure is via the bio page by design.
- The weekly type remains Facebook + Instagram only (GBP removed product-wide by the prior spec).
- Live-DB reality overrides the migration chain: implementers must re-validate column existence against prod before relying on it (standing warning from SPEC-weekly-recurrence-story-gbp-removal :57).
