# Phase 6: Analytics, Link-in-Bio, and Advanced Features - Research

**Researched:** 2026-05-19
**Domain:** Analytics dashboard, Link-in-Bio editor/public page, Recurring auto-publish, Instagram carousel
**Confidence:** HIGH

## Summary

Phase 6 covers three distinct feature domains: (1) an analytics dashboard for post engagement and GBP location metrics, (2) a branded link-in-bio editor with public page and ISR, and (3) advanced publishing features -- recurring auto-publish and Instagram carousel support. Substantial existing code already exists for link-in-bio (data layer, public page component, public route) and Instagram carousel (API layer with child container creation). The analytics domain requires the most new code -- charting UI, data aggregation queries, and a GBP metrics cron job.

Schema tables are already deployed (`analytics_snapshots`, `gbp_daily_metrics`, `link_in_bio_profiles`, `link_in_bio_tiles`). However, the link-in-bio schema migration columns diverge significantly from what the existing code expects -- the code references columns like `display_name`, `hero_media_id`, `theme` JSONB, `phone_number`, `whatsapp_number`, `booking_url` etc., while the migration has `logo_url`, `hero_image_url`, `brand_color_primary`. This means either additional migrations were applied or the code was written against a different schema version. The planner must verify the live schema and reconcile any gaps.

**Primary recommendation:** Build in three vertical slices -- (A) analytics data layer + dashboard, (B) link-in-bio editor enhancements + ISR + click tracking, (C) recurring auto-publish + carousel multi-image. Each can progress independently. Use Recharts for charting (already the React ecosystem standard) and @dnd-kit for drag-reorder.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Tile types -- links + media + embeds. Embeds include Google Maps, menu PDF, social posts (Instagram/Facebook), and upcoming events feed pulled from the planner.
- **D-02:** Side-by-side live preview -- form/controls on left, phone-frame preview on right updating in real time.
- **D-03:** Full brand customisation -- logo upload, hero image, colour palette picker, curated font choice, and layout variant selection.
- **D-04:** Drag-and-drop tile reordering using dnd-kit or similar. No arrow-button fallback required.
- **D-05:** Slug availability check on save only -- not debounced live check.
- **D-06:** Auto-save drafts -- changes saved automatically as owner edits. Page stays in draft state until explicitly published.
- **D-07:** Image uploads (logo, hero, tile images) -- upload to Supabase Storage with server-side resize/compress via Sharp.
- **D-08:** Multiple layout templates -- 3-4 pre-designed templates (classic, grid, magazine, minimal).
- **D-09:** Server-side analytics -- click counts via server action on tile clicks, plus page view tracking via middleware or server component render.
- **D-10:** Simple 404 for unpublished or non-existent slugs.
- **D-11:** No "Powered by CheersAI" footer or branding on public page.
- **D-12:** Flexible recurrence patterns -- daily, weekly, and monthly supported.
- **D-13:** Auto-publish silently after first approval -- no notification for each recurrence.
- **D-14:** Pause / resume / stop controls from campaign detail page.
- **D-15:** Instagram carousel via multi-image upload in existing create flow -- 2-10 images, drag to reorder.

