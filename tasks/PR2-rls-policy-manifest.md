# PR2 — RLS Policy Rewrite Manifest (Multi-Brand Tenancy)

**Read-only analysis artefact.** No migration is applied and no repo file other than this manifest is changed. This is the authoring source for the real PR2 migration.

- **Live Supabase project:** `nbkjciurhvkfpcpatbnt`
- **Query used:** `SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check FROM pg_policies WHERE schemaname IN ('public','storage') ORDER BY schemaname, tablename, policyname;`
- **Live policy count:** `SELECT count(*) FROM pg_policies WHERE schemaname IN ('public','storage')` → **104** (confirmed against enumeration below).

## PR1 foundation status in prod (checked live)

| Object | Exists in prod now? | Notes |
|---|---|---|
| `public.account_members` table | **No** (`to_regclass` = null, 0 columns) | Created by PR1 migration `20260714120000_multibrand_foundation.sql`. |
| `public.is_account_member(uuid)` | **No** | Created by PR1. |
| `public.is_super_admin()` | **No** | Created by PR1. |
| `public.current_account_id()` | **Yes** | STABLE plpgsql. Reads `auth.jwt()->'app_metadata'->>'account_id'`, then `user_metadata`, else falls back to `SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()`. **Returns `accounts.id`.** |

> PR2 must run **after** PR1 so the two helper functions and `account_members` exist. All `is_account_member(...)`/`is_super_admin()` references below assume PR1 is in place.

## Legend / shorthands

- **`SELF_SUBQ`** = the exact scalar subquery `( SELECT accounts.id FROM accounts WHERE (accounts.auth_user_id = auth.uid()))`.
- **`SR`** = the service-role branch `(auth.role() = 'service_role'::text)`.
- **Bucket** = classification (A–F) per the rules below.
- Where a policy is `cmd = ALL` with `with_check = null`, Postgres applies `USING` to the write check too; rewrites preserve that (USING only, no WITH CHECK) unless stated.

### Bucket rules

| Bucket | Trigger | Rewrite |
|---|---|---|
| **A** | Direct `account_id` column compared to `SELF_SUBQ` scalar subquery | predicate → `public.is_account_member(account_id)` |
| **B** | References `current_account_id()` (incl. inside an `EXISTS`/join) | `... current_account_id()` → `public.is_account_member(<the account_id being compared>)`; keep any `SR OR` branch verbatim |
| **C** | `accounts` self-policies | SELECT → `id IN (SELECT account_id FROM account_members WHERE user_id = auth.uid()) OR public.is_super_admin()`; INSERT/UPDATE/DELETE → `public.is_super_admin()` |
| **D** | Child table whose predicate inlines `SELF_SUBQ` inside a parent subquery | rewrite the **inner** predicate to `public.is_account_member(<parent>.account_id)` |
| **E** | `storage.objects` media-bucket account scoping | `(storage.foldername(name))[1] IN (SELECT account_id::text FROM public.account_members WHERE user_id = auth.uid()) OR public.is_super_admin()` (TEXT compare, no uuid cast) |
| **F** | No tenancy predicate to change (service-role-only, `created_by = auth.uid()`, public `WITH CHECK (true)` inserts, global read) | **No change** |

## Bucket counts (sum = 104)

| Bucket | Count |
|---|---|
| A — scalar `SELF_SUBQ` on direct `account_id` | 49 |
| B — `current_account_id()` (direct + EXISTS/join) | 23 |
| C — `accounts` self-policies | 7 |
| D — child subquery inlining `SELF_SUBQ` | 10 |
| E — `storage.objects` media bucket | 5 |
| F — no change | 10 |
| **Total** | **104** |

---

## Bucket A — direct `account_id = SELF_SUBQ` → `public.is_account_member(account_id)` (49)

All rows below are `schema = public`, `roles = {public}`. Current predicate is `(account_id = SELF_SUBQ)` placed on `qual` for SELECT/UPDATE/DELETE and on `with_check` for INSERT. **Proposed predicate (same slot): `public.is_account_member(account_id)`.**

