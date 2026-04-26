# Proximity Banners — Design Spec (v2)

## Overview

Dynamic banners overlaid on campaign images based on proximity to the event date. A full-width colour bar is rendered at any edge (top, bottom, left, right) with auto-generated proximity text like "THIS WEDNESDAY", "TOMORROW", "TONIGHT". Users can customise the banner position, colour scheme, and optionally override the text with a custom message (max 20 characters).

Banners are rendered via Canvas at publish time (baked into the image, uploaded to temp storage, signed URL passed to platform providers) and via CSS overlays for in-app previews and the link-in-bio landing page.

**Out of scope (separate spec):** Auto-fetching event images from the management app API. The management app `ManagementEventDetail` type currently has no image field (`src/lib/management-app/client.ts:44`). This requires API contract confirmation and derivative generation infrastructure before it can be specified.

## Scope

- All campaign types: event, promotion, weekly recurring
- Both placements: feed (1080x1350 "square" derivative) and story (1080x1920)
- Planner UI: preview + controls for banner customisation
- Link-in-bio: dynamic CSS banners with client-side time updates
- Publish pipeline: image rendering via FFmpeg in Deno Edge Function, temp storage upload, signed URL handoff
- Campaign-level defaults + per-post overrides

## Data Model

### Campaign-Level Defaults

Stored in `campaigns.metadata` JSONB (existing column):

```typescript
// campaigns.metadata.bannerDefaults
interface BannerDefaults {
  position: BannerPosition;
  colorScheme: BannerColorScheme;
}
```

This ensures the weekly materialiser (`supabase/functions/materialise-weekly/worker.ts`) and any future materialisers can read defaults when creating new content items.

### Per-Post Config

Stored in `content_items.prompt_context` JSONB (existing column). Must be **merged safely** — never overwrite sibling keys (`ctaUrl`, proof points, timing labels, etc.).

```typescript
// content_items.prompt_context.banner
interface BannerConfig {
  schemaVersion: 1;
  enabled: boolean;
  position: BannerPosition;
  colorScheme: BannerColorScheme;
  customMessage?: string; // max 20 graphemes, uppercase, trimmed, no newlines/control chars
}

type BannerPosition = 'top' | 'bottom' | 'left' | 'right';

type BannerColorScheme =
  | 'gold-green' | 'green-gold'
  | 'black-white' | 'black-gold' | 'black-green'
  | 'white-black' | 'white-green' | 'white-gold';
```

**Defaults when auto-populated:** `position: 'top'`, `colorScheme: 'gold-green'`, `enabled: true`.

**Validation rules for `customMessage`:**
- Trimmed of leading/trailing whitespace
- Newlines and control characters rejected
- Forced to uppercase
- Max 20 graphemes (use `Intl.Segmenter` for grapheme-safe length)
- Empty string treated as unset (falls back to auto-generated label)

**Editable statuses:** Banner config may only be changed on content items with status `draft`, `scheduled`, `queued`, or `failed` — matching existing planner edit constraints. Locked for `publishing` and `posted`.

**Zod schema:** Define `BannerConfigSchema` for runtime validation of JSONB reads. Do not trust arbitrary JSONB — parse and validate on read.

### Campaign Timing — Canonical Source

Campaign creation (`src/lib/create/service.ts:1245`) does NOT populate `campaigns.start_at` / `campaigns.end_at`. Event dates are stored in `campaigns.metadata`:

- Event campaigns: `metadata.startDate`, `metadata.startTime`
- Promotion campaigns: `metadata.startDate`, `metadata.endDate`
- Weekly campaigns: `metadata.dayOfWeek`, `metadata.time`

**Decision: use `metadata` as canonical source.** Do not backfill `start_at`/`end_at` — the metadata fields are the source of truth already used by the scheduling system.

Define a helper to extract timing:

