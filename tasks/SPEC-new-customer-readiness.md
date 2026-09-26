# SPEC: New customer readiness (assisted paid launch, then self-serve)

Status: v2, 2026-09-24. Revised after `tasks/REVIEW-SPEC-new-customer-readiness.md` (R01 to R19). Discovery only; no code changed.

## 1. Verdict and baseline

CheersAI is **not ready** for new customers. Nobody can sign up or pay, and a venue added by hand would hit blocks on Meta access, Anchor-only ad links and Anchor tournament copy.

Verified 2026-09-24:

- Live database (`nbkjciurhvkfpcpatbnt`): 1 login, 3 brands (The Anchor, Orange Jelly, one archived owner brand), 1 membership, 1 super-admin. No billing tables. `account_members` has no role column; `brand_profile` has no website, menu or booking fields. Storage policies `media_select/insert/update/delete` (account-prefix membership or super-admin) are live.
- Live site: `/` and `/auth/signup` end on the login page; `/signup`, `/register`, `/pricing` are 404; `/privacy` (updated 8 Feb 2025) and `/terms` (18 Feb 2026, includes an Acceptable Use section) load.
- Usage baseline, The Anchor, last six months: 108 to 263 content items per month (publish jobs match one to one), 649 MB stored across 1,169 objects. AI generation requests are not logged anywhere, so there is no AI usage baseline.
- History: the v1 app (2025) had Stripe checkout, a pricing page and tier limits (`lib/stripe/config.ts`, `lib/subscription/limits.ts`, `docs/operations/STRIPE_PRICING_SETUP.md`, last changed `f596f2f5`, 9 Sep 2025). The v2 rebuild removed them deliberately (`docs/cheersai-rebuild-prd.md`). Once this spec is approved, it supersedes the PRD's exclusion of billing and team access.

## 2. Decisions

| ID | Decision | Date |
|---|---|---|
| D1 | Assisted paid launch first (operator invites and onboards, customer pays through Stripe). Self-serve sign-up is Stage 3. | 2026-09-24 |
| D1a | Billing provider is Stripe: hosted Checkout and the hosted customer portal. | 2026-09-24 |
| D1b | Paid ads and tournaments are not offered to new customers at launch. They stay fully working for The Anchor. | 2026-09-24 |
| D1c | Event and promotion import from the management app is hidden for new customers, like paid ads and tournaments. On for The Anchor only. Verified 2026-09-24: only The Anchor has a `management_app_connections` row and every lookup is scoped by `account_id`, so no other brand can pull Anchor events today; the gate removes the visible option and the pre-filled Anchor management address. | 2026-09-24 |
| D1d | Operator alerts go to peter@orangejelly.co.uk. Paid ads, tournaments and management import stay off for the Orange Jelly brand. | 2026-09-24 |
| D2a | Staggered plans rebuilt from the v1 tiers: Starter, Professional and Group, with the amounts, limits and seats in §2.1. Prices exclude VAT. Annual billing at 10% off from launch. | 2026-09-24 |
| D2b | Orange Jelly Limited is VAT-registered; VAT is charged on subscriptions. | 2026-09-24 |
| D2c | The trial requires a card at the start. | 2026-09-24 |
| D2d | Launch with AI usage logged but not capped; caps (§4.6) are set from real usage data later. | 2026-09-25 |
| D2e | Changing plan during the free trial keeps the trial running: nothing is charged until the trial ends (Stripe portal `trial_update_behavior=continue_trial`, test and live). | 2026-09-26 |
| D3 | Lapse and suspension behaviour as proposed in §4.1: a lapsed or suspended brand keeps read access, the billing page (owner) and export, but cannot create, edit, generate or upload, and new publishing is held. On restore, future posts resume; overdue posts wait for the owner to review (§4.2). Past-due grace: 7 days after the paid period ends. | 2026-09-24 |
| D4 | Roles as proposed in §4.5: owners handle billing, inviting and removing people, Facebook and Instagram connections, export and deletion requests; members create, edit and schedule content. Every existing membership becomes owner. | 2026-09-24 |
| D5 | Offboarding is handled by the operator on request (runbook plus admin action), not a customer button. Data is kept for 30 days after offboarding, then deleted. | 2026-09-24 |
| D7 | Meta production access, checked separately for organic posting and ads | pending (Meta App Dashboard) |

