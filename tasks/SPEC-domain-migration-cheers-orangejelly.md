# SPEC v2: Move CheersAI from cheersai.uk to cheers.orangejelly.co.uk

- **Status**: Revised after third-party developer review; all decisions settled;
  **both code changesets written, verified and committed on branches**. Remaining
  work is environment and console changes, which are the owner's.
- **Supersedes**: v1 (2026-09-02 morning). Review at
  `tasks/REVIEW-SPEC-domain-migration-cheers-orangejelly.md`.
- **Revised**: 2026-09-02, after re-verifying every claim in the review live and
  again after implementation.
- **Complexity**: 4 (L). Two repositories, two environment stores, four third-party
  consoles and a DNS provider.
- **Deadline**: was `cheersai.uk` expiring 2026-09-07 16:31:28 UTC. **Lifted: the
  owner has renewed for a year** (§0.3 Q1, with a propagation caveat).
- **Branches**: `OJ-The-Anchor.pub` `fix/cheersai-base-url` (commit `46e0093f`);
  `OJ-CheersAI2.0` `chore/domain-migration-cheers-orangejelly` (commit `75a8218`).
  Neither is pushed. The Anchor branch **must deploy first** (D10).

---

## 0. What changed since v1

### 0.1 Review disposition

Every one of the review's 22 findings was re-checked live before being accepted.
Nothing was taken on trust.

| Finding | Verdict | Where handled |
|---|---|---|
| F-01 stale starting state | **Confirmed by independent re-check** | §2.1, §6 |
| F-02 expiry only 5 days away | **Confirmed, 2026-09-07T16:31:28Z via Nominet RDAP** | §1, §6 |
| F-03 lapse creates takeover risk | Accepted as a decision for the owner | §0.3 Q1 |
| F-04 redirect breaks authenticated calls | **Confirmed and strengthened by measurement** | §4.1, §6 |
| F-05 Supabase Auth SMTP unaddressed | **Confirmed, but impact materially overstated** | §4.2 |
| F-06 destructive Meta reconnect tests | Accepted | §7 V9-V10 |
| F-07 in-flight OAuth window | Accepted | §6 Gate 3 |
| F-08 Meta app ID mapping unproven | **Confirmed. v1 gave a wrong instruction** | §2.5 |
| F-09 auth journey inventory wrong | **Confirmed, plus a further finding v1 and the review both missed** | §4.3 |
| F-10 redirect allowlist too broad | Accepted | §5.4 |
| F-11 D8 contradicts itself | Accepted, merged with O-01 | D8 |
| F-12 Anchor inventory and CI wrong | **Confirmed** | §5.2, §7 V16 |
| F-13 redirect semantics unspecified | Accepted, **with a correction** | §0.2, §5.4 |
| F-14 phase and rollback claims inaccurate | Accepted | §8 |
| F-15 weak or unsafe checks | Accepted | §7 |
| F-16 no owners or gates | Accepted | §6 |
| F-17 no monitoring period | Accepted | §9 |
| F-18 audits not reproducible | Accepted | §10 |
| F-19 email channels conflated | Accepted | §4.4 |
| F-20 preview/dev ambiguous | Accepted | §5.3 |
| F-21 https://localhost in .env.example | **Confirmed** | §5.1 |
| F-22 "no SEO risk" too strong | Accepted | §2.7 |
| O-01 single base URL | Accepted | D8 |
| O-02 executable preflight | Accepted | §10 |
| O-03 decouple mail domain from web host | **Accepted and upgraded to a decision** | D4 |
| O-04 non-functional smoke baseline | Accepted | §7 V17 |

### 0.2 Where this spec corrects the review

Three points where the review is imprecise, each verified by measurement:

1. **F-05 overstates the impact.** The review treats Supabase Auth email as a P0
   cutover blocker. It is not, because **no Supabase Auth email has ever been sent
   in this project**. `auth.users` shows `confirmation_sent_at`,
   `recovery_sent_at` and `email_change_sent_at` all null; `auth.audit_log_entries`
   contains 73 `login` and 3 `user_signedup` actions and **zero** magic-link or
   recovery actions; the sole user has a password set. Auth email is an untested
   code path, not a working one that the migration might break. It stays in scope
   as a gap to close, not as a gate.

2. **F-13's remedy is not sufficient on its own.** The review suggests a 307 with
   path and query preservation as the safe rollback bridge. Measured against Node's
   `fetch` (undici, which is what The Anchor runs), a cross-origin redirect strips
   `Authorization` at **every** status code:

   | Status | Method | Body | `Authorization` | `x-api-key` |
   |---|---|---|---|---|
   | 301 | POST becomes GET | dropped | **stripped** | preserved |
   | 302 | POST becomes GET | dropped | **stripped** | preserved |
   | 307 | preserved | preserved | **stripped** | preserved |
   | 308 | preserved | preserved | **stripped** | preserved |

   So there is **no redirect status that bridges the booking-conversion ingest**,
   which sends `Authorization: Bearer`. Conversely the World Cup feed sends
   `x-api-key`, a custom header, which survives. The redirect is a bridge for the
   feed and for browsers, and never for the booking ingest. Reordering is not an
   optimisation; it is the only thing that works.

3. **F-01's Vercel claim needs a caveat.** `cheers.orangejelly.co.uk` is
   definitely serving the CheersAI production deployment (verified by HTTP), but
   `vercel domains inspect orangejelly.co.uk` does **not** list it under any
   project. The HTTP evidence is authoritative; the CLI listing is stale or
   incomplete. Confirm in the Vercel dashboard before relying on it.

### 0.3 Decisions taken and still open

All answered by the product owner on 2026-09-02. **Nothing is open.**

| Q | Answer |
|---|---|
| Target hostname | `cheers.orangejelly.co.uk`, confirmed |
| Expiry date | Was unknown to the owner. Established as 2026-09-07 16:31:28 UTC, then renewed |
| Fix the broken Resend email as part of this | **Yes.** Done, §4.3 and D4 |
| Printed material carrying the old URL | **None** |

