# Multi-Brand PR1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the backward-compatible database foundation for multi-brand tenancy (membership + super-admin + admin audit + accounts creator/archive columns), with zero application behaviour change and nothing destructive.

**Architecture:** One additive Supabase migration creates `app_admins`, `account_members`, `admin_audit`, the `is_super_admin()` / `is_account_member()` helper functions (created in that order so the second can call the first), and two additive columns on `accounts` (`created_by_user_id`, `archived_at`). It backfills one membership per existing account. It does **not** drop the `accounts.auth_user_id` UNIQUE constraint, does **not** rewrite any existing RLS policy, and does **not** touch application code — so the current 1:1 app keeps working unchanged (the "expand" phase of expand-and-contract).

**Tech Stack:** Supabase (PostgreSQL 17), SQL migrations under `supabase/migrations/`, verified via `supabase db lint` + assertion SQL on a Supabase preview branch (or local stack). No TypeScript changes in PR1.

**Source spec:** `tasks/SPEC-multi-brand-tenancy.md` v2 (§4.1, §4.2, §4.4, §4.5, §4.3, §10, §14 PR1). This is **PR1 of 4**; PR2–4 get their own plans.

**Safety gate:** the migration is authored and verified on a preview branch / locally, then **committed on a feature branch**. Applying it to the **production** database (`nbkjciurhvkfpcpatbnt`) is a separate, explicitly-approved step per the spec §14 runbook — do NOT `db push` to production without the owner's go/no-go.

---

## Design notes (read before Task 1)

- **Helper security model:** `is_super_admin()` and `is_account_member()` are `SECURITY DEFINER` with a pinned `search_path`, so they read `app_admins`/`account_members` as the function owner and are safe to call from other tables' RLS policies without recursion. The membership tables have **RLS enabled (not FORCED)** and **all table privileges revoked from `anon`/`authenticated`**, so the only read paths are (a) the service-role client and (b) the `SECURITY DEFINER` helpers. Defence-in-depth `SELECT` policies still scope any future anon-client read to the caller's own rows. (This is a deliberate refinement of spec §4.1's "FORCE ROW LEVEL SECURITY", which would force RLS onto the definer reads and add needless per-row cost; recorded here as the implementation decision.)
- **Order matters:** create `is_super_admin()` before `is_account_member()` (SQL functions resolve referenced functions at creation).
- **No `business_name NOT NULL` in PR1:** the live app's `autoProvisionAccount()` still inserts `business_name: null` until PR2 removes it, so tightening that column now would break login. The canonical-name constraint lands in PR2.
- **Super-admin bootstrap is by UUID, not email** (spec F-23): a separate idempotent ops script inserts the owner's `auth.users.id`. An email `INSERT … SELECT` can silently insert zero rows — forbidden.
- **Timestamp:** the newest existing migration is `20260629140000_remove_gbp_objects.sql`. Use a timestamp strictly greater than that and greater than "now" is not required, only monotonic. This plan uses `20260714120000`; **verify no collision** with `ls supabase/migrations/` before writing.

---

## File structure

- Create: `supabase/migrations/20260714120000_multibrand_foundation.sql` — the additive foundation migration.
- Create: `supabase/tests/multibrand_foundation_verify.sql` — assertion script (run after applying) confirming objects exist, backfill counts, and helper behaviour. (If `supabase/tests/` does not exist, create it; it is a scratch verification script, not wired into CI in PR1.)
- Create: `scripts/ops/bootstrap-super-admin.ts` — one-time idempotent super-admin seeding by UUID (mirrors the existing `scripts/ops/*.ts` style and service-role client usage in `scripts/ops/link-auth-user.ts`).
- Modify: none in `src/` (PR1 is DB-only).

---

## Task 1: Author the foundation migration

**Files:**
- Create: `supabase/migrations/20260714120000_multibrand_foundation.sql`

- [ ] **Step 1: Verify the timestamp does not collide**

Run: `ls supabase/migrations/ | sort | tail -5`
Expected: the newest is `20260629140000_remove_gbp_objects.sql` (or similar) and there is **no** `20260714120000_*` file. If a later date exists, bump the new timestamp above it.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260714120000_multibrand_foundation.sql` with exactly:

```sql
-- Multi-brand tenancy PR1: backward-compatible foundation.
-- Adds membership + super-admin + admin-audit infrastructure and additive
-- accounts columns. Does NOT rewrite existing RLS, does NOT drop the
-- accounts.auth_user_id UNIQUE constraint, and does NOT change app behaviour.
-- Safe to deploy ahead of the PR2 app/auth changes (expand phase).

begin;

-- 1) Super-admin registry --------------------------------------------------
create table if not exists public.app_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated;
-- defence-in-depth: a would-be anon/authenticated read only ever sees own row.
drop policy if exists app_admins_select_self on public.app_admins;
create policy app_admins_select_self on public.app_admins
  for select using (user_id = auth.uid());

