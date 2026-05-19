# CheersAI 2.0 — Visual Redesign Spec

> Source: Claude Design handoff bundle at `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/cheersai 2/project/design_handoff_cheersai_redesign`
> Status: Not yet implemented — current codebase uses the pre-redesign blue/sidebar design system

---

## Source of truth

The interactive prototype is the source of truth for visual fidelity and behaviour:

```
/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/cheersai 2/project/design_handoff_cheersai_redesign/CheersAI Prototype.html
```

Use these files in order when implementing or resolving ambiguity:

1. `CheersAI Prototype.html` — runtime behaviour, transitions, page states, route flow
2. `CheersAI Design System.html` — side-by-side visual comparison
3. `tokens.css` — canonical token values
4. `components.jsx` — reference component APIs and visual treatment
5. `screens-*.jsx` — page-level layout details
6. `screenshots/*.jpg` — static regression references

This spec is an implementation map for the existing Next.js app. If this document conflicts with the prototype or token/component source files, fix this spec rather than copying the conflict into production.

### Original bundle validation

The top-level original brief at `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/cheersai 2/README.md` explicitly points coding agents to `project/design_handoff_cheersai_redesign/README.md` as the primary source. The duplicate app-redesign files in `project/` match the `design_handoff_cheersai_redesign/` versions byte-for-byte.

The parent bundle also contains two extra tournament overlay documents outside the primary handoff:

- `project/Tournament Overlay Plan.html`
- `project/Tournament Overlay A - Spec.html`

Those files describe a rendered tournament fixture image overlay redesign (`src/lib/tournament/*`), not the app shell/page redesign covered by Phases 1-3 below. They are tracked in `docs/redesign-plan.md` as a separate Tournament Overlay Addendum if the implementation scope is "everything in the original bundle path."

---

## Critical review — 2026-05-19

The original draft is directionally useful, but it had several implementation-critical gaps and a few direct mismatches with the handoff bundle.

### Blocking corrections

1. **Design-token drift:** The draft listed old platform colours (`#1877F2`, `#E1306C`, `#4285F4`), a 14px body default, 20px default card padding, and simplified shadows. The handoff uses the token values in `tokens.css`: Facebook `#1B4DB1`, Instagram `#B72A6B`, GBP `#1C7C43`, body 13px, card padding 14px, and the two-layer shadow values. These are corrected below.
2. **Component mismatches:** `PlatformDot` was described as a solid platform circle with white icon and 28px default. The prototype uses a tinted circle with a solid-colour glyph and an 18px default. `Status` includes a dot and `publishing` pulse. `TopRail` active state uses a grey active pill plus orange underline, not orange text only. These are corrected below.
3. **Route mismatches:** The current app already has public `/l/[slug]` and a legacy `/auth/login` redirect to canonical `/login`. The redesign should restyle `/login`, keep `/l/[slug]` public and outside app chrome, and decide what to do with the existing authenticated `/link-in-bio` editor route.
4. **Repo shell complexity:** The active protected layout imports `src/components/layout/app-shell.tsx`, which renders `SidebarNav` plus `BottomNav`. There is also an older `src/components/layout/AppShell.tsx`, `Sidebar.tsx`, `PageHeader.tsx` topbar code, and a shadcn `components/ui/sidebar.tsx`. Phase 1 must retire or quarantine these parallel shells deliberately so stale sidebar code cannot keep driving routes.
5. **Navigation source ambiguity:** `src/config/navigation.ts` exists but the active `SidebarNav`, `BottomNav`, and `PageHeader` define nav items inline. The redesign should create one canonical `APP_NAV_ITEMS` config for TopRail and mobile nav, then delete or update the inline copies.
6. **Scope risk:** Phase 3 is too broad to treat as a visual-only pass. Settings, reviews, tournaments, link-in-bio, help/legal, and login already have production data and route constraints. Preserve working data mutations and authentication, then swap layout/component presentation incrementally.

### Implementation decisions locked by this review

- Treat `tokens.css` and `components.jsx` as canonical for design-system values.
- Keep the redesign light-only and remove `ThemeProvider` plus `.dark` styling only after confirming no production-only state depends on the provider.
- Use `/login` as the canonical auth route; keep existing legacy redirects.
- Keep `/l/[slug]` as the public link-in-bio route; keep or restyle `/link-in-bio` only as the authenticated editor/preview surface.
- The active protected shell is `src/components/layout/app-shell.tsx`; update that path first.
- Verify with screenshots at 390px, 768px, and 1440px against the bundled reference stills.

---

## Overview

This spec covers the full visual and structural overhaul of CheersAI from its current generic Tailwind/shadcn admin shell (dark left sidebar, blue primary, Plus Jakarta Sans / Sora fonts) to the new design: a slim white top-rail navigation, orange-on-grey corporate palette, IBM Plex Sans / IBM Plex Mono typography, and dense, action-oriented page layouts.

The redesign is broken into **3 phases**:

| Phase | Scope | What ships |
|-------|-------|-----------|
| **1 — Foundation** | Design tokens, fonts, core components, app shell | New chrome wrapping existing pages — everything looks new immediately |
| **2 — Core pages** | Planner, Create flows, Post detail, Library | The daily-use surfaces match the design pixel-for-pixel |
| **3 — Extended pages** | Campaigns, Reviews, Settings, Connections, Tournaments, Notifications, Login, Link-in-bio, Help/Legal, Mobile responsive | Full coverage |

