# CheersAI Rebuild PRD

## 1. Overview
- **Objective**: Replace the current multi-tenant CheersAI app with a single-owner content command centre focused on stability, speed, and brand-aligned output for one venue.
- **Guiding Principle**: "Simple" – minimise cognitive load, remove brittle flows, and keep the interface familiar while streamlining navigation and dependencies.
- **Scope Start**: Fresh build; no legacy data, analytics, billing, team access, or watermarking considerations.

## 2. Product Goals & Success Criteria
- **Reliability**: End-to-end posting flow succeeds on the first attempt ≥99.9% of the time; publishing job failure rate <1% per month.
- **Efficiency**: Owner can generate, review, and schedule a full seven-day plan in ≤15 minutes, staying within three primary screens.
- **Quality**: AI-generated copy is accepted without edits for ≥70% of posts; previews feel “native” to each platform.
- **Simplicity**: No more than five top-level navigation targets; each workflow uses plain language and defaults that “just work”.

### Guardrails
- No multi-tenant logic, subscription management, approvals, or analytics dashboards.
- All flows assume a single authenticated owner.
- Focus on Facebook, Instagram, and Google Business Profile (GBP) only.

## 3. User Persona & Core Jobs
- **Persona**: Pub/restaurant owner managing marketing solo, using desktop and mobile interchangeably.
- **Primary Jobs-to-be-Done**:
  1. Plan content for the coming week (events, promotions, recurring posts).
  2. Generate platform-specific copy and media that match the brand tone.
  3. Schedule and publish to Facebook (posts & stories), Instagram (posts & stories), and GBP (updates, events, offers) with minimal fuss.
  4. Monitor publishing status and resolve failures quickly when they occur.

## 4. Scope Definition
### In Scope
- Brand voice/settings module without onboarding wizard.
- Campaign creation for events, promotions, instant posts, and weekly recurring slots.
- Unified editor producing platform-specific variants (copy + media attachments).
- Scheduling engine with smart defaults and manual override.
- Publishing pipeline with retries, job tracking, and actionable fallbacks.
- Media library supporting images and video, with tagging and compression.
- Connection management for Facebook, Instagram, and GBP.
- Basic notifications (in-app + optional email) for publishing failures and token issues.

### Out of Scope
- Multi-user roles, teams, or tenant management.
- Billing, subscriptions, and plan enforcement.
- Advanced analytics dashboards or reporting exports.
- Historical data migration.
- Watermarking or media branding tooling.

## 5. Information Architecture
1. **Planner**: Default landing view combining upcoming schedule, campaign cards, and status feed.
2. **Create**: Guided flows for campaigns (events, promotions, weekly recurring) and instant posts.
3. **Library**: Media assets, saved drafts, and AI prompt presets.
4. **Connections**: Social account status, token health, default location/CTA settings per platform.
5. **Settings**: Brand voice, posting defaults, notification preferences, owner credentials.

> Navigation limited to these five items; contextual modals/side drawers handle sub-steps.

## 6. Key Workflows
1. **Weekly Planning**
   - From Planner, select "Create Weekly Plan" → choose templates for recurring slots → auto-generate draft posts per platform → review on single editor screen.
2. **Event Launch**
   - Trigger from Planner or Create → input event details (title, date/time, hero media, venue/location pre-filled) → system proposes timeline (T-7, T-3, day-of, final boost) → owner edits content → schedule.
3. **Promotion Campaign**
   - Similar to event but with offer duration and CTA focus (e.g. "Book Now", "Call") → optional weekly repeats.
4. **Instant Post**
   - Quick flow: select platform(s), attach media, enter prompt, receive AI copy, tweak, publish now or schedule next available slot.
5. **Monitoring & Recovery**
   - Planner shows status chips (Scheduled, Publishing, Posted, Attention Needed). Clicking a failure opens actionable detail with retry options or "Download assets" fallback.