```typescript
// src/lib/scheduling/campaign-timing.ts
interface CampaignTiming {
  campaignType: 'event' | 'promotion' | 'weekly';
  startAt: DateTime;           // Luxon, Europe/London
  endAt?: DateTime;            // promotions only
  startTime?: string;          // "HH:MM", for day/night determination
  weeklyDayOfWeek?: number;    // 1=Mon..7=Sun, weekly only
  timezone: string;            // always 'Europe/London'
}

function extractCampaignTiming(campaign: { campaign_type: string; metadata: unknown }): CampaignTiming
```

This is used by planner, publish worker, and link-in-bio.

## Colour Schemes

| ID | Background | Text | WCAG Contrast |
|----|-----------|------|---------------|
| `gold-green` | `#a57626` | `#005131` | 3.2:1 — validate at target font size |
| `green-gold` | `#005131` | `#a57626` | 3.2:1 — validate at target font size |
| `black-white` | `#1a1a1a` | `#ffffff` | 16.5:1 — passes |
| `black-gold` | `#1a1a1a` | `#a57626` | 4.1:1 — passes AA large |
| `black-green` | `#1a1a1a` | `#005131` | 2.4:1 — **low contrast, validate legibility** |
| `white-black` | `#ffffff` | `#1a1a1a` | 16.5:1 — passes |
| `white-green` | `#ffffff` | `#005131` | 5.1:1 — passes |
| `white-gold` | `#ffffff` | `#a57626` | 3.2:1 — validate at target font size |

**Minimum font size for low-contrast schemes:** 18px bold at 1080px render resolution (WCAG AA Large Text). Validate all schemes visually before shipping. Consider dropping `black-green` if illegible.

## Proximity Label Logic

### Function Signature

```typescript
// src/lib/scheduling/proximity-label.ts

type ProximityLabel = string | null;

interface ProximityLabelInput {
  referenceAt: DateTime;       // the "now" for comparison — scheduledFor for publish, current time for link-in-bio
  campaignTiming: CampaignTiming;
}

function getProximityLabel(input: ProximityLabelInput): ProximityLabel
```

**Why `referenceAt` not `scheduledFor`?** The function is used in three contexts:
- **Publish time:** `referenceAt` = content item's `scheduled_for` (what the banner should say when the post goes out)
- **Planner preview:** `referenceAt` = content item's `scheduled_for` (shows what it will say)
- **Link-in-bio:** `referenceAt` = current client time (updates live)

### Event Campaign Rules

All dates compared in Europe/London timezone. `referenceAt` is compared against `campaignTiming.startAt`.

| Condition | Label |
|-----------|-------|
| `referenceAt` is after event start timestamp (not just date) | `null` (no banner) |
| Same calendar day, startTime >= 17:00 | `TONIGHT` |
| Same calendar day, startTime < 17:00 or unset | `TODAY` |
| 1 calendar day before, startTime >= 17:00 | `TOMORROW NIGHT` |
| 1 calendar day before, startTime < 17:00 or unset | `TOMORROW` |
| 2-6 calendar days before (rolling window, NOT ISO week) | `THIS {WEEKDAY}` (weekday of the event) |
| 7+ calendar days before | `null` (no banner) |

**"2-6 days" is a rolling window**, not ISO week bounded. A Friday post for next Monday (3 days away) says "THIS MONDAY". A Saturday post for next Saturday (7 days) says nothing.

**Post-event comparison** uses the full event start timestamp, not just the date. A post at 20:00 for a 19:00 event on the same day returns `null`.

### Promotion Campaign Rules

Promotions have `startAt` and `endAt`. `endAt` uses end-of-day semantics: `endAt` date means `23:59:59` local time.

**Priority: end urgency checked first** (if promotion has started).

