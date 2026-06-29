# SPEC — Weekly Recurrence Rework, Recurring Stories & Full GBP Removal

**Status:** Draft for review
**Date:** 2026-06-29
**Author:** Discovery + spec (Claude)
**Project:** CheersAI 2.0 (`cheersai2.0` / `nbkjciurhvkfpcpatbnt`)

---

## 1. Summary

Three independent changes, bundled because they all touch the create wizard, schemas and publishing layer:

1. **Weekly recurrence = "repeat N times", not a calendar of specific dates.** The weekly-recurring type is already count-based in the form, but the schedule step forces the user through the same date-picking calendar as one-off events. Remove that coupling so a weekly-recurring post is purely "every `{day}` at `{time}`, repeat `{N}` times".
2. **Allow stories to be weekly-recurring.** Today `story` and `weekly_recurring` are mutually-exclusive content *types*, so a story can never recur. Add a `feed | story` placement to the weekly-recurring flow.
3. **Remove Google Business Profile (GBP) entirely.** Confirmed scope: **Everything Google** — posting *and* reviews sync, metrics/analytics, the OAuth connection, env vars, and DB objects. Not posting-only.

Per workspace rules, the database parts (DROP TABLE / DROP COLUMN / enum value) are **destructive and require explicit approval before execution**. This spec defines them but does not authorise running them.

---

## 2. Scope

### In scope
- Decouple weekly recurrence from date-selection; reframe as occurrence count.
- Enable `placement = story` for weekly recurring (FB/IG only).
- Remove all GBP application code, env vars, cron jobs, tests, and DB objects.

### Out of scope (parked)
- Configurable interval ("every N weeks") — stays fixed weekly.
- Per-occurrence time/copy editing.
- A live recurrence engine (count stays frozen-at-creation — see §5).
- Multi-timezone (Europe/London remains hardcoded).

---

## 3. Decisions taken (with rationale)

| # | Decision | Choice | Why |
|---|----------|--------|-----|
| D1 | GBP removal depth | **Everything Google** (user-confirmed) | User selected full removal; reviews/metrics tables are empty (0 rows) and the feature "doesn't work anyway". |
| D2 | Recurrence anchor | Occurrence 1 = next matching `{dayOfWeek}` at `{time}` ≥ now+15min, then +7 days × N | Keeps existing derive-from-today behaviour (`suggestion-utils.ts:62-80`); no new UI, no date input. |
| D3 | Recurrence interval | Fixed weekly (+7d) | Interval is hardcoded today; "every N weeks" is unrequested scope. |
| D4 | Count semantics | Frozen-at-creation — expand to N pinned `content_items` rows at create time | Already works end-to-end; avoids reviving the uncapped legacy materialiser. |
| D5 | Count storage | Keep in `body_draft` / `campaigns.metadata` JSON — **no migration** | Active path reads JSON, not a column; a column buys nothing for the goal. |
| D6 | Legacy materialiser | Retire/disable the dormant cron + edge function (it already skips wizard campaigns and is the only "infinite recurrence" footgun) | Contradicts the "no specific date" intent; dead-but-wired. |
| D7 | Story recurrence design | **Option A** — add `placement: 'feed' \| 'story'` to the weekly-recurring brief | Smallest change, reuses existing placement plumbing, no `content_type` enum change. |
| D8 | Recurring-story media/expiry | Reuse the one processed image each week; each occurrence posts a fresh 24h story; honour the weekly `time` (not 07:00) | Matches existing story rules; "persistent weekly story" is not a platform concept. |
| D9 | GBP `platform` enum value | Drop is **optional/cosmetic** — see §6 live-DB finding | No DB column uses the `platform` enum type; the value is vestigial. |

**Open items the reviewer should confirm before build (none block discovery):** D6 (OK to disable the legacy cron now?), D7 (Option A entry-point UX — user starts from "Weekly Recurring" then picks Story, rather than from "Story"), and whether to physically drop the empty GBP tables now or leave them dormant.

---

## 4. Live database validation (important — migration files are unreliable here)

Queried live (`nbkjciurhvkfpcpatbnt`) because the v2 migration chain does **not** match production (it assumes an inherited v1 baseline). Findings that change the plan:

