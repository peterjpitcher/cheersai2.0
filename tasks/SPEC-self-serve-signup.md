# SPEC: Self-serve sign-up (new customer readiness, Stage 3)

Status: draft for Peter's approval, 28 September 2026. Nothing in this spec is built. Peter approved writing it on 28 September 2026; nothing is built until he approves it.
Owner: Peter Pitcher. Author: Claude.
Parent: `tasks/SPEC-new-customer-readiness.md` (decisions D1 to D7, L1 to L8; §4.4 provisioning; §5 Stage 3), review `tasks/REVIEW-SPEC-new-customer-readiness.md` (R06, R19), live state in `tasks/PLAN-new-customer-stage2.md`.

## 1. Summary

A venue finds Cheers at `/`, asks to sign up with its name and email, confirms the email, sets a password, creates its venue, starts the 14-day trial through the existing Stripe Checkout and connects Facebook and Instagram, with no operator step.

Three findings change the shape of Stage 3 from what the parent spec assumed:

1. **Supabase public sign-up is already open, and email confirmation is off.** The parent spec (§5 Stage 3.2) planned to enable sign-ups when this ships. The opposite is needed: turn public sign-up off now and keep it off. The house pattern (service-role `generateLink` plus Resend, as invites do) never needs it, so the Auth API does not become public.
2. **No self-serve venue can connect Facebook or Instagram until Meta approves App Review** (D7). The sign-up flow is built behind a switch that stays off until approval and the D7 launch gate.
3. **Billing enforcement is off** (`app_flags.billing_enforcement = false`). A self-serve venue that skips Checkout would get the product free, so enforcement must be on before sign-up opens. All three live brands are comped, so switching it on changes nothing for them.

## 2. What is true today (verified 28 September 2026)

