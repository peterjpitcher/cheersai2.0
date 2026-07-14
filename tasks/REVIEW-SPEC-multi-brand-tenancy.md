# Developer Review — Multi-Brand Tenancy Specification

**Reviewed document:** `tasks/SPEC-multi-brand-tenancy.md`

**Review date:** 2026-07-14

**Review basis:** The draft specification, current application code, committed Supabase migrations, the staged v1 baseline used by local/CI rebuilds, and the CI workflow. The live database claims in the specification were treated as a supplied snapshot; this review did not change or re-query production.

## Executive assessment

**Readiness: Not ready for implementation.**

The proposed membership model is broadly sensible, but the draft has several release-blocking faults. Most importantly, membership-based RLS would expose all of a user's brands to existing anon-client reads, even though the product requires one active brand. A PostgreSQL function cannot read the proposed application cookie, so `current_account_id()` cannot solve that problem as written. The retained `accounts.auth_user_id ... ON DELETE CASCADE` would also allow deletion of the original auth user to delete an entire brand and all of its content.

The delivery plan is not yet safely deployable. It describes one migration in one section and at least two deployed migrations in another, while also requiring an atomic app/database release that Vercel and Supabase cannot provide. The clean-rebuild schema also differs from production in exactly the Meta foreign keys this change touches.

### Finding totals

| Priority | Confirmed issues | Meaning |
|---|---:|---|
| P0 | 9 | Blocks implementation or safe release |
| P1 | 15 | Required before production release |
| P2 | 3 | Should be decided or specified before build completion |
| P3 | 0 | Nice-to-have only |

`Confirmed issue` means the conflict or omission is directly visible in the specification or repository. `Optional improvement` means the current approach can work, but a simpler or safer option exists.

## Confirmed issues

### F-01 — Membership RLS breaks active-brand isolation

- **Priority:** P0
- **Type:** Security / functional correctness
- **Relevant sections:** §1, D3, §3.2–3.3, §4.4, §7
- **Description:** The draft changes tenant RLS from one account to `is_account_member(account_id)`. That authorises every brand the user belongs to, not the one active brand. Existing anon-key reads in `src/lib/content/queries.ts` do not add an `account_id` filter. `getContentById`, `getContentByAccount`, and `getContentForCalendar` rely only on RLS. They would return or accept data from all memberships.
- **Rationale:** D3 explicitly says there is no combined cross-brand view. The statement that every query flows through `requireAuthContext()` is not true for these server reads. Other anon-client, storage, realtime, and ID-based paths also need an explicit audit.
- **Impact:** Cross-brand content can appear in the planner and other screens. A user could open an object from a non-active brand by ID. This is a tenant-isolation failure even though the user has membership in both brands.
- **Recommended action:** Make active-brand scope explicit in every user-facing read and write. Pass a verified active `accountId` into anon-client queries and add `.eq('account_id', accountId)` or a verified parent relationship. Keep membership RLS as the maximum permission boundary, not the active-brand selector. Produce a complete inventory of service-role, anon-client, browser, realtime, storage, route-handler, and object-ID paths.
- **Open questions:** Is cross-brand access by direct object URL ever intended? Should global super-admins see all-brand results, or must they also select one active brand?

### F-02 — PostgreSQL cannot resolve the active brand from the application cookie

- **Priority:** P0
- **Type:** Technical feasibility / contradiction
- **Relevant sections:** D7, §4.4, §5.4, §7
- **Description:** The draft says `current_account_id()` remains the active-brand resolver for the anon/cookie client. PostgreSQL receives the Supabase JWT; it does not receive or understand the Next.js `cheersai_active_account` cookie. No mechanism is specified to place the selected cookie value into a database request claim.
- **Rationale:** The current function can read JWT claims through `auth.jwt()`, but an HTTP-only application cookie is only visible to the Next.js request. Updating `app_metadata.account_id` on each switch would create token refresh, race, multi-tab, and cross-device problems and is not proposed.
- **Impact:** The specified SQL behaviour cannot be implemented. If the old JWT account claim remains, RLS may select the wrong brand. If it is removed, `current_account_id()` returns null.
- **Recommended action:** Remove active-brand responsibility from `current_account_id()`. Resolve and verify the cookie in the Next.js auth boundary, then explicitly scope application queries. Use membership-only RLS as defence in depth. Retain `current_account_id()` only for legacy compatibility during a defined transition, or remove its use entirely.
- **Open questions:** Are there any direct browser Supabase reads that must be active-brand scoped without going through the application server?

### F-03 — Deleting the original auth user would delete the brand

