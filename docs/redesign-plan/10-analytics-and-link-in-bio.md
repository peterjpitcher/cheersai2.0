# 10 — Analytics and Link-in-Bio

> **Status**: Specification — v1 scope confirmed by owner.
> Analytics is required in the initial release. Link-in-bio is recommended for MVP (see B2 for rationale).

---

## PART A: Analytics Module

### A1. Analytics Goals and Principles

The owner's need is narrow and practical: understand which posts work so future content decisions are grounded in evidence rather than guesswork.

**What the owner actually needs**

- Know whether a post got meaningful engagement or was ignored.
- Compare platforms: is Facebook driving more interaction than Instagram?
- Compare content types: do event posts outperform promotions?
- Identify the best days and times to post.
- Spot declining engagement before it becomes a problem.

**Design principles**

1. **No vanity metrics.** Impressions and reach are shown only when paired with an engagement rate so the owner understands what they mean. Raw impression counts without context are omitted from the primary view.
2. **Actionable framing.** Every metric display should answer "so what?" — e.g. "This post was saved 14 times (3× your average), which suggests it worked as reference content."
3. **No third-party tracking on public pages.** The link-in-bio page (`/l/[slug]`) must never load analytics scripts (Google Analytics, Meta Pixel, etc.). Only server-side data collection is permitted.
4. **Honest about gaps.** When data is unavailable, show a clear explanation rather than empty charts or zeroes.
5. **Simple summary over complex dashboards.** The owner manages marketing solo on a phone. A ranked list of posts is more useful than a multi-axis chart.

---

### A2. What Data Is Available

#### Facebook (Graph API)

Requires scope: `pages_read_engagement`, `pages_show_list`

Per published feed post (`/{post-id}/insights`):
- `post_impressions` — total times the post entered a screen
- `post_impressions_unique` — reach (unique accounts)
- `post_reactions_by_type_total` — likes, love, haha, wow, sad, angry (summed as `reactions`)
- `post_comments` — comment count
- `post_shares` — share count
- `post_clicks` — total link/photo/video clicks
- `post_engaged_users` — unique users who reacted, commented, clicked, or shared

Not available: story views (Facebook Stories metrics require `pages_read_user_content` which Meta has restricted for most apps; treat as unavailable).

#### Instagram (Graph API)

Requires scope: `instagram_basic`, `instagram_manage_insights`, `pages_read_engagement`

Per published feed post (`/{media-id}/insights`):
- `impressions` — total impressions
- `reach` — unique accounts reached
- `likes` — like count
- `comments` — comment count
- `saved` — saves (most reliable signal of genuinely valuable content)
- `shares` — shares to Stories from this post
- `total_interactions` — sum of all engagement actions

Not available:
- Story insights: Meta restricts story-level metrics via the Graph API for most third-party apps. Do not display story metrics; show the "not available" state.
- Historical data beyond 90 days: the Insights endpoint only returns data for posts published within the last 90 days. Posts older than this will have a `data_expires` flag and show the last-fetched values as final.

#### Google Business Profile (Business Profile Performance API)

This is a completely separate API from the GBP posting API (My Business Posts API). It uses the `https://businessprofileperformance.googleapis.com/v1` base URL and requires the `https://www.googleapis.com/auth/business.manage` scope, which should already be requested during GBP OAuth.

Per location (not per individual post — GBP does not provide per-post insights):
- `BUSINESS_IMPRESSIONS_DESKTOP_MAPS` — views on Google Maps, desktop
- `BUSINESS_IMPRESSIONS_MOBILE_MAPS` — views on Google Maps, mobile
- `BUSINESS_IMPRESSIONS_DESKTOP_SEARCH` — views in Search, desktop
- `BUSINESS_IMPRESSIONS_MOBILE_SEARCH` — views in Search, mobile
- `CALL_CLICKS` — taps on the phone number
- `WEBSITE_CLICKS` — taps on the website link
- `BUSINESS_DIRECTION_REQUESTS` — requests for directions

These are daily aggregates for the location; they cannot be attributed to a specific GBP post. Store the daily totals and surface them in a separate "Local presence" section rather than on a per-post basis.

Not available:
- GBP offer or event performance at the individual post level.
- Engagement with specific GBP post content (views of the post itself are not exposed through the Performance API in a per-post form).

---

### A3. Data Collection Strategy

#### Trigger pattern

Analytics data is fetched after a post has been live long enough for the platform to accumulate meaningful signal. Two snapshots are taken:

- **24-hour snapshot**: fetched approximately 25–26 hours after `scheduled_for` (the extra margin avoids edge cases where the job runs slightly early). This gives early engagement signal.
- **7-day snapshot**: fetched approximately 7 days + 1 hour after `scheduled_for`. This is the definitive reading as most organic reach decays within 7 days.