### 2.1 Plans

v1 history (`lib/stripe/config.ts`), all monthly, annual at 10% off:

| Version | Free trial | Starter | Starter + Images | Professional | Professional + Images | Enterprise |
|---|---|---|---|---|---|---|
| `1330be0f`, 15 Aug 2025 | 14 days, 10 posts | £29, 100 posts, 10 campaigns | none | £44.99, 500 posts | none | custom |
| `2746c0f0`, 17 Aug 2025 | same | £29.99 | none | £59.99 | none | custom |
| `f596f2f5`, 9 Sep 2025 (last) | same | £29.99 | £54.99 | £59.99 | £84.99 | custom |

The "+ Images" tiers sold AI image creation, which v2 does not have (no image-generation calls in `src/`), so they are not carried forward.

v2 plans (approved 2026-09-24). Amounts exclude VAT. Posts count each Facebook or Instagram placement separately.

| | Starter | Professional | Group |
|---|---|---|---|
| Monthly | £29.99 | £59.99 | custom (contact us) |
| Annual (10% off) | £323.89 | £647.89 | custom |
| Venues | 1 | 1 | several |
| Published posts per month | 120 | 400 | agreed |
| AI generations per month | 150 | 500 | agreed |
| Media storage | 2 GB | 10 GB | agreed |
| Team seats | 2 | 5 | agreed |
| Support | email | priority email and WhatsApp | named contact |

Trial: 14 days on Starter limits, card taken at the start, first charge on day 15 unless cancelled. Upgrades take effect immediately with a prorated charge; downgrades take effect at the next renewal. After a downgrade, existing content and media stay; only new work above the lower limit is blocked. Plan changes go through the Stripe customer portal.

D1b settles the review's R12 (tournament hours source) and most of R13 (artwork origins stay operator-managed) for the launch, and removes ad-budget caps and live-advert lapse handling for new customers. R03 still applies if ads are ever offered to a paying customer.

## 3. Findings (corrected)

Severity: **B** blocks any new customer, **H** high, **M** medium, **L** low. Corrections from the review are applied: T3 (tournament uploads go through the service-role client, so they are not rejected; the path is still non-standard), I2 (storage policies are confirmed live), L1 (rights requests by email already exist; there is no self-serve route), L2 (acceptable-use terms exist).