- **Priority:** P0
- **Type:** Data integrity / security
- **Relevant sections:** §4.3, §8, §10
- **Description:** The draft keeps `accounts.auth_user_id` as a creator/original-owner field and keeps its `ON DELETE CASCADE` foreign key. In the current schema, deleting that auth user deletes the `accounts` row. Most brand data then cascades from `accounts(id)`.
- **Rationale:** A historical creator is not the lifecycle owner of a shared tenant. The field's meaning changes, but its destructive referential action does not.
- **Impact:** Removing or cleaning up one user can delete an entire brand, media, content, campaigns, settings, jobs, and memberships.
- **Recommended action:** Add a dedicated nullable `created_by_user_id` with `ON DELETE SET NULL`, backfill it, and stop using `auth_user_id` as ownership. Either remove `auth_user_id` after compatibility is no longer needed or change its FK action before multi-brand creation is enabled. Add an explicit auth-user deletion test.
- **Open questions:** Must creator history survive user deletion? Is brand deletion allowed at all, and who approves it?

### F-04 — Super-admin permissions contradict the stated operating model

- **Priority:** P0
- **Type:** Authorisation / product decision
- **Relevant sections:** D2, D6, §4.4, §5.2, §8, §16
- **Description:** D2 says there is one super-admin. The admin UI can set and unset super-admins, which permits zero or many. The assumptions say the admin holds explicit memberships for day-to-day work, but `is_account_member()` grants a super-admin access to every brand and `getCurrentUser()` loads every account into the switcher.
- **Rationale:** The draft does not distinguish “administer membership” from “operate all brand data.” The proposed SQL and switcher implement full god-mode read/write access without membership.
- **Impact:** The implementation may overgrant access, permit accidental edits to any brand, or allow the last administrator to remove their own access and lock out administration.
- **Recommended action:** Lock one model before coding: either exactly one immutable bootstrap admin, or multiple global admins with last-admin and self-removal protections. Separately decide whether global admins can operate brand content without membership. If not, remove the admin bypass from brand-data RLS and require membership for active-brand operation.
- **Open questions:** Can a super-admin edit/publish for a brand without membership? Can they revoke themselves? Must there always be at least one admin?

### F-05 — OAuth connection state is not consistently bound to the starting brand

- **Priority:** P0
- **Type:** Security / integration
- **Relevant sections:** §7 (`oauth_states` no change), §8
- **Description:** The normal Facebook/Instagram OAuth flow starts without recording `accountId`, then completes against whichever brand is active at callback time (`src/app/(app)/connections/actions.ts`). The Facebook Ads flow already tries to store `account_id` in its state (`actions-ads.ts`). The draft explicitly says `oauth_states` needs no change.
- **Rationale:** A user can start OAuth for brand A, switch to brand B in another tab, then complete the callback. The returned provider token can be stored against B. A per-user state is not enough in a multi-brand system.
- **Impact:** Social or advertising credentials may be attached to the wrong brand. This can lead to publishing or advertising against the wrong external account.
- **Recommended action:** Store the verified starting `account_id`, initiating `user_id`, provider, expiry, and single-use status in every OAuth state. On callback, use the stored brand, re-check current membership, and fail safely if access was revoked. Do not derive callback tenancy from the current cookie.
- **Open questions:** If membership is revoked during OAuth, should the flow be cancelled or may a super-admin complete it? How should abandoned states be cleaned up?

### F-06 — The Meta FK plan fails against clean local/CI rebuilds

- **Priority:** P0
- **Type:** Migration / schema consistency
- **Relevant sections:** D10, §3.5, §7, §10
- **Description:** Production reportedly has no Meta `account_id` FKs, but the repository's staged v1 baseline creates several FKs to `auth.users(id)`, and `20260609092541_ad_metrics_history.sql` directly creates the same wrong FK. The draft says no FK needs dropping or repointing.
- **Rationale:** CI stages `supabase/baseline/v1_baseline.sql` during database rebuild. A forward migration that only adds an `accounts(id)` FK can leave the legacy `auth.users(id)` FK in clean environments. New brand IDs are not auth-user IDs, so inserts then fail.
- **Impact:** Local rebuilds and CI can disagree with production. Meta data for newly created brands may be impossible to insert.
- **Recommended action:** Write idempotent catalog-driven migration logic for every affected table: identify and drop any `account_id` FK to `auth.users`, validate/backfill values, add one named FK to `accounts(id)`, and assert the final target. Test both a clean staged-baseline rebuild and an upgrade shaped like production.
- **Open questions:** Which environment is the authoritative schema source when production and the rebuild baseline differ? Should the baseline generator also be corrected after the forward migration?

### F-07 — The helper function DDL is in an invalid order and lacks a complete privilege contract

