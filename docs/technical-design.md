# CheersAI Rebuild Technical Design

## 1. System Architecture Overview
- **Client**: Next.js App Router using Server Components for data fetching, client components for interactive editors and drag-and-drop planner.
- **API Layer**: Server Actions and REST-like routes hosted on Vercel/Node runtime; handles authentication, validation, and orchestration of domain services.
- **Persistence**: Supabase Postgres (single-tenant schemas) with Row Level Security scoped to owner user; Supabase Storage for media files.
- **Background Jobs**: Dedicated worker (Supabase Edge Function or Vercel Cron-triggered worker) processing scheduling queue, publishing tasks, and token health checks.
- **Third-Party Integrations**: Facebook Graph API, Instagram Graph API, Google Business Profile API, OpenAI GPT-4o for content generation, optional email provider (Resend) for failure notifications.
- **Observability**: Central logging service (e.g. Logflare/Datadog) ingesting structured JSON logs; metrics captured per publish job and surfaced in internal dashboards.

### Component Interactions
1. Client triggers server actions for campaign creation and content generation.
2. Server validates input (Zod schemas), persists campaign/content items, enqueues publishing tasks.
3. Background worker polls queue, retrieves publish jobs, calls provider SDKs/APIs with stored tokens, updates job status.
4. Notifications service emits alerts for failures or token expiry, stored for in-app display and optional email.

## 2. Application Modules
- **Auth Module**: Single-owner email/password with optional passkey; Supabase Auth handles sessions; custom middleware ensures owner-only routing.
- **Settings Module**: CRUD for brand voice, tone sliders, default CTAs, notification preferences, default location IDs.
- **Library Module**: Media upload (images/videos) via signed URLs; metadata tagging; content drafts store.
- **Campaign Module**: Campaign wizard flows, scheduling logic, AI prompt orchestration.
- **Scheduler Module**: Applies campaign templates to generate timeline slots, resolves conflicts, manages recurring posts.
- **Publishing Module**: Queue handler, provider-specific adapters, retry logic, fallback asset packaging.
- **Notification Module**: In-app feed + email integration, token health monitoring.

## 3. Data Model (Proposed Tables)
```
accounts (
  id uuid primary key references auth.users(id),
  email text not null,
  display_name text,
  timezone text default 'Europe/London',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
)

brand_profile (
  account_id uuid primary key references accounts(id),
  tone_formal numeric default 0.5,
  tone_playful numeric default 0.5,
  key_phrases text[],
  banned_topics text[],
  default_hashtags text[],
  default_emojis text[],
  instagram_signature text,
  facebook_signature text,
  gbp_cta text,
  updated_at timestamptz default now()
)

social_connections (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references accounts(id) on delete cascade,
  provider text check (provider in ('facebook','instagram','gbp')),
  status text check (status in ('active','expiring','needs_action','disconnected')),
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  external_page_id text,
  external_location_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
)

media_assets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references accounts(id) on delete cascade,
  storage_path text not null,
  media_type text check (media_type in ('image','video')),
  mime_type text,
  width integer,
  height integer,
  duration_seconds numeric,
  tags text[],
  uploaded_at timestamptz default now()
)

campaigns (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references accounts(id) on delete cascade,
  name text not null,
  campaign_type text check (campaign_type in ('event','promotion','weekly','instant')),
  start_at timestamptz,
  end_at timestamptz,
  hero_media_id uuid references media_assets(id),
  auto_confirm boolean default false,
  status text check (status in ('draft','scheduled','completed','cancelled')) default 'draft',
  metadata jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
)

content_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references campaigns(id) on delete set null,
  account_id uuid references accounts(id) on delete cascade,
  platform text check (platform in ('facebook','instagram','gbp')),
  scheduled_for timestamptz,
  status text check (status in ('draft','scheduled','publishing','posted','failed')) default 'draft',
  prompt_context jsonb,
  auto_generated boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
)

content_variants (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid references content_items(id) on delete cascade,
  body text,
  media_ids uuid[],
  preview_data jsonb,
  validation jsonb,
  updated_at timestamptz default now()
)

publish_jobs (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid references content_items(id) on delete cascade,
  attempt integer default 0,
  status text check (status in ('queued','in_progress','succeeded','failed')) default 'queued',
  last_error text,
  provider_response jsonb,
  next_attempt_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
)

notifications (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references accounts(id) on delete cascade,
  category text,
  message text,
  read_at timestamptz,
  metadata jsonb,
  created_at timestamptz default now()
)
```