-- is_super_admin() FIRST (is_account_member references it).
create or replace function public.is_super_admin()
returns boolean language sql stable security definer
set search_path = public, pg_catalog as $$
  select exists (select 1 from public.app_admins where user_id = auth.uid());
$$;
revoke execute on function public.is_super_admin() from public;
grant execute on function public.is_super_admin() to authenticated, service_role;

-- 2) Membership (access-only, no role tiers) -------------------------------
create table if not exists public.account_members (
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  primary key (account_id, user_id)
);
create index if not exists idx_account_members_user on public.account_members(user_id);
alter table public.account_members enable row level security;
revoke all on public.account_members from anon, authenticated;
drop policy if exists account_members_select on public.account_members;
create policy account_members_select on public.account_members
  for select using (user_id = auth.uid() or public.is_super_admin());

create or replace function public.is_account_member(target uuid)
returns boolean language sql stable security definer
set search_path = public, pg_catalog as $$
  select public.is_super_admin()
      or exists (select 1 from public.account_members
                 where account_id = target and user_id = auth.uid());
$$;
revoke execute on function public.is_account_member(uuid) from public;
grant execute on function public.is_account_member(uuid) to authenticated, service_role;

-- 3) Global admin audit trail (survives brand deletion) --------------------
create table if not exists public.admin_audit (
  id                uuid primary key default gen_random_uuid(),
  actor_user_id     uuid,
  action            text not null,
  target_user_id    uuid,
  target_account_id uuid,
  detail            jsonb,
  result            text not null default 'success',
  created_at        timestamptz not null default now()
);
alter table public.admin_audit enable row level security;
revoke all on public.admin_audit from anon, authenticated;
drop policy if exists admin_audit_select_admin on public.admin_audit;
create policy admin_audit_select_admin on public.admin_audit
  for select using (public.is_super_admin());

-- 4) accounts: additive creator + archive columns --------------------------
alter table public.accounts
  add column if not exists created_by_user_id uuid references auth.users(id) on delete set null;
alter table public.accounts
  add column if not exists archived_at timestamptz;
update public.accounts
  set created_by_user_id = auth_user_id
  where created_by_user_id is null and auth_user_id is not null;

-- 5) Backfill one membership per existing account --------------------------
--    Runs while accounts.auth_user_id is still UNIQUE NOT NULL, so exactly
--    one clean membership row per account.
insert into public.account_members (account_id, user_id)
select id, auth_user_id
from public.accounts
where auth_user_id is not null
on conflict (account_id, user_id) do nothing;

commit;
```

- [ ] **Step 3: Lint the migration SQL**

Run: `npx supabase db lint --schema public` (or, if a local stack isn't running, defer to Task 3's branch apply which lints on apply).
Expected: no errors introduced by the new objects. (Pre-existing advisories on other objects are out of scope for PR1.)

- [ ] **Step 4: Commit the migration**

```bash
git add supabase/migrations/20260714120000_multibrand_foundation.sql
git commit -m "feat(db): add multi-brand foundation (members, admins, audit, accounts cols)

PR1 of multi-brand tenancy. Additive + backward-compatible: no RLS rewrite,
no UNIQUE drop, no app change. See tasks/SPEC-multi-brand-tenancy.md.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Author the verification assertions

**Files:**
- Create: `supabase/tests/multibrand_foundation_verify.sql`

- [ ] **Step 1: Write the assertion script**

Create `supabase/tests/multibrand_foundation_verify.sql` with:

