# Wave 3 / Repair — Handoff

## What changed
- Re-created `src/app/api/internal/render-banner/route.ts` (POST, Node runtime, CRON_SECRET timing-safe auth via `node:crypto.timingSafeEqual`). The route validates the request body (`sourceMediaUrl`, `config`, `label`), fetches the source media, runs `renderBannerServer`, and returns the JPEG buffer with `content-type: image/jpeg`. Errors are returned as JSON `{ error: "BANNER_RENDER_FAILED: ..." }` with 400/401/500 statuses.
- Added `tests/app/internal/render-banner-route.test.ts` covering 10 cases: missing CRON_SECRET, missing/wrong auth, invalid JSON, invalid body, invalid config position, source download failure, render error (with and without prefix), and the success path.
- Inlined the pure-TS helpers the worker needs as Deno-compatible files alongside the worker:
  - `supabase/functions/publish-queue/banner-config.ts` — mirrors `src/lib/banner/config.ts` (resolver + types).
  - `supabase/functions/publish-queue/banner-label.ts` — mirrors `src/lib/scheduling/campaign-timing.ts` and `src/lib/scheduling/proximity-label.ts` (combined into one file). Imports `luxon` directly to match the existing worker convention.
  - Both files document the duplication at the top with pointers back to the canonical Node sources, matching the pattern already used by `supabase/functions/materialise-weekly/utils.ts`.
- Replaced the in-process Sharp call in `supabase/functions/publish-queue/worker.ts` with an HTTP POST to the render endpoint. The worker now passes the signed source URL, the resolved banner config, and the label as a JSON body, and uploads the response bytes to `banners/{contentId}/{variantId}.jpg`. Non-2xx responses throw `BANNER_RENDER_FAILED: <status> <body>` so the existing failure handling marks the job failed without invoking any platform.
- Added `bannerRenderUrl` and `bannerRenderSecret` to `PublishWorkerConfig`. `createDefaultConfig()` reads `BANNER_RENDER_URL` (or derives it from `NEXT_PUBLIC_SITE_URL` + `/api/internal/render-banner`) and `CRON_SECRET`.
- Updated `tests/publish-queue.test.ts`: the BANNER_RENDER_FAILED test now mocks fetch returning 503 from the render endpoint and additionally verifies the worker called the configured render URL with `authorization: Bearer ...` and `content-type: application/json`. The account-disabled test was unchanged structurally.
- Updated `tests/setup.ts` to provide mock `CRON_SECRET` and `BANNER_RENDER_URL` for both the Node `process.env` and the Deno-mock `Deno.env`.

## Commits
- `9f262fd` feat(banner): add internal render-banner route for Deno worker
- `9c0588c` refactor(publish-queue): call render endpoint over HTTP from Deno worker

## Env / config
- New env vars (read by the publish-queue worker):
  - `BANNER_RENDER_URL` — full URL to the render endpoint. Optional; falls back to `${NEXT_PUBLIC_SITE_URL}/api/internal/render-banner`.
  - `CRON_SECRET` — already present in `src/env.ts`; the worker reuses it as the bearer token sent to the render endpoint.
- No new vars added to `src/env.ts` (the worker uses `Deno.env`/`process.env` directly via `readEnv` and the route uses `process.env.CRON_SECRET` directly, matching the existing cron-route pattern).
- No `.env.example` exists in this repo — nothing to update there. Operators deploying the publish-queue function need to ensure `BANNER_RENDER_URL` (or `NEXT_PUBLIC_SITE_URL`) and `CRON_SECRET` are set in Supabase function env.

## Open items
- The duplicated `supabase/functions/publish-queue/banner-config.ts` mirrors `src/lib/banner/config.ts`, and `banner-label.ts` mirrors `src/lib/scheduling/campaign-timing.ts` + `src/lib/scheduling/proximity-label.ts`. Future edits to either canonical file must be mirrored in the worker copy. This is documented in comments at the top of each duplicate.
- The render endpoint runs the source-URL fetch in the Next.js process. The Supabase signed URL is short-lived (300s) and is sent over the wire — same trust model as today.
- `npm run build` succeeds when all required production env vars are present (verified locally with mock vars). Without them, build fails with the same pre-existing error that affects every API route in this repo (e.g. `notify-failures`, `purge-trash`) — this is not a regression introduced by the repair.

## CI verify
- `npm run lint:ci` — clean.
- `npm run typecheck` — clean.
- `npm run test:ci` — 587/587 tests pass, including the two banner preflight tests in `tests/publish-queue.test.ts` and the 10 new route tests.
- `npm run build` — succeeds with required env vars set; fails without them due to a pre-existing strict env validation in `src/env.ts` (unrelated to this repair, would also fail on `main`).
- `grep -rn '"@/' supabase/functions/` — 0 matches.
