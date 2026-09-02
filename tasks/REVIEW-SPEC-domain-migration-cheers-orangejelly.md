# Developer Review: CheersAI Domain Migration Specification

**Reviewed document:** `tasks/SPEC-domain-migration-cheers-orangejelly.md`

**Review date:** 2026-09-02

**Review basis:** The draft specification, both repositories, current public DNS and HTTP responses, read-only Vercel project/domain data, Nominet RDAP, and current official Supabase, Vercel, Resend, Cloudflare, and Fetch documentation. No production settings, DNS, data, code, or third-party configuration were changed.

## Executive assessment

**Readiness: Not ready for the remaining production cutover.**

The target design is workable and the draft contains strong discovery detail. However, it is no longer an accurate description of the live starting state. At review time, `cheers.orangejelly.co.uk` already had an explicit DNS-only Vercel CNAME, was verified on the Vercel project, and served the production deployment. Phase A therefore appears complete.

The remaining runbook has five main release blockers:

1. The old domain expires on **7 September 2026 at 16:31:28 UTC**, only five days after this review.
2. The old domain is redirected before authenticated server callers are repointed. A cross-origin redirect removes the booking API's `Authorization` header.
3. The email plan changes the application's Resend sender but does not specify Supabase Auth SMTP, so it cannot guarantee the claimed magic-link sender or delivery.
4. The verification plan asks the operator to disconnect live Meta connections and create real posts/bookings without a safe test-data and cleanup contract.
5. Owners, access checks, go/no-go gates, abort conditions, and a monitoring period are missing.

The safest simplification is to renew `cheersai.uk` for at least one year as a defensive asset, even if all traffic moves now. Repoint direct callers before creating any old-host redirect, use the redirect only for human/browser traffic, and run a defined observation period before cleanup.

### Finding totals

| Priority | Confirmed issues | Optional improvements |
|---|---:|---:|
| P0 | 6 | 0 |
| P1 | 13 | 0 |
| P2 | 3 | 3 |
| P3 | 0 | 1 |

- **P0:** Blocks a safe cutover.
- **P1:** Required before production completion.
- **P2:** Should be clarified or completed during the change.
- **P3:** Useful improvement, but not needed for this cutover.
- **Confirmed issue:** Directly evidenced in the draft, repository, or live read-only checks.
- **Optional improvement:** The current approach can work, but a simpler or safer alternative exists.

## Confirmed issues

### F-01: The verified starting state is already stale

- **Priority:** P0
- **Type:** Delivery / configuration drift
- **Relevant sections:** §2.1, §5.4, §6 Phase A, R2
- **Description:** The draft says `cheers.orangejelly.co.uk` is still answered by the proxied wildcard and Phase A must create and attach the hostname. At 08:21 BST on 2026-09-02, it resolved as an explicit CNAME to `b2a246dd3827302f.vercel-dns-016.com`, Vercel reported it as verified on `oj-cheersai2-0`, and `/login`, `/privacy`, `/terms`, and `/l/the-anchor` returned 200 from the current production deployment.
- **Rationale:** A runbook must start from the real state. Re-running completed setup can cause duplicate work or accidental edits.
- **Impact:** Phase A instructions, rollback claims, risk R2, and the list of outstanding work are wrong or outdated.
- **Recommended action:** Freeze further console changes, record who made this change and when, export the current DNS and Vercel domain state, mark Phase A as completed evidence, and re-baseline all other third-party settings before execution.
- **Open questions:** Who added the record and Vercel domain? Were any Meta, Supabase, Resend, or Vercel environment changes made at the same time?

### F-02: The exact expiry is known and is only five days away

- **Priority:** P0
- **Type:** Schedule / external dependency
- **Relevant sections:** R5, §11 assumption 3, §6 Phase E
- **Description:** Nominet RDAP reports expiry at **2026-09-07T16:31:28Z**. The draft says the date could not be established. Nominet's current lifecycle keeps an expired `.uk` domain operational for 30 days, then stops DNS resolution during the redemption period, with final release after the 95-day lifecycle if it is not renewed.
- **Rationale:** The real dates determine the rollback window and the deadline for removing trusted old callback URLs.
- **Impact:** The delivery schedule cannot be approved without dates. If unrenewed, the redirect is expected to stop around 7 October 2026 and the domain may be released around 11 December 2026.
- **Recommended action:** Add the exact expiry, expected suspension, and expected drop dates to the runbook. Set an internal cutover deadline well before expiry and do not rely on the grace period as planned availability.
- **Open questions:** Is auto-renew disabled? Has the registrar confirmed the same timestamps and renewal status? What is the approved latest cutover date?

