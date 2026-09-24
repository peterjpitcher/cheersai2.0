# Review: new customer readiness

Review date: 24 September 2026. Developer-facing review of the supplied draft dated 24 September 2026. Read-only investigation; this report is the only file created by the review.

## Executive assessment

**Not ready for the affected implementation:** subscription enforcement, customer ownership, deletion and self-serve provisioning need defined lifecycle rules before implementation. The staged direction is sensible, and targeted Stage 1 corrections and external-access verification can proceed independently. Implementing the draft literally would not reliably deliver a paying customer who can publish, recover from payment problems and leave without stranded adverts or data.

The most consequential gaps are:

1. A login-level billing gate cannot hold background publishing and could remove the customer's ability to pause adverts that continue spending on Meta.
2. Stripe event handling, checkout recovery and the relationship between subscription status, complimentary access and suspension are not sufficiently defined.
3. Roles, concurrent usage limits and brand deletion affect existing service-role operations, storage and external systems beyond the proposed screens and tables.
4. Removing Anchor wording does not supply another venue's tournament opening-hours integration. The proposed management integration changes also alter a deliberate security boundary.
5. Several discovery claims need narrowing. Tournament uploads use service-role access, storage policies are present live, acceptable-use terms already exist, and privacy rights can already be requested by email.

No P0 is assigned. These are substantial but containable design and release issues. P1 means resolve at the stated gate, not stop unrelated work. Production readiness is **insufficient evidence to assess**: no customer journey, payment, publish operation or destructive operation was executed in this review.

## Outcome, users and scope

The intended outcome is a UK hospitality business becoming a paying CheersAI customer and publishing to its own Facebook or Instagram account without operator help. Stage 2 separately aims to support an assisted paying customer. Today the application is an operator-managed multi-brand tool, with The Anchor as its principal customer.

Affected people include prospective owners, existing invited users, staff members, owners of several brands, the operator/super-admin, people asking for data deletion, venue customers represented in conversion data, and finance/support staff. Meta, Stripe, Supabase, Resend, OpenAI, Upstash and Vercel are dependencies rather than interchangeable implementation details.

The UK/London-only boundary, two roles and Facebook/Instagram-only scope are reasonable. Food campaigns are feature-flagged off by default; they are not automatically a universal onboarding blocker. Paid ads and tournaments can be outside an initial commercial offer, but their existing users and background processes still need regression protection.

This is a discovery draft. The decision supported is which work is sufficiently specified to build, and what must be settled before implementing the affected areas. It is not a security certification, legal opinion or approval to charge, publish or deploy.

## Evidence and limitations

### Materials actually reviewed