- **Priority:** P0
- **Type:** Database / security
- **Relevant sections:** §4.4, §10
- **Description:** The SQL creates `is_account_member()` before `is_super_admin()`, although the first function calls the second. The draft also does not state the owner, `EXECUTE` grants/revokes, or `FORCE ROW LEVEL SECURITY` decisions for the new security-definer functions and tables.
- **Rationale:** SQL-language functions resolve referenced functions when created, so the shown order can fail. Security-definer helpers are part of the authorisation boundary and should not rely on default PUBLIC execute privileges.
- **Impact:** The migration may fail before any app deployment. Loose privileges can expose membership/admin predicates more broadly than intended.
- **Recommended action:** Create `is_super_admin()` first, then `is_account_member()`. Fully qualify objects, set a safe search path, explicitly set ownership, revoke default privileges, grant only required roles, and add SQL tests for anon, authenticated, service-role, admin, member, and non-member contexts.
- **Open questions:** Does anon need either helper for any public policy? Will the new tables use `FORCE ROW LEVEL SECURITY`?

### F-08 — The rollout cannot be atomic as described

- **Priority:** P0
- **Type:** Delivery / deployment
- **Relevant sections:** §10, §11, §14
- **Description:** §11 says there is one new migration. §14 deploys a membership migration in PR1 and a policy/constraint migration in PR2, which requires at least two. §10 says the app and PR2 database migration must land together, but Vercel and Supabase deploy separately and cannot be atomic.
- **Rationale:** The draft does not define which version is compatible during each deployment window. It also calls PRs independently deployable while making PR2 a coupled release.
- **Impact:** A partial deployment can cause login failures, missing-brand redirects, mixed-brand reads, or writes under the old 1:1 assumption.
- **Recommended action:** Replace the atomic step with an expand-and-contract release matrix. Define DB-old/app-old, DB-new/app-old, DB-new/app-new, and rollback compatibility. Use at least: foundation migration; compatibility app; policy migration; feature enablement; later cleanup. Prevent brand creation until the new auth path and policies are live.
- **Open questions:** Who applies production migrations, in what order, and how is feature enablement controlled? Is a short maintenance window acceptable?

### F-09 — The test plan cannot prove tenant isolation or migration safety

- **Priority:** P0
- **Type:** Testing / security
- **Relevant sections:** §12, §14, §15
- **Description:** The plan centres on Vitest with mocked Supabase and lists only broad RLS checks. It does not require a clean database rebuild, an upgrade rehearsal, policy operation coverage, storage policies, OAuth brand binding, direct-ID attacks, service-role guards, realtime, browser cache isolation, or deployment compatibility tests.
- **Rationale:** Mocked clients cannot execute PostgreSQL RLS, FK, trigger, function-owner, JWT-claim, or storage policy behaviour. The current CI migration job lints a rebuilt database but does not run tenant-isolation scenarios.
- **Impact:** The main security property could fail while all listed unit tests pass.
- **Recommended action:** Add database integration tests with at least two users, three brands, overlapping memberships, a super-admin, and a zero-brand user. Cover SELECT/INSERT/UPDATE/DELETE, parent-child policies, storage, invalid object IDs, OAuth state, membership revocation, and Meta FKs. Run both clean rebuild and production-shaped upgrade tests. Add Playwright journeys for switching, no access, invite acceptance, admin actions, mobile navigation, and stale-cache prevention.
- **Open questions:** Can CI start Auth and Storage services for full RLS/storage tests, or will a dedicated staging test job be used?

### F-10 — An administrator cannot clear another user's HTTP-only cookie

- **Priority:** P1
- **Type:** Functional correctness / security
- **Relevant sections:** §8 capability 3, §9
- **Description:** The draft says revoking membership should repoint or clear the revoked user's active cookie. A server action can only set cookies on the response to the browser making that request. An admin cannot mutate a different user's browser cookie.
- **Rationale:** The cookie is client-held state and there is no server-side active-brand preference record.
- **Impact:** The stated behaviour cannot be delivered. The revoked user keeps a stale cookie until their next request, when it must be rejected and replaced in memory or by a response-capable route/action.
- **Recommended action:** Change the requirement to: revoke the membership immediately in the database; every subsequent protected request rejects the stale cookie and selects another permitted brand or returns `/no-access`. Define how the current user's own response refreshes the cookie. Do not promise remote cookie clearing.
- **Open questions:** What revocation latency is acceptable for already-running requests, signed media URLs, and queued work?

### F-11 — The mirrored admin claim conflicts with immediate revocation

- **Priority:** P1
- **Type:** Security / authorisation
- **Relevant sections:** D6, §4.2, §5.2, §8
- **Description:** The table is described as the source of truth with immediate revocation, while the mirrored JWT claim is a query-free fast path. Existing JWTs can retain `is_super_admin: true` until refreshed. A fast path that trusts the claim defeats immediate table revocation.
- **Rationale:** Updating `app_metadata` does not rewrite tokens already held by browsers. If every privileged action still checks the table, the claim provides little useful optimisation and creates two sources to reconcile.
- **Impact:** A removed admin may retain access, or the UI and server can disagree about privilege.
- **Recommended action:** Use `app_admins` for every privileged server decision. Treat any claim as a non-authoritative UI hint only, or remove the mirror entirely. If a claim remains, specify token refresh, mismatch handling, and monitoring.
- **Open questions:** Is avoiding one indexed table lookup worth the dual-source complexity at the expected traffic level?