| # | Sev | Finding | Evidence |
|---|---|---|---|
| A1 | B | No sign-up and no customer brand creation; only a super-admin can create brands and invite. | `src/app/auth/signup/page.tsx:4`, `src/app/(app)/admin/actions.ts:45,247` |
| A2 | H | Magic link can create a login for any email (`shouldCreateUser` not false); that person lands on `/no-access`. Live effect depends on the Supabase dashboard sign-up setting. | `src/lib/auth/actions.ts:43-48`, `src/app/api/auth/magic-link/route.ts:35-40` |
| A3 | H | Invite may not complete: `/auth/confirm` only accepts `token_hash`, which the default invite template does not send. Also the invite is sent before the membership row is written. | `src/app/auth/confirm/route.ts:11-24`, `src/app/(app)/admin/actions.ts:247-297` |
| A4 | H | No password set or reset; magic link only. | `src/app/auth/forgot-password/page.tsx:4` |
| A5 | M | `src/app/proxy.ts` is dormant (wrong folder for Next 16). Moving it would put cron, QStash and OAuth endpoints behind a login redirect. | `src/app/proxy.ts` |
| P1 | B | No billing: no provider, plans, trial or subscription state. | `package.json` |
| P2 | H | No usage caps. AI entry points: `src/app/actions/ai-generate.ts`, `src/lib/campaigns/generate.ts:471`, `src/lib/ai/media-tagging.ts:84`, library auto-tagging. | as listed |
| M1 | B (unverified) | Posting and ads permissions need Meta Advanced Access and Business Verification before a non-tester can connect. No record in the repo. | `src/lib/connections/oauth.ts:4-12,63-68` |
| M2 | H | Data-deletion callback deletes nothing and its status endpoint reports `completed: true` for any code. No deauthorise callback. Ads OAuth writes `meta_ad_accounts`, which the callback also ignores. | `src/app/api/social/delete-data/route.ts`, `src/app/api/oauth/facebook-ads/callback/route.ts:120-130` |
| T1 | B* | Paid ads only accept Anchor hosts. *Not a launch blocker under D1b; must be fixed before ads are offered. | `src/app/(app)/campaigns/actions.ts:172-173`, `[id]/actions.ts:123-124` |
| T2 | H* | Tournament copy, links and overlay are Anchor-specific; hours come only from the Anchor management app. *Hidden for new customers under D1b. | `src/lib/tournament/generate.ts:25,94,138-139,161-162`, `overlay.ts:287`, `screening-service.ts:7-35` |
| T4 | M | Food campaigns default to the Anchor booking URL (feature is flagged off by default). | `src/features/campaigns/CampaignBriefForm.tsx:71,225-226,674` |
| T6 | M | "Anchor management app" settings panel shows for every brand. | `src/features/settings/management-connection-form.tsx:97` |
| T7 | L | Anchor placeholders (pre-filled `the-anchor` link-in-bio slug), Anchor names in prompt examples, dead `OWNER_ACCOUNT_ID`/`OWNER_EMAIL` code. | `link-in-bio-profile-form.tsx:59`, `src/lib/ai/prompts.ts:42-43,387`, `src/lib/constants.ts:1-3` |
| I1 | H | Thumbnail resolution signs media paths via the service-role client with no account filter. Exploitability not proven; treat as a pre-release fix. | `src/lib/media/resolve-thumbnails.ts:89-94` |
| I3 | M | Conversion retry cron takes the oldest 100 rows across all brands. | `src/app/api/cron/retry-capi-conversions/route.ts:49-56` |
| N1 | M | Token-health alerts go to the legacy `auth_user_id` login, not the brand's email; failure and expiry alerts go to `accounts.email`. | `src/app/api/cron/token-health/route.ts:174-182` |
| O1 | H | No onboarding or first-run guidance. | `src/app/page.tsx:4` |
| O2 | L | Timezone dropdown offers only Europe/London. | `src/features/settings/posting-defaults-form.tsx:27` |
| O3 | M | No customer-run team management; membership has no roles. | `supabase/migrations/20260714120000_multibrand_foundation.sql:32` |
| L1 | M | No self-serve export or deletion (email requests are offered in the privacy policy); no stated retention periods. | `src/app/(public)/privacy/page.tsx:105-117` |
| L2 | H | Terms lack pricing, renewal, cancellation and refund terms, and there is no data processing agreement. | `src/app/terms/page.tsx` |
| L4 | M | Operator gets no alert for a customer's repeated publish failures; Axiom is silent if unconfigured. | `src/lib/logging/axiom.ts:13` |
| L6 | M | CI e2e is smoke only, skips without credentials, and runs against placeholder Supabase settings. | `.github/workflows/ci.yml` |

## 4. Lifecycle contracts (required before the affected build)

### 4.1 Entitlement is separate from identity and membership (R01)

- `getCurrentUser()` keeps resolving identity and memberships exactly as today. Entitlement is a separate per-brand check, `getBrandEntitlement(accountId)`, that returns one state.
- States and precedence (highest first): `archived` > `suspended` (operator) > `comped` (operator) > Stripe-derived `active` | `trialing` | `past_due_grace` | `lapsed` | `incomplete`.
- Proposed matrix (D3):

| Capability | active, trialing, comped | past_due_grace | lapsed, incomplete | suspended |
|---|---|---|---|---|
| Read planner, library, history | yes | yes | yes | yes |
| Create, edit, AI generate, upload | yes | yes | no | no |
| New publishing (dispatch) | yes | yes | held | held |
| Billing portal (owner only) | yes | yes | yes | yes |
| Export data (owner) | yes | yes | yes | yes |
| Switch to other brands | yes | yes | yes | yes |

- A lapsed brand stays in the user's brand list with a clear banner; the user is never silently moved to another brand. Every server action re-checks entitlement for the brand in its payload, so a stale form cannot write to a brand that has since lapsed.
- A dependency failure while checking entitlement shows an error, not a logout.

### 4.2 Publishing hold and release (R02)

- Entitlement is checked at dispatch in `publish-scheduler` and again in the QStash handler and the legacy `publish-queue` path immediately before the provider call.
- A blocked job moves to a visible held state with reason `entitlement` and keeps its original schedule.
- On restore: future jobs resume; jobs whose time has passed stay held and appear in a "needs review" list for the owner to reschedule or discard. Nothing overdue publishes automatically.
- A provider call already in flight is not cancelled; the spec promises only no *new* provider sends.
- The Anchor and Orange Jelly are `comped`, so their jobs never hit this path.