### F-03: Letting the old domain lapse creates a takeover and trust risk

- **Priority:** P0
- **Type:** Security / business continuity
- **Relevant sections:** Trigger, D3, §6 step 18, §8, R5-R6
- **Description:** The plan intentionally allows a previously public, linked, and OAuth-trusted brand domain to become available to another registrant. Historic links, bookmarks, QR codes, browser history, saved passwords, and copied URLs will then lead to whoever controls the domain.
- **Rationale:** Removing Meta and Supabase allowlist entries reduces callback risk but does not remove brand impersonation, phishing, or historic-link risk. The spec itself cannot prove that no printed or privately shared links exist.
- **Impact:** A future registrant could impersonate CheersAI or capture traffic intended for it. The old redirect and rollback route also disappear.
- **Recommended action:** Renew `cheersai.uk` for at least one year and retain it as a defensive redirect-only domain. If the product owner refuses, require written risk acceptance, remove all trust relationships before suspension, document the Nominet drop time, and monitor for re-registration.
- **Open questions:** Is non-renewal driven by cost, access, or policy? Who owns the residual phishing and reputation risk?

### F-04: The cutover order breaks authenticated booking conversion calls

- **Priority:** P0
- **Type:** Integration / deployment sequencing
- **Relevant sections:** D3, §6 steps 13-14, V3, V11, §8 Phase D
- **Description:** Step 13 redirects `www.cheersai.uk` to the new origin. Step 14 later changes The Anchor's booking conversion caller, which sends `Authorization: Bearer ...` to the old origin. The Fetch standard removes `Authorization` when following a cross-origin redirect. A 301 or 302 can also change POST to GET and remove its body.
- **Rationale:** A redirect is not a safe bridge for authenticated server-to-server requests.
- **Impact:** Booking conversions can fail between steps 13 and 14, even if the redirect preserves paths and returns 307/308.
- **Recommended action:** Set and deploy both The Anchor direct-call URLs first, verify they call the new hostname without a redirect, and only then redirect the old browser-facing host. Treat any redirect response from a server integration as a test failure.
- **Open questions:** Are any other callers sending `Authorization`, cookies, signatures tied to the host, or custom API keys to the old domain?

### F-05: The Resend change does not configure Supabase Auth email

- **Priority:** P0
- **Type:** Authentication / email integration
- **Relevant sections:** D4-D5, §2.3, §4.1, §5.3-5.4, §6 step 7, V6
- **Description:** `RESEND_FROM` is used by `src/lib/email/resend.ts` for application notifications. Magic links and invitations are sent by Supabase Auth. The draft does not verify or change Supabase's custom SMTP host, credentials, sender address, sender name, templates, rate limits, or link tracking. V6 nevertheless expects a Supabase magic link from `notifications@cheers.orangejelly.co.uk`.
- **Rationale:** Verifying a Resend domain and changing a Vercel environment variable does not change Supabase Auth's mail sender. Supabase's default SMTP is not intended for production and has recipient and rate restrictions.
- **Impact:** Magic-link delivery may still use another sender, fail, or land on the wrong URL. Admin invitations are also affected.
- **Recommended action:** Inspect the live Supabase Auth SMTP configuration. Either configure Resend SMTP explicitly in Supabase Auth or correct V6 to the actual provider and sender. Verify all relevant templates use the intended `RedirectTo` or site URL, disable link tracking for auth mail, and test application notifications and Auth email as separate systems.
- **Open questions:** Is custom SMTP already enabled? Which sender and API key does it use? Are magic-link and invite templates customised? What are the current Auth email rate limits?

### F-06: The Meta reconnection checks are destructive against the live account