| Table | Policy | cmd | Slot changed |
|---|---|---|---|
| analytics_snapshots | analytics_snapshots_select | SELECT | qual |
| analytics_snapshots | analytics_snapshots_insert | INSERT | with_check |
| analytics_snapshots | analytics_snapshots_update | UPDATE | qual |
| analytics_snapshots | analytics_snapshots_delete | DELETE | qual |
| audit_log | audit_log_select | SELECT | qual |
| audit_log | audit_log_insert | INSERT | with_check |
| content_item_versions | content_item_versions_select | SELECT | qual |
| content_item_versions | content_item_versions_insert | INSERT | with_check |
| content_item_versions | content_item_versions_update | UPDATE | qual |
| content_item_versions | content_item_versions_delete | DELETE | qual |
| content_items | content_items_select | SELECT | qual |
| content_items | content_items_insert | INSERT | with_check |
| content_items | content_items_update | UPDATE | qual |
| content_items | content_items_delete | DELETE | qual |
| link_in_bio_profiles | link_in_bio_profiles_select | SELECT | qual |
| link_in_bio_profiles | link_in_bio_profiles_insert | INSERT | with_check |
| link_in_bio_profiles | link_in_bio_profiles_update | UPDATE | qual |
| link_in_bio_profiles | link_in_bio_profiles_delete | DELETE | qual |
| link_in_bio_tiles | link_in_bio_tiles_select | SELECT | qual |
| link_in_bio_tiles | link_in_bio_tiles_insert | INSERT | with_check |
| link_in_bio_tiles | link_in_bio_tiles_update | UPDATE | qual |
| link_in_bio_tiles | link_in_bio_tiles_delete | DELETE | qual |
| media_library | media_library_select | SELECT | qual |
| media_library | media_library_insert | INSERT | with_check |
| media_library | media_library_update | UPDATE | qual |
| media_library | media_library_delete | DELETE | qual |
| notifications | notifications_select | SELECT | qual |
| notifications | notifications_insert | INSERT | with_check |
| notifications | notifications_update | UPDATE | qual |
| notifications | notifications_delete | DELETE | qual |
| profiles | profiles_select | SELECT | qual |
| profiles | profiles_insert | INSERT | with_check |
| profiles | profiles_update | UPDATE | qual |
| profiles | profiles_delete | DELETE | qual |
| provider_rate_limits | rate_limits_select | SELECT | qual |
| provider_rate_limits | rate_limits_insert | INSERT | with_check |
| provider_rate_limits | rate_limits_update | UPDATE | qual |
| publish_attempts | publish_attempts_select | SELECT | qual |
| publish_attempts | publish_attempts_insert | INSERT | with_check |
| publish_attempts | publish_attempts_update | UPDATE | qual |
| publish_attempts | publish_attempts_delete | DELETE | qual |
| publish_jobs | publish_jobs_select | SELECT | qual |
| publish_jobs | publish_jobs_insert | INSERT | with_check |
| publish_jobs | publish_jobs_update | UPDATE | qual |
| publish_jobs | publish_jobs_delete | DELETE | qual |
| social_connections | social_connections_select | SELECT | qual |
| social_connections | social_connections_insert | INSERT | with_check |
| social_connections | social_connections_update | UPDATE | qual |
| social_connections | social_connections_delete | DELETE | qual |

---

## Bucket B — `current_account_id()` → `public.is_account_member(...)` (23)

`schema = public`, `roles = {public}`. Keep any `SR OR` branch verbatim. For EXISTS/join policies only the inner `<x>.account_id = current_account_id()` comparison changes.

### B.1 Direct `account_id` (service-role branch present) — current both slots `(SR OR (account_id = current_account_id()))`; new both slots `(SR OR public.is_account_member(account_id))`