Fetching is triggered by QStash delayed messages, enqueued by the publishing pipeline immediately after a post reaches `posted` status.

Pseudocode for enqueue (called from publish success handler):

```
enqueue_analytics_fetch(content_item_id, snapshot_type='24h', delay_seconds=90000)  // 25h
enqueue_analytics_fetch(content_item_id, snapshot_type='7d',  delay_seconds=604800) // 7d + 1h (608400)
```

The QStash message body includes `content_item_id` and `snapshot_type`. The handler:

1. Loads the `content_items` row to get `platform`, `account_id`, and the `external_post_id` stored by the publish job (see schema note below).
2. Loads the relevant social connection token for `account_id` + `platform`.
3. Calls the appropriate platform API.
4. Upserts a row in `analytics_snapshots`.

If the API call fails (token expired, rate-limited, post deleted), the job logs the error and marks `fetch_error` on the snapshot row. It does not retry automatically — the data window has passed.

#### External post ID storage

The publish pipeline must store the platform-assigned post ID on the `content_items` row after a successful publish. Add a column:

```sql
alter table public.content_items
  add column external_post_id text;
```

This is the Facebook post ID, Instagram media ID, or GBP name (`accounts/{id}/locations/{id}/localPosts/{id}`) used to fetch analytics.

#### GBP location metrics

GBP data is not per-post. A separate daily job (QStash scheduled cron, runs at 02:00 UTC) fetches the previous day's location metrics for each connected GBP account and stores them in `gbp_daily_metrics` (see schema in A4).

---

### A4. Analytics Schema (Full DDL)

```sql
-- ============================================================
-- analytics_snapshots
-- Stores point-in-time engagement metrics for a published post.
-- One row per content_item + snapshot_type combination.
-- ============================================================
create table public.analytics_snapshots (
  id                    uuid        primary key default gen_random_uuid(),
  account_id            uuid        not null references public.accounts (id) on delete cascade,
  content_item_id       uuid        not null references public.content_items (id) on delete cascade,

  -- Which snapshot window this row represents
  snapshot_type         text        not null check (snapshot_type in ('24h', '7d')),

  -- When this snapshot was actually fetched (not when the post was scheduled)
  fetched_at            timestamptz not null default now(),

  -- Whether the fetch succeeded. NULL = not yet attempted.
  fetch_error           text,

  -- ── Facebook metrics ─────────────────────────────────────
  fb_impressions        integer,
  fb_reach              integer,
  fb_reactions          integer,    -- sum of all reaction types
  fb_comments           integer,
  fb_shares             integer,
  fb_clicks             integer,    -- total post clicks (link + photo + video)
  fb_engaged_users      integer,    -- unique users who interacted

  -- ── Instagram metrics ────────────────────────────────────
  ig_impressions        integer,
  ig_reach              integer,
  ig_likes              integer,
  ig_comments           integer,
  ig_saves              integer,    -- strongest quality signal
  ig_shares             integer,
  ig_total_interactions integer,

  -- ── GBP metrics ──────────────────────────────────────────
  -- GBP does not provide per-post metrics; these columns are
  -- intentionally null for GBP content_items. GBP location
  -- totals are stored in gbp_daily_metrics instead.
  -- Columns kept here for schema uniformity so future API
  -- changes can be adopted without a migration.
  gbp_impressions       integer,    -- reserved, always null for now
  gbp_cta_clicks        integer,    -- reserved, always null for now

  -- ── Derived / cached ─────────────────────────────────────
  -- Pre-computed engagement rate stored to avoid repeated
  -- calculation in queries. Defined as:
  -- Facebook:  fb_engaged_users / NULLIF(fb_reach, 0)
  -- Instagram: ig_total_interactions / NULLIF(ig_reach, 0)
  -- GBP:       null (no per-post denominator)
  engagement_rate       numeric(6, 4),

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- Enforce one snapshot per post per window
  unique (content_item_id, snapshot_type)
);

-- Index supporting per-account analytics queries
create index analytics_snapshots_account_id_idx
  on public.analytics_snapshots (account_id);

-- Index supporting per-post lookup
create index analytics_snapshots_content_item_id_idx
  on public.analytics_snapshots (content_item_id);

-- Index supporting time-range queries (weekly/monthly summaries)
create index analytics_snapshots_fetched_at_idx
  on public.analytics_snapshots (account_id, fetched_at desc);

-- RLS: owner only
alter table public.analytics_snapshots enable row level security;

create policy "Owner access" on public.analytics_snapshots
  for all
  using (auth.uid() = account_id)
  with check (auth.uid() = account_id);
```