### Claude's Discretion
- Analytics dashboard presentation (chart library, layout, visualisations, time range selector)
- Drag-and-drop library choice (dnd-kit recommended but not locked)
- Layout template designs (specific template names, styles, colour schemes)
- Auto-save debounce interval and draft indicator UX
- Carousel image validation rules (aspect ratio, file size limits)
- Recurrence scheduling implementation (cron expressions vs. custom logic)
- GBP metrics cron job timing and retry strategy

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ANLY-01 | Per-post publish outcome tracking (success/failure, platform, timestamp) | publish_jobs table already stores outcomes; analytics_snapshots schema ready; need aggregation queries |
| ANLY-02 | Engagement rate paired with impressions (no raw vanity metrics) | analytics_snapshots has engagement_rate + impressions columns; display as paired metric |
| ANLY-03 | Platform comparison and content-type comparison views | SQL GROUP BY platform/content_type on analytics_snapshots; Recharts bar/line charts |
| ANLY-04 | Best day/time identification from historical data | Aggregate scheduled_at by day-of-week/hour from publish_jobs with success status |
| ANLY-05 | GBP daily location metrics via cron (02:00 UTC) | GBP Business Profile Performance API; cron endpoint using QStash scheduled delivery |
| ANLY-06 | Empty/unavailable data shows explanation, not zeroes | Empty state component patterns; conditional rendering based on data availability |
| LIB-01 | Profile page: slug, bio, logo, hero image, brand colours | Existing profile.ts CRUD + types.ts; extend for template selection + font choice |
| LIB-02 | Contact links section | Already built in public page (CTA_ORDER array); editor form needed |
| LIB-03 | Up to 12 custom tiles with drag-reorder | Existing CRUD + position field; add @dnd-kit sortable for editor |
| LIB-04 | Slug availability check via Server Action | D-05 locks this to on-save check (not debounced); existing upsert checks slug uniqueness |
| LIB-05 | No third-party tracking scripts -- server-side collection only | D-09 specifies server action for clicks + middleware/RSC for page views |
| LIB-06 | Public route under /l/[slug] with ISR | Existing route has revalidate=60; extend to proper ISR with on-demand revalidation |
| SCHED-04 | Auto-publish for approved recurring campaigns | auto_confirm column exists; materialise.ts already generates slots; need dispatch integration |
| PERF-03 | Public link-in-bio LCP <= 2.0s (fully static after one Supabase read) | ISR with revalidate + image optimization via Sharp + minimal JS bundle |
</phase_requirements>

## Standard Stack

### Core (New Dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| recharts | 3.8.1 | Analytics charts (bar, line, area, pie) | Most popular React charting library; ~25M weekly downloads; declarative API matches React model |
| @dnd-kit/core | 6.3.1 | Drag-and-drop foundation | Modern React DnD library; accessibility-first; tree-shakeable |
| @dnd-kit/sortable | 10.0.0 | Sortable list for tile reordering | Purpose-built sortable abstraction on @dnd-kit/core |
| @dnd-kit/utilities | 3.2.2 | CSS transform helpers for DnD | Required companion for smooth drag animations |

### Already Installed (Extend)
| Library | Version | Purpose | Extension Point |
|---------|---------|---------|-----------------|
| @tanstack/react-query | 5.90.x | Data fetching hooks | Add useAnalytics, useLinkInBioProfile hooks |
| framer-motion | 12.23.x | Animations | Auto-save indicator, template transitions |
| sharp | 0.34.5 | Image processing | Logo/hero resize on upload |
| luxon | 3.7.2 | Date/time | Best day/time analytics, cron scheduling |
| @upstash/qstash | (installed) | Job scheduling | GBP metrics cron, recurring publish dispatch |
| lucide-react | 0.562.x | Icons | Analytics icons, editor toolbar icons |
| zod | 4.2.1 | Validation | Editor form schemas, analytics query params |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Recharts | Chart.js/react-chartjs-2 | Lower bundle size but imperative API; less React-idiomatic |
| Recharts | @nivo/core | More polished defaults but heavier; SSR harder |
| @dnd-kit | @hello-pangea/dnd | Simpler API but less flexible; no touch support by default |