### F-12 — Zero-brand routing and API behaviour are incomplete

- **Priority:** P1
- **Type:** Functional / error handling
- **Relevant sections:** D9, §5.3, §11
- **Description:** Only `requireAuthContext()` is specified to redirect zero-brand users. The protected app layout currently calls `getCurrentUser()` directly and would still render the shell unless explicitly changed. If `/no-access` is placed inside `(app)`, it can redirect to itself. Route handlers currently translate Next redirects into 401 responses, even when the user is authenticated but lacks a brand.
- **Rationale:** Zero-brand is a new authenticated state, not an authentication failure.
- **Impact:** Redirect loops, an empty/broken shell, or incorrect 401 responses are likely. Clients cannot distinguish login expiry from missing access.
- **Recommended action:** Put `/no-access` outside the brand-required layout but behind authentication. Update the app layout to redirect zero-brand users. Give API auth a typed result with 401 for unauthenticated and 403 for authenticated/no membership. Include sign-out and a clear support route on the page.
- **Open questions:** May a zero-brand super-admin access `/admin` to recover configuration? What contact details should the page show?

### F-13 — Brand creation is not atomic and its seed contract is unclear

- **Priority:** P1
- **Type:** Data integrity / functional detail
- **Relevant sections:** §5.5, §8 capability 1, §11
- **Description:** Brand creation inserts an account and several seed rows through the service-role client, but no transaction or compensation behaviour is specified. The listed seed set includes `profiles`, `posting_defaults`, and `brand_profile`; existing `ensureOwnerAccount()` seeds different rows, including placeholder social connections, and does not create `profiles`.
- **Rationale:** Multiple Supabase API calls are not one transaction. Partial failure can leave a brand visible but unusable. Retrying may duplicate non-unique seed data.
- **Impact:** Administrators can create half-configured brands and receive unclear errors. Cleanup becomes manual and risky.
- **Recommended action:** Define one idempotent database function/RPC or transaction-backed server operation that creates the account, initial membership, and exact required defaults. Validate all inputs before the transaction and return a stable result. Decide whether connections are absent or represented by placeholders.
- **Open questions:** Is the creator automatically a member? Which rows are mandatory for first render? What are the default timezone, display name, notification settings, and platform rows?

### F-14 — User invite and membership journeys are underspecified

- **Priority:** P1
- **Type:** Functional / integration / error handling
- **Relevant sections:** D4, §3.6, §8 capability 2–3
- **Description:** The draft lists invite, assign, and revoke as capabilities but not their ordering or failure behaviour. It does not cover an existing auth user, duplicate or expired invitation, resend, email delivery failure, assigning before first login, disabled users, removing users, or invitation acceptance without membership. It assumes the existing confirmation route is sufficient without specifying the Supabase email template and redirect configuration.
- **Rationale:** `inviteUserByEmail` is a remote side effect and cannot be rolled back with membership changes. The existing callback routes also accept a `next` value that should be restricted to local paths before they become part of an admin invite flow.
- **Impact:** Users may receive valid invites but land on `/no-access`, or a membership may exist for a user who never receives the invite. Admins may not know whether to retry.
- **Recommended action:** Define separate, idempotent journeys for “assign existing user” and “invite new user to selected brands.” Specify pending status, resend, expiry, duplicate handling, partial failure recovery, safe local redirects, and UI feedback. Confirm production Auth email templates and redirect allow-list.
- **Open questions:** Can one invite assign several brands? Should access exist before acceptance? Can an admin cancel a pending invite?

### F-15 — The proposed audit helper cannot record global admin actions

- **Priority:** P1
- **Type:** Audit / monitoring
- **Relevant sections:** §8, §9
- **Description:** The draft suggests using `logPublishAuditEvent` for admin mutations. That helper only accepts publish-related operation/resource types and requires a non-null brand `accountId`. Global actions such as inviting a user or changing super-admin status do not belong to one brand.
- **Rationale:** `audit_log.account_id` is currently non-null and cascades with a brand. The helper also does not record an acting user for these operations.
- **Impact:** Admin changes may be missing, mislabelled as publish events, or hidden under an unrelated active brand. Critical access changes would not have a durable global trail.
- **Recommended action:** Design a dedicated admin audit model or generalise the audit table and helper. Record actor user, target user, target brand when applicable, before/after values, result, correlation ID, and reason. Global records must survive brand deletion.
- **Open questions:** Who can read global admin audit records? How long must they be retained?