```sql
-- ============================================================
-- gbp_daily_metrics
-- Location-level Google Business Profile performance data.
-- One row per account per calendar date.
-- ============================================================
create table public.gbp_daily_metrics (
  id                          uuid        primary key default gen_random_uuid(),
  account_id                  uuid        not null references public.accounts (id) on delete cascade,
  metric_date                 date        not null,

  -- Maps DESKTOP + MOBILE for each surface
  impressions_maps_desktop    integer     not null default 0,
  impressions_maps_mobile     integer     not null default 0,
  impressions_search_desktop  integer     not null default 0,
  impressions_search_mobile   integer     not null default 0,

  -- Interaction counts
  call_clicks                 integer     not null default 0,
  website_clicks              integer     not null default 0,
  direction_requests          integer     not null default 0,

  -- Total impressions (sum of all four surfaces, computed on insert)
  total_impressions           integer     generated always as (
                                impressions_maps_desktop +
                                impressions_maps_mobile +
                                impressions_search_desktop +
                                impressions_search_mobile
                              ) stored,

  fetched_at                  timestamptz not null default now(),

  unique (account_id, metric_date)
);

create index gbp_daily_metrics_account_date_idx
  on public.gbp_daily_metrics (account_id, metric_date desc);

alter table public.gbp_daily_metrics enable row level security;

create policy "Owner access" on public.gbp_daily_metrics
  for all
  using (auth.uid() = account_id)
  with check (auth.uid() = account_id);
```

#### Additional scope requirements

The following OAuth scopes must be added to the social connection flows:

| Platform  | Scope to add                  | Notes                                                      |
|-----------|-------------------------------|------------------------------------------------------------|
| Facebook  | `pages_read_engagement`       | Required for post insights. May already be present.        |
| Instagram | `instagram_manage_insights`   | Required for media insights. Separate from basic scope.    |
| GBP       | (no change needed)            | `business.manage` already requested; covers Performance API. |

If the owner has already completed OAuth without these scopes, they must re-authorise. Surface a one-time prompt in the Connections page.

#### Weekly summary query pattern

```sql
-- 7-day snapshot summary for the last 30 days, ranked by Instagram saves
-- (substitute metric and platform as needed)
select
  ci.id                   as content_item_id,
  ci.platform,
  ci.scheduled_for,
  c.campaign_type,
  c.name                  as campaign_name,
  snap.ig_saves,
  snap.ig_total_interactions,
  snap.ig_reach,
  snap.engagement_rate,
  snap.fb_engaged_users,
  snap.fb_reach,
  snap.fetched_at
from public.analytics_snapshots snap
join public.content_items ci  on ci.id = snap.content_item_id
left join public.campaigns c  on c.id  = ci.campaign_id
where snap.account_id   = :account_id
  and snap.snapshot_type = '7d'
  and snap.fetch_error   is null
  and ci.scheduled_for  >= now() - interval '30 days'
order by snap.ig_saves desc nulls last;
```

```sql
-- Platform comparison: average engagement rate by platform (7-day snapshots)
select
  ci.platform,
  count(*)                              as post_count,
  round(avg(snap.engagement_rate), 4)   as avg_engagement_rate,
  sum(snap.ig_saves)                    as total_ig_saves,
  sum(snap.fb_engaged_users)            as total_fb_engaged
from public.analytics_snapshots snap
join public.content_items ci on ci.id = snap.content_item_id
where snap.account_id    = :account_id
  and snap.snapshot_type  = '7d'
  and snap.fetch_error    is null
  and ci.scheduled_for   >= now() - interval '90 days'
group by ci.platform;
```

```sql
-- Content type comparison: event vs promotion vs weekly
select
  c.campaign_type,
  count(distinct snap.content_item_id)  as post_count,
  round(avg(snap.engagement_rate), 4)   as avg_engagement_rate
from public.analytics_snapshots snap
join public.content_items ci  on ci.id = snap.content_item_id
join public.campaigns c       on c.id  = ci.campaign_id
where snap.account_id    = :account_id
  and snap.snapshot_type  = '7d'
  and snap.fetch_error    is null
group by c.campaign_type
order by avg_engagement_rate desc;
```

---

### A5. Analytics UI Specification

#### Placement recommendation

Analytics lives as a **sub-section of the Planner tab**, not a separate top-level navigation item.

Rationale: The PRD mandates a maximum of five top-level navigation items (Planner, Create, Library, Connections, Settings). Adding a sixth for analytics — when the owner checks it weekly at most — would bloat navigation for infrequent access. Instead, the Planner already shows published post status; extending it with a "Performance" toggle achieves the same goal without navigation overhead. A dedicated "Analytics" tab can be promoted to top-level in a later version if usage warrants it.

