# PLAN: New customer readiness, Stage 1 (a second venue can use organic posting safely)

Spec: `tasks/SPEC-new-customer-readiness.md` §5 Stage 1. Written 2026-09-24. Six PRs plus off-app checks, each independently deployable and revertable. Order matters only where stated.

Goal: an invited, non-Anchor venue can log in, set a password, connect its own Facebook Page and Instagram, create and publish posts, and never sees Anchor text, Anchor links, paid ads or tournaments. The Anchor's behaviour does not change.

## Off-app (start now, longest lead time)

- [ ] O1 Meta App Dashboard: record app mode (Live or Development), Business Verification status, and access level (Standard or Advanced) for each organic scope in `src/lib/connections/oauth.ts:4-12`. Result goes in spec D7. Owner: Peter.
- [ ] O2 If any organic scope lacks Advanced Access: submit App Review with a screencast of connect, create, schedule and publish on a test Page, and the privacy, terms and data-deletion URLs. Depends on PR1 for a working deletion callback if Meta reviews it (spec §4.8 work sits in Stage 2, so check whether the current callback is accepted first).
- [ ] O3 Supabase dashboard > Auth: record whether sign-ups are enabled. With PR1 merged it no longer matters for magic links, but record it for Stage 3.

## PR1 `fix/auth-invite-and-passwords` (A2, A3, A4, A5)

- [ ] Add `shouldCreateUser: false` to both `signInWithOtp` calls (`src/lib/auth/actions.ts:43-48`, `src/app/api/auth/magic-link/route.ts:35-40`). An unknown email gets the same neutral "check your email" message, so account existence is not revealed.
- [ ] Rework `inviteUser` (`src/app/(app)/admin/actions.ts:247`) so the invite no longer depends on the Supabase email template and membership is written before any email is sent:
  1. `auth.admin.generateLink({ type: 'invite', email })` creates the user and returns `hashed_token` without sending mail.
  2. Upsert `account_members` rows; on failure, return an error and send nothing (the operator retries; the step is idempotent).
  3. Send the invite through `src/lib/email/resend.ts` with a link to `/auth/confirm?token_hash=...&type=invite&next=/auth/set-password`.
  4. If the send fails, show the operator an error with a "resend invite" action (new `generateLink` call).
  - Existing-user case stays as today (assign a brand instead).
- [ ] `/auth/confirm`: send failures to `/login?error=invalid_confirmation` (currently `/auth/login`, which redirects again), and allow only relative `next` paths.
- [ ] New `/auth/set-password` page and server action (`supabase.auth.updateUser({ password })`), minimum 12 characters, used after invite and after reset.
- [ ] Replace the `forgot-password` redirect with a real page: `resetPasswordForEmail` with redirect to `/auth/confirm?...&type=recovery&next=/auth/set-password`, rate limited like the login actions, neutral response. Needs the recovery email template to send `token_hash`; if the live template is the default, send the recovery link through Resend via `generateLink({ type: 'recovery' })` instead (same pattern as invites, no dashboard dependency). Prefer the Resend route for consistency.
- [ ] Delete `src/app/proxy.ts` after confirming nothing imports it (grep shows no imports) and adding a note in CLAUDE.md that there is no proxy.
- [ ] Render the invite and reset emails with fixture data in a test; fail on `undefined`, empty link or wrong host.
- [ ] Tests (fail closed): membership write fails, then no email is sent and the operator sees an error; email send fails, then the operator sees an error and membership exists; `updateUser` fails, then the user sees an error; `shouldCreateUser` is false on both paths; `next` rejects absolute URLs.
- [ ] Manual check on a preview deployment: invite a test address, follow the email, set a password, log in with it, log out, reset, log in again.

## PR2 `feat/brand-feature-gates` (D1b, D1c)

