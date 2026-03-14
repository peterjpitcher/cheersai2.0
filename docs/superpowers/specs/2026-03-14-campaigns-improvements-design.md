# Campaigns Feature Improvements — Design Spec
**Date:** 2026-03-14
**Status:** Approved
**Scope:** CheersAI 2.0 — `/campaigns` feature

---

## Overview

Four improvements to the campaigns generation and review flow:
1. Reduce variations from 5 → 3 per ad set, each with a distinct named angle
2. Increase primary text from 125 → 350 chars with conversion-optimised prompt
3. Fixed 3-phase ad set structure based on event date
4. Ad set-level image assignment with per-variation override

---

## 1. Data Model Changes

### 1.1 `ads` table
```sql
ALTER TABLE ads ADD COLUMN angle TEXT;
```
- Free-text label assigned by the AI (e.g. `"Jackpot mechanic"`, `"Social & group night"`, `"Value for money"`)
- Stored and displayed in UI; used for future performance analysis

### 1.2 `ad_sets` table
```sql
ALTER TABLE ad_sets ADD COLUMN adset_media_asset_id UUID REFERENCES media_assets(id);
ALTER TABLE ad_sets ADD COLUMN adset_image_url TEXT;
ALTER TABLE ad_sets ADD COLUMN ads_stop_time TIME;
```
- `adset_media_asset_id` — FK to `media_assets`; the canonical reference for the shared image
- `adset_image_url` — **denormalised cache** of the asset's URL, always written together with `adset_media_asset_id`; never set independently. When a media asset is selected via the picker, both columns are written atomically. `adset_image_url` is never set without a corresponding `adset_media_asset_id`.
- `ads_stop_time` — used on the Day Of ad set to stop ads at event start time

### 1.3 TypeScript types (`src/types/campaigns.ts`)
- Add `angle: string` to ad variation interface
- Add `adsetMediaAssetId?: string`, `adsetImageUrl?: string`, `adsStopTime?: string` to ad set interface
- Update `AiCampaignPayload` ad interface to include `angle`

### 1.4 Variation count
- `enforceAdSetConstraints()` updated to enforce exactly 3 variations (was 5)

---

## 2. AI Prompt Changes (`src/lib/campaigns/generate.ts`)

### 2.1 Fixed phase structure
Phase date calculation moves **out of the AI prompt** and into the server action. The AI receives pre-calculated phase windows:

| Phase | Date Range | Label |
|---|---|---|
| Run-up | `campaign_start` → `event_date − 2 days` | `"Run-up"` |
| Day Before | `event_date − 1 day` | `"Day Before"` |
| Day Of | `event_date` (until `ads_stop_time`) | `"Day Of"` |

Calculation logic in `actions.ts` before the OpenAI call. AI no longer decides phase boundaries.

**Degenerate campaign handling** — when the campaign window is too short for all 3 phases, produce only the valid phases:

| Days between start and event | Phases generated |
|---|---|
| ≥ 3 days | Run-up + Day Before + Day Of (full set) |
| 2 days | Day Before + Day Of (no Run-up) |
| 1 day | Day Before + Day Of (start date = event − 1) |
| 0 days (same-day) | Day Of only |

A 1-day Run-up (where `campaign_start = event_date − 2`) is valid. There is no minimum Run-up duration beyond 1 day.

### 2.2 Variation count
Prompt updated: generate exactly **3 variations** per ad set (was 5).

### 2.3 Primary text length
- Increased from 125 → **350 characters**
- Instruction: write 2–3 sentences using specific named details from the brief

### 2.4 USP extraction instruction
System prompt instructs the AI to:
1. Identify the 3–5 strongest USPs from the brief before writing any copy
2. Ground each variation's copy in those USPs — specific numbers, prices, mechanics, atmosphere

### 2.5 Angle assignment
Each variation is explicitly assigned a distinct angle before copy is written. No two variations within an ad set may share the same angle. Suggested angles (AI picks what fits):
- `"Jackpot & prize mechanic"`
- `"Social & group night"`
- `"Value for money"`
- `"Urgency & FOMO"`
- `"Food & atmosphere"`
- `"Accessibility & ease"`

Angle returned as `angle` field in JSON output.

### 2.6 Phase-aware copy
AI is briefed on which phase each ad set is for:
- **Run-up** → strongest hooks, awareness, excitement
- **Day Before** → urgency, last chance, jackpot growing
- **Day Of** → immediacy, get there tonight, doors open soon

### 2.7 Conversion-optimised copy structure
Each variation follows a 3-part formula:

**Line 1 — Hook:** Bold statement, provocative question, or single most compelling specific detail. Must be concrete (number, mechanic, real prize). No generic openers.