| Condition | Label |
|-----------|-------|
| `referenceAt` is after `endAt` EOD | `null` (no banner) |
| `referenceAt` is between `startAt` and `endAt`, and `endAt` is same day | `LAST DAY` |
| `referenceAt` is between `startAt` and `endAt`, and `endAt` is tomorrow | `ENDS TOMORROW` |
| `referenceAt` is between `startAt` and `endAt`, and `endAt` is 2-6 days out | `ENDS {WEEKDAY}` |
| `referenceAt` is between `startAt` and `endAt`, and `endAt` is 7+ days out | `ON NOW` |
| Before `startAt`, same day | `TODAY` |
| Before `startAt`, 1 day before | `TOMORROW` |
| Before `startAt`, 2-6 days before | `THIS {WEEKDAY}` |
| Before `startAt`, 7+ days before | `null` (no banner) |

**`ON NOW` is valid outside the week window** — this is an intentional exception to the "only within a week" rule. Long-running promotions should still show `ON NOW`. Custom messages on promotions similarly remain visible during the promotion's active period.

### Weekly Campaign Rules

`campaignTiming.weeklyDayOfWeek` provides the recurring day. The "next occurrence" is calculated from `referenceAt`:

- If `referenceAt` is before this week's occurrence → use this week's occurrence
- If `referenceAt` is after this week's occurrence → use next week's occurrence

Then apply the same event rules (THIS {WEEKDAY} / TOMORROW / TONIGHT / TODAY) against the calculated next occurrence.

### Publish Retry Semantics

**Decision: use `scheduled_for`, not retry time.** The banner should reflect what the post was meant to say when it was scheduled. A "TONIGHT" post that retries after midnight still says "TONIGHT" — the content was authored for that moment. If `scheduled_for` is now past the event, `getProximityLabel` returns `null` and no banner is applied.

## Canvas Rendering (Publish Time)

### Runtime

Supabase Edge Functions use **Deno**, not Node. `@napi-rs/canvas` is not compatible. The existing `media-derivatives` function already uses **FFmpeg** (`supabase/functions/media-derivatives/index.ts`).

**Approach: use FFmpeg for banner rendering.** FFmpeg can:
- Overlay a coloured rectangle on an image at any edge
- Render text with font specification
- Output JPEG at specified quality

This reuses the existing FFmpeg infrastructure already deployed in the media-derivatives function.

### Function Signature

```typescript
// supabase/functions/publish-queue/banner-renderer.ts

interface BannerRenderInput {
  imageUrl: string;             // signed URL of source image
  placement: 'feed' | 'story';
  position: BannerPosition;
  colorScheme: BannerColorScheme;
  labelText: string;
}

interface BannerRenderOutput {
  tempStoragePath: string;      // path in temp storage bucket
  signedUrl: string;            // signed URL for platform upload (600s TTL)
}

function renderBanner(input: BannerRenderInput): Promise<BannerRenderOutput>
```

### Rendering Details

- Source rendition: use the appropriate `derived_variants` path — `square` for feed, `story` for story placement. Fall back to original `storage_path` if derivative is missing.
- **Feed dimensions:** 1080x1350 (NOT 1080x1080 — the "square" derivative is 4:5 ratio)
- **Story dimensions:** 1080x1920
- **Bar sizing:**
  - Top/bottom (horizontal): height = 48px at 1080px width (~3.5% of height for feed, ~2.5% for story)
  - Left/right (vertical): width = 48px
- **Text rendering:**
  - Font: system sans-serif bold (or bundle a specific .ttf in the function)
  - Font size: 24px bold for horizontal bars, 20px bold for vertical bars
  - Letter-spacing: 2px
  - Horizontal bars: text centred horizontally and vertically
  - Vertical bars (left): text rotated 90° counter-clockwise, reading bottom-to-top
  - Vertical bars (right): text rotated 90° clockwise, reading top-to-bottom
- **Output:** JPEG quality 92
- **Font availability:** Bundle a bold sans-serif font file (e.g., Inter Bold or similar open-source) with the Edge Function. FFmpeg's `drawtext` filter requires a font path.

### Temp Storage & Signed URLs

1. Render the bannered image to a buffer
2. Upload to Supabase storage under a temp path: `banners/{content_item_id}/{variant_id}.jpg`
3. Create a signed URL (600s TTL) matching existing provider patterns
4. Pass the signed URL to the platform provider instead of the original image URL
5. **Cleanup:** After successful publish, delete the temp file. On failure, leave it for retry (TTL will expire naturally). Add a cleanup cron or use storage lifecycle rules for abandoned temp files.

