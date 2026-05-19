# Phase 6: Analytics, Link-in-Bio, and Advanced Features - Context

**Gathered:** 2026-05-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Three capabilities: (1) analytics dashboard showing per-post engagement, platform/content-type comparisons, best day/time recommendations, and GBP daily location metrics; (2) a branded link-in-bio public page with editor and public route; (3) advanced publishing features — Instagram carousel and flexible recurring auto-publish. Schema tables already deployed in Phase 1 (analytics_snapshots, gbp_daily_metrics, link_in_bio_profiles, link_in_bio_tiles).

</domain>

<decisions>
## Implementation Decisions

### Link-in-Bio Editor
- **D-01:** Tile types — links + media + embeds. Embeds include Google Maps, menu PDF, social posts (Instagram/Facebook), and upcoming events feed pulled from the planner. Richest option for hospitality venues.
- **D-02:** Side-by-side live preview — form/controls on left, phone-frame preview on right updating in real time.
- **D-03:** Full brand customisation — logo upload, hero image, colour palette picker, curated font choice, and layout variant selection.
- **D-04:** Drag-and-drop tile reordering using dnd-kit or similar. No arrow-button fallback required.
- **D-05:** Slug availability check on save only — not debounced live check. Simpler UX, validates when owner commits.
- **D-06:** Auto-save drafts — changes saved automatically as owner edits. Page stays in draft state until explicitly published.
- **D-07:** Image uploads (logo, hero, tile images) — upload to Supabase Storage with server-side resize/compress via Sharp for public page performance.

### Link-in-Bio Public Page
- **D-08:** Multiple layout templates — 3-4 pre-designed templates (e.g., classic, grid, magazine, minimal). Owner picks one and customises within it.
- **D-09:** Server-side analytics — click counts via server action on tile clicks, plus page view tracking via middleware or server component render. No third-party tracking scripts (LIB-05).
- **D-10:** Simple 404 for unpublished or non-existent slugs — standard Next.js not-found page, no CheersAI branding on it.
- **D-11:** No "Powered by CheersAI" footer or branding on public page — venue's brand only.

### Recurring Auto-Publish
- **D-12:** Flexible recurrence patterns — daily, weekly, and monthly supported. Covers all common hospitality posting cadences.
- **D-13:** Auto-publish silently after first approval — no notification sent for each recurrence. Set and forget.
- **D-14:** Pause / resume / stop controls available from campaign detail page. Owner can skip occurrences (pause) or cancel entirely (stop).
- **D-15:** Instagram carousel via multi-image upload in existing create flow — 2-10 images, drag to reorder. Uses existing media pipeline, not a separate carousel builder.

### Analytics Dashboard
- **D-16:** Not discussed — Claude's discretion on dashboard layout, chart types, visualisation library, and time range controls. Must meet ANLY-01 through ANLY-06 requirements.

### Claude's Discretion
- Analytics dashboard presentation (chart library, layout, visualisations, time range selector)
- Drag-and-drop library choice (dnd-kit recommended but not locked)
- Layout template designs (specific template names, styles, colour schemes)
- Auto-save debounce interval and draft indicator UX
- Carousel image validation rules (aspect ratio, file size limits)
- Recurrence scheduling implementation (cron expressions vs. custom logic)
- GBP metrics cron job timing and retry strategy

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Analytics Requirements
- `.planning/REQUIREMENTS.md` §Analytics — ANLY-01 through ANLY-06 (per-post tracking, engagement rates, comparisons, best day/time, GBP metrics, empty state handling)

### Link-in-Bio Requirements
- `.planning/REQUIREMENTS.md` §Link-in-Bio — LIB-01 through LIB-06 (profile page, contact links, tiles, slug check, no third-party tracking, ISR public route)

### Scheduling & Performance
- `.planning/REQUIREMENTS.md` §Scheduling — SCHED-04 (recurring campaigns)
- `.planning/REQUIREMENTS.md` §Performance & Reliability — PERF-03 (performance targets)

### Prior Phase Context
- `.planning/phases/01-security-and-auth-foundation/01-CONTEXT.md` — Schema baseline (D-08, D-09): all domain tables deployed including analytics_snapshots, gbp_daily_metrics, link_in_bio_profiles, link_in_bio_tiles
- `.planning/phases/03-provider-integration/03-CONTEXT.md` — GBP adapter patterns, provider registry
- `.planning/phases/04-publishing-pipeline/04-CONTEXT.md` — QStash pipeline, preflight, idempotency patterns
- `.planning/phases/05-realtime-ux-and-notifications/05-CONTEXT.md` — Performance budgets (LCP, INP, Lighthouse targets)

### Project Context
- `.planning/PROJECT.md` — Project vision, constraints, key decisions
- `.planning/ROADMAP.md` §Phase 6 — Phase goal, success criteria, dependency on Phase 4

### Codebase Patterns
- `.planning/codebase/ARCHITECTURE.md` — Layered server-client architecture, server actions pattern
- `.planning/codebase/CONVENTIONS.md` — Naming patterns, error handling, type conversion (fromDb)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/link-in-bio/` — Existing link-in-bio library code (check current state before extending)
- `src/app/(public)/l/[slug]/page.tsx` — Public route already exists (inspect and extend)
- `src/lib/gbp/` — GBP API patterns from v1 (inform metrics collection cron)
- `src/lib/qstash/` — QStash client for cron jobs (reuse for GBP metrics cron and recurring publish)
- `src/lib/publishing/` — Publishing queue and preflight checks (extend for carousel and recurring)
- `src/lib/scheduling/` — Event scheduling, conflict detection, materialise (extend for recurrence)
- `src/components/ui/` — Radix-based primitives (card, tabs, skeleton, badge, dialog, sheet)
- `src/lib/media/` or `src/lib/banner/` — Image processing via Sharp (reuse for upload optimisation)
- `src/hooks/use-mobile.tsx` — Mobile detection for responsive editor layout

### Established Patterns
- Server actions with `requireAuthContext()` for all mutations
- React Query for client-side data fetching with custom hooks
- Zod validation on all inputs
- RLS account-scoped with service-role bypass for system operations
- `fromDb<T>()` for snake_case → camelCase conversion

### Integration Points
- Dashboard sidebar: add Analytics and Link-in-Bio nav items
- Campaign detail page: add recurring controls (pause/resume/stop)
- Create flow: extend for carousel multi-image upload
- Public route group `(public)`: extend for link-in-bio templates
- API routes: add GBP metrics cron endpoint
- Middleware: add page view tracking for `/l/[slug]` routes

</code_context>

<specifics>
## Specific Ideas

- Embed types tailored for hospitality: Google Maps (location), menu PDF viewer, latest social posts, upcoming events from planner
- Full brand customisation with layout template choices — not a one-size-fits-all page
- Auto-save draft pattern with explicit publish action — owner never loses work
- Silent auto-publish after first approval for recurring campaigns — minimal friction for regular posters
- Carousel uses existing create flow with multi-image selection, not a separate builder

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 06-analytics-link-in-bio-and-advanced-features*
*Context gathered: 2026-05-19*