### F-16 — Client cache isolation is not fully specified

- **Priority:** P1
- **Type:** Data isolation / client state
- **Relevant sections:** §6.3, §11
- **Description:** The draft says to include `accountId` in React Query keys, but the query client is created above the inner authenticated provider and persists across route refreshes. Current keys in analytics, content detail, and link-in-bio omit the brand. `revalidatePath()` invalidates server data; it does not guarantee that all client cache entries, open drawers, optimistic state, or mutations are discarded.
- **Rationale:** The browser can retain brand A data after the cookie changes to brand B. Multiple tabs share the cookie but not their in-memory caches.
- **Impact:** Stale data can be shown or mutated after a switch. This is especially risky for open editors and direct-ID queries.
- **Recommended action:** Define one account-aware query-key factory and update every query and invalidation. Prefer remounting/clearing the query client when `activeAccountId` changes, then call `router.refresh()`. Disable the switch while its action is pending and define behaviour for open unsaved work.
- **Open questions:** Should switching warn about unsaved changes? How should another tab detect a cookie change and refresh?

### F-17 — Booking conversion attribution cannot be generally deferred

- **Priority:** P1
- **Type:** Integration / scope
- **Relevant sections:** §3.6, §13, §14 PR4
- **Description:** The draft correctly identifies `BOOKING_CONVERSION_ACCOUNT_ID` as a single-brand pin but declares it non-blocking. Once more than one live brand uses campaigns or conversion reporting, every inbound booking still routes to the configured brand.
- **Rationale:** This is not only a later enhancement; it is a known data-integrity failure for a current integration.
- **Impact:** Conversion data, campaign optimisation, and reporting can be attributed to the wrong customer.
- **Recommended action:** Either deliver brand-scoped ingestion before onboarding a second brand that uses bookings, or explicitly gate that feature to the one configured brand. Add signed per-brand credentials or an unambiguous validated routing key; do not trust a free-form account ID from the caller.
- **Open questions:** Which brands will use booking ingestion at launch? Can the source system issue one secret per brand?

### F-18 — Brand identity fields have unclear meanings and validation

- **Priority:** P1
- **Type:** Data model / functional detail
- **Relevant sections:** §3.1, §5.1–5.2, §8, §16
- **Description:** `accounts` has `email`, `display_name`, and `business_name`, while `BrandSummary` exposes only nullable `businessName`. The draft assumes account email stays required but does not define whose email it is in a shared-login tenant or which field is the canonical switcher label. It also does not define duplicate names, blank names, timezone validation, or initials.
- **Rationale:** User identity and brand identity are no longer one object. Reusing the creator's email makes the brand record misleading.
- **Impact:** Admin forms and downstream notifications may store the wrong contact. The switcher can show blank or indistinguishable brands.
- **Recommended action:** Define the account fields as brand fields. Make a non-empty canonical brand name required, define a separate optional operational/contact email if needed, validate IANA timezones, and specify duplicate-name display using a secondary identifier. Update `BrandSummary` accordingly.
- **Open questions:** Is `display_name` or `business_name` canonical? Where is `accounts.email` currently used for notifications?

### F-19 — Audit FKs on `created_by` can block user deletion

- **Priority:** P1
- **Type:** Data lifecycle
- **Relevant sections:** §4.1–4.2, §8
- **Description:** `account_members.created_by` and `app_admins.created_by` reference `auth.users` without an `ON DELETE` rule, so PostgreSQL defaults to `NO ACTION`. Deleting an admin who created rows can be blocked.
- **Rationale:** Historical actor fields should normally survive as nullable references or immutable text/UUID snapshots without controlling the target user's lifecycle.
- **Impact:** User removal can fail unexpectedly, including during Supabase admin cleanup.
- **Recommended action:** Use `ON DELETE SET NULL` for creator references and record actor IDs in the durable admin audit trail. Specify deletion behaviour for the target user's memberships and admin status.
- **Open questions:** Must deleted-user IDs remain queryable for compliance, even after the auth row is gone?

### F-20 — Cookie lifecycle requirements are incomplete and internally inconsistent

- **Priority:** P1
- **Type:** Security / session management
- **Relevant sections:** D7–D8, §5.6, §6.1
- **Description:** The cookie is said to be written only by `switchActiveBrand`, but the auth callback may also set it. The specification omits `Secure`, `Path`, expiry/max-age, deletion options, malformed UUID handling, cookie size assumptions, and whether login fallback should persist a replacement.
- **Rationale:** Cookie set and clear options must match. A stale or malformed value is expected after revocation, account deletion, environment changes, or a second login in the same browser.
- **Impact:** Cookies may not clear correctly, may be sent too broadly, or may produce repeated fallback work and inconsistent UX.
- **Recommended action:** Define one shared cookie constant and option set: HTTP-only, Secure in production, SameSite=Lax, Path=/, explicit lifetime, and matching deletion. Define all writers and fallback behaviour. Treat malformed/unknown values as untrusted input and log only safe context.
- **Open questions:** Should the selection last only for the browser session or for a fixed duration? Is subdomain sharing required?

