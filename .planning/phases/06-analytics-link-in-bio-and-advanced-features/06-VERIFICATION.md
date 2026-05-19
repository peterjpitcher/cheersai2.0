---
phase: 06-analytics-link-in-bio-and-advanced-features
verified: 2026-05-19T16:30:20Z
status: gaps_found
score: 11/14 must-haves verified
re_verification: false
gaps:
  - truth: "Owner can pause, resume, and stop recurring campaigns from campaign detail page (D-14)"
    status: failed
    reason: "RecurringControls component exists at src/app/(app)/campaigns/[id]/recurring-controls.tsx but is never imported or rendered in the campaign [id]/page.tsx (584-line file, no import found)"
    artifacts:
      - path: "src/app/(app)/campaigns/[id]/recurring-controls.tsx"
        issue: "ORPHANED — exported component not imported anywhere in the campaign detail page"
      - path: "src/app/(app)/campaigns/[id]/page.tsx"
        issue: "No import of RecurringControls; recurring campaign controls not surfaced to owner"
    missing:
      - "Import RecurringControls into campaign [id]/page.tsx"
      - "Render <RecurringControls> conditionally when campaign.auto_confirm is true"

  - truth: "Instagram carousel publishing works end-to-end with 2-10 images and drag reorder in create flow (D-15)"
    status: failed
    reason: "CarouselUploader component exists and is substantive (356 lines, DnD wired) but is never imported or used anywhere in the create flow — not in any step file under src/features/create/steps/"
    artifacts:
      - path: "src/features/create/carousel-uploader.tsx"
        issue: "ORPHANED — exported component not imported in any create-flow step"
    missing:
      - "Import CarouselUploader into the relevant create-flow step (e.g., media/content step)"
      - "Conditionally render when platform=instagram and content_type=carousel"

  - truth: "Slug availability is validated on save only via Server Action (LIB-04)"
    status: failed
    reason: "checkSlugAvailability server action exists in src/app/actions/link-in-bio.ts but is not called from the editor UI — not in profile-form.tsx, link-in-bio-editor.tsx, or use-link-in-bio-editor.ts"
    artifacts:
      - path: "src/app/actions/link-in-bio.ts"
        issue: "checkSlugAvailability defined but not called from any editor component"
      - path: "src/features/link-in-bio/editor/profile-form.tsx"
        issue: "Slug field rendered (line 133) but no availability check on save or otherwise"
    missing:
      - "Call checkSlugAvailability from profile-form.tsx on slug field submit/save"
      - "Display availability feedback (available/taken) to owner in the editor"
---

# Phase 06: Analytics, Link-in-Bio, and Advanced Features — Verification Report

**Phase Goal:** Owner can see how their content performs, has a branded link-in-bio page for their venue, and the remaining advanced features (carousel, recurring auto-publish, fine-tune polish) round out the platform.
**Verified:** 2026-05-19T16:30:20Z
**Status:** gaps_found
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Analytics queries return per-post engagement rate with impressions | VERIFIED | `getPostAnalytics` in queries.ts (198 lines) queries analytics_snapshots joined to publish_jobs; `computeEngagementRate` returns null for zero impressions |
| 2 | Best day/time aggregation identifies top slots from historical publish data | VERIFIED | `computeBestTimeSlots` in aggregations.ts (168 lines); `getBestDayTimeSlots` query; 7x24 heatmap in analytics dashboard |
| 3 | GBP daily metrics cron fetches from GBP Performance API and stores in gbp_daily_metrics | VERIFIED | gbp/metrics.ts (225 lines) hits `businessprofileperformance.googleapis.com`; cron route (154 lines) validates CRON_SECRET and imports fetchGbpDailyMetrics |
| 4 | Empty/unavailable analytics data returns explanation strings, not nulls/zeroes | VERIFIED | `describeEmptyReason` in aggregations.ts returns typed union; `EmptyAnalyticsState` component (70 lines) renders reason text |
| 5 | Owner can compare post performance across platforms in a bar chart | VERIFIED | `PlatformComparisonChart` (112 lines); analytics-dashboard.tsx tab "By Platform" wired to `usePlatformComparison` |
| 6 | Owner can compare performance across content types | VERIFIED | `useContentTypeComparison` hook; "By Content Type" tab in analytics dashboard wired to aggregation layer |
| 7 | Best day/time heatmap shows 7x24 grid with engagement intensity | VERIFIED | `BestTimeHeatmap` component (156 lines); wired in analytics dashboard |
| 8 | GBP location metrics display over time | VERIFIED | `GbpMetricsChart` (in analytics features); `useGbpMetrics` hook; wired in dashboard GBP tab |
| 9 | Link-in-bio profile supports slug, bio, logo, hero, brand colours, font, and template | VERIFIED | types.ts (178 lines) exports LinkInBioTemplate, LinkInBioFont; migration 00000000000009 adds display_name, template, font_family columns; profile-form.tsx renders all fields |
| 10 | Contact links section includes phone, WhatsApp, booking, menu, parking, directions, social URLs | VERIFIED | migration adds whatsapp_number, booking_url, menu_url, parking_url, directions_url, facebook_url, instagram_url columns; types reflect these |
| 11 | Click tracking uses server action only — no third-party tracking on public page | VERIFIED | click-tracking.ts has `'use server'` directive; uses tryCreateServiceSupabaseClient; click-tracker.tsx calls trackTileClick; no third-party scripts in public page |
| 12 | Auto-save debounces editor changes (D-06) | VERIFIED | use-auto-save.ts (99 lines) debounces 2s default, JSON comparison to skip no-ops; used in link-in-bio-editor.tsx |
| 13 | Owner can pause, resume, and stop recurring campaigns from campaign detail (D-14) | FAILED | RecurringControls component ORPHANED — not rendered in campaign [id]/page.tsx |
| 14 | Instagram carousel publishing works end-to-end in create flow (D-15) | FAILED | CarouselUploader ORPHANED — not integrated into any create-flow step |
| 15 | Slug availability check wired in editor (LIB-04) | FAILED | checkSlugAvailability server action exists but not called from profile-form or editor |

