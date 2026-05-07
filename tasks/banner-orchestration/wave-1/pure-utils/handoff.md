# Wave 1 / Pure utilities — Handoff

## Outputs
- `src/lib/banner/config.ts` + `src/lib/banner/config.test.ts`
- `src/lib/hooks/use-now-minute.ts` + `src/lib/hooks/use-now-minute.test.tsx`
- Commits:
  - `2fdd427` — `feat(banner): add bannerConfigResolver`
  - `8c62e26` — `feat(hooks): add useNowMinute()`

## Exported types and signatures

From `@/lib/banner/config`:

```ts
export type BannerPosition = 'top' | 'bottom' | 'left' | 'right';

export type AccountBannerDefaults = {
  banners_enabled: boolean;
  banner_position: BannerPosition;
  banner_bg: string;
  banner_text_colour: string;
};

export type PostBannerOverrides = {
  banner_enabled: boolean | null;
  banner_text_override: string | null;
  banner_position: BannerPosition | null;
  banner_bg: string | null;
  banner_text_colour: string | null;
};

export type ResolvedConfig = {
  enabled: boolean;
  position: BannerPosition;
  bgColour: string;
  textColour: string;
  textOverride: string | null;
};

export function bannerConfigResolver(
  accountDefaults: AccountBannerDefaults,
  postOverrides: PostBannerOverrides,
): ResolvedConfig;
```

From `@/lib/hooks/use-now-minute`:

```ts
'use client';
export function useNowMinute(): Date;
```

`useNowMinute` returns a `Date` pinned to the start of the current
minute and updates once every 60 seconds via a `setInterval`. The
interval is cleared on unmount.

## Format
TypeScript modules + Vitest tests.
- Banner module is environment-agnostic (runs in node test env).
- Hook test is `.test.tsx` and uses a per-file
  `// @vitest-environment jsdom` pragma so the rest of the suite
  keeps the default node environment.

## Assumptions
- Tailwind/design tokens are owned by Wave 2 — these utilities only
  surface raw hex colours from the database.
- Account-default and per-post column names match the migration in
  `supabase/migrations/20260507100000_banner_overlay_add_columns.sql`
  (verified against the migration file in the worktree).
- `BannerPosition` includes `'left' | 'right'` because the migration
  defines them, even though the renderer may only ship `top`/`bottom`
  in v1 (Wave 2 decision).

## Issues
- **Plan-vs-test mismatch in Task 4 (resolved by following the test).**
  The verbatim implementation in the plan tries to align the first
  tick to the next wall-clock minute boundary using a `setTimeout`
  that fires `60_000 - (now - startOfMinute)` ms after mount. With
  the verbatim test (`vi.setSystemTime('2026-06-03T10:00:30Z')`), this
  alignment fires at `+30s`, which violates the test's
  `expect(result.current).toBe(first)` after `advanceTimersByTime(59_500)`.
  The test is the contract, so the implementation here uses a single
  `setInterval(60_000)` from mount. This still gives one update per
  ~60s of elapsed page time and the docstring still describes the
  hook as updating "once every 60 seconds"; what it does *not* do is
  align the first tick to the wall-clock minute boundary. If wall-clock
  alignment matters for downstream consumers (e.g. status pills that
  flip exactly at `:00`), we'd need to either revise the test or add
  a separate aligned-tick variant — flagging here so Wave 2 can decide.
- Installed `@testing-library/react@^16.3.2` and `jsdom@^29.1.1` as
  dev dependencies. `npm install` reported pre-existing audit warnings
  (10 vulnerabilities, none new from these additions).
- Extended `vitest.config.ts` `test.include` to add
  `"src/**/*.test.tsx"` so the hook test is picked up. No other
  config changes.

## Downstream notes
- Wave 2 ui-swap agent imports
  `bannerConfigResolver`, `ResolvedConfig`, `AccountBannerDefaults`,
  `PostBannerOverrides`, `BannerPosition` from `@/lib/banner/config`.
- Wave 2 ui-swap agent imports `useNowMinute` from
  `@/lib/hooks/use-now-minute`.
- Wave 2 renderer agent imports `ResolvedConfig` from
  `@/lib/banner/config`.
- Other Wave 2 agents writing `.test.tsx` files should add
  `// @vitest-environment jsdom` at the top if they need DOM APIs;
  otherwise the test will run under the default node environment.