**Installation:**
```bash
npm install recharts @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

**Version verification:** Versions confirmed via `npm view` on 2026-05-19. Recharts 3.8.1 has known rendering issues with React 19.2.3 -- may need `react-is` override (see Pitfalls section).

## Architecture Patterns

### Recommended Project Structure
```
src/
├── features/
│   ├── analytics/                  # NEW: Analytics dashboard
│   │   ├── analytics-dashboard.tsx
│   │   ├── charts/
│   │   │   ├── engagement-chart.tsx
│   │   │   ├── platform-comparison.tsx
│   │   │   ├── best-time-heatmap.tsx
│   │   │   └── gbp-metrics-chart.tsx
│   │   ├── cards/
│   │   │   ├── post-performance-card.tsx
│   │   │   └── empty-analytics-state.tsx
│   │   └── hooks/
│   │       ├── use-analytics-data.ts
│   │       └── use-gbp-metrics.ts
│   ├── link-in-bio/
│   │   ├── editor/                 # NEW: Editor components
│   │   │   ├── link-in-bio-editor.tsx
│   │   │   ├── profile-form.tsx
│   │   │   ├── tile-list.tsx
│   │   │   ├── tile-editor.tsx
│   │   │   ├── template-picker.tsx
│   │   │   ├── phone-preview.tsx
│   │   │   └── hooks/
│   │   │       ├── use-auto-save.ts
│   │   │       └── use-link-in-bio-editor.ts
│   │   └── public/                 # EXISTS: Extend with templates
│   │       ├── templates/
│   │       │   ├── classic.tsx
│   │       │   ├── grid.tsx
│   │       │   ├── magazine.tsx
│   │       │   └── minimal.tsx
│   │       ├── link-in-bio-public-page.tsx  # EXISTS
│   │       └── click-tracker.tsx   # NEW: Server action click handler
│   └── create/                     # EXISTS: Extend for carousel
│       └── carousel-uploader.tsx   # NEW: Multi-image upload
├── lib/
│   ├── analytics/                  # NEW: Analytics data layer
│   │   ├── queries.ts
│   │   ├── aggregations.ts
│   │   └── types.ts
│   ├── gbp/                        # EXISTS: Extend for metrics
│   │   ├── metrics.ts              # NEW: Performance API client
│   │   └── business-info.ts        # EXISTS
│   ├── link-in-bio/                # EXISTS: Extend
│   │   ├── profile.ts              # EXISTS
│   │   ├── public.ts               # EXISTS
│   │   ├── types.ts                # EXISTS
│   │   ├── click-tracking.ts       # NEW: Server-side click/view tracking
│   │   └── templates.ts            # NEW: Template registry
│   └── publishing/                 # EXISTS: Extend
│       └── recurring-dispatch.ts   # NEW: Auto-publish for recurring
├── app/
│   ├── (app)/
│   │   ├── analytics/              # NEW: Dashboard route
│   │   │   └── page.tsx
│   │   ├── link-in-bio/            # NEW: Editor route
│   │   │   └── page.tsx
│   │   └── campaigns/[id]/         # EXISTS: Extend with recurring controls
│   ├── (public)/
│   │   └── l/[slug]/
│   │       └── page.tsx            # EXISTS: Extend with ISR + templates
│   └── api/
│       ├── cron/
│       │   └── gbp-metrics/        # NEW: Nightly GBP metrics cron
│       │       └── route.ts
│       └── link-in-bio/
│           └── track/              # NEW: Click/view tracking endpoint
│               └── route.ts
```

### Pattern 1: Analytics Aggregation Queries
**What:** SQL aggregation queries wrapped in React Query hooks for the dashboard
**When to use:** Every analytics widget
**Example:**
```typescript
// src/lib/analytics/queries.ts
export async function getEngagementByPlatform(
  accountId: string,
  dateRange: { start: string; end: string }
): Promise<PlatformEngagement[]> {
  const supabase = tryCreateServiceSupabaseClient();
  const { data, error } = await supabase
    .from('analytics_snapshots')
    .select('platform, impressions, engagement_rate, snapshot_date')
    .eq('account_id', accountId)
    .gte('snapshot_date', dateRange.start)
    .lte('snapshot_date', dateRange.end)
    .order('snapshot_date', { ascending: true });
  // Group and aggregate in JS for flexibility
  return aggregateByPlatform(data ?? []);
}
```

### Pattern 2: Auto-Save with Debounce
**What:** Debounced auto-save that persists editor state without explicit save button
**When to use:** Link-in-bio editor (D-06)
**Example:**
```typescript
// src/features/link-in-bio/editor/hooks/use-auto-save.ts
export function useAutoSave<T>(
  data: T,
  saveFn: (data: T) => Promise<void>,
  debounceMs = 2000
) {
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(async () => {
      setSaveState('saving');
      try {
        await saveFn(data);
        setSaveState('saved');
      } catch {
        setSaveState('error');
      }
    }, debounceMs);
    return () => clearTimeout(timeoutRef.current);
  }, [data, saveFn, debounceMs]);

  return saveState;
}
```

### Pattern 3: ISR with On-Demand Revalidation
**What:** Combine time-based ISR (safety net) with on-demand revalidation when editor publishes
**When to use:** Public link-in-bio page (LIB-06, PERF-03)
**Example:**
```typescript
// src/app/(public)/l/[slug]/page.tsx
export const revalidate = 300; // 5-min safety net (currently 60s)