**Score:** 11/14 truths verified (3 gaps)

---

### Required Artifacts

| Artifact | Lines | Status | Details |
|----------|-------|--------|---------|
| `src/lib/analytics/types.ts` | 71 | VERIFIED | Exports PostAnalytics, PlatformEngagement, ContentTypePerformance, BestTimeSlot, GbpLocationMetrics, DateRange, AnalyticsEmptyReason |
| `src/lib/analytics/queries.ts` | 198 | VERIFIED | Exports getPostAnalytics, getEngagementByPlatform, getEngagementByContentType, getBestDayTimeSlots, getGbpDailyMetrics; queries analytics_snapshots |
| `src/lib/analytics/aggregations.ts` | 168 | VERIFIED | Exports aggregateByPlatform, aggregateByContentType, computeBestTimeSlots, computeEngagementRate, describeEmptyReason |
| `src/lib/gbp/metrics.ts` | 225 | VERIFIED | Exports fetchGbpDailyMetrics, storeGbpDailyMetrics; hits businessprofileperformance.googleapis.com |
| `src/app/api/cron/gbp-metrics/route.ts` | 154 | VERIFIED | POST handler; validates CRON_SECRET; imports from gbp/metrics |
| `supabase/migrations/00000000000009_link_in_bio_reconcile.sql` | 113 | VERIFIED | Adds all missing columns; creates link_in_bio_clicks and link_in_bio_page_views with RLS (2 ENABLE ROW LEVEL SECURITY statements confirmed) |
| `src/lib/link-in-bio/types.ts` | 178 | VERIFIED | Exports TileType, LinkInBioTemplate, LinkInBioFont, isPublished, embed data types |
| `src/lib/link-in-bio/click-tracking.ts` | 95 | VERIFIED | 'use server'; exports trackTileClick, trackPageView; uses tryCreateServiceSupabaseClient; queries link_in_bio_clicks |
| `src/lib/link-in-bio/templates.ts` | 61 | VERIFIED | Exports TEMPLATES, getTemplate; 4 templates: classic, grid, magazine, minimal |
| `src/lib/link-in-bio/validation.ts` | 95 | VERIFIED | Exports slugSchema, profileSchema, tileSchema |
| `src/features/link-in-bio/editor/hooks/use-auto-save.ts` | 99 | VERIFIED | Exports useAutoSave; debounce + JSON comparison + saved state auto-clear |
| `src/features/link-in-bio/editor/hooks/use-link-in-bio-editor.ts` | 124 | VERIFIED | Exports useLinkInBioEditor; wraps React Query getLinkInBioProfileWithTiles |
| `src/features/analytics/analytics-dashboard.tsx` | 250 | VERIFIED | 5 tabbed views; wired to all chart components and hooks |
| `src/features/analytics/charts/platform-comparison.tsx` | 112 | VERIFIED | Exports PlatformComparisonChart |
| `src/features/analytics/charts/best-time-heatmap.tsx` | 156 | VERIFIED | Exports BestTimeHeatmap |
| `src/features/analytics/cards/empty-analytics-state.tsx` | 70 | VERIFIED | Exports EmptyAnalyticsState; uses describeEmptyReason |
| `src/app/(app)/analytics/page.tsx` | 48 | VERIFIED | Exports default + renders AnalyticsDashboard |
| `src/features/analytics/hooks/use-analytics-data.ts` | 86 | VERIFIED | Wraps analytics server actions via useQuery |
| `src/features/link-in-bio/editor/link-in-bio-editor.tsx` | 227 | VERIFIED | Side-by-side editor; uses useAutoSave and useLinkInBioEditor |
| `src/features/link-in-bio/editor/tile-list.tsx` | 259 | VERIFIED | DnD-kit SortableContext; supports up to 12 tiles |
| `src/features/link-in-bio/public/templates/classic.tsx` | 115 | VERIFIED | Exports ClassicTemplate |
| `src/app/(public)/l/[slug]/page.tsx` | 53 | VERIFIED | ISR revalidate=300; exports generateMetadata; tracks page view; renders template via getTemplateComponent |
| `src/app/actions/link-in-bio.ts` | 129 | VERIFIED | Exports saveProfile, publishPage, checkSlugAvailability |
| `src/lib/publishing/recurring-dispatch.ts` | 132 | VERIFIED | Exports dispatchRecurringPublishes; queries auto_confirm=true; calls dispatchToQStash |
| `src/app/api/cron/recurring-publish/route.ts` | 63 | VERIFIED | POST handler; imports dispatchRecurringPublishes |
| `src/features/create/carousel-uploader.tsx` | 356 | ORPHANED | Component is substantive with DnD; exports CarouselUploader; not imported anywhere in create flow |
| `src/app/(app)/campaigns/[id]/recurring-controls.tsx` | 191 | ORPHANED | Exports RecurringControls; not imported or rendered in campaign [id]/page.tsx |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| analytics/queries.ts | analytics_snapshots table | supabase.from('analytics_snapshots') | WIRED | 2 matches confirmed |
| gbp/metrics.ts | businessprofileperformance.googleapis.com | fetch to GBP Performance API | WIRED | URL found in file |
| cron/gbp-metrics/route.ts | src/lib/gbp/metrics.ts | import fetchGbpDailyMetrics | WIRED | import found |
| link-in-bio/profile.ts | link_in_bio_profiles table | supabase.from('link_in_bio_profiles') | WIRED | 2 matches confirmed |
| link-in-bio/click-tracking.ts | link_in_bio_clicks table | supabase insert | WIRED | Pattern found |
| use-auto-save.ts | upsertLinkInBioProfile | saveFn parameter (generic hook) | WIRED (via link-in-bio-editor.tsx) | Editor passes upsert as saveFn |
| use-analytics-data.ts | analytics server actions | useQuery + import from actions/analytics | WIRED | Server actions wrap query functions |
| analytics-dashboard.tsx | charts/ components | imports PlatformComparisonChart, BestTimeHeatmap, etc. | WIRED | 4 chart imports confirmed |
| analytics page.tsx | AnalyticsDashboard | renders AnalyticsDashboard | WIRED | 2 matches |
| tile-list.tsx | @dnd-kit/sortable | useSortable, SortableContext | WIRED | 5 matches |
| click-tracker.tsx | click-tracking.ts | trackTileClick | WIRED | 3 matches |
| public page.tsx | templates/ | getTemplateComponent | WIRED | Used in link-in-bio-public-page.tsx |
| recurring-dispatch.ts | dispatch.ts | dispatchToQStash | WIRED | Found in recurring-dispatch.ts |
| cron/recurring-publish/route.ts | recurring-dispatch.ts | import dispatchRecurringPublishes | WIRED | Found |
| carousel-uploader.tsx | create flow steps | import CarouselUploader | NOT WIRED | No import found in any create step |
| recurring-controls.tsx | campaign [id] page | import RecurringControls | NOT WIRED | Not imported in page.tsx |
| actions/link-in-bio.ts checkSlugAvailability | profile-form.tsx | call on slug save | NOT WIRED | No call found in editor components |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| ANLY-01 | 06-01 | Per-post publish outcome tracking (success/failure, platform, timestamp) | PARTIAL | analytics_snapshots tracks successful posts; failure tracking is in notifications system (Phase 5). Analytics dashboard shows no failure-outcome view. Success side is tracked via snapshots. |
| ANLY-02 | 06-01 | Engagement rate paired with impressions | SATISFIED | computeEngagementRate returns null for zero-impressions; PostAnalytics type pairs engagementRate with impressions |
| ANLY-03 | 06-03 | Platform comparison and content-type comparison views | SATISFIED | Two tabs in analytics dashboard; PlatformComparisonChart and ContentTypePerformance wired |
| ANLY-04 | 06-01 | Best day/time identification from historical data | SATISFIED | computeBestTimeSlots + BestTimeHeatmap |
| ANLY-05 | 06-01 | GBP daily location metrics via cron (02:00 UTC) | SATISFIED | gbp-metrics cron endpoint wired and substantive |
| ANLY-06 | 06-01, 06-03 | Empty/unavailable data shows explanation, not zeroes | SATISFIED | describeEmptyReason + EmptyAnalyticsState used throughout dashboard |
| LIB-01 | 06-02, 06-04 | Profile page: slug, bio, logo, hero image, brand colours | SATISFIED | All fields in migration + types + editor form |
| LIB-02 | 06-02 | Contact links section | SATISFIED | phone_number, whatsapp_number, booking_url, menu_url, parking_url, directions_url, facebook_url, instagram_url all in migration and types |
| LIB-03 | 06-04 | Up to 12 custom tiles with drag-reorder | SATISFIED | tile-list.tsx (259 lines) uses DnD-kit SortableContext with 12-tile max |
| LIB-04 | 06-02 | Slug availability check via debounced Server Action | BLOCKED | checkSlugAvailability action exists but not called from editor UI |
| LIB-05 | 06-02, 06-04 | No third-party tracking scripts — server-side only | SATISFIED | click-tracking.ts uses 'use server' + service-role client; no external tracking in public page |
| LIB-06 | 06-04 | Public route under /l/[slug] with ISR | SATISFIED | revalidate=300 in public page; route exists at src/app/(public)/l/[slug]/page.tsx |
| SCHED-04 | 06-05 | Auto-publish for approved recurring campaigns (auto_confirm=true) | PARTIAL | Dispatch logic (recurring-dispatch.ts) is substantive and wired to cron. Pause/resume/stop UI (RecurringControls) is ORPHANED — D-14 owner control is missing. |
| PERF-03 | 06-04, 06-05 | Public link-in-bio LCP <= 2.0s | HUMAN NEEDED | ISR revalidate=300 is in place; minimal JS (server component); no third-party scripts. LCP measurement requires human/browser test. |