Each phase is independently deployable. Phase 1 alone gives the app its new identity; phases 2 and 3 progressively upgrade individual pages.

---

## Phase 1 — Foundation

**Goal:** Replace the design system layer so the entire app immediately adopts the new visual identity. No page-level layout changes yet — this phase changes how things look, not where things are.

### 1.1 Design tokens

Replace the current CSS custom properties in `globals.css` with the new token set. Remove dark mode tokens (the redesign is light-only).

#### Surfaces (cool neutral greys)

| Token | Hex | Use |
|-------|-----|-----|
| `--c-paper` | `#F6F7F9` | App background |
| `--c-paper-2` | `#EEF0F3` | Recessed surfaces, table headers, segmented track |
| `--c-card` | `#FFFFFF` | Standard card background |
| `--c-card-raised` | `#FFFFFF` | Elevated card (with shadow) |

#### Text and lines

| Token | Hex | Use |
|-------|-----|-----|
| `--c-ink` | `#101828` | Primary text |
| `--c-ink-2` | `#344054` | Secondary text |
| `--c-ink-3` | `#667085` | Tertiary, captions, meta |
| `--c-ink-4` | `#98A2B3` | Placeholder, disabled |
| `--c-line` | `#E4E7EC` | Hairline borders |
| `--c-line-2` | `#D0D5DD` | Stronger borders (inputs) |

#### Brand (orange) — replaces current blue primary

| Token | Hex | Use |
|-------|-----|-----|
| `--c-orange` | `#DC6803` | Primary action, brand mark, active-state accents |
| `--c-orange-hi` | `#B54708` | Hover / pressed |
| `--c-orange-lo` | `#93370D` | Deep pressed |
| `--c-orange-soft` | `#FEF0C7` | Tinted background for chips, alerts |
| `--c-orange-tint` | `#FFFAEB` | Subtle background highlight |

Prototype aliases `--c-amber` and `--c-forest` exist only for older screen files. In production, replace amber references with `--c-orange*` and forest references with either `--c-ink*` or explicit success/status tokens.

#### Semantic / status

| Token | Hex | Use |
|-------|-----|-----|
| `--c-claret` | `#B42318` | Failure, urgent, destructive |
| `--c-claret-soft` | `#FEE4E2` | Failure background |
| `--c-status-posted-fg` / `-bg` | `#027A48` / `#D1FADF` | Posted (success) |
| `--c-status-publishing-fg` / `-bg` | `#B54708` / `#FEF0C7` | Publishing / queued |
| `--c-status-scheduled-fg` / `-bg` | `#344054` / `#EAECF0` | Scheduled |
| `--c-status-draft-fg` / `-bg` | `#475467` / `#F2F4F7` | Draft |
| `--c-status-failed-fg` / `-bg` | `#B42318` / `#FEE4E2` | Failed |

#### Platform colours (for `PlatformDot`, `ToggleChip`, chips, and charts)

These must match `tokens.css`; do not use the brighter consumer-brand defaults from the first draft.

| Token | Hex | Use |
|-------|-----|-----|
| `--c-fb` | `#1B4DB1` | Facebook solid |
| `--c-fb-bg` | `#DDE7F5` | Facebook tint |
| `--c-ig` | `#B72A6B` | Instagram solid |
| `--c-ig-bg` | `#F8DEEA` | Instagram tint |
| `--c-gbp` | `#1C7C43` | Google Business Profile solid |
| `--c-gbp-bg` | `#DCEDE2` | Google Business Profile tint |

#### Radius — smaller, more square than current

| Token | Size | Use |
|-------|------|-----|
| `--r-xs` | 3px | Inline badges |
| `--r-sm` | 4px | Small chips, tags, tiny buttons |
| `--r-md` | 6px | Inputs, sm/md buttons |
| `--r-lg` | 8px | Cards, panels, lg buttons |
| `--r-xl` | 12px | Modals, large surfaces |
| `--r-2xl` | 16px | Sheets |
| `--r-pill` | 999px | Status chips, count badges only |

#### Shadow

| Token | Value | Use |
|-------|-------|-----|
| `--sh-xs` | `0 1px 0 rgba(16,24,40,0.04)` | Segmented active state, tiny lift |
| `--sh-sm` | `0 1px 2px rgba(16,24,40,0.06)` | Cards |
| `--sh-md` | `0 4px 8px -2px rgba(16,24,40,0.10), 0 2px 4px -2px rgba(16,24,40,0.06)` | Hover-lift, raised cards |
| `--sh-lg` | `0 12px 24px -4px rgba(16,24,40,0.10), 0 4px 8px -2px rgba(16,24,40,0.05)` | Modals, dropdowns |
| `--sh-inset` | `inset 0 1px 0 rgba(255,255,255,0.12)` | Primary button top edge |

#### Space (reference scale)

Use the `tokens.css` names, not the draft-only `--sp-*` aliases:

`--s-1` through `--s-24`: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96px. Tailwind utility classes can express most of these directly.

Density defaults:
- Card padding: 14px
- Form field gap: 16px
- Page/section gap: 24-32px