### 4.3 Stripe contract (R04)

- Tables: `billing_customers` (`account_id` unique, `stripe_customer_id` unique) and `subscriptions` (Stripe-owned fields only). Operator states (`comped`, `suspended`) live in a separate app-owned table or column, so "the webhook is the only writer" holds for Stripe fields.
- Checkout session is created server-side for the authenticated brand, with a server-selected price and an idempotency key per attempt; `client_reference_id` and metadata carry the `account_id`. Browser-supplied ids and amounts are never trusted.
- Webhook: verify the signature, record the event id durably (`stripe_events`, unique), return 2xx only after the event is stored, then reconcile by fetching the latest subscription from Stripe rather than trusting event order.
- Return from Checkout shows "confirming payment" until the webhook lands, with a manual "check again" that runs the same reconcile.
- Operator repair: an admin action that reconciles one brand from Stripe using the same code path.
- Pin the Stripe API version; separate test and live keys and price ids in `src/env.ts`.
- Plans live in one server-side config (plan id, Stripe price ids monthly and annual, limits, seats), the only place limits are read from. Price ids are server-only env vars, not `NEXT_PUBLIC_` as in v1. VAT is handled by Stripe Tax (UK, exclusive), with the customer's business name and VAT number collected at Checkout.

### 4.4 Provisioning (R06), assisted launch version

- Operator creates the brand and owner in one database transaction (account plus membership with role `owner`), then sends the invite. If the invite send fails, the operator sees it and can resend; no orphan login without membership.
- The invite link must land on a working confirm route (fix A3 and test against the live template).
- The customer sets a password on first visit (A4), then is sent to Stripe Checkout for their brand; the brand is `incomplete` until the webhook confirms.
- Self-serve provisioning (Stage 3) reuses the same transactional function, with a stable attempt id for resuming.

### 4.5 Roles (R07)

- Add `role` (`owner` | `member`) to `account_members`; backfill every existing row as `owner`.
- Proposed powers (D4): owner only for billing, inviting and removing people, connecting or disconnecting Facebook and Instagram, export and deletion requests. Members create, edit and schedule content.
- At least one owner per brand is enforced in the database. Role checks run server-side in each sensitive action (the service-role client bypasses RLS, so UI hiding is not enough).
- Role, billing and suspension changes are written to the existing admin audit log.

### 4.6 Usage caps (R08)

- One counter table keyed by `account_id`, billing period and unit. Capacity is reserved atomically (a single `UPDATE ... WHERE used + n <= limit RETURNING`) before the OpenAI call and released if the call fails before any tokens are spent.
- Units: AI generation requests (covering content generation, regeneration, campaign generation and media auto-tagging) and published posts per month; storage as retained bytes per brand, checked on upload and import.
- Limits come from the brand's plan (§2.1); team seats are checked when an owner invites someone.
- Start by logging AI requests for all brands (including comped ones) for two weeks before enforcing, so the §2.1 AI limits can be checked against real use.

### 4.7 Export and deletion (R09), assisted launch version

- Decided (D5): at assisted launch, export and deletion are handled on request by the operator through a documented runbook (`docs/runbooks/customer-offboarding.md`) and an admin action, not a customer button.
- Runbook order: cancel the Stripe subscription, hold all jobs, revoke Meta tokens, archive the brand, export if asked (content, schedule and media, no credentials), hard delete 30 days later (storage objects, rows, ingest secrets, link-in-bio pages). Already-published Facebook and Instagram posts are not deleted by us; the customer is told so.
- Deleting one brand never affects another brand the same person belongs to.

### 4.8 Meta identity (R10, R11)

- Store the app-scoped Meta user id on both `social_connections` and `meta_ad_accounts` at OAuth time. Existing rows without it are left as they are, and reconnecting fills it in.
- Deletion callback: find matching connections, revoke and delete tokens, record progress in a table, and have the status endpoint report the real state for that code.
- Deauthorise callback: mark matching connections revoked; never touch a newer connection made after the deauthorise time.
- Launch gate D7: a real non-tester connects their own Page and Instagram and publishes one agreed post. Ads access is not needed for launch under D1b.