- **Priority:** P0
- **Type:** Testing / production operations
- **Relevant sections:** V7, V9, V10, §8
- **Description:** V9 and V10 require disconnecting and reconnecting the live Facebook and Instagram connections. `disconnectProvider()` marks the production connection disconnected. If Meta configuration or token exchange is wrong, scheduled publishing remains disabled until recovery.
- **Rationale:** A migration verification step should not destroy the healthy production state it is trying to protect.
- **Impact:** Facebook or Instagram publishing can stop during the test. The rollback section does not explain how to restore the prior connection state or token.
- **Recommended action:** Use a Meta test app/user/page or a separate non-production CheersAI account. If that is impossible, test authorisation without first disconnecting, schedule a controlled maintenance window, confirm no near-term posts, export safe metadata, and define a manual recovery path before touching the live connection.
- **Open questions:** Is a Meta test user/page available? Can reconnect replace an existing connection without first marking it disconnected? Who can restore publishing if it fails?

### F-07: OAuth flows started before the flip can fail after it

- **Priority:** P1
- **Type:** Integration / edge case
- **Relevant sections:** D9, §6 steps 5, 9-13, V9-V10
- **Description:** Meta requires the `redirect_uri` used in token exchange to match the URI used when authorisation started. This application builds that value from `NEXT_PUBLIC_SITE_URL` both when starting and completing the flow. An OAuth state lasts 10 minutes. A flow started on the old build and completed after the new build can return to the old callback but exchange the code using the new callback URI.
- **Rationale:** Keeping both URIs in Meta does not fix a mismatch inside one in-flight transaction.
- **Impact:** A reconnect started near cutover can fail with a redirect URI mismatch and consumes or expires its state/code.
- **Recommended action:** Prevent reconnects during the cutover, wait at least 10 minutes after the last possible old-host initiation, then flip. Alternatively, store the exact initiating redirect URI in the OAuth state and use it for exchange. Document that a failed in-flight attempt must be restarted.
- **Open questions:** Can the sole user agree to a no-reconnect window? Are Facebook Ads OAuth states governed by the same 10-minute rule?

### F-08: The two Meta app IDs are not mapped to runtime behaviour

- **Priority:** P1
- **Type:** Integration / unconfirmed assumption
- **Relevant sections:** §2.5, §5.4, §6 step 5, R3
- **Description:** The code uses `NEXT_PUBLIC_FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET` for Facebook, Instagram, and Facebook Ads OAuth. `INSTAGRAM_APP_ID` and `INSTAGRAM_APP_SECRET` are declared but not used by these flows. The draft instructs the operator to add the same three callbacks to Meta app `1138649858083556` without proving that this app serves any runtime path. It also checks webhook subscriptions only for the readable app.
- **Rationale:** Console changes should be driven by a verified mapping from deployed environment values to app IDs and Meta products.
- **Impact:** The operator may change the wrong app, miss settings in the real app, or believe webhook coverage is complete when the second app was not inspected.
- **Recommended action:** Safely map each deployed app ID to its code path and Meta product. Update only the callback fields each product actually uses. Manually inspect the unreadable app's webhooks and settings, or explicitly mark it unused and out of scope.
- **Open questions:** Which live environment variable equals each app ID? Why does the second app exist? Does it have any active token, webhook, tester, or product configuration?

### F-09: The Auth journey inventory is incomplete and partly inaccurate

- **Priority:** P1
- **Type:** Functional coverage / testing
- **Relevant sections:** §2.3, §4.1, §7
- **Description:** The draft says only magic link and password reset depend on email. The repository has an admin invitation flow using `inviteUserByEmail(...redirectTo: /auth/confirm)`. It has no normal password-reset request flow; `/auth/forgot-password` permanently redirects to the magic-link UI. There are also two magic-link entry points, one of which accepts a caller-supplied `redirectTo`.
- **Rationale:** Redirect and SMTP changes must cover the flows that actually exist.
- **Impact:** Invitations could break without being tested, while the plan claims coverage for a password-reset journey that is not implemented.
- **Recommended action:** Replace the inventory with password login, magic link, admin invite/acceptance, and any direct API magic-link use. Test each real journey and its failure path. Decide whether the unused/legacy auth routes should remain.
- **Open questions:** Is `/api/auth/magic-link` used by any external client? Must invite acceptance work during this migration?

### F-10: The production Supabase redirect allowlist is broader than needed

