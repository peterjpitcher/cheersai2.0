# Phase 6: Analytics, Link-in-Bio, and Advanced Features - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-19
**Phase:** 06-analytics-link-in-bio-and-advanced-features
**Areas discussed:** Link-in-bio editor, Link-in-bio public page, Recurring auto-publish

---

## Link-in-Bio Editor

### Tile Types

| Option | Description | Selected |
|--------|-------------|----------|
| Links only | Simple link tiles with title, URL, and optional icon — like Linktree | |
| Links + media | Link tiles plus image/video tiles for showcasing venue photos, menus, events | |
| Links + media + embeds | All above plus embedded content (Instagram posts, Google Maps, upcoming events) | ✓ |
| You decide | Claude picks based on what makes sense for hospitality venues | |

**User's choice:** Links + media + embeds
**Notes:** Richest option, appropriate for hospitality venue needs.

### Editor Preview Mode

| Option | Description | Selected |
|--------|-------------|----------|
| Side-by-side live preview | Form on left, phone-frame preview on right updating in real time | ✓ |
| Toggle preview mode | Edit mode and preview mode as separate views the owner switches between | |
| You decide | Claude picks the approach that fits the existing UI patterns | |

**User's choice:** Side-by-side live preview
**Notes:** Standard page builder pattern.

### Brand Customisation Depth

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal (logo + colours) | Logo upload, primary/secondary colour picker | |
| Moderate (+ hero + fonts) | Logo, hero image, colour palette, and font choice from curated set | |
| Full (+ layout variants) | All above plus layout style choices (grid vs list, tile shapes, background patterns) | ✓ |

**User's choice:** Full (+ layout variants)
**Notes:** Maximum flexibility for venue owners.

### Tile Reordering

| Option | Description | Selected |
|--------|-------------|----------|
| Drag-and-drop | Drag tiles to reorder (dnd-kit or similar). Needs mobile fallback | ✓ |
| Up/down arrows | Arrow buttons on each tile to move position. Simple, accessible | |
| Both | Drag-and-drop with arrow button fallback for accessibility | |

**User's choice:** Drag-and-drop
**Notes:** No arrow fallback required.

### Slug Availability Check

| Option | Description | Selected |
|--------|-------------|----------|
| Debounced live check | Check availability as they type (after 500ms pause) | |
| On save only | Validate when they hit save | ✓ |
| You decide | Claude picks based on UX best practice | |

**User's choice:** On save only
**Notes:** Simpler approach, validates at commit time.

### Embed Types

| Option | Description | Selected |
|--------|-------------|----------|
| Google Maps + menu PDF | Location map embed and PDF/image menu viewer | |
| Maps + menu + social | Above plus latest Instagram post or Facebook event embed | |
| Maps + menu + social + events | All above plus live upcoming events feed from planner | ✓ |

**User's choice:** Maps + menu + social + events
**Notes:** Full integration with existing planner features.

### Auto-Save Behaviour

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-save drafts | Save changes automatically as owner edits. Page stays draft until published | ✓ |
| Manual save + publish | Explicit save button for drafts, separate publish action | |
| You decide | Claude picks the best pattern for this type of editor | |

**User's choice:** Auto-save drafts
**Notes:** No risk of losing work; explicit publish action controls when changes go live.

### Image Uploads

| Option | Description | Selected |
|--------|-------------|----------|
| Direct upload to Supabase Storage | Upload images straight to Supabase Storage bucket | |
| Upload + auto-optimise | Upload with server-side resize/compress via Sharp | ✓ |
| You decide | Claude picks based on LCP ≤2.0s requirement | |

**User's choice:** Upload + auto-optimise
**Notes:** Needed for public page performance.

---

## Link-in-Bio Public Page

### Layout Options

| Option | Description | Selected |
|--------|-------------|----------|
| Single column centred | Classic Linktree style — stacked tiles, centred, mobile-first | |
| Grid + single column | Owner chooses between 2-column grid or single column | |
| Multiple layout templates | 3-4 pre-designed templates (classic, grid, magazine, minimal) | ✓ |

**User's choice:** Multiple layout templates
**Notes:** Owner picks a template and customises within it.

### Public Page Analytics

| Option | Description | Selected |
|--------|-------------|----------|
| Server-side click counts | Count tile clicks via server action. Simple, privacy-friendly | |
| Server-side + view counts | Click counts plus page view tracking via middleware/server component | ✓ |
| You decide | Claude picks simplest approach meeting LIB-05 | |

**User's choice:** Server-side + view counts
**Notes:** Both views and clicks tracked, no third-party scripts.

### 404 / Draft Handling

| Option | Description | Selected |
|--------|-------------|----------|
| Branded 404 page | CheersAI-branded "page not found" with sign-up link | |
| Simple 404 | Standard Next.js not-found page | ✓ |
| You decide | Claude picks based on product sense | |

**User's choice:** Simple 404
**Notes:** No frills, no branding.

### CheersAI Branding on Public Page

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, always | "Powered by CheersAI" badge in footer | |
| Yes, removable later | Show by default, build toggle for future premium tier | |
| No branding | Clean page with no CheersAI mention | ✓ |

**User's choice:** No branding
**Notes:** Venue's brand only.

---

## Recurring Auto-Publish

### Recurrence Patterns

| Option | Description | Selected |
|--------|-------------|----------|
| Weekly only | Same day/time each week. Matches SCHED-04 | |
| Weekly + fortnightly | Weekly or every two weeks | |
| Flexible (daily/weekly/monthly) | Full recurrence options | ✓ |

**User's choice:** Flexible (daily/weekly/monthly)
**Notes:** Covers all common hospitality posting cadences.

### Post-Approval Behaviour

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-publish silently | Future posts publish with no notification | ✓ |
| Auto-publish + notify | Publish automatically but notify owner each time | |
| Queue for review each time | Each recurrence queues draft for approval | |

**User's choice:** Auto-publish silently
**Notes:** Set and forget — no friction for regular posters.

### Campaign Management Controls

| Option | Description | Selected |
|--------|-------------|----------|
| Pause / resume / stop | Full control from campaign detail page | ✓ |
| Stop only | Cancel recurring campaign, no pause option | |
| You decide | Claude picks UX that fits existing patterns | |

**User's choice:** Pause / resume / stop
**Notes:** Full control including skip-next-occurrence via pause.

### Carousel Creation

| Option | Description | Selected |
|--------|-------------|----------|
| Multi-image upload in create flow | Upload 2-10 images in existing create flow, drag to reorder | ✓ |
| Dedicated carousel builder | Separate UI with slide-by-slide editing | |
| You decide | Claude picks based on Phase 2 create flow | |

**User's choice:** Multi-image upload in create flow
**Notes:** Uses existing media pipeline, integrated into current create flow.

---

## Claude's Discretion

- Analytics dashboard presentation (chart library, layout, visualisations, time range controls)
- Drag-and-drop library choice
- Layout template designs
- Auto-save implementation details
- Carousel image validation rules
- Recurrence scheduling implementation
- GBP metrics cron job details

## Deferred Ideas

None — discussion stayed within phase scope