- Both supplied attachments: the review brief and the complete specification. The repository copy at `tasks/SPEC-new-customer-readiness.md` was also inspected; the supplied attachment is the review baseline.
- Local checkout `main`, HEAD `1b0f54b3a6b77786285b8eeb10500f1e93449cb7`. Existing changes were `tasks/lessons.md` and an untracked specification. Neither was modified.
- Workspace and project `CLAUDE.md`, workspace Supabase rules, the Supabase skill, `tasks/lessons.md`, relevant parts of `docs/cheersai-rebuild-prd.md`, `tasks/SPEC-multi-brand-tenancy.md` and the agent reference.
- Auth server, membership, actions, types, callbacks, rate limits, admin actions and dormant proxy; social deletion and OAuth configuration; thumbnail resolution; management artwork and tournament screening; AI entry points; publishing scheduler, worker and state machine; paid-ad publication/pause and OAuth; media deletion; conversion retries; notification routing; privacy/terms; migrations, package scripts, CI and Playwright configuration. Existing auth, publishing, campaign and admin test files were inventoried, not executed as a full suite.
- Read-only live SQL against `nbkjciurhvkfpcpatbnt`: relevant column metadata, account counts, storage policies and the content-variant policy. Confirmed one auth user, three accounts, one archived account, one membership and one super-admin. No `subscriptions` or `usage_counters` table appeared in the queried public schema. Membership currently has no role column; brand profile has no website/menu/booking fields.
- Live unauthenticated HTTP GET checks: `/` and `/auth/signup` ultimately returned the login page; `/signup`, `/register`, `/pricing` returned 404; `/privacy` and `/terms` returned 200. Python's local certificate store failed initially; curl succeeded with normal certificate verification. This was a local tooling issue, not evidence of a site certificate fault.
- Current primary references: [Stripe webhooks](https://docs.stripe.com/webhooks), [subscription events](https://docs.stripe.com/billing/subscriptions/webhooks), [subscription overview](https://docs.stripe.com/billing/subscriptions/overview), [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates), [Next.js proxy placement](https://nextjs.org/docs/app/api-reference/file-conventions/proxy), and [ICO storage/access exceptions](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-the-exceptions/).

### Limits on conclusions

Meta App Dashboard approvals, Supabase Auth dashboard settings and actual email templates, Stripe configuration, monitoring dashboards and the deployed application revision were not inspected. Public HTTP results do not establish browser behaviour or match the live application to local HEAD. Meta documentation and the Supabase changelog URL could not be retrieved by the web tool. No live token values, customer content or email addresses were queried. No permission exploit was attempted.

Live policy presence does not establish grants, every constraint or behavioural isolation. The existing test suite was not run because the task is a specification review with no implementation changes; this report does not claim CI or runtime success. Absence from this report means unassessed, not absent from the system.

### Corrections to the draft's baseline

| Claim | Evidence and correction |
| --- | --- |
| T3: ordinary users' tournament uploads are rejected by membership storage rules | `src/app/actions/tournament-images.ts:43,75-77` gets the service-role client through `requireAuthContext()`. That client bypasses RLS. The path is inconsistent with the membership convention, but the claimed upload failure is not established. Test direct session access and service-mediated upload separately. Preserve old stored paths when changing new writes. |
| I2: storage membership rules may not be live | The live catalogue contains `media_select`, `media_insert`, `media_update`, `media_delete`, using account-prefix membership or super-admin checks. Presence is confirmed; ordinary-user access still requires tests. |
| L1: no way for a customer to request deletion/export | The privacy page already directs rights requests to email. No self-service workflow was found. Operational fulfilment of emailed requests is unverified. Do not equate missing UI with missing rights. |
| L2: no acceptable-use terms | `src/app/terms/page.tsx` already has an Acceptable Use section. It may need commercial review, but it is not absent. |
| A5 versus project instructions | Project instructions say there is no proxy; `src/app/proxy.ts` exists. Its placement differs from Next.js's documented root/src convention. Moving it would activate broad authentication behaviour. Resolve via R15 rather than treating relocation as harmless housekeeping. |
| Core isolation holds; every cron loops across brands | This is too broad for the evidence collected. The draft itself identifies an unscoped signing path and a global conversion batch. Record verified paths and outstanding tests instead of a system-wide assurance. |
| Old PRD excludes billing/team access | Historical exclusion is confirmed. The new draft intentionally changes product scope; formally supersede the relevant exclusions when approved. The old document does not prohibit the new direction. |

## Wider impact and dependency map

| Input or event | Changed behaviour/data | Downstream dependency and consequence |
| --- | --- | --- |
| Verified signup or staff invite | Auth identity, account, membership, terms acceptance | Brand selection, recovery, ownership, billing contacts and all service-role actions. Partial provisioning needs resumption. |
| Checkout/payment event | Stripe mapping and local entitlement | Planner, generation, storage, queued publishing, ads, support and portal access. Event order and delayed delivery matter. |
| Billing lapse or operator suspension | Restrictions on a brand | Jobs already in QStash, legacy worker, recurrence, live Meta campaigns and published link pages. A UI gate is insufficient. |
| AI request or upload/import | Usage accounting | Campaign generation, media tagging, derivatives, tournament assets and external provider costs. Parallel requests can exceed naive counters. |
| Venue profile/integration change | Links, wording, hours and permitted origins | Saved drafts, generated artwork, scheduled posts, destination validation and server-side fetch security. Existing content is not automatically regenerated. |
| Meta revocation/deletion | Organic and ads credential state | All linked brands, queued publishes, campaign controls, retries and truthful deletion status. |
| Archive or hard deletion | Data and access lifecycle | Stripe, Meta, storage, public pages, conversion ingest, queues, backups, audit history and other brands belonging to the same person. |

## Findings, ordered by priority

Each entry states evidence, classification, action, owner/gate and verification. Suggested behaviour is a proposal, not an existing requirement.

### R01 [P1] Separate identity, membership and entitlement

**Type/domain:** missing contract; security, product and recovery. **Evidence:** confirmed omission in Stage 2.2; `src/lib/auth/server.ts:24-112`, `membership.ts` and `types.ts`. **Disposition:** required correction. **Priority rationale:** a literal gate can lock legitimate users out of recovery or affect the wrong brand.

The draft puts usability in `getCurrentUser()`, which currently resolves identity and the selected brand for every action. Define incomplete, trial, paid, grace, lapsed, comped, suspended and archived behaviour separately. Comped access is an application exception, not an ordinary Stripe status. Define precedence, including suspension overriding complimentary access. Do not remove a lapsed brand from the user's recoverable memberships or silently switch an open form to another brand.

**Action:** an explicit entitlement matrix for reads, chargeable writes, billing, export, support, brand switching and pause controls. Keep recovery available only to the appropriate authorised actor. **Owner/gate:** product owner and technical lead, before billing-gate implementation. **Verify:** one user with active and lapsed brands, stale forms after a brand switch, member versus owner portal access, suspension of a comped brand, and dependency failure distinct from logout.

### R02 [P1] Define publishing hold and release semantics across every worker

**Type/domain:** missing lifecycle; asynchronous delivery. **Evidence:** Stage 2.2; `src/app/api/cron/publish-scheduler/route.ts:71-101`, `src/lib/publishing/handler.ts:49-68,180-189`, `state-machine.ts:15-24`; project-documented legacy edge path. **Disposition:** required correction. **Priority rationale:** scheduled content can publish after entitlement ends, or stale content can flood out on renewal.

The scheduler and worker run independently of login. Specify a durable hold reason and entitlement checks before dispatch and before a provider side effect, including retries, tournament direct calls and the legacy worker. Decide how recurrence and new scheduled work behave while held. A provider call already in progress cannot be promised reversible cancellation.

**Proposed wording:** “A job blocked by entitlement remains visible with its reason and original schedule. Restoring access does not automatically publish overdue jobs; eligible future jobs resume, and overdue jobs require the agreed review or expiry policy.”

**Owner/gate:** technical lead plus product owner, before worker changes. **Verify:** lapse between dispatch and delivery; duplicate QStash delivery while held; renewal after the advertised event; suspension during a provider call; existing Anchor jobs unchanged.

### R03 [P1] Preserve control over externally running paid adverts

**Type/domain:** unresolved commercial lifecycle; external spend. **Evidence:** Stage 2.2/2.9; `src/app/(app)/campaigns/[id]/actions.ts:1201-1220,1348`. **Disposition:** required correction plus business decision. **Priority rationale:** blocking the application can leave real spend running without an accessible stop control.

Meta serves already-activated campaigns outside CheersAI. The pause action currently requires the same auth context that the proposed gate changes. Define whether lapse continues adverts or requests a pause, and retain an authorised stop-spend route in either case. Distinguish cancellation of CheersAI from cancellation of Meta advertising. Deletion must address active adverts before removing usable credentials, with visible failures and an operator recovery path.

**Owner/gate:** product owner, with technical lead, before billing and deletion design. **Verify:** lapse with active ads, permitted pause while restricted, failed Meta pause, and no false “paused” result. Do not describe a stored daily budget as a guaranteed bank-account spending ceiling; state exactly which configured limits the app enforces.

### R04 [P1] Resolve Stripe ownership, ordering and recovery

**Type/domain:** missing integration contract and contradiction; payments. **Evidence:** Stage 2.1-2.2 and Stage 3.2. **Disposition:** required correction. **Priority rationale:** paid-but-locked-out customers and duplicate subscriptions are foreseeable.

“Webhook is the only writer” conflicts with migration-created comped rows and leaves initial customer mapping and reconciliation unspecified. Define which fields Stripe owns and which the app owns. Enforce unique mapping to the authenticated brand and server-selected price; do not trust browser account IDs, amounts or a success return URL. Stripe documents duplicate delivery and non-guaranteed ordering: a valid signature alone is insufficient. [Stripe webhook guidance](https://docs.stripe.com/webhooks).

**Action:** durable event deduplication, retryable persistence, latest-state reconciliation, checkout idempotency and an operator repair path using the same update rules. Pin the supported Stripe API/event version. Define pending confirmation UX when the browser returns before the webhook, and recovery when payment succeeds but local persistence fails. Keep test and live IDs/secrets separate.

**Owner/gate:** billing engineer, before integration implementation. **Verify:** duplicate/reordered events, delayed webhook, DB outage after payment, repeated checkout submissions, abandoned checkout, replaced subscription and forged cross-brand identifiers. Acknowledge delivery only after durable acceptance; do not lose events through premature success responses.

### R05 [P1] The commercial offer is not specified enough to encode

**Type/domain:** unresolved decision; product and finance. **Evidence:** Stage 2 caps/statuses, Stage 3 trial and §4 exclusions. **Disposition:** decision required. **Priority rationale:** these choices control charge amounts, service promises and acceptance tests.

Prices, plan entitlements, trial duration/start/card requirement, grace duration/start, UK VAT treatment, currency, cancellation effective date, refund handling and plan-change behaviour are not agreed. UK-only does not settle UK tax treatment. Monthly storage “usage” is ambiguous: retained bytes and new monthly uploads are different things. Per-brand subscriptions are explicit, but additional-brand creation and repeat trial eligibility are not bounded.

**Action:** approve a compact offer table and lifecycle matrix, including displayed renewal/cancellation terms, invoice owner and portal capabilities. Hosted Stripe Checkout and portal can keep this small. A single launch plan without self-service plan switching is a viable simplification, subject to approval. No invented prices or limits are proposed.

**Owner/gate:** product owner/finance, before billing schema and pricing-page commitment. **Verify:** fixtures for every chosen boundary, including month-end, London clock changes, cancellation at period end and a downgrade while above capacity. Prices and terms must agree across page, Checkout and invoices.

### R06 [P1] Provisioning must be atomic locally and recoverable across services

**Type/domain:** missing lifecycle; signup/auth. **Evidence:** Stage 3.2; admin invitation currently sends before membership persistence in `src/app/(app)/admin/actions.ts:247-297`. **Disposition:** required correction. **Priority rationale:** an account can exist without usable membership or a customer can pay twice on retry.

“One server action” is not a database transaction. Specify transactional account plus owner creation, stable attempt identity and idempotent resumption across Auth, database and Stripe. Define handling for existing logins with no brand, existing members creating another brand, cancelled checkout, expired verification and opening links on another device. State where “incomplete” lives and how abandoned records are retired without deleting paid customers.

Stage 1 disables login-triggered user creation, while Stage 3 permits magic-link signup. Require a deliberate signup-specific path and enforce verification before ownership or chargeable access. Supabase signups are a public API capability once enabled; Turnstile only on the Next.js form must not be assumed to protect direct Auth API calls.

**Owner/gate:** auth engineer, before signup implementation. **Verify:** concurrent tabs, duplicate submit, identity succeeds/membership fails, checkout succeeds/response lost, existing email, expired/reused links, direct API abuse and unavailable rate limiter/challenge. Preserve clear retry instructions; alert dependency failures, not every user validation error.

### R07 [P1] Define ownership and authority before adding a role column

**Type/domain:** missing authorisation contract; team management. **Evidence:** Stage 2.4; live membership has no roles, auth context has no role, and the live membership predicate grants access without role tiers. **Disposition:** required correction. **Priority rationale:** owner-only screens do not secure existing service-role mutations.

Specify owner/member powers for invitations, removal, billing, domain configuration, token connections, advert spend, export and deletion. Define initial owners for existing brands, transfer, the last-owner rule and separate super-admin authority. `created_by_user_id` or legacy `auth_user_id` does not automatically mean the commercial owner. Staff may already have a login or belong to other brands.

**Action:** apply server-side role checks at sensitive operations and matching database controls where direct access is possible; audit role, billing and suspension changes. Invitations need expiry/revocation and recovery after partial membership failure. **Owner/gate:** product owner and security/technical lead, before team implementation. **Verify:** crafted member requests, simultaneous last-owner removal, invite to an existing user, membership revoked during an open session and no effect on unrelated brands.

### R08 [P1] Quotas need atomic accounting and complete coverage

**Type/domain:** incomplete control; cost and concurrency. **Evidence:** Stage 2.3; `src/app/actions/ai-generate.ts`, `src/lib/campaigns/generate.ts:471`, `src/lib/ai/media-tagging.ts:84`, library tagging actions. **Disposition:** required correction. **Priority rationale:** checks confined to one AI action leave chargeable paths uncontrolled.

Define a billable unit and period, then reserve capacity atomically before external work. Include campaign generation, regeneration and media tagging; document retry/partial-failure accounting. Cap inputs and model outputs as appropriate so a nominal request cap also bounds realistic spend. Existing human approval of generated content should remain; new plans must not silently authorise automatic publication.

For storage, cover direct uploads, imports, tournament assets and derivatives, concurrent reservations and orphan cleanup. Define retained-capacity behaviour after downgrade. For ad budgets, distinguish daily/lifetime, campaign versus brand aggregate, concurrent campaigns, edits and automated increases; perform checks on the server before Meta mutation.

**Owner/gate:** technical lead with owner-approved limits, before quotas. **Verify:** two calls competing for the last unit, paid API succeeds/local response fails, bypass entry points, simultaneous uploads, deletion releasing space and aggregate campaigns exceeding the agreed limit.

### R09 [P1] Deletion and export need a cross-system lifecycle

**Type/domain:** incomplete data lifecycle; privacy/operations. **Evidence:** Stage 2.6; `src/app/actions/media.ts:147-174`, account archive filtering in membership, current conversion retries and external workers. **Disposition:** required correction. **Priority rationale:** archive plus database deletion can leave billing, storage or external activity alive.

Specify request authorisation, immediate restrictions, cancellation/ads handling, delayed erasure, cancellation of the deletion request where supported, partial failure and completion evidence. Include originals, derivatives, queued work, integration credentials, public link pages/feeds, conversion ingest secrets, provider data, logs/backups and justified retained financial/audit records. Already-published social content needs an explicit boundary; do not promise erasure from Meta by deleting local rows.

Define export contents and format, include usable media where promised, exclude credentials and other brands, and use authorised expiring downloads. Deleting one brand must preserve another brand's access; deleting a login must not strand ownership.

**Owner/gate:** technical lead, operator and privacy adviser, before deletion implementation; retention decision before public terms. **Verify:** queued delivery during deletion, storage failure, subscription cancellation failure, multi-brand user, archived brand restore and honest progress/status. A staffed request-and-fulfilment process is a possible assisted-launch simplification, not an automatic legal conclusion.

### R10 [P1] Meta identity mapping must cover both credential stores and history

**Type/domain:** incomplete integration/privacy correction. **Evidence:** Stage 1.2; `src/app/api/social/delete-data/route.ts`; ads OAuth writes `meta_ad_accounts` at `src/app/api/oauth/facebook-ads/callback/route.ts:120-130`. **Disposition:** required correction. **Priority rationale:** fixing organic connections alone leaves an affected person's ads credentials outside the callback lifecycle.

Map app-scoped identity in organic and ads OAuth, account for one person connecting several brands and define treatment of historical unmapped credentials. Backfill only where identity is verifiable; otherwise use a controlled reconnection path. Deauthorisation and a deletion request are different operations. Reconnection and concurrent callbacks must not revoke a newer unrelated credential accidentally.

The current GET status returns `completed: true` for an arbitrary supplied code while POST cannot match the user to stored credentials. This is verified code behaviour, not a demonstrated live deletion incident. Replace it with recorded, truthful progress/outcome and idempotent handling, without disclosing personal data.

**Owner/gate:** integration engineer/privacy owner, before callback release. **Verify:** valid/invalid signatures, duplicate requests, unknown and historical identity, multiple brands, organic plus ads, partial deletion, reconnect races and unknown status codes.

### R11 [P1] Meta approval is a verification gate, not a proven failure

**Type/domain:** unresolved external dependency; delivery and onboarding. **Evidence:** M1 and actual scopes in `src/lib/connections/oauth.ts`; dashboard unavailable. **Disposition:** investigation required. **Priority rationale:** no amount of app coding compensates for unavailable production permissions.

Record the production app, mode, approved access for each actually needed organic/ads permission and a successful non-app-role user connection. Do not infer approval from repository silence or insist on unused permissions solely because the code requests them. Separate organic and paid access decisions. Document eligible Page/Instagram/ad-account setup and actionable failures for people lacking the necessary asset permissions.

**Owner/gate:** Meta app administrator, before promising the affected feature or customer pilot. **Verify:** real non-tester connects their own assets and performs the agreed controlled publish; separate paid-ad proof if ads are included. Preview OAuth callback registration and test assets must be ready first. No live publish or spend was authorised by this review.

### R12 [P1] Tournament support still depends on an Anchor-style hours source

**Type/domain:** hidden dependency; product completeness. **Evidence:** Stage 1 T2/T5/T6; `src/lib/tournament/screening-service.ts:10-35`, `src/lib/tournament/screening.ts:73`. **Disposition:** required design decision. **Priority rationale:** removing names and links alone does not make the advertised journey usable or factually correct.

Screening obtains hours from a configured management connection; absent/unavailable data becomes `hours_unknown`. The draft proposes hiding that connection panel for brands without a connection, but does not supply another hours source or a customer setup path. Venue name, menu and booking URL are insufficient facts for opening/kitchen claims.

**Action:** either define a supported source and operator provisioning for launch venues, or explicitly exclude the affected tournament workflow from the initial offer with a clear unavailable state. Do not fabricate default hours or weaken fail-closed checks. **Owner/gate:** product owner/integration lead, before committing to tournament availability. **Verify:** a non-Anchor venue without the management system, known closed hours, missing kitchen hours and DST/cross-midnight fixtures. Inspect all advertised tournament modes before claiming broad support.

### R13 [P1] Customer-configurable origins change the server-fetch trust model

**Type/domain:** design risk; security and integrations. **Evidence:** Stage 1 T1/T6; `src/lib/management-app/artwork-fetch.ts:1-21,95-115`. **Disposition:** required correction if per-connection origins are introduced. **Priority rationale:** the current security rationale relies on trusted, operator-controlled hosts.

The fetcher deliberately excludes DNS rebinding from its threat model because customers cannot control allowed hosts. A per-connection field is safe only if its writer and trust rules preserve that assumption or replace the controls. Distinguish advert destination URLs from server-fetched artwork origins. Define domain normalisation, permitted schemes, third-party booking hosts and who can change them; do not use permissive suffix matching.

**Action:** keep artwork origins operator-managed for the assisted launch, or explicitly design validation covering private destinations, DNS and redirects before customer control. Preserve size/time limits and no credential forwarding. **Owner/gate:** technical/security lead, before origin-setting implementation. **Verify:** unauthorised changes, subdomain lookalikes, redirects, oversized files and private-address destinations under the chosen trust model.

### R14 [P1] Tenant isolation needs release evidence and relationship validation

**Type/domain:** known unscoped code path plus unverified exploitability; security. **Evidence:** I1; `src/lib/media/resolve-thumbnails.ts:89-94` uses service-role media lookup without account filtering; live variant policy authorises through the parent content item. **Disposition:** required correction and verification. **Priority rationale:** signing a foreign media path could disclose another customer's media.

Thread the verified active account through content, attachment and media lookups, and reject foreign media references on writes as well as reads. Examine constraints and actual grants before claiming a reproducible exploit. An ID being difficult to guess is not authorisation. Existing signed URLs may remain usable until expiry, so revoked access must not be described as instantly recalling all downloaded links.

**Owner/gate:** security/technical lead, before second-customer release. **Verify:** two ordinary users with disjoint brands, one user in both brands selecting just one, foreign content/media IDs, v1/v2 relations, direct storage access, browser data paths and removed membership. Do not rely on the current sole super-admin fixture. Live policy presence resolves I2's catalogue uncertainty, not these behavioural tests.

### R15 [P1] Moving the dormant proxy can break machine endpoints

**Type/domain:** unsafe implementation alternative; compatibility. **Evidence:** Stage 1 A5; `src/app/proxy.ts` broad matcher and limited public prefixes. **Disposition:** required correction if moving it. **Priority rationale:** cron, OAuth, QStash and billing requests could be redirected to login.

The draft's suggested public paths omit machine endpoints already using their own authentication, including publishing delivery and future Stripe callbacks. Preserve their signature/secret checks rather than putting them behind browser sessions. The smallest change is to remove confirmed dead code after checking imports/tests and session refresh behaviour; moving it requires a full route-classification and refresh test. The documented Next.js placement is alongside `app`, not inside it. [Next.js reference](https://nextjs.org/docs/app/api-reference/file-conventions/proxy).

**Owner/gate:** auth lead, before proxy changes. **Verify:** expired session refresh plus unauthenticated machine requests reaching their own verification handlers, public legal/help pages and `/no-access`; authenticated pages remain protected.

### R16 [P1] Release tests and rollback do not yet match the risk

**Type/domain:** delivery gap; testing and recovery. **Evidence:** §3 independent-shipping/rollback claim and §5; `.github/workflows/ci.yml`, `playwright.config.ts`, `package.json`. **Disposition:** required correction. **Priority rationale:** a green job or application rollback cannot undo money, external publication or erased data.

Failing on missing E2E credentials is useful but insufficient: CI also supplies placeholder Supabase settings to the application. Define an isolated, seeded test environment, ordinary owner/member identities across two brands, verification mail capture, Stripe test data and webhook forwarding, OAuth callback configuration and cleanup. Keep routine CI deterministic; a controlled external integration release test can separately prove Meta access.

The stated stages are not universally independent: the entitlement gate needs existing-brand mappings, recovery UI, event handling and worker rules before activation. Use expansion migrations first, prove named comped brands and archived-state preservation, deploy compatible readers/writers, then activate. Do not indiscriminately comp every brand created during rollout. Add an explicit stop-new-signups/checkout procedure and event reconciliation during rollback. Existing stored media paths and provider identity history need compatibility handling.

**Owner/gate:** technical lead/QA/operator, before release plan approval. **Verify:** rehearse an upgrade with existing schedules and data, old/new application overlap, webhook arrival during rollback and a paid-but-unprovisioned repair. No full-suite build result substitutes for the customer path. Additive columns alone do not make external actions reversible.

### R17 [P2] Conversion fairness must preserve delayed-configuration recovery

**Type/domain:** regression in proposed remedy; analytics. **Evidence:** Stage 1 I3; `src/app/api/cron/retry-capi-conversions/route.ts:49-56,99-108`. **Disposition:** required refinement or explicit accepted loss. **Priority rationale:** avoiding starvation by excluding all `not_configured` rows removes an intentional recovery path.

The code deliberately retries after pixel/token setup. Use per-brand fairness with bounded retry/backoff or eligibility reactivation when configuration appears. Include `missing_match_keys` in the design, maintain consent and age limits, and preserve event identity so replay does not double-count conversions.

**Owner/gate:** integration engineer, before retry change. **Verify:** a large unconfigured brand alongside a configured brand, later configuration within the existing retry window, late match keys and duplicate deliveries. No live starvation incident was demonstrated.

### R18 [P2] Customer and operator notifications need defined recipients and ownership

**Type/domain:** overlooked dependency; operations. **Evidence:** Stage 2.5/2.8; `notify-failures` and `notify-expiring-connections` read `accounts.email`; `src/app/api/cron/token-health/route.ts:174-182` follows legacy `auth_user_id`. **Disposition:** required correction before assisted launch. **Priority rationale:** an assisted customer can miss a recovery message while the creating admin receives it.

Choose operational and billing recipients explicitly and update them on ownership changes. Distinguish operator alerts from customer preferences; customer opt-out must not suppress operational detection. Define responsible responder, alert deduplication, visible webhook lag/provisioning failures and recovery instructions. Axiom monitors may be sufficient; Sentry is not itself a requirement. Existing admin audit infrastructure can support interventions rather than adding a second generic framework.

**Owner/gate:** operator/product owner, before Stage 2 release. **Verify:** invite-created brand, ownership transfer, removed staff, failed email send, notification retries and a test alert arriving with actionable context and no secret/payment payload leakage.

### R19 [P2] Onboarding and public acceptance need recovery, accessibility and measurement

**Type/domain:** incomplete acceptance; UX and product. **Evidence:** Stage 2.5, Stage 3.1-3.2, §5. **Disposition:** required refinement before public release. **Priority rationale:** completing screens is not the same as activation without assistance.

The checklist should reflect persisted progress, support returning users and allow a venue with only one supported channel to succeed. Explain prerequisites before charging or starting a time-limited trial, including unavailable Meta access. Define loading, retry and pending-payment states, resend links, browser back/refresh and mobile/keyboard/screen-reader behaviour. Propose WCAG 2.2 AA for the new journey as a design target, subject to agreement, not a claim of certification.

Define a published post as provider-confirmed success, not merely queued. Capture a small funnel: verified signup, brand provisioned, checkout confirmed, channel connected, first successful publication. Use stable identifiers to avoid counting retries as customers. Track stuck paid accounts separately as an operational alert. Agree targets after the pilot; no numerical conversion target is inferred.

For public routes, use correct canonical host, title/share metadata, intentional authenticated redirects and no indexing of verification/payment-return pages containing transient identifiers. Marketing consent, if introduced, must be distinct from accepting service terms. Cookie requirements depend on the chosen analytics and its configuration; current ICO guidance includes conditional statistical-purpose exceptions, so a banner is not automatically required for every analytics implementation. [ICO guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-the-exceptions/).

**Owner/gate:** product/design lead, with privacy review for actual tracking, before public launch. **Verify:** Facebook-only customer, no eligible assets, lost verification email, refresh at each stage, keyboard/focus/error announcements, mobile layout and deduplicated funnel events.

## Material test matrix

These extend the draft's checks, not replace `npm run ci:verify` (which currently includes London and UTC test runs).

| Journey and starting actor | Trigger/failure | Required visible or verifiable outcome | Findings |
| --- | --- | --- | --- |
| New verified owner, no brand | Double submit; DB failure between account and membership | One recoverable provisioning attempt, no orphan ownership or duplicate charge | R04, R06 |
| Owner returning from Checkout | Payment complete, webhook late/DB unavailable | Pending confirmation with recovery; eventual correct access and operator detection | R01, R04 |
| Member of active and lapsed brands | Switch brand in another tab; submit stale form | No wrong-brand write; billing access respects owner role | R01, R07 |
| Scheduled job already dispatched | Lapse before delivery; repeat delivery | Durable visible hold; no new provider send while barred | R02 |
| Owner with a live campaign | Subscription lapse or suspension | Stop-spend remains available; external pause failure is visible | R03 |
| Brand with one quota unit remaining | Concurrent content and campaign generation | Agreed cap enforced atomically; retries accounted once under chosen rules | R08 |
| Ordinary owner using media | Foreign media reference and v1/v2 attachment paths | No foreign signed URL or cross-brand write | R14 |
| Invited owner/member | Existing email, expired link, removed access | Supported recovery without privilege escalation or access to another brand | R06, R07 |
| Non-Anchor venue without integration | Generate affected tournament copy | Honest unavailable state or supported verified hours; no Anchor facts | R12 |
| Deleting owner with multiple brands | Worker/Stripe/Meta/storage partial failures | One brand restricted, others intact; truthful erasure progress and retries | R03, R09, R10 |
| Existing Anchor schedules and assets | Expansion deployment then rollback | Comped access and history preserved; pending external effects reconciled | R16 |
| Many brands in conversion retries | Unconfigured backlog dominates | Configured brands progress; later eligible historical rows still recover | R17 |
| Authenticated and machine callers | Proxy change and session expiry | Browser recovery works; signed service calls reach their handlers | R15 |

Critical invariants: billing cannot grant membership; membership cannot grant owner-only billing powers; a brand's inputs cannot select another brand's provider account; one retry cannot create a second charge/subscription; held/deleting brands cannot start prohibited external work; restoring access cannot silently publish expired promotions; a completion message must describe completed work.

## Decision register

Open questions are kept in chat under the workspace rule. This register records the decisions still required, without treating recommendations as approved requirements.

| ID | Decision to record | Recommended owner | Due |
| --- | --- | --- | --- |
| D1 | Launch offer: assisted organic-only versus including ads/tournaments; treatment of unsupported integrations | Product owner | Before offer/design commitment |
| D2 | Price, UK VAT presentation, plan limits, trial/card rules, grace, cancellation/refunds, upgrades and additional-brand eligibility | Product owner and finance | Before billing model implementation |
| D3 | Lapse/suspension matrix, live-ad treatment and overdue post restoration | Product owner with technical lead | Before entitlement/worker changes |
| D4 | Owner/member powers, existing owner assignment and ownership transfer | Product owner | Before team authorisation |
| D5 | Retention, export contents, external data boundary and assisted versus automated rights fulfilment | Privacy adviser and operator | Before deletion implementation and terms approval |
| D6 | Management integration provisioning, hours source and control over artwork origins | Product owner and integration lead | Before Stage 1 integration changes |
| D7 | Production Meta permissions and eligible asset setup, verified separately for organic and ads | Meta app administrator | Before affected pilot release |
| D8 | Test environment, release activation sequence, monitoring responder and notification recipients | Technical lead and operator | Before release rehearsal |

No estimate is offered: external approvals and offer decisions are not evidenced sufficiently to estimate delivery responsibly.

## Simplification opportunities and optional improvements

- **Scope option, requiring approval:** an assisted organic-publishing pilot can validate the core value without making paid ads, tournaments or customer-run teams prerequisites. Preserve existing Anchor capabilities and clearly withhold unsupported customer features. This changes the offer, not the impact analysis.
- **Scope option:** one launch plan, hosted Checkout and portal, operator-managed integration origins, and a documented rights-request process reduce bespoke logic. They do not remove payment recovery, tenant isolation or entitlement requirements.
- **P3 optional:** a dedicated support alias is useful for continuity but the particular mailbox name is not a launch safety requirement. Verify the chosen address before publishing it.
- **P3 optional:** a welcome email can reinforce onboarding. Persisted, recoverable in-app guidance is the essential behaviour; do not make welcome-email delivery a prerequisite for access or duplicate messages on retries.
- Keep implementation choices with developers: exact table names, hold representation and monitoring vendor need not be prescribed once invariants and acceptance criteria are clear. Avoid a large entitlement platform for a small initial offer.

## Coverage and readiness

| Area | Review outcome |
| --- | --- |
| Product, journeys, ownership, billing and data lifecycle | Material findings above; design decisions outstanding |
| Auth, tenancy, media, server fetches and callbacks | Code and selected live metadata inspected; no penetration test or full live isolation proof |
| Background work, external ads and conversions | Material downstream effects identified; external execution not performed |
| UX, accessibility, public URLs and measurement | Acceptance gaps identified; no new UI exists to assess visually |
| Performance and cost | Quota/concurrency and global-batch issues reviewed; traffic assumptions, latency and capacity not measured. Pilot with representative upload/generation sizes and agreed concurrency before expansion; no arbitrary enterprise SLA imposed |
| Legal/privacy/UK finance | Existing text inspected and selected current ICO guidance checked; contract approval and tax decisions remain with qualified owners |
| Regression, environments, deployment and rollback | Material conditions identified; no build/deploy/migration performed |
| Encryption and provider signature standards | Existing shared requirements already address these; no separate generic redesign finding |
| GBP, non-UK timezone and multi-currency support | Explicitly excluded; no new support requirement imposed |
| Model evaluation and portability | Preserve existing approval controls; test neutral brand fixtures and cost paths. No model change, new training use or custom portability platform proposed |
| Meta approvals, live auth templates, monitoring and Stripe setup | Could not assess from available evidence; explicit verification gates |

**Specification readiness:** not ready for the affected billing, provisioning, team-authorisation and deletion implementation. Stage 1 neutral copy/profile work, scoped media corrections, auth-flow investigation and external approval checks can proceed after their local acceptance criteria are made explicit. R12/R13/R15 constrain the relevant Stage 1 changes, not all Stage 1 work.

**Conditions to change the verdict:** record D1-D6, incorporate the lifecycle contracts in R01-R10, settle the integration trust/dependency choices, and approve a testable rollout/recovery plan. D7 and real external journey evidence are release gates, not reasons to halt unrelated coding.

**Production readiness:** insufficient evidence to assess. Before release, execute the relevant test matrix with ordinary tenant identities, rehearse compatibility and recovery, verify Meta and billing configuration, demonstrate alert delivery, and run the actual assisted or self-serve customer journey against the intended environment. Stripe test mode alone does not validate live configuration. Any live payment, advert or publish validation needs separately authorised assets and actions.

Final challenge: even a competent literal implementation could still charge twice, block a customer who needs to stop ads, publish stale queued material after renewal, miss campaign/tagging AI costs, claim deletion before completing it, or leave another venue without hours data. The findings above address these concrete failure paths without expanding the product into an unrelated redesign.

**Done** - Separate specification review delivered, local only. No implementation, original specification, database, deployment or migration changed.
**Next:** Resolve the recorded decisions and amend the affected requirements before implementation; no implementation is authorised by this report.