- **Priority:** P1
- **Type:** Security / Auth configuration
- **Relevant sections:** D9, §5.4, §6 steps 6 and 17
- **Description:** The draft adds `https://cheers.orangejelly.co.uk/**`. Current Supabase guidance recommends exact redirect paths in production. The known flows use `/auth/callback` and `/auth/confirm`.
- **Rationale:** A broad glob increases the set of accepted post-authentication destinations. This matters more because `/api/auth/magic-link` accepts a `redirectTo` value from its request body and relies on Supabase's allowlist as a boundary.
- **Impact:** A future open redirect or unsafe route on the same host could become an Auth redirect target.
- **Recommended action:** Add the exact production callback URLs required by the code. Keep broad patterns only for controlled local or preview environments. Add application-side validation that API-supplied redirects use the expected origin and path.
- **Open questions:** Are any other exact production callback paths used by invite, recovery, or external clients?

### F-11: D8 says hardcoding is removed, but the proposed code keeps a hardcoded fallback

- **Priority:** P1
- **Type:** Architecture / contradiction
- **Relevant sections:** D8, §5.2-5.3
- **Description:** D8 says neither The Anchor URL will be hardcoded again. The proposed feed code still hardcodes `https://cheers.orangejelly.co.uk` as the fallback, and the booking caller also retains a hardcoded fallback. The proposal adds one full-URL variable and one base-URL variable with different shapes.
- **Rationale:** Silent production fallbacks are what made the existing dependency easy to miss. Mixed variable shapes add configuration and URL-joining errors.
- **Impact:** Future migrations can repeat the same failure. Missing or malformed values may be hidden by defaults.
- **Recommended action:** Prefer one required production `CHEERSAI_BASE_URL`, validate it once, strip trailing slashes, and derive both endpoint paths in a shared helper. If separate variables are retained, make both required in production and remove the claim that no hardcoding remains.
- **Open questions:** Is there a real need for the feed and ingest endpoints to use different hosts?

### F-12: The Anchor change inventory and CI command are incomplete

- **Priority:** P1
- **Type:** Delivery / documentation / testing
- **Relevant sections:** §5.2, V15
- **Description:** Adding `CHEERSAI_FEED_BASE_URL` also changes the environment contract documented in `docs/architecture/env-vars.md`, `docs/architecture/relationships.md`, and `docs/architecture/overview.md`; these files are not listed. There is no direct test for `getWorldCup2026Matches()` URL construction or fallback. The Anchor repository has no `ci:verify` script, so V15 cannot be executed as written.
- **Rationale:** The runbook's acceptance command and inventory must match the repository.
- **Impact:** CI verification fails immediately, the new variable is undocumented, and URL edge cases can ship untested.
- **Recommended action:** Add the three documentation files and focused unit tests to the inventory. Either add a real `ci:verify` script or state the existing commands explicitly: lint, non-interactive Jest, and build.
- **Open questions:** Should the new test require the variable in production or verify a fallback? Which Node version should CI and Vercel use?

### F-13: Redirect status, path, query, and rollback behaviour are not specified

- **Priority:** P1
- **Type:** Redirect correctness / rollback
- **Relevant sections:** D3, §5.4, §6 step 13, V3, §8
- **Description:** V3 accepts any `30x` and checks only one `www` URL. The plan does not require the original path and query string to be preserved, does not check the apex or HTTP URLs, and does not choose temporary versus permanent caching. Vercel redirect tooling exposes status and query preservation as explicit choices.
- **Rationale:** OAuth callbacks and shared links need query strings. A cached 301/308 can keep sending browsers to the new host after an attempted rollback.
- **Impact:** Links or callbacks can lose data, and the stated rollback may not work for clients that cached a permanent redirect.
- **Recommended action:** During the rollback window, use 307 with exact path and query preservation. Verify apex and `www`, HTTP and HTTPS, a nested path, and a query string. Move to a permanent redirect only after the observation window if that is still wanted.
- **Open questions:** Does the Vercel domain redirect UI preserve path and query by default? Can it be configured as 307 for both old hostnames?

### F-14: Phase and rollback statements are inaccurate

