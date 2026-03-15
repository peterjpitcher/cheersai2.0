---
title: Architecture Overview
created: 2026-03-14
last_updated: 2026-03-14
status: current
tags:
  - type/reference
  - section/architecture
related:
  - "[[Data Flow]]"
  - "[[Route Map]]"
  - "[[Auth & Security]]"
---

← [[_Index]] / [[_Architecture MOC]]

# Architecture Overview

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16.1 (App Router) |
| UI | React 19.2, Tailwind CSS |
| Language | TypeScript (strict mode) |
| Database | Supabase PostgreSQL + RLS |
| Auth | Supabase Auth (JWT + HTTP-only cookies, `@supabase/ssr`) |
| File storage | Supabase Storage (`media-assets` bucket) |
| AI | OpenAI API (GPT-4o) |
| Email | Not yet configured (env var `RESEND_API_KEY` present) |
| Deployment | Vercel |
| Date/time | Luxon (all display), timezone fixed to `Europe/London` |
| Validation | Zod (all forms and server action inputs) |
| Animations | Framer Motion |

## Application Purpose

CheersAI 2.0 is a social media content management platform for single-owner British pub operators. It generates AI-written captions via OpenAI, schedules posts across Facebook, Instagram, and Google Business Profile, and provides a calendar-style planner for managing content.

## Directory Structure

```
src/
├── app/                   # Next.js App Router
│   ├── (app)/             # Authenticated route group
│   │   ├── campaigns/     # Campaign list and detail
│   │   ├── connections/   # Social connection management
│   │   ├── create/        # Content creation wizard
│   │   ├── library/       # Media asset library
│   │   ├── planner/       # Content calendar
│   │   ├── reviews/       # Google reviews management
│   │   └── settings/      # Brand and posting settings
│   ├── (auth)/            # Auth route group (login page)
│   ├── (public)/          # Public routes (link-in-bio, privacy, terms)
│   ├── api/               # Route handlers (crons, OAuth callbacks)
│   └── auth/              # Auth flow pages (forgot-password, signup)
├── config/                # Navigation config
├── features/              # Feature-scoped UI components
│   ├── create/            # Content creation wizard components
│   ├── library/           # Media library components
│   ├── link-in-bio/       # Public link-in-bio page
│   ├── planner/           # Calendar and planner components
│   ├── reviews/           # Reviews display components
│   └── settings/          # Settings form components
├── hooks/                 # Shared React hooks
├── lib/                   # Core business logic
│   ├── ai/                # OpenAI prompts and content post-processing
│   ├── auth/              # Auth helpers (requireAuthContext, etc.)
│   ├── campaigns/         # Campaign generation
│   ├── connections/       # Social connection data and OAuth
│   ├── create/            # Content creation service and schemas
│   ├── gbp/               # Google Business Profile API client
│   ├── library/           # Media asset queries and signed URLs
│   ├── link-in-bio/       # Link-in-bio profile and public page
│   ├── management-app/    # Management app client/data (The Anchor integration)
│   ├── meta/              # Facebook/Instagram Graph API
│   ├── planner/           # Planner data queries
│   ├── publishing/        # Publish queue and content status
│   ├── scheduling/        # Conflict detection, event materialisation
│   ├── settings/          # Owner settings and brand profile
│   └── supabase/          # Supabase client factories
├── types/                 # TypeScript type definitions
└── env.ts                 # Zod-validated environment config
```

## Environment Variables

| Variable | Purpose | Access |
|----------|---------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | Public |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (bypasses RLS) | Server only |
| `NEXT_PUBLIC_SITE_URL` | App base URL | Public |
| `OPENAI_API_KEY` | OpenAI content generation | Server only |
| `NEXT_PUBLIC_FACEBOOK_APP_ID` | Facebook OAuth app ID | Public |
| `FACEBOOK_APP_SECRET` | Facebook OAuth secret | Server only |
| `NEXT_PUBLIC_INSTAGRAM_APP_ID` | Instagram OAuth app ID | Public (same as Facebook App ID) |
| `INSTAGRAM_APP_SECRET` | Instagram OAuth secret | Server only |
| `GOOGLE_MY_BUSINESS_CLIENT_ID` | GBP OAuth client ID | Server only |
| `GOOGLE_MY_BUSINESS_CLIENT_SECRET` | GBP OAuth secret | Server only |
| `CRON_SECRET` | Auth secret for cron endpoints | Server only |
| `ALERTS_SECRET` | Internal alerts webhook secret | Server only |
| `RESEND_API_KEY` | Email (configured but not heavily used) | Server only |
| `ENABLE_CONNECTION_DIAGNOSTICS` | Debug logging for integrations | Server only |

> [!NOTE]
> All environment variables are validated at startup via Zod in `src/env.ts`. Missing required vars cause a build/start failure, not a silent runtime error.

## Key Architectural Decisions

### Account Identity
Supabase Auth user IDs are mapped to `accounts` table records. The `account_id` is resolved from `user.app_metadata.account_id` (server-managed) or falls back to `user.id`. This is set by the management app integration for multi-venue scenarios.

### Schema-Missing Resilience
All data functions check for `isSchemaMissingError()` and return graceful fallbacks. This allows the app to run in development before migrations are applied.

### Content → Variant → Job Pipeline
Content is stored as `content_items` with associated `content_variants` (the actual copy). Publishing inserts `publish_jobs` records which are processed by the Supabase Edge Function `publish-queue`, invoked by the `/api/cron/publish` cron endpoint.

### Management App Integration
`src/lib/management-app/` integrates with a separate management application (The Anchor's management system) to pre-populate venue information for AI content generation.