The two questions raised by the review:

- **Q1. Renew `cheersai.uk` for one year: YES, the owner has done this.** The
  hard deadline in section 1 is therefore lifted and the rollback route in
  section 8 stays open. **Caveat: the renewal was not yet visible in Nominet RDAP
  at 08:36 UTC**, which still reported `expiration = 2026-09-07T16:31:28Z`.
  Registry propagation commonly lags a renewal. **Re-check at Gate 0** with the
  RDAP command in section 10 and do not begin Phase E until the new expiry is
  visible.
- **Q2. Supabase Auth email: accepted as a known gap, not closed here.** Magic
  link and admin invite remain untested. V6b is out of scope. The compensating
  control is V5a in section 6: password login must be proven on the new host
  before the flip, because there is no tested recovery path (§4.2).

---

## 1. Problem and deadline

`cheersai.uk` was due to expire **2026-09-07 16:31:28 UTC** (Nominet RDAP,
registered 2025-09-07, status `client transfer prohibited`). **The owner has
renewed it for a year**, so the migration is no longer racing that date and the
old host stays available as a redirect and a rollback route.

Everything served on `https://www.cheersai.uk` still moves to
`https://cheers.orangejelly.co.uk`, and every system that talks to that hostname
is repointed. The renewal changes the schedule, not the work: the sooner the old
host stops being load-bearing, the smaller the residual risk in R11.

**One check before Phase E:** confirm the new expiry is visible in Nominet RDAP
(§10). It had not propagated as of 08:36 UTC on 2026-09-02.

---

## 2. Verified current state

Re-verified 2026-09-02 after the review. Method stated for each so a reviewer can
repeat it. Section 10 gives the commands.

### 2.1 DNS and hosting: Phase A is already complete

**This changed during the day.** At 08:05 BST `cheers.orangejelly.co.uk` was still
answered by the proxied Cloudflare wildcard parking page. By 09:05 BST it was:

| Fact | Value | Method |
|---|---|---|
| `cheers.orangejelly.co.uk` | CNAME `b2a246dd3827302f.vercel-dns-016.com`, A 216.150.1.65 / 216.150.16.65, **no `cf-ray` header, so DNS-only, not proxied** | `dig @1.1.1.1`, HTTP headers |
| Serves | The CheersAI production deployment. `/` 308 to `/planner`, `/login` 200, `/l/the-anchor` 200, `/privacy` 200, all with `server: Vercel` and a `x-vercel-id` | HTTP probe |
| Control | `zz-control-4f21.orangejelly.co.uk` still returns the Cloudflare wildcard (104.21.74.96 / 172.67.201.193), proving the `cheers` record is explicit, not wildcard | `dig` |

**Who made this change and when is not established.** Before executing anything
else, confirm the change owner and whether any Meta, Supabase, Resend or Vercel
environment settings were altered at the same time. Section 10's preflight
re-checks all of them.

Other DNS facts, unchanged from v1:

| Fact | Value |
|---|---|
| `www.cheersai.uk` | CNAME `10f2952c7b8f8f1e.vercel-dns-016.com` |
| `cheersai.uk` apex | 307 to `https://www.cheersai.uk/`, `content-type: text/plain`, a Vercel domain-level redirect, not the middleware |
| `cheersai.uk` MX / SPF / DKIM / DMARC | **None. Zero TXT, zero MX.** |
| Both zones | Cloudflare |
| `*.orangejelly.co.uk` | Proxied wildcard to a domain-parking frameset |
| Sibling subdomains on Vercel | planner, management, baronshub, eventhub, cashbingo, bingoblast, careerhub, quiznight3, musicbingo, all DNS-only |

### 2.2 Vercel

- Project `oj-cheersai2-0` (`prj_eJAPkBVjKo0d0zwVfgWEqbfjGTMv`), team
  `peter-pitchers-projects`.
- Production env vars containing the hostname: `NEXT_PUBLIC_SITE_URL` =
  `https://www.cheersai.uk`; `RESEND_FROM` =
  `CheersAI notifications@cheersai.uk (notifications@cheersai.uk)`.
- Confirmed **not** set in production: `UPSTASH_QSTASH_*`, `UPSTASH_REDIS_*`,
  `AXIOM_*`, `BANNER_RENDER_URL`, `INTERNAL_RENDER_URL`,
  `MANAGEMENT_ARTWORK_ORIGINS`. Monitoring options in section 9 are constrained
  accordingly.

### 2.3 Supabase (`nbkjciurhvkfpcpatbnt`)

- **Edge Function secret `NEXT_PUBLIC_SITE_URL` = `https://www.cheersai.uk`.**
  Proved by SHA-256 matching the hash from `supabase secrets list`. This copy is
  invisible in the Vercel dashboard and `vercel env` cannot update it.
- It is on the live publish path. `publish_jobs` has no `platform` column, so
  `src/app/api/cron/publish-scheduler/route.ts:29` always takes the legacy branch
  and invokes the `publish-queue` edge function, which builds
  `${NEXT_PUBLIC_SITE_URL}/api/internal/render-banner`
  (`supabase/functions/publish-queue/worker.ts:445-451`). Miss this and event
  banners fail with `BANNER_RENDER_FAILED` once the old host stops resolving.
- Edge functions: `publish-queue` (v32, `verify_jwt: true`), `media-derivatives`
  (v4, **live `verify_jwt: false`** but `true` in `supabase/config.toml`). A bare
  `supabase functions deploy` would push the config value and break
  `ops:regenerate-story-derivatives`. Deploy by name only.
- Auth settings (`GET /auth/v1/settings`): `email: true`, `disable_signup: false`,
  `mailer_autoconfirm: true`.
