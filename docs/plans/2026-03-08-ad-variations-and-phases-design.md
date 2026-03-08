# Ad Variations and Time-Phased Ad Sets Design

**Date:** 2026-03-08

## Goal

Replace the current single-copy-per-ad structure with AI-generated time phases (as ad sets) and 5 copy variations per phase (as ads), giving Meta the data it needs to report on which messaging works best at each stage of a campaign.

## Approach

Approach A: Phases as Ad Sets. The AI decides how many phases make sense given the campaign dates (typically 2–4, leaning more where dates allow), assigns each a date window and copy theme, then generates 5 copy variations per phase. Each variation is a separate ad in Meta with its own creative (headline, primary text, description, CTA). Meta activates/pauses ad sets automatically by schedule.

## AI Generation Changes

- The system prompt is updated to instruct the AI to build time-phased ad sets rather than audience-segmented ones
- The AI is given the campaign start date, end date, and problem brief to decide phase count and windows
- The AI is given the explicit list of valid CTA values to choose from: `LEARN_MORE`, `SIGN_UP`, `BOOK_NOW`, `GET_QUOTE`, `CONTACT_US`, `SUBSCRIBE`
- Each ad set includes `phase_label`, `phase_start` (ISO date), and `phase_end` (ISO date, nullable for last phase)
- Each ad set always has exactly 5 ads — one per variation
- CTA can vary across the 5 variations (extra learning dimension)
- Defensive enforcement: pad to 5 if fewer returned; trim to 5 if more

## Data Model

### `AiCampaignPayload` type changes (`src/types/campaigns.ts`)

Add to each ad set:
```
phase_label: string        // e.g. "Early Awareness"
phase_start: string        // ISO date
phase_end: string | null   // ISO date or null for last phase
```

### Database migration

Add to `ad_sets` table:
```sql
phase_start  date,
phase_end    date
```

Both nullable (non-event campaigns may not use phases).

## Publishing

- `createMetaAdSet` already accepts `start_time`/`end_time` — pass `phase_start`/`phase_end` as Unix timestamps
- `publishCampaign` already loops ads per ad set — loops over 5 ads naturally
- No structural changes to publishing logic

## UI (CampaignTree)

- Ad set node in tree panel shows phase label and date range (e.g. "Early Awareness · 1–14 Mar")
- Ad set editor panel shows phase dates and audience/phase description
- Ads within an ad set are shown as 5 numbered variation tabs (Variation 1–5)
- Clicking a tab shows that variation's editable fields: headline, primary text, description, CTA, creative brief (with character counters)
- "Pick creative from library" button is per-variation
- Preview panel updates live to show the selected variation

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| AI returns fewer than 5 ads | Pad to 5 by duplicating last entry |
| AI returns more than 5 ads | Trim to 5 |
| Phase dates outside campaign dates | Publishing action clamps to campaign window |
| Single-day campaign | AI generates 1 phase, 5 variations |
| No end date | Last phase has null `phase_end`; Meta ad set runs open-ended |

## Files Changed

| File | Change |
|------|--------|
| `src/lib/campaigns/generate.ts` | Update prompt + schema for phases and 5 variations |
| `src/types/campaigns.ts` | Add `phase_label`, `phase_start`, `phase_end` to ad set type |
| `supabase/migrations/20260308160000_add_phase_dates_to_ad_sets.sql` | Add `phase_start`, `phase_end` columns |
| `src/app/(app)/campaigns/actions.ts` | Pass phase dates when inserting ad sets |
| `src/app/(app)/campaigns/[id]/actions.ts` | Pass `phase_start`/`phase_end` as `start_time`/`end_time` to Meta |
| `src/features/campaigns/CampaignTree.tsx` | Variation tabs UI, phase label on ad set nodes |

## Out of Scope

- Audience-based ad set segmentation (replaced by phase-based)
- Dynamic Creative Optimisation (Meta-native mixing)
- Manual phase creation/editing (AI decides all phases)
- Budget split across phases (campaign-level budget applies)