**Lines 2–3 — USP detail:** Specific details from the brief. Prices, mechanics, atmosphere, social context.

**Final sentence — Soft CTA:** Conversational nudge specific to the event. Not a duplicate of the button.

**Banned phrases:** "don't miss out", "join the fun", "exciting", "amazing", "don't miss", "hurry" — AI must earn engagement through specifics, not adjectives.

### 2.8 JSON schema update
Add `angle: string` to each ad object in the AI output schema.

---

## 3. Campaign Brief Form (`src/features/campaigns/CampaignBriefForm.tsx`)

### 3.1 Stop time field
New `ads_stop_time` time input field alongside the end date picker.
- Label: "Stop ads at (event start time)"
- **Always required** — since end date is always required for campaigns, this field is unconditionally required
- No valid "no stop time" case; the Day Of ad set must always have a defined end time
- Existing campaigns in DB with `ads_stop_time IS NULL` (pre-migration): treated as no stop time on the Day Of ad set — they run until midnight. No backfill required.
- Stored as `HH:MM` string, converted to `TIME` on save
- Passed to server action alongside existing brief fields

---

## 4. Campaign Tree UI (`src/features/campaigns/CampaignTree.tsx`)

### 4.1 Angle label in tree panel
Each variation node in the left panel shows:
```
Variation 1
Jackpot mechanic        ← muted/italic, beneath name
```

### 4.2 Character count on primary text
Live counter beneath primary text textarea:
- Format: `247 / 350`
- Colour: muted grey → amber at 300+ → red if over 350

### 4.3 Ad set-level image picker
When an ad set node is selected, centre panel includes:
- Image picker labelled "Ad Set Image — applies to all variations"
- Selecting an image sets `adsetMediaAssetId` + `adsetImageUrl` on the ad set
- All 3 variations inherit this image unless individually overridden
- Variations with their own image show a "custom" badge in the tree

### 4.4 "Apply to all" button on individual variations
When an image is selected on a single variation:
- Button appears: "Apply to all variations in this ad set"
- Clicking does the following atomically:
  1. Sets `adsetMediaAssetId` + `adsetImageUrl` on the parent ad set to the source variation's image
  2. **Nulls out `media_asset_id` and `image_url` on all sibling variations** (including the source variation) so the cascade from the ad set level takes effect
- Result: all 3 variations display the shared image via the ad set-level cascade, with no individual overrides remaining

### 4.5 Image resolution logic (display/publish)
Priority order for an ad's effective image:
1. Variation's own `media_asset_id` (override)
2. Parent ad set's `adset_media_asset_id` (shared default)
3. None

### 4.6 Creative brief visible in UI
- Collapsible section on each variation panel
- Label: "AI creative intent" (muted italic, read-only)
- Shows existing `creative_brief` field from AI output
- Collapsed by default

---

## 5. Server Action Changes (`src/app/(app)/campaigns/actions.ts`)

### 5.1 Phase calculation
Before calling `generateCampaign()`, calculate the 3 phase windows from `start_date`, `end_date`, and `ads_stop_time`. Pass pre-calculated phases into the generation function.

### 5.2 Save logic
- Persist `angle` field when saving ads
- Persist `adset_media_asset_id`, `adset_image_url`, `ads_stop_time` when saving ad sets

---

## 6. Files to Modify

| File | Change |
|---|---|
| `supabase/migrations/` | New migration: add `angle` to `ads`, add 3 cols to `ad_sets` |
| `src/types/campaigns.ts` | Add `angle`, `adsetMediaAssetId`, `adsetImageUrl`, `adsStopTime` |
| `src/lib/campaigns/generate.ts` | Rewrite prompt, update JSON schema, change variation count to 3 |
| `src/app/(app)/campaigns/actions.ts` | Phase calculation pre-AI, persist new fields |
| `src/features/campaigns/CampaignBriefForm.tsx` | Add stop time field |
| `src/features/campaigns/CampaignTree.tsx` | Angle labels, char count, ad set image picker, apply-to-all button, creative brief section |

---

## 7. Out of Scope

- AI image generation (remains library-pick only)
- Publishing to Meta (no changes to publish flow)
- Campaign performance tracking / angle analytics (future work)
- Support for non-event campaigns with different phase structures

---

## 8. Testing

- Unit test: phase calculation logic (various start/end date combinations including same-day, 1-day, 2-day campaigns)
- Unit test: `enforceAdSetConstraints()` enforces exactly 3 variations
- Unit test: AI prompt output parsed correctly with `angle` field
- Manual: verify copy uses specific USPs from brief, not generic phrases
- Manual: ad set image cascades to all variations; individual override takes precedence; apply-to-all clears siblings