// On publish action:
// revalidatePath(`/l/${slug}`);
```

### Pattern 4: Server-Side Click Tracking (D-09, LIB-05)
**What:** Server action called on tile/link click; no client-side tracking scripts
**When to use:** Every outbound link on the public page
**Example:**
```typescript
// src/lib/link-in-bio/click-tracking.ts
'use server';
export async function trackLinkClick(
  slug: string,
  tileId: string,
  referrer: string | null
): Promise<void> {
  const supabase = tryCreateServiceSupabaseClient();
  await supabase.from('link_in_bio_clicks').insert({
    slug, tile_id: tileId, referrer, clicked_at: new Date().toISOString()
  });
}
```

### Anti-Patterns to Avoid
- **Client-side analytics scripts on public page:** Violates LIB-05. All tracking must be server-side.
- **Fetching analytics data in Server Components without caching:** Use React Query hooks in client components; server components provide initial data via props.
- **Building custom drag-and-drop from scratch:** Use @dnd-kit -- handles keyboard accessibility, touch devices, collision detection.
- **Polling for auto-save:** Use debounced effect, not interval polling. Saves only when data changes.
- **Rendering charts in Server Components:** Recharts requires browser APIs (SVG, events). Always wrap in 'use client' components.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Drag-and-drop reorder | Custom mousedown/touchstart handlers | @dnd-kit/sortable | Keyboard a11y, collision algorithms, smooth animations |
| Charts/visualisation | SVG path calculations | Recharts | Responsive, tooltips, animation, axes -- hundreds of edge cases |
| Image resize/compress | Canvas API or ImageMagick shell | Sharp (already installed) | Server-side, handles EXIF rotation, format conversion |
| Debounced save | Custom setTimeout wrapper | Dedicated useAutoSave hook (simple) | Keep it clean but this IS hand-rolled -- just well-encapsulated |
| ISR cache invalidation | Custom caching layer | Next.js revalidatePath/revalidateTag | Framework-native, Vercel-optimised |
| Cron scheduling | Custom setInterval | QStash scheduled messages | Persistent, retryable, survives serverless cold starts |

## Common Pitfalls

### Pitfall 1: Recharts + React 19 Rendering Blank
**What goes wrong:** Recharts 3.x renders blank charts with React 19.2.3 -- no errors in console.
**Why it happens:** Recharts depends on `react-is` which needs version alignment with React 19.
**How to avoid:** Add `react-is` override in package.json resolutions/overrides matching React 19 version. Test charts render in dev before proceeding.
**Warning signs:** Charts mount but render empty SVG containers.

### Pitfall 2: Schema Mismatch -- Link-in-Bio Tables
**What goes wrong:** The base migration (`00000000000005_link_in_bio.sql`) defines columns like `logo_url`, `hero_image_url`, `brand_color_primary`, `contact_email`, but existing code in `src/lib/link-in-bio/profile.ts` queries `display_name`, `hero_media_id`, `theme` (JSONB), `phone_number`, `whatsapp_number`, `booking_url`, etc.
**Why it happens:** Schema was evolved beyond the base migration (additional ALTER TABLE migrations or direct DB changes).
**How to avoid:** Query the LIVE database schema before writing any new link-in-bio code. If columns mismatch, add a reconciliation migration.
**Warning signs:** Supabase queries returning null for expected columns; isSchemaMissingError triggers.

### Pitfall 3: GBP Performance API Quota and Latency
**What goes wrong:** GBP Business Profile Performance API has daily quota limits and 2-3 day data delay.
**Why it happens:** Google aggregates metrics with a delay; API calls are rate-limited per project.
**How to avoid:** Run cron at 02:00 UTC (ANLY-05); request data for date minus 3 days; handle 429 with exponential backoff; store raw_data JSONB for re-processing.
**Warning signs:** Empty metrics for recent dates; 429 responses from Performance API.

### Pitfall 4: ISR Cache Staleness on Publish
**What goes wrong:** Owner publishes link-in-bio changes but public page shows stale content for up to revalidate seconds.
**Why it happens:** ISR serves cached version until revalidation window expires.
**How to avoid:** Call `revalidatePath('/l/${slug}')` in the publish server action for immediate cache bust. Keep time-based revalidate as safety net only.
**Warning signs:** User complains "I published but the page hasn't changed".

### Pitfall 5: Click Tracking Double-Counting
**What goes wrong:** Server action fires multiple times for a single click (React 19 concurrent features, network retries).
**Why it happens:** Server actions can retry on transient failures; user may double-click.
**How to avoid:** Client-side debounce on the click handler (200ms); use a short-lived client-side Set to deduplicate within a session. Accept minor over-counting as acceptable for analytics.
**Warning signs:** Click counts significantly higher than page views.

### Pitfall 6: Carousel Image Order Not Preserved
**What goes wrong:** Instagram carousel publishes images in wrong order.
**Why it happens:** Carousel child containers are created sequentially, but the parent container `children` array order matters. If creation is parallelised, order is lost.
**How to avoid:** Create child containers sequentially (already implemented in `instagram/api.ts` -- `createCarouselChildContainer` is sequential). Preserve `content_media_attachments.position` ordering.
**Warning signs:** Images appear in random order in published carousel.

## Code Examples

### Existing Link-in-Bio Data Layer (HIGH confidence -- from codebase)
```typescript
// src/lib/link-in-bio/profile.ts -- already has full CRUD:
// - getLinkInBioProfileWithTiles()
// - upsertLinkInBioProfile(input)
// - createLinkInBioTile(input)
// - updateLinkInBioTile(tileId, input)
// - deleteLinkInBioTile(tileId)
// - reorderLinkInBioTiles(input)
// All use requireAuthContext() and account-scoped RLS.
```

### Existing Public Page (HIGH confidence -- from codebase)
```typescript
// src/app/(public)/l/[slug]/page.tsx -- already has:
// - revalidate = 60 (ISR)
// - generateMetadata() for SEO
// - getPublicLinkInBioPageData(slug) fetching all data
// - LinkInBioPublicPage component with CTA links, campaigns, tiles

