# SPEC — Multi-Brand Tenancy (shared logins, per-brand access)

- **Version:** 2 (revised after independent developer review — see `tasks/REVIEW-SPEC-multi-brand-tenancy.md` and Appendix A)
- **Date:** 2026-07-14
- **Status:** Draft for review (v2 closes all P0/P1 findings; carries no unresolved blockers)
- **Complexity:** 5 / XL — ships as multiple PRs under an expand-and-contract release (see §14)
- **Verification:** every load-bearing claim checked against the live `cheersai2.0` DB (`nbkjciurhvkfpcpatbnt`) and the repo, including the review's six load-bearing findings (all confirmed).

---

## 1. Summary

Let one login access **many brands** and switch between them; one central super-admin (you) creates brands and grants access. A "brand" is a `public.accounts` row; content is already `account_id`-scoped.

**Key correction from v1 (review F-01):** isolation is **not** carried by the app in every path today. Most reads use the service-role client with an explicit `.eq('account_id', accountId)`, **but a handful of user-facing reads use the anon client and rely on RLS alone** (`src/lib/content/queries.ts`, `src/lib/media/resolve-thumbnails.ts`). That is harmless today (RLS resolves to your single owned account) but becomes a **cross-brand leak** the moment RLS is membership-based. So the design has two enforcement layers that must be kept in lockstep:

1. **RLS = the membership *ceiling*** (the maximum a login may ever touch): `is_account_member(account_id)`.
2. **Active-brand scope = the app-layer selector** (the *one* brand in play right now): a verified `activeAccountId` applied explicitly to **every** user-facing read and write — including the anon-client reads that currently have no filter.

RLS never selects the active brand (Postgres cannot see the app cookie — review F-02); it only bounds what is reachable.

---

## 2. Decisions

### From the product owner
| # | Decision | Choice |
|---|----------|--------|
| D1 | Permission granularity | **Access-only membership.** A member can do everything on a brand. No Viewer/Editor tiers. |
| D2 | Privileged role | **Global super-admin(s).** Create brands, create/assign users, grant/revoke access. |
| D3 | Multi-brand UX | **Switch one active brand at a time.** No combined cross-brand view — this applies to super-admins too. |
| D4 | Administration | **Central super-admin assignment.** New users see nothing until assigned. |
| D5 | Deliverable | This spec → implementation plan. |
| **D11** | **Super-admin data scope** | **God-mode: a super-admin may operate any brand without membership.** RLS ceiling ORs in `is_super_admin()`. They still operate **one active brand at a time** (D3); god-mode only means their reachable set is all brands. |
| **D12** | **Booking-conversion** | **Build per-brand ingestion now** (in-scope, not deferred). Brand-scoped, validated ingest routing; no free-form account id from the caller. |