#### Motion

| Token | Value | Use |
|-------|-------|-----|
| `--m-fast` | 100ms | Hover, focus |
| `--m-base` | 160ms | State changes |
| `--m-slow` | 260ms | Modal, drawer enter |
| `--m-ease` | `cubic-bezier(0.2, 0.7, 0.2, 1)` | Easing curve |

#### Semantic mapping

Bridge the new tokens to the existing shadcn/Tailwind semantic variables so existing components pick up the new palette without individual file changes:

| Existing semantic var | New value |
|-----------------------|-----------|
| `--background` | `var(--c-paper)` / `#F6F7F9` |
| `--foreground` | `var(--c-ink)` / `#101828` |
| `--card` | `var(--c-card)` / `#FFFFFF` |
| `--card-foreground` | `var(--c-ink)` / `#101828` |
| `--primary` | `var(--c-orange)` / `#DC6803` |
| `--primary-foreground` | `#FFFFFF` |
| `--secondary` | `var(--c-paper-2)` / `#EEF0F3` |
| `--secondary-foreground` | `var(--c-ink)` / `#101828` |
| `--muted` | `var(--c-paper-2)` / `#EEF0F3` |
| `--muted-foreground` | `var(--c-ink-3)` / `#667085` |
| `--accent` | `var(--c-orange-tint)` / `#FFFAEB` |
| `--accent-foreground` | `var(--c-orange)` / `#DC6803` |
| `--destructive` | `var(--c-claret)` / `#B42318` |
| `--destructive-foreground` | `#FFFFFF` |
| `--border` | `var(--c-line)` / `#E4E7EC` |
| `--input` | `var(--c-line-2)` / `#D0D5DD` |
| `--ring` | `var(--c-orange)` / `#DC6803` |
| `--radius` | `6px` |

Tailwind v4 note: update `@theme inline` in `src/app/globals.css` so Tailwind utilities expose the new semantic colours, `--font-sans`, `--font-heading`, `--font-mono`, radius tokens, and shadow tokens. Do not leave `--brand-blue`, `--sidebar-*`, or `--font-sora` mapped into active theme variables.

### 1.2 Typography

Replace **Plus Jakarta Sans** and **Sora** with **IBM Plex Sans** (body, headings) and **IBM Plex Mono** (data, timestamps, counts).

Changes in `layout.tsx`:
- Remove `Plus_Jakarta_Sans` and `Sora` imports from `next/font/google`
- Add `IBM_Plex_Sans` (weights 400, 500, 600, 700) and `IBM_Plex_Mono` (weights 400, 500, 600)
- Update CSS variables: `--font-sans` and `--font-heading` both point to IBM Plex Sans; add `--font-mono` for IBM Plex Mono

Type scale (reference — use in components, not as global overrides):

| Role | Size | Weight | Font |
|------|------|--------|------|
| Page title (h1) | 22px | 600 | IBM Plex Sans |
| Section head (h2) | 16-18px | 600 | IBM Plex Sans |
| Eyebrow | 10px uppercase, 0.08em tracking | 600 | IBM Plex Sans |
| Body | 13px | 400 | IBM Plex Sans |
| Small / caption | 12–13px | 400–500 | IBM Plex Sans |
| Mono data | 10–14px | 400–500 | IBM Plex Mono |

Add global utility classes:

```css
.eyebrow {
  font-family: var(--font-sans);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 600;
  color: var(--c-ink-3);
}

.mono {
  font-family: var(--font-mono);
  font-feature-settings: "ss01";
}
```

Global base rules:
- Body letter spacing: `-0.003em`
- Headings letter spacing: `-0.01em`
- Avoid negative Tailwind tracking utilities beyond those explicit base rules

### 1.3 Core components

Build or adapt these components to match the design spec. These are used across every page.

#### `Btn` — primary action element

Replace or extend the current `button.tsx` with the redesign's variant system.

| Variant | Height (md) | Background | Text | Border |
|---------|-------------|------------|------|--------|
| `primary` | 32px | `--c-orange` | `#FFF` | `--c-orange-hi` |
| `amber` | 32px | `--c-orange` | `#FFF` | `--c-orange-hi` |
| `secondary` | 32px | `#FFF` | `--c-ink` | `--c-line-2` |
| `ghost` | 32px | transparent | `--c-ink-2` | transparent |
| `danger` | 32px | `#FFF` | `--c-claret` | `--c-line-2` |
| `inkInverse` | 32px | `--c-ink` | `#FFF` | `--c-ink` |

`amber` is a prototype compatibility alias for `primary`; new production code should prefer `primary`, but the component can support both during porting.

Sizes: `sm` 26px / `md` 32px / `lg` 40px height. Radius 5 / 6 / 8px respectively. Font sizes 12 / 13 / 14px.

Props: `variant`, `size`, `icon` (left), `iconRight`, `full` (full-width), standard button props. Use Lucide icons in production and map prototype icon names where needed.

#### `Chip` and `Status`

`Chip` is a generic pill for neutral, claret, orange, and platform-tinted metadata.

`Status` is the publishing status chip. It renders a coloured dot + label inside a pill and uses the semantic status token pairs (fg/bg) from the token table above. The `publishing` dot pulses at 1.4s.