Entry point: A "Performance" tab within the Planner, alongside the default "Schedule" and "Status" tabs.

#### Per-post metrics display

**On the Planner post card (inline, minimal)**

Only shown for posts with `status = 'posted'` and at least one `analytics_snapshots` row:

```
[Platform icon] [Post title / campaign name]  [Scheduled date]
Posted  |  [X] engagements  |  [Y] saves  |  [Z]% rate  |  [7d] chip
```

- Show 7-day snapshot if available; fall back to 24-hour snapshot with a `(24h)` label.
- If no snapshot exists yet, show "Analytics pending" with a clock icon.
- If `fetch_error` is set, show "Analytics unavailable" in muted text.

**In the post detail drawer (full metrics)**

Opened by clicking a posted item on the Planner. Layout:

```
─────────────────────────────────────────────
POST PERFORMANCE
─────────────────────────────────────────────
  Snapshot:  [24-hour]  [7-day *selected*]
  (toggle between snapshots if both exist)

  ┌─────────────────────────────────────────┐
  │  INSTAGRAM                               │
  │  Saves          14   [above your avg]   │
  │  Interactions   38                      │
  │  Reach        1,240                     │
  │  Engagement     3.1%                    │
  └─────────────────────────────────────────┘

  ┌─────────────────────────────────────────┐
  │  FACEBOOK                               │
  │  Engaged users  22                      │
  │  Reach          680                     │
  │  Engagement     3.2%                    │
  │  Shares          6                      │
  │  Comments        3                      │
  └─────────────────────────────────────────┘

  ┌─────────────────────────────────────────┐
  │  GBP                                    │
  │  No per-post metrics available          │
  │  See Local Presence for location trends │
  └─────────────────────────────────────────┘

  Fetched: 14 Feb 2026 at 09:14
─────────────────────────────────────────────
```

"Above your avg" label: shown when the metric is >1.5× the account's rolling 30-day average for that metric and platform. Computed server-side on load.

#### Performance summary view (Planner > Performance tab)

```
──────────────────────────────────────────────────────
PERFORMANCE OVERVIEW
Period: [Last 30 days ▼]  (options: 7d, 30d, 90d)
──────────────────────────────────────────────────────

PLATFORM COMPARISON
┌──────────────┬───────────┬─────────────┬──────────┐
│ Platform     │ Posts     │ Avg engage% │ Top metric│
├──────────────┼───────────┼─────────────┼──────────┤
│ Instagram    │ 12        │ 3.4%        │ 84 saves │
│ Facebook     │ 12        │ 2.1%        │ 48 shares│
│ GBP          │ 8         │ —           │ —        │
└──────────────┴───────────┴─────────────┴──────────┘
Note: GBP engagement is shown in Local Presence below.

CONTENT TYPE COMPARISON
┌──────────────┬───────────┬─────────────┐
│ Type         │ Posts     │ Avg engage% │
├──────────────┼───────────┼─────────────┤
│ Events       │ 5         │ 4.2%        │
│ Promotions   │ 6         │ 2.8%        │
│ Weekly       │ 9         │ 2.0%        │
│ Instant      │ 3         │ 1.4%        │
└──────────────┴───────────┴─────────────┘

TOP POSTS (by Instagram saves, 7-day snapshot)
1. Burns Night Menu Launch      14 saves  3.9%  Instagram
2. Valentine's Dinner Promo     11 saves  3.1%  Instagram
3. Quiz Night reminder           6 saves  2.2%  Instagram
[Show all posts →]

LOCAL PRESENCE (GBP — last 30 days)
  Total impressions   8,420
  Direction requests    142
  Call clicks           38
  Website clicks        91
──────────────────────────────────────────────────────
```

No bar charts or line graphs in the initial version. Ranked lists and tables are faster to build, render on mobile without layout issues, and are easier to interpret at a glance. Charts can be added in v1.1 once the owner has confirmed they want them.

#### Platform comparison

The platform comparison table (above) is the primary mechanism. Key decisions:

- Instagram saves and Facebook shares are the primary sort metrics — they are the strongest signals of content that resonated (versus passive impressions).
- GBP is excluded from the engagement rate comparison because no per-post denominator exists. It gets its own "Local Presence" block.

#### Content type comparison

The content type table compares `campaign_type` values: `event`, `promotion`, `weekly`, `instant`. This directly answers the owner's question "do events outperform promos?"

---

### A6. Limitations and Honest UX

#### When to show "Analytics pending"