// src/features/link-in-bio/public/link-in-bio-public-page.tsx -- renders:
// - Logo, bio, primary CTAs, hero media
// - Campaign cards with banner overlays
// - Tile grid with media
// - Social links footer
```

### Existing Instagram Carousel API (HIGH confidence -- from codebase)
```typescript
// src/lib/providers/instagram/api.ts -- already has:
// - createCarouselChildContainer(igUserId, accessToken, imageUrl)
// - createMediaContainer(igUserId, accessToken, { mediaType: 'CAROUSEL', children })
// - publishMediaContainer(igUserId, accessToken, containerId)
// Sequential child creation prevents order issues.
```

### Existing Materialise + Auto-Confirm (HIGH confidence -- from codebase)
```typescript
// src/lib/scheduling/materialise.ts -- materialiseRecurringCampaigns():
// - Queries weekly campaigns with status='scheduled'
// - Parses cadence metadata, generates slots in 7-day window
// - Checks for cross-campaign conflicts
// - Inserts new content_items with auto_generated=true

// src/app/actions/content.ts line 78:
// row.auto_confirm = true; // weekly recurring auto-publishes once approved
```

### GBP Performance API Pattern (MEDIUM confidence -- from official docs)
```typescript
// GBP Business Profile Performance API endpoint:
// GET https://businessprofileperformance.googleapis.com/v1/{name}/dailyMetricsTimeSeries
// Params: dailyMetric (WEBSITE_CLICKS, DIRECTION_REQUESTS, CALL_CLICKS, etc.)
//         dailyRange.startDate, dailyRange.endDate
// Auth: OAuth 2.0 with business.manage scope
// Data delay: 2-3 days behind current date
// Retention: 18 months
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| react-beautiful-dnd | @dnd-kit (modular) | 2023+ | react-beautiful-dnd unmaintained; dnd-kit is the successor |
| Recharts 2.x | Recharts 3.x | 2024 | New responsive API; check React 19 compat |
| GBP My Business API v4 | Business Profile Performance API v1 | 2023 | New endpoint: businessprofileperformance.googleapis.com |
| Pages Router ISR | App Router ISR (revalidate export) | Next.js 13+ | Simpler; `export const revalidate = N` |
| Client-side analytics (GA) | Server-side tracking | Privacy trend | LIB-05 mandates no third-party scripts |