### F-21 — Auth, no-access, and dependency failures are conflated

- **Priority:** P1
- **Type:** Resilience / error handling
- **Relevant sections:** §5.2–5.4, §9, §12
- **Description:** The current `getCurrentUser()` catches most unexpected errors and returns `null`. The draft does not replace this behaviour. A membership query outage could therefore look like logout, or a partial query could look like “no brands assigned.” The API proposal also maps missing active brand to 401.
- **Rationale:** Authentication failure, authorisation failure, and database failure require different handling and monitoring.
- **Impact:** Users may be redirected to login or `/no-access` during an outage, hiding the real problem and causing support confusion.
- **Recommended action:** Use typed outcomes or typed errors: unauthenticated, authenticated/no access, forbidden target, and dependency failure. Fail closed but show a retryable service-error page for dependency failures. Return consistent 401/403/5xx codes from route handlers.
- **Open questions:** What user-facing outage message and support path are approved?

### F-22 — Migration validation, backup, and rollback claims are insufficient

- **Priority:** P1
- **Type:** Migration / operations
- **Relevant sections:** §7, §10, §15
- **Description:** The draft calls the unique-constraint change reversible and low risk. It is only reversible while no user is linked as creator to multiple brands; after new brands exist, re-adding UNIQUE or rolling back to the old `.maybeSingle()` auth path can fail. The Meta backfill has no orphan assertion, and there is no backup, rehearsal, post-deploy validation, or abort threshold.
- **Rationale:** “No columns dropped” does not make a tenancy migration operationally reversible. Policy rewrites can deny or broaden access without changing data.
- **Impact:** Rollback may be impossible after first use. Orphaned rows can make the FK migration fail mid-release.
- **Recommended action:** Add a deployment runbook with a verified backup, staging rehearsal, preflight counts, orphan queries, expected backfill counts, policy diff, post-deploy smoke tests, and go/no-go gates. Define roll-forward recovery as the primary strategy after multi-brand data is created.
- **Open questions:** What is the production recovery point objective? Is a tested database restore available?

### F-23 — Super-admin bootstrap can silently leave the system without an administrator

- **Priority:** P1
- **Type:** Deployment / security
- **Relevant sections:** §5.5, §10 step 3
- **Description:** The migration seeds an admin by a hard-coded email using `INSERT ... SELECT`. If the email is absent or differs by case/configuration, the statement inserts zero rows without failing. The claim mirror is then a separate ops step.
- **Rationale:** Bootstrap is required to access the new admin surface and spans database and Auth API systems without a shared transaction.
- **Impact:** Production can deploy successfully but have no usable administrator, or table and claim state can disagree.
- **Recommended action:** Bootstrap by an explicitly supplied immutable user UUID in a one-time, idempotent ops command. Assert exactly one target, verify the table after write, update metadata only if retained, refresh/revoke sessions as required, and print a safe verification result. Document break-glass recovery.
- **Open questions:** Who runs bootstrap and where is the target UUID stored securely?

### F-24 — Policy rewrite detail is not sufficient for safe implementation

- **Priority:** P1
- **Type:** Database security
- **Relevant sections:** §7, §10
- **Description:** The table grouping is useful, but it is not an exact policy manifest. It does not specify each policy's command, roles, `USING`, `WITH CHECK`, existence, or expected final count. The alternative storage predicate casts the first path segment to UUID and can error for non-UUID objects. Admin bypass and service-role branches are not consistently justified.
- **Rationale:** Policy names and shapes have drifted between production, numbered migrations, the bridge, and the staged baseline. A broad template can accidentally alter insert/update semantics or miss child-table paths.
- **Impact:** Users may gain writes they should not have, lose valid access, or trigger query errors on storage objects.
- **Recommended action:** Generate and review a checked-in before/after policy manifest from `pg_policies`. Define every final policy explicitly, including roles and both expressions. Prefer the safe text folder comparison for storage unless UUID shape is guarded. Assert final policy count and forbidden old predicates after migration.
- **Open questions:** Should authenticated members be allowed to mutate data directly through Supabase, or should some tables be read-only outside service-role actions?

### F-25 — Performance and scale assumptions are missing

