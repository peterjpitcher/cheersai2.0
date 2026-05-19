# CheersAI 2.0 — Redesign Implementation Plan

> Implements: [docs/redesign-spec.md](redesign-spec.md)
> Created: 2026-05-19

---

## How to use this plan

Each task has a dependency chain. Work within a phase is sequential within each wave but waves themselves can be parallelised where noted. Do not skip ahead to Phase 2 until Phase 1 verification passes.

**Notation:**
- `[blocks: X]` — this task must complete before task X can start
- `[needs: X]` — this task depends on task X being done
- Files are relative to `src/` unless stated otherwise

---

## Completeness review — 2026-05-19

This plan has been reconciled against `docs/redesign-spec.md`, the current App Router file tree, and the design handoff bundle. The original plan was directionally complete, but needed these corrections before implementation:

- Add missing global interaction tasks for toast, modal, and drawer styling from spec section 1.5.
- Preserve backwards compatibility for existing `Button`, `StatusChip`, `PlatformBadge`, and production status/platform enums while introducing the redesign components.
- Use the repository's actual CI commands: `npm run ci:verify` or its component scripts (`lint:ci`, `typecheck`, `test:ci`, `build`).
- Correct route/file paths for `/l/[slug]`, `/help`, and `/privacy`.
- Redirect or remove `/dashboard` as a standalone landing page when Planner becomes the app landing page.
- Add explicit visual QA against the bundled screenshots at 390px, 768px, and 1440px.

### Original brief validation

The top-level bundle brief at `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/cheersai 2/README.md` says the primary source is `project/design_handoff_cheersai_redesign/README.md`. The app redesign files duplicated at `project/` are byte-for-byte identical to the files in `project/design_handoff_cheersai_redesign/`, so the corrected spec and this plan are validated against the original app-redesign brief.

One extra item exists outside the primary handoff: the tournament overlay redesign docs:

- `project/Tournament Overlay Plan.html`
- `project/Tournament Overlay A - Spec.html`

Those files describe a separate rendered-content overlay change for tournament fixture images, not the app shell/page redesign. If the implementation scope is "everything in the original bundle path," include the Tournament Overlay Addendum at the end of this plan. If the scope is only the app redesign from the primary handoff README, the addendum is explicitly out of scope.

### Mandatory preflight checklist

Do this before starting Phase 1 work:

1. Open the source-of-truth prototype and design-system canvas:
   - `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/cheersai 2/project/design_handoff_cheersai_redesign/CheersAI Prototype.html`
   - `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/cheersai 2/project/design_handoff_cheersai_redesign/CheersAI Design System.html`
2. Record the active route/component map from `src/app`, `src/components/layout`, and `src/features`.
3. Inventory legacy component API usage before replacing primitives:
   ```bash
   rg -n '<Button|variant="(default|outline|destructive|link|gloss)"|size="(default|icon)"|StatusChip|PlatformBadge|Badge' src
   ```
4. Capture or open reference screenshots from `design_handoff_cheersai_redesign/screenshots/`.
5. Run `npm run ci:verify` before changes so implementation starts from a known baseline.

---

## Phase 1 — Foundation

**Goal:** New design tokens, fonts, core components, and app shell. Every page immediately looks like the redesign even before page-level layout work.

### Wave 1-A: Design tokens and typography (no component changes)

#### Task 1.1 — Replace CSS custom properties in `globals.css`

**File:** `src/app/globals.css`

1. **Replace `:root` block** — remove all `--brand-*`, `--sidebar-*`, and old semantic vars. Write the full new token set:
   - Surface tokens: `--c-paper`, `--c-paper-2`, `--c-card`, `--c-card-raised`
   - Text/line tokens: `--c-ink` through `--c-ink-4`, `--c-line`, `--c-line-2`
   - Brand orange: `--c-orange`, `--c-orange-hi`, `--c-orange-lo`, `--c-orange-soft`, `--c-orange-tint`
   - Semantic status: `--c-claret`, `--c-claret-soft`, all `--c-status-*-fg`/`-bg` pairs
   - Platform: `--c-fb`, `--c-fb-bg`, `--c-ig`, `--c-ig-bg`, `--c-gbp`, `--c-gbp-bg`
   - Radius: `--r-xs` through `--r-pill`
   - Shadow: `--sh-xs`, `--sh-sm`, `--sh-md`, `--sh-lg`, `--sh-inset`
   - Space: `--s-1` through `--s-24` per `tokens.css`
   - Motion: `--m-fast`, `--m-base`, `--m-slow`, `--m-ease`
   - Semantic bridge: map `--background`, `--foreground`, `--primary`, `--card`, `--border`, `--input`, `--ring`, etc. to new tokens (see spec section 1.1)

2. **Remove the `.dark { }` block entirely** — the redesign is light-only.

3. **Update the `@theme inline` block** — expose new colours (`--color-orange`, `--color-ink`, etc.), remove `--color-brand-blue`, `--color-brand-*`, `--color-sidebar-*`, and old font references.

4. **Remove `--sidebar-*` variables** from both `:root` and the deleted `.dark` block.

5. **Remove `.dark .glass-panel`** and any dark-mode-only utility overrides.

6. **Update body/heading base rules:**
   - Body: add `letter-spacing: -0.003em;`
   - Headings: change `font-family` from `var(--font-heading)` to `var(--font-sans)`, `letter-spacing: -0.01em`

7. **Add `.eyebrow` utility class:**
   ```css
   .eyebrow {
     font-family: var(--font-sans);
     font-size: 10px;
     text-transform: uppercase;
     letter-spacing: 0.08em;
     font-weight: 600;
     color: var(--c-ink-3);
   }
   ```

8. **Add `.mono` utility class:**
   ```css
   .mono {
     font-family: var(--font-mono);
     font-feature-settings: "ss01";
   }
   ```