**Deprecated/outdated:**
- `react-beautiful-dnd`: Unmaintained since 2023; use @dnd-kit
- GBP `mybusiness.googleapis.com/v4/Metric`: Replaced by Performance API v1
- Recharts 2.x: Still works but 3.x has better TypeScript support and responsive charts

## Open Questions

1. **Link-in-Bio Schema Reconciliation**
   - What we know: Migration defines `logo_url`, `hero_image_url`, `brand_color_primary` columns; code uses `display_name`, `hero_media_id`, `theme` JSONB, `phone_number`, etc.
   - What's unclear: Whether additional migrations were applied that ALTER TABLE'd these columns, or if the code was written speculatively.
   - Recommendation: Query live DB schema at plan execution start. Write reconciliation migration if needed.

2. **Campaigns Table Origin**
   - What we know: `public.ts` queries a `campaigns` table with joins, but no CREATE TABLE for `campaigns` exists in the v2 migration files.
   - What's unclear: Whether this is a v1 holdover table or was created by a migration not in the tracked set.
   - Recommendation: Verify via `SELECT column_name FROM information_schema.columns WHERE table_name = 'campaigns'` before planning.

3. **Recharts 3.x + React 19.2.3 Stability**
   - What we know: GitHub issue #6857 reports blank rendering with React 19.2.3; `react-is` override is the workaround.
   - What's unclear: Whether the fix is fully stable or if there are remaining edge cases.
   - Recommendation: Add `react-is` override immediately; test with simple chart in dev before building full dashboard. Have Chart.js fallback plan.

4. **GBP Performance API Scopes**
   - What we know: API requires `business.manage` OAuth scope; existing GBP connection uses this scope.
   - What's unclear: Whether the existing token vault stores tokens with this scope for all accounts.
   - Recommendation: Check existing GBP connection scopes before building metrics cron.

5. **Click Tracking Schema**
   - What we know: D-09 requires click counts + page views server-side.
   - What's unclear: Whether to add a `link_in_bio_clicks` table or use the existing `analytics_snapshots` table.
   - Recommendation: New lightweight table (`link_in_bio_clicks`) for click events -- different domain from post analytics.

## Sources

### Primary (HIGH confidence)
- Codebase: `src/lib/link-in-bio/` -- full CRUD data layer, types, public page data fetching
- Codebase: `src/features/link-in-bio/public/` -- existing public page component
- Codebase: `src/lib/providers/instagram/api.ts` -- carousel API already implemented
- Codebase: `src/lib/scheduling/materialise.ts` -- recurring materialisation with conflict detection
- Codebase: `supabase/migrations/` -- all schema definitions
- npm registry: Verified package versions via `npm view` on 2026-05-19

### Secondary (MEDIUM confidence)
- [GBP Business Profile Performance API](https://developers.google.com/my-business/reference/performance/rest) -- endpoint structure, metrics available
- [Next.js ISR Guide](https://nextjs.org/docs/app/guides/incremental-static-regeneration) -- revalidate patterns
- [Recharts React 19 Issue #6857](https://github.com/recharts/recharts/issues/6857) -- rendering blank with 19.2.3

### Tertiary (LOW confidence)
- [dnd-kit changelog](https://dndkit.com/changelog/) -- v6 breaking changes (plugin architecture rewrite)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries verified via npm, existing codebase patterns established
- Architecture: HIGH -- extends well-established patterns from prior phases; substantial existing code
- Pitfalls: HIGH -- schema mismatch verified in code vs migration; Recharts issue confirmed via GitHub
- Analytics domain: MEDIUM -- GBP Performance API specifics need runtime verification
- Link-in-Bio editor: MEDIUM -- schema reconciliation needed before detailed planning

**Research date:** 2026-05-19
**Valid until:** 2026-06-19 (30 days -- stable domain, no fast-moving dependencies)