- **Custom SMTP configuration could not be read.** The Supabase CLI 2.108 exposes
  only `config push`, no read, and the MCP has no auth-config tool. It must be
  read in the dashboard. See §4.2.
- Auth users: one, `peter@orangejelly.co.uk`, password set, last sign-in
  2026-07-06, with a session actively refreshing today.

### 2.4 Stored data: no migration needed

A scan of every URL-bearing and JSON column across 20 tables returned exactly one
hit, `accounts.email` on a dead seed row
(`00000000-0000-0000-0000-000000000001`, `owner+legacy@cheersai.uk`). No published
copy, ad destination or link-in-bio tile contains the old domain. The public
link-in-bio URL is composed from the slug at render time and never persisted.

Per F-18, this must be **re-run immediately before cutover**, not trusted from
discovery. Query in section 10.

### 2.5 Meta

App **CheersAI `1001401138674450`**, read via the Graph API with an app token:

```
link:                 https://www.cheersai.uk/
privacy_policy_url:   https://www.cheersai.uk/privacy
terms_of_service_url: https://www.cheersai.uk/terms
app_domains:          ["cheersai.orangejelly.co.uk"]
subscriptions:        []   (no webhooks)
```

Three points:

1. Policy and terms URLs point at the dying domain. Meta requires a reachable
   privacy policy; a dead one risks app restriction, which stops all publishing.
2. `app_domains` names `cheersai.orangejelly.co.uk`, a hostname that has never
   been used, and does not include `cheersai.uk`. Do not read this as evidence the
   move is already done.
3. **App `1138649858083556` serves no runtime path.** `INSTAGRAM_APP_ID` and
   `INSTAGRAM_APP_SECRET` appear only at `src/env.ts:58-59` and are referenced
   nowhere else. Facebook, Instagram and Facebook Ads OAuth all use
   `NEXT_PUBLIC_FACEBOOK_APP_ID` + `FACEBOOK_APP_SECRET`
   (`src/lib/connections/oauth.ts:24,40,52,71`,
   `src/lib/connections/token-exchange.ts:5,51`). **v1's instruction to add
   callbacks to the second app was wrong and is withdrawn.**

Existing tokens are unaffected: changing a redirect URI does not invalidate issued
tokens. `social_connections` holds an `active` Facebook connection and an
`expiring` Instagram connection (a known dead label, not a fault). Publishing
continues through the cutover.

### 2.6 Cross-repo callers (`OJ-The-Anchor.pub`)

| File | Line | Header used | Survives a redirect? | Impact if wrong |
|---|---|---|---|---|
| `lib/booking-conversion-forwarding.ts` | 46 | `Authorization: Bearer` | **No, stripped at every status** | Meta CAPI booking conversions stop |
| `lib/world-cup-2026.ts` | 59 | `x-api-key` | Yes | Public SEO page silently renders an empty fixture list |

`CHEERSAI_BOOKING_CONVERSIONS_URL` is **not set in the-anchor.pub production**, so
the hardcoded fallback is what runs. `CHEERSAI_FEED_URL` has no env override at
all. Both are server-side, so no CORS dimension.

The repo has **no `ci:verify` script**; the test runner is **jest**. Its
environment contract is documented in `docs/architecture/env-vars.md`,
`overview.md` and `relationships.md`.

`OJ-AnchorManagementTools` has no reference to the hostname.

### 2.7 Search and indexing

`src/lib/security/headers.ts:45` sets `X-Robots-Tag: noindex, nofollow` and
`src/app/robots.ts` disallows everything, so **organic-search risk is expected to
be low**. That is not the same as no risk: `noindex` does not prove nothing is
indexed, linked, cached or bookmarked, and the Instagram bio is a known external
entry point. Path-preserving redirects are required regardless of SEO value.

---

## 3. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Hostname `cheers.orangejelly.co.uk`, bare, no `www`. | Owner-confirmed; matches the nine sibling subdomains. |
| D2 | Cloudflare record stays **DNS-only (grey cloud)**. | Matches every working sibling and avoids a second proxy and TLS layer. Already in place, see §2.1. |
| D3 | Keep `cheersai.uk` redirecting to the new host for as long as it is registered, **and only after all direct callers are repointed**. | Safety net for browsers and the Instagram bio. Cannot bridge the booking ingest, see §0.2. |
| D4 | **Send email from the existing verified `auth.orangejelly.co.uk`, not from a new domain.** `RESEND_FROM = "CheersAI <noreply@auth.orangejelly.co.uk>"`. | **Changed from v1.** This is the established workspace standard (CareerHub, OrangeJelly.co.uk, ASE, AnchorManagementTools all use it). It is already verified for sending, so it removes a DNS-and-verification phase from a five-day window. See §4.4. |
| D5 | Address form is RFC 5322 `Name <addr>`. | The current value uses parentheses, which is not a valid address. |
| D6 | Delete the apex-redirect logic in `middleware.ts`. | Dead code, see §4.5. |
| D7 | No database migration or backfill. | §2.4, re-verified at preflight. |
| D8 | The Anchor gets **one** required `CHEERSAI_BASE_URL` and a shared helper that derives both endpoints. No hardcoded production fallback. | Resolves F-11 and O-01. Silent fallbacks are what made this dependency easy to miss. |
| D9 | Both hostnames accepted by Meta during the overlap; Supabase gets **exact** callback URLs, not a glob. | Rollback without a console round-trip, without widening the Auth redirect surface (F-10). |
| D10 | **Repoint direct callers before creating any old-host redirect.** | Measured, see §0.2 and §4.1. |
| D11 | No destructive Meta reconnect test against the live connection. | F-06. Alternative in §7. |

---

## 4. Defects found, and what this change does about them

### 4.1 A redirect cannot carry the booking-conversion call (severity: high, would have been introduced by v1)