Statuses: `posted`, `publishing`, `scheduled`, `draft`, `failed`.

#### `PlatformDot` — circular platform avatar

Tinted circle with platform-colour icon. Default 18px, configurable via `size` prop. Used in post tiles, connection cards, and review headers.

Platforms: `fb`, `ig`, `gbp`. Use the solid/tint token pairs above.

#### `Card`

White background, `--r-lg` radius (8px), `1px solid var(--c-line)` border. `raised` prop adds `--sh-sm` shadow. Configurable `padding` (default 14px).

#### `Field` / `Input` / `Textarea`

`Field` wraps a label + input + optional hint/error. `Input` height 34px, `Textarea` padding 12/14px. Border `--c-line-2`, radius 6px. Focus state: border lifts to `--c-orange` with `0 0 0 3px var(--c-orange-soft)` shadow ring.

#### `ToggleChip`

Inline pill toggle. Height 30px, radius 5px. Off: `--c-card-raised` bg, `--c-ink-2` text, `--c-line-2` border. On: platform tint + platform-colour text/border, or orange border for non-platform variants. Used for platform selection in Create flows.

#### `Segmented`

Inline tab-bar control. Track background `--c-paper-2`, active segment `#FFF` with `--sh-xs` shadow and a subtle `--c-line-2` border. Used for Calendar/Agenda toggle, filter states, etc.

#### `TopRail` — the new app shell header

52px sticky header replacing the current left sidebar. White background, bottom border `1px solid var(--c-line)`.

Layout: `display: flex; align-items: center; justify-content: space-between; padding: 0 20px`.

Left side:
- Brand wordmark (orange "C" square + "CheersAI") — links to `/planner`
- Navigation items as text links: Planner, Create, Campaigns, Library, Reviews, Tournaments, Connections
- Active item: `var(--c-paper-2)` background pill, `var(--c-ink)` text, 5px radius, and 2px orange underline positioned 8px below the item
- Inactive: `var(--c-ink-3)` text, transparent background, 500 weight

Right side:
- Notification bell icon (with count badge if > 0)
- Venue chip/account menu button with initials, venue name, and chevron; route to `/settings` until a full account menu exists

### 1.4 App shell restructure

**Active path to change first:** `src/components/layout/app-shell.tsx` is the protected app shell used by `src/app/(app)/layout.tsx`.

**Remove:** `SidebarNav` rendering, sidebar width offsets, and the left-sidebar layout pattern from the active `AppShell`.

**Replace with:** `TopRail` as a sticky header. Content area becomes full-width below the 52px rail.

**Mobile (< 640px):** Keep a bottom navigation bar but update it:
- 44px height (down from current 64px)
- 4 items: Planner, Create (raised circular orange FAB), Library, Connections
- Remove Dashboard and Settings from bottom nav (Settings moves to TopRail gear icon; Dashboard route is removed — Planner is the landing page)

**Desktop/Tablet:** Full-width content below TopRail. No sidebar at any breakpoint.

**Current repo cleanup targets:**
- `src/components/layout/app-shell.tsx` — active shell; rewrite around `TopRail` + redesigned bottom nav
- `src/components/layout/sidebar-nav.tsx` — active desktop/tablet sidebar; remove after TopRail lands
- `src/components/layout/bottom-nav.tsx` — keep concept, replace nav items and 64px styling
- `src/components/layout/PageHeader.tsx` — keep page-title component only; remove the obsolete `Topbar` / hamburger nav
- `src/components/layout/AppShell.tsx` and `src/components/layout/Sidebar.tsx` — older parallel shell; delete if no imports remain
- `src/components/layout/app-sidebar.tsx` and `src/components/ui/sidebar.tsx` — shadcn sidebar implementation; delete only after verifying no remaining imports
- `src/config/navigation.ts` — make this the canonical nav source or replace it with a new `src/config/app-nav.ts`; do not leave inline nav arrays in multiple components

### 1.5 Global interaction patterns

- **Toast system:** Success uses `--c-orange` background, error uses `--c-claret`, info uses `--c-ink`. Bottom-centre, 3.8s duration, enter animation.
- **Modals:** Backdrop `rgba(26,24,20,0.5)` + 8px blur. Modal scales in. Escape closes.
- **Drawers:** Right-side, 640px wide. Slide in 28px from right with opacity fade.

### 1.6 Cleanup

- Remove dark mode CSS and `ThemeProvider` (redesign is light-only)
- Remove the `--sidebar-*` CSS variables
- Remove `app-sidebar.tsx`, `sidebar-nav.tsx`, `Sidebar.tsx`, and obsolete shell code after imports are gone
- Remove `components/ui/sidebar.tsx` only if no shadcn sidebar primitives remain in use
- Update `src/config/navigation.ts` (or replacement nav config) to match new TopRail and mobile nav items
- Remove `dark:` Tailwind variants while touching redesigned components; do not leave invisible dark-mode-only contrast fixes

### Phase 1 verification

