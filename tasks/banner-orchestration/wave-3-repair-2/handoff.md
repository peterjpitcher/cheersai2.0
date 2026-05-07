# Wave 3 / Repair 2 — Codex review fixes — Handoff

## Per-finding status

- F1 SSRF/DoS on render route: FIXED — `1bf4038`
  - URL allowlist tied to `NEXT_PUBLIC_SUPABASE_URL` host, https-only, private/loopback IP rejection, 15s `AbortSignal.timeout`, 25 MB Content-Length pre-check + post-read sanity check.
  - Tests at `tests/app/internal/render-banner-route.test.ts` cover non-allowlisted host, non-https scheme, relative URL, missing/oversized Content-Length, and timeout/abort. 16 tests, all passing.

- F2 posting_defaults silent skip: FIXED — `462e3f9`
  - Worker now distinguishes a query error (throws `BANNER_RENDER_FAILED: posting_defaults query failed: …`) from a missing row (falls back to `DEFAULT_ACCOUNT_BANNERS` mirroring the SQL DEFAULTs in `supabase/migrations/20260507100000_banner_overlay_add_columns.sql`).
  - Two new tests in `tests/publish-queue.test.ts`: error path asserts no platform call + correct error string; missing-row path asserts the banner still renders + uploads + platform call proceeds.

- F3 Label compute throw swallowed: FIXED — `462e3f9`
  - The `console.warn` catch now `throw new Error('BANNER_RENDER_FAILED: label computation failed: …')`. Job fails before any platform call.
  - Test at `tests/publish-queue-banner-label.test.ts` mocks `getProximityLabel` to throw and asserts the failure propagates with the right prefix and the platform is never invoked.

- F4 bannersEnabled at create: FIXED — `2f32f1b`
  - Extracted `computeBannerOverride` from `createCampaignAndContent`. Returns null when `BannerDefaults` matches `DEFAULT_BANNER_DEFAULTS` (user did not customise) or is undefined. Returns appearance-only columns when user customised — never sets `banner_enabled`. The variant therefore inherits the account-level enabled flag.
  - Test at `tests/lib/create/banner-override.test.ts` covers undefined input, exact-defaults input, each individual customisation, and asserts `banner_enabled` is never on the override.

- F5 Two config sources: VERIFIED_OK — `767ea16`
  - Read both modules end-to-end. They encode different concerns:
    - `src/lib/scheduling/banner-config.ts` owns the brand colour-id → hex map, form-side types (`BannerDefaults`, `BannerColourId`), Zod schemas (`BannerConfigSchema`, `BannerDefaultsSchema`), `DEFAULT_BANNER_DEFAULTS`, `BANNER_EDITABLE_STATUSES`, and the `parseBannerConfig` legacy parser.
    - `src/lib/banner/config.ts` owns `BannerPosition`, `AccountBannerDefaults`, `PostBannerOverrides`, `ResolvedConfig`, and the `bannerConfigResolver` pure function.
  - Forms speak colour ids and presets; the resolver speaks resolved hex strings + booleans. Merging them would create circular dependencies between `features/create/*` forms and the publish-time resolver.
  - Action taken: added explicit cross-reference comments to the top of each file so future readers understand the split without grepping both. No code change.

- F6 Weekly dayOfWeek alignment: FIXED — `89dab7f`
  - `metadata.dayOfWeek` is stored in JS getDay() format (0=Sunday..6=Saturday) per `weeklyCampaignSchema.dayOfWeek` and `clampDay`. Both `extractCampaignTiming` (canonical `src/lib/scheduling/campaign-timing.ts`) and the worker copy (`supabase/functions/publish-queue/banner-label.ts`) were passing that integer through as a Luxon weekday (1=Mon..7=Sun) — wrong at the Sunday boundary (`Number(0) || 1` → 1=Monday).
  - Added a `jsDayToLuxonWeekday` helper in both files. Tests in `tests/lib/scheduling/campaign-timing.test.ts` and `tests/supabase/publish-queue/banner-label.test.ts` cover Sunday→7, Monday→1, Saturday→6, and non-numeric fallback.

## CI verify

PASS — lint (zero warnings), typecheck, 609 tests pass, build succeeds.

## Open items

None. All four blocking findings are addressed with tests; F5 is verified-not-an-issue with documentation; F6 was a real bug and is now fixed in both the canonical and worker copies of the timing code.