- **Priority:** P2
- **Type:** Performance
- **Relevant sections:** §5.2, §6.2, §7
- **Description:** `getCurrentUser()` is called repeatedly in a single render path today. The new version adds auth validation, admin lookup, membership load, account joins, and, for an admin, an unbounded load of every account on every request. RLS helpers may also run per row.
- **Rationale:** The live database has two accounts, but no target number of brands, memberships, content rows, or latency budget is stated.
- **Impact:** The design may work now but degrade sharply as the system grows. A very large brand list will also make the header menu unusable.
- **Recommended action:** State expected 12- and 24-month scale and an auth-resolution latency budget. Measure representative queries with `EXPLAIN ANALYZE`. Add request-scoped deduplication for auth context. Paginate/search admin lists and, if needed, the super-admin switcher.
- **Open questions:** What is the expected maximum number of brands per normal user and in the whole system?

### F-26 — Accessibility acceptance criteria are missing

- **Priority:** P2
- **Type:** Accessibility / UX
- **Relevant sections:** §6.2, §8, §12
- **Description:** The switcher is described visually but not behaviourally. Keyboard navigation, focus management, screen-reader labels, selected state, menu dismissal, pending state, error announcement, touch target size, and long-name handling are not specified. The same is true for destructive admin actions and `/no-access`.
- **Rationale:** A custom header menu and admin forms are high-interaction surfaces. There is no existing dropdown-menu dependency or component named in the spec.
- **Impact:** The feature can pass functional tests while being inaccessible or difficult to use on mobile.
- **Recommended action:** Add WCAG 2.2 AA acceptance criteria. Use an accessible menu/listbox primitive, expose the selected brand, support full keyboard operation, restore focus, announce switch errors, and require confirmation for destructive access changes.
- **Open questions:** Which supported browsers and assistive technologies must be tested?

### F-27 — Operational monitoring and support procedures are absent

- **Priority:** P2
- **Type:** Monitoring / operations
- **Relevant sections:** §8–§10, §12–§15
- **Description:** The draft does not define metrics, structured logs, alerts, dashboards, or support queries for membership denial, invalid active cookies, switch failures, zero-brand logins, admin mutations, invite failure, policy denial, or post-migration drift.
- **Rationale:** Tenancy incidents need fast diagnosis and reliable actor/brand context without logging secrets or raw tokens.
- **Impact:** Cross-brand or lockout problems may be found by users first and be difficult to trace.
- **Recommended action:** Define safe structured events and alerts before launch. Include correlation ID, actor ID, active brand ID, target brand ID, action, result, and reason; never log cookies, tokens, or service keys. Add a post-deploy watch period and support runbook.
- **Open questions:** Which existing log platform and on-call owner should receive these alerts?

## Optional improvements

### O-01 — Remove the mirrored super-admin claim

- **Priority:** P2
- **Type:** Optional improvement / simplification
- **Relevant sections:** D6, §5.2
- **Description:** The claim adds another state to update, refresh, test, and revoke.
- **Rationale:** The table lookup is indexed and already required for authoritative checks.
- **Impact:** Keeping both increases complexity with limited benefit at current scale.
- **Recommended action:** Use `app_admins` only until measured performance proves a claim is needed.
- **Open questions:** Is there a real client-only use case that cannot receive `isSuperAdmin` from the server?

### O-02 — Replace legacy `auth_user_id` instead of redefining it

- **Priority:** P2
- **Type:** Optional improvement / data-model clarity
- **Relevant sections:** §4.3
- **Description:** Retaining a column called `auth_user_id` as “created by” preserves misleading semantics throughout schema, scripts, and future code.
- **Rationale:** A clean `created_by_user_id` field makes the removal of 1:1 ownership explicit.
- **Impact:** Keeping the old name makes future single-tenant regressions more likely.
- **Recommended action:** Use an expand/backfill/contract migration and retire `auth_user_id` after the old app is no longer deployable.
- **Open questions:** Is any external report or integration reading `accounts.auth_user_id` directly?

### O-03 — Use a central tenant-scoped data-access layer

- **Priority:** P2
- **Type:** Optional improvement / maintainability
- **Relevant sections:** §3.2, §5.3, §9
- **Description:** Tenant filters are repeated across hundreds of calls, and the draft relies on manual review.
- **Rationale:** Service-role clients make a missed filter a security bug.
- **Impact:** Future features can reintroduce cross-brand access.
- **Recommended action:** Add shared helpers that require an `AuthContext` and always apply active-account scope, plus a lint/static-check rule for service-role use in user-triggered code. Keep escape hatches explicit for cron and global admin operations.
- **Open questions:** Can the repository enforce this gradually without rewriting all data access in one PR?

### O-04 — Prefer brand archive over hard delete

- **Priority:** P2
- **Type:** Optional improvement / lifecycle safety
- **Relevant sections:** §4, §7 accounts policies, §8
- **Description:** The model permits account deletion through RLS/service-role, and account deletion cascades through most brand data, but no user journey or retention policy is specified.
- **Rationale:** Accidental tenant deletion is much harder to recover than deactivation.
- **Impact:** A future admin UI could expose a highly destructive operation without safeguards.
- **Recommended action:** Add `archived_at`/status and remove hard delete from the first admin surface. Treat permanent deletion as a separate, audited, delayed operation.
- **Open questions:** Are there legal or contractual deletion requirements?