v1 ordered the redirect (step 13) before repointing The Anchor (step 14). Measured
behaviour of Node `fetch` on a cross-origin redirect is in §0.2: `Authorization` is
stripped at 301, 302, 307 and 308 alike. Between those two v1 steps, every booking
conversion would have returned 401 and been lost, silently, because
`forwardBookingConversionToCheersAI` swallows the result into a
`{accepted: false}` union that nothing alerts on.

Fixed by D10 and the ordering in section 6.

### 4.2 Supabase Auth email has never worked, and there is no password reset (severity: medium, pre-existing)

Two separate things, both real, neither a cutover blocker:

**It has never been used.** `auth.users` has `confirmation_sent_at`,
`recovery_sent_at` and `email_change_sent_at` all null. `auth.audit_log_entries`
has 73 `login`, 3 `user_signedup`, 5 `logout`, and **zero** magic-link or recovery
entries. The sole user has a password. Whether Supabase custom SMTP is configured
could not be read (§2.3) and does not currently matter, because nothing sends.

**The recovery path does not exist.** `src/app/auth/forgot-password/page.tsx` is a
`permanentRedirect` to `/login#magic-link`, and `resetPasswordForEmail` appears
nowhere in the codebase. There is also an admin invite flow at
`src/app/(app)/admin/actions.ts:248` using `inviteUserByEmail(... redirectTo:
${siteUrl}/auth/confirm)`, which has never been exercised.

**The combined consequence, which neither v1 nor the review identified:** the
cutover signs the user out, because auth cookies are host-scoped. The only working
way back in is the password. If the password is not known, the only fallback is
magic link, which has never delivered an email in production. This is a lockout
risk with no tested recovery.

**Mitigation, mandatory, before Gate 3:** confirm password login works on the new
host **while the existing session is still valid** (V5a). Do not proceed
otherwise.

The correct auth-email inventory, replacing v1's wrong one, is: password login
(works), magic link via `/login#magic-link` and `/api/auth/magic-link` (never
tested), admin invite and acceptance (never tested). There is no password-reset
journey to test.

### 4.3 Transactional email from the app is broken (severity: high, pre-existing)

`RESEND_FROM` is `CheersAI notifications@cheersai.uk (notifications@cheersai.uk)`.
The Resend account contains **no `cheersai.uk` domain**, and `cheersai.uk` has no
SPF or DKIM records, so it could not be verified. Two independent faults: an
unverified sending domain, and a non-RFC address form.
`src/lib/email/resend.ts:31-35` turns the rejection into a thrown error.

Affected: `/api/cron/notify-failures` (hourly),
`/api/cron/notify-expiring-connections` (daily 08:00), `/api/cron/token-health`,
`/api/webhooks/qstash-publish/failure`. **Publish-failure alerts and token-expiry
warnings have never arrived.**

Method caveat: verified with the key in `.env.local`, which SHA-256 matches the key
in the 2026-05-23 `vercel env pull`. Re-confirm at preflight in case of rotation.

Fixed by D4 and D5.

### 4.4 Email channel matrix (resolves F-19)

Four distinct channels, previously conflated:

| Channel | Sender | Recipient | Provider | Secret store | Replies | State after this change |
|---|---|---|---|---|---|---|
| App notifications (cron alerts, publish failures) | `CheersAI <noreply@auth.orangejelly.co.uk>` | `accounts.email` / user email | Resend | Vercel `RESEND_FROM` + `RESEND_API_KEY` | **None. The `Receiving MX` record on `auth.orangejelly.co.uk` is `failed` in Resend, so `noreply@` genuinely receives nothing.** | **Fixed** |
| Supabase Auth (magic link, invite) | Unknown, unread | User email | Supabase mailer or custom SMTP | Supabase dashboard | n/a | **Unchanged, still untested.** Q2. |
| Edge worker alerts | n/a | `ALERT_EMAIL` fallback `notifications@cheersai.uk` | Resend | Supabase function secrets | n/a | Default updated. **Still cannot send: the worker has no `RESEND_API_KEY` secret.** |
| Owner operational alerts | n/a | Must be a real monitored mailbox | n/a | n/a | n/a | Set `ALERT_EMAIL` to `peter@orangejelly.co.uk`. |

Resend record status for `auth.orangejelly.co.uk`, checked live: DKIM TXT
`resend._domainkey.auth` **verified**; SPF MX `send.auth` **verified**; SPF TXT
`send.auth` **verified**; Tracking CNAME `links.auth` **verified**; Receiving MX
`auth` **failed**. The domain reports `partially_failed` **only because of the
inbound receiving record**. Sending is fully verified, which is why every other
project in the workspace sends from it successfully. No DNS work is required for
D4.

### 4.5 `middleware.ts` is dead code twice over (severity: low, pre-existing)

Established during implementation, and stronger than v2 first stated:

1. **Next never loads it.** `.next/server/middleware-manifest.json` contains
   `"middleware": {}` and `"sortedMiddleware": []` on Next 16.2.6. The file has no
   effect at all.
2. **Its stated behaviour is wrong anyway.** It redirects with a **308**;
   production returns **307** with `content-type: text/plain` and no Next.js
   headers, which is Vercel's domain-level redirect answering first.

`src/app/proxy.ts` is in the same position: `src/app/` is not a location Next
loads a proxy from, so the auth guard it exports does not run at the edge either.
**Auth is enforced in layouts**, which is what actually protects the app: an
unauthenticated request to `/planner` is answered 307 to `/auth/login` by
`src/app/(app)/layout.tsx` calling `getCurrentUser()`. Verified live against
`cheers.orangejelly.co.uk` for `/planner`, `/settings` and `/connections`.

`docs/architecture/routes.md:117-123` documented the file, the 308, and a path
(`src/middleware.ts`) that does not exist. All three are corrected.

### 4.6 Recorded, not fixed here

- `src/env.ts:149` regex `/localhost|127\\.0\\.0\\.1/`. In a regex literal `\\.`
  matches a backslash then any character, so the `127.0.0.1` arm never matches.
  The `localhost` arm still works.