- [ ] `globals.css` has all new tokens and semantic mappings
- [ ] IBM Plex Sans + Mono loaded in `layout.tsx`
- [ ] `.eyebrow` utility class works
- [ ] `.mono` utility class works and uses IBM Plex Mono
- [ ] `Btn` renders all variants at all 3 sizes correctly, including the temporary `amber` alias if retained
- [ ] `Status` renders all 5 statuses with correct token colours, dot, and publishing pulse
- [ ] `PlatformDot` renders FB, IG, GBP using tint backgrounds and solid glyph colours
- [ ] `Card`, `Field`, `Input`, `Textarea` match spec
- [ ] `ToggleChip` and `Segmented` render correctly
- [ ] `TopRail` renders with correct nav items, active states, and right-side actions
- [ ] Mobile bottom nav is 44px with 4 items and raised Create FAB
- [ ] No left sidebar at any viewport width
- [ ] No duplicate active nav definitions remain in shell, header, sidebar, and bottom-nav files
- [ ] `/login` renders the redesigned auth screen; `/auth/login` keeps redirecting
- [ ] `/l/[slug]` remains public and renders without app chrome
- [ ] All existing pages still render (content may look rough — that's fine, page layouts are Phase 2/3)
- [ ] `npm run build` passes
- [ ] `npm run lint:ci` passes
- [ ] `npm run typecheck` passes

---

## Phase 2 — Core pages

**Goal:** The pages a venue operator uses every day — Planner, Create, Post detail, Library — match the design pixel-for-pixel.

**Current repo note:** These pages already fetch and mutate real data. Preserve the existing data contracts while replacing layout and presentation. Do not copy prototype fixture arrays into production components.

### 2.1 Planner — Calendar view (`/planner`)

The default landing page. Route: `/planner`.

**Header:**
- Eyebrow: dynamic day + date + "Europe/London" (e.g. "Wednesday 5 March · Europe/London")
- H1: `<orange>Month</orange> at <Venue>` — 22px, weight 600
- Subhead: counts of scheduled / needs-attention / connection warnings
- Right side controls: image-toggle chip, Calendar/Agenda `Segmented`, Today button, "New post" `Btn` primary

**Connection health banner:**
Persistent orange-soft banner when any social connection is in a warning state. Shows platform name, time-to-expiry, Reconnect CTA, and dismiss `x`. Dismissible per-session only (reappears next visit if unresolved).

**Calendar grid:**
- 7 columns x 6 rows
- Each day cell: top bar with display-font date + weekday eyebrow, dashed "+" button (top-right) linking to `/create`
- Adjacent month days at 40% opacity
- Today: `box-shadow: inset 0 0 0 2px var(--c-orange)`

**Post tiles inside day cells (when "Show media" is on):**
- Full-width image at 16:10 aspect ratio
- Platform dot in top-left with white ring outline
- Time in top-right: 10px IBM Plex Mono, white, on `rgba(16,24,40,0.7)` pill
- Failed posts: translucent `rgba(180,35,24,0.18)` wash over image + "Failed" badge centred
- Title below image: single line, 11px, 500 weight, ellipsis overflow
- Click any tile → post detail

**Post tiles (when "Show media" is off):**
- Compact row: time (mono) + title (ellipsis) + platform dot + status chip
- Same click target → post detail

### 2.2 Planner — Agenda view (`/planner?view=list`)

Same header as calendar view. Toggle via the `Segmented` control.

Content grouped by day (Today / Thursday 6 March / etc.) with thin rule between groups.

Each post row is a 3-column grid:
- Left: large display time (24px, weight 600, monospace)
- Middle: title + status chip + caption preview
- Right: platform dots + "Open" chevron button

Failed posts show `Failed` status chip in claret. Click row → post detail.

### 2.3 Post detail — Scheduled (`/planner/[contentId]`)

2-column layout. Max-width 1200px.

**Header:** Back-link breadcrumb, eyebrow (platform / type), H1 title, countdown ("Will go out in 2h 16m").

**Left card — Caption:** Mono word count + range note, large editable textarea, regenerate / "Try a different angle" ghost buttons.

**Right card — Preview:** Mock social post header (venue avatar, name, posting time), caption text, hero image capped at `max-height: 420px`.

**Below:** 3-up grid of Schedule / Media / Belongs-to cards with micro-actions.

**Footer:** Cancel (danger ghost), Save changes (secondary), Publish now (primary orange).

### 2.4 Post detail — Failed (`/planner/[contentId]`, failure state)

Same chrome as scheduled, but headlined by a **Recovery card**:
- Large claret-soft icon disc on left
- Plain-English heading (e.g. "Instagram couldn't accept this post.")
- Plain-English explanation (no raw API JSON in primary surface)
- Three action buttons: Reconnect [Platform] (primary) · Try again now (secondary) · Download copy & image (ghost)
- Dashed-rule footer: last-attempt timestamp, error code, "Show provider response" disclosure revealing raw JSON

### 2.5 Create — Launcher (`/create`)

2x2 grid of large card-buttons:

| Tile | Icon | Title | Description | Meta |
|------|------|-------|-------------|------|
| 1 | sparkle | Instant post | One brief → drafts for every platform. Publish now or schedule. | Typical: 2–3 min |
| 2 | calendar | Event campaign | Build-up + day-of + last-call posts spaced around an event date. | Generates 4–6 posts |
| 3 | info | Promotion | A time-limited offer with announcement, mid-run, and last-chance posts. | Generates 3–5 posts |
| 4 | refresh | Weekly recurring | Thursday quiz, Sunday roast — set it once, write every week. | Auto-posts forever |

Each tile: 24px padding, 16px radius, 44x44 icon block with `--c-orange-soft` background, h3 (26px) + 14px description + auto-bottom eyebrow. Hover lifts to `--sh-md` shadow and shifts border to orange.

### 2.6 Create — Instant post (`/create?flow=instant`)

2-column: form (left, 760px) + live preview (right, sticky).

Current `/create` supports `?draft=` for resume. Add `?flow=` handling without breaking `?draft=`; if both are present, resume the draft and infer the flow from draft metadata.

**Form fields:**
1. Brief (textarea, max 240 char counter)
2. Placement: Feed / Story `Segmented`
3. When: Publish now / Schedule `Segmented`
4. Post to: `ToggleChip` array (Facebook / Instagram / GBP) with platform tones
5. Media: drag-or-drop grid (up to 10 images or 1 video)
6. Progressive disclosure: "+ More options" reveals tone, hashtags, CTA URL

**Submit:** "Draft posts" primary orange button → 1.6s spinner ("Writing drafts…") → routes to `/create/review/[draftId]`.

**Right preview:** Mock Facebook post card with live caption preview + success-coloured "54 words — within range" hint.

### 2.7 Create — Event / Promotion / Weekly

Three sibling forms using shared patterns. Routes: `/create?flow=event`, `/create?flow=promotion`, `/create?flow=weekly`.

Each has:
- Breadcrumb back to `/create` launcher
- Eyebrow + h1
- Single-column form Card
- Preview/cadence section below showing what will be scheduled (Event: 4-slot timeline; Weekly: "we'll write 12 posts every Thursday…")
- Footer: Cancel ghost + primary "Draft N posts" lg button → routes to `/create/review/[draftId]`

### 2.8 Create — Review and approve (`/create/review/[draftId]`)

Stack of `PostCard`s, one per generated draft.

Each post card:
- Header: platform dot, name, type chip, status chip
- Body: hero thumbnail (160px square) + caption + word count
- Footer: Edit copy / Swap media / Regenerate ghost buttons + Approve primary

Sticky bottom action bar: "X of Y approved" + Save as drafts + "Approve all & publish". On publish → toast + route back to planner.

If the existing generated-content review flow cannot produce a durable `draftId` yet, implement a temporary route backed by the persisted content item IDs rather than keeping generated drafts only in client memory.

### 2.9 Library (`/library`)

**Header:** Total count + storage usage.

**Filter bar:** All / Images / Video `Segmented` + horizontal scrollable tag pills.

**Grid:** 4-up. First tile is the upload drop-zone (dashed border, "+ Drop or upload"). Subsequent tiles are asset cards with:
- Thumbnail image
- "Used x N" pill in top-right
- Label + tag micro-line at bottom

### Phase 2 verification

- [ ] Planner calendar renders with correct grid, day cells, post tiles, and today highlight
- [ ] Planner agenda renders with grouped days, monospace times, and status chips
- [ ] Calendar/Agenda toggle works via `Segmented` and `?view=` query param
- [ ] Connection health banner shows/dismisses correctly
- [ ] Post detail (scheduled) renders 2-column layout with preview and action footer
- [ ] Post detail (failed) renders recovery card with plain-English messaging
- [ ] Create launcher shows 2x2 tile grid with hover effects
- [ ] Instant post form has all fields, live preview, and routes to review on submit
- [ ] Event/Promotion/Weekly forms render with cadence previews
- [ ] Review page shows post cards with approve/reject and sticky action bar
- [ ] Existing `?draft=` resume behaviour still works after adding `?flow=`
- [ ] Library shows grid with upload zone and filter controls
- [ ] All pages use TopRail (no sidebar)
- [ ] `npm run build` passes
- [ ] `npm run lint:ci` passes
- [ ] `npm run typecheck` passes

---

## Phase 3 — Extended pages

**Goal:** Every remaining page matches the design. Mobile responsive polish. Full coverage.

### 3.1 Campaigns dashboard (`/campaigns`)

4-up KPI strip: Active spend, Reach 30d, Bookings attributed, Variants in flight.

Below: `Segmented` (All / Active / Drafts / Completed), then stack of campaign rows.

Campaign row layout (grid: 1fr / auto / 120px / auto / auto):
- Name + status chip + meta line (date range, objective, variant count)
- Budget summary
- Spent: percentage bar + mono percent
- Reach · Clicks
- "Open" ghost button → campaign detail

### 3.2 Campaign detail (`/campaigns/[id]`)

3-column layout (240px / 1fr / 360px):

- **Left:** Phases and variants tree. Each phase is collapsible; each variant is a row with approval state. Selected variant gets orange highlight.
- **Centre:** Form for active variant — Headline (40 char max), Primary text (125 char max), Description (25 char max), Creative brief (textarea), Creative picker (6-up thumbnail grid; selected = 2px orange ring + check badge).
- **Right (sticky):** Mock Facebook ad preview + "Placement & spend" meta card.

AI Rationale appears as a quiet editorial side-note (3px `--c-ink` left rule) at the top, not a hero banner.

### 3.3 Reviews (`/reviews`)

**Header:** Refresh button.

**4-up KPI strip:** Average rating, Total reviews, Awaiting reply, Avg response time.

**Segmented:** All / Awaiting reply (count) / Replied.

**Review cards:**
- 5-star row + author + timestamp
- "Needs care" chip if rating ≤ 3
- Review body text
- Either: posted reply (success-tinted card) or AI-drafted reply (dashed `--c-orange-hi` border) with Edit / Post reply actions

AI-drafted replies are central — every pending review gets one drafted in the venue's voice. "Try a different angle" button available. Low-star reviews get an apologetic tone.

### 3.4 Tournaments list (`/dashboard/tournaments`)

Card grid (2-up). Each tournament card:
- Header strip: season eyebrow, name (h3), "Auto-posting" success chip
- Big-number row: next fixture display-time + upcoming posts count
- Fixture rows: Round / date / "Going out X" mono timestamp + Preview button
- Footer: Manage fixtures + Pause auto-posting ghost buttons

### 3.5 Tournament detail (`/dashboard/tournaments/[id]`)

Full standings table (rank / team name / W-L / points) with first place highlighted success-tinted. Fixture list below. The "next" fixture row is highlighted orange-soft.

### 3.6 Connections (`/connections`)

3 large connection rows: Facebook, Instagram, GBP.

Each row is a `Card` with:
- Platform dot (48px), name, status (Connected / Expiring / Needs action)
- Sub-label text
- Action buttons: Refresh + Disconnect (when connected), or Reconnect-now primary (when warning)
- Strip below: token expiry, last published, default page name

Bottom: info card explaining token refresh policy.

### 3.7 Settings (`/settings`)

5-tab settings page. Sticky left nav (220px), tab content on right. Tab held in URL as `?tab=...`.

Current settings content includes Brand voice, Posting defaults, Management app connection, and Link-in-bio settings in a single vertical page. The redesign should move these into the 5-tab shell below without dropping the management connection or link-in-bio editor controls; place them under **Venue details** or a small **Integrations** sub-section if needed.

| Tab | Key content |
|-----|-------------|
| **Brand voice** (default) | 3 sliders (Tone / Length / Emoji use) + "Words we always use" tag input + live preview card |
| **Posting defaults** | Timezone, default post time, quiet hours range, default GBP CTA `Segmented`, default IG hashtags, auto-publish recurring toggle |
| **Venue details** | Logo upload, display name, short pitch (with counter), phone, WhatsApp, URLs (bookings, menu, website, directions), link-in-bio preview link |
| **Notifications** | Matrix table (event x Email / Push / SMS) with toggle switches per cell, SMS phone number input |
| **Account & security** | Email, display name, password (with "Change password"), passkey row, sessions row, danger-zone Delete account |

### 3.8 Notifications feed (`/planner/notifications`)

Linear feed grouped by recency. Each row:
- Tone-coloured circle icon (alert / fail / ok / review / info)
- Title + body + timestamp
- Optional action button
- Unread rows: 3px left border in tone colour

Action buttons navigate to relevant pages (e.g. "Recover post" → failed post detail, "Reconnect" → connections).

### 3.9 Login (`/login`)

Full-bleed split-screen (1fr / 1fr):

- **Left panel:** Near-black (`--c-ink`) background with brand mark, display headline, paragraph, and customer testimonial card at bottom
- **Right panel:** Magic-link form — Email field, "Send magic link" primary lg full-width button, divider "OR", "Continue with Google" secondary, "Continue with passkey" secondary. Footer microcopy on requesting access.

The production app's canonical login route is `/login` (`src/app/(auth)/login/page.tsx`). Keep `/auth/login` as a legacy redirect.

### 3.10 Link-in-bio (`/l/[slug]`)

Public-facing page, no app shell. Stack:
1. Hero image (200px tall, full-bleed)
2. Avatar disc (90px, white border, overlapping hero by 50px) + venue name (h2, 28px) + tagline + "Open now" success chip
3. Action stack: 5 large tiles (Book / Menu / What's on / Call / Find us) — first tile is primary (orange), rest secondary. Each has icon, label, sub-label, right chevron.
4. Social row (3 platform dots, 36px)
5. "Powered by CheersAI" footer

Public route already exists at `/l/[slug]` and must remain outside the `(app)` group. The existing authenticated `/link-in-bio` route is the editor/preview surface; restyle it separately or move those controls into Settings, but do not put app chrome on `/l/[slug]`.

### 3.11 Help centre (`/help`)

The route already exists as a minimal support page. Replace it with the prototype pattern: search input, 3 FAQ sections using `<details>`, optional deep-links ("Take me there"), and footer links to Terms / Privacy / version.

### 3.12 Legal pages (`/terms`, `/privacy`)

Terms and Privacy already exist as separate public routes. Restyle both to the clean editorial layout (18px body text, 1.55 line-height). The prototype shows a shared Legal component with `?doc=privacy`; production can keep separate `/terms` and `/privacy` pages if the visual treatment and cross-links match.

### 3.13 Mobile responsive polish

Mobile patterns (< 640px viewport) applied across all pages:

- **Planner mobile:** Week-strip date selector at top (7 days, current day in solid orange circle). Stacked post cards instead of calendar grid.
- **Create mobile:** Single-column form with sticky bottom CTA button.
- **Bottom nav:** 44px fixed bar with Planner / Create (raised circular orange FAB) / Library / Connections.
- **General:** All pages stack to single column. Cards go full-width. Grid layouts collapse.

### Phase 3 verification

- [ ] Campaigns dashboard renders with KPI strip, segmented filter, and campaign rows
- [ ] Campaign detail renders 3-column variant editor layout
- [ ] Reviews renders with KPI strip, review cards, and AI-drafted reply cards
- [ ] Tournament list renders 2-up card grid
- [ ] Tournament detail renders standings table and fixture list
- [ ] Connections renders 3 platform cards with correct status/action states
- [ ] Settings renders 5-tab layout with correct content per tab
- [ ] Notifications feed renders grouped rows with tone colours and action buttons
- [ ] Login renders split-screen with magic-link form at `/login`; `/auth/login` redirects
- [ ] Link-in-bio renders at `/l/[slug]` as public page with no app chrome
- [ ] Authenticated `/link-in-bio` editor is either restyled or intentionally folded into Settings
- [ ] Help page uses the prototype FAQ/search pattern
- [ ] Legal pages restyle to editorial layout
- [ ] Mobile planner shows week-strip + stacked cards
- [ ] Mobile create shows single-column with sticky CTA
- [ ] Mobile bottom nav is 44px with 4 items and raised Create FAB
- [ ] All pages render correctly at 390px, 768px, and 1440px widths
- [ ] `npm run build` passes
- [ ] `npm run lint:ci` passes
- [ ] `npm run typecheck` passes

---

## Cross-cutting notes

### What does NOT change

- **Backend logic:** Server actions, Supabase queries, RLS policies, API routes, publishing pipeline, AI generation — all unchanged.
- **Route structure:** Most routes already exist and match the design's route map. Required changes: make Planner the landing page, keep `/login` canonical, keep `/l/[slug]` public, restyle existing `/help`, restyle `/terms` and `/privacy`, decide whether authenticated `/link-in-bio` stays as an editor or moves into Settings, and remove or redirect `/dashboard` as a standalone page.
- **Data layer:** React Query hooks, data fetching patterns, type definitions — all unchanged.
- **Auth flow:** Supabase Auth with JWT + cookies remains. Only the login page visual treatment changes.

### Breaking changes to anticipate

1. **Sidebar removal** — any component that references `SidebarNav`, sidebar width offsets, or sidebar state will need updating.
2. **Colour system** — any component using `--primary` (blue) or `--brand-blue` will shift to orange. Review all hardcoded blue hex values.
3. **Font change** — any component using the `font-heading` class will change from Sora to IBM Plex Sans.
4. **Dark mode removal** — any component with `dark:` Tailwind variants will lose those styles.
5. **Bottom nav item changes** — Dashboard and Settings removed from mobile nav.
6. **Duplicate shell code** — active and stale shell/sidebar/header files can diverge. Delete stale implementations after TopRail lands.
7. **Create route state** — adding `?flow=` must not break existing `?draft=` resume behaviour.

### Design reference files

Primary design prototypes and screenshots are at:
```
~/Library/Mobile Documents/com~apple~CloudDocs/Downloads/cheersai 2/project/design_handoff_cheersai_redesign/
```

Key files:
- `README.md` — the full design handoff document
- `tokens.css` — CSS custom property definitions
- `components.jsx` — component reference implementations
- `screens-*.jsx` — page-level reference implementations
- `screenshots/` — visual reference stills
- `CheersAI Prototype.html` — interactive prototype (open in browser)
- `CheersAI Design System.html` — side-by-side screen comparison

### Data fetching and mutation map

| Page | Fetches | Mutates |
|------|---------|---------|
| Planner | Scheduled content for visible month, connection statuses | None (click navigates) |
| Post detail | Post, variants, publish job log | Caption, schedule, media, approve, retry, cancel, delete |
| Create flows | Brand voice settings, library media, connections | Creates draft content_items + content_variants |
| Create review | Just-generated drafts | Approves and publishes (kicks off publish job) |
| Campaigns | Campaign list + per-campaign KPIs from Meta API | Read-only list |
| Campaign detail | Variants, creative briefs, ad preview, spend | Edits headline/text/creative, regenerates, approves |
| Library | Media assets, tags | Upload, delete, retag |
| Reviews | GBP reviews + drafted replies | Edits and posts replies |
| Tournaments | Tournaments + standings + fixtures | Adds/edits fixtures, pauses auto-posting |
| Tournament detail | Full standings + fixture history | Scores, fixture edits |
| Connections | Connection statuses, token expiries | Reconnect (OAuth), refresh, disconnect |
| Settings | Brand voice, posting defaults, venue, notification prefs, account | Full CRUD on each tab |
| Notifications | Notifications feed | Mark read, dismiss |
| Help / Legal | Static | None |
| Login | None | Magic-link send |
| Link-in-bio | Public page data for slug | None (public, read-only) |

### Optimistic UI patterns

- **Approve draft:** Chip flips to Approved immediately; revert on failure
- **Toggle switches (settings, auto-publish, etc.):** Flip immediately; revert on failure
- **Schedule reorder (future calendar drag):** Visual position updates immediately; revert on failure