Show this state (clock icon, muted text, no numbers) when:
- A post has `status = 'posted'` but no `analytics_snapshots` row exists.
- A 24-hour snapshot exists but fewer than 6 days have elapsed since posting (7-day snapshot not yet due).

Never show a zero-filled metric table for a post that simply hasn't been fetched yet.

#### When to show "Analytics unavailable"

Show this state (warning icon, explanation text) when:
- `fetch_error` is set on the snapshot row.
- Include the plain-English reason if the error is recognisable: "The post may have been deleted from the platform" or "We couldn't reach Instagram — this sometimes happens when the connection token has expired."
- Provide a link to Connections to re-authorise if the error pattern suggests a token issue.

#### When to show "Not enough data"

For the summary/comparison tables: if fewer than 3 posts have a 7-day snapshot for the selected period, show:
```
Not enough data yet
Your first performance summary will appear here once you've published
at least 3 posts and their 7-day analytics have been collected.
```

Do not show a table with 1 or 2 rows because percentages and averages are meaningless at that sample size.

#### Stories

Story metrics are not available via API for third-party apps. Do not mention stories in analytics at all — they simply do not appear in any analytics view. Stories are a publishing-only feature from the analytics perspective.

#### GBP posts

GBP posts appear in the Planner and can be published, but they do not appear in the post-level analytics drawer metrics (GBP column shows "No per-post metrics available"). The "Local Presence" block in the summary view provides the GBP story through location-level data.

#### Posts published before analytics was enabled

If content items exist with `status = 'posted'` and no `external_post_id` (because the column was added after the fact), they cannot have analytics fetched. Show "Analytics not available for posts published before tracking was enabled" on their detail view. Do not attempt to backfill.

#### 90-day API window

For posts older than 90 days, the last successfully fetched 7-day snapshot is treated as the final value. Show a "(data finalised)" label to indicate the figures will not update. The `analytics_snapshots` row persists indefinitely in the database.

---

## PART B: Link-in-Bio Feature

### B1. Current Implementation Audit

The current implementation is a fully working, production-grade feature. Evidence:

**Data model** (`src/lib/link-in-bio/types.ts`, `src/lib/link-in-bio/profile.ts`)

Two database tables: `link_in_bio_profiles` and `link_in_bio_tiles`.

`link_in_bio_profiles` stores one row per account containing:
- `slug` (unique, URL identifier)
- `display_name`, `bio`
- `hero_media_id` (FK to `media_assets`)
- `theme` (JSONB with `primaryColor` and `secondaryColor`)
- Nine contact/link fields: `phone_number`, `whatsapp_number`, `booking_url`, `menu_url`, `parking_url`, `directions_url`, `facebook_url`, `instagram_url`, `website_url`

`link_in_bio_tiles` stores ordered, toggleable content cards with title, subtitle, CTA label/URL, and an optional media asset.

**Public data query** (`src/lib/link-in-bio/public.ts`)

The `getPublicLinkInBioPageData` function assembles the full page payload by:
1. Looking up the profile by slug using the service role client (bypasses RLS for public access).
2. Fetching enabled tiles in position order.
3. Querying `content_items` + `campaigns` to find currently-live campaign cards (between start and end dates) with a `link_in_bio_url` set on the campaign.
4. Resolving media asset signed URLs for hero, tiles, and campaign cards.
5. Returning a typed `PublicLinkInBioPageData` object.

**Public page** (`src/app/(public)/l/[slug]/page.tsx`)

A Next.js App Router Server Component at `/l/[slug]`. It calls `getPublicLinkInBioPageData`, redirects to `notFound()` on missing slug, and renders `LinkInBioPublicPage`.

**Public page UI** (`src/features/link-in-bio/public/link-in-bio-public-page.tsx`)

A single-file React component that renders:
- Logo from `/brands/[slug]/logo.png`
- Optional bio text
- Primary CTA buttons (call, directions, WhatsApp, booking, menu, parking) in a 2–3 column grid
- Hero image
- Live campaigns section (cards with media and names, linked to campaign URL)
- Evergreen "Always on" tiles section
- Social links (Facebook, Instagram, website) as outlined buttons

The component accepts the full `PublicLinkInBioPageData` type. No client-side JavaScript beyond Next.js hydration. Brand colours are applied via inline `style` attributes.

**Settings UI** (`src/features/settings/link-in-bio/link-in-bio-settings-section.tsx`, `link-in-bio-profile-form.tsx`)

A settings section in the app with:
- `LinkInBioProfileForm`: react-hook-form + Zod form covering all profile fields, colour pickers, hero image selector (dropdown from media library)
- `LinkInBioTileManager`: (referenced but not included in the files read — assumed to be a CRUD interface for tiles)

**What works well**

