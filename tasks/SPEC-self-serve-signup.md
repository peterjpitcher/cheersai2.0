# SPEC: Self-serve sign-up (new customer readiness, Stage 3)

Status: v2.1, 28 September 2026. Revised after an independent review (approve with changes; findings 1 to 13 folded in, map in §11); Peter answered the choices the same day (§3.1: ten decided, P2 open). Nothing in this spec is built. Stage 1 may be built now (P1); the Stage 3 build waits for Peter's approval of this spec.
Owner: Peter Pitcher. Author: Claude.
Parent: `tasks/SPEC-new-customer-readiness.md` (decisions D1 to D7, L1 to L8; §4.4 provisioning; §5 Stage 3), review `tasks/REVIEW-SPEC-new-customer-readiness.md` (R06, R19), live state in `tasks/PLAN-new-customer-stage2.md`.

## 1. Summary

A venue finds Cheers at `/`, asks to sign up with its email, confirms it, then sets a password, names itself and its venue, starts the 14-day trial through the existing Stripe Checkout and connects Facebook and Instagram, with no operator step.

What shapes Stage 3:

1. **Sign-up goes through our server, never Supabase's public sign-up.** Public sign-up was open with email confirmation off; Peter switched both on 28 September 2026 (verified live). The house pattern (service-role `generateLink` plus Resend, as invites do) works with public sign-up off, so the Auth API stays closed.
2. **No self-serve venue can connect Facebook or Instagram until Meta approves App Review** (D7). The sign-up flow is built behind a switch that stays off until approval and the D7 launch gate.
3. **Billing enforcement is off** (`app_flags.billing_enforcement = false`). A venue that skipped Checkout would get the product free, so enforcement must be on before sign-up opens. The three live brands are comped and the fourth account is archived, so switching it on changes nothing for them.
4. **Strangers who can create venues can reach every owner feature.** Team invites become a public write path (emails to any address, logins created, existing users added without asking), so they are guarded before opening (§4.6).

## 2. What is true today (verified 28 September 2026)