**Verification:** `npm run build` passes. Existing pages render (colours will look different; that's expected).

`[blocks: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9]`

---

#### Task 1.2 — Replace fonts in `layout.tsx`

**File:** `src/app/layout.tsx`

1. Remove `Plus_Jakarta_Sans` and `Sora` imports from `next/font/google`.
2. Add:
   ```typescript
   import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';

   const ibmPlexSans = IBM_Plex_Sans({
     variable: '--font-ibm-plex-sans',
     subsets: ['latin'],
     weight: ['400', '500', '600', '700'],
     display: 'swap',
   });

   const ibmPlexMono = IBM_Plex_Mono({
     variable: '--font-ibm-plex-mono',
     subsets: ['latin'],
     weight: ['400', '500', '600'],
     display: 'swap',
   });
   ```
3. Update `<html>` className to use new variable names.
4. Update `globals.css` font-stack variables:
   ```css
   --font-sans: var(--font-ibm-plex-sans), "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
   --font-heading: var(--font-ibm-plex-sans), "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
   --font-mono: var(--font-ibm-plex-mono), "IBM Plex Mono", ui-monospace, monospace;
   ```

**Verification:** Fonts visually change on all pages. No FOUT after first load.

`[needs: 1.1]`

---

### Wave 1-B: Core components (can start after 1.1)

#### Task 1.3 — Build `Btn` component

**File:** `src/components/ui/button.tsx` (replace existing)

Replace the current shadcn button with the redesign's `Btn` component, keeping the existing export name `Button` and optionally exporting `Btn` as an alias so existing imports don't break.

1. Implement 6 variants: `primary`, `amber` (alias for primary), `secondary`, `ghost`, `danger`, `inkInverse`.
2. Implement 3 sizes: `sm` (26px/r-5/12px font), `md` (32px/r-md/13px font), `lg` (40px/r-lg/14px font).
3. Props: `variant`, `size`, `icon` (Lucide component, rendered left), `iconRight` (rendered right), `full` (full-width), plus standard `ButtonHTMLAttributes`.
4. Primary/amber: `--c-orange` bg, white text, `--c-orange-hi` border, `--sh-inset` top edge. Hover: `--c-orange-hi` bg. Active: `--c-orange-lo` bg.
5. Secondary: white bg, `--c-ink` text, `--c-line-2` border. Hover: `--c-paper-2` bg.
6. Ghost: transparent bg, `--c-ink-2` text, no border. Hover: `--c-paper-2` bg.
7. Danger: white bg, `--c-claret` text, `--c-line-2` border. Hover: `--c-claret-soft` bg.
8. InkInverse: `--c-ink` bg, white text, `--c-ink` border.
9. Keep `asChild` support if the existing button uses Radix Slot.
10. Preserve legacy variant/size aliases until all call sites are migrated:
    - `default` → `primary`
    - `outline` → `secondary`
    - `destructive` → `danger`
    - `link` → `ghost` with underline styles only where needed
    - `gloss` → `primary` or remove during the page restyle
    - `size="default"` → `md`
    - `size="icon"` → fixed square icon button classes
11. Run the preflight inventory after this task and either migrate call sites or confirm compatibility aliases cover them.

**Verification:** Storybook, temporary test route, or component snapshot shows all variants and sizes. Existing call sites compile without variant type errors.

`[needs: 1.1]` `[blocks: all Phase 2/3 page work]`

---

#### Task 1.4 — Build `Status` chip component

**Files:** `src/components/ui/status.tsx` (new), `src/components/ui/status-chip.tsx` (compatibility wrapper/update)

1. Pill shape (`border-radius: var(--r-pill)`). Height ~22px. 10–11px uppercase text.
2. Renders a coloured dot (6px circle) + label text.
3. Uses `--c-status-{status}-fg` / `--c-status-{status}-bg` token pairs.
4. Statuses: `posted`, `publishing`, `scheduled`, `draft`, `failed`.
5. The `publishing` dot pulses with a 1.4s CSS animation.
6. Preserve production `ContentStatus` compatibility in `StatusChip`:
   - `published`/`posted` → posted visual
   - `queued`/`publishing` → publishing visual
   - `approved`/`scheduled` → scheduled visual unless the page has a better explicit status
   - `review`/`draft` → draft visual
   - `failed` → failed visual
7. Replace existing status badge/chip components currently using inline Tailwind `bg-blue-100 text-blue-700` patterns, including tournament and publishing surfaces.

**Verification:** All 5 statuses render with correct colours and the publishing pulse animates.

`[needs: 1.1]`

---

#### Task 1.5 — Build `PlatformDot` component

**Files:** `src/components/ui/platform-dot.tsx` (new), `src/components/ui/platform-badge.tsx` (compatibility wrapper/update)

1. Circle with platform tint background and solid-colour glyph/icon.
2. Default size 18px, configurable via `size` prop.
3. Accept both design keys (`fb`, `ig`, `gbp`) and production keys (`facebook`, `instagram`, `gbp`) via a small mapping helper.
4. Each platform uses `--c-{platform}` for the icon and `--c-{platform}-bg` for the circle background.
5. Used in post tiles, connection cards, review headers, and ToggleChip.
6. Keep `PlatformBadge` available for existing call sites, but restyle it with the same token pair and migrate page-level designs to `PlatformDot` where the spec calls for dots.

**Verification:** All 3 platforms render at default and custom sizes.

`[needs: 1.1]`

---

#### Task 1.6 — Build `Card` component

**File:** `src/components/ui/card.tsx` (update existing or replace)

1. White background (`--c-card`), `--r-lg` radius (8px), `1px solid var(--c-line)` border.
2. `raised` prop adds `--sh-sm` shadow.
3. Default padding 14px, configurable via `padding` prop or className override.
4. Ensure the existing Card export name is preserved for backwards compat.

**Verification:** Cards render with correct border, radius, shadow.

`[needs: 1.1]`

---

#### Task 1.7 — Build `Field`, `Input`, `Textarea` components

**Files:** `src/components/ui/field.tsx` (new), update `src/components/ui/input.tsx`, create `src/components/ui/textarea.tsx` if no shared textarea exists

1. `Field`: wrapper rendering label (13px 500 weight) + child input + optional hint/error text (12px, `--c-claret` for errors).
2. `Input`: height 34px, `--c-line-2` border, `--r-md` radius. Focus: border changes to `--c-orange`, adds `0 0 0 3px var(--c-orange-soft)` box-shadow ring.
3. `Textarea`: padding 12px horizontal / 14px vertical. Same border and focus treatment as Input.
4. Preserve existing `Input` export shape so current forms compile while they are restyled page by page.

**Verification:** Inputs and textareas show correct focus ring in orange.

`[needs: 1.1]`

---

#### Task 1.8 — Build `ToggleChip` and `Segmented` components

**Files:** `src/components/ui/toggle-chip.tsx` (new), `src/components/ui/segmented.tsx` (new)

**ToggleChip:**
1. Inline pill toggle, height 30px, radius 5px.
2. Off: `--c-card-raised` bg, `--c-ink-2` text, `--c-line-2` border.
3. On: platform tint bg + platform-colour text and border (for platform variants), or `--c-orange` border for generic variants.
4. Used for platform selection in Create flows.

**Segmented:**
1. Inline tab-bar control. Track: `--c-paper-2` bg, `--r-md` radius.
2. Active segment: `#FFF` bg, `--sh-xs` shadow, `--c-line-2` border.
3. Options passed as array; active value controlled via prop.
4. Used for Calendar/Agenda, filter states, placement toggles, etc.

**Verification:** Both components toggle correctly with visual state changes.

`[needs: 1.1]`

---

### Wave 1-C: App shell (needs 1.1–1.3 minimum)

#### Task 1.9 — Build `TopRail` component

**File:** `src/components/layout/top-rail.tsx` (new)

1. 52px sticky header. White bg, bottom border `1px solid var(--c-line)`.
2. Left: brand wordmark (orange "C" square + "CheersAI" text) linking to `/planner`.
3. Navigation items: Planner, Create, Campaigns, Library, Reviews, Tournaments, Connections.
4. Active item: `--c-paper-2` background pill, `--c-ink` text, 5px radius, 2px `--c-orange` underline 8px below.
5. Inactive: `--c-ink-3` text, transparent bg, 500 weight.
6. Right side: notification bell (with badge from `notificationCount` prop), venue chip/account button with initials and venue name.
7. Accept `healthSummaries` and `notificationCount` props from the parent layout.

**Verification:** TopRail renders at full width with correct active states at `/planner`.

`[needs: 1.1, 1.3]` `[blocks: 1.10]`

---

#### Task 1.10 — Create canonical navigation config

**File:** `src/config/app-nav.ts` (new)

1. Define `APP_NAV_ITEMS` array: `{ id, label, href, icon }` for all 7 TopRail items.
2. Define `MOBILE_NAV_ITEMS` array: 4 items (Planner, Create, Library, Connections) with `primary` flag on Create.
3. Use these production paths:
   - Planner → `/planner`
   - Create → `/create`
   - Campaigns → `/campaigns`
   - Library → `/library`
   - Reviews → `/reviews`
   - Tournaments → `/dashboard/tournaments`
   - Connections → `/connections`
4. Add active-route matching that treats `/dashboard/tournaments/*` as the Tournaments nav item and never marks `/dashboard` itself as active.
5. Import and use in both `TopRail` and `BottomNav` — no inline nav arrays anywhere else.
6. Delete or redirect `src/config/navigation.ts` if it's no longer the canonical source.
7. Update `src/app/(app)/dashboard/page.tsx` to redirect to `/planner`; Dashboard is no longer a standalone landing page.

**Verification:** Both TopRail and BottomNav read from the same config. `/dashboard` redirects to `/planner`.

`[needs: 1.9]` `[blocks: 1.11]`

---

#### Task 1.11 — Rewrite `AppShell` to use TopRail

**File:** `src/components/layout/app-shell.tsx` (rewrite)

1. Remove `SidebarNav` import and rendering.
2. Remove all sidebar width offset logic (`pl-20`, `pl-[260px]`).
3. Render `TopRail` as sticky header on desktop/tablet.
4. Content area: full-width below the 52px rail. If `TopRail` is `sticky`, do not add duplicate `padding-top`; if `TopRail` is `fixed`, reserve exactly 52px.
5. Mobile (< 640px): show the redesigned `BottomNav` and a compact top header/account affordance where needed so notifications/settings are not unreachable.
6. Keep `healthSummaries` and `notificationCount` props flowing through.

**Verification:** All pages render full-width below the top rail. No sidebar at any viewport.

`[needs: 1.9, 1.10]` `[blocks: 1.12]`

---

#### Task 1.12 — Redesign `BottomNav` for mobile

**File:** `src/components/layout/bottom-nav.tsx` (rewrite)

1. Height 44px (down from 64px).
2. 4 items from `MOBILE_NAV_ITEMS`: Planner, Create (raised circular orange FAB), Library, Connections.
3. Remove Dashboard and Settings from mobile nav.
4. Create button: raised 48px circle with `--c-orange` bg, white `+` icon, positioned to overlap the bar by ~12px.
5. Active item: `--c-orange` icon and text colour.
6. Inactive: `--c-ink-3` icon and text.

**Verification:** Mobile viewport shows 4-item bottom nav with raised Create FAB.

`[needs: 1.10]`

---

### Wave 1-D: Cleanup (after shell is working)

#### Task 1.13 — Remove stale shell components

**Files to delete (after confirming zero remaining imports):**
- `src/components/layout/sidebar-nav.tsx`
- `src/components/layout/Sidebar.tsx`
- `src/components/layout/AppShell.tsx` (uppercase, the stale duplicate)
- `src/components/layout/app-sidebar.tsx`
- `src/components/ui/sidebar.tsx` (shadcn sidebar primitives — only delete if no remaining imports)
- `src/config/navigation.ts` (replaced by `app-nav.ts`)

**Scan commands:**
```bash
rg -l 'sidebar-nav|SidebarNav|app-sidebar|Sidebar\.tsx|sidebar\.tsx|AppShell' src -g '*.{ts,tsx}'
rg -l "from '@/config/navigation'" src -g '*.{ts,tsx}'
```

Delete each file only when its search returns zero results (or only returns itself).

`[needs: 1.11, 1.12]`

---

#### Task 1.14 — Remove ThemeProvider

**Files:**
- `src/components/providers/theme-provider.tsx` — delete
- `src/app/layout.tsx` — remove ThemeProvider import and rendering
- `src/components/providers/app-providers.tsx` — no ThemeProvider wrapper exists currently; leave TanStack Query, ToastProvider, and AuthProvider intact

**Pre-check:** Scan for `useTheme` imports. If any component uses `useTheme()`, either remove the usage or replace it with a no-op before deleting the provider.

```bash
rg -l 'useTheme|ThemeProvider' src -g '*.{ts,tsx}'
```

`[needs: 1.11]`

---

#### Task 1.15 — Strip `dark:` variants from touched files

**Files:** 20 files identified by scan (see spec critical review section). Strip `dark:` prefixed Tailwind classes while touching each file during Phase 2/3 work. For Phase 1, strip them from:
- `src/components/ui/badge.tsx`
- Any component already modified in this phase

Do not do a bulk find-and-replace across all files — strip `dark:` variants incrementally as each file is touched in subsequent tasks.

`[needs: 1.1]`

---

#### Task 1.16 — Update `PageHeader` component

**File:** `src/components/layout/PageHeader.tsx`

1. Remove any `Topbar` or hamburger navigation export — TopRail handles global nav now.
2. Keep the page-title/description/action-button layout for use within page content areas.
3. Update styling to use new tokens (remove any `brand-blue` references, use `--c-ink` for text).

**Verification:** Pages that use `PageHeader` (campaigns, library, reviews, etc.) still render their titles correctly.

`[needs: 1.1]`

---

### Wave 1-E: Global feedback surfaces

#### Task 1.17 — Restyle toast system

**File:** `src/components/providers/toast-provider.tsx` and any toast host/action helpers

1. Bottom-centre toast position.
2. Duration: 3.8s by default.
3. Success toast: `--c-orange` background, white text.
4. Error toast: `--c-claret` background, white text.
5. Info toast: `--c-ink` background, white text.
6. Enter animation: slight upward fade using `--m-base` and `--m-ease`.
7. Preserve the existing public API used by save/approve/reconnect/publish flows.

**Verification:** Trigger success, error, and info toasts from existing actions; each appears bottom-centre and dismisses automatically.

`[needs: 1.1]`

---

#### Task 1.18 — Restyle dialog, sheet, and drawer primitives

**Files:** `src/components/ui/dialog.tsx`, `src/components/ui/sheet.tsx`, `src/components/layout/status-drawer.tsx`

1. Modal backdrop: `rgba(26,24,20,0.5)` plus 8px blur.
2. Modal panel: `--r-xl` radius, `--sh-lg` shadow, scale/fade in with `--m-slow`.
3. Drawers: right-side, 640px max width on desktop, slide in 28px from the right with opacity fade.
4. Preserve Escape close, focus trapping, and existing Radix accessibility behaviour.
5. Use the new tokenized `Card`, `Button`, `Input`, and text styles where these primitives render controls.

**Verification:** Existing status drawer, dialogs, and sheets open/close with correct animation and keyboard behaviour.

`[needs: 1.1, 1.3]`

---

### Phase 1 gate

Run the full verification checklist from the spec before proceeding:

```bash
npm run lint:ci
npm run typecheck
npm run test:ci
npm run build
```

Shortcut: `npm run ci:verify`.

Visual checks at 390px, 768px, and 1440px:
- [ ] TopRail visible on desktop/tablet with correct nav items and active states
- [ ] Mobile bottom nav shows 4 items with raised Create FAB
- [ ] No left sidebar at any viewport
- [ ] Orange is the primary colour throughout
- [ ] IBM Plex Sans is the body font; IBM Plex Mono appears on any existing monospace elements
- [ ] All existing pages render (layout may be rough — page-level work is Phase 2)

---

## Phase 2 — Core pages

**Goal:** Planner, Create, Post detail, and Library match the design pixel-for-pixel.

**Principle:** Preserve existing data contracts — change presentation, not data fetching. Every component that currently fetches from Supabase or calls a server action keeps its data layer intact.

### Wave 2-A: Planner

#### Task 2.1 — Planner page header

**File:** `src/app/(app)/planner/page.tsx` and relevant feature components

1. Replace current header with:
   - Eyebrow: dynamic day/date + "Europe/London"
   - H1: `<span style="color: var(--c-orange)">Month</span> at <Venue>` — 22px, 600 weight
   - Subhead: scheduled / needs-attention / connection-warning counts
2. Right-side controls: image-toggle chip, Calendar/Agenda `Segmented`, Today button, "New post" `Btn` primary.
3. Wire the `Segmented` to toggle between `/planner` and `/planner?view=list`.

**Verification:** Header renders correctly with dynamic data. Segmented toggles view.

`[needs: Phase 1 gate]`

---

#### Task 2.2 — Connection health banner

**File:** `src/features/connections/connection-health-banner.tsx` (new or adapt existing `ConnectionHealthToast`)

1. Persistent `--c-orange-soft` banner below the planner header.
2. Shows when any connection has a warning status (token expiring).
3. Content: platform name, time-to-expiry, Reconnect CTA button, dismiss `x`.
4. Dismissible per-session only (use React state, not localStorage).
5. Reappears on next page load if unresolved.

**Verification:** Banner shows when health data has warnings. Dismisses on click. Returns after navigation.

`[needs: Phase 1 gate]`

---

#### Task 2.3 — Calendar grid

**Files:** `src/features/planner/planner-calendar-v2.tsx`, `src/features/planner/calendar-cell.tsx`, and any remaining active calendar helpers

1. 7-column x 6-row grid.
2. Each day cell: date in display font + weekday eyebrow in top bar, dashed `+` button in top-right linking to `/create`.
3. Adjacent month days at 40% opacity.
4. Today: `box-shadow: inset 0 0 0 2px var(--c-orange)`.
5. Confirm whether `planner-calendar.tsx` is still imported anywhere. If not, delete it or leave it untouched as dead code until cleanup; do not restyle the wrong calendar implementation.
6. Replace all `brand-blue` references with orange tokens.
7. Remove `dark:` variants from touched calendar files.

**Post tiles (media on):**
- Full-width image at 16:10 aspect ratio
- `PlatformDot` in top-left with white ring outline
- Time pill in top-right: 10px IBM Plex Mono, white text, `rgba(16,24,40,0.7)` bg
- Failed posts: `rgba(180,35,24,0.18)` overlay + "Failed" badge centred
- Title below: 11px, 500 weight, ellipsis overflow
- Click → `/planner/[contentId]`

**Post tiles (media off):**
- Compact row: time (mono) + title (ellipsis) + `PlatformDot` + `Status` chip

**Verification:** Calendar renders with correct visual treatment at 1440px. Today cell has orange inset. Post tiles show platform dots and time pills.

`[needs: 1.4, 1.5, Phase 1 gate]`

---

#### Task 2.4 — Agenda view

**File:** `src/features/planner/planner-agenda.tsx` (new or adapt existing)

1. Same header as calendar (shared component from 2.1).
2. Content grouped by day with thin rule separators.
3. Each row: 3-column grid — large monospace time (24px, 600 weight) / title + `Status` chip + caption preview / `PlatformDot` array + "Open" chevron.
4. Failed rows show `Failed` `Status` chip in claret.
5. Click row → post detail.

**Verification:** Agenda view shows grouped posts. Toggle between Calendar and Agenda works.

`[needs: 2.1, 1.4, 1.5]`

---

### Wave 2-B: Post detail

#### Task 2.5 — Post detail (scheduled state)

**File:** `src/app/(app)/planner/[contentId]/page.tsx` (rewrite presentation)

1. 2-column layout, max-width 1200px.
2. Header: back-link breadcrumb, platform/type eyebrow, H1 title, countdown timer.
3. Left card — Caption: mono word count, editable textarea, regenerate / "Try a different angle" ghost buttons.
4. Right card — Preview: mock social post (venue avatar, name, time), caption text, hero image capped at `max-height: 420px`.
5. Below: 3-up grid — Schedule card / Media card / Belongs-to card with micro-actions.
6. Footer: Cancel (danger ghost), Save changes (secondary), Publish now (primary orange).
7. Preserve all existing server actions and data fetching.
8. Remove `dark:` variants from this file.

**Verification:** Scheduled posts render 2-column layout. All action buttons trigger existing server actions.

`[needs: Phase 1 gate]`

---

#### Task 2.6 — Post detail (failed state)

**File:** Same as 2.5 — conditional rendering based on post status

1. Recovery card at top: large `--c-claret-soft` icon disc, plain-English heading and explanation.
2. Three action buttons: Reconnect [Platform] (primary), Try again now (secondary), Download copy & image (ghost).
3. Dashed-rule footer: last-attempt timestamp, error code, "Show provider response" disclosure revealing raw JSON.
4. Preserve existing retry/reconnect server action wiring.

**Verification:** Failed posts show recovery card. "Show provider response" toggles JSON disclosure.

`[needs: 2.5]`

---

### Wave 2-C: Create flows

#### Task 2.7 — Create launcher

**File:** `src/app/(app)/create/page.tsx` (rewrite presentation)

1. 2x2 grid of large card-buttons.
2. Each tile: 24px padding, 16px radius, 44x44 icon block with `--c-orange-soft` bg.
3. h3 (26px), 14px description, auto-bottom eyebrow with meta text.
4. Hover: lift to `--sh-md` shadow, border shifts to `--c-orange`.
5. Click routes to `/create?flow=instant|event|promotion|weekly`.
6. If current page already has `?draft=` handling, preserve it — the launcher only shows when no draft/flow is active.

**Verification:** 4 tiles render. Clicking each navigates to correct `?flow=` URL.

`[needs: Phase 1 gate]`

---

#### Task 2.8 — Instant post composer

**File:** `src/features/create/` (adapt existing create flow components)

1. 2-column: form (760px left) + live preview (sticky right).
2. Form fields: brief textarea (240 char counter), Feed/Story `Segmented`, Publish now/Schedule `Segmented`, platform `ToggleChip` array, media drop grid, "+ More options" disclosure.
3. Submit: "Draft posts" primary → 1.6s spinner ("Writing drafts…") → route to `/create/review/[draftId]`.
4. Preview: mock Facebook post card with live caption, word count hint.
5. Preserve existing AI generation server actions and media upload logic.
6. Handle both `?flow=instant` (new) and `?draft=` (resume) without conflict.

**Verification:** Full form flow works end-to-end. Preview updates live. Submit triggers AI generation.

`[needs: 2.7, 1.8]`

---

#### Task 2.9 — Event / Promotion / Weekly forms

**Files:** Same feature directory, sibling form components

1. Three forms sharing layout patterns: breadcrumb back to `/create`, eyebrow + h1, single-column form `Card`, cadence preview section.
2. Event: shows 4-slot timeline of what will be scheduled.
3. Promotion: shows announcement / mid-run / last-chance cadence.
4. Weekly: shows "we'll write 12 posts every Thursday…" preview.
5. Footer: Cancel ghost + primary "Draft N posts" button → `/create/review/[draftId]`.
6. Preserve existing form data contracts and server actions.

**Verification:** Each form renders with correct cadence preview. Submit routes to review.

`[needs: 2.7]`

---

#### Task 2.10 — Review and approve page

**File:** `src/app/(app)/create/review/` or existing review flow

1. Stack of `PostCard`s, one per generated draft.
2. Each card: platform dot + name + type chip + status chip header, hero thumbnail (160px) + caption + word count body, Edit/Swap/Regenerate ghost buttons + Approve primary footer.
3. Sticky bottom action bar: "X of Y approved" count, Save as drafts secondary, "Approve all & publish" primary.
4. On publish: toast + route back to planner.
5. If durable `draftId` doesn't exist yet, use persisted content item IDs as route param.

**Verification:** Generated drafts display. Individual approve and bulk approve work. Published posts appear on planner.

`[needs: 2.8]`

---

### Wave 2-D: Library

#### Task 2.11 — Library page

**File:** `src/app/(app)/library/page.tsx` and `src/features/library/` (rewrite presentation)

1. Header: total count + storage usage display.
2. Filter bar: All / Images / Video `Segmented` + horizontal scrollable tag pills.
3. Grid: 4 columns. First tile is upload drop-zone (dashed border, "+ Drop or upload").
4. Asset cards: thumbnail image, "Used x N" pill in top-right, label + tag micro-line at bottom.
5. Preserve existing media upload, delete, and tag server actions.
6. Remove `dark:` variants if present.

**Verification:** Library renders with upload zone and filters. Upload works. Tags filter correctly.

`[needs: Phase 1 gate, 1.8]`

---

### Phase 2 gate

```bash
npm run lint:ci
npm run typecheck
npm run test:ci
npm run build
```

Shortcut: `npm run ci:verify`.

Visual checks at 390px, 768px, and 1440px:
- [ ] Planner calendar matches design screenshots
- [ ] Planner agenda matches design screenshots
- [ ] Post detail (scheduled + failed) matches design
- [ ] Create launcher shows 2x2 tiles
- [ ] Instant post form has live preview
- [ ] Event/Promo/Weekly forms render cadence previews
- [ ] Review page shows post cards with approve flow
- [ ] Library shows grid with upload and filters
- [ ] All data flows (fetch, create, update, delete) still work

---

## Phase 3 — Extended pages

**Goal:** Every remaining page matches the design. Mobile responsive polish.

**Principle:** Each task is a self-contained page restyle. No task should break another page. Preserve all existing data mutations and authentication flows.

### Wave 3-A: Operations pages

#### Task 3.1 — Campaigns dashboard

**File:** `src/app/(app)/campaigns/page.tsx` and `src/features/campaigns/CampaignDashboard.tsx`

1. 4-up KPI strip: Active spend, Reach 30d, Bookings attributed, Variants in flight.
2. `Segmented` filter: All / Active / Drafts / Completed.
3. Campaign rows: grid layout with name/status/meta, budget, spent % bar, reach/clicks, Open button.
4. Preserve existing `getCampaignDashboard()` and `getAdAccountSetupStatus()` data fetching.
5. Preserve the "Meta Ads not connected" amber banner.
6. Remove `dark:` variants.

**Verification:** Dashboard renders with KPI strip and campaign rows. Data matches existing.

`[needs: Phase 2 gate]`

---

#### Task 3.2 — Campaign detail

**File:** `src/app/(app)/campaigns/[id]/page.tsx` and related feature components

1. 3-column layout (240px / 1fr / 360px).
2. Left: phases/variants tree with collapsible groups and approval states.
3. Centre: variant form — Headline (40 char), Primary text (125 char), Description (25 char), Creative brief, Creative picker (6-up grid).
4. Right (sticky): mock Facebook ad preview + "Placement & spend" card.
5. AI Rationale as editorial side-note (3px `--c-ink` left rule), not a hero banner.
6. Preserve all existing variant edit and creative upload server actions.
7. Remove `dark:` variants from this file and `recurring-controls.tsx`.

**Verification:** 3-column layout renders. Variant editing and creative selection work.

`[needs: 3.1]`

---

#### Task 3.3 — Reviews page

**File:** `src/app/(app)/reviews/page.tsx` and feature components

1. Header with refresh button.
2. 4-up KPI strip: Average rating, Total reviews, Awaiting reply, Avg response time.
3. `Segmented`: All / Awaiting reply (count) / Replied.
4. Review cards: 5-star row, author, timestamp, "Needs care" chip (if ≤ 3 stars), review body.
5. Posted replies: success-tinted card.
6. AI-drafted replies: dashed `--c-orange-hi` border, Edit / Post reply buttons, "Try a different angle" button.
7. Preserve existing review fetch and reply server actions.

**Verification:** Reviews render with AI drafts. Post reply works.

`[needs: Phase 2 gate]`

---

### Wave 3-B: Social and settings pages

#### Task 3.4 — Connections page

**File:** `src/app/(app)/connections/page.tsx` and feature components

1. 3 large connection rows: Facebook, Instagram, GBP.
2. Each row: `Card` with `PlatformDot` (48px), name, status (Connected / Expiring / Needs action), sub-label.
3. Action buttons: Refresh + Disconnect (connected), or Reconnect-now primary (warning).
4. Detail strip: token expiry, last published, default page name.
5. Bottom: info card on token refresh policy.
6. Preserve existing OAuth and token refresh server actions.
7. Remove `dark:` variants.

**Verification:** Connection statuses display correctly. OAuth reconnect flow works.

`[needs: Phase 2 gate, 1.5]`

---

#### Task 3.5 — Settings page (5-tab layout)

**File:** `src/app/(app)/settings/page.tsx` and `src/features/settings/` components

1. 5-tab layout: sticky left nav (220px), tab content right. Tab held in URL as `?tab=`.
2. **Brand voice** (default): 3 sliders (Tone / Length / Emoji use), "Words we always use" tag input, live preview card.
3. **Posting defaults**: timezone, default post time, quiet hours, default GBP CTA `Segmented`, default IG hashtags, auto-publish toggle.
4. **Venue details**: logo upload, display name, short pitch (counter), phone, WhatsApp, URLs, link-in-bio preview link.
5. **Notifications**: matrix table (event x Email/Push/SMS) with toggle switches.
6. **Account & security**: email, display name, password change, passkey, sessions, Delete account danger zone.
7. Preserve existing brand voice, posting defaults, and venue settings server actions.
8. Move existing management connection and link-in-bio editor controls into Venue details tab if they don't fit elsewhere.
9. Remove `dark:` variants.

**Verification:** All 5 tabs render. Settings save correctly. Deep-linking via `?tab=` works.

`[needs: Phase 2 gate]`

---

### Wave 3-C: Tournaments

#### Task 3.6 — Tournaments list

**File:** `src/app/(app)/dashboard/tournaments/page.tsx` and feature components

1. 2-up card grid. Each card: season eyebrow, name (h3), "Auto-posting" success chip, big-number row (next fixture time + upcoming posts count), fixture rows, footer with manage/pause buttons.
2. Preserve existing tournament data fetching and auto-posting toggle server actions.

**Verification:** Tournament cards render. Auto-posting toggle works.

`[needs: Phase 2 gate]`

---

#### Task 3.7 — Tournament detail

**File:** `src/app/(app)/dashboard/tournaments/[id]/page.tsx` and feature components

1. Full standings table (rank / team / W-L / points) with first place highlighted success-tinted.
2. Fixture list below. "Next" fixture row highlighted `--c-orange-soft`.
3. Preserve existing standings, fixture editing, and score entry server actions.

**Verification:** Standings table and fixture list render. Score entry works.

`[needs: 3.6]`

---

### Wave 3-D: Supporting pages

#### Task 3.8 — Notifications feed

**File:** `src/app/(app)/planner/notifications/page.tsx`

1. Linear feed grouped by recency.
2. Each row: tone-coloured circle icon (alert/fail/ok/review/info), title, body, timestamp, optional action button.
3. Unread rows: 3px left border in tone colour.
4. Action buttons navigate to relevant pages.
5. Preserve existing notification fetch and mark-read server actions.
6. Remove `dark:` variants.

**Verification:** Notifications render with correct tones. Mark-read works. Action buttons navigate.

`[needs: Phase 2 gate]`

---

#### Task 3.9 — Login page

**File:** `src/app/(auth)/login/page.tsx`

1. Full-bleed split-screen (1fr / 1fr).
2. Left panel: `--c-ink` bg, brand mark, display headline, paragraph, testimonial card at bottom.
3. Right panel: email field, "Send magic link" primary lg full-width, "OR" divider, "Continue with Google" secondary, "Continue with passkey" secondary, footer microcopy.
4. Preserve existing magic-link auth flow (`/api/auth/magic-link`).
5. `/auth/login` already redirects via `permanentRedirect('/login')` — keep that.
6. Remove `dark:` variants.

**Verification:** Login renders split-screen. Magic link sends. Redirects work.

`[needs: Phase 2 gate]`

---

#### Task 3.10 — Link-in-bio public page

**File:** `src/app/(public)/l/[slug]/page.tsx` and `src/features/link-in-bio/public/`

1. No app shell. Stack: hero image (200px), avatar disc (90px, overlapping), venue name, tagline, "Open now" chip.
2. Action tiles: Book (primary orange), Menu, What's on, Call, Find us (secondary). Each has icon, label, sub-label, right chevron.
3. Social row (3 platform dots, 36px) + "Powered by CheersAI" footer.
4. Keep existing `/link-in-bio` authenticated editor route — restyle separately or fold into Settings.

**Verification:** Public page renders without app chrome. All action links work.

`[needs: Phase 2 gate]`

---

#### Task 3.11 — Help page

**File:** `src/app/help/[[...slug]]/page.tsx`

1. Search input, 3 FAQ sections using `<details>`/`<summary>`, optional "Take me there" deep-links, footer links to Terms/Privacy/version.
2. Keep legacy slug redirects to `/help`.
3. Static content — no data fetching required.

**Verification:** Page renders. FAQ sections expand/collapse.

`[needs: Phase 2 gate]`

---

#### Task 3.12 — Legal pages

**Files:** `src/app/terms/page.tsx`, `src/app/(public)/privacy/page.tsx`

1. Clean editorial layout: 18px body text, 1.55 line-height, max-width ~720px centred.
2. Cross-links between Terms and Privacy.
3. Keep existing route structure (separate pages, not `?doc=` param).

**Verification:** Both pages render with editorial styling.

`[needs: Phase 2 gate]`

---

### Wave 3-E: Mobile responsive polish

#### Task 3.13 — Mobile planner

**File:** `src/features/planner/` mobile-specific components or responsive additions

1. Week-strip date selector at top: 7 days, current day in solid orange circle.
2. Stacked post cards instead of calendar grid.
3. Each card: time, title, platform dots, status chip.
4. Sticky "New post" CTA at bottom above the bottom nav.

**Verification:** At 390px, planner shows week strip and stacked cards. Scrolling and date selection work.

`[needs: 2.3, 2.4]`

---

#### Task 3.14 — Mobile create

**Files:** Create flow components

1. Single-column form layout (no side preview on mobile).
2. Sticky bottom CTA button.
3. Media grid collapses to 2 columns.

**Verification:** At 390px, create form is single column with sticky CTA.

`[needs: 2.8]`

---

#### Task 3.15 — Mobile responsive sweep

All remaining pages: at 640px and below, ensure:
1. Multi-column layouts collapse to single column.
2. Cards go full-width.
3. Grid layouts (campaigns, library, tournaments) reduce column count.
4. Settings tabs switch from side-nav to top tabs or stacked accordion.
5. Tables become scrollable horizontally or switch to card layout.

**Verification:** Visual check at 390px for every page route.

`[needs: all Wave 3-A through 3-D tasks]`

---

### Phase 3 gate

```bash
npm run lint:ci
npm run typecheck
npm run test:ci
npm run build
```

Shortcut: `npm run ci:verify`.

Visual checks at 390px, 768px, and 1440px against bundled reference screenshots:
- [ ] Every page listed in the route map renders correctly
- [ ] All data flows (fetch, create, update, delete) still work
- [ ] OAuth reconnect flows work
- [ ] Login → auth → protected routes work end-to-end
- [ ] Mobile bottom nav and responsive layouts work
- [ ] No console errors
- [ ] No `dark:` Tailwind variants remain in modified files
- [ ] No `brand-blue` or `#1d4ed8` hex values remain in modified files

---

## Summary

| Phase | Tasks | Key deliverable |
|-------|-------|----------------|
| **1** | 18 tasks | Design system + app shell + global feedback surfaces — instant visual identity change |
| **2** | 11 tasks | Planner, Create, Post detail, Library — daily-use pages |
| **3** | 15 tasks | Everything else + mobile polish — full coverage |
| **Total** | **44 tasks** | Complete redesign |

Backend logic, data layer, server actions, auth, and API routes are untouched throughout the app-redesign plan above. The Tournament Overlay Addendum below is the only exception because the original bundle includes separate rendered-content design docs that target `src/lib/tournament/*`.

---

## Tournament Overlay Addendum

**Use this addendum only if the implementation scope includes every design artifact in the original `/cheersai 2` bundle, not just the primary app redesign handoff.**

Source files:
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/cheersai 2/project/Tournament Overlay Plan.html`
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/cheersai 2/project/Tournament Overlay A - Spec.html`

The selected direction is **A · Editorial Stack**. It keeps the current Satori → SVG → Sharp composite pipeline, but changes the overlay layout and supporting tournament fixture data hygiene.

### Wave T-A: Overlay renderer and data hygiene

#### Task T.1 — Patch tournament overlay renderer

**File:** `src/lib/tournament/overlay.ts`

1. Implement Direction A · Editorial Stack from `Tournament Overlay A - Spec.html`.
2. Preserve both Instagram Post (1:1) and Story (1080/1920) output formats.
3. Use stacked team names, italic gold `vs` pivot, round eyebrow, date/kick-off strap, and CTA pinned above the pitch curve.
4. Add optional overlay data fields from the spec, including fixture time/date display and booking CTA data.
5. Remove the `houseRulesText` branch from the overlay; route that message to the caption template instead.
6. Use `container-type: size` equivalent sizing rules in Satori terms so vertical anchors resolve against the frame.

**Verification:** Render Post and Story examples against `assets/template-post.png` and `assets/template-story.png`; output remains legible and aligned.

---

#### Task T.2 — Add team display abbreviation helper

**File:** `src/lib/tournament/team-display.ts` (new or existing tournament display helper)

1. Add a small abbreviation dictionary for long team/country names.
2. Apply abbreviations at the data/display layer, not inside the renderer.
3. Names longer than 11 chars get a known abbreviation where available.
4. Ensure the renderer only receives display-ready `teamAName` / `teamBName` values.

**Verification:** Stress cases from the spec (long country names) fit without overlap in Story output.

---

#### Task T.3 — Fix round/group label data hygiene

**Files:** `src/lib/tournament/generate.ts`, fixture form/server actions, Supabase migration if persisted rows need cleanup

1. Patch round label formatting so it never produces `GROUP GROUP B`.
2. Normalise `groupName` at write time on fixture forms/actions.
3. Backfill existing `tournament_fixtures.group_name` rows if current data includes prefixed values.
4. Keep fixture captions plain and human-readable.

**Verification:** Existing and newly-created fixtures render exactly one group prefix.

---

#### Task T.4 — Overlay regression tests and visual QA

**Files:** tournament overlay tests, snapshot fixtures, generated example outputs

1. Regenerate overlay snapshots for Post and Story.
2. Add tests for long names, missing CTA URL, group-stage labels, knockout labels, and both output ratios.
3. QA against the Anchor templates and at least one non-Anchor/high-contrast background.
4. If Direction A fails on busy backgrounds, document when to use Direction D · Scoreboard as fallback.

**Verification:** Tournament overlay tests pass and rendered examples match Direction A from the original bundle.

### Addendum Summary

| Addendum | Tasks | Key deliverable |
|----------|-------|----------------|
| **T** | 4 tasks | Tournament fixture overlay redesign from original bundle extras |

If included, total implementation scope becomes **48 tasks**: 44 app-redesign tasks plus 4 tournament-overlay tasks.