---

### Anti-Patterns Found

No TODO/FIXME/placeholder patterns detected in core implementation files. The orphaned components are complete implementations, not stubs — they are wired internally but not connected to their parent consumer pages.

---

### Human Verification Required

#### 1. Analytics Dashboard — Publish Failure Display (ANLY-01)

**Test:** Trigger a publish failure for a post. Navigate to /analytics.
**Expected:** Dashboard shows the failed post somewhere (outcome view) with failure platform and timestamp, not just a missing entry.
**Why human:** Programmatic scan found no failure-display code in analytics features. The requirement says "success/failure, platform, timestamp" but it may be intentionally delegated to the notifications page (Phase 5). Need confirmation of intended scope.

#### 2. Public Link-in-Bio LCP (PERF-03)

**Test:** Open /l/[slug] for a published venue in Chrome DevTools Lighthouse or WebPageTest.
**Expected:** LCP <= 2.0s.
**Why human:** ISR is configured; no client-side fetching; no third-party scripts. Actual LCP depends on image sizes, CDN, server response time — cannot verify programmatically.

#### 3. Template Selection Renders Correctly (LIB-01, LIB-06)

**Test:** Switch between classic, grid, magazine, and minimal templates in the editor. Verify phone preview updates live and public page applies the template.
**Expected:** Each template renders distinct layout (column count, hero style, tile style per TemplateConfig).
**Why human:** Template component selection is wired via getTemplateComponent, but visual correctness and phone preview responsiveness require browser verification.