| # | Fact | Evidence |
|---|---|---|
| F1 | Live Supabase Auth now has `disable_signup: true` and `mailer_autoconfirm: false` (both changed by Peter on 28 September 2026; before that anyone holding the public key could create a confirmed login). Admin invites, resets, magic-link and password sign-in were tested locally with sign-up off and keep working. Only 2 logins exist, both Peter's. | `GET /auth/v1/settings` (read-only); `auth.users` counts |
| F2 | `/` and `/auth/signup` are permanent (308) redirects to `/planner` and `/login`; browsers cache them. `robots.ts` disallows the whole site. | `src/app/page.tsx:4`, `src/app/auth/signup/page.tsx:4`, `src/app/robots.ts:5-10` |
| F3 | Done by #137 (live): the login page's `next` goes through `safeNextPath`, which now also rejects control characters, paths over 2,048 characters and anything that resolves off-origin; the set-password form uses it; the unused `/api/auth/magic-link` route is deleted. Supabase's redirect allow list holds only `https://cheers.orangejelly.co.uk`. | `src/lib/auth/email-links.ts:20-37`; `src/app/(auth)/login/page.tsx:27` |
| F4 | Rate limiting is off in production: `checkAuthRateLimit` allows everything when Upstash is unset, and neither Production nor Preview has `UPSTASH_REDIS_*` (`vercel env ls`, names only). The unused `/api/auth/login` route remains, with an in-memory limit per server instance, and logs email addresses. | `src/lib/auth/rate-limit.ts:21-27,65-68,113-133`; `src/app/api/auth/login/route.ts` |
| F5 | Supabase's own per-IP limits cannot tell our visitors apart: sign-in, OTP and verify calls run server-side, so Supabase sees Vercel's addresses. | `src/lib/auth/actions.ts:45-58,106-111`; `src/app/auth/confirm/route.ts:47-50` |
| F6 | `auth_rate_limits` (key, count, reset_at) exists, RLS limits it to the service role, it has 0 rows, and the retention job already deletes rows 24 hours after reset; the privacy notice already covers "sign-in rate limits". Nothing in `src/` writes it. | live schema; `supabase/migrations/20260927120000_data_retention.sql:285-299`; `src/app/(public)/privacy/page.tsx:97-100` |
| F7 | Invites and resets use the house pattern: `auth.admin.generateLink`, then Resend with a `/auth/confirm?token_hash=...` link. `/auth/confirm` verifies the token on GET and signs in whoever opens the link; there is no resend. | `src/app/(app)/admin/actions.ts:268-312`; `src/lib/auth/actions.ts:176-213`; `src/app/auth/confirm/route.ts:47` |
| F8 | Live `accounts`: `id` defaults to `gen_random_uuid()`, `email` NOT NULL and no longer unique (#75), `auth_user_id` NOT NULL with no foreign key and no reader in `src/` or the edge functions. Switches default false; `billing_override` defaults null. Four accounts: The Anchor, Orange Jelly and Cheers Test Venue (all comped) and "CheersAI Owner" (no override, archived 22 September 2026, so it resolves `archived`). No trigger creates `brand_profile`; the first Settings save does, and readers tolerate it missing. `account_members.role` defaults `owner`; a trigger keeps a last owner. | live schema; `src/app/(app)/settings/actions.ts:39-64` |
| F9 | Admin "Create brand" writes no membership and no brand profile; access comes from a separate invite. Not one transaction. | `src/app/(app)/admin/actions.ts:54-103,256-341` |
| F10 | Checkout: owner only, server-chosen price, trial only when the brand never had a subscription, card always collected, terms and DPA tick box, idempotency key per attempt. The chooser defaults to Starter monthly. The production Stripe key is restricted (Checkout Sessions, Customers, Portal write; Subscriptions, Prices, Products read). 0 live subscriptions (1 cancelled test). | `src/app/(app)/settings/billing-actions.ts:215-280`; `src/features/settings/billing-section.tsx:344-345`; `docs/runbooks/stripe-billing.md:85`; live count |
| F11 | Team invites (owner only): an unpaid brand gets Starter's 2 seats; no rate limit; the owner's venue name goes into our email to any address; a new address gets a login; an existing user is added straight away with no consent. | `src/lib/billing/seats.ts:36`; `src/app/(app)/settings/team-actions.ts:76-165`; `src/lib/auth/email-links.ts:68-100` |
| F12 | The default brand is the first by name: brands load ordered by `business_name` and the first wins when there is no cookie. A super-admin sees every live brand. So a new brand named "A Anchor" would become an invited user's default, or Peter's. | `src/lib/auth/membership.ts:64,88,111-121` |
| F13 | Setup checklist ticks "profile" when business type or description is set, so the venue type from sign-up ticks it on its own. Live `publish_jobs` never records `completed_at` or `platform_post_id` (0 of 1,465 rows), so "published" must come from `content_items.status = 'posted'`. | `src/lib/onboarding/setup-progress.ts:47`; live counts |
| F14 | A signed-in user with no brand lands on `/no-access` ("Ask your administrator"). | `src/app/(app)/layout.tsx:36-38`; `src/app/no-access/page.tsx:26-29` |
| F15 | Grants on new objects: since `20260905053036` anon no longer inherits grants from `postgres`, but `authenticated` still gets EXECUTE on every new function and all privileges on every new table (live example: `increment_rate_limit`, SECURITY DEFINER, callable by any signed-in user for any account id, though the app only calls it with the service role and its counters are advisory). `tests/anon-access.test.ts` skips in CI and checks anon only. Every public table has RLS on. | live `pg_default_acl` and `proacl`; `src/lib/providers/rate-limits.ts:34-49`; `tests/anon-access.test.ts:64` |
| F16 | Env validation runs whenever `NODE_ENV` is production, which includes Preview builds, so a required key must be set in Preview too. Preview uses the production database and has no Stripe keys. | `src/env.ts:144-163`; `docs/runbooks/stripe-billing.md:102`; `vercel env ls preview` |
| F17 | No analytics or advertising cookies. No Turnstile variable exists for Cheers. Axiom is not configured in production, so Vercel logs (kept 1 day) and operator emails are the only failure signals, and Resend carries both. | `src/app/(public)/privacy/page.tsx:106-117,255-262`; `vercel env ls production` |
| F18 | Terms section 19: 30 days' email notice before a change to prices or terms takes effect (L2). The Checkout tick box records acceptance on the Stripe Checkout Session with the version in its text. | `src/app/terms/page.tsx:289-295`; `docs/runbooks/stripe-billing.md:94-98` |

## 3. Decisions already made

| ID | Decision (short form; full text in the parent spec) | Date |
|---|---|---|
| D1 | Assisted paid launch first; self-serve sign-up is Stage 3. | 2026-09-24 |
| D1a to D1d | Stripe hosted Checkout and portal; paid ads, tournaments and management import not offered to new customers; operator alerts to peter@orangejelly.co.uk. | 2026-09-24 |
| D2a, D2c, D2d, D2e | Starter, Professional (self-serve), Group (contact us); card at trial start; AI usage logged, not capped; plan change in the trial keeps the trial. | 2026-09-24 to 26 |
| D3 | An `incomplete` brand (no subscription) cannot create, generate, upload or publish once enforcement is on. | 2026-09-24 |
| D4 | Owners handle billing, inviting, connections, export and deletion requests. | 2026-09-24 |
| D5 | Offboarding is run by the operator on request; data kept 30 days, then deleted. | 2026-09-24 |
| D7 | Every Meta permission is Standard access; until App Review is approved only people with a role on the app can connect. | 2026-09-26 |
| L2, L4 | Businesses only; prices ex VAT; 30 days' notice of terms changes; sub-processors Supabase, Vercel, OpenAI, Resend; Upstash and Axiom left off; 30 days' notice before adding one. | 2026-09-26/27 |
| L3, L8 | Approved retention periods, including "expired temporary security records: deleted within a day of expiring"; lapsed brands listed in the daily operator email after 90 days, closing stays manual. | 2026-09-27 |
| L6 | One trial per brand in code, one per business in the terms; at Stage 3, repeat trials are checked by card, not email domain. | 2026-09-27 |
| S0 | Peter approved writing this spec. | 2026-09-28 |
| S1 | Supabase public sign-up off and email confirmation on. Done by Peter; verified live. | 2026-09-28 |
| S2 | Login `next` validation and removal of `/api/auth/magic-link` (#137, merged and live). | 2026-09-28 |

### 3.1 Choices put to Peter, answered 28 September 2026 (his questions 40 to 50)

The P numbers stay so the design can refer to them. Ten are decided; P2 is open.

| ID | Choice | Peter | Status |
|---|---|---|---|
| P1 | Ship Stage 1 (§5, PRs 1 and 2) now, separately from sign-up. It closes today's gaps (no rate limits in production; one-use links burnt by email scanners) and does not depend on Meta. | Q40 | Decided, yes, 2026-09-28 |
| P2 | Keep sign-up closed (`app_flags.self_serve_signup` off) until App Review is approved and the D7 gate passes; until then `/` shows prices with "Talk to us". | Q41 | **Open.** Peter asked how to close the gap and believes the Meta app is already approved, because he uses it daily for The Anchor. The facts (App Dashboard, 26 September 2026): the app is in Live mode and Business Verification is done, but every permission is Standard access, so only people with a role on the app can grant them. The Anchor works because Peter, an app administrator, connects it. Closing the gap means submitting the App Review in `docs/runbooks/meta-app-review.md` and passing the D7 gate. The sign-up switch design (§4.8) is unchanged. |
| P3 | Switch `billing_enforcement` on before sign-up opens, so a venue that skips Checkout cannot use Cheers free. | Q42 | Decided, yes, 2026-09-28 |
| P4 | Team invites only while the brand is trialing, paid, in past-due grace or comped; at most 5 a day per brand; an existing user must accept. The default-brand fix in §4.6 (the brand a person joined first) is a safety fix that ships with it. | Q43 | Decided, yes, 2026-09-28 |
| P5 | A card that has had a Cheers trial before: cancel the new trial at once with no charge and offer "Start your plan today". | Q44 | Decided, yes, 2026-09-28 |
| P6 | Retention: card-check codes 24 months from the trial start; sign-up records 24 months; sign-ups never confirmed deleted after 7 days; confirmed sign-ups that never create a venue deleted after 30 days; pending team invitations deleted a day after they expire or are accepted. | Q45 | Decided, yes, 2026-09-28 |
| P7 | A venue that never starts a subscription is listed in the daily operator email 30 days after sign-up; the operator decides whether to close it; the terms gain one sentence allowing it. | Q46 | Decided, yes, 2026-09-28 |
| P8 | Rate limits in our own database (`auth_rate_limits`), not Upstash: no new sub-processor, no DPA change, no customer notice. | Q47 | Decided, yes, 2026-09-28 |
| P9 | Cloudflare Turnstile on `/signup` only, checked by our server and named in the privacy notice; not Supabase's built-in CAPTCHA. | Q48 | Decided, yes, 2026-09-28 |
| P10 | Defer the admin Sign-ups card, the first-post help article and owner export and close buttons until after sign-up opens; meanwhile Settings shows "To close this venue or get a copy of your data, email peter@orangejelly.co.uk". | Q49 | Decided, yes, 2026-09-28 |
| P11 | Search engines may index `/` and the three legal pages; everything else stays disallowed. | Q50 | Decided, yes, 2026-09-28 |

## 4. Design

### 4.1 The front door: `/`

- Signed out: a landing page (what Cheers does, how it works, what you need, pricing, FAQs). Signed in: a temporary (307) redirect to `/planner`. Browsers that cached the old 308 keep going to `/planner`, then login; acceptable.
- Pricing comes only from `PLANS` (`src/lib/billing/plans.ts:45-70`): Starter £29.99 a month or £323.89 a year, Professional £59.99 or £647.89, Group "contact us", with limits and seats from the same file. Every price reads "ex VAT", with a line that VAT is added at the UK rate (L2). Trial text matches the terms: 14 days, card at the start, first charge on day 15 unless cancelled. No paid ads or tournaments (D1b).
- "What you need" names the prerequisites before anyone starts a time-limited trial (R19): admin access to the venue's Facebook Page, and for Instagram a professional account linked to it.
- Footer: company details from `src/lib/legal/company.ts` (required on the site), links to `/terms`, `/privacy`, `/data-processing`, `/help`, `/login`.
- CTA: switch off, "Talk to us" (email and WhatsApp from `CONTACT`); switch on, "Start your free trial". The login page's "Contact support" link (`login/page.tsx:266-272`) follows the switch. `/auth/signup` redirects (307) to `/signup`.
- No cookies added, so no banner (F17). `robots.ts` allows `/` and the legal pages (P11); `noindex` on `/signup/*` and `/auth/*`.
- Copy drafted only from `plans.ts`, the terms and `company.ts`; Peter approves it on the PR preview.

### 4.2 Sign-up request: `/signup`

Form: email and a Turnstile widget only. No name (it would put a stranger's text into our emails and onto a login before the email is proved) and no password (see below). Server action `requestSignup`, each step failing closed:

1. Environment: refuse on Vercel Preview (`VERCEL_ENV=preview`), because Preview writes to the production database (F16). Switch: read `app_flags.self_serve_signup`; an error counts as off ("Sign-up is not open yet. Talk to us.").
2. Validate the email (lower-cased).
3. Turnstile siteverify with the secret, the visitor's IP (first `x-forwarded-for` entry, set by Vercel), `action = signup`, and in production `hostname = cheers.orangejelly.co.uk`; 5-second timeout. Missing keys, timeout or failure: refuse.
4. Rate limits (P8): per email 3 an hour, per IP 10 an hour, and a site-wide 60 an hour that refuses and alerts the operator (it protects the shared Resend sending reputation). Keys are HMAC-SHA256 of the email or IP with `RATE_LIMIT_HMAC_KEY`, so the table holds nothing reversible.
5. Every address goes through the same first step, `generateLink({ type: 'invite', email })` with the service role, then the login's memberships are read by its user id. As built in PR 5 (28 September 2026), this replaces the `user_auth_snapshot` lookup first planned here: Supabase checks the address before it looks for a login, and refuses a confirmed login without changing anything, so the answer can never depend on who has a login.

| Case | Action | Email |
|---|---|---|
| No login | `generateLink` makes the login; upsert the sign-up row on `user_id` | "Confirm your email to start your Cheers trial" |
| Login, unconfirmed, no brand (an earlier abandoned sign-up) | new link; upsert the sign-up row on `user_id` (so it can never be missing) | same |
| Login, unconfirmed, has a brand or an open, unexpired team invitation (a member invited by the operator or an owner who never accepted) | new link, which replaces the old one; no sign-up row; never a create-a-venue link | the normal member invite (`renderInviteEmail`) with their brand names |
| Login, confirmed (Supabase answers `email_exists`) | nothing created or changed | "You already have a Cheers login": sign-in and reset links; "to add another venue, email peter@orangejelly.co.uk" (the sending address receives nothing) |
| Address Supabase refuses (400 or 422 `validation_failed` or `email_address_invalid`) | nothing created; no alert; the site-wide limit is not used | none; the form asks for a valid address (the same answer whether or not a login exists) |
| Any other `generateLink` error (network, timeout, or a 5xx twice: one 5xx is tried again, because two requests for the same new address race on Supabase's unique email index) or a membership or invitation lookup error | refuse, alert | none |

The site-wide limit is read (not counted) before `generateLink`, so nothing is created once it is reached, and counted only just before an email is sent, so a refused address never uses it up.

Accepted (reviews of PR #144, 28 September 2026):
- Two tabs asking for the same new address both succeed, and the second link replaces the first, so only the newest email's link works.
- The confirmed-login path answers a little faster than the others (it makes no link and writes no row), so response timing could hint that an address has a login. The screen is the same; timing padding is not added.
- An unconfirmed login that already has a password would be confirmed by a sign-up link and keep that password (whoever set it could then sign in). It cannot happen while Supabase public sign-up stays off (S1): only admin calls create logins, invites make them without a password, and production has no such login (0 of 3, checked read-only on 28 September 2026). It must be fixed before S1 ever changes.

6. The screen always says "Check your email" for the same email, so the form never reveals who has a login. It offers "Send it again" after 60 seconds (the same action and limits; the email stays in the page, never in the URL).

Why no password here: a password chosen before the email is proved lets someone register a victim's address with their own password and wait for the victim to confirm it.

Why app-level Turnstile, not Supabase's CAPTCHA: Supabase's CAPTCHA covers the public Auth endpoints and would force a challenge onto the existing login form, but it does not apply to admin calls, which is how this sign-up works; with public sign-up off (S1) there is no public sign-up endpoint left to protect.

Disposable emails: not blocked (lists go stale and catch real venues); the card-up-front trial, Turnstile, limits and the card check carry the load. The operator email shows the email domain.

### 4.3 Email confirmation

- `/auth/confirm` stops verifying on GET. GET shows a page with "Confirm and continue" (no token used, `noindex`, no referrer); the button POSTs, which runs `verifyOtp` and redirects to the fixed `next` (checked by `safeNextPath`). Link scanners that only fetch cannot burn the link. This covers invites and resets too, and old links keep working (Stage 1, PR 2).
- The email is not shown before the button: that would need the address in the URL, which we avoid. Instead `/signup/venue` says "Signed in as x@y.com. Not you? Sign out" at the top and asks the person to type their email, which must match the login. This defeats someone mailing their own sign-up link to a venue so that the venue sets up its card and Facebook under the sender's login.
- The link works on any device (a token hash needs no browser state). Expired or used: the existing link error on the login page, then "Send it again" or a new request.
- `/auth/confirm` cannot keep sign-up links shut while the switch is off (recorded after the review of PR #144): the link's `type` can be edited, and `signup` and `invite` links both verify as a Supabase invite, so a sign-up token also works as an invite link. The gate is `/signup/venue` (PR 6), which checks the switch before anything is created. **The switch must never be turned on before PR 6 is live.**
- Emails are rendered from fixtures in tests and fail on `undefined`, empty links or `Invalid Date`.

### 4.4 Venue creation: `/signup/venue`

For a signed-in, confirmed user (on first load it sets `verified_at`). A user who already belongs to a brand goes to `/planner` (or `/auth/set-password` for an invited member who never set one). Fields: your email (must match, §4.3), your name (1 to 80 characters, saved as `full_name` in the login's user metadata), password and confirm (12 to 72 characters, as `setPassword`), venue name (1 to 120 characters; refused if it contains `://`, `www.` or `@`, so it cannot carry a link into our emails), venue type (pub, bar, restaurant, cafe, hotel, other; saved to `brand_profile.business_type`, which ticks the checklist's profile step on its own, F13), and a required "I am signing up for a business, not as a consumer" (terms section 2, `src/app/terms/page.tsx:65-69`).

Server action `createSelfServeVenue`: Preview and switch checks; rate limit (per user 10 an hour); validate; the user id comes from `auth.getUser()`, never the form. Set the password and name (`auth.updateUser`, safe to repeat). Then call `public.provision_self_serve_brand(p_user_id, p_venue_name, p_business_type, p_email, p_legal_version)` through the service role: one plpgsql function (`security invoker`, `set search_path = public`), so one transaction:

- `select ... from self_serve_signups where user_id = p_user_id for update`; none: raise. This is the same row lock `delete_stale_self_serve_login` (PR 5) holds while it re-checks and deletes a stale login in one transaction, so provisioning either waits for that delete (and then finds no login) or finishes first (and the login, now with a venue, is kept). Provisioning must keep taking this lock;
- `account_id` already set: return it (a double submit, refresh or second tab ends here);
- insert `accounts` (`business_name` and `display_name` = venue name, `email` = sign-up email, Europe/London, `created_by_user_id` and `auth_user_id` = the user; switches and `billing_override` left at their defaults);
- insert `account_members` (role `owner`, `created_by` the user) and `brand_profile` (`account_id`, `business_type`);
- update the sign-up row (`account_id`, `venue_created_at`, `business_confirmed_at`, `legal_version`); return the id.

Then record `self_serve_venue_created` in `admin_audit` (ids only), email the operator (§4.9) and go to `/settings#billing`.

`self_serve_signups` (service role only; stores no email, name or IP):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid primary key, default `gen_random_uuid()` | |
| `user_id` | uuid unique, references `auth.users` on delete set null | the stable attempt key: one row per login |
| `account_id` | uuid unique, references `accounts` on delete set null | set once |
| `requested_at`, `last_requested_at` | timestamptz not null, default now() | |
| `request_count` | integer not null default 1 | |
| `verified_at`, `venue_created_at`, `business_confirmed_at` | timestamptz | |
| `legal_version` | text | version shown at the business tick |

An existing login with no brand sees "Start a free trial for your venue" on `/no-access` when the switch is on; that upserts its sign-up row and goes to `/signup/venue`. A member who wants a second venue is told to contact us (Group plan). Admin "Create brand" and invites are unchanged.

As built in PR 6 (28 September 2026):
- `provision_self_serve_brand` returns `{"status", "account_id"?}` instead of raising for expected refusals: `created`, `existing` (a double submit, refresh or second tab, while the login is still a member of that brand), `removed` (the login was removed from the venue it made), `venue_closed` (a venue made and since deleted is not replaced), `closed` (the switch, re-read under the lock), `member`, `admin`, `invited` (an open, unexpired invitation to a live brand), `no_login`, `unconfirmed` and `email_mismatch`. Every refusal is decided before the first write, so it leaves nothing behind. It is `security invoker` with an empty `search_path` (service_role can already write every table it touches). The login's existence, email and confirmation come from `self_serve_login_confirmation`, a `security definer` helper (service role only) that reads one row of `auth.users`, because service_role cannot read that table and `user_auth_snapshot` has no confirmation column. Bad arguments raise 22023.
- Admins and people with an open invitation to a live brand cannot make a self-serve venue (decided 28 September 2026 in the review of PR #146, matching how `self_serve_login_is_stale` protects them). `/signup/venue`, its action and `/no-access` share one rule (`decideVenueAccess`), checked before anything is saved: members go into the app, members of only archived brands and people removed from their venue get a notice, invited people are pointed at accepting, admins get neither form nor button. The database checks the same again under the lock.
- The operator's new-venue email and the `admin_audit` record are sent after the response (`after()` from `next/server`), the email with a 5-second timeout, so a slow Resend never makes a created venue look failed; a failure is logged and alerted.
- The `/no-access` entry is a plain link to `/signup/venue` and writes nothing; `provision_self_serve_brand` makes the sign-up row, under the lock, with the venue. Reason: a sign-up row with no venue on a login confirmed more than 30 days ago is what `self_serve_login_is_stale` deletes, so upserting the row on the click would get an old login deleted the next night.
- "Other" stores `hospitality venue` in `brand_profile.business_type`: the AI prompt writes "Business type: <value>" and tells the model not to write as a hospitality venue unless the type says it is one.
- `/signup/venue` records `verified_at` on the first visit when the login has a sign-up row. A member who arrives there goes to `/auth/set-password` when the session came from a one-time email link (Supabase AMR `otp`, as the local stack records an invite or sign-up link; `invite`, `recovery` and `magiclink` are accepted too) and this sign-up made no venue; otherwise to Billing (owner of an unpaid brand) or the planner.
- Rate limit: `signup_venue`, 10 an hour per login (a new per-login scope in the database limiter).
- The `/no-access` entry and the Settings line (P10) show only while the switch is on, so nothing changes for existing users before opening.

### 4.5 Trial and payment

- After the venue exists the owner lands on Settings, Billing: the existing chooser (Starter monthly preselected), a short welcome line, the existing Checkout with the terms and DPA tick box, and "Confirming your payment" on return. One addition: `legal_version` in the Checkout Session metadata, so the accepted version is readable in Stripe (§4.13).
- With enforcement on (P3) the brand is `incomplete` until the webhook confirms, so it cannot create or publish; the existing banner explains why. A cancelled Checkout leaves it `incomplete`; never-started brands are handled by P7.

### 4.6 Team invites once strangers can create venues (P4)

- **Gate:** `inviteTeamMember` refuses unless the brand's entitlement is `trialing`, `active`, `past_due_grace` or `comped` ("Start your plan to invite your team"). A card on file raises the cost of abuse.
- **Cap:** 5 invites per brand per rolling 24 hours (database limiter, key per account id), on top of seats; pending invitations count towards seats.
- **Existing users accept:** instead of inserting a membership, create a `team_invitations` row (`id`, `account_id` references `accounts` on delete cascade, `user_id` references `auth.users` on delete cascade, `role`, `invited_by`, `created_at`, `expires_at` 7 days, `accepted_at`; partial unique index on `(account_id, user_id)` where not accepted) and email "You have been invited to <venue> on Cheers; sign in to accept". Signed-in users see pending invitations and accept or decline; accepting inserts the membership with the user id from the session. A new address keeps today's flow (the login is created and the person accepts by setting a password).
- **Default brand:** `resolveActiveBrand` falls back to the brand the person joined first (`account_members.created_at`), not the first by name; a super-admin's own memberships come before brands seen only as super-admin. The switcher keeps its alphabetical display. A new membership therefore never changes anyone's default, including Peter's.
- The venue-name rule (§4.4) keeps links out of invite emails.

### 4.7 Repeat trials, checked by card (L6, P5)

- **Where:** inside `reconcileBrandFromStripe` (`src/lib/billing/reconcile.ts:345`), after the current subscription row is written and before `finish()` (`reconcile.ts:330-343`). One path serves the webhook, "Check again" and admin re-sync.
- **When:** the current subscription is `trialing`. Subscriptions created before the deploy time (a constant in code) are recorded as `first_trial` but never refused; today there are none (0 live subscriptions).
- **How:** retrieve the subscription with `default_payment_method` expanded; HMAC-SHA256 of `card.fingerprint` with `TRIAL_CARD_HASH_KEY`. Stripe events for one Checkout arrive together and reconcile concurrently (dedupe is per event, `src/lib/billing/webhook.ts:120-122`), so every write is race-safe:
  1. `insert ... (outcome 'first_trial') on conflict do nothing returning`. A row back: done.
  2. Nothing back: read this subscription's row. Present: a parallel reconcile already decided; use its outcome. Absent: the conflict was the partial unique index on `card_hash` where `outcome = 'first_trial'` (another brand holds that card's trial), so insert `repeat_refused` `on conflict (stripe_subscription_id) do nothing returning`.
  3. Only the reconcile that inserted `repeat_refused` cancels in Stripe (`invoice_now: false`, `prorate: false`; nothing is charged in a trial); "already cancelled" counts as success. It sets `cancelled_at`, then writes the cancelled subscription row from Stripe's response, so `finish()` sees the cancellation, not the trial. A row with `repeat_refused` and no `cancelled_at` is retried on the next reconcile.
  4. Records `trial_refused_repeat_card` in `admin_audit` and emails the operator. Billing then says: "This card has already been used for a Cheers free trial, so this plan cannot start with one. Start your plan today to carry on." The button is the existing `startCheckout`, which offers no trial because the brand now has an earlier subscription (`billing-actions.ts:245-246`).
  5. No card on the subscription: `outcome = 'no_card'`, operator email.
- **Failure:** a Stripe or database error throws; the webhook answers 500, Stripe retries and the existing webhook alert emails the operator. The trial runs meanwhile, a visible billing-control gap.
- **Table** `trial_card_checks`: `stripe_subscription_id` text primary key, `account_id` references `accounts` on delete cascade, `card_hash` text not null, `outcome` text check (`first_trial`, `repeat_refused`, `no_card`), `cancelled_at`, `created_at`; partial unique index on `card_hash` where `outcome = 'first_trial'`. Kept 24 months (P6). A deleted brand's rows go with it; accepted.
- **Config:** `TRIAL_CARD_HASH_KEY` joins the billing variables, so a missing key means "billing not set up" (the webhook answers 503 and Stripe retries) rather than breaking builds; Preview has no Stripe keys, so it needs none. The restricted key needs PaymentMethods read and Subscriptions write.
- **Limits:** Apple Pay and Google Pay may give device-specific fingerprints; accepted and checked in test mode. The same card on a second venue of one business is refused, matching "one free trial per business".
- **As built in PR 7** (`src/lib/billing/trial-card-check.ts`, migration `20260928200000_trial_card_checks.sql`):
  - Steps 1 and 2 are plain inserts; a unique violation (23505) plays the part of "on conflict do nothing", and the row is then read by subscription id, scoped to the brand. PostgREST cannot name a partial index as a conflict target; the database's behaviour is the same (checked by `supabase/tests/trial_card_checks_race_verify.sh`).
  - "When" is narrower than "trialing now": only a trial that began with its subscription (Stripe `trial_start` within 60 seconds of `created` or `start_date`, as Checkout's is) is checked. A paid subscription moved into a trial later (a free month given in the Stripe Dashboard) records nothing and is never refused (review of #152, 28 September 2026).
  - Follow-up to #152 (approved by Peter, 29 September 2026): the subscription must also carry `created_by=cheersai_checkout` in its metadata, which only `startCheckout` sets (`subscription_data.metadata`, `CHEERSAI_CHECKOUT_MARKER` in `src/lib/billing/stripe.ts`). `app=cheersai` alone does not count, because it only says the subscription belongs to CheersAI and can be typed in by hand. A trial Peter creates by hand in the Stripe Dashboard is never checked, refused or cancelled, and nothing is recorded for it, whatever its card. A row already recorded before this change is kept and acted on as before. Trial Checkout Sessions also set `payment_method_types: ['card']`, so every checked trial has a card fingerprint (Apple Pay and Google Pay still pay by card); Sessions without a trial set no payment method types and keep the Dashboard's settings.
  - Before inserting `repeat_refused`, a count confirms a `first_trial` row exists for the card code (the one deliberate cross-brand read, count only), so a primary-key clash with a row that has since gone is never read as a card clash; otherwise the reconcile fails and is retried.
  - Step 3's order is cancel, store the cancelled subscription row, operator email, `admin_audit` (skipped when that subscription's row already exists), then `cancelled_at` last, so `cancelled_at` means "all done" and any failure leaves it empty for the retry: the email at least once, one audit row. A reconcile that did not insert the refusal (a parallel event, or our own cancellation's events) waits up to 20 seconds for it to finish, then fails so Stripe redelivers; a refusal still unfinished 10 minutes after it was recorded is finished by the next reconcile, and only one reconcile per subscription may take over in each 10-minute window (`consume_rate_limit` key `trial_card_finish:<subscription id>`), so retries arriving together send one cancel, one email and one audit row. A refused trial that is somehow no longer a trial by then (charged) fails the reconcile for a person to decide rather than cancelling a paid plan.
  - A refusal finished for a subscription that is no longer the brand's current one (the owner started a paid plan meanwhile) is stored one millisecond older than the current row, like reconcile's other rows, so the brand's state still comes from its current subscription. A refused subscription Stripe no longer lists on the brand's customer alerts the operator (`operator_stripe_trial_card_alert`, at most once a day per brand) and the reconcile carries on.
  - A trial from before `TRIAL_CARD_CHECK_STARTS_AT` (13:00 London time, 28 September 2026, earlier than the deploy; production had no trialing subscription then) is recorded as `first_trial` when its card is free; when the card already has a first trial it cannot be recorded as one (the unique index), so nothing is recorded and it is not refused.
  - `no_card` rows carry `card_hash = 'none'`; if the operator email fails, the row is removed so the retry records it and emails again.
  - The table adds NOT NULL on `account_id`, `outcome` and `created_at`, a check that `card_hash` is 64 lower-case hex characters (or `none` for `no_card`), and an index on `account_id`.
  - Checkout needs `TRIAL_CARD_HASH_KEY` too, so no trial starts that the webhook could not check; the read-only `hasLiveCheersSubscription` does not.
  - Billing shows the refusal message instead of "Confirming your payment" on return from Checkout.

### 4.8 Facebook and Instagram until Meta approves (P2)

- A self-serve owner has no role on the Meta app, so Meta will not grant the Standard-access permissions. What they would see has not been tested; most likely Meta's dialog refuses or Cheers shows "No Facebook Pages found for the connected account." (`src/lib/connections/token-exchange.ts:99`).
- Options: (a) open now with "connect later": rejected, the trial clock runs with nothing to post; (b) add each owner as an app tester: works for a few assisted venues, needs an acceptance step in Meta's developer settings, not self-serve; (c) a waitlist form: another store of personal data for little gain; (d) build now, open later: recommended.
- Launch order: App Review approved (`docs/runbooks/meta-app-review.md` §6); the D7 gate passes, including the business-portfolio Instagram case that may need `ads_read`; `billing_enforcement` on (P3); then the sign-up switch on.

### 4.9 Onboarding and operator visibility

- Onboarding is the existing checklist (F13): profile is already ticked by the venue type; then Facebook, Instagram, first post.
- New venue: one email to `OPERATOR_ALERT_EMAIL` (venue name, type, sign-up email, time). A failed send is logged and never blocks the customer.
- Sign-up failures caused by a dependency (switch read, Turnstile, limiter, lookup or `generateLink`, Resend, provisioning) and the site-wide limit: first write `operator_signup_alert` to `admin_audit` (kind and count only; that table keeps rows 6 years), then email at most once per kind per hour. Ordinary validation errors do not alert.
- The daily data-retention email (`docs/runbooks/data-retention.md`) gains: every `operator_signup_alert` row from the last 24 hours (so a Resend outage that killed the instant alert still shows up next morning); "stuck" sign-ups (verified with no venue after 1 day; venue with no Checkout after 3 days; trialing with no connection after 3 days); and "never started" (P7).
- As built in PR 6: the lists above are added to the daily operator reminder (`src/lib/signup/digest.ts`), each only when it has something in it. Days are London calendar days. "Verified with no venue" lists logins confirmed 1 to 29 days ago with no brand and no open invitation. "No Checkout" covers venues 3 to 29 days old; from day 30 to day 89 the venue is "never started" (P7, counted from venue creation), then it drops off, so the lists stay bounded. "Trialing with no connection" counts from the trial subscription's first record. A login without a venue is listed by id only. If the lists cannot be read, the email says so and still goes out.
- As built in the Later PR (`feat/signup-admin-card`, 28 September 2026, built now at Peter's request, his question 53): the admin page has a **Sign-ups** card for super admins. It fetches its figures after the page loads from `/api/admin/signups`, which checks the flag before any read (so the refresh after an admin action never waits for it). It shows the §4.10 funnel for the last 7, 30 and 90 London calendar days and the lists above, from the same code as the email (`findSignupDigest`; the funnel in `src/lib/signup/funnel.ts`), with the switch state so zeros read as "closed". No email addresses: venue names, and a login id where there is no venue. Its reads never throw: a failure or an 8-second deadline (which cancels every read) shows an error on the card and is logged, and the rest of the page works. The "first post" step is one limit-1 check per venue, so it grows with venues, not posts. It shows while the switch is off (zeros). The first-post help article is `/help/first-post`, following the create wizard as built; it is linked from the checklist's "Publish your first post" step and the Help Centre, and like the other customer-facing pieces it is not found and unlinked while the switch is off or unreadable. No migration.
- **Database down:** sign-up refuses with the fallback message; the alert row cannot be written, so the email is sent without the dedupe lookup, limited to one per kind per server instance per hour. **Resend and database both down:** only Vercel logs (1 day) and Supabase's own status emails remain. Adding Axiom would need a sub-processor change (L4), so it is not proposed here.

### 4.10 Funnel

- Stored steps (`self_serve_signups`): `requested_at`, `verified_at`, `venue_created_at`. One row per login, so retries never count twice.
- Derived steps, using the checklist's rules (F13): checkout confirmed = the brand's first `subscriptions` row; channel connected = `social_connections` active or expiring; first published post = a `content_items` row with status `posted`. A later disconnect or deleted post can remove a derived tick; acceptable.
- No cookies or client-side tracking. The query lives in the runbook; the admin card is deferred (P10):

```sql
select count(*) as requested, count(verified_at) as verified, count(venue_created_at) as venue_created,
  count(*) filter (where exists (select 1 from subscriptions s where s.account_id = x.account_id)) as checkout_confirmed,
  count(*) filter (where exists (select 1 from social_connections c where c.account_id = x.account_id and c.status in ('active','expiring'))) as channel_connected,
  count(*) filter (where exists (select 1 from content_items i where i.account_id = x.account_id and i.status = 'posted')) as first_post
from self_serve_signups x where x.requested_at >= now() - interval '30 days';
```

- Retention (P6): `run_data_retention` deletes sign-up rows 24 months after `requested_at` and expired `team_invitations`; it also returns the ids of self-serve logins due for deletion (no membership, not an admin, no open team invitation, a sign-up row with no venue, and either unconfirmed 7 days after the last request or confirmed for 30), which the cron deletes with `auth.admin.deleteUser` as offboarding does (`src/lib/admin/offboarding.ts:330`), at most 100 a run. Their `user_auth_snapshot` rows go with them (trigger `trg_purge_user_auth_snapshot`). As built in PR 5: the rule lives in one function, `self_serve_login_is_stale`; for each listed login the cron calls `delete_stale_self_serve_login`, which in one transaction locks the sign-up row, applies the whole rule again and deletes the row in `auth.users` (not through `auth.admin.deleteUser`, so nothing can change between the check and the delete; Supabase then writes no `user_deleted` security-log entry for it). Identities and sessions go by cascade and the `user_auth_snapshot` row by trigger. A sign-up request's upsert takes the same row lock. A login that cannot be deleted (for example one with `audit_log` rows, whose foreign key has no delete action) is reported as failed, logged, retried the next day and alerted (kind and count only), and never fails the retention run.

### 4.11 Rate limits (P8)

- `public.consume_rate_limit(p_key text, p_limit int, p_window_seconds int)`: one atomic upsert on `auth_rate_limits` that resets an expired window and returns whether the call is allowed and when the window resets. Keys are `<purpose>:<hmac>` with `RATE_LIMIT_HMAC_KEY` (required in Production and Preview).
- Sign-in: 5 a minute per email and IP pair, 20 a minute per IP. Keying on the pair means nobody can lock The Anchor's login by failing from elsewhere; distributed guessing against one email is left to the 12-character password rule.
- Magic link and reset: 3 an hour per email, 10 an hour per IP. Sign-up and invites as in §4.2, §4.4 and §4.6.
- A limiter error refuses the action with a visible error (fail closed). So the migration must be applied, and the key set, before the code deploys, or nobody can sign in (§5).

### 4.12 Abuse and security

- **Fail closed:** every public write refuses on dependency failure, shows "We could not finish this. Please try again, or email peter@orangejelly.co.uk", and alerts (§4.9); each handler gets a test that injects the failing dependency and asserts both.
- **Enumeration:** one screen for every email outcome (§4.2).
- **CSRF:** server actions only; Next.js checks Origin against the host (no `allowedOrigins` override). The only new POST outside an action is the confirm button, which carries the one-use token.
- **Service role:** user ids always come from the verified session; every new query carries `.eq('user_id', ...)` or `.eq('account_id', ...)`.
- **Grants** (F15): every new table gets RLS on with no policies, `revoke all ... from public, anon, authenticated` and `grant all ... to service_role`; every new function (`consume_rate_limit`, `provision_self_serve_brand`) gets `revoke all on function ... from public, anon, authenticated` and `grant execute ... to service_role`. Before opening, also revoke EXECUTE on `increment_rate_limit` from `authenticated`. A new `supabase/tests/self_serve_grants_verify.sql`, run on a local rebuild, fails if anon or authenticated can execute the new functions or read or write the new tables; the same SELECT checks run read-only against production after each migration.
- **CSP:** add `https://challenges.cloudflare.com` to `script-src` and `frame-src` (`src/lib/security/headers.ts`, unit-tested).
- **Legacy route:** delete `/api/auth/login` (F4).

### 4.13 Legal and privacy

- **Privacy notice:** a sign-up records row (when you asked, confirmed and created your venue; to run sign-up and see where people drop off; legitimate interests); the billing row adds a keyed code made from the card's Stripe fingerprint to keep to one free trial per business; a security line naming Cloudflare Turnstile on the sign-up form (IP and browser details), with Cloudflare's role taken from its Turnstile privacy terms; retention rows per P6; cookies section changed only if Turnstile stores anything (checked at build). Added in PR 5 (version 2026-09-28.3): the sign-up records row says Supabase's security log (`auth.audit_log_entries`, 24 months) keeps the typed email and the time of each sign-up link (`user_invited`) and of any login deletion made through Supabase (`user_deleted`); the stale-login clean-up deletes in SQL and writes no such entry.
- **Terms:** the one-trial line (`src/app/terms/page.tsx:72`) adds "for example, when the card has been used for a trial before"; section 18 adds the never-started sentence if P7 is agreed.
- **DPA:** no change. Turnstile sits only on the sign-up form, whose data is Cheers's own account data (controller, L4); the limiter stays in Supabase (P8). No sub-processor notice.
- **Notice (terms section 19):** the new terms apply to new customers from publication. Anyone who accepted an earlier version gets an email at least 30 days before the change applies to them. On the day the legal PR is ready, list who has accepted: owners of every brand with a `subscriptions` row that is not comped or offboarded (each passed the tick box; the version is on their Checkout Session, and from §4.5 also in its metadata). Today that is nobody (0 live subscriptions; the 1 cancelled row is Peter's test brand), so shipping the legal PR before the first paying customer needs no notice. If anyone has accepted by then, Peter sends the notice and the effective date goes on the terms page.
- **Version:** bump `LEGAL_VERSION` and `LEGAL_UPDATED` together (`src/lib/legal/company.ts:33-34`).

## 5. Build stages

Each PR deploys on its own, passes `npm run ci:verify` (London and UTC), targets production's shape with its own grants, and applies its migration (with Peter's yes) before its code deploys.

| # | Branch | What | Migration | Gate |
|---|---|---|---|---|
| **Stage 1 (P1: can ship now)** | | | | |
| 1 | `fix/auth-rate-limits` | Database limiter replacing the Upstash no-op on sign-in, magic link and reset (§4.11); delete `/api/auth/login`; remove `@upstash/ratelimit` and `@upstash/redis`; `config.toml` `[auth] enable_signup = false`, `[auth.email] enable_confirmations = true` (now matching live) | `consume_rate_limit` with explicit grants | Order: migration, then `RATE_LIMIT_HMAC_KEY` in Production and Preview, then deploy; then sign in as Peter |
| 2 | `fix/auth-confirm-button` | `/auth/confirm` GET shows "Confirm and continue", POST verifies (§4.3) | none | none |
| **Stage 3 (dark until opening)** | | | | |
| 3 | `feat/front-door-and-legal` | §4.1 landing and pricing, robots, footer, redirects, login link; §4.13 wording, version bump, `legal_version` in Checkout metadata | insert `app_flags ('self_serve_signup', false)` | CTA follows the switch; notice check (§4.13) before merge |
| 4 | `feat/team-invite-guard` | §4.6 gate, cap, `team_invitations` and accept page, default-brand fix | `team_invitations` with grants; `run_data_retention` restated | before opening |
| 5 | `feat/signup-request` | §4.2 and §4.3: `/signup`, Turnstile (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` in `src/env.ts`, required in production, Cloudflare test keys in Preview), `requestSignup`, emails, resend, CSP, alerts (including a browser report when the Turnstile widget cannot load), Preview refusal, grants SQL check; the stale-login clean-up step in the retention cron (§4.10), moved here from PR 6 because this PR creates the logins | `self_serve_signups`; `record_self_serve_signup_request`, `self_serve_login_is_stale`, `delete_stale_self_serve_login`; `run_data_retention` restated; revoke `increment_rate_limit` from authenticated | switch |
| 6 | `feat/signup-venue` | §4.4 (the switch gate for confirmed sign-up links, §4.3), `/no-access` entry, operator emails, digest lists (§4.9), Settings email line (P10) | `provision_self_serve_brand` with grants; it takes the sign-up row lock (§4.4) | switch; must be live before the switch is ever turned on |
| 7 | `feat/trial-card-check` | §4.7 | `trial_card_checks` with grants; `run_data_retention` restated | after PR 3 is live |
| **Later (P10)** | `feat/signup-admin-card`, `feat/owner-export-closure` | Admin Sign-ups card and first-post help article; owner "Download my data" and "Ask us to close this venue" | none | after opening |

When PRs 5 and 7 restate `run_data_retention`, they must carry PR 4's rule 13 (`team_invitations`, migration `20260928161500_team_invitations.sql`) and every earlier rule unchanged, and extend `supabase/tests/data_retention_verify.sql` rather than replace it.

Tests (Vitest, mocks only; SQL checks on a local rebuild):
- PR 1: allow, block, reset; limiter error refuses with a visible error; pair keying (a second IP still signs in); concurrent calls at the limit let exactly one through (SQL).
- PR 2: GET never calls `verifyOtp`; POST verifies and redirects only to a safe path; invite and reset links from before the change still work.
- PR 3: signed-in visitor 307; prices from `PLANS` with "ex VAT"; no ads or tournament text; CTA per switch; switch read error shows "Talk to us"; robots output; metadata carries `legal_version`.
- PR 4: incomplete, lapsed and suspended brands cannot invite; sixth invite in 24 hours refused; existing user gets an invitation, not a membership, until accepting; expired invitation refused; a new membership does not change the default brand (ordinary user and super-admin).
- PR 5: one test per failing dependency (§4.9 list) asserting the user's error and the alert; the same screen for all five cases in §4.2; the member case sends the member invite and writes no sign-up row; re-request always leaves a sign-up row; Preview refuses; templates from fixtures; grants SQL check.
- PR 6: email mismatch refused; double submit, refresh and two tabs give one venue; failure mid-function leaves no account and no membership (SQL); defaults on the new brand; member redirected; form user id ignored; venue names with links refused; digest lists from fixtures (London dates, a clock-change day).
- PR 7: first trial recorded; repeat refused without charge, then no trial offered; two concurrent reconciles make one decision and one cancel; two brands with one card: one `first_trial`, one refused; `finish()` sees the cancellation; pre-deploy subscription recorded, not refused; Stripe error throws (webhook 500).

Rollback: switch off (`app_flags`, no deploy) stops new sign-ups at once; each PR reverts on its own; tables and functions are additive and can stay. Reverting PR 1 returns sign-in to the old no-op limiter, which is today's state; the function can stay. A refused trial or a sent email cannot be undone.

As built in `feat/owner-export-closure` (Later, P10; no migration): Settings gains "Your data and closing this venue" in place of the P10 email line, with the same switch rule (switch on; unreadable counts as off), shown only to a real owner: an `account_members` row with role `owner` for the active brand. A super-admin's implied owner role does not count, so the operator cannot export under the customer's quota or file (and so hold back for a day) the customer's closure request; operators export from Admin. "Download my data" posts to `/api/settings/data-export`, which gives the owner the operator's Admin export (`exportBrandData` and `brandExportFile`, so the same content, layout and file name). It checks a request header only our pages send, that the page's brand is still the active brand, the owner row and the switch; reads the `owner_data_export` counter without counting (3 per brand per 24-hour window; a new per-brand scope, keyed by an HMAC of the brand id); takes a per-brand claim (`owner_data_export_lock`, 1 per 60 seconds, the route's time limit), so a burst of presses builds one export, and counts a build (`owner_data_export_attempt`, 10 per brand per 24-hour window; reaching it alerts the operator), so exports that keep failing or are cut off by the time limit cannot run on without end; builds the file in full; counts it as a download (atomic, so no more than 3 files leave per window); records it in `admin_audit` (`export_brand_data`, detail `{kind: 'owner_download'}`) only for a file about to be sent; and streams it. A failure before the count never uses up the owner's quota, and streaming means a large brand is not cut off by Vercel's 4.5 MB response limit. Admin's *Export data* moved onto the same streamed download (`/api/admin/brand-export`, replacing `exportBrandDataAction`), with the operator's check and record unchanged (super-admin only; `export_brand_data` with actor and brand, no detail); a failed sign-in lookup there answers "The export failed. Try again." and alerts as `admin_export`. "Ask us to close this venue" is the `requestVenueClosure` action. After the same checks, a request for the brand in the last 24 hours means nothing is sent (the page says an owner of the venue asked, and when). Otherwise it takes a per-brand claim in the database limiter (`venue_closure_lock`, 1 per 60 seconds), so two tabs or two owners pressing Send together, or a retry just after a send that timed out, send one request; caps sends at 5 per brand per 24-hour window (`venue_closure_attempt`), so a record that keeps failing cannot flood the operator; and reads `admin_audit` again under the claim. It then emails the operator (it must send, or the owner sees an error with our address), records `venue_closure_request` in `admin_audit` (ids and `{kind: 'owner_request'}`), and emails the owner a confirmation that lists the runbook's steps and the 30-day deletion; it deletes and stops nothing. Dependency failures, including a failed sign-in lookup (`AuthDependencyError`), show the owner an error with our address and alert through the sign-up alert path as `owner_export`, `closure_request` and `closure_notice` (subject "Owner request problem"), so they also reach the daily digest, which now says which kinds refused nobody.

## 6. Off-app work

| When | What | Who |
|---|---|---|
| Done 28 Sep | Supabase: public sign-up off, confirm email on (S1). | Peter |
| Before PR 1 deploys | `RATE_LIMIT_HMAC_KEY` (64 hex characters) in Vercel Production and Preview. | Peter, or Claude with his yes |
| Before PR 5 deploys | Cloudflare Turnstile widget for `cheers.orangejelly.co.uk` (managed); real keys in Production, Cloudflare's test keys in Preview. | Peter |
| Before PR 7 deploys | Stripe: PaymentMethods read and Subscriptions write on the "CheersAI production" restricted key; `TRIAL_CARD_HASH_KEY` (64 hex characters) in Production. | Peter |
| Before opening | Meta: App Review approved and the D7 gate passed (runbook §7). | Peter |
| Opening day | `billing_enforcement` on, then `self_serve_signup` on (SQL, each with Peter's yes). The app holds this order: sign-up is open only while both are on, so `self_serve_signup` on first keeps sign-up closed and alerts the operator (`signup_without_enforcement`). Re-check `billing_override` on every live brand; one real sign-up by Peter on a spare email and card, cancelled in the portal before day 15. | Claude runs, Peter approves |

As built in `fix/signup-needs-billing-enforcement` (29 September 2026, no migration): P3 no longer depends on the runbook. `src/lib/signup/switch.ts` reads `self_serve_signup` and `billing_enforcement` in one query and answers `open` only when both are `true`. The switch on with enforcement off, or its row missing (billing treats a missing row as off too), answers `enforcement_off`, which every caller treats as closed, exactly as when the switch is off: `/` goes to the login page, robots.txt disallows everything, the legal pages stay noindex, `/signup` and `/signup/venue` say sign-up is not open yet, `/no-access` offers no trial, Settings shows no owner export or closure actions and the first-post help article is not found. Each such read logs a warning and raises a `signup_without_enforcement` operator alert through the sign-up alert helper: at most once an hour per loaded copy of the code (a local run raised it twice, from robots.txt and from the pages), sent after the response so no page waits, one email an hour overall, kind and count only. The admin Sign-ups card then says "Sign-up switch on, but billing enforcement is off: sign-up stays closed." A failed read is still `unavailable` (closed, alerted as `switch` by the sign-up actions). `provision_self_serve_brand` still re-reads only `self_serve_signup` (SQL unchanged); `createSelfServeVenue` checks the switch before it calls the function, so the app gate is the control.

## 7. Verification (local stack only, never production)

- Local Supabase per `docs/runbooks/stripe-billing.md` "Testing in test mode", with the `config.toml` auth settings from PR 1; Stripe test mode with `stripe listen`; Turnstile test keys (always pass, always fail); Resend to a plus-addressed mailbox Peter owns. Automated e2e injects the email sender and follows the captured link through the confirm button.
- Must-pass journeys: new owner end to end to a trialing brand; the same card on a second brand refused with no charge; each §4.2 case; a link opened by a "scanner" GET then by the person; a link opened on another device; someone else's link refused at the email check; double submit and two tabs; database stopped mid-journey; Turnstile and Resend failing; switch off mid-journey; `/no-access` user starting a venue; a stranger's brand trying to invite before and after Checkout; keyboard-only and mobile width on every new page (WCAG 2.2 AA as the design target).
- Grants: `self_serve_grants_verify.sql` passes on a local rebuild, and the same checks read back from production after each migration.
- Say it works only after running these paths and quoting what was seen.

## 8. Out of scope

Self-serve Group plan and second venues for existing members; paid ads, tournaments and management import for new brands (D1b, D1c); AI caps (D2d); automatic offboarding or deletion (D5); analytics or marketing cookies; a waitlist; Google sign-in; moving admin Create brand onto the new function; anything in the Anchor website or management app (no hours, availability, booking or Turnstile change there).

## 9. Risks

| Risk | Handling |
|---|---|
| Meta approval is slow or rejects `business_management` | Sign-up stays closed (P2); assisted launch with testers continues. |
| PR 1 deployed before its migration or key | Build fails without the key (required in production); runbook order puts the migration first; sign in as Peter straight after deploy. |
| Preview writes to the production database | Sign-up actions refuse on Preview (§4.2). |
| Wallet cards bypass the card check | Accepted; the operator sees every refusal. |
| Resend reputation hit by abuse | Turnstile, per-IP and site-wide limits, the invite gate and cap, the venue-name rule. |
| A trial runs while the card check is retried | Visible through the webhook alert; re-sync after the fix. |
| Peter's switcher grows with every self-serve brand | Display only; the default brand stays the one he joined first (§4.6). |
| An owner can tell whether an email address already has a Cheers login: an existing login appears under "Waiting to accept", a new address gets access at once (§4.6, P4) | Accepted after the PR 4 review (28 September 2026), no code change: only trialing, paid, past-due-grace or comped brands can invite, and each counts towards the cap of 5 invites a day per brand. |
| Enforcement switched on breaks a brand | All live brands are comped; re-check on the day. |

## 10. Pending decisions

Only P2 (when sign-up may open, tied to Meta App Review) is open; see §3.1. P1 and P3 to P11 were decided on 2026-09-28.

## 11. Review findings (28 September 2026) and where they are handled

| Finding | Where |
|---|---|
| 1 Login open redirect | Done by #137 (S2, F3); removed from Stage 1 |
| 2 Team invites as a public write path | §4.6, P4, PR 4 |
| 3 Confirm link signs in whoever opens it; scanners; no resend | §4.2 step 6, §4.3, PR 2 |
| 4 Default EXECUTE for `authenticated`; anon-only test | F15, §4.12 grants, `self_serve_grants_verify.sql` |
| 5 Stranded re-request; killing a member's invite | §4.2 table |
| 6 Card-check races; stale `finish()`; backfill wording | §4.7 |
| 7 Name before email proof | §4.2, §4.4 |
| 8 Terms change notice | §4.13 notice |
| 9 Operator visibility | §4.9 |
| 10 Unused confirmed logins; table columns; HMAC; sign-in lockout | §4.4 table, §4.10 retention, §4.11 |
| 11 Turnstile keys; Preview validation; PR 1 order | PR 5 row, F16, PR 1 row, §9 |
| 12 Facts | F8, F13, F15 |
| 13 Scope | PRs 2 and 3 of v1 merged into PR 3; admin card and export deferred (P10) |