## 5. Build stages

### Stage 1: a second venue can use organic posting safely

1. **Meta access (off-app, start first):** confirm Live mode, Business Verification and Advanced Access for the organic permissions; record the result in §2 D7. Drop ads scopes from any flow a new customer can reach.
2. **Feature gating (D1b):** per-brand flags for paid ads and tournaments, on for The Anchor, off by default. Hide nav, routes and server actions when off.
3. **Anchor coupling for organic features:** T6 (hide the management panel without a connection), T7 (neutral placeholders, empty slug, remove Anchor names from prompts, delete dead owner code), T4 (blank default booking URL). T1 and T2 are deferred with the features they belong to.
4. **Isolation:** I1 account filter on thumbnail lookup and validation of media ids on write; two-ordinary-user isolation tests (not the super-admin fixture).
5. **Auth:** `shouldCreateUser: false` on both magic-link calls (A2); fix and test the invite path (A3); set and reset password (A4); delete the dormant `proxy.ts` after checking nothing imports it (A5, R15).
6. **Alerts:** token-health alerts go to the brand's email (N1); operator alert on repeated publish failures per brand (L4).
7. **Conversions (I3, R17):** per-brand fairness in the retry batch without dropping `not_configured` rows, so delayed pixel setup still recovers.

### Stage 2: assisted paid launch

1. Expand-only migrations: billing tables, `stripe_events`, operator state with every existing brand set `comped` by name, `role` on memberships, usage counters.
2. Stripe integration per §4.3, entitlement per §4.1, publishing hold per §4.2 (deploy readers first, activate the gate last, R16).
3. Roles and customer-run invites per §4.5.
4. Usage logging, then caps per §4.6 once D2 is set.
5. Onboarding checklist stored per brand (profile, connect Facebook, connect Instagram, first provider-confirmed post); works with only one channel connected. Welcome email is optional and never blocks access.
6. Offboarding runbook and admin action per §4.7.
7. Legal: terms with price, renewal, cancellation and refunds; a data processing agreement; retention periods in the privacy policy; a support address. Content signed off by you (and a solicitor if you choose); nothing drafted without your figures.
8. Admin: suspend or comp a brand, see subscription state, reconcile from Stripe.

### Stage 3: self-serve sign-up

1. Logged-out landing and pricing page at `/`; cookie banner only if the chosen analytics needs one.
2. `/signup` with a signup-specific auth path (verification required before ownership or checkout), Turnstile on the form, and the transactional provisioning from §4.4. Supabase dashboard sign-ups enabled only when this ships, knowing the Auth API is then public.
3. Funnel events: verified signup, brand created, checkout confirmed, channel connected, first published post.
4. Self-serve export and deletion.

## 6. Release and rollback (R16)

- Order: expand migrations, deploy code that reads new state but does not enforce, confirm The Anchor and Orange Jelly resolve to `comped`, then switch the entitlement gate on with a flag.
- Rollback: turn the gate flag off (restores today's behaviour without a deploy); stop new checkouts by removing the pricing link and disabling the Checkout route; reconcile any webhook events received during rollback once the app is back.
- Payments, published posts and deleted data cannot be undone by a code rollback; test these only in Stripe test mode and on test Pages until go-live.

## 7. Verification

- Every PR: `npm run ci:verify` (London and UTC test runs).
- Test environment: a seeded Supabase branch or local stack with two ordinary owner users on separate brands, one user in both, captured auth emails, Stripe test mode with webhook forwarding. The e2e job fails, not skips, when this environment is missing.
- Must-pass journeys: the review's test matrix rows that apply under D1b (provisioning, late webhook, stale form after lapse, held job and duplicate delivery, quota race, foreign media id, invited user recovery, rollback with existing Anchor schedules, conversion retry fairness, machine endpoints unaffected).
- Stage 1 done: a real non-tester venue connects and publishes one agreed post with no Anchor text anywhere. Stage 2 done: an invited test brand pays in Stripe test mode, hits a cap, lapses (jobs held, nothing lost), is restored without overdue posts going out, and is offboarded by the runbook.

## 8. Not in scope

Google Business Profile; roles beyond owner and member; multi-currency and non-UK tax; timezones other than Europe/London; paid ads and tournaments for new customers (D1b); AI image add-on plans; self-serve Group plan checkout (Group is sold by contact).