- [ ] Migration (expand only): `accounts.paid_ads_enabled`, `accounts.tournaments_enabled` and `accounts.management_import_enabled`, each `boolean not null default false`; set all three true for The Anchor by id. Orange Jelly stays off (toggle in admin if wanted). Follow the `prod-migrate` skill; do not apply to production without approval.
- [ ] Load both flags in the auth context with the active brand (`src/lib/auth/membership.ts`).
- [ ] Hide the Campaigns and Tournaments nav items (`src/config/app-nav.ts:29,31`) when off.
- [ ] Guard the routes: `src/app/(app)/campaigns/layout.tsx` and `src/app/(app)/tournaments/layout.tsx` return `notFound()` when the flag is off.
- [ ] Guard every server action in `src/app/(app)/campaigns/actions.ts`, `campaigns/[id]/actions.ts`, `src/app/actions/tournament.ts`, `src/app/actions/tournament-images.ts`, and the ads OAuth start route `/api/oauth/facebook-ads`, with one helper `requireFeature(ctx, 'paid_ads' | 'tournaments')`.
- [ ] Management import gate (`management_import_enabled`):
  - Hide the "Import from management app" block in `src/features/create/forms/event-fields.tsx:123` and any promotion import in the create wizard.
  - Guard `listManagementEventOptions`, `getManagementEventPrefill`, `listManagementPromotionOptions`, `getManagementPromotionPrefill` (`src/app/(app)/create/actions.ts`), the artwork route `src/app/api/create/event-artwork/route.ts`, and the settings save and test actions (`src/app/(app)/settings/actions.ts`).
  - Hide the settings panel (`management-connection-form.tsx`) unless the flag is on or the viewer is a super-admin; rename it "Management app"; stop pre-filling `DEFAULT_MANAGEMENT_APP_BASE_URL` for brands without a connection.
  - Link-in-bio "what's on" (`src/lib/link-in-bio/public.ts:563`) skips management events when the flag is off.
  - Belt and braces: `getManagementConnectionConfig()` refuses when the flag is off, so any path missed above still fails closed.
- [ ] Crons (`sync-meta-campaigns`, `optimise-meta-campaigns`) are unaffected: they act only on campaigns that exist, which only enabled brands can create.
- [ ] Admin page: toggles for both flags per brand, logged through `logAdminEvent`.
- [ ] Tests: flag off, then nav hidden, route 404s, each guarded action returns an error, import block hidden, `getManagementConnectionConfig()` refuses even if a connection row exists; flag on for The Anchor, then unchanged behaviour.

## PR3 `fix/remove-anchor-defaults` (T4, T7; T6 moved to PR2)

