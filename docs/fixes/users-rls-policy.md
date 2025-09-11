# Fix: Users RLS Blocks Self Row (Empty/406)

This script adds the minimal, correct RLS policies on `public.users` so a logged‑in user can read/update their own row. It also includes a simulation block to verify behaviour under RLS using Supabase's `request.jwt.claims` session variable.

Run each numbered block separately in the Supabase SQL editor for project:
- onvnfijtzumtnmgwhiaq

Replace the UID/EMAIL in the simulation blocks with your values if different.

---

1) Inspect current RLS state and policies (diagnostic)
```
select n.nspname as schema,
       c.relname  as table,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'users';

select p.polname,
       p.polcmd  as cmd,
       pg_get_expr(p.polqual,  c.oid)       as using,
       pg_get_expr(p.polwithcheck, c.oid)   as with_check
from pg_policy p
join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'users'
order by p.polname, p.polcmd;
```
Expected after fix later: one SELECT policy with `USING (id = auth.uid())`; insert/update policies for self.

---

2) Create minimal self policies for `public.users`
```
-- Enable RLS if not already
alter table public.users enable row level security;

-- Drop any conflicting policies for a clean slate (no-op if none exist)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN (
    select polname from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'users'
  ) LOOP
    EXECUTE format('drop policy if exists %I on public.users', r.polname);
  END LOOP;
END $$;

-- Allow a user to read their own row
create policy users_select_self
  on public.users for select
  using (id = auth.uid());

-- Allow a user to insert their own row (used by app to create profile)
create policy users_insert_self
  on public.users for insert
  with check (id = auth.uid());

-- Allow a user to update their own row
create policy users_update_self
  on public.users for update
  using (id = auth.uid())
  with check (id = auth.uid());
```

---

3) Verify under RLS with simulated JWT (diagnostic)

Set a local session JWT so `auth.uid()` resolves to your uid. Replace only if your UID/EMAIL differ.
```
-- Simulate an authenticated request context
set local role authenticated;  -- built-in Supabase DB role
set local request.jwt.claims = '{
  "sub": "9995ff23-626a-4a59-80b8-d346d91ac424",
  "role": "authenticated",
  "email": "peter@orangejelly.co.uk"
}';

-- Self-select should now return your row (1 row)
select id, email, tenant_id
from public.users
where id = auth.uid();

-- get_auth_tenant_id() should return your tenant
select public.get_auth_tenant_id() as tenant_id;
```
Expected: one row for the user; the function returns `303e9600-7ab9-47e8-9cbf-d8d6c37ea8c8`.

---

4) Re-list policies (sanity)
```
select p.polname,
       p.polcmd,
       pg_get_expr(p.polqual,  c.oid)       as using,
       pg_get_expr(p.polwithcheck, c.oid)   as with_check
from pg_policy p
join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'users'
order by p.polname, p.polcmd;
```

You should see:
- users_select_self (USING id = auth.uid())
- users_insert_self (WITH CHECK id = auth.uid())
- users_update_self (USING/WITH CHECK id = auth.uid())

---

5) Optional: quick membership visibility check under the same simulated JWT
```
-- Should return at least 1 membership row for your tenant
select tenant_id, role, created_at
from public.user_tenants
where user_id = auth.uid()
order by role asc, created_at asc
limit 1;
```

If all of the above matches, REST reads will also see your users row (no more 200 [] or 406), and tenant-scoped pages will recognise your tenant again.