### Publish Pipeline Integration

In `worker.ts`, after resolving media and before calling the platform provider:

1. Load `content_item.prompt_context.banner` — parse with `BannerConfigSchema`
2. If banner is not enabled or parse fails, skip (use original image)
3. Load campaign data: extend the existing query from `campaigns(name)` to `campaigns(name, campaign_type, metadata)`
4. Call `extractCampaignTiming(campaign)` to get `CampaignTiming`
5. Call `getProximityLabel({ referenceAt: scheduled_for, campaignTiming })`
6. If label is `null` and no `customMessage`, skip banner
7. If label exists (or `customMessage` is set), call `renderBanner()`
8. Replace the media signed URL with the bannered image signed URL
9. Continue with existing provider upload flow

**Failure fallback:** If `renderBanner()` throws, **publish with the original image** (do not block the post). Log a notification to the `notifications` table so the user knows the banner wasn't applied.

**Multi-image posts:** Apply banner to the **first image only**. GBP may receive multiple images but the banner is only on the primary.

**Video posts:** Skip banner silently. `banner.enabled` stays true so it applies if the user swaps to an image.

**No media attached:** Skip silently.

### Shared Code Between Next.js and Deno

`getProximityLabel()` and `extractCampaignTiming()` live in `src/lib/scheduling/`. These cannot be directly imported by Deno Edge Functions (which use relative imports, not Next.js `@/` aliases).

**Solution:** Duplicate the proximity label logic in the Edge Function as a self-contained module (`supabase/functions/publish-queue/proximity.ts`). Keep the canonical version in `src/lib/scheduling/` for the Next.js app. Both are covered by the same test suite. Add a comment in both files referencing each other.

## Planner UI

### Preview (CSS Overlay)

In `src/features/planner/planner-content-composer.tsx` (the main post preview component, NOT `content-media-editor.tsx` which is a media selector):

- Render a CSS bar overlay on the image matching configured position/colour/label
- Bar uses `position: absolute` with the same edge anchoring as the final render
- Text styled to approximate the Canvas output
- Updates live when post is rescheduled (label recalculates client-side)
- Small badge/icon indicating "banner active" on calendar cards

Also add overlay to:
- Calendar day cards in the planner grid (smaller, simplified)
- Generated content review cards where post thumbnails appear

### Controls (New Component)

`src/features/planner/banner-controls.tsx` — rendered below the media section in the planner detail panel:

- **Toggle:** Banner on/off (default: on). Disabled for `publishing`/`posted` statuses.
- **Position picker:** 4 icon buttons (top/bottom/left/right), visually showing bar placement
- **Colour scheme dropdown:** 8 options rendered as colour swatch pairs (bg + text preview)
- **Custom message field:** Optional text input. Placeholder shows auto-generated label. Visible character counter (X/20). Validation: trimmed, no newlines, uppercase enforced, grapheme-safe length.
- All changes save via `updatePlannerBannerConfig()` server action

### Server Action

`src/app/(app)/planner/actions.ts` — new action:

```typescript
async function updatePlannerBannerConfig(
  contentItemId: string,
  bannerConfig: BannerConfig
): Promise<{ success?: boolean; error?: string }>
```

**Must merge safely into `prompt_context`:** Read existing `prompt_context`, validate with `BannerConfigSchema`, set `prompt_context.banner` key, write back. Never overwrite sibling keys.

### Campaign Creation Forms

New "Banner defaults" section in:
- `src/features/create/event-campaign-form.tsx`
- `src/features/create/promotion-campaign-form.tsx`
- `src/features/create/weekly-campaign-form.tsx`

Controls: position picker + colour scheme dropdown (same components as planner, no custom message at campaign level). Saved to `campaigns.metadata.bannerDefaults`.