- Slug-based routing with `notFound()` on invalid slugs.
- Theme system (primary/secondary colour) applied without CSS variables.
- Campaign card integration pulls live content directly from the publishing pipeline.
- Clean separation between public data access (service role) and authenticated management (RLS).
- The media shape (`square` / `story`) is preserved to set correct `<Image>` dimensions.

**What is limited or missing**

- No slug validation for uniqueness at the database level (the current `upsert` uses `onConflict: 'account_id'`, meaning one profile per account, so collision would only occur if two accounts claim the same slug — the unique constraint on `slug` needs confirming in the actual migration).
- The logo is served from `/public/brands/[slug]/logo.png` — a static file path convention that is not managed through the media library. This is a brittleness: the rebuild should route logo display through the media library or a configurable field.
- No caching annotations on the public page (`/l/[slug]`). The function calls Supabase with a service client on every request and generates signed URLs (10-minute expiry). Under load this creates significant API overhead.
- The campaign card visibility logic (active between first and last entry dates) is complex and computed in application code rather than a database query, making it harder to test in isolation.
- `heroMediaId` uses signed URLs that expire in 600 seconds. If the page is cached by a CDN, the signed URLs in the cached HTML will expire before the cache TTL. The rebuild must use public URLs or generate signed URLs server-side on each render without CDN caching of the HTML itself.

---

### B2. Scope Decision for Rebuild

**Recommendation: include link-in-bio in the MVP rebuild.**

Justification:

1. The feature is already proven and complete. The rebuild is not designing it from scratch — it is translating a working implementation into the new codebase. Estimated effort is 2–3 days, not a major workstream.
2. It is actively used. The current codebase references `/l/[slug]` in the public route group, profile forms are in Settings, and campaigns write `link_in_bio_url` values that feed directly into it. Excluding it from the rebuild would leave the owner without a link-in-bio page during the transition.
3. The integration with campaigns is tight. The public page pulls live campaign data from `content_items`. If the rebuild ships without link-in-bio, the campaign data model must still include `link_in_bio_url` fields that go nowhere — a source of confusion.
4. The complexity is low. The data model is two tables. The public page is a single Server Component. The settings form is straightforward. The campaign integration is a read-only query.

The one significant concern is caching. This is addressed explicitly in B3 below.

---

### B3. Rebuild Specification

#### Data model

The rebuild uses two tables directly carried over from the current implementation, with one addition (logo media field) and one correction (explicit unique index on slug).

```sql
-- ============================================================
-- link_in_bio_profiles
-- One row per account. Slug is the public URL identifier.
-- ============================================================
create table public.link_in_bio_profiles (
  account_id          uuid          primary key references public.accounts (id) on delete cascade,
  slug                text          not null,
  display_name        text,
  bio                 text          check (char_length(bio) <= 300),
  hero_media_id       uuid          references public.media_assets (id) on delete set null,
  logo_media_id       uuid          references public.media_assets (id) on delete set null,
  -- JSONB containing { primaryColor: string, secondaryColor: string }
  theme               jsonb         not null default '{}'::jsonb,
  -- Contact / CTA links
  phone_number        text,
  whatsapp_number     text,
  booking_url         text,
  menu_url            text,
  parking_url         text,
  directions_url      text,
  facebook_url        text,
  instagram_url       text,
  website_url         text,
  created_at          timestamptz   not null default now(),
  updated_at          timestamptz   not null default now()
);

-- Slug must be globally unique (one slug → one venue)
create unique index link_in_bio_profiles_slug_idx
  on public.link_in_bio_profiles (lower(slug));

-- RLS
alter table public.link_in_bio_profiles enable row level security;

create policy "Owner access" on public.link_in_bio_profiles
  for all
  using  (auth.uid() = account_id)
  with check (auth.uid() = account_id);

-- Public read access for the /l/[slug] route
-- (alternatively, use the service role in Server Components — see caching note)
create policy "Public read by slug" on public.link_in_bio_profiles
  for select
  using (true);
```

```sql
-- ============================================================
-- link_in_bio_tiles
-- Ordered, toggleable content cards on the public page.
-- ============================================================
create table public.link_in_bio_tiles (
  id              uuid          primary key default gen_random_uuid(),
  account_id      uuid          not null references public.accounts (id) on delete cascade,
  title           text          not null check (char_length(title) <= 80),
  subtitle        text          check (char_length(subtitle) <= 160),
  cta_label       text          not null check (char_length(cta_label) <= 40),
  cta_url         text          not null,
  media_asset_id  uuid          references public.media_assets (id) on delete set null,
  position        integer       not null default 0,
  enabled         boolean       not null default true,
  created_at      timestamptz   not null default now(),
  updated_at      timestamptz   not null default now()
);

create index link_in_bio_tiles_account_id_idx
  on public.link_in_bio_tiles (account_id, position asc, created_at asc);

alter table public.link_in_bio_tiles enable row level security;

create policy "Owner access" on public.link_in_bio_tiles
  for all
  using  (auth.uid() = account_id)
  with check (auth.uid() = account_id);

create policy "Public read" on public.link_in_bio_tiles
  for select
  using (true);
```