- `disable_signup: false` allows open self-signup on a single-tenant app.
- The dead `owner+legacy@cheersai.uk` seed row.
- Vestigial `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `GOOGLE_MY_BUSINESS_*`
  (no GBP route or connection exists), `INSTAGRAM_VERIFY_TOKEN` (no webhook route).

---

## 5. Change inventory

### 5.1 Code: `OJ-CheersAI2.0`

| File | Line | Change |
|---|---|---|
| `middleware.ts` | 1-25 | Remove the apex redirect (D6). If nothing remains, delete the file and its `config` export. |
| `.env.example` | 14 | `RESEND_FROM="CheersAI <noreply@auth.orangejelly.co.uk>"` |
| `.env.example` | 27 | `NEXT_PUBLIC_SITE_URL="http://localhost:3000"`. **Corrects F-21**: the current `https://` value does not match `npm run dev` (plain HTTP) or `src/env.ts`'s own `http://localhost:3000` default, and produces unusable local callback URLs. |
| `src/features/settings/link-in-bio/link-in-bio-profile-form.tsx` | 166 | Derive the help text from `env.client.NEXT_PUBLIC_SITE_URL` instead of the hardcoded `https://www.cheersai.uk/l/<slug>`. Client component; `NEXT_PUBLIC_*` is inlined at build. |
| `supabase/functions/publish-queue/worker.ts` | 461 | Fallback `alertEmail` becomes `peter@orangejelly.co.uk` (a real mailbox), not a `notifications@` address that receives nothing. See §4.4. |
| `tests/api/booking-conversions-route.test.ts` | 69 | Request URL string, cosmetic. |
| `tests/api/retry-capi-conversions-route.test.ts` | 92 | Request URL string, cosmetic. |
| `docs/architecture/routes.md` | 121 | Correct both the hostname and the 308/307 claim (§4.5). |
| `docs/link-in-bio-scope.md` | 29 | Hostname. |
| `docs/link-in-bio-implementation-plan.md` | 4, 12, 75 | Hostname. |

Dated audit artefacts under `docs/redesign-plan/`, `docs/superpowers/`,
`docs/publishing-consultant-report.md`, `tasks/codex-qa-review/` and
`tasks/fix-function/` are **left unchanged**. Rewriting a historic audit trail is
worse than a stale hostname inside it.

### 5.2 Code: `OJ-The-Anchor.pub`

Implements D8: one required base URL, one shared helper, no production fallback.

| File | Change |
|---|---|
| `lib/cheersai.ts` (new) | `getCheersAiBaseUrl()` reads `CHEERSAI_BASE_URL`, **throws in production if unset**, strips trailing slashes, and exposes `bookingConversionsUrl()` and `tournamentFeedUrl(tournamentId)`. |
| `lib/booking-conversion-forwarding.ts:45-46` | Use the helper. Remove the hardcoded fallback. |
| `lib/world-cup-2026.ts:59` | Use the helper. Keep the tournament UUID `f40ef35f-5a1c-4409-8d02-27f2f97d0a0e` in code. |
| `lib/cheersai.test.ts` (new) | Unit tests: trailing-slash normalisation, both derived URLs, production throw when unset, non-production fallback. **Covers F-12's missing test.** |
| `.env.example:28`, `.env.local.example:9` | Replace both `CHEERSAI_*_URL` entries with `CHEERSAI_BASE_URL=https://cheers.orangejelly.co.uk`. |
| `docs/architecture/env-vars.md`, `overview.md`, `relationships.md` | Document the new variable and remove the old ones. **Added per F-12.** |

**Correction to v2:** four existing suites *do* need changing. They set the old
`CHEERSAI_BOOKING_CONVERSIONS_URL` in their setup, so renaming the variable would
leave them exercising the fallback rather than the value they think they set. The
asserted URL is unchanged, because `CHEERSAI_BASE_URL=https://cheers.example.com`
derives the same endpoint. Affected:
`app/api/table-bookings/__tests__/route.test.ts`,
`app/api/table-bookings/paypal/capture-order/__tests__/route.test.ts`,
`app/api/tracking/booking-conversion/route.test.ts`,
`tests/api/event-bookings-policy-fallback.test.ts`.

### 5.3 Environment variables (resolves F-20)

| Store | Environment | Variable | Value |
|---|---|---|---|
| Vercel `oj-cheersai2-0` | Production | `NEXT_PUBLIC_SITE_URL` | `https://cheers.orangejelly.co.uk` |
| Vercel `oj-cheersai2-0` | Preview | `NEXT_PUBLIC_SITE_URL` | Leave unset so Vercel's own preview URL is used. Do **not** set the production origin, or preview OAuth returns to production. |
| Vercel `oj-cheersai2-0` | Development | `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` |
| Vercel `oj-cheersai2-0` | Production | `RESEND_FROM` | `CheersAI <noreply@auth.orangejelly.co.uk>` |
| Vercel `oj-cheersai2-0` | Preview, Development | `RESEND_FROM` | **Unset.** `src/lib/email/resend.ts:21-27` then skips sending with a warning, which is the desired guard against preview jobs emailing real users. |
| **Supabase `nbkjciurhvkfpcpatbnt`** | function secrets | `NEXT_PUBLIC_SITE_URL` | `https://cheers.orangejelly.co.uk` |
| **Supabase `nbkjciurhvkfpcpatbnt`** | function secrets | `ALERT_EMAIL` | `peter@orangejelly.co.uk` |
| Vercel `oj-the-anchor-pub` | Production | `CHEERSAI_BASE_URL` | `https://cheers.orangejelly.co.uk` |
| Vercel `oj-the-anchor-pub` | Production | `CHEERSAI_BOOKING_CONVERSIONS_URL` | Remove if present (it is not). |