| Table | Policy | cmd | Slots |
|---|---|---|---|
| ad_metrics_history | Ad metrics history accessible by account | ALL | qual + with_check |
| brand_profile | Brand profile accessible by account | ALL | qual + with_check |
| campaigns | Campaigns accessible by account | ALL | qual + with_check |
| content_items | Content items accessible by account | ALL | qual + with_check |
| content_templates | Content templates accessible by account | ALL | qual + with_check |
| link_in_bio_profiles | Link-in-bio profiles accessible by account | ALL | qual + with_check |
| link_in_bio_tiles | Link-in-bio tiles accessible by account | ALL | qual + with_check |
| media_assets | Media assets accessible by account | ALL | qual + with_check |
| notifications | Notifications accessible by account | ALL | qual + with_check |
| posting_defaults | Posting defaults accessible by account | ALL | qual + with_check |
| social_connections | Social connections accessible by account | ALL | qual + with_check |
| tournaments | Tournaments accessible by account owner | ALL | qual + with_check |

### B.2 Direct `account_id` (no service-role branch) — current `(account_id = current_account_id())`; new `public.is_account_member(account_id)`

| Table | Policy | cmd | Slots | Note |
|---|---|---|---|---|
| booking_conversion_events | Users can view their own booking conversions | SELECT | qual | Meta cluster (see FK reconciliation) |
| campaigns | Users can manage their own campaigns | ALL | qual (with_check null) | Duplicate of "Campaigns accessible by account" |
| meta_ad_accounts | Users can manage their own ad account | ALL | qual (with_check null) | Meta cluster |
| meta_campaigns | Users can manage their own meta campaigns | ALL | qual + with_check | Meta cluster |
| meta_optimisation_actions | Users can view their own optimisation actions | ALL | qual + with_check | Meta cluster |
| meta_optimisation_runs | Users can view their own optimisation runs | ALL | qual + with_check | Meta cluster |

### B.3 EXISTS / join over a parent table — rewrite inner `<parent>.account_id = current_account_id()` → `public.is_account_member(<parent>.account_id)`

| Table | Policy | cmd | Current (qual) | Proposed (qual) |
|---|---|---|---|---|
| ad_sets | Users can manage their own ad sets | ALL | `EXISTS (SELECT 1 FROM campaigns c WHERE c.id = ad_sets.campaign_id AND c.account_id = current_account_id())` | `EXISTS (SELECT 1 FROM campaigns c WHERE c.id = ad_sets.campaign_id AND public.is_account_member(c.account_id))` (with_check stays null) |
| ads | Users can manage their own ads | ALL | `EXISTS (SELECT 1 FROM ad_sets ads2 JOIN campaigns c ON c.id = ads2.campaign_id WHERE ads2.id = ads.adset_id AND c.account_id = current_account_id())` | `... WHERE ads2.id = ads.adset_id AND public.is_account_member(c.account_id)` (with_check stays null) |
| content_variants | Content variants accessible via parent | ALL | `(SR OR EXISTS (SELECT 1 FROM content_items ci WHERE ci.id = content_variants.content_item_id AND ci.account_id = current_account_id()))` (qual + with_check) | `(SR OR EXISTS (SELECT 1 FROM content_items ci WHERE ci.id = content_variants.content_item_id AND public.is_account_member(ci.account_id)))` (both slots) |
| publish_jobs | Publish jobs accessible via content | ALL | `(SR OR EXISTS (SELECT 1 FROM content_items ci WHERE ci.id = publish_jobs.content_item_id AND ci.account_id = current_account_id()))` (qual + with_check) | `(SR OR EXISTS (SELECT 1 FROM content_items ci WHERE ci.id = publish_jobs.content_item_id AND public.is_account_member(ci.account_id)))` (both slots) |
| tournament_fixtures | Fixtures accessible via tournament account | ALL | `(SR OR EXISTS (SELECT 1 FROM tournaments t WHERE t.id = tournament_fixtures.tournament_id AND t.account_id = current_account_id()))` (qual + with_check) | `(SR OR EXISTS (SELECT 1 FROM tournaments t WHERE t.id = tournament_fixtures.tournament_id AND public.is_account_member(t.account_id)))` (both slots) |

---

## Bucket C — `accounts` self-policies (7)

`schema = public`, `table = accounts`, `roles = {public}`.