When content items are created (`src/lib/create/service.ts`), read `bannerDefaults` from the campaign and populate each content item's `prompt_context.banner` with those defaults + `enabled: true` + `schemaVersion: 1`.

The weekly materialiser (`supabase/functions/materialise-weekly/worker.ts`) must also read `bannerDefaults` from `campaigns.metadata` when creating new content items.

## Link-in-Bio Dynamic Banners

### Server-Side Changes

`src/app/(public)/l/[slug]/page.tsx`:
- Add `export const dynamic = 'force-dynamic'` to prevent static caching (labels must be current)
- Alternatively, use `export const revalidate = 60` for 1-minute freshness (lower cost, acceptable staleness)

`src/lib/link-in-bio/public.ts` (around line 184+):
- Currently hides campaigns until the first scheduled post has arrived
- **No change to this logic** — banners only appear on campaigns that are already visible
- For visible campaigns: call `getProximityLabel({ referenceAt: DateTime.now(), campaignTiming })` 
- Return the label + banner config as part of the campaign card data

### Client-Side Updates

`src/features/link-in-bio/public/link-in-bio-public-page.tsx`:
- Render CSS bar overlay on campaign card images (same component as planner preview)
- **Client-side timer:** Set a `setTimeout` to recalculate labels at midnight London time, or every hour, to handle day transitions without a page reload. Without this, a page loaded at 23:00 would still say "TOMORROW" after midnight.

### Link-in-Bio Types

Add banner fields to `src/lib/link-in-bio/types.ts`:

```typescript
interface LinkInBioCampaignCard {
  // ... existing fields ...
  bannerLabel?: string;
  bannerConfig?: BannerConfig;
}
```

## Edge Cases

| Case | Behaviour |
|------|-----------|
| Post scheduled after event start timestamp | No banner (`null`) — compares full timestamp, not just date |
| Video media | Banner skipped silently, `enabled` stays true |
| No media attached | Banner skipped silently |
| Multi-image post | Banner applied to first image only |
| Multi-day promotion, started, end 7+ days away | `ON NOW` (valid outside week window) |
| Multi-day promotion, not started, start 7+ days away | No banner |
| Promotion end urgency vs start urgency | End urgency checked first if promotion has started |
| Promotion `endAt` semantics | `endAt` date = 23:59:59 local time |
| Publish retry | Label uses original `scheduled_for`, not retry time |
| Render failure | Publish with original image, log notification |
| Custom message + outside week window (events) | No banner (window enforced) |
| Custom message + active promotion (`ON NOW`) | Banner shown with custom message (exception) |
| `prompt_context` merge | Safe JSON merge, never overwrite sibling keys |
| Banner config parse error | Treat as disabled, log warning |
| DST transitions | Luxon handles automatically in Europe/London zone |
| Friday post → Monday event (3 days) | "THIS MONDAY" (rolling window, not ISO week) |
| Saturday post → Saturday event (7 days) | No banner (>6 days) |
| Midnight boundary | Link-in-bio client timer recalculates at midnight |
| Content item status `publishing`/`posted` | Banner config locked (not editable) |
| Empty custom message string | Treated as unset, falls back to auto-generated |
| `schemaVersion` mismatch | Parse with current schema, ignore unknown fields |

## Files to Create