- **Priority:** P1
- **Type:** Delivery / rollback
- **Relevant sections:** §6 Phase A-B, §8
- **Description:** Phase A is described as having no user-visible change, but adding the new host makes it publicly reachable and shadows the parking wildcard. The rollback table says A and B need no rollback, although DNS, domains, OAuth allowlists, and Resend records were changed. It says Phase E is not reversible, although Meta and Supabase allowlist entries can be re-added. The truly irreversible event is loss or third-party registration of the old domain.
- **Rationale:** Operators need an exact record of what to undo and what cannot be undone.
- **Impact:** A failed change may leave unnecessary DNS/trust settings behind, while the team misunderstands the real point of no return.
- **Recommended action:** List rollback for each external change. Define the point of no return as old-domain suspension/drop or permanent browser caching, not ordinary allowlist cleanup. Record before/after screenshots or exports for every console.
- **Open questions:** Which external additions should remain after a rollback? Who has authority to reverse each one?

### F-15: Several verification checks are weak, unsafe, or conflated

- **Priority:** P1
- **Type:** Testing / acceptance criteria
- **Relevant sections:** §7
- **Description:** A 200 does not prove the login page is using the right callback URL, policy pages contain valid content, or the feed schema is correct. V4's “view source” approach is unreliable for an authenticated client component. V6 combines Auth mail delivery with application Resend configuration. V7 and V11 create external side effects without named targets, cleanup, or analytics exclusion. V13 checks only one cron even though other routes generate links from `NEXT_PUBLIC_SITE_URL`.
- **Rationale:** Each check should prove one requirement and have a safe, repeatable method.
- **Impact:** The checklist can pass while callbacks, invites, email notifications, redirects, or server integrations remain broken. Tests can also publish unwanted content or pollute conversion data.
- **Recommended action:** Split checks by subsystem. Use browser assertions for rendered UI, inspect exact `Location` values, require direct non-redirect API calls, test Auth and application email separately, define test post/booking markers and cleanup, and check all URL-producing scheduled paths that are enabled in production.
- **Open questions:** Which Page receives a test post? Who deletes it? How is a test booking cancelled and excluded from Meta reporting?

### F-16: There are no owners, access preflights, or go/no-go gates

- **Priority:** P1
- **Type:** Delivery management
- **Relevant sections:** Header, §5-8
- **Description:** The work spans two repositories and at least six external administration surfaces, but no step has an owner, access prerequisite, planned time, dependency, approval, or completion evidence. There is no configuration freeze or check for scheduled posts and active OAuth work.
- **Rationale:** A technically correct sequence can still fail if the third-party developer lacks one console role or if changes happen concurrently.
- **Impact:** The cutover can stop halfway, leaving mixed configuration and unclear responsibility.
- **Recommended action:** Add an owner and verifier to every step, preflight access at least one business day before cutover, define a change window, freeze related configuration, confirm no posts or reconnects are in flight, and require explicit go/no-go approval at the end of each phase.
- **Open questions:** Who owns Cloudflare, Vercel, Meta, Supabase, Resend, Instagram, and each repository deployment? Who is the incident lead?

### F-17: No monitoring or observation period is defined

- **Priority:** P1
- **Type:** Monitoring / operations
- **Relevant sections:** §6 Phase E, §7, §9
- **Description:** Verification is a one-time pass. There is no soak duration, synthetic check, alert owner, baseline, old-host traffic check, or scheduled review of Vercel, Supabase, Resend, and Meta logs.
- **Rationale:** Cron, token expiry, scheduled publishing, DNS cache, and email delivery problems may not appear during an immediate smoke test.
- **Impact:** Cleanup can remove rollback options before delayed failures are visible.
- **Recommended action:** Define at least a 48-hour intensive observation period and a 7-day follow-up. Monitor new-host uptime/TLS, old-host redirects, banner failures, publish jobs, email delivery/bounces, Auth logs, booking ingest, feed freshness, and Meta app health. Keep old allowlists until the agreed soak passes, but remove them before any domain drop.
- **Open questions:** What monitoring tools are available if Axiom and Upstash are not configured? Who reviews alerts outside working hours?

### F-18: The point-in-time audits are not reproducible or protected from drift

