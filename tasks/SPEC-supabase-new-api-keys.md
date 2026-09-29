# SPEC: move CheersAI to Supabase's publishable and secret API keys

Status: Peter approved writing it on 29 September 2026, and the same day approved building and deploying the caller check: report-only first (step 1), then enforced (step 2) after a clean day of logs. Step 1 is built on branch `fix/publish-queue-caller-check-report-only` and waits for its deploy. No key has been created, and no Supabase, Vercel or database setting has changed. Every step that deploys, changes a setting or handles a key needs Peter's yes at the time. Claude never enters, reads or prints a key value; Peter adds and removes every key himself.

## Why

Supabase is retiring the legacy JWT-based `anon` and `service_role` API keys in favour of publishable (`sb_publishable_...`) and secret (`sb_secret_...`) keys. The banner on Supabase's migration guide (read 29 September 2026) says: "Supabase is deprecating the `anon` and `service_role` keys by the end of 2026". The GitHub announcement's timetable has a row dated late 2026, marked TBC, in which the legacy keys are deleted and any app still using them breaks. Sources and dates are listed at the end.

Both kinds of key work at the same time, so each client can move on its own, and the legacy keys are switched off only when nothing depends on them. For CheersAI the move also means:

- a secret key can be rotated or revoked on its own, without rotating the JWT secret that also signs every user's session;
- a secret key is refused when used from a browser;
- a paused project restored since 1 November 2025 comes back without legacy keys, so staying on them is a latent outage.

Planning also found a gap that steps 1 and 2 close: the publish worker accepts any caller holding the public anon key.

## Findings

### The publish worker trusts the public anon key today

- `publish-queue` is the live publishing path. The `publish-scheduler` cron calls it every minute through the legacy bridge (`src/app/api/cron/publish-scheduler/route.ts`), because production's `publish_jobs` has no `platform` column. Tournament "publish now" (`src/app/actions/tournament.ts`) calls it too. Both use the service client.
- It runs with `verify_jwt = true` (`supabase/config.toml`, matched to live on 29 September 2026) and checks nothing itself (`supabase/functions/publish-queue/index.ts`). The platform check accepts any JWT signed with the project's JWT secret, and the `anon` key is such a JWT; Supabase's own 401 troubleshooting guide tells callers to send the anon or service role key to pass it. The anon key ships in every browser bundle.
- The handler takes `leadWindowMinutes` from the request body with no upper limit. `processDueJobs` in `worker.ts` then creates jobs for up to 50 scheduled items due inside that window and publishes up to 20. Anyone with the anon key can therefore pull scheduled posts forward. This comes from the code and the docs; it was not tested live.
- A story more than 5 minutes late is failed as "Story missed its scheduled window" (`worker.ts`, `storyGraceMinutes`), so a publishing outage during this move loses stories rather than delaying them. Late feed posts are picked up on the next run. The order of work is built around this.

### How the new keys behave

From the sources at the end, read 29 September 2026:

- Each key maps to a Postgres role: publishable to `anon` (or `authenticated` when a user is signed in), secret to `service_role`. Row Level Security behaves as before, and policies never apply to a secret key because `service_role` bypasses RLS.
- The new keys are not JWTs. The API gateway checks the key sent on `apikey` (or in a WebSocket query parameter) against the project's keys and forwards a short-lived JWT it mints for the matching role.
- A new key may appear on `Authorization: Bearer` only when it equals the `apikey` value (announcement). Our `supabase-js` 2.89 does exactly that: with no user session it sends the client's key on both headers (`fetchWithAuth` in `@supabase/supabase-js/dist/index.mjs`, read 29 September 2026). Supabase says any client library version works with the new values.
- Edge functions: once the keys exist the platform adds `SUPABASE_PUBLISHABLE_KEYS` and `SUPABASE_SECRET_KEYS` (JSON objects keyed by key name; the first keys are named `default`) next to the legacy `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`, which go on holding the legacy keys. A function called with a secret key should run with `verify_jwt = false` and check the key in its own code. The `@supabase/server` SDK can do that check, but it refuses legacy keys outright.
- Local development: `supabase start` mints its own publishable and secret keys, unrelated to the hosted ones. `supabase status -o env` lists `PUBLISHABLE_KEY` and `SECRET_KEY` with CLI 2.108.0 (checked here by name only). Locally served functions get single `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` values instead of the JSON objects.
- Realtime: a connection without a signed-in user is limited to 24 hours; the announcement adds connections made with a secret key.
- Deactivating the legacy keys is reversible. Deleting a secret key is not.

### Where the docs disagree

