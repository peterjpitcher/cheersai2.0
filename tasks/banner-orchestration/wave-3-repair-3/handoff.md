# Wave 3 Repair 3 Handoff — UI bugs + route hardening

## Summary

Final repair pass landing four codex-qa-review findings plus one perf bonus.
All 4 blocking findings have a test that fails on the un-patched code and
passes after the fix. `npm run ci:verify` is clean (lint, typecheck, test,
build all pass — 405 tests passing).

## Commits (in order)

1. `17f1296` — `fix(banner): render override-only banners on public link-in-bio page (G1)`
2. `0b690d1` — `fix(banner): rotate text in left/right banner overlays + lazy-load img (G2, AB-007)`
3. `a55c29e` — `fix(banner): make computeBannerOverride per-field nullable (G3)`
4. `c21d355` — `fix(banner): tighten render-banner route input validation (G4)`

Not pushed.

## Per-finding status

### G1 — Public link-in-bio hides override-only banners — FIXED

**Files**:
- `src/features/link-in-bio/public/link-in-bio-public-page.tsx` — page gate
  now renders `<BannerOverlay />` when `resolvedConfig` exists AND
  (`bannerLabel` is non-null OR `resolvedConfig.textOverride` is non-empty).
- `src/lib/link-in-bio/public.ts` — fetcher decoupled: `bannerConfig` is
  exposed whenever banners are enabled; `bannerLabel` only carries the
  proximity label (or `null`). The override (`textOverride`) is independent
  of the proximity label and lives inside `bannerConfig`. `BannerOverlay`
  itself prioritises `textOverride` over `label`.

**Test**: `src/features/link-in-bio/public/link-in-bio-public-page.test.tsx`
covers three cases: override-only (`bannerLabel: null`,
`textOverride: 'BANK HOLIDAY'`) → renders, label-only → renders, neither
→ no overlay.

### G2 — Left/right banner positions don't render as vertical strips — FIXED

**File**: `src/features/planner/banner-overlay.tsx` — for `position: 'left'`
and `position: 'right'` the text span carries an inline
`writing-mode: vertical-rl` style; left also adds `transform:
rotate(180deg)` so it reads bottom-to-top, matching the publish-time SVG
output of `renderBannerServer` (which rotates -90 / +90 deg respectively).
Used inline `style` because no other component in the codebase uses
writing-mode (verified via grep).

**Test**: `src/features/planner/banner-overlay.test.tsx` — added cases for
`position: 'left'` and `position: 'right'` rendering "THIS WEDNESDAY". Each
asserts `data-position` is correct and the text span's `style` matches
`/writing-mode:\s*vertical-rl/`.

### G3 — `computeBannerOverride` over-writes appearance columns — FIXED

**File**: `src/lib/create/service.ts` — the function now evaluates each
column (`position`, `bgColour`, `textColour`) independently and only writes
the columns that actually differ from `DEFAULT_BANNER_DEFAULTS`. Returns
`null` when no field was customised. Omitted columns fall back to the
account-level default at resolve time via `bannerConfigResolver`.

The exported return type is now `BannerOverrideRow` (each appearance column
optional). Spread consumer at `service.ts:1412`
(`...(bannerOverride ?? {})`) is unchanged — undefined keys are simply not
spread into the upsert payload, so the per-column fallback wins.

**Test**: `tests/lib/create/banner-override.test.ts` — added a `[G3]`
describe block covering: only-position, only-bg, only-textColour, and a
combined two-field case. Each asserts the override contains exactly the
expected keys and the un-customised columns are absent. The pre-existing
`[F4]` cases were updated to reflect the new shape; the
`banner_position: "top"` only-position case now matches `{ banner_position:
"top" }` instead of all-three-fields.

### G4 — Route input validation: label length + hex colour regex — FIXED (+ position field-name reported)

**File**: `src/app/api/internal/render-banner/route.ts` — replaced the
boolean `isValidBody` / `isResolvedConfig` checks with a `validateBody`
helper that returns `null` on success or a short field name on failure.
Failures now respond `400` with
`{ error: "BANNER_RENDER_FAILED: invalid <field>" }` and never reach
`fetch` or `renderBannerServer`.

