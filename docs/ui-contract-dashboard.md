UI Contract (Dashboard)

Scope: This captures only what the authenticated Dashboard at `/(authed)/dashboard` demonstrates. All other pages are non‑normative. If the Dashboard is inconsistent, the dominant pattern is recorded and any minority pattern is noted as “to fix later”.

1) Layout
- Shell: Topbar header + secondary SubNav; no left sidebar present on Dashboard. Mobile uses a slide‑in sheet menu.
- Header: `header.sticky` with border bottom (`border-border`) and `bg-surface`; containerised at `max-w-screen-2xl`.
- Content container: `Container` sets gutters `px-4 sm:px-6 lg:px-8` and `max-w-screen-2xl mx-auto`.
- Page padding: Dashboard main content uses `pt-6 pb-8` within `Container`.
- Sections: SubNav renders a tabs row (if >1 item). Optional title/subtitle/actions row below the tabs.
- Footer: Present in authed shell; outside the scope of Dashboard styling.

2) Navigation
- Primary header nav: Brand on the left, breadcrumb (optional) next to it on ≥sm, plan badge, notifications, and user menu on the right.
- SubNav (section nav):
  - Container with `border-b` and `bg-surface/50 backdrop-blur-sm`.
  - Items: horizontal scroll on overflow with `min-h-[44px]` touch targets.
  - Density: `px-4 py-3` per item; label `text-sm font-medium`.
  - Icons: Lucide at `w-4 h-4` in SubNav; `w-5 h-5` in Topbar buttons; dashboard stat tiles use `w-6 h-6` (`sm:w-8 h-8`).
  - States: Active = `border-b-2 border-primary text-primary`; Inactive = `text-text-secondary border-transparent`; Hover = `hover:text-text-primary hover:border-border`.
  - Focus: `focus-visible:ring-2 ring-primary ring-offset-2` applied to items.
  - Collapse behaviour: None; SubNav items horizontally scroll. Mobile uses a Sheet for the main nav (not SubNav).
  - Badges: SubNav badge chip uses `ml-1 px-2 py-0.5 text-xs bg-primary/10 text-primary rounded-full`.

3) Page Header
- H1: Optional title row in SubNav’s second strip (`text-lg font-heading font-semibold`), left‑aligned with truncation (`truncate`).
- Subtitle: Optional `text-sm text-text-secondary` under the H1 in the same strip.
- Breadcrumbs: In Topbar (not SubNav), `text-sm text-text-secondary`, with hover `hover:text-text-primary` and “/” separators.
- Actions: Right‑aligned in the SubNav title strip; inline buttons grouped with `gap-2`.

4) Cards and Tables
- Cards: Use `<Card>` with `rounded-lg border bg-card text-card-foreground shadow-sm`.
  - Internal spacing: Commonly `p-4`/`p-5`/`p-6` based on context; CardHeader uses `p-6`.
  - Radius: Standardised to `rounded-lg` (equals `var(--radius)`, currently 8px) across Dashboard, including icon containers within cards/tiles.
  - Shadow: Subtle default `shadow-sm`; hover states on interactive tiles may increase to `shadow-md`.
  - Separators: CardFooter uses `border-t px-5 py-3`.
- Stat tiles: Cards with inline icon container (`bg-* /10`, `p-3.5 sm:p-4`, `rounded-medium`). Numbers `text-xl sm:text-2xl font-bold`; caption `text-sm text-text-secondary`.
- Empty states (Getting Started): Emphasised card with tinted background `bg-primary/5` and `border-primary/20`; left icon in a soft chip `bg-primary/10 p-3 rounded-medium`; title `font-heading font-bold text-lg`; body `text-text-secondary`; primary/secondary CTAs as links styled like buttons with minimum touch target `min-h-[44px]` on mobile.
- Tables: Not present on Dashboard — no convention established here.

