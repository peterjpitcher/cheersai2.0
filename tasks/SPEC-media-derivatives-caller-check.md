# SPEC: media-derivatives caller check

## Why

Peter approved this on 29 September 2026 ("lock the image-processing function so only Cheers can
call it"). The `media-derivatives` edge function runs with `verify_jwt = false` and checked no
caller, so anyone with its public URL and an asset id could make it reprocess that asset: reset
its status, overwrite its derivatives and write notifications.

## What we found (29 September 2026, read only)

- **The live function cannot start.** Live is version 7, last deployed on 8 October 2025 from an
  older checkout. A POST with an empty body and no key got `503 {"code":"BOOT_ERROR"}` on both the
  `/functions/v1/` and the `functions.supabase.co` routes, and the function log says
  `The requested module 'https://esm.sh/@ffmpeg/ffmpeg@0.12.6' does not provide an export named
  'createFFmpeg'`. That package version exports only the `FFmpeg` class (the `createFFmpeg` and
  `fetchFile` API ended with 0.11), so the function has most likely not started since that deploy.
  The repo copy has the same import, so a deploy of this change will not start either. The open
  URL is therefore not exploitable today; it would be as soon as the import is fixed, which is why
  the lock goes in first.
- **Callers.** Only `scripts/ops/regenerate-story-derivatives.ts` (supabase-js
  `functions.invoke`, which sends the key as `Authorization: Bearer` and `apikey`) and
  `scripts/ops/invoke-function.ts` (fetch with `Authorization: Bearer`). Both read
  `SUPABASE_SERVICE_ROLE_KEY` from `.env.local`; the regenerate script reads `.env` first when it
  exists (it does not in the main checkout). Function edge logs for three 24-hour windows (22, 27
  and 28 September) show no calls to it; `publish-queue` is the only function called.
- **Which key.** The project has only legacy API keys (`get_publishable_keys` returns the legacy
  `anon` key and no `sb_publishable_` key), so no `sb_secret_` key is in use. Edge logs show the
  Vercel app sends a `service_role` JWT issued at 1759397087 with signature prefix `exZQ6V`, and
  `publish-queue`'s own outbound calls, made with the `SUPABASE_SERVICE_ROLE_KEY` the platform
  injects, carry the same role, issue time and signature prefix. An HS256 signature over the same
  claims with the same secret is identical, so the app's key and the injected key are the same key.
  The local `.env.local` key cannot be checked without reading it; step 1 below checks it without
  printing it.
- **Live v7 against the repo copy** (live source from `get_edge_function`, diffed against the
  repo): the repo copy adds `getImageDimensions()` and `classifyAspect()`, works out an aspect
  class from the original's PNG or JPEG header (ratio below 0.7 is story, above 1.3 is landscape,
  anything else square; other formats such as WebP or HEIC count as square, and EXIF rotation is
  ignored), writes it to `media_assets.aspect_class` in the `ready` update, and adds `aspectClass`
  to the success body. Nothing else differs: same imports, environment variables, queries, storage
  paths and notifications. The classification matches the app's own `backfillMediaAspectClass()`
  in `src/app/(app)/library/actions.ts`, which uses the same thresholds and fallback.
- **Live schema** (`information_schema.columns`, `pg_constraint`, `information_schema.triggers`,
  `storage.buckets`): every column the repo copy reads or writes exists with a compatible type.
  `media_assets`: `id`, `account_id`, `file_name`, `storage_path`, `media_type` (CHECK image or
  video), `processed_status` (CHECK pending, processing, ready, failed or skipped), `processed_at`
  timestamptz, `derived_variants` jsonb, and `aspect_class` text NOT NULL default `square` with a
  CHECK of square, story or landscape, which is exactly what `classifyAspect()` returns.
  `notifications`: `account_id` uuid NOT NULL (foreign key to `accounts`), `category` text,
  `message` text NOT NULL, `metadata` jsonb. Neither table has triggers. The `media` bucket exists
  (private, 5 MB limit, `image/*` and `video/*`).