---

### Gaps Summary

Three gaps block full goal achievement:

**Gap 1 — RecurringControls orphaned (SCHED-04 D-14):** The pause/resume/stop UI for recurring campaigns was built as a standalone component (191 lines, substantive) but never imported into the campaign detail page. Owner cannot pause a recurring campaign from the UI, even though the auto-publish dispatch pipeline is fully operational. Fix: import and conditionally render RecurringControls in `src/app/(app)/campaigns/[id]/page.tsx`.

**Gap 2 — CarouselUploader orphaned (D-15):** The Instagram carousel uploader (356 lines, DnD-kit integrated) exists but is not wired into any create-flow step. Owners cannot initiate a carousel post from the create flow. Fix: import CarouselUploader into the create-flow media/content step and conditionally show it when platform=instagram.

**Gap 3 — Slug availability check not wired (LIB-04):** `checkSlugAvailability` server action is implemented and tested but never called from the profile form. The requirement explicitly states "via debounced Server Action." The slug field is rendered in profile-form.tsx but no availability feedback is displayed. Fix: call `checkSlugAvailability` from the profile form on slug field change (debounced) or on save, and surface the available/taken result.

All three gaps are wiring issues — the implementations are complete. No stubs or placeholder code were found in the data layer or UI components.

---

_Verified: 2026-05-19T16:30:20Z_
_Verifier: Claude (gsd-verifier)_