- [ ] T7: neutral placeholders in `link-in-bio-profile-form.tsx`, `profile-form.tsx`, `tile-editor.tsx`; no pre-filled slug (suggest one from the brand's display name instead); remove "The Anchor" from prompt examples in `src/lib/ai/prompts.ts:42-43,387` (replace with a neutral example, then check AI copy tests still pass); delete `OWNER_ACCOUNT_ID`, `OWNER_EMAIL` and `src/lib/supabase/owner.ts` if unused.
- [ ] Login page (`src/app/(auth)/login/page.tsx`): remove the invented testimonial ("Sarah Mitchell, The Rose & Crown") and the Google Business Profile claim; a new customer sees this page first.
- [x] T4: moved to the paid-ads work with T1. Campaigns are now gated to The Anchor (PR2), for which the Anchor booking default is correct; blanking it would only add friction for the one brand that can reach it. Fix it together with the ad host allowlist before paid ads are offered to anyone else.
- [ ] Test: grep-based test that fails if `the-anchor` or `The Anchor` appears in `src/` outside an allow-list (tournament and campaign modules, which are gated, plus The Anchor's id constant).

## PR4 `fix/media-tenant-scope` (I1)

- [ ] `resolveThumbnails` takes the active `accountId` and adds `.eq('account_id', accountId)` to the `media_assets` lookup (`src/lib/media/resolve-thumbnails.ts:89`); update all callers.
- [ ] On every write that sets `content_variants.media_ids` (or attachment rows), reject media ids that do not belong to the active brand.
- [ ] Isolation tests with two ordinary users on separate brands and one user in both: foreign media id on write is rejected; foreign id already stored never produces a signed URL; a user in both brands sees only the active brand's thumbnails.

## PR5 `fix/alert-recipients` (N1, L4)

- [ ] `token-health` sends to `accounts.email` like `notify-failures` and `notify-expiring-connections`, instead of the legacy `auth_user_id` login.
- [ ] Operator alert: when a brand has 3 or more failed publish jobs in 24 hours, email the operator address (peter@orangejelly.co.uk, D1d) from a new `OPERATOR_ALERT_EMAIL` env var (add to `src/env.ts`, required in production), once per brand per day. Customer opt-out does not suppress it.
- [ ] Tests: recipient selection; dedupe; a missing `OPERATOR_ALERT_EMAIL` fails the production env check.

## PR6 `fix/conversion-retry-fairness` (I3, R17)

- [ ] Fetch retryable rows per brand (cap per brand per run, then the global cap), keep `not_configured` and `missing_match_keys` rows eligible so a brand that sets up its pixel later still recovers; keep the existing window, consent check and event id.
- [ ] Test: a large unconfigured brand next to a configured one, and the configured brand's rows are sent in the same run.

## Stage 1 done when

- [ ] `npm run ci:verify` green on each PR; each deployed and checked on production with its deployment id recorded here.
- [ ] PR2 migration applied to production (after approval).
- [ ] O1 recorded, and a real non-tester venue (or a test Page owned by a non-tester) has connected, published one agreed post, and seen no Anchor text, paid ads or tournaments.

## Results

- **PR1** `fix/auth-invite-and-passwords` (2026-09-24): built. `npm run ci:verify` green (2,477 tests). Local browser checks against the live Supabase project: login shows the expired-link message and "Forgot password?"; `/auth/forgot-password` redirects to `/forgot-password`; an unknown email gets the neutral reply and no login is created (auth user count stayed 1); `/auth/set-password` signed out goes to `/login?error=link_expired`; `/auth/confirm` with an absolute `next` is refused. Real invite end to end on the live project: test login `peter.pitcher+cheerstest@outlook.com` invited to Orange Jelly, email delivered via Resend, link verified by `/auth/confirm`, password set, planner opened on Orange Jelly (auth: confirmed, password set, signed in 07:13 UTC); its brand access removed afterwards. Merged as #81 (`3bcd31e9`), deployed to production `dpl_PfUzEBeeJK7ywgjbCCFmNi8DimES`; live checks passed (forgot-password page, legacy redirect, signed-out set-password redirect, absolute `next` refused, expired-link message).
- **PR2** `feat/brand-feature-gates` (2026-09-24): built. Migration `20260924090000_accounts_feature_flags.sql` applied to production 2026-09-24 as version `20260924073244` (only The Anchor has the switches on). `npm run ci:verify` green (2,497 tests). `pauseCampaign` deliberately left ungated so live spend can always be stopped. Event ad campaigns need both paid ads and management import; with only paid ads on, the event import fails closed with a message (acceptable while only The Anchor has paid ads). Merged as #82, deployed `dpl_4Fmo6oTVoq7soTXqWuRLxASvNxpz`; live check as a non-Anchor user on Orange Jelly: no Campaigns or Tournaments in the nav, `/campaigns` and `/tournaments` 404, no Meta Ads section on Connections, no Management app panel in Settings, no "Import from events" on Create.
- **PR3** `fix/remove-anchor-defaults`: merged as #84, deployed `dpl_Brm98SsMGjtDDx3WretkfyQiLhys`. Live login and help pages no longer show the invented testimonial or Google Business Profile. T4 moved to the T1 paid-ads work.
- **PR4** `fix/media-tenant-scope`: code merged as #85 (deployed in `dpl_3dqnGs6yQ63U3Kg3zHGmHTRLZjzT`). Finding: RLS let a member write another brand's media id into their own post directly through the Supabase API; server paths then sign or publish by id. Migration `20260924100000_revoke_direct_content_media_writes.sql` (revokes direct INSERT/UPDATE/DELETE on content_items, content_variants, content_media_attachments, media_assets, media_library from anon and authenticated) Applied to production 2026-09-24 as version `20260924081719`; verified anon and authenticated keep SELECT but have no INSERT/UPDATE on all five tables, service role unchanged, no permission errors in the database logs afterwards.
- **PR5** `fix/alert-recipients`: `OPERATOR_ALERT_EMAIL` set in Vercel Production and Preview; merged as #86, deployed `dpl_FqcCgNV4S2oh3xxZdMasHHB4oBhE`; the 08:30 UTC notify-failures run on that deployment returned 200 with no errors. Also fixes the notify-failures duplicate-email bug.
- **PR6** `fix/conversion-retry-fairness`: merged as #87, deployed `dpl_3dqnGs6yQ63U3Kg3zHGmHTRLZjzT`.
- Found in passing: Vercel reports Node 20 builds will fail from 2026-10-01; flagged as a separate task.

**Stage 1 complete (2026-09-24)**, except the off-app Meta access check (O1, D7), which is with Peter.