## 7. Functional Requirements
### 7.1 Brand Voice & Settings
- Single settings page capturing: tone sliders (casual ↔ formal, playful ↔ serious), key phrases to include, topics to avoid, default hashtags/emojis, default GBP CTA.
- Ability to save platform-specific signatures (e.g. Instagram hashtag set).
- Optional AI “test post” preview to validate tone.

### 7.2 Campaign Types
- **Events**: include start/end, hero media, optional RSVP link. Auto-generate timeline slots at configurable offsets (defaults: -7d, -3d, day-of AM, day-of 1h before).
- **Promotions**: start/end dates, offer summary, CTA. Default cadence: announcement, mid-promo reminder, last chance.
- **Weekly Recurring**: specify day/time and theme (e.g. "Thursday Quiz Night"). System auto-generates each week; owner can pause/resume.
- **Instant Posts**: on-demand creation with immediate publish or manual schedule.

### 7.3 Editor & AI Generation
- Unified canvas presenting per-platform tabs with real-time previews (Facebook, Instagram, GBP).
- AI prompt builder using campaign metadata + brand voice. Owner can add context (e.g. “focus on live music”).
- Multi-attachment support (images, videos) with drag-and-drop ordering.
- Auto-formatting per platform (character limits, CTA placement, emoji strategy).
- Content validation: highlight issues (too long, missing CTA, banned topics) before scheduling.

### 7.4 Scheduling & Calendar
- Timeline automatically populated by campaign rules; owner may drag items across days/times.
- Conflict detection (same platform double-booked) with suggestions to resolve.
- Timezone defaults to venue location; ability to override per post.
- Auto-confirm option to skip manual approvals for recurring slots.

### 7.5 Publishing Pipeline
- Queue worker executes posts, supports:
  - Facebook: feed posts (multi-image/video), stories, events (create/update).
  - Instagram: feed posts (carousel/video), stories.
  - GBP: updates with CTA buttons, events, offers.
- Each publish job logs request/response snapshots, attempts (max 3 with exponential backoff), and final status.
- On final failure, surface "Download copy & media" with platform-specific instructions.
- Health checks ensuring tokens valid before scheduling (pre-flight validation).

### 7.6 Notifications & Status
- Planner status feed shows recent actions, upcoming items, and failures.
- Optional email summaries for failed posts and expiring tokens.
- Connection health indicators (OK, expiring soon, needs action) on Planner and Connections page.

## 8. Integrations Detail
### 8.1 Facebook
- OAuth connection flow; store page access token securely.
- Support location tagging (pre-configured default) for posts and stories.
- Event management: create/update via Graph API with event metadata from campaigns.
- Story publishing via Content Publishing API (story-specific limits handled in validation).

### 8.2 Instagram
- Publish feed posts (single, carousel, video) and stories via Instagram Graph API.
- Enforce media requirements (aspect ratios, duration) during upload; provide auto-cropping if needed.
- Location tagging reused from Facebook (shared page metadata).

### 8.3 Google Business Profile
- OAuth using Google My Business API.
- Post types supported: standard updates (with CTA buttons), events (title, start/end), offers (coupon code, redemption URL).
- Validate content length, image/video specs, and CTA availability per post type.

## 9. Media Management
- Use Supabase Storage (or alternative object storage) for images/videos.
- Automatic compression/transcoding pipeline producing platform-ready variants.
- Tagging, search by campaign, and quick filters (e.g. “Event Banners”).
- No watermarking; maintain original files plus optimised outputs.

## 10. Reliability & Observability
- Structured logging with correlation IDs for each publish job.
- Metrics: job success rate, retry count, time-to-publish, token health.
- Alert thresholds (e.g. >5% failures in 15 minutes) trigger internal notifications.
- Background worker runs on dedicated serverless function or managed queue service with dead-letter handling.

