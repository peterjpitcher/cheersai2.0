---
title: Content & Publishing Rules
created: 2026-03-14
last_updated: 2026-03-14
status: current
tags:
  - type/reference
  - section/business-rules
  - module/create
  - module/planner
related:
  - "[[Content Creation & Campaigns]]"
  - "[[Planner]]"
  - "[[Schema]]"
---

← [[_Index]] / [[_Business Rules MOC]]

# Content & Publishing Rules

## Platform Rules

### All Platforms
- Content requires at least one platform selection
- Content status lifecycle: `draft` → `scheduled` → `queued` → `publishing` → `posted` / `failed`

### Facebook
- Up to 120 words recommended
- Hashtags optional (user-controlled)
- CTA URL supported (URL not included in copy — appended by Facebook)
- Optional signature appended verbatim if configured
- Supports both feed and story placement

### Instagram
- Up to 80 words recommended
- No URLs in copy
- Link-in-bio reference line included if a URL is provided
- Hashtags optional; up to 10, preferring `defaultHashtags` from brand settings
- Optional signature appended verbatim if configured
- Supports both feed and story placement

### Google Business Profile (GBP)
- Under 150 words (hard limit: 900 characters)
- No hashtags
- No exclamation-heavy language
- CTA action type required (LEARN_MORE, BOOK, CALL, REDEEM depending on post type)
- Feed only — does not support stories

## Story Constraints
- Exactly one image required (no video)
- Facebook and Instagram only (GBP excluded)
- No text prompt required (stories are image-first)

## Scheduling Rules
- Immediate publish: `publish_jobs.next_attempt_at = now()`
- Scheduled publish: `publish_jobs.next_attempt_at = scheduledFor`
- Draft: no `publish_jobs` row until approved
- Scheduled posts require at least one media asset (enforced by Zod schema)

## Content Lifecycle
- **Soft delete**: `content_items.deleted_at` is set; item moves to trash in the planner
- **Trash retention**: Purge-trash cron removes items after configured retention period
- **Restore**: `deleted_at` cleared, status set back to `draft`

## Publish Job Rules
- A `publish_jobs` row is created by `enqueuePublishJob()` with `status=queued`
- The `publish-queue` Edge Function picks up jobs where `status=queued` AND `next_attempt_at <= now()`
- On success: `content_items.status = posted`, `publish_jobs.status = succeeded`
- On failure: `content_items.status = failed`, `publish_jobs.status = failed`, `last_error` populated
- Retries: the Edge Function may update `next_attempt_at` and retry; `attempt` count is incremented
- `placement` on `publish_jobs` determines whether to publish as feed or story

## AI Content Rules

### Brand Voice Application
- Tone sliders (0–1 scale) → three-tier descriptors (low/mid/high) → included in system prompt
- Key phrases: "weave in if natural" — not forced into every post
- Banned phrases: merged with system-level bans from `src/lib/ai/voice.ts` — AI explicitly told to avoid
- Banned topics: AI instructed not to mention these at all

### Voice and Grammar Rules (non-negotiable in prompts)
- British English throughout
- First-person plural: "we/us/our" — never "I" or second person
- "we" is subject only: ✅ "We're serving" ❌ "Come to we"
- "us" is object only: ✅ "Join us" ❌ "We will welcome us"
- Venue name in exactly three permitted positions: opening hook, location reference, sign-off
- Venue name NEVER as grammatical subject of body copy sentence

### Hashtag Rules
- Instagram: up to 10 hashtags total, preferring brand defaults
- Facebook: 2–3 hashtags if enabled, in CTA section, not in body
- GBP: no hashtags ever