- **Priority:** P1
- **Type:** Data / configuration assurance
- **Relevant sections:** §2.2-2.6, D7, §6
- **Description:** The draft reports detailed live checks but does not include the SQL, API request shapes, DNS record export, environment export, or redacted evidence needed to repeat them. Mutable data and settings can also change between discovery and cutover. The live DNS state already demonstrates this drift.
- **Rationale:** “No data migration” and “nothing else calls the host” are only true at the time and within the scope of the scan.
- **Impact:** New stored URLs, pending OAuth states, environment changes, or third-party callbacks can be missed.
- **Recommended action:** Attach redacted, repeatable preflight commands/queries. Re-run the repository search, full relevant text/JSON data scan, pending OAuth-state check, environment inventory, DNS export, and external console checks immediately before cutover and again after it. State exact scan scope and expected counts.
- **Open questions:** Were all text columns scanned or only columns already believed to contain URLs? Are browser storage, analytics settings, QR assets, password-manager entries, and private shared links accepted residual risks?

### F-19: Sender, recipient, and reply handling are mixed together

- **Priority:** P1
- **Type:** Email / operational support
- **Relevant sections:** D4-D5, §4.1, §5.1, V6
- **Description:** `RESEND_FROM` is only a sender. Application notifications are sent to account/user emails. The Edge worker separately uses `notifications@...` as its fallback **recipient**, but the draft says the worker has no Resend API key and the proposed address is not defined as a real inbox. Resend's bounce `send.` MX record does not create an inbox for replies to `notifications@...`.
- **Rationale:** Sending identity, alert recipient, Auth SMTP sender, and reply handling are different requirements.
- **Impact:** Some mail can send successfully while replies or worker alerts go nowhere. The verification plan may test the wrong channel.
- **Recommended action:** Define each email channel in a small matrix: sender, recipient, provider, secret store, reply-to, and owner. Use a real monitored recipient for alerts. Decide whether replies should reach support or use a clear no-reply address.
- **Open questions:** Should `notifications@cheers.orangejelly.co.uk` accept replies? What real mailbox receives operational alerts? Will Supabase Auth use the same or a separate sender?

### F-20: Preview and development environment behaviour is ambiguous

- **Priority:** P2
- **Type:** Environment management / security
- **Relevant sections:** §5.3
- **Description:** The draft says to update Preview “if it names the old domain” and set `RESEND_FROM` in all environments, but it gives no expected Preview URL, OAuth behaviour, or protection against sending real email from preview deployments. The current Vercel variables span different combinations of Development, Preview, and Production.
- **Rationale:** Public URL and mail settings affect build output and external side effects per environment.
- **Impact:** Preview OAuth can return to production, or preview/test jobs can email real users from the production sender.
- **Recommended action:** Add an explicit environment matrix. Keep production canonical URLs only where intentional, use safe preview callbacks or disable them, and prevent non-production email from reaching real recipients.
- **Open questions:** Are previews used for OAuth or cron testing? Is there a mail sandbox or recipient override?

### F-21: The documented local site URL uses HTTPS without local TLS

- **Priority:** P2
- **Type:** Developer experience / configuration
- **Relevant sections:** §5.1, `.env.example`
- **Description:** The draft explicitly keeps `NEXT_PUBLIC_SITE_URL="https://localhost:3000"` as the local default. `npm run dev` starts normal HTTP Next.js, and `src/env.ts` itself defaults to `http://localhost:3000`.
- **Rationale:** Developers copying `.env.example` can generate unusable Auth and OAuth callback URLs.
- **Impact:** Local login, link generation, and callback testing can fail for a reason unrelated to the migration.
- **Recommended action:** Change the example to `http://localhost:3000`, unless a documented local TLS command is added.
- **Open questions:** Is local HTTPS intentionally supported elsewhere?

### F-22: “No SEO risk” is stronger than the evidence supports

- **Priority:** P2
- **Type:** Product / search / assumption
- **Relevant sections:** §2.7, D3, R6
- **Description:** `noindex` and a disallowing robots file reduce search exposure, but they do not prove that no URL is indexed, linked, cached, bookmarked, printed, or tracked. The Instagram bio and acknowledged historic links already prove external discovery paths exist.
- **Rationale:** Search engines can know about blocked or previously indexed URLs, and SEO is only one source of old-host traffic.
- **Impact:** The team may remove the old domain too quickly or skip traffic checks.
- **Recommended action:** Reword this as low expected organic-search risk. Check Search Console if available, analytics/referrer data, and old-host request logs. Preserve path redirects regardless of SEO value.
- **Open questions:** Is Search Console configured? What old-host traffic exists over the last 30-90 days?