```sql
-- Verification for 20260714120000_multibrand_foundation.
-- Run AFTER applying the migration (preview branch or local). Each block
-- raises an exception if the expectation is not met; a clean run = pass.

do $$
begin
  -- new tables exist
  if to_regclass('public.app_admins')     is null then raise exception 'app_admins missing'; end if;
  if to_regclass('public.account_members') is null then raise exception 'account_members missing'; end if;
  if to_regclass('public.admin_audit')    is null then raise exception 'admin_audit missing'; end if;

  -- helper functions exist and are SECURITY DEFINER
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='is_super_admin' and p.prosecdef)
    then raise exception 'is_super_admin missing or not SECURITY DEFINER'; end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='is_account_member' and p.prosecdef)
    then raise exception 'is_account_member missing or not SECURITY DEFINER'; end if;

  -- additive accounts columns exist
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='accounts' and column_name='created_by_user_id')
    then raise exception 'accounts.created_by_user_id missing'; end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='accounts' and column_name='archived_at')
    then raise exception 'accounts.archived_at missing'; end if;

  -- backfill: one membership per account, and created_by_user_id populated
  if (select count(*) from public.account_members)
     <> (select count(*) from public.accounts where auth_user_id is not null)
    then raise exception 'account_members backfill count mismatch'; end if;
  if exists (select 1 from public.accounts where auth_user_id is not null and created_by_user_id is null)
    then raise exception 'created_by_user_id not fully backfilled'; end if;

  -- the UNIQUE constraint on accounts.auth_user_id is STILL present (PR1 must not drop it)
  if not exists (
    select 1 from pg_constraint c join pg_class t on t.oid=c.conrelid
    where t.relname='accounts' and c.contype='u'
      and pg_get_constraintdef(c.oid) ilike '%auth_user_id%')
    then raise exception 'accounts.auth_user_id UNIQUE was unexpectedly removed in PR1'; end if;

  raise notice 'PR1 foundation verification PASSED';
end $$;
```

- [ ] **Step 2: Commit the verification script**