- A new key on `Authorization`. The migration guide's Step 4 says the platform tries to parse it as a JWT and rejects it with `Invalid JWT`. The same guide's known limitations, the API keys guide and the Authorization headers guide say `verify_jwt` accepts it for migration compatibility, without authenticating the caller. Community reports in the announcement thread (July and September 2025) saw `Invalid JWT` with `verify_jwt` on. An older copy of the API keys page, still returned by Supabase's docs search on 29 September 2026, said such a request is forwarded and then rejected. The plan depends on none of these: `verify_jwt` goes off for `publish-queue` before any caller holds a new key, the function reads the key itself, and steps 6 and 8 prove the real headers before Production uses them.
- A usage signal. The migration guide says there is no automatic usage indicator; the signing keys guide says to use the last-used indicators on the API Keys page. Step 11 uses the indicator if the dashboard shows one and does not depend on it.

### `auth.role()`, policies and grants

- `auth.role()` reads the role claim of the JWT the database receives. With a secret key that is the gateway's minted JWT for `service_role`, so `auth.role()` returns `service_role`, as it does for the legacy key. The docs do not name `auth.role()`; this follows from the role table in the API keys guide and the gateway description in the signing keys guide.
- The outcome cannot change either way. Every policy that tests `auth.role() = 'service_role'` only adds access for the service role, which bypasses RLS regardless: "OAuth states managed by service role" (`supabase/migrations/20260929115219_oauth_states_service_role_only.sql`), the membership policies (`20260714130000_multibrand_rls_membership.sql`), the reshaped v1 policies (`20260926130000_local_rebuild_matches_production.sql`), and the sign-in throttling and worker heartbeat policies recorded in `supabase/anon-access-allowlist.ts`. For publishable-key requests the test stays false, as it is today for the anon key.
- The secret key acts as the same `service_role` role, so every grant and every `has_*_privilege('service_role', ...)` check in the migrations and `supabase/tests/` still holds.
- No SQL function checks the role claim; only policies do (migrations and `supabase/baseline/v1_baseline.sql` searched). The live project has no `pg_cron`, `pg_net` or database webhooks (`docs/agent-reference.md` section 5, checked 26 September 2026), so no key is stored in the database.
- No code decodes an API key as a JWT. The only JWT decode, `amrMethods` in `src/lib/signup/venue.ts`, reads a signed-in user's access token.

No database migration is needed.

## Inventory (29 September 2026, origin/main at `a6ff44e9`)

### App (Next.js)

| File | Uses | Step |
|---|---|---|
| `src/env.ts` | `resolveSupabaseAnonKey()` reads `NEXT_PUBLIC_SUPABASE_ANON_KEY`, then server-only `SUPABASE_ANON_KEY`; `serverEnv.SUPABASE_SERVICE_ROLE_KEY`; production requires `SUPABASE_SERVICE_ROLE_KEY` | 4, 10 |
| `src/lib/supabase/client.ts` | browser client (Realtime, Storage uploads) with the anon key | 4 |
| `src/lib/supabase/server.ts` | cookie session client with the anon key (about a dozen files: sign-in, sign-up, invitations, `getCurrentUser()`) | 4 |
| `src/lib/supabase/route.ts` | cookie session client for route handlers; nothing imports it | 4 |
| `src/lib/supabase/service.ts` | service client with `SUPABASE_SERVICE_ROLE_KEY` (about 70 files: every server action through `requireAuthContext()`, the crons, the QStash webhooks, the booking ingest, Storage signing, `auth.admin.*`, `functions.invoke`) | 4 |
| `src/app/auth/callback/route.ts` | builds its own server client from `process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY`, bypassing `env.ts` | 4 |
| `src/app/api/cron/publish-scheduler/route.ts`, `src/app/actions/tournament.ts` | `functions.invoke('publish-queue')` through the service client | no code change; relies on steps 1 to 3 |
| `src/hooks/use-realtime-feed.ts`, `src/components/layout/notification-badge.tsx` | Realtime `postgres_changes` through the browser client with the user's session | none; checked in steps 8 and 9 |
| `src/lib/media/upload.ts` | browser Storage upload with the user's session | none; checked in step 8 |
| `auth.admin.*` in `src/app/(app)/admin/actions.ts`, `src/app/(app)/settings/team-actions.ts`, `src/app/signup/actions.ts`, `src/lib/admin/data.ts`, `src/lib/admin/offboarding.ts`, `src/lib/auth/actions.ts`, `src/lib/signup/alerts.ts` | service client (magic links, invites, offboarding, the user list) | none; checked in steps 8 and 9 |