5) Tokens Inferred from Dashboard Usage
- Colours (semantic):
  - `background`: page background; `surface`: header/subnav backdrop; `border`: dividers and control borders.
  - `text-primary` and `text-secondary`: primary/secondary text colours.
  - `primary` (brand orange), `secondary` (brand blue), `success`, `warning`, `error` per globals.css.
  - Tints: chips/badges and icon backgrounds use `X/10` overlays (e.g., `bg-primary/10`, `bg-success/10`).
- Radius:
  - `var(--radius)` (8px) via `rounded-lg` on cards and icon chips (standardised on Dashboard).
  - Minor inconsistency: both 8px and 12px are used; 8px dominates on cards.
- Shadow:
  - Default `shadow-sm` throughout cards; interactive tiles may escalate to `shadow-md` on hover.
- Spacing:
  - Page gutters: `px-4 sm:px-6 lg:px-8`.
  - Vertical rhythm in dashboard body: `pt-6 pb-8`; grids use `gap-4`.
  - Controls: SubNav item density `px-4 py-3`; buttons use the Button component sizes (defaults map to `h-10` with tokenised paddings); mobile CTAs ensure `min-h-[44px]`.
- Typography scale (as used):
  - Title in SubNav: `text-lg`.
  - Card/stat numbers: `text-xl sm:text-2xl` bold.
  - Section headings inside cards: `text-lg` bold.
  - Body: `text-sm` or default text; secondary copy uses `text-text-secondary`.

6) Accessibility Expectations
- Landmarks: Semantic `<header>` for the Topbar; SubNav renders `<nav aria-label="Section navigation">`; Breadcrumbs use `<nav aria-label="Breadcrumb">`.
- Keyboard: Interactive nav items and buttons use `focus-visible` rings (`ring-2 ring-primary ring-offset-2`); outline is suppressed in favour of the accessible ring.
- Touch targets: Minimum `44px` height on SubNav items and primary actions on mobile (`min-h-[44px]`).
- Contrast: Foreground tokens on tinted backgrounds (e.g., `bg-primary/10` with `text-primary`) provide readable contrast; default body text uses `text-primary`.
- Motion/blur: Subtle `backdrop-blur-sm` on SubNav bar; transitions are modest; no reduced‑motion overrides are shown on Dashboard.


Tailwind Theme Patch (final; aliases in use on /dashboard)

Note: Do not apply code changes yet. The snippet below maps observed values to explicit tokens and adds aliases only, using existing CSS variables and values from `globals.css`. This helps enforce consistency seen on the Dashboard without introducing new colours.

File: `tailwind.config.ts` (extend.theme)

```ts
// Aliases that encode the Dashboard conventions without new values
extend: {
  // colours already exist via CSS variables (no changes)
  borderRadius: {
    card: 'var(--radius)', // rounded-card (8px)
    chip: '12px',          // rounded-chip (12px)
    // deprecated: soft (8px) → use card; medium (12px) → use chip
  },
  boxShadow: {
    card: '0 1px 2px 0 rgba(0,0,0,0.06)', // shadow-card
    cardHover: '0 6px 16px rgba(0,0,0,0.10)', // shadow-cardHover
  },
  spacing: {
    'page-x-sm': '1rem', 'page-x-md': '1.5rem', 'page-x-lg': '2rem',
    'page-pt': '1.5rem', 'page-pb': '2rem',
  },
  fontSize: {
    'title-sm': ['1.125rem', { lineHeight: '1.75rem' }],
    'number-lg': ['1.25rem', { lineHeight: '1.75rem' }],
    'number-xl': ['1.5rem', { lineHeight: '2rem' }],
  },
}
```

File: `app/globals.css` (documenting existing tokens; no colour additions)

```css
/* No colour changes — document the intended usage */
/* Cards: use --radius (8px). Icon chips: prefer 12px (rounded-medium). */
/* SubNav focus ring uses --ring (maps to brand primary). */
```


Component API Specs (reflecting Dashboard exactly)

AppShell
- Props:
  - `children: React.ReactNode` — required.
  - `user: { email: string; avatarUrl?: string; firstName?: string }` — used for Topbar.
  - `notificationCount?: number` — shown as a badge on the bell icon.