| File | Purpose |
|------|---------|
| `src/lib/scheduling/proximity-label.ts` | Proximity label logic + `CampaignTiming` helper |
| `src/lib/scheduling/banner-config.ts` | `BannerConfig` type, `BannerConfigSchema` Zod schema, colour map, validation |
| `supabase/functions/publish-queue/banner-renderer.ts` | FFmpeg-based image rendering |
| `supabase/functions/publish-queue/proximity.ts` | Deno copy of proximity label logic |
| `src/features/planner/banner-controls.tsx` | Planner UI controls |
| `src/features/planner/banner-preview.tsx` | CSS overlay preview component (shared by planner + link-in-bio) |
| `tests/lib/scheduling/proximity-label.test.ts` | Proximity label unit tests |
| `tests/lib/scheduling/banner-config.test.ts` | Config validation tests |

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/publish-queue/worker.ts` | Load campaign metadata, integrate banner rendering, failure fallback |
| `src/features/planner/planner-content-composer.tsx` | Add banner preview overlay |
| `src/features/create/event-campaign-form.tsx` | Banner defaults section |
| `src/features/create/promotion-campaign-form.tsx` | Banner defaults section |
| `src/features/create/weekly-campaign-form.tsx` | Banner defaults section |
| `src/lib/create/service.ts` | Populate `prompt_context.banner` from campaign defaults on content item creation |
| `src/app/(app)/planner/actions.ts` | New `updatePlannerBannerConfig()` action with safe JSON merge |
| `src/app/(app)/create/actions.ts` | Pass banner defaults through to service |
| `src/lib/planner/data.ts` | Include banner config in planner data queries |
| `src/features/link-in-bio/public/link-in-bio-public-page.tsx` | CSS banner overlay + client timer |
| `src/lib/link-in-bio/public.ts` | Calculate proximity labels for visible campaigns |
| `src/lib/link-in-bio/types.ts` | Add banner fields to campaign card type |
| `src/app/(public)/l/[slug]/page.tsx` | Add `dynamic = 'force-dynamic'` or `revalidate = 60` |
| `supabase/functions/materialise-weekly/worker.ts` | Read `bannerDefaults` from campaign metadata |

## Acceptance Test Matrix

### Proximity Label Logic
- [ ] Event 7+ days away → no banner
- [ ] Event 6 days away → THIS {WEEKDAY}
- [ ] Event 2 days away → THIS {WEEKDAY}
- [ ] Event tomorrow, evening (19:00) → TOMORROW NIGHT
- [ ] Event tomorrow, afternoon (14:00) → TOMORROW
- [ ] Event today, evening → TONIGHT
- [ ] Event today, daytime → TODAY
- [ ] Post after event start timestamp → no banner
- [ ] Post at 20:00 for 19:00 event same day → no banner
- [ ] Friday → Monday event (3 days) → THIS MONDAY
- [ ] Saturday → Saturday event (7 days) → no banner
- [ ] DST transition day (clocks change) → correct day calculation

### Promotion Labels
- [ ] Before start, within week → THIS {WEEKDAY}
- [ ] During promotion, end 7+ days → ON NOW
- [ ] During promotion, end 2-6 days → ENDS {WEEKDAY}
- [ ] During promotion, end tomorrow → ENDS TOMORROW
- [ ] During promotion, end today → LAST DAY
- [ ] After promotion end EOD → no banner
- [ ] Long-running promotion with custom message → shows custom message

### Weekly Recurring
- [ ] Before this week's occurrence → correct label for this week
- [ ] After this week's occurrence → label for next week

### Rendering
- [ ] Horizontal bar at top, correct dimensions on 1080x1350
- [ ] Horizontal bar at bottom, correct dimensions on 1080x1920
- [ ] Vertical bar left, text rotated correctly
- [ ] Vertical bar right, text rotated correctly
- [ ] All 8 colour schemes render legibly
- [ ] Render failure → original image published, notification logged
- [ ] Temp file created, signed URL generated, cleanup after success

### UI
- [ ] Campaign form shows banner defaults section
- [ ] Defaults propagated to content items on creation
- [ ] Planner shows CSS preview matching configured banner
- [ ] Planner controls save correctly (safe JSON merge)
- [ ] Custom message enforces 20-char grapheme limit
- [ ] Banner controls locked on `publishing`/`posted` items
- [ ] Link-in-bio shows correct label for current time
- [ ] Link-in-bio updates after midnight (client timer)

### Data Safety
- [ ] `prompt_context` merge preserves existing keys
- [ ] Invalid banner config parsed → treated as disabled
- [ ] Video content → banner skipped
- [ ] No media → banner skipped
- [ ] Multi-image → only first image bannered