### RLS Strategy
- All tables include `account_id` (except singleton brand profile) and enforce `auth.uid() = account_id`.
- Publishing worker uses service role key but scopes queries by account_id derived from content item to maintain isolation.

## 4. Domain Workflows
### 4.1 Campaign Creation
1. User selects campaign type in **Create**.
2. Form captures required fields (dates, CTA, hero media) with defaults from Settings.
3. Server Action generates draft `campaign` row; scheduling engine computes recommended slots.
4. For each slot, `content_item` + `content_variant` records created with AI-generated copy via prompt template.
5. User edits in unified editor; changes saved via optimistic updates.
6. When ready, user hits "Schedule"; items with `auto_confirm` true move directly to `scheduled`, others prompt confirmation.

### 4.2 Weekly Recurring Engine
- Recurring campaign stores day-of-week/time pattern in `metadata`.
- Cron task runs daily to materialise upcoming week’s `content_items` if missing.
- Conflicts resolved by shifting within configurable window (e.g. ±2 hours) or flagging for user action.

### 4.3 Publishing Pipeline
1. Scheduler inserts `publish_jobs` with `queued` status once `scheduled_for` is within execution window (e.g. 5 minutes).
2. Worker picks next due job, transitions to `in_progress`, fetches credentials from `social_connections`.
3. Provider adapter uploads media (handling video transcoding when required), posts content, captures external ID.
4. On success, worker updates `content_items.status = 'posted'`, stores provider response; notifications created.
5. On failure, records error, calculates backoff (e.g. 5m, 15m, 30m). After third failure, mark `failed`, generate fallback package link.

### 4.4 Token Health Monitoring
- Nightly job inspects `social_connections.expires_at`; if within 5 days, sets status to `expiring` and triggers notification/email with reconnect CTA.

## 5. AI Prompt Strategy
- Templates per campaign type + platform combine brand profile, campaign metadata, recent engagement cues.
- Use structured prompts: system message defines voice, user message includes campaign context, assistant seeded with platform best practices.
- Implement guardrails: check banned topics, profanity filter, ensure CTA present (GBP requires button text).
- Provide regenerate functionality per platform variant with optional tweaks (tone slider, include/exclude hashtags).

## 6. Scheduling Logic
- Default offsets: events (-7d 10:00, -3d 10:00, day-of 11:00, day-of 17:00 reminder); promotions (launch 09:00, mid-run 12:00, last chance 09:00 final day); weekly recurring (user-defined day/time).
- Conflict resolution order: shift by +1 hour (within same day), else -1 hour, else flag manual action.
- Timezone enforcement from account settings; daylight saving handled via Luxon/Temporal API.

## 7. Reliability & Testing
- Unit tests for scheduling calculators, prompt builders, validation functions.
- Integration tests using MSW to mock provider APIs; ensure retries behave correctly.
- End-to-end smoke tests for campaign creation → posting via Playwright running against staging with mocks enabled.
- Chaos testing idea: simulate provider downtime to verify fallback packaging and notifications.

## 8. Deployment & Operations
- Environments: `dev`, `staging`, `prod`. Staging uses test tokens and mock providers.
- Infrastructure as Code (optional) for provisioning storage buckets and cron schedules.
- Backup strategy: daily database snapshots via Supabase, media replication; queue dead-letter review daily.
- Runbooks stored alongside doc for reconnecting tokens, rotating credentials, handling publish outages.

## 9. Open Technical Decisions
- Choose between Supabase Edge Functions vs external worker (e.g. QStash) for queue processing.
- Determine media transcoding pipeline (client-side pre-processing vs serverless function using FFmpeg).
- Decide on email provider (retain Resend or switch to alternative).

## 10. Next Technical Deliverables
1. Schema migration scripts derived from table definitions (to live in `supabase/migrations` once ready).
2. API contract document describing server action inputs/outputs.
3. Sequence diagrams for publishing pipeline and token refresh routines.
4. Runbook templates for operational response.
