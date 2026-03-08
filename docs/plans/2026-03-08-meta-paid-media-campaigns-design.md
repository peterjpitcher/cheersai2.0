# Meta Paid Media Campaigns — Design Document

**Date:** 2026-03-08
**Status:** Approved
**Complexity:** XL (new section, new integrations, schema changes)

---

## Overview

A new **Campaigns** section in the CheersAI dashboard that allows a venue owner to design, generate, and publish Meta (Facebook/Instagram) paid media campaigns directly from the app. AI handles everything except creatives — the user describes a business problem, AI generates a full campaign structure (campaign → ad sets → ads), the user reviews and supplies creatives from the media library, then publishes live to Meta Ads Manager via the Marketing API.

### Goals

- Reduce the complexity of creating structured Meta campaigns
- Let the venue owner think in terms of business problems, not ad platform mechanics
- Eliminate the need to open Meta Ads Manager for campaign creation
- Keep AI-generated copy and targeting editable before publish

### Out of Scope (v1)

- Multi-venue / agency use cases
- Custom Audiences and Lookalike Audiences (core audiences only in v1)
- A/B testing (Meta's built-in experimentation)
- Automated rules or budget optimisation post-publish
- Billing management (Meta handles this on their end)

---

## Architecture

### Stack Additions

| Layer | Addition |
|-------|----------|
| Frontend | `/dashboard/campaigns` route, `src/features/campaigns/` |
| Backend | `src/lib/meta/` — Marketing API wrapper |
| Database | 4 new Supabase tables (see Data Model) |
| AI | Extended OpenAI prompts, structured JSON output |
| Auth | Extended Facebook OAuth with `ads_management`, `ads_read`, `business_management` scopes |
| Cron | Daily status/spend sync job |

### Meta Integration Flow

```
User (OAuth) → Facebook Graph API (ads_management scope)
                → Meta Ad Account (act_XXXXXXX)
                    → Campaign
                        → Ad Sets (parallel)
                            → Ad Creatives (image upload)
                                → Ads
```

---

## Data Model

### `meta_ad_accounts`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `venue_id` | uuid FK | |
| `meta_account_id` | text | e.g. `act_123456789` |
| `currency` | text | From Meta API |
| `timezone` | text | From Meta API |
| `access_token` | text | Extended OAuth token (encrypted) |
| `token_expires_at` | timestamptz | |
| `setup_complete` | boolean | |
| `created_at` | timestamptz | |

### `campaigns`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `venue_id` | uuid FK | |
| `meta_campaign_id` | text | Null until published |
| `name` | text | AI-generated, editable |
| `objective` | text | AWARENESS, TRAFFIC, ENGAGEMENT, LEADS, CONVERSIONS |
| `problem_brief` | text | User's original brief |
| `ai_rationale` | text | AI explanation of approach |
| `budget_type` | text | DAILY or LIFETIME |
| `budget_amount` | numeric | In account currency |
| `start_date` | date | |
| `end_date` | date | Nullable for ongoing |
| `status` | text | DRAFT, ACTIVE, PAUSED, ARCHIVED |
| `meta_status` | text | Synced from Meta API |
| `special_ad_category` | text | NONE, HOUSING, EMPLOYMENT, CREDIT, ISSUES |
| `last_synced_at` | timestamptz | |
| `created_at` | timestamptz | |

### `ad_sets`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `campaign_id` | uuid FK | |
| `meta_adset_id` | text | Null until published |
| `name` | text | AI-generated, editable |
| `targeting` | jsonb | Age, gender, locations, interests, behaviours |
| `placements` | jsonb | Auto or manual placement spec |
| `budget_amount` | numeric | ABO only; null if CBO |
| `optimisation_goal` | text | REACH, LINK_CLICKS, LEAD_GENERATION, etc. |
| `bid_strategy` | text | LOWEST_COST_WITHOUT_CAP, etc. |
| `status` | text | DRAFT, ACTIVE, PAUSED |
| `created_at` | timestamptz | |

### `ads`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `adset_id` | uuid FK | |
| `meta_ad_id` | text | Null until published |
| `meta_creative_id` | text | Null until creative uploaded |
| `name` | text | AI-generated, editable |
| `headline` | text | ≤40 chars |
| `primary_text` | text | ≤125 chars |
| `description` | text | ≤25 chars |
| `cta` | text | LEARN_MORE, SIGN_UP, GET_QUOTE, BOOK_TRAVEL, etc. |
| `media_asset_id` | uuid FK | From existing media library |
| `creative_brief` | text | AI description of ideal creative |
| `preview_url` | text | Meta-generated preview URL |
| `status` | text | DRAFT, ACTIVE, PAUSED |
| `created_at` | timestamptz | |

---

## One-Time Setup Flow

Before any campaign can be created, the venue owner completes setup in the **Connections** section:

1. **Connect Meta Ad Account** — Re-authorises Facebook OAuth with additional scopes: `ads_management`, `ads_read`, `business_management`
2. **Select Ad Account** — App fetches accessible ad accounts via API, user selects the correct one
3. **Billing verification** — App checks billing is active on the account (read-only check, we don't manage billing)
4. **Setup complete** — Campaigns section unlocked in nav

Token stored encrypted in `meta_ad_accounts`. App detects 401s on all Marketing API calls and prompts re-auth automatically.

---

## UI/UX Flow

### Campaigns List (`/dashboard/campaigns`)

- Table/card view of all campaigns
- Columns: name, objective, status, budget, date range, Meta-synced spend
- Actions per row: View, Pause/Resume, Duplicate, Archive
- "New Campaign" CTA prominent at top right
- Empty state with explanation if setup not yet complete

### New Campaign — Brief Screen

Minimal form:
- **Problem brief** — textarea: "Describe the problem you're trying to solve"
- **Budget** — amount + daily/lifetime toggle
- **Dates** — start date, optional end date
- **Budget optimisation** — CBO (campaign-level) or ABO (ad set-level) toggle
- "Generate Campaign" button

### AI Generation Screen

Full-screen loading state with streaming progress:
- "Identifying campaign objective…"
- "Building audience strategy…"
- "Writing ad copy…"
- Shows AI rationale as it streams

### Review & Edit Tree

Three-panel layout:
- **Left** — Collapsible tree: Campaign → Ad Sets (2–3) → Ads (2 per set)
- **Centre** — Detail editor for selected node (all AI-generated fields editable inline)
- **Right** — Live ad preview rendered as Facebook/Instagram feed card, updates in real-time as copy is edited

Each ad node shows a **"Pick Creative"** button that opens the existing media library selector.

### Publish Confirmation

- Summary of what will be pushed (campaign name, ad set count, ad count)
- Total budget and date range confirmation
- Special ad category warning if detected
- Minimum budget validation (Meta enforces ~£1/day minimum per ad set)
- "Publish Now" or "Schedule" (set future start date) options

### Campaign Detail (post-publish)

- Meta-synced status badge (Active, Paused, In Review, Rejected)
- Spend, reach, impressions per ad set (synced daily)
- Actions: Pause/Resume, Duplicate, Edit copy (limited — Meta restricts editing live campaigns)
- Rejection reason surfaced if Meta rejects any creative or copy

---

## AI Generation Detail

### Prompt Inputs

- Problem brief (user text)
- Venue name, location, tone of voice (from existing venue settings)
- Budget amount and type
- Date range
- Available Meta objectives

### Prompt Outputs (structured JSON)

```json
{
  "objective": "LEAD_GENERATION",
  "rationale": "...",
  "campaign_name": "...",
  "special_ad_category": "NONE",
  "ad_sets": [
    {
      "name": "...",
      "audience_description": "...",
      "targeting": {
        "age_min": 25,
        "age_max": 55,
        "genders": [1, 2],
        "geo_locations": { "cities": [...] },
        "interests": [{ "id": "...", "name": "..." }]
      },
      "placements": "AUTO",
      "optimisation_goal": "LEAD_GENERATION",
      "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
      "ads": [
        {
          "name": "...",
          "headline": "...",
          "primary_text": "...",
          "description": "...",
          "cta": "SIGN_UP",
          "creative_brief": "..."
        }
      ]
    }
  ]
}
```

### Guardrails

- Meta character limits enforced in prompt (headline ≤40, primary text ≤125, description ≤25)
- Second validation pass checks copy against Meta's prohibited content categories
- Special ad category auto-detection (housing, employment, credit, social issues)
- Interest IDs resolved via Meta's Targeting Search API before display (names shown to user, IDs sent to Meta)

---

## Meta Marketing API Integration

### Publishing Sequence

Sequential with rollback on failure:

1. `POST /act_{id}/campaigns` → store `meta_campaign_id`
2. `POST /act_{id}/adsets` (parallel per ad set) → store `meta_adset_id`
3. `POST /act_{id}/adimages` or `/advideos` (upload from library) → store `meta_creative_id`
4. `POST /act_{id}/adcreatives` → assemble creative object
5. `POST /act_{id}/ads` → store `meta_ad_id`

**On failure at any step:** pause all previously created objects, surface error with specific Meta error code, offer "Retry" for the failed step only.

### Status & Spend Sync

Daily cron job (`/api/cron/sync-meta-campaigns`):
- Fetches campaign/ad set/ad status from Meta Insights API
- Pulls spend, impressions, reach for the last 30 days
- Updates `meta_status`, `last_synced_at` in Supabase
- Flags any campaigns with `DISAPPROVED` status for user attention

### Token Management

- Access tokens stored encrypted at rest
- App checks `token_expires_at` before every API call
- If within 7 days of expiry or already expired: surface re-auth prompt before allowing any campaign action
- Long-lived tokens (60 days) requested during OAuth; refreshed automatically where possible

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Partial publish failure | Pause created objects, surface "Resume publishing" option |
| Token expiry | Detect 401, prompt re-auth before publish attempt |
| Meta policy rejection | Surface rejection reason + suggested fix |
| Budget below minimum | Validate before submission, show minimum required |
| Ad Account spend cap reached | Warn before publish if budget exceeds remaining cap |
| Interest ID not found | Fall back to broader targeting, flag to user for review |

---

## Testing Strategy

- **Unit** — AI prompt construction, JSON output parsing, Meta API payload builders, character limit validators
- **Integration** — Meta test ad account environment; full publish flow tested without real spend
- **UI** — Campaign builder form validation, ad preview rendering, tree navigation, empty states
- Minimum 80% coverage on `src/lib/meta/` and server actions

---

## Implementation Phases

Given XL complexity, broken into 3 PRs:

| Phase | Scope |
|-------|-------|
| 1 | Database schema, Meta OAuth scope extension, Ad Account setup flow |
| 2 | AI generation, campaign builder UI, review & edit tree |
| 3 | Meta API publishing, status sync cron, campaign detail view |

Each phase independently deployable. Phase 1 must land before Phase 2; Phase 2 before Phase 3.