- **`platform` enum (`facebook, instagram, gbp`) has ZERO dependent columns.** All platform/provider columns are `text`, not the enum: `content_items.platform`, `social_connections.provider`, `oauth_states.provider`, `analytics_snapshots.platform`, `provider_rate_limits.provider`. → Dropping the `gbp` enum value is safe but **cosmetic** (nothing references the type).
- **`content_variants` has NO `platform` column** (cols: id, content_item_id, body, media_ids, preview_data, validation, banner_*). → There are **no per-platform GBP variant rows** to delete. (Contradicts the migration-file assumption.)
- **`publish_jobs` has NO `platform` column** — it is placement/variant/account-based (`placement`, `variant_id`, `account_id`, `platform_post_id`). → Publishing fan-out is by placement + account, which makes story-placement recurrence (Change 2) *easier*.
- **`gbp_reviews` = 0 rows, `gbp_daily_metrics` = 0 rows.** Both tables empty → safe to drop. RLS policies drop with them (gbp_daily_metrics ×4, gbp_reviews ×2).
- **No functions and no views reference GBP or the `platform` enum.** → No PL/pgSQL function-audit fallout.
- **GBP data present:** `content_items.platform='gbp'` = **6** (legacy v1 rows); `content_items.body_draft` containing `"gbp"` = **29**; `social_connections` provider='gbp' = **1**; `posting_defaults.gbp_location_id` set = **1**; `oauth_states` provider='gbp' = **12** (transient).
- **GBP-named columns to drop:** `brand_profile.gbp_cta`, `posting_defaults.gbp_location_id`, `posting_defaults.gbp_cta_standard`, `posting_defaults.gbp_cta_event`, `posting_defaults.gbp_cta_offer`. (`gbp_reviews.google_review_id` drops with its table.)

> ⚠️ Any implementer MUST re-validate column/table existence against the live DB before writing the migration — do not trust `supabase/migrations/` alone.

---

## 5. Change 1 — Weekly recurrence repeats N occurrences (no specific date)

### Current state
- Form already collects **day-of-week + time + "weeks ahead" (1–12)** with **no date picker** — `src/features/create/forms/weekly-recurring-fields.tsx:8-97`.
- Validation is already count-based — `src/features/create/schemas/content-schemas.ts:106-113` (`weeklyCampaignBriefSchema`: `dayOfWeek`, `time`, `weeksAhead`).
- **The "specific date" the user sees comes from Step 2:** `weekly_recurring` is routed through the same `ScheduleCalendar` as events/promotions. `buildWeeklySuggestions` materialises N dated slots from *today* (`schedule-step.tsx:155-163`), the user must **select specific calendar dates** ("Select at least one date to continue", `schedule-step.tsx:353-360`), and each becomes a pinned `content_items.scheduled_for` row (`src/app/actions/content.ts:701-732`).
- Dates derived in `src/features/create/schedule/suggestion-utils.ts:46-81` (anchor = today, first matching weekday ≥ now+15min, +1 week × N).
- A separate **legacy/dormant** path exists (`src/lib/scheduling/materialise.ts:19-173`, `supabase/functions/materialise-weekly/worker.ts`, `src/app/api/cron/recurring-publish/route.ts`) that is date/horizon-anchored, **uncapped** (`buildSlots` materialises forever, `materialise.ts:263-289`), and **never receives wizard campaigns** (it needs a `cadence` array the wizard never writes → skipped at `materialise.ts:50`).

### Target state
Weekly recurring becomes a pure **count**: "Post every `{day}` at `{time}`, repeat `{N}` times." No calendar, no date selection. The N occurrences are auto-derived (D2) and shown read-only for confirmation, then expanded to N pinned rows exactly as today.