`NEXT_PUBLIC_SITE_URL` is inlined into the client bundle at build.
**Changing it requires a redeploy, not just an env edit.**

Supabase function secrets are injected at invocation, so `supabase secrets set`
takes effect without a redeploy. If a redeploy is done anyway, deploy **by name**
(`supabase functions deploy publish-queue`); a bare deploy-all pushes
`config.toml`'s `verify_jwt: true` onto `media-derivatives` (live value `false`)
and breaks `npm run ops:regenerate-story-derivatives`.

### 5.4 Third-party console changes

| System | Change | Rollback |
|---|---|---|
| **Cloudflare** (`orangejelly.co.uk`) | Already done (§2.1). Confirm `cheers` is CNAME, **DNS-only**. | Delete the record; the wildcard resumes. |
| **Vercel** `oj-cheersai2-0` | Confirm `cheers.orangejelly.co.uk` is attached and certified; make it the production domain. | Restore `www.cheersai.uk` as production domain. |
| **Vercel** `oj-cheersai2-0` | **Last step only.** Convert `www.cheersai.uk` and the `cheersai.uk` apex to redirects: **307 temporary**, path and query preserved. Not 301/308 during the rollback window, because a cached permanent redirect defeats rollback (F-13). | Remove the redirect and re-attach as domains. |
| **Meta app `1001401138674450`** | Add OAuth redirect URIs `https://cheers.orangejelly.co.uk/api/oauth/{facebook,instagram,facebook-ads}/callback`. Keep the three `www.cheersai.uk` equivalents until the soak passes. | Remove the new three. |
| **Meta app `1001401138674450`** | Set `app_domains` to `cheers.orangejelly.co.uk` (removing `cheersai.orangejelly.co.uk`); set Site URL, Privacy Policy URL (`/privacy`) and Terms of Service URL (`/terms`) to the new host. | Restore previous values, recorded at preflight. |
| **Meta app `1138649858083556`** | **No change. Withdrawn from v1.** It serves no runtime path (§2.5). Inspect once to confirm it has no active tokens or webhooks, then mark out of scope. | n/a |
| **Supabase Auth, URL Configuration** | Site URL becomes `https://cheers.orangejelly.co.uk`. Redirect allowlist gains the **exact** URLs `https://cheers.orangejelly.co.uk/auth/callback` and `https://cheers.orangejelly.co.uk/auth/confirm`, not a `/**` glob (F-10, and `/api/auth/magic-link` accepts a caller-supplied `redirectTo` so the allowlist is a real boundary). Keep the old entries until the soak passes. | Restore the previous Site URL and remove the new entries. |
| **Resend** | **No change.** `auth.orangejelly.co.uk` is already verified for sending (§4.4). | n/a |
| **Instagram bio @theanchor.pub** | Change to `https://cheers.orangejelly.co.uk/l/the-anchor`. Owner action. | Revert the bio. |

---

## 6. Cutover plan

Owner for every step is the product owner unless a third-party developer is
engaged; where a step needs a console role, it is named. Each gate is an explicit
go/no-go.

**Phase 0: preflight (section 10). Do not skip.**

Establish who made the §2.1 change, export current DNS, Vercel domain and env
state, screenshot the Meta and Supabase console values, re-run the data scan, and
confirm no scheduled posts fall inside the change window. Freeze all console
changes from here.

**Gate 0: preflight clean, change window agreed, owner available.**

**Phase A: new host live.** Already complete (§2.1). Verify only:
`cheers.orangejelly.co.uk` serves the app on `/login`, `/l/the-anchor`,
`/privacy`, `/terms`; DNS-only confirmed by the absence of `cf-ray`.

**Phase B: widen the allowlists.** No user-visible change.

1. Meta: add the three new OAuth redirect URIs, keeping the old three.
2. Supabase Auth: add the two exact redirect URLs, keeping the old entries. Leave
   Site URL alone for now.

**Gate 1: both consoles show old and new entries side by side, screenshotted.**

**Phase C: repoint the direct callers. This comes before any redirect (D10).**

3. Merge the `OJ-The-Anchor.pub` PR (§5.2).
4. Set `CHEERSAI_BASE_URL` on `oj-the-anchor-pub` production and redeploy.
5. Verify V11 and V12: both integrations reach the new host **directly**, with no
   `30x` anywhere in the request chain.

**Gate 2: no server integration depends on `cheersai.uk`.**

**Phase D: flip the app.**

6. Announce a no-reconnect window. Wait **at least 10 minutes** after the last
   possible OAuth initiation on the old build before step 8, because an OAuth state
   lives 10 minutes and a flow started on the old build would exchange its code
   against the new redirect URI and fail (F-07).
7. **V5a: confirm password login works on the new host while the current session
   is still valid.** Section 4.2. If this fails, stop; there is no tested recovery.
8. Merge the `OJ-CheersAI2.0` PR (§5.1).
9. Vercel: set `NEXT_PUBLIC_SITE_URL` and `RESEND_FROM` per §5.3.
10. Redeploy production. Required: `NEXT_PUBLIC_SITE_URL` is build-time inlined.
11. `supabase secrets set NEXT_PUBLIC_SITE_URL=https://cheers.orangejelly.co.uk ALERT_EMAIL=peter@orangejelly.co.uk --project-ref nbkjciurhvkfpcpatbnt`
12. Supabase Auth: change Site URL to the new host.
13. Meta: update `app_domains`, Site URL, privacy and terms URLs.
14. Vercel: make `cheers.orangejelly.co.uk` the production domain.

**Gate 3: full verification pass (section 7) green.**

**Phase E: redirect the old host, last.**

15. Vercel: convert `www.cheersai.uk` and the `cheersai.uk` apex to **307**
    redirects preserving path and query.
16. Verify V3a to V3d.
17. Change the Instagram bio.

**Phase F: soak and clean up.**