## Optional improvements

### O-01: Use one canonical server-side CheersAI base URL

- **Priority:** P2
- **Type:** Simplification / maintainability
- **Relevant sections:** D8, §5.2-5.3
- **Description:** The Anchor proposal uses a full booking endpoint variable and a feed base variable.
- **Rationale:** One validated base URL reduces configuration count and makes future host changes atomic.
- **Impact:** Lower chance of caller drift and malformed URL composition.
- **Recommended action:** Create a small server-only helper that reads one `CHEERSAI_BASE_URL` and builds named feed and booking endpoints.
- **Open questions:** Do the endpoints need independent hosts or release timing?

### O-02: Turn the runbook into an executable evidence checklist

- **Priority:** P2
- **Type:** Delivery automation
- **Relevant sections:** §2, §6-7
- **Description:** Most checks can be performed read-only with DNS, HTTP, Vercel, repository search, and safe database queries.
- **Rationale:** A script reduces transcription mistakes and records timestamps and pass/fail results.
- **Impact:** Faster, repeatable go/no-go decisions and clearer handoff to a third-party developer.
- **Recommended action:** Add a redaction-safe preflight script for public DNS/HTTP and repository checks, plus a manual checklist for consoles and secret-backed tests. Never print secret values.
- **Open questions:** Where should evidence be stored and who may access it?

### O-03: Decouple the mail domain from the web hostname

- **Priority:** P2
- **Type:** Architecture / future migration simplification
- **Relevant sections:** D4
- **Description:** The proposed mail domain exactly matches the new app hostname.
- **Rationale:** A stable mail-specific subdomain such as `notifications.orangejelly.co.uk` can survive a future app rename and makes purpose clearer. Resend recommends using subdomains to isolate sending reputation.
- **Impact:** One less coupled change in future web-domain migrations.
- **Recommended action:** Consider a stable mail-specific subdomain. Do not change the current choice if doing so threatens this cutover deadline.
- **Open questions:** Is a company-wide transactional mail naming standard planned?

### O-04: Add a small non-functional smoke baseline

- **Priority:** P3
- **Type:** Performance / accessibility
- **Relevant sections:** §7
- **Description:** The change adds no new interaction and should have little performance impact, but the checklist does not explicitly guard either area.
- **Rationale:** A host change can still alter TLS, redirects, caching, headers, or rendered copy.
- **Impact:** Low. This is defence against incidental regressions.
- **Recommended action:** Compare response time and headers on old/new URLs, run the existing accessibility audit where available, and confirm the changed helper text is readable and announced with its form field. No full performance or accessibility project is needed.
- **Open questions:** Is there an agreed browser/device baseline for this internal app?

## Targeted wording changes

These are focused corrections, not a rewrite of the original document.

1. **§2.1 current state**
   - Replace the wildcard statement with: “As of 2026-09-02 08:21 BST, `cheers.orangejelly.co.uk` has an explicit DNS-only CNAME to Vercel, is verified on `oj-cheersai2-0`, and serves the current production deployment. Confirm again before cutover.”

2. **R5 / assumption 3**
   - Replace “expiry date not established” with: “Nominet RDAP reports expiry at 2026-09-07 16:31:28 UTC. If unrenewed, current Nominet policy indicates resolution stops after the 30-day expiry grace period.”

3. **D8**
   - Replace “so neither is hardcoded again” with either “both endpoints are derived from one required production base URL” or admit that a hardcoded emergency fallback remains.

4. **§2.7**
   - Replace “there is no organic search footprint to preserve, so the migration carries no SEO risk” with: “The app is currently noindexed, so organic-search risk is expected to be low; external links, historic indexing, and direct traffic still require redirects and monitoring.”

5. **§8 Phase E**
   - Replace “Not reversible” with: “Allowlist cleanup is reversible. Loss or third-party registration of `cheersai.uk`, and client-cached permanent redirects, may not be practically reversible.”