### Changes by area
- **UI — schedule step:** when `contentType === 'weekly_recurring'`, **bypass `ScheduleCalendar`**. Render a read-only summary ("Weeks 1–N: Mon 18:00, 06/Jul → 27/Jul") generated from `buildWeeklySuggestions`, auto-select all N slots (no user date-picking), and drop the "Select at least one date to continue" gate. `src/features/create/steps/schedule-step.tsx:141-179, 256-362`.
- **Copy/label clarity:** rename "Weeks ahead" → "Number of posts" / "Repeat" in `weekly-recurring-fields.tsx:79-96` so the slider reads as an occurrence count, not a horizon. (Schema field `weeksAhead` can stay or be aliased to `occurrences` — keep `weeksAhead` to avoid churn; D5.)
- **Persistence:** unchanged — `createScheduledBatch` already expands to N pinned rows (`content.ts:619-884`). No schema/DB change.
- **Retire legacy path (D6):** remove the `recurring-publish` cron entry from `vercel.json`, stop calling `materialiseRecurringCampaigns`/`dispatchRecurringPublishes`, and disable the `materialise-weekly` edge function. Leave the code in git history. If the team prefers to keep it live instead, a count cap **must** be added to `buildSlots`/`materialiseCampaign` first.
- **No migration.**

### Acceptance
- Creating a weekly-recurring post never shows a date calendar and never requires picking a date.
- N posts are created, one per week, on the chosen day/time, N = slider value.
- No path can produce unbounded recurrence.

---

## 6. Change 2 — Weekly-recurring stories

### Current state
- `weekly_recurring` and `story` are separate members of the `content_type` enum and separate members of the Zod discriminated union (`content-schemas.ts:72-77` story, `:106-113` weekly), so they cannot combine.
- `weekly_recurring` is hardcoded to **feed** placement on every path (`content.ts:55-69`, `service.ts:1330,1365`, `materialise.ts:186,246`).
- Stories have a one-shot scheduler (`src/lib/create/story-schedule.ts:17-44`, snaps to 07:00 `STORY_POST_TIME`) with no repetition concept.
- Publishing already supports stories generically via **placement** — and live DB confirms `publish_jobs.placement` + `content_variants` are placement/account-based, so the plumbing exists.

### Target state (Option A — D7/D8)
Add `placement: 'feed' | 'story'` to the weekly-recurring brief. A weekly-recurring story = "post this story every `{day}` at `{time}`, repeat `{N}` times" (FB/IG only, image-only body, fresh 24h story each week).

### Changes by area
- **Schema:** add `placement: z.enum(['feed','story']).default('feed')` to `weeklyCampaignBriefSchema` (`content-schemas.ts:106-113`); `.superRefine` to force FB/IG and reject GBP when `placement === 'story'`.
- **Types:** widen `MaterialisedSlot.placement` to `'feed'|'story'` (`src/lib/scheduling/materialise.ts:183-192,246`). `content_item.placement` already exists in types (`src/types/content.ts:31`).
- **UI:** show a feed/story selector for the weekly-recurring type (`brief-step.tsx` — include `weekly_recurring` in `hasCampaignPlacements`, ~`:84`); when story is chosen, the wizard should follow story media rules (one processed image).
- **Publishing dispatch fix (verify against live):** the handler must route story-placement weekly items to the story publisher. Discovery flagged `src/lib/publishing/handler.ts:158` dispatching `publishStory` by `contentType === 'story'`; change the condition to key on `placement === 'story'`. **Confirm the exact live dispatch path during build** — live `publish_jobs` is placement-based, so the real condition may already be placement-driven.
- **Scheduling:** weekly story occurrences honour the chosen weekly `time` (D8), not `STORY_POST_TIME`. Update the placement resolver (`content.ts:55-69`) and service path (`service.ts:1330,1365`) to read `brief.placement`.
- **Preflight/media/conflicts:** already placement-driven — expected no change (verify: `preflight.ts:89,133,149`, `spread.ts:68`).
- **No migration** (placement has no DB CHECK; `recurring_day_of_week CHECK 0–6` is reusable).

### Acceptance
- A story can be created as weekly-recurring and produces N story-placement posts on FB/IG.
- Each occurrence publishes as a story (not a feed post) at the chosen time.
- GBP is never offered for stories (moot after Change 3).

---

## 7. Change 3 — Remove Google Business Profile entirely

Confirmed scope **D1 = Everything Google**: posting, reviews, metrics/analytics, OAuth connection, env, cron, DB.

### 7a. Application code to delete/strip