- Behaviour:
  - Provides `<main role="main">` landmark. No visual changes.

SidebarNav
- Not used on Dashboard (no left sidebar). To fix later if introduced elsewhere. Current canonical shell is Topbar + SubNav only.

Topbar
- Props:
  - `breadcrumb?: Array<{ href: string; label: string }>` — optional; truncated on narrow widths, hidden on xs.
  - `title?: string` — optional centre title on ≥md.
  - `user: { email: string; avatarUrl?: string; firstName?: string }` — required.
  - `notificationCount?: number` — optional.
- Variants: none on Dashboard.
- Behaviour:
  - Sticky, `border-b`, `bg-surface`.
  - Left: brand + breadcrumb; Right: plan badge, notifications, user menu.
  - Mobile: Sheet menu listing header nav items; active item `bg-primary/10 text-primary`.

PageHeader
- Rendered by SubNav’s optional title row.
- Props:
  - `title?: string` — H1 (`text-lg font-heading font-semibold`).
  - `subtitle?: string` — `text-sm text-text-secondary` below.
  - `actions?: React.ReactNode` — right‑aligned actions.
- Variants: none; density is compact (`py-3`).

Sidebar (Section) Navigation — `SidebarNav` alternative
- Not applicable on Dashboard. SubNav is the canonical section navigation.

SubNav
- Props:
  - `base: string` — base route for relative items.
  - `preset?: 'dashboard' | ...` — loads items from presets.
  - `itemsOverride?: Array<{ label: string; to: string; icon?: IconName; badge?: string | number }>`.
  - `title?: string`, `subtitle?: string`, `actions?: React.ReactNode` — optional title strip.
- Behaviour:
  - Active/hover/focus states and density as detailed in section 2.
  - Quick Post special item (`to: '#quick-post'`) dispatches a `CustomEvent('open-quick-post')`.

Examples (Dashboard usage)
- Page paddings: `<Container className="pt-page-pt pb-page-pb">…</Container>`.
- Stat numbers: `<p className="text-number-lg sm:text-number-xl font-bold">42</p>`.
- Icon chip: `<div className="bg-primary/10 p-3 rounded-chip">…</div>`.
- Card elevation: default via `<Card />` (shadow-sm); add `shadow-cardHover` on hover when interactive.

Wrappers for Non-Dashboard Routes
- Use `<AppShell>` to provide `role="main"` around page content.
- Use `<SidebarNav base="/section" preset="…" />` where a section nav exists.
- Use `<PageHeader title=… subtitle=… actions=… />` for compact title strips.

EmptyState
- Props:
  - `icon?: ReactNode` — shown in a circular chip (`bg-primary/10`, `rounded-lg`).
  - `title: string` — `text-2xl font-heading font-bold`.
  - `body?: ReactNode` — secondary text (`text-text-secondary`, centred, constrained width).
  - `primaryCta?: { label: string; href?: string; onClick?: () => void; variant?: 'default' | 'secondary' | 'outline' | 'destructive' }`.
  - `secondaryCta?: { ...same as above }`.
  - `className?: string`.
- Variants:
  - Default card: `rounded-lg border bg-card text-card-foreground shadow-sm`.
  - Emphasised (as used by Dashboard “Getting Started”): add `bg-primary/5 border-primary/20`.
- Behaviour:
  - Actions render as buttons/links; ensure `min-h-[44px]` on mobile when used as primary actions.


Minor Inconsistencies to Fix Later
- Hover elevation: Some interactive tiles use `hover:shadow-md`, others remain `shadow-sm`. Confirm whether hover elevation is intended for all interactive cards.

Change Log (Dashboard standardisation)
- Radius: Replaced `rounded-medium` with `rounded-lg` in Dashboard views (cards’ icon chips, calendar controls, and quick post tile) to match the dominant 8px radius.


Acceptance
- This contract only reflects the Dashboard (`/(authed)/dashboard`).
- No new colours were introduced; all tokens map to existing CSS variables.
- Component APIs mirror the existing usage and density on the Dashboard.
