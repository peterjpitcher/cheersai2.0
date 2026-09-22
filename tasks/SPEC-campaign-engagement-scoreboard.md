# SPEC: Campaign Engagement Scoreboard

**Status:** Draft for review  
**Date:** 2026-09-22  
**Project:** CheersAI 2.0 (`cheersai2.0` / `nbkjciurhvkfpcpatbnt`)

## 1. Summary

Extend paid Meta campaign reporting so the campaign scoreboard shows the path from awareness to bookings:

`Reach -> Engagement -> Clicks -> CTR -> Bookings -> Cost/booking -> Spend`

Engagement will be one compact table column with a labelled breakdown of Meta reactions, comments and shares. This gives the owner qualitative evidence of interest without adding three wide columns or replacing the booking metrics that remain the main business outcome.

This feature requires additive production database columns and a wider Meta Insights mapping. This specification does not authorise applying the migration to production.

## 2. Decisions

| Decision | Choice | Reason |
|---|---|---|
| Main table shape | Add `Reach` and one `Engagement` column | Shows awareness and interaction while keeping the scoreboard readable. |
| Engagement detail | Reactions, comments and shares | These are understandable signals of audience response. Meta post reactions are labelled `Reactions`, not `Likes`, because they include more than a thumbs-up. |
| Storage grain | Store each count on campaigns, ad sets and ads | The existing sync uses the same metric model at all three levels. Keeping the levels aligned supports the campaign table and later ad-level analysis. |
| Historical data | Default new fields to zero; populate at the next sync | Avoids a risky or misleading backfill. Meta will refresh active and manually synced campaigns from its source data. |
| Main-table exclusions | Do not add CPC or frequency | They are diagnostic metrics better suited to campaign detail. The main table should answer impact first. |
| Engagement total | Sum reactions + comments + shares in application code | The stored component values remain inspectable and prevent double-counting broader Meta `post_engagement` actions. |
| Rollout | Additive migration first, application second | Old application code continues to work after the columns are added, so each stage is independently deployable. |

## 3. Current state

`fetchMetaObjectInsights()` already requests Meta's `actions` field but only extracts purchase actions. The performance sync stores spend, impressions, reach, link clicks, CTR, CPC and conversion metrics on `meta_campaigns`, `ad_sets` and `ads`.

The campaign scoreboard currently displays campaign, status, bookings, cost per booking, spend, clicks, CTR, last sync and actions. Campaign-level reach exists in the data model but is not shown. Reactions, comments and shares are neither parsed nor stored.

## 4. Live database findings

Verified read-only against production project `cheersai2.0` (`nbkjciurhvkfpcpatbnt`, `db.nbkjciurhvkfpcpatbnt.supabase.co`) on 2026-09-22:

- `meta_campaigns`: about 14 rows, 304 kB.
- `ad_sets`: about 31 rows, 168 kB.
- `ads`: about 111 rows, 240 kB.
- All three tables already contain the existing `metrics_*` fields with zero defaults and `NOT NULL` constraints.
- No views or triggers depend on these three tables.
- No public Postgres function body references these tables.
- Existing RLS policies and grants cover the tables. Adding columns requires no policy or grant change.
- The database is Postgres 17.6.

The tables are small. Adding nullable-free integer columns with constant zero defaults is expected to take a short metadata lock and has no material rewrite or downtime risk on this dataset. The exact live state must be rechecked before the migration is written and again before production application.

## 5. Data model

Add these columns to each of `public.meta_campaigns`, `public.ad_sets` and `public.ads`:

- `metrics_reactions integer not null default 0`
- `metrics_comments integer not null default 0`
- `metrics_shares integer not null default 0`

No index is needed because the fields are displayed from rows already selected by campaign or account. No RLS, policy, function, trigger, view or grant changes are required.

Rollback is reversible while the application still tolerates missing columns: deploy the previous application version, then drop the nine added columns. No existing data is changed. Production rollback SQL will be included in the approval packet before application.

## 6. Meta Insights mapping

Continue requesting the existing `actions` field and parse only these exact action types:

- reactions: `post_reaction`
- comments: `comment`
- shares: `post`

Parsing rules:

- Missing `actions` or missing action types return zero.
- Invalid, negative or non-finite values return zero.
- Duplicate entries of the same action type are summed defensively.
- Do not use `page_engagement` or `post_engagement` as the total because those broader values can include clicks and other actions already reported elsewhere.
- Keep purchase parsing independent so engagement changes cannot alter booking results.

The same mapped `CampaignInsights` values are written during campaign, ad set and ad sync. Failed Meta requests continue to use the existing failure behaviour. There is no partial fallback that invents engagement values.

## 7. Application data flow

Update the shared campaign performance type and every database row mapper to carry:

- `reactions`
- `comments`
- `shares`

The campaign dashboard model receives the three component values. A small formatter derives the displayed total and labelled breakdown. No new server endpoint is needed.

Existing service-role campaign reads must retain their explicit `account_id` scope. This change does not alter tenancy or authentication.

## 8. Scoreboard design

The table column order becomes:

1. Campaign
2. Status
3. Reach
4. Engagement
5. Clicks
6. CTR
7. Bookings
8. Cost/booking
9. Spend
10. Last sync
11. Actions

The Engagement cell shows a total as the primary number and a compact secondary breakdown, for example:

`57`  
`48 reactions · 6 comments · 3 shares`

Zero engagement is shown as `0` with the same labelled breakdown, not as missing data. Numbers use `en-GB` grouping. The table keeps horizontal scrolling at smaller widths, and the minimum width increases enough to prevent labels colliding.

The existing scoreboard ordering remains based on delivery status, bookings and cost efficiency. Engagement does not change ranking because bookings are the business outcome.

## 9. Testing and verification

Automated tests must cover:

- Meta action parsing for reactions, comments and shares.
- Missing, duplicate and malformed action values.
- Purchase conversion parsing remains unchanged.
- Performance sync writes all three metrics at campaign, ad set and ad levels.
- Database row mapping returns the new values and defaults safely.
- Scoreboard renders Reach, the engagement total and the labelled breakdown.
- Existing finished-campaign toggle and click values still work.

Verification gates:

- Local database rebuild from the staged v1 baseline.
- Supabase database lint on the rebuilt schema.
- `npm run ci:verify`.
- After application and migration deployment, manually sync one active campaign and verify its Meta source values against the live scoreboard.
- Confirm the canonical production deployment and review bounded runtime errors.

## 10. Rollout plan

This is complexity **L** because it changes an external integration, production schema, backend sync and frontend reporting. Split it into two independently deployable changes:

1. **Database foundation:** additive migration for the nine columns, local rebuild and database lint. Production application requires a separate approval packet containing the exact SQL, checksum, live-state check and rollback SQL.
2. **Meta sync and scoreboard:** parse and store the three metrics, update types and mappers, then show Reach and Engagement in the table. Deploy only after the database foundation is live.

No production database change, push, merge or deployment is authorised by approval of this specification alone.

## 11. Acceptance criteria

- Every campaign scoreboard row shows Reach.
- Every row shows a clear engagement total and reactions, comments and shares breakdown.
- Clicks, CTR, bookings, cost per booking and spend remain visible.
- A manual sync stores Meta engagement values at campaign, ad set and ad levels.
- Missing engagement data displays as zero and does not break the page.
- Historical campaigns begin at zero and populate through a later sync, with no invented backfill.
- Existing account scoping and RLS behaviour are unchanged.
- All local quality gates pass before any push.