**Posting / providers**
- Delete `src/lib/providers/gbp/` (`adapter.ts`, `api.ts`, `validation.ts`, `token-refresh.ts`, and tests). Under full removal, `ensureFreshGbpToken` no longer needs relocating (metrics is also being removed).
- Remove adapter registration `src/lib/providers/init.ts:9,23`; type guard `src/lib/providers/types.ts:17-26` (`GbpExtensions`, `isGbpAdapter`).
- Remove dispatch branches `src/lib/publishing/handler.ts:14,160-163`.
- Edge function: remove `supabase/functions/publish-queue/providers/gbp.ts`, the `case "gbp"` in `worker.ts:919-926`, and `gbp` from `providers/types.ts:1`.
- Preflight: strip `gbp` from `preflight.ts:8,24-34,89-93`; `copy-rules.ts:12,21`; `compose-body.ts` GBP branches; `rate-limits.ts:14`.

**Connections / OAuth**
- Remove `gbp` from `src/lib/connections/oauth.ts` (`GBP_SCOPES`, provider, redirect), `token-exchange.ts:46,184-192,326-368`, `metadata.ts:11`, `readiness.ts`, `health.ts:83`, `src/app/api/oauth/[provider]/callback/route.ts:7` (`SUPPORTED_PROVIDERS`).
- Remove GBP from `src/features/connections/*` (cards, oauth-button, metadata-form, health-dots, toast).

**Reviews (whole feature)**
- Delete `src/lib/gbp/reviews.ts`, `src/lib/gbp/business-info.ts`, `src/lib/gbp/location-id.ts`, `src/app/(app)/reviews/*`, `src/features/reviews/*`, `src/types/reviews.ts`, `src/app/api/cron/sync-gbp-reviews/route.ts`. Remove the reviews nav entry and any `/reviews` route links.

**Metrics / analytics**
- Delete `src/lib/gbp/metrics.ts`, `src/app/api/cron/gbp-metrics/route.ts`, `src/features/analytics/charts/gbp-metrics-chart.tsx`, `src/features/analytics/hooks/use-gbp-metrics.ts`.
- Strip GBP from `src/app/actions/analytics.ts` (`getGbpMetrics`), `src/lib/analytics/{queries,aggregations,types}.ts` (`getGbpDailyMetrics`, `mapGbpRow`, `isGbp`, `gbp_data_delayed`), `analytics-dashboard.tsx` (GBP tab), `platform-comparison.tsx:29`, `empty-analytics-state.tsx`.

**Create flow + AI**
- Remove the gbp option: `brief-step.tsx:54`, default platforms `create-wizard.tsx:105,245`, platform enums `content-schemas.ts:31,56`, `src/lib/create/schema.ts:6`.
- **AI generation (must be deliberate):** `PlatformCopy.gbp` is a *required* Zod object (`src/lib/ai/schemas.ts:25`). Remove the `gbp` key from `PlatformCopy` and strip GBP from `src/lib/ai/prompts.ts` (:123,:414), `postprocess.ts:225-267`, `content-rules.ts`, `src/app/actions/ai-generate.ts` (gbp limits, `gbpCta`). Without this, generation breaks.

**Types / constants**
- `src/types/content.ts:11,13,48-51` (`Platform` union, `PlatformCtaLinks`, `PlatformCopy.gbp`), `src/types/providers.ts:6`, `src/lib/constants.ts:14` (`PLATFORMS`). Drop `gbp` from each.
- Keep platform badges only if still used by FB/IG (`platform-badge.tsx`, `platform-dot.tsx`, `toggle-chip.tsx`); remove the `gbp` case + `--c-gbp` token usage.

**Settings**
- Remove `gbpCta`, `GBP_CTA_OPTIONS_BY_POST_TYPE`, `gbpLocationId`, `gbpCtaDefaults` from `src/features/settings/schema.ts`; the GBP CTA/location UI in `posting-defaults-form.tsx`; `brand-voice-form.tsx:349`.

**Env**
- Remove `GOOGLE_MY_BUSINESS_CLIENT_ID` / `GOOGLE_MY_BUSINESS_CLIENT_SECRET` from `src/env.ts:58-59,122-123` and Vercel project env. Update `.env.example` / CLAUDE.md env table.

**Cron**
- Remove `sync-gbp-reviews` from `vercel.json`. Remove GBP labels from generic crons (`notify-expiring-connections/route.ts:43`, `token-health/route.ts:47`) — keep the crons themselves.

