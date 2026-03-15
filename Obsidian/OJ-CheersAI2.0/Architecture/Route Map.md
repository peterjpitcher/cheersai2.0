---
title: Route Map
created: 2026-03-14
last_updated: 2026-03-14
status: current
tags:
  - type/reference
  - section/architecture
related:
  - "[[Auth & Security]]"
  - "[[_Features MOC]]"
---

← [[_Index]] / [[_Architecture MOC]]

# Route Map

All pages and API routes in CheersAI 2.0.

```mermaid
graph LR
  subgraph Public ["Public (no auth)"]
    Login[/login]
    ForgotPw[/auth/forgot-password]
    Signup[/auth/signup]
    Privacy[/privacy]
    Terms[/terms]
    LinkInBio["/l/[slug]"]
  end

  subgraph Authenticated ["Authenticated (app group)"]
    Planner[/planner]
    PlannerDetail["/planner/[contentId]"]
    PlannerNotif[/planner/notifications]
    Create[/create]
    Library[/library]
    Campaigns[/campaigns]
    CampaignNew[/campaigns/new]
    CampaignDetail["/campaigns/[id]"]
    Connections[/connections]
    Reviews[/reviews]
    Settings[/settings]
    Help["/help/[[...slug]]"]
  end

  Login -->|success| Planner
  Planner --> PlannerDetail
  Planner --> PlannerNotif
  Planner --> Create
  Create --> Campaigns
  Campaigns --> CampaignNew
  Campaigns --> CampaignDetail
  Planner --> Library
  Planner --> Connections
  Planner --> Reviews
  Planner --> Settings
```

## Page Inventory

### Public Routes

| Route | File | Notes |
|-------|------|-------|
| `/login` | `src/app/(auth)/login/page.tsx` | Supabase email+password login |
| `/auth/forgot-password` | `src/app/auth/forgot-password/page.tsx` | Password reset request |
| `/auth/signup` | `src/app/auth/signup/page.tsx` | Signup (may be restricted) |
| `/privacy` | `src/app/(public)/privacy/page.tsx` | Privacy policy |
| `/terms` | `src/app/terms/page.tsx` | Terms of service |
| `/l/[slug]` | `src/app/(public)/l/[slug]/page.tsx` | Public link-in-bio page |

### Authenticated Routes (App Group)

| Route | File | Feature |
|-------|------|---------|
| `/planner` | `src/app/(app)/planner/page.tsx` | Calendar content planner |
| `/planner/[contentId]` | `src/app/(app)/planner/[contentId]/page.tsx` | Content detail / edit |
| `/planner/notifications` | `src/app/(app)/planner/notifications/page.tsx` | Activity log |
| `/create` | `src/app/(app)/create/page.tsx` | Content creation wizard |
| `/library` | `src/app/(app)/library/page.tsx` | Media asset library |
| `/campaigns` | `src/app/(app)/campaigns/page.tsx` | Campaign list |
| `/campaigns/new` | `src/app/(app)/campaigns/new/page.tsx` | New campaign wizard |
| `/campaigns/[id]` | `src/app/(app)/campaigns/[id]/page.tsx` | Campaign detail |
| `/connections` | `src/app/(app)/connections/page.tsx` | Social platform connections |
| `/reviews` | `src/app/(app)/reviews/page.tsx` | Google Business Profile reviews |
| `/settings` | `src/app/(app)/settings/page.tsx` | Brand voice + posting defaults |
| `/help/[[...slug]]` | `src/app/help/[[...slug]]/page.tsx` | Help documentation |

### API Routes

| Route | Method | Purpose | Auth |
|-------|--------|---------|------|
| `/api/auth/login` | POST | Login handler | None |
| `/api/auth/magic-link` | POST | Magic link auth | None |
| `/api/cron/publish` | GET/POST | Trigger publish-queue Edge Function | `CRON_SECRET` |
| `/api/cron/purge-trash` | GET/POST | Remove soft-deleted content | `CRON_SECRET` |
| `/api/cron/sync-gbp-reviews` | GET/POST | Sync GBP reviews from Google | `CRON_SECRET` |
| `/api/cron/sync-meta-campaigns` | GET/POST | Sync Meta ad campaigns | `CRON_SECRET` |
| `/api/oauth/[provider]/callback` | GET | OAuth callback (fb, instagram, gbp) | None (state-validated) |
| `/api/oauth/facebook-ads/callback` | GET | Facebook Ads OAuth callback | None (state-validated) |
| `/api/planner/activity` | GET | Planner activity feed | Session |

## Navigation Config

The main app navigation is defined in `src/config/navigation.ts`:

| Label | Route | Accent Colour |
|-------|-------|--------------|
| Planner | `/planner` | teal |
| Create | `/create` | sandstone |
| Library | `/library` | oat |
| Connections | `/connections` | caramel |
| Settings | `/settings` | ambergold |

> [!NOTE]
> Reviews and Campaigns are not in the primary nav — they are accessed contextually or via secondary links.