| Policy | cmd | Current | Proposed |
|---|---|---|---|
| accounts_select | SELECT | qual `(auth_user_id = auth.uid())` | qual `(id IN (SELECT account_id FROM account_members WHERE user_id = auth.uid()) OR public.is_super_admin())` |
| Accounts readable by owner | SELECT | qual `(SR OR (id = current_account_id()))` | qual `(id IN (SELECT account_id FROM account_members WHERE user_id = auth.uid()) OR public.is_super_admin())` — **duplicate of accounts_select; recommend DROP rather than rewrite** |
| accounts_insert | INSERT | with_check `(auth_user_id = auth.uid())` | with_check `public.is_super_admin()` |
| Accounts insertable by owner | INSERT | with_check `(SR OR (id = current_account_id()))` | with_check `public.is_super_admin()` — **duplicate; recommend DROP** |
| accounts_update | UPDATE | qual `(auth_user_id = auth.uid())` | qual `public.is_super_admin()` |
| Accounts updatable by owner | UPDATE | qual + with_check `(SR OR (id = current_account_id()))` | `public.is_super_admin()` (both slots) — **duplicate; recommend DROP** |
| accounts_delete | DELETE | qual `(auth_user_id = auth.uid())` | qual `public.is_super_admin()` |

> **CAVEAT (behavioural change to confirm):** Bucket C makes INSERT/UPDATE/DELETE on `accounts` **super-admin only**. Ordinary account admins editing their own account row via the anon client would be blocked. If self-service account edits must remain, extend the UPDATE rewrite to `(public.is_super_admin() OR id IN (SELECT account_id FROM account_members WHERE user_id = auth.uid()))`. **Recommendation:** follow the spec (super-admin only) for INSERT/DELETE, but confirm the UPDATE intent with the product owner before shipping. The service-role branch is redundant on all of these (service_role bypasses RLS).

---

## Bucket D — child subquery inlining `SELF_SUBQ` (10)

`schema = public`, `roles = {public}`. Outer `IN (SELECT parent.id FROM parent WHERE parent.account_id = SELF_SUBQ)` → inner predicate becomes `public.is_account_member(parent.account_id)`.

| Table | Policy | cmd | Slot | Proposed predicate |
|---|---|---|---|---|
| content_media_attachments | content_media_attachments_select | SELECT | qual | `content_item_id IN (SELECT content_items.id FROM content_items WHERE public.is_account_member(content_items.account_id))` |
| content_media_attachments | content_media_attachments_insert | INSERT | with_check | same as above |
| content_media_attachments | content_media_attachments_update | UPDATE | qual | same as above |
| content_media_attachments | content_media_attachments_delete | DELETE | qual | same as above |
| token_vault | token_vault_select | SELECT | qual | `social_connection_id IN (SELECT social_connections.id FROM social_connections WHERE public.is_account_member(social_connections.account_id))` |
| token_vault | token_vault_insert | INSERT | with_check | same as above |
| token_vault | token_vault_update | UPDATE | qual | same as above |
| token_vault | token_vault_delete | DELETE | qual | same as above |
| link_in_bio_clicks | link_in_bio_clicks_owner_select | SELECT | qual | `profile_id IN (SELECT link_in_bio_profiles.id FROM link_in_bio_profiles WHERE public.is_account_member(link_in_bio_profiles.account_id))` |
| link_in_bio_page_views | link_in_bio_page_views_owner_select | SELECT | qual | `profile_id IN (SELECT link_in_bio_profiles.id FROM link_in_bio_profiles WHERE public.is_account_member(link_in_bio_profiles.account_id))` |

---

## Bucket E — `storage.objects` media bucket (5)

`schema = storage`, `table = objects`.