Validation rules added:
- `label`: must match `/^[\w\s\-:.,!?'"&%@#()/]+$/` AND be ≤ 60 chars.
  Generous enough for `WEDNESDAY 25 SEPTEMBER` and `Buy 1 get 1 free`,
  excludes emoji and control chars.
- `bgColour`, `textColour`: must match `/^#[0-9A-Fa-f]{6}$/`.
- `position`: existing allowlist (`top|bottom|left|right`) preserved.

**Test**: `tests/app/internal/render-banner-route.test.ts` — added cases
for: oversize label (200 chars), label with emoji, non-hex bgColour
(`'red'`), 3-digit hex textColour (`'#abc'`). Each asserts the response is
400 with the BANNER_RENDER_FAILED prefix and that neither `fetch` nor
`renderBannerServerMock` is called.

The two pre-existing tests that previously asserted
`{ error: "Invalid request body" }` now assert
`{ error: "BANNER_RENDER_FAILED: invalid label" }` and
`{ error: "BANNER_RENDER_FAILED: invalid config.position" }` to match the
new error format.

### AB-007 — `loading="lazy"` lost on calendar tiles — FIXED (bonus)

**File**: `src/features/planner/banner-overlay.tsx` — added
`loading="lazy"` to the underlying `<img>`. Calendar/list grids no longer
eagerly download every banner.

**Test**: covered by a new "lazy-loads the underlying image" case in
`src/features/planner/banner-overlay.test.tsx`.

## Findings explicitly NOT fixed (per brief)

| ID | Status | Reason |
|----|--------|--------|
| AB-001 (migration not in pack) | ACKNOWLEDGED | False positive — migration 1 exists at commit `74c4923`. |
| AB-004 (`object-cover` vs `object-contain`) | ACKNOWLEDGED | Likely deliberate alignment with publish-time render; left as-is per brief. |
| AB-006 (server-side text normalisation) | ACKNOWLEDGED | Low risk; client already normalises. |
| WF-002 (rapid-edit race) | ACKNOWLEDGED | Minor UX edge; left per brief. |
| WF-003 (input draft not reverted on error) | ACKNOWLEDGED | Minor UX edge; left per brief. |
| WF-004 (no "inherit account default" UI) | ACKNOWLEDGED | Product decision flagged for human follow-up — when a user has customised one column, there's no UI affordance to revert just that column to account default. The data layer now supports it (G3) but the UI does not. |
| WF-006 (0-row update success) | ACKNOWLEDGED | Minor UX edge; left per brief. |
| SEC-001 (DNS rebinding) | ACKNOWLEDGED | Residual risk; Supabase host is trusted. |
| SEC-002 (CRON_SECRET vs INTERNAL_RENDER_SECRET) | ACKNOWLEDGED | Architectural choice from prior repair handoff — flagged for human decision. The internal render route uses the same shared secret as cron jobs. Splitting into a dedicated `INTERNAL_RENDER_SECRET` would tighten blast radius if either secret is leaked. |

## Verification

```
npm run ci:verify
```

- `lint:ci` — clean (eslint --max-warnings=0)
- `typecheck` — clean (tsc --noEmit)
- `test:ci` — 405 passed (40 in the four touched test files)
- `build` — successful

## Out-of-scope flags for human follow-up

1. **WF-004 — per-column "inherit account default" UI**. With G3 in place,
   the data layer supports per-field overrides cleanly, but the campaign
   creation form's banner picker doesn't expose a way to "revert this
   column to account default" once you've changed it. Consider adding a
   small reset link next to each customised field, or a "reset to account
   default" button on the section.
2. **SEC-002 — internal render secret**. The `/api/internal/render-banner`
   route authenticates with `CRON_SECRET`. A leaked cron secret would also
   give read access to the (Supabase-allowlisted) banner renderer. A
   dedicated `INTERNAL_RENDER_SECRET` would compartmentalise this. Low
   priority but worth scoping.