Nothing in `src/` calls Supabase REST, Storage or Functions with its own `apikey` or `Authorization` header. The Vercel crons (`CRON_SECRET`), the QStash webhooks (QStash signatures), the banner renderer (`CRON_SECRET` and signed Storage URLs), the management app client (its own `X-API-Key`) and the feed API keys The Anchor website uses are not Supabase keys; they change only through the service client they already use.

### Edge functions

| File | Uses | Step |
|---|---|---|
| `supabase/functions/publish-queue/index.ts` | no caller check; `leadWindowMinutes` from the body | 1, 2, 10 |
| `supabase/functions/publish-queue/worker.ts` | `createDefaultConfig()` reads `SUPABASE_SERVICE_ROLE_KEY` for its own client (database and Storage signed URLs) | 7, 10 |
| `supabase/config.toml` | `publish-queue` `verify_jwt = true` | 3 |

`publish-queue` is the only edge function. `media-derivatives` was retired on 29 September 2026 (PR #166, `tasks/SPEC-retire-media-derivatives.md`): its code, its config block and `scripts/ops/regenerate-story-derivatives.ts` are gone from main, and `supabase/config.toml` records the live copy as deleted.

### Scripts

| File | Uses | Step |
|---|---|---|
| The 14 scripts in `scripts/ops/` (archive-planner-failures, backfill-connections, backfill-event-overlays, backfill-link-in-bio-url, backfill-opt-in-overlays, bootstrap-super-admin, cleanup-banner-storage, diagnose-publishing, invoke-function, link-auth-user, remove-slot-language, repair-hidden-media-references, search-meta-interests, seed-world-cup-2026) and `scripts/export-social-copy-csv.mjs` | `SUPABASE_SERVICE_ROLE_KEY` from `.env.local`, which points at production | 4, 10 |
| `scripts/ops/invoke-function.ts` | a raw `fetch` that sends the key only as `Authorization: Bearer` | 4 |

### Tests and CI

| File | Uses | Step |
|---|---|---|
| `tests/setup.ts` | sets `NEXT_PUBLIC_SUPABASE_ANON_KEY`; its Deno stub returns `SUPABASE_SERVICE_ROLE_KEY` | 7, 10 (step 1's tests stub `Deno` themselves) |
| `tests/lib/env-site-url.test.ts`, `tests/lib/env-turnstile.test.ts` | production environment fixtures with the legacy names | 4, 10 |
| `tests/connectionDiagnostics.test.ts`, `tests/lib/campaigns/actions-ads.test.ts`, `tests/lib/campaigns/oauth.test.ts`, `tests/mediaAssetsData.test.ts`, `tests/plannerActivity.test.ts`, `tests/tokenExchange.test.ts` | set the legacy names in `process.env` | 10 |
| `.github/workflows/ci.yml` | `NEXT_PUBLIC_SUPABASE_ANON_KEY: placeholder-key` in the build and e2e jobs (three places); `migration-check` starts only the database and uses no key | 10 |

The repository has no GitHub Actions secrets or variables at repository or environment level (checked 29 September 2026), so CI holds no Supabase key.

### Environments

| Where | Holds today | Step |
|---|---|---|
| Vercel Production and Preview (and Development if used) | `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, possibly `SUPABASE_ANON_KEY` (from what the code reads; Vercel itself was not inspected) | 8, 9, 10 |
| Edge function environment | the platform-injected `SUPABASE_SERVICE_ROLE_KEY`, the same key the Vercel app sends (PR #164's comparison of edge log claims) | 5, 7 |
| Peter's `.env.local` in the main checkout (points at production) | the service role key the ops scripts use | 6, 10 |
| Local Supabase stack | its own keys; the new names are available | 4 (docs only) |
| Other repositories | none: no repository under `/Users/peterpitcher/Cursor` references this project in code (searched 29 September 2026, env files not opened) | none |

The Supabase CLI (`db push`, `functions deploy`) and the Supabase MCP server sign in with a personal access token, not the project API keys, so they are not affected.

### Documents

Updated in steps 4 and 10: `CLAUDE.md` (environment list), `docs/agent-reference.md` section 6, `docs/architecture/relationships.md`, `docs/runbooks/credential-rotation.md` (its service role section describes regenerating a key that the legacy scheme cannot regenerate on its own), `README.md`, `.env.example`, `Obsidian/OJ-CheersAI2.0/Architecture/Overview.md`, and the comments in `supabase/config.toml`.

Left as historical records: `HANDOFF.md`, `.planning/`, `docs/redesign-plan/`, `docs/publishing-consultant-report.md`, `docs/plans/`, `docs/superpowers/plans/`, `tasks/codex-qa-review/`, `tasks/banner-orchestration/`, `tasks/PLAN-multi-brand-PR1-foundation.md`, `tasks/SPEC-magic-link-resend.md`, `tasks/tournament-module-patterns.md`.

## Decisions

1. Variable names: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`, the names the API keys guide uses and the Vercel Marketplace integration syncs.
2. The migration uses the `default` keys the dashboard creates.
3. The app keeps the `supabase-js` defaults rather than hand-built headers.
4. `publish-queue` checks its caller in its own code rather than with `@supabase/server`, because that SDK refuses the legacy key and both kinds of key must work during the move.
5. `publish-queue` accepts any of the project's secret keys, not only `default`. Every secret key already has full access to the project, so this grants nothing new, and a second named key works without a code change.
6. The caller check runs report-only first and is enforced only after the logs show every real caller accepted.
7. `verify_jwt` goes off for `publish-queue` once the check is enforced, and before any new key exists.
8. The app switches one environment at a time by adding the new variables and redeploying. The code prefers the new name and falls back to the legacy one until step 10.
9. Builds fail when a public variable holds a secret key or the server variable holds a publishable key. From step 10, production also requires the `sb_publishable_` and `sb_secret_` prefixes.
10. Names such as `createServiceSupabaseClient` stay: a secret key still acts as the `service_role` role.
11. No SQL, policy or grant changes.
12. Historical documents stay as they are.
13. The legacy keys are deactivated, not left on, and only after a two-week quiet period in which no code or Vercel variable can use them.

## Order of work

| Step | What | Who | Deploys | Target |
|---|---|---|---|---|
| 1 | publish-queue checks its caller, report-only | Claude builds; Peter approves the deploy | publish-queue | Thu 1 Oct |
| 2 | Enforce the caller check | Claude; Peter approves | publish-queue | Mon 5 Oct |
| 3 | `verify_jwt` off for publish-queue | Claude; Peter approves | publish-queue | Tue 6 Oct |
| 4 | App and scripts read the new names first | Claude; Peter approves | app, no behaviour change | Wed 7 Oct |
| 5 | Create the new keys | Peter | none | Thu 8 Oct |
| 6 | Local check with the new secret key | Peter, guided by Claude | none | Thu 8 Oct |
| 7 | publish-queue's own client on the secret key | Claude; Peter approves | publish-queue | Mon 12 Oct |
| 8 | Preview on the new keys | Peter adds the variables | a Preview | Wed 14 Oct |
| 9 | Production on the new keys | Peter adds the variables and approves the redeploy | app | Tue 20 Oct |
| 10 | Remove the fallbacks and the legacy variables | Claude; Peter approves and removes the variables | app, publish-queue | Tue 27 Oct |
| 11 | Quiet period and log checks | Claude, read only | none | 27 Oct to 10 Nov |
| 12 | Deactivate the legacy keys | Peter | none | Tue 10 Nov |

Health checks used below, all read only, all runnable by Claude:

- Heartbeat: `select last_run_at, last_run_source from public.worker_heartbeats where name = 'publish-queue'` advances every minute, with source `vercel-publish-scheduler`.
- Publishing: the next scheduled post publishes, and no new `publish_jobs` row fails with an authentication error.
- Scheduler: Vercel logs for `/api/cron/publish-scheduler` show 200s and no "Legacy publish queue invocation failed".

Every publish-queue deploy is by name only (`npx supabase functions deploy publish-queue --project-ref nbkjciurhvkfpcpatbnt`), never a deploy-all.

### Step 1. publish-queue checks its caller, report-only

What:
- A new `supabase/functions/publish-queue/caller-auth.ts`. Allowed keys: every value in `SUPABASE_SECRET_KEYS`, the local single `SUPABASE_SECRET_KEY`, and, until step 10, the legacy `SUPABASE_SERVICE_ROLE_KEY`. Presented credentials: the `apikey` header and the token in `Authorization: Bearer`, trimmed. Keys are compared as SHA-256 digests with no early exit, as closed PR #164 did for media-derivatives. Malformed JSON adds no key. With no allowed key at all, every call is refused and an error logged.
- `index.ts` runs the check before the method check and before reading the body. In this step it only logs the verdict (accepted or refused, which kind of key, which header matched, never any part of a key) and then carries on exactly as today.
- Vitest, including `index.ts` under a stubbed Deno global: the legacy key on either header, a secret key from the JSON, the local single key, the anon key, a publishable-looking key, no header, wrong and truncated keys, malformed JSON and an empty configuration.
- Before the deploy, compare the live source (`get_edge_function`, read only) with main, so the deploy carries only this change. Any other difference goes to Peter first.

As built (29 September 2026):
- `caller-auth.ts` reads the environment on every request, so secret keys the platform adds at step 5 are accepted without a deploy (risk 10). A `SUPABASE_SECRET_KEYS` value that is not a JSON object of non-empty strings adds no key at all and logs an error; `{}` or a blank value is simply no secret keys. Allowed and presented keys are trimmed. `Authorization` is read only as `Bearer <token>` (scheme in any case); a raw key or another scheme counts as no credential.
- Both callers send the legacy key on both headers. They call `functions.invoke('publish-queue')` on the service client (`createServiceSupabaseClient()`; tournament publishing gets it from `requireAuthContext()`), which has `persistSession: false` and no session, so supabase-js 2.89 sends `apikey: <SUPABASE_SERVICE_ROLE_KEY>`, `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`, `Content-Type: application/json` and `X-Client-Info: supabase-js-node/2.89.0`. `tests/publish-queue-index.test.ts` captures that request from the real client and feeds it to `index.ts`.
- With `verify_jwt` on, a request without a valid project JWT never reaches the function, so any refused line in this step comes from a caller holding the anon key or a signed-in user's session token (any user of any brand passes the platform check too).
- One log line per request, on a single line, before the method check: `[publish-queue] caller accepted {...}` (info) or `[publish-queue] caller refused {...}` (warning, or error when no allowed key is configured). The JSON holds only `reason`, `keyKind`, `matchedHeader`, `presented`, `method`, `enforced`, `legacyServiceRoleKeyConfigured` and `secretKeysConfigured`; never any part of a key or token. The scheduler's line is `[publish-queue] caller accepted {"reason":"matched","keyKind":"legacy_service_role","matchedHeader":"both","presented":"both","method":"POST","enforced":false,"legacyServiceRoleKeyConfigured":true,"secretKeysConfigured":0}`. These land in the `function_logs` source, one per `function_edge_logs` POST.
- Step 2 is one line: `export const CALLER_CHECK_ENFORCED = false;` becomes `true` in `caller-auth.ts`. `index.ts` already returns `new Response(null, { status: 401 })` when the flag is on and the caller is refused, before the method check and the body. The enforced behaviour is already tested through a module mock of that flag.
- `tests/setup.ts` did not need to change: the new tests stub `Deno` themselves.
- Baseline before the deploy (`function_edge_logs`, 15:00 to 16:55 UTC on 29 September 2026): 95 POSTs, all 200, all with a `service_role` JWT, none with a new-key `apikey` prefix, no other callers.
- A local Deno run of this branch fetched `supabase-js@2.117.1` from esm.sh for the worker (risk 9); the deploy will bring in whatever 2.x esm.sh serves that day.

Checks: at least 24 hours of logs, including a weekend. Every scheduler call, and any tournament call, is logged as accepted with the legacy key. Any refused call is listed for Peter (scanners, or the misuse described in Findings). Heartbeat and publishing are unchanged.

Rollback: redeploy the previous source by name.

### Step 2. Enforce the caller check

What: a one-line change so refused callers get an empty 401 before the body is read or the database touched. `verify_jwt` stays on.

Checks: heartbeat, publishing and scheduler checks for 30 minutes. A GET with no key and a GET with the anon key (public, so safe to use) both get 401 from our code, which the function edge log shows as a run with an execution id.

Rollback: redeploy the step 1 version (report-only).

### Step 3. Turn `verify_jwt` off for publish-queue

What: `verify_jwt = false` for `publish-queue` in `supabase/config.toml`, with the comment saying the function checks its caller; deploy by name with `--no-verify-jwt`. With the check enforced, the platform check adds nothing. Switching it off before any new key exists means no caller can be refused over how the platform reads a new key.

Checks: `list_edge_functions` (read only) shows `verify_jwt` false; heartbeat, publishing and scheduler checks; the no-key and anon GETs still get 401 from our code.

Rollback: set it back to true and deploy by name. This is safe while every caller sends the legacy key, which is the case until step 9.

### Step 4. App and scripts read the new names first

What:
- `src/env.ts`: the publishable key is `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, else `NEXT_PUBLIC_SUPABASE_ANON_KEY`, else the server-only `SUPABASE_ANON_KEY`, each read by its literal name so Next.js inlines it. The server key is `SUPABASE_SECRET_KEY`, else `SUPABASE_SERVICE_ROLE_KEY`. An empty value counts as unset. Production requires one server key.
- Two guards fail the build and the start in every environment, whatever `SKIP_ENV_VALIDATION` says: an `sb_secret_` value in a public variable (it would ship to every browser), and an `sb_publishable_` value in the server variable (the service client would run as `anon`, RLS would quietly return nothing, and the scheduler would find no jobs).
- `client.ts`, `server.ts`, `route.ts` and `service.ts` read `env.client.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `env.server.SUPABASE_SECRET_KEY`; `src/app/auth/callback/route.ts` reads `env.ts` instead of `process.env`.
- One small helper for the ops scripts reads `SUPABASE_SECRET_KEY`, else `SUPABASE_SERVICE_ROLE_KEY`, and all 15 scripts use it (the `.mjs` file inlines the same fallback).
- `invoke-function.ts` sends the key on `apikey` as well as `Authorization` (the same value, as `supabase-js` does) and gains `--check`: a GET that reports accepted (405) or refused (401) without running the function or printing the key.
- `.env.example` and `docs/agent-reference.md` name the new variables first and the legacy ones as fallbacks until step 10.
- Tests for the resolution order and both guards. Existing tests keep passing through the fallback.

Checks: `npm run ci:verify`. The Production deploy builds and starts; sign-in, the planner and the next cron runs behave as before. No environment has the new names yet, so every client still uses the legacy keys.

Rollback: revert and redeploy.

### Step 5. Peter creates the new keys

What: in the Supabase dashboard, Settings > API Keys > Publishable and secret API keys > Create new API keys. This adds a `default` publishable key and a `default` secret key; the legacy keys keep working.

Nothing is pasted into the edge function secrets. The platform adds `SUPABASE_PUBLISHABLE_KEYS` and `SUPABASE_SECRET_KEYS` itself, and secret names starting `SUPABASE_` are reserved. Peter confirms both appear under Edge Functions > Secrets.

Peter then looks at Vercel's environment variables. If a Supabase variable appeared without him adding it (an integration syncing keys), he tells Claude before the next deploy. Steps 1 to 4 make that safe, and the next Production deploy is then treated as step 9, with its checks.

Checks: Claude confirms, read only, that an `sb_publishable_` key exists (`get_publishable_keys`). Heartbeat and publishing are unchanged.

Rollback: none needed; unused keys change nothing.

### Step 6. Local check with the new secret key

What: Peter adds `SUPABASE_SECRET_KEY` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to his main checkout's `.env.local` (Claude never opens it). Then, read only: `npx tsx scripts/ops/diagnose-publishing.ts` (it only selects) runs cleanly, and `npm run ops:invoke -- publish-queue --check` reports accepted.

This proves, before any live path uses the key, that the secret key works through `supabase-js` 2.89 (key on both headers) against production, and that publish-queue accepts it.

Rollback: remove the lines; the scripts fall back to the legacy key.

### Step 7. publish-queue's own client uses the secret key

What: `createDefaultConfig()` reads the `default` entry of `SUPABASE_SECRET_KEYS` (or the local single key), else the legacy key, and logs once at start which kind it uses, never the key. The Deno stub in `tests/setup.ts` gains `SUPABASE_SECRET_KEYS`. Deploy by name.

Checks: the start log names the secret key; heartbeat, publishing and scheduler checks, including a post with a banner overlay if one is due (it signs Storage URLs).

Rollback: redeploy the step 3 version by name.

### Step 8. Preview on the new keys

What: Peter adds `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` (marked Sensitive) to Vercel Preview only, then redeploys a Preview. Preview uses the production database, so the checks read, and write only to Peter's own account.

Checks: sign in; the dashboard, planner and library load with images; the notification badge and activity feed connect, with no "[realtime] Supabase realtime disabled" warning in the browser console; the super-admin page lists users; Supabase requests in the browser's network tab carry an `sb_publishable_` `apikey`, not a long `eyJ` key. Do not use tournament "publish now" on Preview: it publishes real posts.

Rollback: remove the two Preview variables and redeploy the Preview.

### Step 9. Production on the new keys

What: Peter adds the two variables to Production (and to Development if he uses `vercel env pull`). Production is redeployed with his yes, and the deployment id recorded. Timing: a weekday mid-morning, not a Friday, not 24 or 25 October, no post due within 15 minutes, with Peter free for an hour.

Checks, first 30 minutes: scheduler, heartbeat and publishing checks; publish-queue's function edge logs show callers sending a new key (`request.sb.apikey.apikey.prefix` set); Peter signs in with his password and gets a magic link at his own address (`auth.admin.generateLink`); planner images and the notification badge work. Next day: the hourly crons (:20 and :30) and the daily ones (03:15, 03:45, 06:00, 06:30 and 08:00) return 200, and so does the Sunday 01:00 run.

Rollback: roll back to the previous Production deployment in Vercel (built with the legacy keys), or remove the two variables and redeploy. publish-queue accepts both kinds of key, so publishing works in either state.

### Step 10. Remove the fallbacks and the legacy variables

What:
- `src/env.ts` reads only the new names; production requires the `sb_publishable_` and `sb_secret_` prefixes.
- publish-queue accepts secret keys only, on `apikey` only; its own client uses only the secret key and refuses to start without one. Deploy by name.
- The ops helper reads only `SUPABASE_SECRET_KEY`.
- Tests use the new names; CI's three placeholders become `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- The documents listed under Inventory are updated. The credential rotation runbook describes rotating a secret key: create a new one, swap it in, confirm, then delete the old one.
- Once the deploys pass their checks, Peter deletes `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and any `SUPABASE_ANON_KEY` from every Vercel environment and from `.env.local`, and Production is redeployed.

Checks: as step 9, after each deploy.

Rollback: revert. Peter re-adds the legacy variables (the legacy keys are still active and shown in the dashboard) and Production is redeployed.

### Step 11. Quiet period, two weeks, read only

Checks: publish-queue's function edge logs show every accepted call carrying a new key; the last-used indicator for the legacy keys on the API Keys page, if shown, has not moved since step 10; Supabase logs show no failures from unknown callers; `list_edge_functions` (read only) still shows `publish-queue` as the only function.

### Step 12. Peter deactivates the legacy keys

What: Settings > API Keys, legacy keys tab, deactivate, on a weekday mid-morning.

Checks, for 48 hours: heartbeat, publishing, sign-in and the crons. The Management API reports the legacy keys disabled (read only).

Rollback: re-activate them in the same place.

## Risks

1. Publishing stops because publish-queue refuses its caller, and any story that misses its 5-minute window is lost. Avoided by: report-only before enforcing (step 1); accepting both kinds of key from step 1 to step 10; `verify_jwt` off before any new key exists (step 3); proving the secret key against the function locally before Vercel uses it (step 6); and, after every publish-queue deploy, watching the heartbeat and the next post, with rollback by redeploying the previous source by name.
2. A secret key reaches the browser bundle. The step 4 guard fails the build. A secret key also answers 401 in a browser, but it would still have leaked.
3. A publishable key in `SUPABASE_SECRET_KEY` makes the service client run as `anon` and quietly see nothing. The step 4 guard fails the build, and step 10's prefix check backs it up.
4. The docs disagree about a new key on `Authorization`. The plan does not depend on either reading (see Findings), and steps 6 and 8 prove the real headers before Production.
5. A caller nobody knew about still uses a legacy key when they are switched off. Covered by this inventory, two weeks in which no code or Vercel variable can use a legacy key, the step 11 checks, and deactivation being reversible.
6. A variable change without a redeploy does nothing: public values are inlined at build time, and Vercel applies variable changes only to new deployments. Every variable step ends with a redeploy and a recorded deployment id.
7. Realtime's 24-hour limit applies only without a signed-in user. CheersAI's Realtime runs on signed-in pages with the user's session. Checked in steps 8 and 9.
8. Sign-in fails closed when the rate limiter's database call fails, so a bad service key blocks sign-in. Sign-in is checked in steps 8 and 9, and rollback restores it.
9. Every publish-queue deploy re-resolves `https://esm.sh/@supabase/supabase-js@2`, so it can bring in a newer 2.x client. The post-deploy checks cover it.
10. Edge function instances may start seeing the new keys without a deploy once step 5 is done. The caller check then accepts secret keys straight away, which is harmless: every secret key already has full access.
11. Supabase could fix the deletion date earlier than the end of 2026. Finishing by 12 November leaves seven weeks, and a slip of up to four weeks still finishes by mid-December.

## Timeline

The order matters more than the dates. The dates avoid Fridays, the weekday food test (it ends on Friday 16 October per `tasks/READOUT-weekday-food-queries.md`, and the Production switch waits until after it so its daily sync and optimiser runs are not disturbed), and the clock change on Sunday 25 October.

- Tue 29 Sep: this plan.
- Thu 1 Oct: step 1. Mon 5 Oct: step 2. Tue 6 Oct: step 3. Wed 7 Oct: step 4.
- Thu 8 Oct: steps 5 and 6. Mon 12 Oct: step 7. Wed 14 Oct: step 8.
- Tue 20 Oct: step 9. Tue 27 Oct: step 10.
- 27 Oct to 10 Nov: step 11. Tue 10 Nov: step 12, watched until Thu 12 Nov.

## Assumptions

- Production has no publishable or secret key yet (PR #164, 29 September 2026: `get_publishable_keys` returned only the legacy anon key).
- The Vercel app's service role key is the key the platform injects into edge functions (PR #164's comparison of edge log claims, 29 September 2026). Step 1's report-only phase confirms it before anything is enforced.
- Vercel Preview uses the production Supabase project (`docs/runbooks/stripe-billing.md`).
- The Supabase GitHub integration's "Deploy to production" and "Automatic branching" are off (29 September 2026, `tasks/SPEC-migration-history-alignment.md`), so functions deploy only by hand, by name.
- The anon key passes publish-queue's `verify_jwt` check today (from the docs; not tested live).
- The live project has no `pg_cron`, `pg_net` or database webhooks (checked 26 September 2026).

## Not in scope

- JWT signing keys: a separate, later migration. After this plan the legacy JWT secret still signs user sessions and Storage signed URLs, and anyone holding it could still mint a service role token.
- The workspace's other Supabase projects, such as the management app's, face the same deadline under their own plans.

## Sources, read 29 September 2026

1. Migrating to publishable and secret API keys, https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys. The deprecation banner is quoted under Why. The introduction says both key types work at the same time, so clients move one at a time and the legacy keys are deactivated only when nothing depends on them. Step 1: creating keys adds `default` publishable and secret keys alongside the legacy ones, which keep working. Step 3: secret keys return 401 in a browser. Step 4: the two JSON environment variables, read by name (`default`); keys go on `apikey` only; `verify_jwt` only understands the legacy keys, so turn it off and authorise in code. Step 5: there is no automatic usage indicator; it lists easy-to-miss callers (CI, cron jobs, workers, webhooks). Step 6: deactivation is reversible. Known limitations: `verify_jwt` accepts the new keys on `Authorization` for migration compatibility without authenticating the caller; functions must authorise keys in code; public Realtime connections last at most 24 hours. Next steps: the JWT signing keys migration is separate.
2. API keys, https://supabase.com/docs/guides/getting-started/api-keys. The key to role table (publishable to `anon` or `authenticated`, secret to `service_role`, which has `BYPASSRLS`); the new keys are not JWTs; `supabase start` prints local keys that replace the local service role key and are unrelated to hosted keys; the variable names `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`; in edge functions the legacy variables still hold the legacy keys; rotation (deleting a secret key cannot be undone, deactivating legacy keys can); the same known limitations.
3. Upcoming changes to Supabase API Keys, https://github.com/orgs/supabase/discussions/29260 (opened 12 September 2024, last edited 3 October 2025). Timetable: early preview June 2025; full launch July 2025; from November 2025 monthly reminders, projects restored from 1 November 2025 come back without legacy keys, and new projects have none; late 2026 (TBC) legacy keys deleted and removed from the docs and dashboard, and apps not migrated break. A new key may be used on `Authorization` only when it exactly matches `apikey`. Realtime connections last 24 hours with no signed-in user or with a secret key. Functions protected only by `verify_jwt` need `--no-verify-jwt` and their own protection. Any client library version can be initialised with the new values.
4. JWT signing keys, https://supabase.com/docs/guides/auth/signing-keys (FAQ). The gateway verifies the API key and mints a short-lived JWT that it forwards to the project's servers; use the last-used indicators on the API Keys page before deactivating the legacy keys; the legacy JWT secret signs the `anon` and `service_role` keys and user tokens.
5. Authorization headers, https://supabase.com/docs/guides/functions/auth-headers. `verify_jwt` validates legacy HS256 JWTs and signing-key JWTs, and for migration compatibility accepts the new keys on either header without authenticating the caller.
6. Securing Edge Functions, https://supabase.com/docs/guides/functions/auth. Service-to-service calls send a secret key on `apikey`, with `verify_jwt` off and the key validated in code; local development uses single `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` values.
7. Environment variables, https://supabase.com/docs/guides/functions/secrets. The injected defaults, including the two JSON dictionaries and the legacy keys; secret names cannot start with `SUPABASE_`.
8. Edge Function 401 error response, https://supabase.com/docs/guides/troubleshooting/edge-function-401-error-response. Function edge logs record the API key prefix (`request.sb.apikey.apikey.prefix`) and JWT claims (`request.sb.jwt.authorization.payload.*`); to keep the built-in check, send the anon or service role key.
9. `@supabase/server` auth modes, https://github.com/supabase/server/blob/main/docs/auth-modes.md. The SDK rejects the legacy `anon` and `service_role` keys and legacy HS256 user JWTs.
10. Vercel Marketplace, https://supabase.com/docs/guides/integrations/vercel-marketplace. The synced variables include `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`.
11. Management API, https://supabase.com/docs/reference/api/v1-get-project-legacy-api-keys. Reports whether the legacy keys are enabled.
12. Community reports of `Invalid JWT` with `verify_jwt` on and a new key: https://github.com/supabase/supabase/discussions/29260#discussioncomment-13812388 (18 July 2025) and https://github.com/supabase/supabase/discussions/29260#discussioncomment-14542443 (29 September 2025).