6. **V6**
   - Split it into two checks: one for application notification email through Resend, and one for Supabase Auth magic-link delivery through the confirmed Auth SMTP configuration.

7. **D2**
   - Replace “Proxying it would break Vercel's certificate issuance” with: “Use DNS-only to match the proven setup and avoid adding a second proxy/TLS layer; certificate issuance and origin validation must pass before cutover.”

## Overall readiness

### Key required changes

1. Re-baseline the live state and mark Phase A as already completed if confirmed by the change owner.
2. Record the exact expiry and decide immediately whether to renew the old domain. Renewal is strongly recommended.
3. Reorder the cutover so all direct callers use and verify the new hostname before any old-host redirect.
4. Add an explicit Supabase Auth SMTP and email-template plan, separate from application Resend mail.
5. Replace destructive production Meta tests with a safe test path and handle the 10-minute in-flight OAuth window.
6. Correct The Anchor's inventory, tests, documentation, and CI command.
7. Specify redirect status, path/query preservation, go/no-go gates, rollback triggers, owners, and monitoring.

### Unresolved decisions

- Whether `cheersai.uk` will be renewed as a defensive redirect domain.
- Which service and sender Supabase Auth currently uses.
- Which Meta app ID actually serves each deployed OAuth flow.
- Whether a safe Meta test user/page and test CheersAI account are available.
- Whether one required `CHEERSAI_BASE_URL` will replace the two proposed caller variables.
- Which redirect status will be used during the rollback window.
- The approved change window, owners, incident lead, and soak duration.

### Major risks

- Old-domain expiry or capture before the migration is stable.
- Silent loss of booking conversions caused by redirecting authenticated POSTs.
- Auth email failure hidden by a successful application Resend test.
- Live Facebook/Instagram publishing disabled by a destructive reconnect test.
- Partial third-party updates with no owner or rollback evidence.
- Delayed failures discovered only after old allowlists or rollback options are removed.

### Recommended next steps

1. Stop further ad hoc console changes and capture the current state.
2. Renew `cheersai.uk` for one year, or obtain explicit written risk acceptance before continuing.
3. Confirm console access, Meta app mapping, Supabase Auth SMTP/templates, and Resend domain status.
4. Set and deploy The Anchor's direct new-host caller configuration first; verify no redirect is followed.
5. Add new Meta/Supabase callback URLs, then deploy the CheersAI code and environment changes.
6. Update the Supabase Edge Function secret and Auth Site URL, then run safe subsystem-specific tests.
7. Change the Instagram bio after the new host is proven.
8. Redirect the old hosts last, initially with a temporary method-preserving redirect that keeps path and query.
9. Monitor for at least 48 hours, review again at seven days, then remove old trust entries. Keep the domain registered as a defensive redirect if approved.

## Sources

- Local code: `middleware.ts`, `src/env.ts`, `src/lib/auth/actions.ts`, `src/app/(app)/admin/actions.ts`, `src/lib/connections/oauth.ts`, `src/lib/connections/token-exchange.ts`, `src/app/(app)/connections/actions.ts`, `src/lib/email/resend.ts`, `supabase/functions/publish-queue/worker.ts`.
- The Anchor code: `lib/booking-conversion-forwarding.ts`, `lib/world-cup-2026.ts`, `package.json`, and environment architecture docs.
- [Nominet RDAP record for cheersai.uk](https://rdap.nominet.uk/uk/domain/cheersai.uk)
- [Nominet .uk expiry lifecycle](https://registrars.nominet.uk/uk-namespace/new-domain-expiry-process-and-introduction-of-drop-lists-for-uk/)
- [Fetch Standard: HTTP redirect fetch](https://fetch.spec.whatwg.org/#http-redirect-fetch)
- [Supabase redirect URL guidance](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase custom SMTP guidance](https://supabase.com/docs/guides/auth/auth-smtp)
- [Vercel domain deployment and redirects](https://vercel.com/docs/domains/working-with-domains/deploying-and-redirecting)
- [Vercel redirect configuration](https://vercel.com/docs/project-configuration/vercel-json)
- [Resend verified domains](https://resend.com/docs/dashboard/domains/introduction)
- [Cloudflare wildcard DNS precedence](https://developers.cloudflare.com/dns/manage-dns-records/reference/wildcard-dns-records/)
