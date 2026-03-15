---
title: Data Flow
created: 2026-03-14
last_updated: 2026-03-14
status: current
tags:
  - type/reference
  - section/architecture
related:
  - "[[Overview]]"
  - "[[Auth & Security]]"
  - "[[Server Actions]]"
---

← [[_Index]] / [[_Architecture MOC]]

# Data Flow

## Request Lifecycle

```mermaid
sequenceDiagram
  participant B as Browser
  participant MW as Next.js Middleware
  participant SC as Server Component
  participant SA as Server Action
  participant DB as Supabase DB
  participant OAI as OpenAI API

  B->>MW: HTTP Request
  MW->>DB: getUser() — JWT refresh
  MW-->>B: Redirect /login (unauthenticated)
  MW-->>SC: Pass request (authenticated)
  SC->>DB: Data query (anon key + RLS)
  DB-->>SC: Filtered rows
  SC-->>B: Rendered HTML

  Note over B,SA: User submits form
  B->>SA: Server Action invocation
  SA->>DB: requireAuthContext() → getUser()
  DB-->>SA: user + accountId
  SA->>OAI: Generate content (optional)
  OAI-->>SA: AI-generated copy
  SA->>DB: Insert/Update rows
  SA->>SA: revalidatePath()
  SA-->>B: Return result
```

## Content Creation & Publishing Pipeline

```mermaid
graph TD
  A[User fills Create Wizard] -->|Submit| B[Server Action: createContent]
  B --> C[Fetch OwnerSettings\nbrand profile, venue name]
  C --> D[Build OpenAI Prompt\nbuildInstantPostPrompt]
  D --> E[Call GPT-4o\napply content rules + postprocess]
  E --> F[Insert content_items row]
  F --> G[Insert content_variants row\nwith generated copy]
  G --> H{Publish mode?}
  H -->|Now| I[enqueuePublishJob\nscheduledFor=now]
  H -->|Schedule| J[enqueuePublishJob\nscheduledFor=future]
  H -->|Draft| K[Status = draft\nno publish job]
  I --> L[publish_jobs row\nstatus=queued]
  J --> L
  L --> M[Cron: /api/cron/publish]
  M --> N[Supabase Edge Function\npublish-queue]
  N --> O{Platform}
  O -->|facebook| P[Meta Graph API\n/me/feed or /{pageId}/feed]
  O -->|instagram| Q[Meta Graph API\nIG container → publish]
  O -->|gbp| R[GBP API\n/localPosts or /reviews]
  P & Q & R --> S[Update content_items status\nposted / failed]
```

## Media Asset Flow

```mermaid
graph LR
  A[User uploads file] --> B[Supabase Storage\nmedia-assets bucket]
  B --> C[Insert media_assets row]
  C --> D{Processing}
  D --> E[Generate derived variants\nstory crop, thumbnails]
  E --> F[Update derived_variants JSONB]
  F --> G[Planner / Create\ncreateSignedUrls for display]
```

## Planner Data Loading

The planner loads three data sets in parallel via `getPlannerOverview()`:
1. `content_items` in a date range — with joined `campaigns` and `content_variants` for media previews
2. `notifications` — unread activity entries for the activity feed
3. Trashed `content_items` — soft-deleted items (`deleted_at IS NOT NULL`)

Media preview URLs are generated in a second pass: asset IDs are extracted from `content_variants.media_ids`, then `createSignedUrls()` is called in one batch. Story-placement content prefers story-cropped derived variants.

## Settings Resolution

Owner settings are loaded via `getOwnerSettings()` which queries three tables in parallel:
- `accounts` → timezone, display_name
- `link_in_bio_profiles` → display_name (used as venue name, takes priority)
- `brand_profile` → tone sliders, key phrases, banned topics/phrases, hashtags, emojis, signatures
- `posting_defaults` → GBP CTA types, notification preferences, location IDs
