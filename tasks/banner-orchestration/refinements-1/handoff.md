# Banner refinements — handoff

Branch `claude/loving-antonelli-8797d7`, three commits stacked on top of
`5712e3f`.

## Commits

| Hash      | Title                                            |
|-----------|--------------------------------------------------|
| `62a6dbe` | feat(banner): switch defaults to bronze + right  |
| `fa9dd29` | feat(banner): add two-preset palette selector    |
| `5c12253` | feat(banner): repeat label text with dot separator |

## What each commit changed

### `62a6dbe` — defaults to bronze + right (R1)

- `supabase/migrations/20260507120000_banner_defaults_palette.sql`
  - `ALTER TABLE posting_defaults ALTER COLUMN banner_position SET DEFAULT 'right'`
  - `ALTER TABLE posting_defaults ALTER COLUMN banner_bg SET DEFAULT '#a57626'`
  - Conservative `UPDATE` bumps rows still on the original `'bottom'` /
    `'#000000'` migration defaults; user-customised rows are left alone.
  - **Not applied** — orchestrator runs the migration.
- `supabase/functions/publish-queue/worker.ts` — `DEFAULT_ACCOUNT_BANNERS`
  fallback updated to `banner_position: "right"`, `banner_bg: "#a57626"`.
- `src/lib/planner/data.ts` — `DEFAULT_ACCOUNT_BANNER_DEFAULTS` constant
  updated to match the new schema defaults so missing-row fallbacks stay
  in sync with the database.
- `src/lib/settings/data.ts` — settings default also updated to match.

### `fa9dd29` — two-preset palette selector (R2)

- New `src/lib/banner/palette.ts` exporting:
  - `BannerPaletteId = 'bronze' | 'green'`
  - `BANNER_PALETTES` (bronze: `#a57626`/white, green: `#005131`/white)
  - `paletteFromColours(bg, text)` — case-insensitive, falls back to
    `'bronze'` for unrecognised pairs.
  - `BANNER_LABEL_REPEAT_COUNT = 21`,
    `BANNER_LABEL_SEPARATOR = ' · '`,
    and `buildRepeatedBannerLabel(label)` for use by the next commit.
- `src/features/settings/posting-defaults-form.tsx` — replaced the two
  `<input type="color">` controllers with a single nested
  Controller-of-Controllers that renders two palette buttons; selecting
  one updates both `bannerBg` and `bannerTextColour` atomically.
- `src/features/planner/banner-controls.tsx` — replaced both colour
  pickers (and the unused `HEX` regex) with palette buttons that write
  both `banner_bg` and `banner_text_colour` in a single `persist` call.
- DB CHECK constraints unchanged; Zod schema unchanged. Palette is
  enforced UI-side only.
- New `src/lib/banner/palette.test.ts` covers `paletteFromColours` with
  bronze, green, uppercase hex, mixed case, and unrecognised fallbacks,
  plus the `buildRepeatedBannerLabel` shape.

### `5c12253` — repeat label text with dot separator (R3 + R4)

- `src/features/planner/banner-overlay.tsx` — repeats the label
  `BANNER_LABEL_REPEAT_COUNT` times joined by `' · '`. Strip is now
  `overflow-hidden`; inner span is `whitespace-nowrap` so the result
  spills past both edges and clips symmetrically. `aria-label` retains
  the single un-repeated label for accessibility.
- `src/lib/banner/render-server.ts` — same repeated string injected
  into the SVG `<text>` element. `text-anchor="middle"` plus the
  rectangular SVG viewport handle symmetric clipping after rotation
  (left/right) just as well as for horizontal strips. Middle dots are
  literal U+00B7 characters and don't need XML escaping; the existing
  `escapeXml` still handles `< > & ' "`.
- `src/features/planner/banner-overlay.test.tsx` — assertions now use
  `getByLabelText(...)` and `toMatch(/X · X/)` against textContent. New
  test asserts the strip is `overflow-hidden` and the span is
  `whitespace-nowrap`. Base config bumped to `bgColour: '#a57626'` to
  match the new defaults (cosmetic — the test doesn't depend on it).
- `src/features/link-in-bio/public/link-in-bio-public-page.test.tsx` —
  same `getByLabelText` / repeated-text assertion swap (this view also
  uses `<BannerOverlay />`).
- `src/lib/banner/render-server.test.ts` — unchanged. The test already
  asserts only on dimensions, format, and byte stability across two
  identical inputs; the new SVG payload is still deterministic, just a
  different stable byte sequence.

## CI verification

| Step                | Status | Notes |
|---------------------|--------|-------|
| `npm run lint:ci`   | clean  | zero warnings |
| `npm run typecheck` | 2 errors, both pre-existing | `supabase/functions/publish-queue/{banner-label,worker}.ts` cannot resolve `https://esm.sh/luxon@3.7.2`. Verified by checking out `5712e3f` (origin/main) — same errors. tsconfig.build.json (used by `npm run build`) excludes `supabase/`, so this only affects standalone `tsc --noEmit`. |
| `npm run test:ci`   | 631 passed (added 2 vs prior baseline) | All banner-overlay, render-server, link-in-bio, palette tests pass. |
| `npm run build`     | env-config break, pre-existing | Worktree has no `.env*` files, so `Missing required environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY` fires at "Collecting page data" before any of my code runs. Verified pre-existing by re-running on `5712e3f`. |

No new TypeScript errors, no new test failures, no new lint warnings.

## Out-of-scope items observed but not changed

- No new `any` types added; existing `any` not touched.
- Did not touch the existing CHECK constraints in
  `20260507100000_banner_overlay_add_columns.sql` (per brief).
- Did not redeploy the publish-queue Edge Function (per brief).