## Change

- `supabase/functions/media-derivatives/caller-auth.ts`: `isServiceRoleCaller(authorization,
  expectedKey)`. True only for `Bearer <expectedKey>` (scheme in any case). Both keys are hashed
  with SHA-256 and the digests compared with no early exit. It refuses a missing header, another
  scheme, an empty token, a wrong key, and an empty or unset expected key.
- `supabase/functions/media-derivatives/index.ts`: the check is the first thing the handler does,
  before the method check and before the body is read. Anything else gets `401` with an empty
  body. It compares against `SUPABASE_SERVICE_ROLE_KEY`, the key the function already uses for its
  own database and storage calls.
- `supabase/config.toml`: comment updated; `verify_jwt` stays `false`.
- Tests: `tests/supabase/media-derivatives/caller-auth.test.ts` (the check) and `index.test.ts`
  (the entry point, loaded with a stubbed Deno global: no header, a wrong key or the key only in
  `apikey` get 401 with the body unread and no database call; the key reaches the 405, the 400 and
  a 404 for an unknown asset with one read and no write; without its key the function does not
  start).

## Decisions

- Accept only the injected `SUPABASE_SERVICE_ROLE_KEY`, as briefed. No `sb_secret_` key exists,
  so also accepting `SUPABASE_SECRET_KEYS` would add a path nobody uses.
- An empty key never reaches the check: the function already refuses to start without it
  (unchanged; the platform answers 503 and nothing runs). The check refuses an empty key as well,
  in case that guard is ever removed.
- The FFmpeg start-up failure is not fixed here: fixing or retiring the function is a separate
  decision.
- The live v7 source is saved in this change's pull request description for rollback, because
  the platform stops serving it once another version is deployed.

## Deploy and verification

By name only, never a deploy-all. Run from the main checkout, which has `.env.local`.

1. Before deploying, check the local key is the injected key without printing it. Today the
   function cannot start, so nothing runs:
   `npm run ops:invoke -- media-derivatives '{"assetId":"00000000-0000-4000-8000-000000000000"}'`
   (expect a 503). Then read that request's `request.sb.jwt.authorization.payload.role`,
   `issued_at` and `signature_prefix` in `function_edge_logs` for function id
   `9ce12b42-aa95-4598-8e21-c79e027c2f16`. `service_role`, `1759397087` and `exZQ6V` mean the keys
   match. If those fields are empty, rely on step 4 instead.
2. Deploy: `npx supabase functions deploy media-derivatives --project-ref nbkjciurhvkfpcpatbnt
   --no-verify-jwt`, or the MCP deploy with `verify_jwt: false` and both `index.ts` and
   `caller-auth.ts`.
3. While the FFmpeg import is broken, both checks still answer 503 and the function log must show
   the same `createFFmpeg` error at the new version, not a new error. The lock cannot be seen
   working live until the function can start; the tests above are the proof until then.
4. Once the function can start: (a) a POST with no `Authorization` header answers `401` with an
   empty body; (b) the step 1 command answers `404 {"ok":false,"error":"Asset not found"}` with the
   log line `asset fetch failed null` (null means no row, not a database error). A 401 in (b) means
   the local key differs from the injected one; nothing is touched either way. Never use
   `ops:regenerate-story-derivatives` as a check: it runs the function for every image without a
   story derivative (153 on 29 September 2026).

## Rollback

Redeploy the v7 source from the PR description by name with JWT verification off. That restores
today's state exactly, including the start-up failure.

## Later

Supabase's migration guide says the legacy `anon` and `service_role` keys keep working until the
end of 2026 (https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys). The app,
`publish-queue`, this function and both scripts use them. Moving to `sb_secret_` keys means this
check has to read `SUPABASE_SECRET_KEYS`, and callers have to send the key in the `apikey` header,
because secret keys are refused in `Authorization: Bearer`.