## 11. Data Model (Conceptual)
- `account_settings`: singleton storing owner info, timezone, notification prefs, default location ID.
- `brand_profile`: tone sliders, keywords, banned topics, default hashtags, CTA preferences.
- `social_connections`: provider, auth tokens, expiry, status, location/page IDs.
- `campaigns`: id, type, name, start/end, status, automation flags.
- `content_items`: campaign_id nullable (for instant posts), platform, scheduled_time, status, ai_prompt_context, publish_job_id.
- `content_variants`: references content_items, stores platform-specific copy and media references.
- `media_assets`: path, type, tags, derived renditions.
- `publish_jobs`: per attempt metadata, provider responses, retry counters.

## 12. Technical Architecture
- **Frontend**: Next.js App Router with Server Components; TanStack Query for client states; Tailwind for styling. Reuse existing design tokens.
- **Backend**: Server Actions for data mutations; Supabase Postgres for persistence; Supabase Storage for media; Edge caching disabled for authenticated routes.
- **AI Services**: OpenAI GPT-4o or equivalent; build prompt templates for each campaign type and platform.
- **Background Jobs**: Dedicated worker (Vercel Cron + queue or Supabase Edge Functions) executing scheduled publishes with idempotency keys.
- **Validation**: Zod schemas for all inputs; platform-specific rules enforced pre-publish.

## 13. Security & Compliance
- Single-owner auth with secure password + optional passkey; MFA considered but optional.
- Supabase RLS simplified to owner ID; no tenant joins.
- Encrypt external tokens at rest using existing AES-256-GCM helper.
- Store minimal personal data; comply with Facebook/Google platform policies.

## 14. UX Principles
- Maintain current typography and component library but remove redundant navigation levels.
- Use progressive disclosure: advanced scheduling and prompt controls hidden behind “Fine-tune” toggles.
- Provide inline copy guidance (e.g. “Facebook posts perform best between 40–80 words”).
- Mobile-first layouts for Planner and Editor; ensure drag-and-drop has accessible alternative actions.

## 15. Implementation Plan
1. **Phase 1 – Foundations (Weeks 1–3)**
   - Set up new Next.js project, simplified auth, database schema, Connections hub.
   - Implement Settings (brand voice, defaults) and Media Library MVP.
   - Establish publishing queue infrastructure and logging.
2. **Phase 2 – Content Workflows (Weeks 4–6)**
   - Build campaign/instant creation flows, AI prompt templates, unified editor with previews.
   - Implement media attachment handling (images + video) and validation.
3. **Phase 3 – Scheduling & Publishing (Weeks 7–9)**
   - Develop scheduling engine, drag-and-drop adjustments, conflict detection.
   - Integrate queue with Facebook/Instagram/GBP APIs; add retry + fallback flows.
4. **Phase 4 – Polish & Hardening (Weeks 10–12)**
   - Add story/event/offer special cases, CTA presets, notification system.
   - Conduct reliability testing, load simulations, usability passes.
   - Finalise documentation, operational runbooks, and go-live checklist.

## 16. Risks & Mitigations
- **API Changes**: Facebook/Instagram/GBP policies evolve; maintain abstraction layer per provider and monitor changelogs.
- **Video Publishing Complexity**: Ensure transcoding pipeline meets platform specs; fall back to manual publish if unsupported format.
- **AI Quality Drift**: Regularly review prompt templates; allow quick manual adjustment per campaign.
- **Scheduling Conflicts**: Provide clear conflict resolution UI and automated suggestions.

## 17. Open Questions
- Preferred storage provider if Supabase limits become an issue (retain flexibility).
- Exact notification channels (email only vs push/SMS) – default to email unless instructed otherwise.
- Analytics-lite needs (e.g. simple activity counts) – currently out of scope, revisit if requested.

## 18. Next Steps
1. Review and confirm scope, IA, and phased plan with the owner.
2. Translate PRD into technical design docs (schema DDL, API contracts, job flow diagrams) within the same `docs/rebuild` folder.
3. Prepare estimation and resource plan once scope is signed off.