**Slug generation rules**

1. Auto-generated from venue name when the profile is first created: lowercase, spaces replaced with hyphens, non-alphanumeric characters stripped. Example: "The Anchor, Shepperton" → `the-anchor-shepperton`.
2. Owner can override manually in Settings. Validation: `/^[a-z0-9-]{3,60}$/`.
3. Unique constraint on `lower(slug)` enforced at the database level. The settings form must check availability via a Server Action before saving and return a field error if taken.
4. Slug changes take effect immediately. Old slugs are not redirected (single-owner app; no third-party slug sharing). A one-line note in the Settings UI: "Changing your slug will break any existing links that use the old address."

#### Public page specification

**Route**: `src/app/(public)/l/[slug]/page.tsx`

The page is a Next.js App Router **Server Component**. It must not have `'use client'` at the top level.

**Caching strategy**

The current implementation has a caching problem: signed URLs (Supabase Storage) expire after 600 seconds but the page renders fresh per-request. Two viable approaches for the rebuild:

Option A (recommended): **No CDN caching; media assets use public bucket URLs.**
- Set Supabase Storage bucket for media to public read.
- Use `supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path)` instead of `createSignedUrls`.
- Public URLs are permanent; they can be embedded in cached HTML without expiry problems.
- The page can then use Next.js `revalidate` to cache at the edge: `export const revalidate = 300` (5 minutes). When the owner updates their profile, call `revalidatePath('/l/[slug]')` from the Server Action.
- Trade-off: media assets become publicly accessible by URL without authentication. For a venue's marketing images this is acceptable — they are intended to be public.

Option B (fallback if the bucket must remain private): **No CDN caching; per-request signed URL generation.**
- Keep `createSignedUrls` but set `export const dynamic = 'force-dynamic'` to prevent any caching.
- TTL of signed URLs set to 3600 seconds (1 hour) to reduce Supabase API calls.
- The page will be slower (cold render on every request) but correct.

**The rebuild should use Option A unless the owner has a specific reason to keep media private.**

**Metadata**

```typescript
export async function generateMetadata({ params }): Promise<Metadata> {
  const data = await getPublicLinkInBioPageData((await params).slug.toLowerCase());
  if (!data) return { title: 'Not found' };
  return {
    title: data.profile.displayName ?? data.profile.slug,
    description: data.profile.bio ?? undefined,
    openGraph: {
      title: data.profile.displayName ?? data.profile.slug,
      description: data.profile.bio ?? undefined,
      // Hero image as OG image if available
      images: data.heroMedia ? [{ url: data.heroMedia.url }] : [],
    },
  };
}
```

**Component structure**

The public page component remains a single Server Component, rendering:

1. **Header block**: logo (from `logo_media_id` in media library, or fallback text if not set), display name, bio.
2. **Primary CTAs**: 2–3 column pill button grid. Order: Call → Find us → WhatsApp → Book a table → See our menu → Book parking. Omit any with null URL.
3. **Hero image**: full-width, rounded corners, from `hero_media_id`. Omit section if not set.
4. **Campaigns**: "What's on" heading. Cards sorted by `end_at` ascending (soonest-ending first). Show "Nothing on right now — check back soon" if empty.
5. **Evergreen tiles**: "Always on" heading. Cards with image, title, subtitle, CTA label. Omit section if no enabled tiles.
6. **Social links**: Facebook, Instagram, website as outlined buttons.
7. **Footer**: "Powered by CheersAI" with link. Can be removed by owner in a future setting.

**No JavaScript** is required on the public page. The component renders pure HTML. No `useState`, no `useEffect`, no client interactivity.

**Performance targets**

- Largest Contentful Paint < 1.5s on a 4G mobile connection.
- Total page weight < 200KB HTML + initial CSS. Images are loaded lazily except the logo (marked `priority`).
- All `<Image>` components use `sizes` attributes appropriate to their display context.

**Custom domain support (future consideration)**

The rebuild does not implement custom domains in v1. The URL structure remains `https://[app-domain]/l/[slug]`. The architecture (slug-based routing, Server Components) is compatible with a future custom domain feature using Next.js middleware to map custom hostnames to slugs. No changes are needed in v1 to support this later.