18. Observe per section 9: 48 hours intensive, review again at 7 days.
19. Only then: remove the old Meta redirect URIs and the old Supabase entries.
20. Depending on Q1: either keep `cheersai.uk` renewed as a redirect-only asset, or
    let it lapse, having accepted F-03 in writing.

---

## 7. Verification

Split by subsystem per F-15. Every check has a method and a single requirement.

### Safety rules for the live-effect checks

- **Do not disconnect the live Facebook or Instagram connection** (F-06). V9 and
  V10 test the authorisation redirect only.
- Test posts go to a named target agreed in advance, are marked
  `[TEST <date>]` in the body, and are deleted by the owner within one hour.
- Test bookings use a recognisable name, are cancelled immediately, and are
  excluded from Meta reporting by noting the `booking_id` for later filtering.

### Checks

| # | Subsystem | Check | Method | Pass |
|---|---|---|---|---|
| V1 | Host | New host serves the app | `GET https://cheers.orangejelly.co.uk/login` | 200, `server: Vercel`, no `cf-ray` |
| V2 | Host | Link-in-bio renders | `GET .../l/the-anchor` | 200 **and tiles present in the HTML**, not just a 200 |
| V3a | Redirect | `www` old host, root | `GET https://www.cheersai.uk/` | 307, `Location` on the new host |
| V3b | Redirect | Path preserved | `GET https://www.cheersai.uk/l/the-anchor` | 307 to `.../l/the-anchor` exactly |
| V3c | Redirect | Query preserved | `GET https://www.cheersai.uk/l/the-anchor?x=1` | 307 to `.../l/the-anchor?x=1` |
| V3d | Redirect | Apex and plain HTTP | `GET http://cheersai.uk/l/the-anchor` | Reaches the new host with the path intact |
| V4 | Build | Client bundle carries the new host | Sign in, open `/settings`, read the slug help text in the rendered DOM (not view-source, which is unreliable for a client component) | Shows the new host |
| V5a | Auth | **Password login works on the new host, run before the flip** | Sign in with the password in a private window | Session established |
| V5b | Auth | Old session is invalidated as expected | Load the new host in the pre-existing session | Signed out, cookies being host-scoped |
| V6a | Email | App notification email sends | Trigger `/api/cron/notify-failures` with the cron secret against a known-failed job, or send a one-off through the same helper | Delivered from `CheersAI <noreply@auth.orangejelly.co.uk>`, no Resend error in the function log |
| V6b | Email | Supabase Auth email | **Out of scope unless Q2 says otherwise.** If in scope: request a magic link and record which sender actually arrives | Documented, not assumed |
| V7 | Publishing | Existing tokens still publish | Schedule a marked test post to the agreed Facebook target | Published without reconnection |
| V8 | Publishing | Banner render callback works | Publish a marked event post with a date overlay | Banner present. This is the only check that exercises the Supabase edge secret from step 11 |
| V9 | OAuth | Facebook authorisation round-trip | Start the connect flow and complete Meta's dialog **without disconnecting first**; confirm the callback returns to the new host with a valid state | Returns to `cheers.orangejelly.co.uk/connections` without `ads_error=` |
| V10 | OAuth | Instagram authorisation round-trip | As V9 | Same |
| V11 | Integration | Booking ingest, no redirect | Place a marked test booking on the-anchor.pub, then inspect the outbound request URL in the deploy log | Row in `booking_conversion_events` with `capi_status` set, **and the request went straight to the new host with no `30x`** |
| V12 | Integration | World Cup feed | `GET https://www.the-anchor.pub/live-sport/world-cup` | Fixtures render and the list is **not empty**. A 200 alone is not a pass: the page catches feed errors and renders empty |
| V13 | Cron | All URL-producing scheduled routes | Review Vercel logs for `publish-scheduler`, `notify-failures`, `notify-expiring-connections`, `retry-capi-conversions`, `sync-meta-campaigns` | All 200, and any link in their output uses the new host |
| V14 | Meta | App health | Meta App Dashboard | No policy or app-domain warnings; privacy and terms URLs resolve 200 |
| V15 | CI | CheersAI | `npm run ci:verify` | Lint, typecheck, test, build pass |
| V16 | CI | The Anchor | `npm run lint && CI=1 npx jest && npm run build`. **There is no `ci:verify` in that repo** (F-12) | All pass, including the new `lib/cheersai.test.ts` |
| V17 | Non-functional | Smoke baseline | Compare response time and security headers old host vs new; confirm the changed slug help text is associated with its input | No regression, label correctly associated |

---

## 8. Rollback

Corrected per F-14. v1 wrongly claimed Phases A and B needed no rollback and that
Phase E was irreversible.

| Phase | Rollback | Reversible? |
|---|---|---|
| A | Delete the Cloudflare `cheers` record and detach the Vercel domain. The wildcard resumes. | Yes |
| B | Remove the new Meta redirect URIs and the new Supabase redirect URLs. | Yes |
| C | Revert the-anchor.pub deploy and unset `CHEERSAI_BASE_URL`. Note the helper throws in production when unset, so the revert must be a deploy revert, not just an env deletion. | Yes |
| D | Restore both Vercel env vars, redeploy, `supabase secrets set NEXT_PUBLIC_SITE_URL=https://www.cheersai.uk`, restore the Supabase Site URL, restore the Meta values from the preflight screenshots, re-attach `www.cheersai.uk` as production domain. Roughly one redeploy, about 3 minutes. | Yes, **only while `cheersai.uk` resolves** |
| E | Remove the redirects and re-attach the old hostnames as domains. A **307** was chosen precisely so no client caches it permanently. | Yes |
| F | Re-add the removed Meta and Supabase entries. | Yes |

**The genuine points of no return**, which are not ordinary allowlist cleanup:

1. `cheersai.uk` ceasing to resolve (expected about 30 days after
   2026-09-07 under Nominet's expiry process) or being re-registered by a third
   party (possible after the full lifecycle, roughly December 2026).
2. A permanent redirect cached in a client, which is why step 15 specifies 307.

No data rollback exists because there is no data change (D7).

---

## 9. Monitoring and soak

Constrained by reality: Axiom and Upstash are **not configured in production**
(§2.2), so monitoring is Vercel logs, Supabase logs, the Resend dashboard, the
Meta App Dashboard, and manual checks.

**First 48 hours, checked at +1h, +6h, +24h, +48h:**

| Signal | Where | What bad looks like |
|---|---|---|
| New host uptime and TLS | Manual `GET /login` | Non-200, cert warning |
| Old host redirects | Manual `GET` on `www` and apex | Not 307, or path lost |
| Publish jobs | `publish_jobs` where `status` is failed and `updated_at` is recent | Any new failure, especially `BANNER_RENDER_FAILED` |
| Banner rendering | Vercel logs for `/api/internal/render-banner` | Non-200 |
| Email delivery | Resend dashboard | Bounces, or zero sends when a cron should have alerted |
| Booking ingest | `booking_conversion_events` recent rows, and `capi_status` | No new rows after a real booking, or `capi_error` set |
| Feed freshness | `/live-sport/world-cup` | Empty fixture list |
| Auth | Supabase Auth logs | Failed logins, redirect rejections |
| Meta app | App Dashboard | Any restriction or policy warning |

**At 7 days:** repeat the table, then run Phase F step 19.

Do not remove the old Meta and Supabase entries before the 7-day review, and do
not leave them in place past the point where `cheersai.uk` could be re-registered.

---

## 10. Reproducible preflight (resolves F-18, O-02)

Run immediately before Gate 0 and again after Gate 3. Read-only. Never prints a
secret value.

**Public DNS and HTTP**

```bash
for h in cheers.orangejelly.co.uk www.cheersai.uk cheersai.uk zz-control-4f21.orangejelly.co.uk; do echo "--- $h"; dig +short @1.1.1.1 "$h" CNAME; dig +short @1.1.1.1 "$h" A; done
```

**Domain expiry**

```bash
curl -sH 'accept: application/rdap+json' https://rdap.nominet.uk/uk/domain/cheersai.uk | python3 -m json.tool | grep -A2 eventAction
```

**Repository sweep, both repos**

```bash
grep -rIn "cheersai\.uk" . --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git
```

**Environment inventory, no values**

```bash
vercel env ls production
supabase secrets list --project-ref nbkjciurhvkfpcpatbnt
```

**Data re-scan.** Re-run the 20-table URL and JSON scan from §2.4. Expected result:
one row, `accounts.email`, count 1. Any other row is a stop condition. Scope note:
the scan covers every column of type `text`, `varchar`, `json`, `jsonb` and array
in the `public` schema that can hold a URL, enumerated from
`information_schema.columns`, not a hand-picked subset.

**Pending OAuth states.** Confirm none are in flight before Gate 3:

```sql
SELECT count(*) FROM oauth_states WHERE created_at > now() - interval '10 minutes';
```

**Console evidence.** Screenshot, before changing anything: Meta Basic Settings
and OAuth redirect URIs; Supabase Auth URL Configuration; Vercel domain list and
env list; Cloudflare DNS for the `cheers` record. These are the rollback source of
truth for section 8.

---

## 11. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Old domain expires mid-migration | **High if Q1 is "do not renew"** | Critical: rollback route gone, historic links dead | Q1. Renewing removes this risk entirely |
| R2 | Booking conversions lost by redirecting before repointing | Was near-certain in v1 | High, and silent | D10, Gate 2, V11 checks for absence of `30x` |
| R3 | Supabase edge secret missed, banners fail | Medium: invisible in Vercel | High | Step 11 explicit, V8 tests it end to end |
| R4 | Owner cannot log in after cutover: no password, no tested reset | Low but unbounded | Critical: total lockout | V5a before the flip, §4.2 |
| R5 | Meta restricts the app for a dead privacy policy URL | Low now, **high after expiry** | Critical: all publishing stops | Step 13, well before expiry |
| R6 | Reconnect started near the flip fails on redirect-URI mismatch | Medium | Medium | Gate 3 no-reconnect window, 10-minute wait |
| R7 | Instagram bio not updated | Medium, manual | High for the venue | D3 redirect covers it while registered; step 17 explicit |
| R8 | `app_domains` misread as evidence the move is done | Medium | High | §2.5 point 2 |
| R9 | Production Resend key rotated since the 2026-05-23 snapshot, invalidating §4.3 | Low | Low: the fix is correct regardless | Re-check at preflight |
| R10 | Further undocumented console changes like §2.1 happen mid-flight | Medium, it already happened once | Medium | Phase 0 freeze, preflight re-run after Gate 3 |
| R11 | Domain re-registered by a third party after lapse and used to impersonate CheersAI | Low, but permanent | High reputational | Q1. Otherwise remove all trust entries before suspension and monitor for re-registration |

---

## 12. Out of scope

Everything in §4.6, plus: QStash, Upstash Redis and Axiom (none configured in
production); the `partially_failed` inbound receiving record on
`auth.orangejelly.co.uk` (sending is unaffected, §4.4); and a full performance or
accessibility programme beyond V17.

---

## 13. Assumptions

1. Hostname is `cheers.orangejelly.co.uk`, bare. Owner-confirmed.
2. No printed material carries the old URL. Owner-confirmed.
3. The `orangejelly.co.uk` Cloudflare zone and the Vercel team are under the same
   control. Evidenced by nine existing subdomains on that pattern.
4. One real user, so a forced sign-out is acceptable, **conditional on V5a**.
5. `cheersai.uk` remains registered through Phase F. **This is only true if Q1 is
   answered "renew".** If not, Phases 0 to E must complete before
   2026-09-07 16:31 UTC and section 9's soak cannot run as written.