### Adopted from the review (recommendations taken as decisions)
| # | Decision | Choice + why |
|---|----------|--------------|
| D6 | Super-admin storage | **`public.app_admins(user_id)` table, queried for every privileged decision.** (Review F-11/O-01: **drop the mirrored `app_metadata` claim** — it can't be revoked instantly and creates two sources of truth. Any client hint comes from the server-rendered `isSuperAdmin`, never a token claim.) |
| D7 | Active-brand transport | **HTTP-only cookie** (`cheersai_active_account`), written only by a server action, re-verified against membership every request. RLS does **not** read it (F-02). |
| D9 | Zero-brand UX | **`/no-access` route, outside the brand-required layout but behind auth** (F-12). |
| D13 | Brand deletion | **Archive-only** (`accounts.archived_at`); no hard-delete in the admin UI (O-04). Permanent deletion is a separate, audited, out-of-band operation. |
| D14 | Creator lifecycle | **Add `accounts.created_by_user_id` with `ON DELETE SET NULL`; stop using `auth_user_id` as ownership** (F-03/O-02). Deleting the original user must **not** delete the brand. |
| D15 | Deployment | **Expand-and-contract, no atomic app+DB step** (F-08). Feature-flag gates brand creation until the new auth path + policies are live. |
| D16 | Active-brand enforcement | **App-layer explicit `activeAccountId` scoping on every user-facing read/write; membership RLS as ceiling** (F-01/F-02). |

---

## 3. Current state (verified live, 2026-07-14)

### 3.1 Tenancy
- Tenant = `public.accounts`. Live columns: `id`, `email` (NOT NULL), `display_name`, `timezone` (NOT NULL), `created_at`, `updated_at`, `auth_user_id` (NOT NULL), `business_name`.
- **Strict 1:1** via `auth_user_id UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE` (`baseline.sql:49`) — the CASCADE is the F-03 hazard.
- **2 account rows live**, both `id == auth_user_id`. The whole schema "works" only because `accounts.id == auth_user_id == auth.uid()` collapse to one value; creating a brand with `id = gen_random_uuid()` breaks that — intentionally.
- No membership table, no roles, no RBAC helper.

### 3.2 Enforcement reality (the F-01 correction)
- `requireAuthContext()` returns a **service-role client (bypasses RLS)** + `accountId`; ~181 `.eq('account_id', accountId)` sites are the guard on that path.
- **Exceptions that rely on RLS alone (anon client, no `account_id` filter):** `src/lib/content/queries.ts` (`getContentById`, `getContentByAccount`, `getContentForCalendar` — called from the planner Server Component and `src/app/actions/content.ts:306`) and `src/lib/media/resolve-thumbnails.ts`. Browser/realtime reads (`use-realtime-feed.ts`, `notification-badge.tsx`) **do** filter `account_id`.
- **Consequence:** a full **tenancy-path inventory** is required (§5.7) — service-role, anon, browser/realtime, storage, route-handler, and object-ID paths — before the RLS rewrite lands.

### 3.3 RLS (verified counts)
- **104 live policies** (public + storage): **67 reference `auth_user_id`, 26 reference `current_account_id()`**; 39 public tables + 5 storage policies. ~93 rewrite to membership.
- `current_account_id()` (verified body): JWT `app_metadata.account_id` → `user_metadata.account_id` → `SELECT id FROM accounts WHERE auth_user_id = auth.uid()`. `STABLE`, **not** `SECURITY DEFINER`.

### 3.4 Function/trigger audit (complete)
- **Only `current_account_id()`** encodes the 1:1 assumption. Verified live: `sync_user_auth_snapshot()`, `purge_user_auth_snapshot()` (maintain `public.user_auth_snapshot`, a mirror of auth.users), and `inspect_worker_db_context()` **do not** reference `accounts`/`auth_user_id`. No trigger references the constraint being dropped.
- `public.user_auth_snapshot` exists and can back the admin user-list without paging `auth.admin.listUsers`.

### 3.5 Meta/paid-ads cluster (F-06 corrected)
- **Live prod:** these tables exist with RLS; **none has any `account_id` FK** (verified). `ad_sets`/`ads` have **no `account_id` column** (scoped via parent).
- **CI/local baseline** (`supabase/baseline/v1_baseline.sql`, staged into the migration chain by `.github/workflows/ci.yml`): **5 tables declare `account_id REFERENCES auth.users(id)`** — `booking_conversion_events:563`, `meta_ad_accounts:590`, `meta_campaigns:593`, `meta_optimisation_actions:596`, `meta_optimisation_runs:614` — and `20260609092541_ad_metrics_history.sql:11` creates the same on a new table.
- **Therefore:** prod has no FK, but a clean rebuild has `auth.users` FKs. The Meta migration must be **catalog-driven and idempotent** (detect+drop any `auth.users` FK, backfill, add named `accounts(id)` FK, assert the target) and tested on **both** a clean-baseline rebuild and a prod-shaped upgrade. The baseline generator should also be corrected so CI stops recreating the wrong FK.

### 3.6 OAuth binding (F-05 confirmed)
- Normal FB/IG flow: `initiateOAuthConnect` writes **no `account_id`** into `oauth_states` (`connections/actions.ts:61-65`); `completeOAuthConnect` attributes the token to the **session's active brand** at callback (`:91`, state lookup `:96-98` omits `account_id`). The Facebook **Ads** flow already binds `account_id` in state and reads it back (`actions-ads.ts:59-63`, `facebook-ads/callback/route.ts`).
- **Consequence:** the normal flow must also bind the starting brand (§5.6).

### 3.7 Provisioning & signup
- Self-serve signup disabled (`auth/signup/page.tsx` → `/login`). Users created out-of-band + linked by `scripts/ops/link-auth-user.ts`. `auth.admin.inviteUserByEmail`/`createUser` unused; `auth/confirm/route.ts` already handles `type: 'invite'`.
- `getCurrentUser()` **catches errors and returns `null`** (`server.ts:79-88`), so a DB outage looks like logout (F-21). Auto-provision on first login (`:65-78`) returns a fallback account even on insert failure.
- Single-brand hardcodes: `OWNER_ACCOUNT_ID`/`ensureOwnerAccount` (dormant in request path), and `BOOKING_CONVERSION_ACCOUNT_ID` (`booking-conversions/route.ts:98`).

### 3.8 Switcher surface
- `TopRail` (`top-rail.tsx:152-186`) has a hardcoded "The Anchor/TA" chip → the switcher slot. Nav is a flat static array with no gating (`app-nav.ts:25-41`). `layout.tsx:24-28` gates only on null user (F-12).

---

## 4. Target data model

### 4.1 `public.account_members`
```sql
CREATE TABLE public.account_members (
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id)     ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,   -- F-19
  PRIMARY KEY (account_id, user_id)
);
CREATE INDEX idx_account_members_user ON public.account_members(user_id);
```
RLS: `SELECT` where `user_id = auth.uid() OR public.is_super_admin()`; **mutations `is_super_admin()` only**. `FORCE ROW LEVEL SECURITY`.

### 4.2 `public.app_admins`
```sql
CREATE TABLE public.app_admins (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL    -- F-19
);
```
Locked down (revoke anon/authenticated; service-role writes). **No mirrored JWT claim** (D6). `FORCE ROW LEVEL SECURITY`.

### 4.3 `public.accounts` changes
- **Add** `created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL`; backfill from `auth_user_id`; stop using `auth_user_id` for ownership (D14/O-02).
- **Add** `archived_at timestamptz` (D13).
- **Add** `NOT NULL`, non-empty **canonical brand name** (see §4.6 / F-18).
- **Drop** the UNIQUE on `auth_user_id` (expand/contract: retire the column after the old app is undeployable).

### 4.4 Helpers (correct creation order — F-07)
```sql
-- 1) is_super_admin FIRST (is_account_member references it)
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_admins WHERE user_id = auth.uid());
$$;
REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_super_admin() TO authenticated, service_role;

-- 2) then is_account_member (membership ceiling; god-mode via is_super_admin)
CREATE OR REPLACE FUNCTION public.is_account_member(target uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
  SELECT public.is_super_admin()
      OR EXISTS (SELECT 1 FROM public.account_members
                 WHERE account_id = target AND user_id = auth.uid());
$$;
REVOKE EXECUTE ON FUNCTION public.is_account_member(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_account_member(uuid) TO authenticated, service_role;
```
Set explicit ownership; `SECURITY DEFINER` avoids recursion when other tables' policies call these while `account_members` is itself RLS-filtered.

`current_account_id()` is **removed from RLS** (F-02). Options: drop it, or keep only for a defined legacy transition. It is **not** the active-brand resolver.

### 4.5 `admin_audit` (global admin trail — F-15)
`audit_log.account_id` is NOT NULL + cascades to a brand, so it cannot hold brand-agnostic admin actions. Add:
```sql
CREATE TABLE public.admin_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,                 -- snapshot, no FK cascade
  action text NOT NULL,               -- create_brand | invite_user | assign_member | revoke_member | grant_admin | revoke_admin | archive_brand
  target_user_id uuid,
  target_account_id uuid,             -- nullable (global actions)
  detail jsonb,                       -- before/after, reason, correlation_id
  result text NOT NULL,               -- success | failure
  created_at timestamptz NOT NULL DEFAULT now()
);
```
Survives brand deletion (no cascading FK). Never logs secrets/tokens (F-27).

### 4.6 Brand identity (F-18)
- `accounts` fields are **brand** fields, not user fields. Define **`business_name` as the canonical, required, non-empty switcher label**; `display_name` deprecated for labelling. `email` becomes an **optional operational/contact** field (document current notification uses before repurposing). Validate `timezone` as an IANA zone. Duplicate names shown with a secondary identifier. `BrandSummary` carries `{ accountId, name, timezone }`.

---

## 5. Auth-core changes (`src/lib/auth/`)

### 5.1 Types
`BrandSummary = { accountId; name; timezone }`. `AppUser`: `accountId` → alias of `activeAccountId: string | null`; `businessName`/`timezone` from the active brand; **new** `brands: BrandSummary[]`, `isSuperAdmin: boolean`. `AuthContext` gains `activeAccountId`, `brands`, `isSuperAdmin`.

### 5.2 `getCurrentUser()`
Resolve `isSuperAdmin` (query `app_admins`, no claim). Load membership set (service-role) → `brands[]`; **super-admin loads brands paginated/searchable** (§13 perf), not an unbounded list into the switcher. Read + membership-verify the active-brand cookie; else default (D8). Set brand-derived fields. **Remove auto-provision.** Wrap in **request-scoped memoization** (`React cache()`) to avoid N repeat lookups per render (F-25).

### 5.3 Error taxonomy (F-21)
Replace "catch → null" with typed outcomes: `unauthenticated` → `/auth/login`; `authenticated_no_brand` → `/no-access`; `forbidden_target`; `dependency_failure` → **retryable service-error page, fail closed, do not masquerade as logout**. Route handlers return **401 (unauth) / 403 (authed, no membership) / 5xx (dependency)** — never 401 for a logged-in, brand-less user (F-12).

### 5.4 `requireAuthContext()` / `resolveActiveBrandId(request)`
`requireAuthContext`: unauth → `/auth/login`; `activeAccountId === null` → `/no-access`; returns the verified active brand only, plus an assertion helper rejecting any caller-supplied `accountId` ≠ active/∉ membership. `resolveAccountId` → `resolveActiveBrandId(request)` (reads cookie, verifies membership); fix `generate-stream/route.ts:19,63` to use it via a shared `requireApiAuthContext(request)`.

### 5.5 Provisioning
Remove auto-provision from login; repurpose insert into the transactional create-brand flow (fresh uuid). First super-admin via a one-time **UUID-based** ops command (F-23), not an email `INSERT…SELECT`.

### 5.6 OAuth binding (F-05)
Every `oauth_states` row (normal flow included) stores verified `account_id`, initiating `user_id`, provider, expiry, single-use flag. Callback uses the **stored** brand, **re-checks membership**, fails safe if revoked; never derives tenancy from the current cookie. Restrict the callback `next` param to local paths (F-14).

### 5.7 Tenancy-path inventory (F-01) — prerequisite artefact
Produce a checked-in inventory of every user-facing data path and its enforcement: service-role + explicit filter (OK), anon-client (must add `activeAccountId` scope — `content/queries.ts`, `resolve-thumbnails.ts`), browser/realtime (already filtered — keep), storage, route-handlers, object-ID lookups. Every anon-client user-facing read must take a verified `activeAccountId` and filter by it or a verified parent. Add a **central tenant-scoped read helper** and a **lint rule** flagging service-role/anon data access in user paths that omit account scope (O-03).

---

## 6. Active-brand selection, switcher, cache

### 6.1 `switchActiveBrand(accountId)` (server action)
Re-verify auth + **membership**; set the cookie (§6.4); `revalidatePath('/', 'layout')`. Sole cookie writer besides the login callback.

### 6.2 Switcher UX (`top-rail.tsx`) + accessibility (F-26)
Replace the hardcoded chip with an accessible menu/listbox `BrandSwitcher` (`useAuth().brands` + active): full keyboard operation, focus restore, `aria` selected state, pending/disabled state during the switch, error announcement, adequate touch targets, long-name handling. Single-brand → plain label, no menu. **Above a threshold (e.g. >12 brands, super-admin), a searchable command palette** (O-05). WCAG 2.2 AA acceptance criteria apply here, to destructive admin actions, and to `/no-access`.

### 6.3 Client cache isolation (F-16)
One **account-aware query-key factory**; every query + invalidation keyed by `activeAccountId`. On switch, **clear/remount the query client** then `router.refresh()`; disable the switch while pending; define unsaved-work handling; detect cross-tab cookie changes and refresh.

### 6.4 Cookie lifecycle (F-20)
Single shared constant + options: `HttpOnly`, `Secure` in production, `SameSite=Lax`, `Path=/`, explicit max-age, matching deletion options. All writers (switch action, login callback) and `signOut` clearing defined. Malformed/unknown values treated as untrusted → discarded, safe-logged only. **Revocation (F-10):** admin removes membership in DB immediately; the revoked user's **next** request rejects the stale cookie → fallback brand or `/no-access`. No remote cookie clearing is promised.

---

## 7. RLS rewrite (~93 policies) — manifest-driven (F-24)

**Do not rewrite from a template.** Generate a checked-in **before/after policy manifest from `pg_policies`** (live), define **every** final policy explicitly (command, roles, `USING`, `WITH CHECK`), and after migration **assert the final policy count and that no old predicate remains**. Ship as a forward migration that `DROP POLICY IF EXISTS … / CREATE POLICY …` by name (idiom-(A) policies are defined twice — numbered migration + bridge); guard dropped tables (`gbp_*`) with `IF EXISTS`.

| Group | Today | Rewrite |
|-------|-------|---------|
| `accounts` self | `auth_user_id = auth.uid()` | SELECT: `id IN (SELECT account_id FROM account_members WHERE user_id = auth.uid()) OR is_super_admin()`. INSERT/UPDATE/DELETE: `is_super_admin()`. |
| Direct-`account_id` tables (both idioms; verify each vs `pg_policies`) | scalar subquery **or** `current_account_id()` | `is_account_member(account_id)` |
| Embedded-subquery children (**edit directly**): `token_vault`, `content_media_attachments`, `link_in_bio_clicks/_page_views` owner_select | inner `… WHERE account_id = (SELECT id FROM accounts WHERE auth_user_id = auth.uid())` | inner `… WHERE is_account_member(<parent>.account_id)` |
| Meta cluster (`meta_campaigns`, `meta_ad_accounts`, `meta_optimisation_actions/runs`, `ad_metrics_history`, `booking_conversion_events`; children `ad_sets`/`ads`/`content_variants`) | `current_account_id()` (± `service_role OR`) | `is_account_member(account_id)` (keep `service_role OR`); children rewrite the `EXISTS(... parent.account_id …)` to `is_account_member(parent.account_id)` |
| `storage.objects` media bucket | `(storage.foldername(name))[1] = (SELECT id::text …)` | **text compare, no UUID cast** (F-24): `(storage.foldername(name))[1] IN (SELECT account_id::text FROM account_members WHERE user_id = auth.uid())` (+ `OR is_super_admin()`) |
| `oauth_states` (`created_by = auth.uid()`), public insert `WITH CHECK (true)` | — | **No change.** Listed explicitly. |

**Meta prerequisite (F-06):** catalog-driven per table — detect+drop any `account_id → auth.users` FK (present in CI baseline), backfill (`SET account_id = a.id FROM accounts a WHERE t.account_id = a.auth_user_id`), assert no orphans, add named `accounts(id)` FK, assert target. Test clean-rebuild **and** prod-shaped upgrade.

---

## 8. Super-admin admin surface

New `src/app/(app)/admin/**` behind an `admin/layout.tsx` `isSuperAdmin` gate (server-checked; nav item filtered). Actions follow the project convention and **re-check `isSuperAdmin` server-side**; every mutation writes `admin_audit` (§4.5).

- **Multiplicity / lockout (F-04):** multiple admins allowed, with **last-admin protection** (cannot remove the final admin) and **self-removal guard** (an admin cannot revoke their own last admin grant). Bootstrap by UUID; **break-glass recovery documented**.
- **Create brand (transactional — F-13):** one idempotent DB function/RPC creating the account + exact seed rows in a single transaction; validate inputs first; return a stable result. **Define the seed contract precisely** (which of `profiles`/`posting_defaults`/`brand_profile`/placeholder connections are mandatory for first render; reconcile with `ensureOwnerAccount`, which seeds a different set). Under god-mode a brand may have zero members and still be operable by admins.
- **Invite / assign / revoke (F-14):** separate idempotent journeys for **"assign existing user"** vs **"invite new user"**; define pending status, resend, expiry, duplicate handling, partial-failure recovery (invite is a non-rollbackable remote side-effect — define ordering), disabled/removed users, safe local `next` redirect, and confirm Auth email templates/redirect allow-list. A membership must never exist for a user who never receives an invite (or the reverse must be a defined, visible state).
- **Archive brand (D13):** sets `archived_at`; hidden from switchers; no hard delete in-UI.

---

## 9. Security model
- Two layers, lockstep: **membership RLS = ceiling**, **app-layer `activeAccountId` = active selector** (§1). Every user-facing read/write scopes to `activeAccountId`; RLS bounds the reachable set (F-01/F-02).
- Cookie is a trust boundary → re-verified every request; god-mode never bypasses the active-brand *selection* (D3), only widens the ceiling.
- Super-admin actions re-checked server-side; never trust UI hiding or a token claim (D6).

## 10. Deletion / lifecycle (F-03, O-04, F-19)
- Deleting the original auth user **must not** delete the brand: ownership moves to `created_by_user_id … SET NULL`; `auth_user_id` FK action changed/retired before multi-brand creation is enabled. Add an explicit **auth-user-deletion test** (brand + content survive).
- Brand removal = **archive** (D13). `created_by` on membership/admin tables → `SET NULL` (F-19).

## 11. Blast radius (files)
DB: multiple forward migrations (see §14) — membership+admin+helpers+backfill; policy rewrite+`current_account_id` retirement+Meta FK; constraint drop; `admin_audit`. Auth core: `server.ts`, `types.ts`, `actions.ts`, `generate-stream/route.ts`. **Anon-read fixes: `src/lib/content/queries.ts`, `src/lib/media/resolve-thumbnails.ts`** (add active-brand scope). Switcher/shell/cache: `top-rail.tsx`, `auth-provider.tsx`, `layout.tsx`, `app-providers.tsx` (query keys), `/no-access`. Admin: `admin/**`, `app-nav.ts`. OAuth: `connections/actions.ts`, `api/oauth/[provider]/callback/route.ts`. Booking: `booking-conversions/route.ts`. Provisioning cleanup: `owner.ts`, `constants.ts`, `link-auth-user.ts`. ~35 `requireAuthContext` callers reviewed for 1:1 assumptions. ~181 `.eq('account_id')` sites unchanged.

## 12. Test strategy (F-09)
- **Real-DB integration tests** (not mocked): ≥2 users, 3 brands, overlapping memberships, a super-admin, a zero-brand user. Cover SELECT/INSERT/UPDATE/DELETE, parent-child policies, storage policies, invalid-object-ID access, OAuth state binding + revocation mid-flow, membership revocation latency, Meta FKs. Run on **clean-baseline rebuild AND prod-shaped upgrade**.
- **Vitest** unit: auth resolution (membership set, valid/invalid cookie, default, zero-brand, super-admin all-brands), membership guards, admin last-admin/self-removal, typed error outcomes.
- **Playwright:** switch, `/no-access`, invite acceptance, admin actions, mobile switcher, stale-cache prevention.
- CI: confirm Auth + Storage services available for RLS/storage tests, else a dedicated staging job.

## 13. Performance & scale (F-25)
State 12/24-month brand/membership targets and an auth-resolution latency budget. `EXPLAIN ANALYZE` representative queries. Request-scoped memoize auth context. **Paginate/search** admin lists and the super-admin switcher (god-mode can reach all brands). RLS helpers are `EXISTS`-based + indexed.

## 14. Release plan — expand-and-contract (F-08, F-22)
No atomic app+DB step. Compatibility matrix (DB-old/app-old → DB-new/app-old → DB-new/app-new; rollback) defined per stage. **Roll-forward is the primary recovery** once any multi-brand row exists (re-adding UNIQUE / reverting to `.maybeSingle()` becomes unsafe — reframe v1's "reversible").

1. **PR1 — Foundation (backward-compatible DB).** `account_members`, `app_admins`, `admin_audit`, helpers (`is_super_admin` then `is_account_member`), `accounts.created_by_user_id`/`archived_at`, backfill memberships (2 rows), super-admin bootstrap by UUID. App still reads 1:1. Deployable, no behaviour change.
2. **PR2 — Auth + isolation.** `getCurrentUser` membership + active-brand cookie, typed errors, `/no-access`, layout gate, anon-read active-brand scoping, switcher; **manifest-driven RLS rewrite + Meta FK reconciliation + `current_account_id` retirement + drop UNIQUE** (app+DB coordinated via the matrix, feature-flagged). 
3. **PR3 — Admin surface.** create-brand (transactional), invite/assign/revoke journeys, archive, `admin_audit`; retire `OWNER_ACCOUNT_ID` seeding.
4. **PR4 — OAuth brand-binding + per-brand booking ingestion (D12).** Bind `account_id` in the normal OAuth flow; brand-scoped booking ingest routing.

**Migration runbook (F-22):** verified backup, staging rehearsal, preflight counts, orphan queries, expected backfill counts, before/after policy diff, post-deploy smoke tests, go/no-go gates, RPO stated, tested restore.

## 15. Monitoring (F-27)
Structured events + alerts for: membership denial, invalid active cookie, switch failure, zero-brand login, admin mutations, invite failure, policy denial, post-migration drift. Fields: correlation id, actor id, active brand id, target brand id, action, result, reason — **never** cookies/tokens/keys. Post-deploy watch window + support runbook.

## 16. Assumptions
- Super-admins (god-mode) still operate one active brand at a time (D3); their reachable ceiling is all brands.
- Existing 2 accounts each become a brand; you are seeded super-admin by UUID.
- `business_name` is the canonical brand label; `accounts.email` repurposed only after auditing current notification use.

---

## Appendix A — Review disposition (`REVIEW-SPEC-multi-brand-tenancy.md`)

**Verified against code/DB (all confirmed):** F-01, F-03, F-05, F-06 (mechanism confirmed; table list corrected — `ad_sets`/`ads` have no `account_id`, 5 Meta tables carry the CI-baseline `auth.users` FK), F-12, F-15, F-21.

| Finding | Disposition | Where |
|---|---|---|
| F-01 anon reads leak | **Accepted** — app-layer active-brand scope + inventory + lint | §1, §3.2, §5.7, §9, §11 |
| F-02 PG can't read cookie | **Accepted** — `current_account_id` removed from RLS; app resolves active brand | §1, §4.4, §5.4 |
| F-03 cascade deletes brand | **Accepted** — `created_by_user_id … SET NULL` | D14, §4.3, §10 |
| F-04 super-admin scope | **Decided (D11 god-mode)** + last-admin/self-removal guards | D11, §8 |
| F-05 OAuth mis-binding | **Accepted** — bind brand at initiation, re-check at callback | §5.6, PR4 |
| F-06 CI-baseline FK divergence | **Accepted (list corrected)** — catalog-driven idempotent migration + both rebuild tests | §3.5, §7 |
| F-07 DDL order/privileges | **Accepted** — `is_super_admin` first; REVOKE/GRANT; FORCE RLS | §4.4 |
| F-08 non-atomic rollout | **Accepted** — expand-and-contract matrix | D15, §14 |
| F-09 test plan | **Accepted** — real-DB integration + Playwright | §12 |
| F-10 remote cookie clear | **Accepted** — DB revoke + reject stale cookie next request | §6.4 |
| F-11 mirrored claim | **Reframed → drop the mirror** | D6 |
| F-12 zero-brand shell/401 | **Accepted** — `/no-access` gates layout; typed 401/403 | D9, §5.3 |
| F-13 brand creation atomicity | **Accepted** — transactional RPC + seed contract | §8 |
| F-14 invite journeys | **Accepted** — separate idempotent journeys | §8 |
| F-15 audit helper | **Accepted** — `admin_audit` table | §4.5 |
| F-16 client cache | **Accepted** — account-aware keys + clear on switch | §6.3 |
| F-17 booking attribution | **Decided (D12) — build per-brand now** | D12, PR4 |
| F-18 brand identity fields | **Accepted** — brand-field semantics, required name | §4.6 |
| F-19 created_by FK | **Accepted** — `ON DELETE SET NULL` | §4.1–4.2 |
| F-20 cookie lifecycle | **Accepted** — single constant + options | §6.4 |
| F-21 error conflation | **Accepted** — typed outcomes | §5.3 |
| F-22 migration ops | **Accepted** — runbook + roll-forward | §14 |
| F-23 bootstrap | **Accepted** — UUID-based idempotent command | §5.5, §8 |
| F-24 policy manifest | **Accepted** — generated before/after manifest + asserts | §7 |
| F-25 performance | **Accepted** — targets, memoization, pagination | §13 |
| F-26 accessibility | **Accepted** — WCAG 2.2 AA criteria | §6.2 |
| F-27 monitoring | **Accepted** — structured events/alerts | §15 |
| O-01 drop claim | **Accepted** | D6 |
| O-02 replace `auth_user_id` | **Accepted** — expand/contract retire | §4.3 |
| O-03 central scoped DAL | **Accepted** — helper + lint rule | §5.7 |
| O-04 archive over delete | **Accepted** | D13, §10 |
| O-05 searchable picker | **Accepted** — threshold-based | §6.2 |

All P0 findings are closed in this design; every P1/P2 has an accepted requirement carried into the phased plan.