#### Settings page specification

Settings for link-in-bio live under `Settings > Link in bio`. This is an existing section in the current codebase and carries over unchanged in structure.

**Form sections**

1. **Profile** (inline form, saves on submit)
   - Slug (text input, with live availability check via debounced Server Action, format hint, warning about slug changes)
   - Display name (text input)
   - Bio (textarea, 300-character limit with counter)
   - Logo (media library picker — new in rebuild, replaces the static file convention)
   - Hero image (media library picker)
   - Primary colour (colour input, default `#005131`)
   - Secondary colour (colour input, default `#a57626`)

2. **Contact & links** (within the same form)
   - Phone number
   - WhatsApp number
   - Book a table URL
   - Menu URL
   - Book parking URL
   - Find us URL (Google Maps link)
   - Facebook URL
   - Instagram URL
   - Website URL

3. **Tiles** (separate section, below the profile form)
   - List of current tiles with enable/disable toggle, position drag handles, edit and delete actions.
   - "Add tile" button opens an inline form: title, subtitle, CTA label, CTA URL, media picker.
   - Maximum 12 tiles (enforced by UI, not database).

**Slug availability check**

Server Action `checkLinkInBioSlugAvailability(slug: string): Promise<{ available: boolean }>` queries `link_in_bio_profiles` for `lower(slug) = lower(:slug)` excluding the current account's own row. Called on blur from the slug field; result shown inline.

---

### B4. Integration Points

#### Instagram profile image

The Instagram Graph API returns a `profile_picture_url` for the connected page when the `instagram_basic` scope is granted. However:
- This URL is temporary and expires.
- It points to a small, compressed image not suitable as a full-size logo.
- The owner's brand logo and their Instagram profile photo are distinct assets.

**Decision**: do not auto-populate the link-in-bio logo from Instagram. Instead, the `logo_media_id` field in the settings form lets the owner choose the correct brand logo from the media library, where it is stored permanently at proper resolution.

The Instagram URL field in the profile form (`instagram_url`) **should** be auto-populated when an Instagram connection is active. On the Connections page, after a successful Instagram OAuth flow, write the connected Instagram profile URL (`https://instagram.com/[username]`) back to `link_in_bio_profiles.instagram_url` if the field is currently empty. Do not overwrite an existing value.

Similarly, auto-populate `facebook_url` from the connected Facebook page URL after OAuth if the field is empty.

#### Recent published posts on the link-in-bio page

The current implementation already integrates live campaign content into the public page. The rebuild should preserve this behaviour: campaign cards appear on the public page when:
- The campaign has a `link_in_bio_url` set (either on the campaign directly or in `campaigns.metadata.linkInBioUrl`).
- The current datetime is between the campaign's first scheduled content item date and the last scheduled item's end-of-day.

This is content the owner actively selected for the page via the campaign settings — it is not an automatic "most recent posts" feed. Individual post images (from `content_variants`) are shown as campaign card media.

#### GBP details (address, phone, hours)

GBP account data accessible via the `My Business Account Management API` includes location details: address, phone number, regular hours, website. These are available after the GBP OAuth connection is established.

**Decision**: auto-populate the following link-in-bio fields from GBP on first connection, if the fields are currently empty:

| GBP field              | Link-in-bio field  |
|------------------------|--------------------|
| `phoneNumbers.primaryPhone` | `phone_number`    |
| `websiteUri`           | `website_url`      |
| `metadata.mapsUri`     | `directions_url`   |

Do not auto-populate on subsequent connections or token refreshes — only on the initial connection event when the fields are null. The owner may have customised them since.

Opening hours are not surfaced on the link-in-bio page in v1. They could be added as a tile or a structured section in v1.1.

---

## Appendix: Scope Summary Table

| Feature                              | v1 MVP | v1.1 |
|--------------------------------------|--------|------|
| Analytics snapshots (24h + 7d)       | Yes    |      |
| Per-post metrics in Planner drawer   | Yes    |      |
| Performance summary tab in Planner   | Yes    |      |
| GBP Local Presence block             | Yes    |      |
| Bar/line charts                      |        | Yes  |
| Analytics export (CSV)               |        | Yes  |
| Link-in-bio public page              | Yes    |      |
| Link-in-bio settings form            | Yes    |      |
| Link-in-bio tiles manager            | Yes    |      |
| Campaign cards on link-in-bio        | Yes    |      |
| Logo from media library              | Yes    |      |
| Auto-populate from GBP on connect    | Yes    |      |
| Custom domain for link-in-bio        |        | Yes  |
| Opening hours on link-in-bio         |        | Yes  |
| Story analytics                      | N/A    |      |