### 7b. Database changes (⚠️ DESTRUCTIVE — explicit approval required before running)

All validated against live (§4). Stage as one reviewed migration; back up first.

1. **Drop empty tables** (0 rows; RLS policies drop automatically):
   - `DROP TABLE public.gbp_reviews;`
   - `DROP TABLE public.gbp_daily_metrics;`
2. **Drop GBP columns:**
   - `ALTER TABLE public.brand_profile DROP COLUMN gbp_cta;`
   - `ALTER TABLE public.posting_defaults DROP COLUMN gbp_location_id, DROP COLUMN gbp_cta_standard, DROP COLUMN gbp_cta_event, DROP COLUMN gbp_cta_offer;`
3. **Data cleanup** (small, see §4 counts):
   - Delete the 1 `social_connections` row where `provider='gbp'` (and any dependent rows via `account_id`).
   - Delete/expire the 12 `oauth_states` rows where `provider='gbp'`.
   - Decide on the 6 legacy `content_items` rows (`platform='gbp'`) and 29 rows whose `body_draft` includes `"gbp"`: recommended — strip `gbp` from `body_draft.platforms` and soft-delete the 6 orphaned legacy rows. (App will ignore `gbp` regardless once code is removed; cleanup is cosmetic/hygiene.)
4. **`platform` enum value (D9 — optional):** no column uses the `platform` enum type, so leaving `gbp` in it is harmless. If physical removal is wanted for cleanliness, drop the whole unused `public.platform` type rather than rebuilding it. Low priority; flag for approval either way.

No function or view updates required (none reference GBP — §4).

### 7c. Tests
- Delete GBP provider tests (`providers/gbp/*.test.ts`), reviews tests, gbp analytics tests.
- Add: create-wizard no longer offers GBP; AI generation succeeds with `PlatformCopy.gbp` removed; publish path never enqueues a GBP job; analytics dashboard renders without the GBP tab.

### Acceptance
- No GBP option anywhere in create, settings, connections, analytics, or reviews (reviews route removed).
- `npm run ci:verify` passes with zero `gbp`/`google_my_business` references in `src/` (except git history).
- App builds and runs without `GOOGLE_MY_BUSINESS_*` env vars.

---

## 8. Cross-cutting risks

| Risk | Mitigation |
|------|------------|
| Migration files ≠ live DB | All DB steps validated against live (§4); re-validate at build time. |
| AI schema requires `gbp` → generation breaks if removed half-way | Remove `PlatformCopy.gbp` and all prompt/postprocess GBP refs in the **same** change (§7a). |
| Story dispatch keyed on `contentType` not `placement` | Fix `handler.ts:158`; verify against live placement-based publish path (§6). |
| Reviewing user expects to keep GBP connection | Explicitly confirmed: full removal (D1). Note: deleting the 1 live connection is irreversible without re-auth. |
| Legacy materialiser left live + uncapped | Disable it (D6) as part of Change 1. |
| Dropping live `social_connections`/data | Destructive — gate behind approval + backup (§7b). |

---

## 9. Sequencing & complexity

Recommend three independently-deployable PRs:

1. **PR1 — GBP removal (app layer)** · Complexity **L** · no DB. Strip all GBP code, env, cron, AI schema, reviews/analytics UI. Ship and verify before any DB drop.
2. **PR2 — GBP database teardown** · Complexity **M** · **destructive, approval-gated**. Drop empty tables + columns + data cleanup, after PR1 is live and stable.
3. **PR3 — Recurrence rework + recurring stories** · Complexity **M** · no DB. Decouple weekly recurrence from the calendar (Change 1), add story placement (Change 2), retire legacy materialiser.

(Changes 1 & 2 can also split, but they share the weekly-recurring schema/wizard surface so are cheaper together.)

---

## 10. Definition of done
- All acceptance criteria in §5–§7 met.
- `npm run ci:verify` green (lint, typecheck, test, build).
- No `gbp` / `google_my_business` references remain in `src/` (verify with grep).
- DB migration reviewed, backed up, approved, and applied; live data cleanup confirmed.
- CLAUDE.md env table and `.env.example` updated (GBP vars removed).
