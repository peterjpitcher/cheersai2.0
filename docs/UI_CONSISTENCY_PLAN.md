# UI Consistency Plan

Objective: Align all authenticated pages to the same shell and interaction patterns used by `/dashboard`, reducing visual drift and UX friction. Focus on SubNav headers, compact action bars, tidy filter rows, standardized empty/loading/error states, and consistent card/controls styling. Keep changes surgical and low‑risk.

## Principles (UI Contract)
- Shell: master navigation + `SubNav` on all authed pages.
- Header actions: compact, right‑aligned (text-sm, `h-9` buttons, consistent icon spacing).
- Utility strips: sticky bar directly below SubNav using `Container + py-3`, `z-[9]` (below SubNav), text-sm controls.
- Cards: consistent border, radius, internal paddings; footer/action rows use border‑t + compact padding.
- Empty/loading/error states: shared pattern — icon (subtle), title, short body, primary CTA; balanced spacing.
- Forms/inputs: unified label size/spacing, input heights, help text and error placement.

## Phase 1 (Completed)
- Generate page: migrated to `SubNav` (title/actions), compact sticky info strip; removed hero header.
- Publishing Queue: added `SubNav`, moved scheduler info into compact sticky bar; prepared header for filter normalization.
- Settings → Connections: added `SubNav` and standardized page frame.

## Phase 2 (In Progress)

### A. Publishing Queue
- Normalize filters/action strip directly under SubNav:
  - Structure: `Container + py-3`, text-sm controls, tidy gaps.
  - Left: platform filter pills (badge style, consistent states),
  - Middle: approval and status selects (h-8, text-sm),
  - Right: view toggles live in SubNav actions (no duplicates).
- Keep overdue warning styled as a compact alert block below the filters.

### B. Campaign Overview
- Add `SubNav` with:
  - Title: campaign name
  - Subtitle: “Campaign Overview”
  - Actions: `PublishAllButton` + `CampaignActions`
- Remove any content-level hero headers (none currently).

### C. Empty States Standardization
- Generate “No content generated yet” → ensure icon + title + body + primary CTA; consistent spacing.
- Publishing Queue “No items in queue” → confirm `EmptyState` layout matches spacing and style across app.

### D. Settings Section (Account, Brand, Posting Schedule)
- Ensure `SubNav` present with page title/subtitle where missing.
- Normalize card paddings and dividers for section cards.

## Phase 3 (Follow‑ups)

### A. Forms & Inputs
- Labels: text-sm, consistent `mb-1/mb-2` spacing.
- Inputs: consistent heights (h-9 for compact rows; h-10 for standard forms), border + focus states.
- Help and error text: text-xs, unified placement and color.

### B. Card Components
- Headers: optional, compact typography; no gratuitous spacing.
- Footers: border-t + `px-5 py-3` (or app-wide standard), right-aligned action clusters.
- Dividers: avoid double borders when stacking.

### C. Buttons
- Compact rows (headers/filters): `text-sm h-9 px-3`.
- Primary vs outline variants applied consistently; icons `w-4 h-4`, `mr-2` spacing.

### D. Lists & Grids
- Standardize responsive grids (sm:1, md:2, xl:3 where appropriate) and gap sizes.
- Avoid inconsistent `grid-cols-*` and ad-hoc paddings.

## File‑Level TODOs

1) `app/(authed)/publishing/queue/page.tsx`
- [ ] Normalize filter strip under SubNav: move platform pills/selects into `Container + py-3`, text-sm, tidy gaps.
- [ ] Ensure overdue warning sits under filters with compact alert styling.

2) `app/(authed)/campaigns/[id]/client-page.tsx`
- [ ] Add `SubNav` with title (campaign name), subtitle, and actions (PublishAll + CampaignActions).
- [ ] Confirm no duplicate headers.

3) `app/(authed)/campaigns/[id]/generate/page.tsx`
- [ ] Verify “No content generated yet” empty state spacing matches shared pattern.
- [ ] Confirm sticky info strip spacing and z-index.

4) Settings pages
- [ ] `app/(authed)/settings/account/page.tsx` — add `SubNav` (Account), standardize cards.
- [ ] `app/(authed)/settings/brand/page.tsx` — add `SubNav` (Brand), verify form layout consistency.
- [ ] `app/(authed)/settings/posting-schedule/page.tsx` — add `SubNav` (Posting Schedule), check control sizes.

5) Components review
- [ ] `components/ui/empty-state.tsx` — verify it supports icon/title/body/CTA presets; adjust margins if needed.
- [ ] `components/ui/button.tsx` — confirm `sm`/`default` sizes map to `h-9`/`h-10` as used in headers vs forms.
- [ ] `components/ui/card.tsx` (if present) — align default paddings and border radii.

## Acceptance Criteria
- All authed pages render with `SubNav` shells; no hero page headers under SubNav.
- Action bars use compact, consistent controls (text-sm, h-9 for header rows).
- Filters/utility strips live directly under SubNav using `Container + py-3`.
- Empty/loading/error states are visually consistent across main flows.
- No layout regressions; all tests/build pass.

## Rollout & Validation
- Manual sweep: Dashboard → Campaigns (Overview/Generate) → Publishing → Settings → Quick Post → Media → Admin prompts.
- Cross‑check spacing and component usage against UI Contract.
- Open follow‑ups as small tasks if additional lumps are found.