| # | Fact | Evidence |
|---|---|---|
| F1 | Live Supabase Auth: `disable_signup: false`, `mailer_autoconfirm: true`. Anyone holding the public anon key can create a confirmed login through the Auth API without proving the email. Not tested by creating a user (that would write to production). Today there are 2 logins, both Peter's, so nothing has been abused. The harm: someone pre-registers a future customer's email with their own password; the admin invite then fails ("If the user already exists, assign them a brand instead") and assigning the brand hands it to that login. | `GET /auth/v1/settings` (read-only); `auth.users` counts; `src/app/(app)/admin/actions.ts:277-280` |
| F2 | `/` and `/auth/signup` are permanent (308) redirects to `/planner` and `/login`; browsers cache them. `robots.ts` disallows the whole site. | `src/app/page.tsx:4`, `src/app/auth/signup/page.tsx:4`, `src/app/robots.ts:5-10` |
| F3 | The login page sends the user to the raw `next` query value after a password sign-in, with no check: an open redirect. The CSP allows inline script, so a `javascript:` value may also run (not tested). | `src/app/(auth)/login/page.tsx:25,44`; `src/lib/security/headers.ts:25` |
| F4 | Rate limiting is off in production: `checkAuthRateLimit` allows everything when Upstash is unset, and Vercel production has no `UPSTASH_REDIS_*` (checked with `vercel env ls production`, names only). The legacy `/api/auth/login` and `/api/auth/magic-link` routes use an in-memory map per server instance, have no callers in the repo, and log email addresses. | `src/lib/auth/rate-limit.ts:21-27,65-68,113-133`; `src/app/api/auth/magic-link/route.ts:15-16,50` |
| F5 | Supabase's own per-IP limits cannot tell our visitors apart: sign-in, OTP and verify calls run server-side, so Supabase sees Vercel's addresses. | `src/lib/auth/actions.ts:45-58,106-111`; `src/app/auth/confirm/route.ts:47-50` |
| F6 | The table `auth_rate_limits` (key, count, reset_at) exists, is service-only by RLS, has 0 rows, and is already covered by the retention job (deleted 24 hours after reset) and the privacy notice ("sign-in rate limits"). Nothing in `src/` writes it. | live schema; `supabase/migrations/20260927120000_data_retention.sql:285-299`; `src/app/(public)/privacy/page.tsx:97-100` |
| F7 | Invites and password resets already use the house pattern: `auth.admin.generateLink` (no Supabase email), then Resend with a `/auth/confirm?token_hash=...` link; the login is created, access written, and only then emailed. Magic links never create users. | `src/app/(app)/admin/actions.ts:268-312`; `src/lib/auth/actions.ts:48-57,176-213`; `src/lib/auth/email-links.ts:23-37` |
| F8 | Live `accounts`: `id` has a default (`gen_random_uuid()`), `email` NOT NULL but no longer unique (#75), `auth_user_id` NOT NULL with no foreign key and no reader in `src/` or the edge functions. Switches `paid_ads_enabled`, `tournaments_enabled`, `management_import_enabled` default false; `billing_override` defaults null. No trigger creates a `brand_profile` row: it is created by the first Settings save and every reader tolerates it missing. `account_members.role` defaults `owner`; a trigger keeps a last owner on update and delete. | live schema; `src/app/(app)/admin/actions.ts:68-79`; `src/app/(app)/settings/actions.ts:39-64` |
| F9 | Admin "Create brand" writes no membership and no brand profile; access comes from a separate invite. It is not one transaction. | `src/app/(app)/admin/actions.ts:54-103,256-341` |
| F10 | Checkout: owner only, server-chosen price, trial only when the brand has never had a subscription, card always collected, terms and DPA tick box, idempotency key per attempt. The plan chooser defaults to Starter monthly. | `src/app/(app)/settings/billing-actions.ts:215-280`; `src/features/settings/billing-section.tsx:344-345` |
| F11 | The production Stripe key is restricted: Checkout Sessions, Customers and Customer Portal write; Subscriptions, Prices and Products read. It cannot read payment methods or cancel a subscription. | `docs/runbooks/stripe-billing.md:85` (runbook, not re-checked in Stripe) |
| F12 | Setup checklist (profile, Facebook, Instagram, first post) is worked out from `brand_profile`, `social_connections` (active or expiring) and `content_items` (status `posted`); shown until the first post. Live `publish_jobs` never records `completed_at` or `platform_post_id` (0 of 1,465 rows), so "published" must come from `content_items`. | `src/lib/onboarding/setup-progress.ts:21-52`; live counts |
| F13 | A signed-in user with no brand lands on `/no-access` ("Ask your administrator"). | `src/app/(app)/layout.tsx:36-38`; `src/app/no-access/page.tsx:26-29` |
| F14 | No analytics or advertising cookies; only Supabase sign-in cookies and the active-brand cookie. No Turnstile variable exists for Cheers (the Anchor's Turnstile belongs to the website and management app). Axiom is not configured in production, so Vercel logs (kept 1 day) and operator emails are the only failure signals. | `src/app/(public)/privacy/page.tsx:106-117,255-262`; `vercel env ls production` |
| F15 | New tables and functions in `public` get anon grants by default (`pg_default_acl`); `tests/anon-access.test.ts` fails on any anon grant not in `supabase/anon-access-allowlist.ts`. | `supabase/anon-access-allowlist.ts:1-20` |

## 3. Decisions already made

| ID | Decision (short form; full text in the parent spec) | Date |
|---|---|---|
| D1 | Assisted paid launch first; self-serve sign-up is Stage 3. | 2026-09-24 |
| D1a to D1d | Stripe hosted Checkout and portal; paid ads, tournaments and management import not offered to new customers; operator alerts to peter@orangejelly.co.uk. | 2026-09-24 |
| D2a, D2c, D2d, D2e | Starter, Professional (self-serve), Group (contact us); card at trial start; AI usage logged, not capped; plan change in the trial keeps the trial. | 2026-09-24 to 26 |
| D3 | An `incomplete` brand (no subscription) cannot create, generate, upload or publish once enforcement is on. | 2026-09-24 |
| D4 | Owners handle billing, connections, export and deletion requests. | 2026-09-24 |
| D5 | Offboarding is run by the operator on request; data kept 30 days, then deleted. | 2026-09-24 |
| D7 | Every Meta permission is Standard access; until App Review is approved only people with a role on the app can connect. | 2026-09-26 |
| L2, L4 | Businesses only; prices ex VAT; sub-processors Supabase, Vercel, OpenAI, Resend; Upstash and Axiom left off; 30 days' notice before adding one. | 2026-09-26/27 |
| L3, L8 | Approved retention periods; lapsed brands listed in the daily operator email after 90 days, closing stays manual. | 2026-09-27 |
| L6 | One trial per brand in code, one per business in the terms; at Stage 3, repeat trials are checked by card, not email domain. | 2026-09-27 |
| S0 | Peter approved writing this spec. | 2026-09-28 |

### 3.1 Proposed choices (not yet decided by Peter)

| ID | Proposed | Why |
|---|---|---|
| P1 | Turn off "Allow new users to sign up" and turn on "Confirm email" in Supabase now, before any Stage 3 code. | Closes F1 today. Invites, resets and magic links use admin calls or existing users, which the sign-up setting does not gate (confirm on a local stack first, §7). |
| P2 | Keep sign-up closed (`app_flags.self_serve_signup` off) until App Review is approved and the D7 gate passes. Until then `/` shows prices with "Talk to us" (email and WhatsApp). | A venue that cannot connect would pay for a trial it cannot use. |
| P3 | Switch `billing_enforcement` on before sign-up opens. | Otherwise a venue that skips Checkout uses Cheers free (§1, point 3). |
| P4 | A card that has had a Cheers trial before: cancel the new trial subscription at once with no charge and offer "Start your plan today" (paid from day one). | No surprise charge; the customer consents to paying now. |
| P5 | Retention: card-check hashes 24 months from the trial start; sign-up records 24 months; sign-ups never confirmed deleted after 7 days. | Matches the 24-month audit periods; unconfirmed logins are temporary records. |
| P6 | A venue that never starts a subscription is listed in the daily operator email 30 days after sign-up; closing stays manual; the terms gain one sentence allowing it. | Same shape as L8. |
| P7 | Rate limits in our own database (`auth_rate_limits`), not Upstash. | No new sub-processor, no DPA change, no customer notice; also fixes F4 for sign-in. |
| P8 | Cloudflare Turnstile on `/signup` only, checked by our server; not Supabase's built-in CAPTCHA. | §4.2. Kept off the login form so Cloudflare handles only our own (controller) sign-up data. |
| P9 | Owners get "Download my data" and "Ask us to close this venue" in Settings; the operator still runs offboarding (D5 unchanged). | Self-serve rights without automating deletion. |
| P10 | Let search engines index `/` and the three legal pages; everything else stays disallowed. | A public front door that cannot be found does little. |

## 4. Design

### 4.1 The front door: `/`

- Signed out: a landing page (what Cheers does, how it works, what you need, pricing, FAQs). Signed in: a temporary (307) redirect to `/planner`, never a permanent one. Browsers that cached the old 308 keep going to `/planner`, then login; acceptable.
- Pricing comes from `PLANS` in `src/lib/billing/plans.ts:45-70` only: Starter £29.99 a month or £323.89 a year, Professional £59.99 or £647.89, Group "contact us"; the limits and seats from the same file. Every price reads "ex VAT"; a line says VAT is added at the UK rate (L2). Trial text matches the terms: 14 days, card taken at the start, first charge on day 15 unless cancelled. No mention of paid ads or tournaments (D1b).
- "What you need" states the prerequisites before anyone starts a time-limited trial (R19): admin access to the venue's Facebook Page, and for Instagram a professional account linked to that Page.
- Footer: company details from `src/lib/legal/company.ts` (the E-Commerce Regulations require them on the site), links to `/terms`, `/privacy`, `/data-processing`, `/help`, `/login`.
- CTA: switch off, "Talk to us" (email and WhatsApp from `CONTACT`); switch on, "Start your free trial" to `/signup`. The login page's "Don't have an account? Contact support" (`login/page.tsx:264-270`) follows the same switch. `/auth/signup` redirects (307) to `/signup`.
- Cookies: none added. No banner, because Cheers still sets only strictly necessary cookies (F14). If analytics is ever added, that decision reopens this.
- `robots.ts`: allow `/`, `/terms`, `/privacy`, `/data-processing` (P10); `noindex` on `/signup/*` and `/auth/*`. Canonical host `cheers.orangejelly.co.uk`.
- Copy is drafted only from `plans.ts`, the terms and `company.ts`; Peter approves the wording on the PR preview.

### 4.2 Sign-up request: `/signup`

Form: name, email, a Turnstile widget. No password field (see "why" below). Server action `requestSignup`, in this order, each step failing closed:

1. Switch: read `app_flags.self_serve_signup`; a read error counts as off. Off: "Sign-up is not open yet. Talk to us: email or WhatsApp."
2. Validate name (1 to 120 characters) and email (lower-cased).
3. Turnstile: server-side siteverify with the secret, the visitor's IP (`x-forwarded-for` first entry, set by Vercel), `action = signup`, and in production `hostname = cheers.orangejelly.co.uk`. Timeout 5 seconds. Missing keys, timeout or failure: refuse.
4. Rate limits (P7): per email 3 an hour, per IP 10 an hour, and a site-wide 60 an hour that, when hit, refuses and alerts the operator (it protects the Resend sending reputation, which other Orange Jelly apps share). Keys are SHA-256 of the email or IP, so the table holds no plain address.
5. `auth.admin.generateLink({ type: 'invite', email, options: { data: { full_name } } })`:
   - new email: a login is created unconfirmed; record a `self_serve_signups` row (§4.4); email "Confirm your email to start your Cheers trial" with `/auth/confirm?token_hash=...&type=invite&next=/signup/venue`;
   - existing unconfirmed login (an earlier abandoned sign-up): a fresh link, same email;
   - existing confirmed login (error `email_exists`): no new login; email "You already have a Cheers login" with sign-in and password-reset links and "to add another venue, email peter@orangejelly.co.uk" (from `CONTACT`; the sending address receives nothing, so never "reply to this email");
   - any other error: refuse.
6. The screen always says "Check your email" for all three outcomes, so the form never reveals who has a login.

Why no password on the form: with a password chosen before the email is proved, someone could register a victim's address with their own password and wait for the victim to confirm it (pre-account takeover). The password is set only after the link is opened (§4.4).

Why app-level Turnstile, not Supabase's CAPTCHA: Supabase's CAPTCHA protects the public Auth endpoints (sign-up, password sign-in, OTP, reset) and would force a challenge onto the existing login form, but it does not apply to admin calls, which is how this sign-up works. With public sign-up off (P1) there is no public sign-up endpoint left to protect.

Disposable emails: not blocked (lists go stale and catch real venues); the card-up-front trial, Turnstile, rate limits and the card check (§4.6) carry the load. The operator email shows the email domain so odd sign-ups stand out.

### 4.3 Email confirmation

- `/auth/confirm` already verifies `token_hash` for `invite` and signs the person in (`src/app/auth/confirm/route.ts:13-50`); `next` passes through `safeNextPath` and is fixed server-side to `/signup/venue`. The link works on any device, because a token hash needs no browser state.
- Expired or used link: the login page shows the existing link error; submitting `/signup` again sends a fresh link (unconfirmed login) or the "already have a login" email (confirmed).
- Emails are rendered from fixtures in tests and fail on `undefined`, empty links or `Invalid Date` (workspace rule).
- Supabase dashboard (P1): "Allow new users to sign up" off, "Confirm email" on. Both stay that way when sign-up opens. `supabase/config.toml` gains `[auth] enable_signup = false` and `[auth.email] enable_confirmations = true` so a local rebuild matches production.

### 4.4 Venue creation: `/signup/venue`

Page for a signed-in, confirmed user. If the user already belongs to a brand it redirects to `/planner` (or to `/auth/set-password` for an invited member who never set one). Fields: password and confirm (12 to 72 characters, as `setPassword`, `src/lib/auth/actions.ts:125-132`), venue name, venue type (pub, bar, restaurant, cafe, hotel, other; stored in `brand_profile.business_type`), and a required tick box: "I am signing up for a business, not as a consumer" (terms section 2, `src/app/terms/page.tsx:65-69`).

Server action `createSelfServeVenue`:
1. Switch check, rate limit (per user 10 an hour), validate; the user id comes from `auth.getUser()`, never from the form.
2. Set the password (`auth.updateUser`); repeating it with the same value is harmless.
3. Call `public.provision_self_serve_brand(p_user_id, p_venue_name, p_business_type, p_email, p_legal_version)` through the service role. One plpgsql function, so one transaction:
   - `select ... from self_serve_signups where user_id = p_user_id for update`; none: raise (the user did not come through sign-up; the `/no-access` entry below creates the row first);
   - `account_id` already set: return it (a double submit, a refresh and a second tab all end here, so there is never a second venue);
   - insert `accounts` (`business_name` and `display_name` = venue name, `email` = the sign-up email, `timezone` Europe/London, `created_by_user_id` and `auth_user_id` = the user, switches and `billing_override` left at their defaults);
   - insert `account_members` (role `owner`, `created_by` the user);
   - insert `brand_profile` (`account_id`, `business_type`; every other column has a default);
   - update the sign-up row: `account_id`, `venue_created_at`, `business_confirmed_at`, `legal_version`; return the account id.
4. Record `self_serve_venue_created` in `admin_audit` (ids only, no email), email the operator (§4.8), redirect to `/settings#billing`.

The stable attempt id is the `self_serve_signups` row itself: one per login (unique `user_id`), locked by the function. An existing login with no brand (F13) sees "Start a free trial for your venue" on `/no-access` when the switch is on; that creates its sign-up row (verified now) and goes to `/signup/venue`. An existing member who wants a second venue is told to contact us (Group plan); self-serve never adds a brand to someone who already has one.

Admin invite path: unchanged. The operator still creates comped or assisted brands with Create brand and invites. Moving Create brand onto the new function is a possible later tidy-up, not part of this spec.

### 4.5 Trial and payment

- After the venue exists, the owner lands on Settings, Billing: the existing chooser (Starter monthly preselected, F10), a short welcome line, and the existing Checkout with the terms and DPA tick box and "Confirming your payment" on return. No new Checkout code.
- With enforcement on (P3), the brand is `incomplete` until the webhook confirms, so it cannot create or publish; the existing banner explains why.
- A cancelled Checkout leaves the brand `incomplete`; the owner can return to Billing at any time. Never-started brands are handled by P6.

### 4.6 Repeat trials, checked by card (L6)

- **Where:** inside `reconcileBrandFromStripe` (`src/lib/billing/reconcile.ts:345-398`), after the current subscription row is written. That one path serves the webhook, "Check again" and admin re-sync, so the check cannot be skipped.
- **When:** the current subscription is `trialing` and has no row yet in `trial_card_checks`.
- **How:** retrieve the subscription with `default_payment_method` expanded; take `card.fingerprint`; compute HMAC-SHA256 with a new server secret `TRIAL_CARD_HASH_KEY`; look for an earlier `first_trial` row with the same hash and a different `account_id`.
  - No match: insert (`stripe_subscription_id`, `account_id`, `card_hash`, `outcome = 'first_trial'`).
  - Match (P4): cancel the subscription now (`invoice_now: false`, `prorate: false`; nothing has been charged in a trial), insert `outcome = 'repeat_refused'`, record `trial_refused_repeat_card` in `admin_audit`, email the operator. Billing then says: "This card has already been used for a Cheers free trial, so this plan cannot start with one. Start your plan today to carry on." The button is the existing `startCheckout`; the brand now has an earlier subscription, so it gets no trial (`billing-actions.ts:245-246`).
  - No card on the subscription: `outcome = 'no_card'`, operator email (Checkout always collects one, so this should not happen).
- **Failure:** a Stripe or database error throws, the webhook answers 500, Stripe retries and the existing webhook alert emails the operator. The trial runs while the check is retried, a billing-control gap rather than lost customer data, and it is visible.
- **Stripe change (off-app):** the restricted key needs PaymentMethods read and Subscriptions write (F11).
- **Limits:** Apple Pay and Google Pay may give a device-specific fingerprint, so a wallet can slip through; accepted and checked in test mode. The same card on a second venue of the same business is refused, which matches "one free trial per business". Only trials after this ships are recorded; nothing is backfilled.
- **Table:** `trial_card_checks` (`stripe_subscription_id` primary key, `account_id` references `accounts` on delete cascade, `card_hash`, `outcome` check, `created_at`), index on `card_hash`. Kept 24 months (P5). A deleted brand's rows go with it, so a closed business's card can trial again after deletion; accepted.

### 4.7 Facebook and Instagram until Meta approves

- Today a self-serve owner has no role on the Meta app, so Meta will not grant the Standard-access permissions. What they would see has not been tested; most likely Meta's dialog refuses, or Cheers shows "No Facebook Pages found for the connected account." (`src/lib/connections/token-exchange.ts:99`).
- Options: (a) open sign-up now with a "connect later" state: rejected, the trial clock runs with nothing to post; (b) operator adds each owner as an app tester: works for a handful of assisted venues but needs the owner's Facebook account and an acceptance step in Meta's developer settings, not self-serve; (c) a waitlist form: another public store of personal data for little gain over "Talk to us"; (d) build now, open later: recommended (P2).
- Launch order: App Review submitted and approved (`docs/runbooks/meta-app-review.md` §6); the D7 gate passes (a real non-tester connects their own Page and Instagram and publishes one agreed post, including the business-portfolio Instagram case that may need `ads_read`); then `billing_enforcement` on (P3); then the sign-up switch on.
- After opening, the operator digest (§4.8) lists trialing venues with no connection after 3 days so Peter can help before the trial runs out.

### 4.8 Onboarding and operator emails

- The existing checklist does the onboarding (F12): profile is already half done (business type from sign-up), then Facebook, Instagram, first post. The first-post step links to a new `/help` article "Your first post" (Create, Instant post, Post now), written from the flow in `docs/runbooks/meta-app-review.md` §4.
- Every new venue: one email to `OPERATOR_ALERT_EMAIL` with venue name, type, sign-up email and time. Failure to send is logged and never blocks the customer; the daily digest below is the backstop.
- Every sign-up failure caused by a dependency (Turnstile unreachable, rate-limit store error, `generateLink` error other than "exists", Resend error, provisioning error): at most one operator email per failure kind per hour, recorded in `admin_audit` as `operator_signup_alert` with the kind and a count only (that table keeps rows 6 years, so no email addresses). Ordinary validation errors do not alert (R06).
- The daily data-retention email (`docs/runbooks/data-retention.md`) gains two lists: "New sign-ups stuck" (verified with no venue after 1 day; venue with no Checkout after 3 days; trialing with no channel after 3 days) and "Never started" (P6).

### 4.9 Funnel

- Stored steps, in `self_serve_signups` (service role only): `requested_at`, `verified_at` (set when `/signup/venue` first loads for a confirmed user), `venue_created_at`, `account_id`. One row per login, so retries never count twice.
- Derived steps, using the checklist's own rules (F12) so the two never disagree: checkout confirmed = the brand's first `subscriptions` row; channel connected = a `social_connections` row active or expiring; first published post = a `content_items` row with status `posted`. Derived ticks can disappear if the customer later disconnects or deletes posts; acceptable for a small funnel.
- No cookies and no client-side tracking; nothing changes in the cookie notice.
- Admin view: a "Sign-ups" card on `/admin` with counts for the last 30 and 90 days per step and the latest 20 sign-ups with their furthest step. The same query goes in the runbook:

```sql
select count(*) as requested,
  count(verified_at) as verified,
  count(venue_created_at) as venue_created,
  count(*) filter (where exists (select 1 from subscriptions s where s.account_id = x.account_id)) as checkout_confirmed,
  count(*) filter (where exists (select 1 from social_connections c where c.account_id = x.account_id and c.status in ('active','expiring'))) as channel_connected,
  count(*) filter (where exists (select 1 from content_items i where i.account_id = x.account_id and i.status = 'posted')) as first_post
from self_serve_signups x
where x.requested_at >= now() - interval '30 days';
```

- Retention (P5): rows deleted 24 months after `requested_at`; unconfirmed self-serve logins (no membership, not an admin, `email_confirmed_at` null, sign-up row unverified) deleted 7 days after creation, both by new rules in `public.run_data_retention`.

### 4.10 Export and closure (P9)

- Export: Settings, "Download my data" (owner only, D4) calls the existing `exportBrandData` (`src/lib/admin/offboarding.ts:156`): posts and schedule, brand profile, link-in-bio, media links valid 7 days, no tokens. Scoped to the owner's active brand, limited to one export per brand per 10 minutes, audited as `export_brand_data` with the owner as actor. Available in every billing state (D3).
- Closure: Settings, "Ask us to close this venue" (owner only, typing the venue name) records `closure_requested` in `admin_audit`, emails the operator and the owner (with the date the request was made and what happens next), and shows "Requested" until the operator acts. The operator follows `docs/runbooks/customer-offboarding.md` unchanged. Nothing is deleted automatically, so D5 stands.

### 4.11 Abuse and security

- **Fail closed:** every public write (`requestSignup`, `createSelfServeVenue`, the switch read, Turnstile, the rate limiter, `generateLink`, Resend, the provisioning function) refuses on failure, shows "We could not finish this. Please try again, or email peter@orangejelly.co.uk" (from `CONTACT`), and raises an operator alert (§4.8). Each gets a test that injects the failing dependency and asserts both.
- **Enumeration:** one response for every email outcome (§4.2); the forgot-password and magic-link forms already do this.
- **Open redirects:** `next` on confirmation is fixed server-side; the login page's `next` goes through `safeNextPath` (fixes F3).
- **CSRF:** server actions only; Next.js checks the Origin header against the host (no `allowedOrigins` override in `next.config.ts`). No new route handlers.
- **Service role:** the user id always comes from the verified session; every new query carries `.eq('user_id', ...)` or `.eq('account_id', ...)`.
- **New tables** (`self_serve_signups`, `trial_card_checks`): RLS on with no policies, `revoke all ... from anon, authenticated`, `grant all ... to service_role`; new functions revoke execute from `public`, `anon`, `authenticated` and grant it to `service_role` (F15).
- **CSP:** add `https://challenges.cloudflare.com` to `script-src` and `frame-src` in `src/lib/security/headers.ts` (unit-tested).
- **Legacy routes:** delete `/api/auth/login` and `/api/auth/magic-link` (F4).

### 4.12 Legal and privacy

- **Privacy notice** (`src/app/(public)/privacy/page.tsx`): a sign-up records row (what: when you asked to sign up, confirmed your email and created your venue; why: run sign-up, fix problems, see where people drop off; basis: legitimate interests); the billing row adds a keyed code made from the card's Stripe fingerprint to keep to one free trial per business; a security line naming Cloudflare Turnstile on the sign-up form (IP address and browser details), with Cloudflare's role taken from its Turnstile privacy terms before the wording is published; retention rows per P5; the cookies section updated only if Turnstile stores anything in the browser (checked at build).
- **Terms:** the one-trial line (`src/app/terms/page.tsx:72`) adds "for example, when the card has been used for a trial before"; section 18 adds the never-started sentence if P6 is agreed.
- **DPA:** no change. Turnstile sits only on the sign-up form, whose data is Cheers's own account data (controller, L4), so Cloudflare is not a sub-processor; the rate limiter stays in Supabase (P7), so no Upstash. No 30-day customer notice is needed.
- **Version:** bump `LEGAL_VERSION` and `LEGAL_UPDATED` together (`src/lib/legal/company.ts:33-34`), so Checkout acceptances name the new text.

## 5. Build stages

Each PR deploys on its own, passes `npm run ci:verify` (London and UTC), and targets production's shape with its own grants. Migrations are expand-only and applied before the code that uses them; only with Peter's yes.

| # | Branch | What | Migration | Switch |
|---|---|---|---|---|
| 0 | off-app | P1: Supabase sign-up off, confirm email on | none | none |
| 1 | `fix/auth-hardening` | Database rate limiter replacing the Upstash no-op on sign-in, magic link and reset; login `next` fix; delete the two legacy auth routes; remove `@upstash/ratelimit` and `@upstash/redis`; `config.toml` auth settings | `consume_rate_limit(text, int, int)`: one atomic upsert on `auth_rate_limits` returning allowed and reset time | none (improves today's paths) |
| 2 | `feat/public-front-door` | Landing and pricing at `/`, robots, footer, `/auth/signup` redirect, login footer link | insert `app_flags ('self_serve_signup', false)` | CTA follows the switch |
| 3 | `feat/signup-legal` | §4.12 wording and version bump | none | none; live before PR 6 and before opening |
| 4 | `feat/signup-request` | `/signup`, Turnstile, `requestSignup`, the two emails, CSP, sign-up failure alerts | `self_serve_signups` table; `run_data_retention` restated with the two new rules | behind the switch |
| 5 | `feat/signup-venue` | `/signup/venue`, password, business tick, provisioning, `/no-access` entry, new-venue operator email | `provision_self_serve_brand(...)` | behind the switch |
| 6 | `feat/trial-card-check` | §4.6 in reconcile, Billing message, `TRIAL_CARD_HASH_KEY` in `src/env.ts` (required in production) | `trial_card_checks`; `run_data_retention` restated with its rule | none (applies to every trial) |
| 7 | `feat/signup-ops` | Admin Sign-ups card, digest lists, `/help` first-post article | none | none |
| 8 | `feat/owner-export-closure` | §4.10; runbook updates | none | none |

Order: 0, then 1 to 5 in sequence (4 and 5 are dark until the switch flips), 3 before 6, 6 to 8 in any order. Every migration is applied (with Peter's yes) before its code deploys; code that finds its table missing refuses with an error rather than skipping.

Tests per PR (Vitest, mocks only; no test reaches a live service):
- PR 1: limiter allows, blocks and resets; a store error refuses sign-in with a visible error; `safeNextPath` on the login page rejects `https://`, `//` and `javascript:`; SQL check on a local rebuild that two concurrent calls at the limit let exactly one through.
- PR 2: signed-in visitor redirected (307), signed-out sees prices from `PLANS` with "ex VAT", no ads or tournament text, CTA per switch, switch read error shows "Talk to us"; robots output.
- PR 4: one test per failing dependency (switch read, Turnstile, limiter, `generateLink`, Resend) asserting the user's error and the operator alert; the same screen for new, unconfirmed and confirmed emails; email templates rendered from fixtures; anon access test passes.
- PR 5: failing provisioning and password save each show an error and alert; double submit, refresh and two tabs return one venue; a failure mid-function leaves no account and no membership (local SQL verify); switches off and override null on the new brand; a member with a brand is redirected; a user id in the form is ignored.
- PR 6: first trial recorded; repeat card cancelled without charge and the brand then offered no trial; same brand re-run is a no-op; Stripe error makes reconcile throw (webhook 500); missing key refuses at build in production.
- PR 7 and 8: digest lists from fixtures (London dates, a clock-change day); export scoped to the active brand and owner only; closure request owner only and audited.

Rollback: switch off (`app_flags`, no deploy) stops new sign-ups at once; each PR reverts on its own; tables and functions are additive and can stay. A refused trial or a sent email cannot be undone by a rollback.

## 6. Off-app work

| When | What | Who |
|---|---|---|
| Now (P1) | Supabase, Authentication: "Allow new users to sign up" off; "Confirm email" on. Then `GET /auth/v1/settings` shows `disable_signup: true` and `mailer_autoconfirm: false`, and Admin, "Send password link" still works for the test login. | Peter in the dashboard; Claude checks |
| Before opening | Cloudflare: a Turnstile widget for `cheers.orangejelly.co.uk` (managed mode); `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` in Vercel production. Preview and local use Cloudflare's published test keys. | Peter |
| Before PR 6 is live | Stripe: add PaymentMethods read and Subscriptions write to the "CheersAI production" restricted key; `TRIAL_CARD_HASH_KEY` (64 hex characters) in Vercel production. | Peter |
| Before opening | Meta: App Review approved and the D7 gate passed (runbook §7). | Peter |
| Opening day | `billing_enforcement` on, then `self_serve_signup` on (SQL, each with Peter's yes); one real sign-up by Peter on a spare email, cancelled in the portal before day 15. | Claude runs, Peter approves |

## 7. Verification (local stack only, never production)

- Local Supabase per `docs/runbooks/stripe-billing.md` "Testing in test mode" (steps 1 to 4), with `enable_signup = false` and `enable_confirmations = true`. First check P1's assumption: with sign-up off, admin `generateLink` for `invite` and `recovery` still works and the public `/auth/v1/signup` refuses.
- Stripe test mode with `stripe listen` forwarding; Turnstile test keys (always pass, always fail); Resend sending to a plus-addressed mailbox Peter owns. Automated e2e injects the email sender and follows the captured link.
- Must-pass journeys: new owner end to end to a trialing brand; the same card on a second brand refused with no charge; existing confirmed email gets the "already have a login" email and nothing else changes; expired link then re-request; link opened on another device; double submit and two tabs; database stopped between steps; Turnstile and Resend failing; switch off mid-journey; `/no-access` user starting a venue; member of a brand redirected; keyboard-only and mobile width on every new page (WCAG 2.2 AA as the design target).
- Say it works only after running these paths and quoting what was seen.

## 8. Out of scope

Self-serve Group plan and second venues for existing members; paid ads, tournaments and management import for new brands (D1b, D1c); AI usage caps (D2d); automatic offboarding or deletion (D5); analytics or marketing cookies; a waitlist; Google sign-in; moving admin Create brand onto the new function; anything for The Anchor website or management app (no hours, availability, booking or Turnstile change there, so the paired repository needs nothing).

## 9. Risks

| Risk | Handling |
|---|---|
| F1 stays open until P1 is done | Do it first; it needs no code. |
| Meta approval is slow or rejects `business_management` | Sign-up stays closed (P2); assisted launch with testers continues. |
| Email scanners (for example Outlook Safe Links) open the one-use link first | Same risk as today's invites; if it shows up, add a "Confirm" button page in front of `/auth/confirm` for all auth links. |
| Wallet cards bypass the card check | Accepted; the operator email shows each refused and first trial. |
| Resend reputation hit by sign-up abuse | Turnstile, per-IP and site-wide limits, and the alert at the site-wide limit. |
| A trial runs while the card check is retried | Visible through the existing webhook alert; re-sync after the fix. |
| Enforcement switched on breaks a brand | All live brands are comped today; re-check `billing_override` for every live brand the day it is switched on. |

## 10. Pending decisions

P1 to P10 in §3.1. The spec records Peter's answers there and moves each into §3 once made.