```bash
git add supabase/tests/multibrand_foundation_verify.sql
git commit -m "test(db): add PR1 multi-brand foundation verification assertions

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Apply and verify on a throwaway Supabase preview branch

> This proves the migration applies cleanly and the assertions pass **without touching production**. Requires owner approval for the (small, temporary) preview-branch cost. If a local `supabase start` stack is available instead, use that and skip the branch.

- [ ] **Step 1: Create a preview branch** (owner-approved; via Supabase MCP `create_branch` on project `nbkjciurhvkfpcpatbnt`, confirming the cost) OR start local: `npx supabase start`.

- [ ] **Step 2: Apply the migration** to the branch/local (the branch applies the migration chain automatically on creation; for local run `npx supabase db push`).

- [ ] **Step 3: Run the verification script** against the branch/local database.

Run (via MCP `execute_sql` on the branch, or `psql`): the contents of `supabase/tests/multibrand_foundation_verify.sql`.
Expected: `NOTICE: PR1 foundation verification PASSED`, no exception.

- [ ] **Step 4: Smoke-check the helpers behave** (branch/local):

```sql
-- as an anonymous/no-JWT context, is_super_admin() must be false, not error
select public.is_super_admin();            -- expected: f
select public.is_account_member(gen_random_uuid());  -- expected: f
```
Expected: both return `false` without error.

- [ ] **Step 5: Delete the preview branch** (via MCP `delete_branch`) to stop cost. (No commit in this task.)

---

## Task 4: Author the super-admin bootstrap ops script (run later, by UUID)

**Files:**
- Create: `scripts/ops/bootstrap-super-admin.ts`

> This is **authored** in PR1 but **run manually** (by the owner) against the target environment with an explicit `auth.users.id`. It is idempotent and asserts exactly one target.

- [ ] **Step 1: Inspect an existing ops script for the house pattern**

Read `scripts/ops/link-auth-user.ts` for: how it loads env (`dotenv`), builds the service-role client, reads CLI args, and logs. Match that style.

- [ ] **Step 2: Write the script**

Create `scripts/ops/bootstrap-super-admin.ts`:

```ts
/**
 * One-time super-admin bootstrap. Idempotent. Seeds public.app_admins by an
 * explicit auth.users.id (never by email — an email lookup can silently match
 * zero rows). Usage:
 *   npx tsx scripts/ops/bootstrap-super-admin.ts <auth-user-uuid>
 * Requires SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL in the env.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main(): Promise<void> {
  const userId = process.argv[2];
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) {
    throw new Error('Usage: bootstrap-super-admin.ts <auth-user-uuid>');
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');

  const db = createClient(url, key, { auth: { persistSession: false } });

  // Assert the target auth user exists (fail loudly if not).
  const { data: found, error: getErr } = await db.auth.admin.getUserById(userId);
  if (getErr || !found?.user) throw new Error(`No auth user with id ${userId}: ${getErr?.message ?? 'not found'}`);

  const { error: insErr } = await db
    .from('app_admins')
    .upsert({ user_id: userId, created_by: userId }, { onConflict: 'user_id' });
  if (insErr) throw new Error(`Failed to seed app_admins: ${insErr.message}`);

  const { data: check, error: chkErr } = await db
    .from('app_admins').select('user_id').eq('user_id', userId).maybeSingle();
  if (chkErr || !check) throw new Error('Post-write verification failed: row not present');

  console.log(`Super-admin bootstrapped for ${userId} (${found.user.email ?? 'no email'})`);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 3: Typecheck the script**

Run: `npx tsc --noEmit`
Expected: clean (no new type errors).

- [ ] **Step 4: Commit**

```bash
git add scripts/ops/bootstrap-super-admin.ts
git commit -m "feat(ops): add idempotent super-admin bootstrap by UUID

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Full verification pipeline + PR

- [ ] **Step 1: Run the TS pipeline** (PR1 changes no `src/`, so this should be unaffected — confirm nothing broke):

Run: `npm run lint && npx tsc --noEmit && npm test`
Expected: all pass (no `src/` behaviour changed; the new ops script typechecks).

- [ ] **Step 2: Push the branch and open a draft PR** (do NOT merge; do NOT apply to production):

```bash
git push -u origin feat/multibrand-pr1-foundation
gh pr create --draft --title "feat: multi-brand PR1 — membership foundation (backward-compatible)" \
  --body "PR1 of multi-brand tenancy (tasks/SPEC-multi-brand-tenancy.md §14). Additive DB only: account_members, app_admins, admin_audit, is_super_admin/is_account_member helpers, accounts.created_by_user_id/archived_at, membership backfill. No RLS rewrite, no UNIQUE drop, no app change. Verified on a preview branch. Production apply is gated on the §14 runbook.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 3: Report the production-apply gate** — surface to the owner that PR1 is ready and applying to production is the explicit next go/no-go (per spec §14 runbook: backup, preflight counts, apply, run `multibrand_foundation_verify.sql`, bootstrap super-admin by UUID).

---

## Self-review (completed against spec v2)

**Spec coverage (PR1 slice, spec §14 PR1):** `account_members` (§4.1) ✓ Task 1; `app_admins` (§4.2) ✓ Task 1; `admin_audit` (§4.5) ✓ Task 1; helpers in correct order (§4.4, F-07) ✓ Task 1; `created_by_user_id … SET NULL` + `archived_at` (§4.3, D13/D14) ✓ Task 1; membership backfill before any UNIQUE drop (§10) ✓ Task 1; super-admin bootstrap by UUID (F-23) ✓ Task 4; verification/assertions (F-22 preflight spirit) ✓ Task 2–3. **Deferred to PR2 (correctly):** dropping the UNIQUE, RLS rewrite, `business_name` NOT NULL, `current_account_id()` retirement, Meta FK reconciliation, all app/auth code — none belong in the backward-compatible foundation.

**Placeholder scan:** no TBD/TODO; every SQL/TS block is complete.

**Type/name consistency:** `is_super_admin()` / `is_account_member(uuid)` / `account_members(account_id,user_id,created_at,created_by)` / `app_admins(user_id,...)` / `admin_audit(...)` names are identical across the migration, verification script, and spec §4. The verification asserts the UNIQUE constraint is *retained* (guards against accidentally pulling PR2 work forward).

**Deviation logged:** RLS enabled but not FORCED on the membership tables (design note above) — deliberate, to keep the `SECURITY DEFINER` helpers clean; PR2 can revisit if defence-in-depth requires FORCE.