| Policy | cmd | roles | Current | Proposed |
|---|---|---|---|---|
| media_select | SELECT | {authenticated} | qual `(bucket_id = 'media' AND (storage.foldername(name))[1] = (SELECT accounts.id::text FROM accounts WHERE auth_user_id = auth.uid()))` | qual `(bucket_id = 'media' AND ((storage.foldername(name))[1] IN (SELECT account_id::text FROM public.account_members WHERE user_id = auth.uid()) OR public.is_super_admin()))` |
| media_insert | INSERT | {authenticated} | with_check (same shape as media_select) | with_check (same shape as proposed media_select) |
| media_update | UPDATE | {authenticated} | qual (same shape) | qual (same shape as proposed media_select) |
| media_delete | DELETE | {authenticated} | qual (same shape) | qual (same shape as proposed media_select) |
| media_read_by_account | SELECT | {public} | qual `(bucket_id = 'media' AND (SR OR starts_with(name, COALESCE(auth.jwt()->'user_metadata'->>'account_id','') || '/')))` | **Special case — JWT single-account, NOT a foldername compare.** Proposed: `(bucket_id = 'media' AND (SR OR (storage.foldername(name))[1] IN (SELECT account_id::text FROM public.account_members WHERE user_id = auth.uid()) OR public.is_super_admin()))`. **Recommend DROP and fold into `media_select`** — it is a redundant, multi-account-broken duplicate of the media SELECT path (JWT carries a single `account_id`, so multi-brand members would only read one account's objects). |

---

## Bucket F — NO CHANGE (10)

`schema = public` unless noted. These carry no tenancy predicate that the membership model touches.

| Table | Policy | cmd | roles | Predicate | Why no change |
|---|---|---|---|---|---|
| auth_rate_limits | Auth rate limits service only | ALL | {public} | `SR` (both slots) | Service-role only; RLS-bypassing system table. |
| management_app_connections | Management app connections service only | ALL | {public} | `SR` (both slots) | Service-role only. |
| worker_heartbeats | Worker heartbeats managed by service role | ALL | {public} | `SR` (both slots) | Service-role only. |
| oauth_states | OAuth states managed by service role | ALL | {public} | `SR` (both slots) | Service-role only. |
| oauth_states | oauth_states_select | SELECT | {public} | `(created_by = auth.uid())` | Scoped to the creating user, not account tenancy. |
| oauth_states | oauth_states_insert | INSERT | {public} | with_check `(created_by = auth.uid())` | User-scoped; no account_id semantics. |
| oauth_states | oauth_states_update | UPDATE | {public} | `(created_by = auth.uid())` | User-scoped. |
| link_in_bio_clicks | link_in_bio_clicks_service_insert | INSERT | {public} | with_check `true` | Public analytics ingest (anonymous click logging). |
| link_in_bio_page_views | link_in_bio_page_views_service_insert | INSERT | {public} | with_check `true` | Public analytics ingest (anonymous page-view logging). |
| user_auth_snapshot | User auth snapshot readable by authenticated | SELECT | {authenticated, service_role} | `true` | Intentionally global read for any authenticated user; no per-account scoping. |

> Note: `oauth_states.account_id` **does** have an FK to `auth.users(id)` (see below), but its RLS policies key off `created_by`, so no policy rewrite is needed. The FK itself is out of scope for the RLS rewrite; flag separately if PR2 also normalises `oauth_states.account_id`.

---

## Meta cluster — `account_id` column + FK audit (live)

Task hypothesis was "there should be NO `account_id` FK in prod — confirm." **That hypothesis is FALSE.** Live catalogue:

| Table | Has `account_id` column? | `account_id` FK count | FK target |
|---|---|---|---|
| meta_campaigns | Yes | 1 | **`auth.users(id)`** (`meta_campaigns_account_id_fkey`) |
| meta_ad_accounts | Yes | 1 | **`auth.users(id)`** (`meta_ad_accounts_account_id_fkey`) |
| meta_optimisation_actions | Yes | 1 | **`auth.users(id)`** (`meta_optimisation_actions_account_id_fkey`) |
| meta_optimisation_runs | Yes | 1 | **`auth.users(id)`** (`meta_optimisation_runs_account_id_fkey`) |
| ad_metrics_history | Yes | 1 | **`auth.users(id)`** (`ad_metrics_history_account_id_fkey`) |
| booking_conversion_events | Yes | 1 | **`auth.users(id)`** (`booking_conversion_events_account_id_fkey`) |
| ad_sets | **No** | 0 | n/a — scopes via `campaigns` join |
| ads | **No** | 0 | n/a — scopes via `ad_sets`→`campaigns` join |

**Implication:** on these 6 tables `account_id` currently stores an **auth user id**, not `accounts.id`. Because `current_account_id()` returns `accounts.id` (v2 path), today these policies only resolve if `accounts.id == auth_user_id` for the affected tenant (legacy v1 seeding where the account row's `id` equals the owner's user id). PR2 must **backfill `account_id` to the true `accounts.id` and re-point the FK before/with the policy rewrite**, otherwise `public.is_account_member(account_id)` will match zero `account_members` rows for any tenant where `accounts.id != auth_user_id`.

### Tables whose `account_id` FK already targets `public.accounts(id)` (21 — no FK reconciliation needed)

`analytics_snapshots, audit_log, brand_profile, campaigns, content_item_versions, content_items, content_templates, link_in_bio_profiles, link_in_bio_tiles, management_app_connections, media_assets, media_library, notifications, posting_defaults, profiles, provider_rate_limits, publish_attempts, publish_jobs, social_connections, tournaments` — all via `<table>_account_id_fkey → public.accounts(id)`.

> `oauth_states.account_id → auth.users(id)` also exists (7th FK to `auth.users`) but is not part of the Meta cluster and is not referenced by any RLS policy.

---

## REWRITE SEQUENCE NOTES

### 0. Ordering
1. **PR1 first** — `account_members`, `is_account_member(uuid)`, `is_super_admin()` must exist. Confirmed absent in prod today.
2. **Meta FK reconciliation + backfill** (below) **before** the Bucket B rewrites on the Meta cluster, so `account_id` holds real `accounts.id` when `is_account_member(account_id)` starts being enforced.
3. **DROP+CREATE policies** grouped by table (below). Rewriting = `DROP POLICY IF EXISTS "<name>" ON <schema>.<table>;` then `CREATE POLICY "<name>" ON <schema>.<table> FOR <cmd> TO <roles> [USING (...)] [WITH CHECK (...)];`. Preserve original `cmd`, `roles`, and the qual/with_check slot layout exactly (see per-bucket tables; keep `with_check` null where it was null).

### 1. Meta FK reconciliation (catalog-driven, idempotent)
For each of `meta_campaigns, meta_ad_accounts, meta_optimisation_actions, meta_optimisation_runs, ad_metrics_history, booking_conversion_events`:
1. **Dynamically drop** any FK on `account_id` whose target is `auth.users` (do not hard-code names; discover via `pg_constraint` where `contype='f'`, conrelid = table, referencing column = `account_id`, confrelid = `auth.users`). This tolerates prod/branch name drift.
2. **Backfill:** `UPDATE <t> SET account_id = a.id FROM public.accounts a WHERE a.auth_user_id = <t>.account_id AND <t>.account_id <> a.id;` (translate stored user-id → `accounts.id`; no-op where already equal). Guard for orphans: report any `<t>.account_id` with no matching `accounts.auth_user_id` before adding the new FK.
3. **Add named FK:** `ALTER TABLE <t> ADD CONSTRAINT <t>_account_id_accounts_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;` (choose the delete action to match sibling tables).
- `ad_sets` / `ads`: no `account_id` column — nothing to reconcile; their policies (B.3) are rewritten in place.

### 2. Policies to DROP+CREATE, grouped by table

- **accounts** (7): `accounts_select`, `accounts_insert`, `accounts_update`, `accounts_delete` (rewrite per Bucket C) + `Accounts readable by owner`, `Accounts insertable by owner`, `Accounts updatable by owner` (**recommend DROP without recreate** — duplicates of the `accounts_*` set).
- **ad_metrics_history** (1): `Ad metrics history accessible by account`.
- **ad_sets** (1): `Users can manage their own ad sets`.
- **ads** (1): `Users can manage their own ads`.
- **analytics_snapshots** (4): `analytics_snapshots_select/insert/update/delete`.
- **audit_log** (2): `audit_log_select/insert`.
- **booking_conversion_events** (1): `Users can view their own booking conversions`.
- **brand_profile** (1): `Brand profile accessible by account`.
- **campaigns** (2): `Campaigns accessible by account`, `Users can manage their own campaigns` (**duplicate ALL policies — recommend keeping one and dropping the other**).
- **content_item_versions** (4): `content_item_versions_select/insert/update/delete`.
- **content_items** (5): `Content items accessible by account` (B) + `content_items_select/insert/update/delete` (A) — overlapping ALL vs per-command; both permissive, safe to keep, consolidation optional.
- **content_media_attachments** (4): `content_media_attachments_select/insert/update/delete`.
- **content_templates** (1): `Content templates accessible by account`.
- **content_variants** (1): `Content variants accessible via parent`.
- **link_in_bio_clicks** (1 rewrite): `link_in_bio_clicks_owner_select` (leave `_service_insert` untouched — Bucket F).
- **link_in_bio_page_views** (1 rewrite): `link_in_bio_page_views_owner_select` (leave `_service_insert` — Bucket F).
- **link_in_bio_profiles** (5): `Link-in-bio profiles accessible by account` (B) + `link_in_bio_profiles_select/insert/update/delete` (A) — overlapping.
- **link_in_bio_tiles** (5): `Link-in-bio tiles accessible by account` (B) + `link_in_bio_tiles_select/insert/update/delete` (A) — overlapping.
- **media_assets** (1): `Media assets accessible by account`.
- **media_library** (4): `media_library_select/insert/update/delete`.
- **meta_ad_accounts** (1): `Users can manage their own ad account`.
- **meta_campaigns** (1): `Users can manage their own meta campaigns`.
- **meta_optimisation_actions** (1): `Users can view their own optimisation actions`.
- **meta_optimisation_runs** (1): `Users can view their own optimisation runs`.
- **notifications** (5): `Notifications accessible by account` (B) + `notifications_select/insert/update/delete` (A) — overlapping.
- **posting_defaults** (1): `Posting defaults accessible by account`.
- **profiles** (4): `profiles_select/insert/update/delete`.
- **provider_rate_limits** (3): `rate_limits_select/insert/update`.
- **publish_attempts** (4): `publish_attempts_select/insert/update/delete`.
- **publish_jobs** (5): `Publish jobs accessible via content` (B, content_item_id) + `publish_jobs_select/insert/update/delete` (A, account_id) — overlapping.
- **social_connections** (5): `Social connections accessible by account` (B) + `social_connections_select/insert/update/delete` (A) — overlapping.
- **token_vault** (4): `token_vault_select/insert/update/delete`.
- **tournament_fixtures** (1): `Fixtures accessible via tournament account`.
- **tournaments** (1): `Tournaments accessible by account owner`.
- **storage.objects** (4 rewrite + 1 recommended drop): `media_select`, `media_insert`, `media_update`, `media_delete` (Bucket E) + `media_read_by_account` (**recommend DROP**, fold into `media_select`).

### 3. Policies that MUST NOT be touched (Bucket F — 10)
- `auth_rate_limits`: `Auth rate limits service only`
- `management_app_connections`: `Management app connections service only`
- `worker_heartbeats`: `Worker heartbeats managed by service role`
- `oauth_states`: `OAuth states managed by service role`, `oauth_states_select`, `oauth_states_insert`, `oauth_states_update`
- `link_in_bio_clicks`: `link_in_bio_clicks_service_insert`
- `link_in_bio_page_views`: `link_in_bio_page_views_service_insert`
- `user_auth_snapshot`: `User auth snapshot readable by authenticated`

### 4. Post-rewrite verification
- Re-run the `pg_policies` dump; assert **0** remaining references to `current_account_id()`, to the `SELF_SUBQ` accounts subquery, and to `(auth.jwt()->'user_metadata'->>'account_id')` in the media bucket, outside the Bucket F set.
- Assert every `account_id` FK across the Meta cluster now targets `public.accounts(id)`.
- Smoke test with a member and a non-member of an account, plus a super-admin, against one table per bucket.