### O-05 — Use a searchable brand picker only when scale requires it

- **Priority:** P2
- **Type:** Optional improvement / UX
- **Relevant sections:** §6.2
- **Description:** A simple menu is best for a few brands but not for dozens or hundreds, especially for a global admin.
- **Rationale:** The expected scale is not stated.
- **Impact:** Building search now may be unnecessary; omitting it at high scale makes the switcher unusable.
- **Recommended action:** Set a threshold. Use the simple menu below it and a searchable command/listbox above it.
- **Open questions:** How many accounts will the super-admin see at launch?

## Specific wording changes recommended

These are targeted corrections, not a rewrite of the specification.

1. **§1, “every query already funnels ... through `requireAuthContext`”**

   Replace with: “Most service-role application paths use `requireAuthContext`, but anon-key, browser, realtime, storage, route-handler, and direct-ID paths require a full active-brand audit.”

2. **§4.3, keeping `auth_user_id` as creator with its FK**

   Replace with a requirement for `created_by_user_id ... ON DELETE SET NULL`, with `auth_user_id` retained only temporarily for deployment compatibility.

3. **§4.4, `current_account_id()` as cookie resolver**

   Replace with: “PostgreSQL does not receive the application active-brand cookie. Active brand is resolved in Next.js and passed as an explicit query scope; RLS enforces maximum membership access.”

4. **§8, revoke-active cookie behaviour**

   Replace with: “Revocation removes membership immediately. The revoked user's next protected request rejects the stale cookie and falls back to another membership or `/no-access`; an admin cannot directly clear another browser's cookie.”

5. **§10, reversible/destructive-op note**

   Replace “reversible” with: “The schema change is non-destructive, but rollback to the 1:1 application becomes unsafe after the first multi-brand row is created. Recovery is roll-forward unless a pre-change backup is restored.”

6. **§11, one new migration**

   Change to at least two forward migrations, matching the deployed PR phases.

7. **§13, booking conversion follow-up**

   Add: “This blocks onboarding any additional brand that uses booking-conversion attribution unless that feature is explicitly disabled for the brand.”

## Unconfirmed assumptions and decisions still required

1. Whether a global admin may operate all brand content without membership.
2. Whether there is exactly one immutable admin or several protected global admins.
3. Canonical brand name, brand contact email, and timezone validation rules.
4. Exact create-brand seed rows and whether the creator becomes a member.
5. Invite ordering, pending state, resend/cancel behaviour, and Auth email configuration.
6. Active-brand behaviour across tabs, unsaved forms, OAuth, and long-running requests.
7. Revocation guarantees for in-flight requests, signed URLs, queued jobs, and existing JWTs.
8. Expected account/membership scale and performance targets.
9. Brand archive/deletion and auth-user deletion policies.
10. Whether booking conversion routing is in launch scope or feature-gated.

## Key required changes before implementation

1. Define one active-brand enforcement model that works for service-role and anon-client paths.
2. Remove the idea that PostgreSQL reads the Next.js cookie.
3. Fix account/user deletion semantics before changing tenancy.
4. Bind every OAuth state to its starting brand and user.
5. Resolve the super-admin scope and last-admin rules.
6. Produce environment-safe, idempotent FK and policy migrations.
7. Replace atomic deployment with an expand-and-contract release plan.
8. Add real database, storage, migration, and end-to-end isolation tests.
9. Define transactional brand creation, complete invite journeys, and a global audit trail.
10. Add production preflight, backup, verification, rollback/roll-forward, and monitoring runbooks.

## Major risks

- Cross-brand data appearing in the wrong active-brand UI.
- Provider credentials being attached to the wrong brand.
- Whole-brand deletion when an original auth user is deleted.
- Production and clean-rebuild schemas behaving differently.
- Lockout caused by missing or self-removed super-admin access.
- Stale browser cache or cookies showing the prior brand after a switch or revoke.
- A deployment window where old and new tenancy assumptions coexist unsafely.
- Passing mocked tests while real RLS, storage, or FK behaviour is broken.

## Recommended next steps

1. Hold a short decision review for the four blockers: active-brand enforcement, super-admin scope, account creator lifecycle, and booking-conversion launch scope.
2. Update the specification with the targeted corrections and resolved open decisions.
3. Produce an exact tenancy path inventory and a generated before/after policy manifest.
4. Design an expand-and-contract release matrix and database test harness before implementation PRs begin.
5. Re-review the revised specification. It should not move to implementation until all P0 findings are closed and every P1 finding has an accepted requirement or delivery task.
